/**
 * Extended tests for src/orchestrator.js — edge cases and error paths.
 *
 * Covers:
 *   - finishRun: git commit failure (warn path)
 *   - finishRun: unexpected exception → fail() result
 *   - runStep: step not found in STEPS array
 *   - initRun: timeout passed through to state
 *   - state file with wrong version → ignored
 *   - buildProgressState correctly marks step statuses
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  unlinkSync: vi.fn(),
  openSync: vi.fn(() => 99),
  closeSync: vi.fn(),
  appendFileSync: vi.fn(),
}));

const mockSpawn = vi.fn();
vi.mock('child_process', () => ({
  spawn: (...args) => mockSpawn(...args),
}));

import { createLoggerMock } from './helpers/mocks.js';

vi.mock('../src/logger.js', () => createLoggerMock());

vi.mock('../src/checks.js', () => ({
  runPreChecks: vi.fn(),
}));

vi.mock('../src/git.js', () => ({
  initGit: vi.fn(() => ({})),
  excludeEphemeralFiles: vi.fn(),
  getCurrentBranch: vi.fn(),
  createPreRunTag: vi.fn(),
  createRunBranch: vi.fn(),
  mergeRunBranch: vi.fn(),
  getGitInstance: vi.fn(() => ({
    add: vi.fn(),
    commit: vi.fn(),
  })),
  getHeadHash: vi.fn(),
  hasNewCommit: vi.fn(),
  fallbackCommit: vi.fn(),
  ensureOnBranch: vi.fn(() => ({ recovered: false })),
}));

vi.mock('../src/claude.js', () => ({
  runPrompt: vi.fn(),
  ERROR_TYPE: { RATE_LIMIT: 'rate_limit', UNKNOWN: 'unknown' },
  sleep: vi.fn(() => Promise.resolve()),
}));

vi.mock('../src/executor.js', () => ({
  executeSingleStep: vi.fn(),
  copyPromptsToProject: vi.fn(),
  SAFETY_PREAMBLE: 'MOCK_PREAMBLE\n',
  PROD_PREAMBLE: 'MOCK_PROD\n',
  sumCosts: (a, b) => {
    if (!a && !b) return null;
    if (!a) return b;
    if (!b) return a;
    return { costUSD: (a.costUSD || 0) + (b.costUSD || 0), inputTokens: (a.inputTokens || 0) + (b.inputTokens || 0), outputTokens: (a.outputTokens || 0) + (b.outputTokens || 0) };
  },
}));

vi.mock('../src/notifications.js', () => ({
  notify: vi.fn(),
}));

vi.mock('../src/report.js', () => ({
  generateReport: vi.fn(),
  buildReportPrompt: vi.fn(() => 'mock report prompt'),
  verifyReportContent: vi.fn(() => true),
  updateClaudeMd: vi.fn(),
  formatDuration: vi.fn((ms) => `${Math.floor(ms / 60000)}m`),
  getVersion: vi.fn(() => '0.1.0'),
  buildReportNames: vi.fn(() => ({ reportFile: '00_NIGHTYTIDY-REPORT_01_2026-01-01-0000.md', reportDir: '/fake/project/audit-reports' })),
}));

vi.mock('../src/lock.js', () => ({
  acquireLock: vi.fn(),
  releaseLock: vi.fn(),
}));

vi.mock('../src/prompts/loader.js', () => ({
  STEPS: [
    { number: 1, name: 'Documentation', prompt: 'Fix docs' },
    { number: 2, name: 'Test Coverage', prompt: 'Add tests' },
    { number: 3, name: 'Security Audit', prompt: 'Check security' },
  ],
  DOC_UPDATE_PROMPT: 'Update docs',
  REPORT_PROMPT: 'mock report prompt template',
  CONSOLIDATION_PROMPT: 'Consolidate actions',
  reloadSteps: vi.fn(),
}));

vi.mock('../src/sync.js', () => ({
  syncPrompts: vi.fn().mockResolvedValue({
    success: true,
    summary: { updated: [], added: [], removed: [], unchanged: [] },
    error: null,
  }),
}));

import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { initRun, runStep, finishRun } from '../src/orchestrator.js';
import { warn } from '../src/logger.js';
import { getCurrentBranch, createPreRunTag, createRunBranch, mergeRunBranch, getGitInstance } from '../src/git.js';
import { executeSingleStep } from '../src/executor.js';
import { runPrompt } from '../src/claude.js';
import { generateReport, buildReportPrompt, verifyReportContent } from '../src/report.js';

function createMockChildProcess(jsonOutput) {
  const stdout = new EventEmitter();
  const child = new EventEmitter();
  child.stdout = stdout;
  child.unref = vi.fn();
  if (jsonOutput !== undefined) {
    process.nextTick(() => stdout.emit('data', JSON.stringify(jsonOutput) + '\n'));
  }
  return child;
}

beforeEach(() => {
  vi.clearAllMocks();
  existsSync.mockReturnValue(false);
  mockSpawn.mockReturnValue(createMockChildProcess({ url: 'http://localhost:9999', port: 9999, pid: 12345 }));
});

describe('finishRun edge cases', () => {
  const validState = {
    version: 1,
    originalBranch: 'main',
    runBranch: 'nightytidy/run-2026-03-06-1430',
    tagName: 'nightytidy-before-2026-03-06-1430',
    selectedSteps: [1],
    completedSteps: [
      { number: 1, name: 'Documentation', status: 'completed', duration: 120000, attempts: 1 },
    ],
    failedSteps: [],
    startTime: Date.now() - 300000,
    timeout: null,
    dashboardPid: null,
    dashboardUrl: null,
  };

  beforeEach(() => {
    runPrompt.mockResolvedValue({ success: true, output: 'Report generated successfully' });
    buildReportPrompt.mockReturnValue('mock report prompt');
    verifyReportContent.mockReturnValue(true);
  });

  /** Helper to mock existsSync + readFileSync for finishRun (state file + report file) */
  function setupFinishRunMocks(state) {
    existsSync.mockReturnValue(true);
    readFileSync.mockImplementation((filePath) => {
      if (typeof filePath === 'string' && filePath.includes('NIGHTYTIDY-REPORT')) {
        return 'mock report file content';
      }
      return JSON.stringify(state);
    });
  }

  it('warns but continues when git commit of report fails', async () => {
    setupFinishRunMocks(validState);
    mergeRunBranch.mockResolvedValue({ success: true });

    const mockGit = {
      add: vi.fn().mockResolvedValue(),
      commit: vi.fn().mockRejectedValue(new Error('nothing to commit')),
    };
    getGitInstance.mockReturnValue(mockGit);

    const result = await finishRun('/fake/project');

    expect(result.success).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Failed to commit report'));
  });

  it('returns fail result when unexpected error occurs during merge', async () => {
    setupFinishRunMocks(validState);
    // Force an error by making mergeRunBranch throw (not reject)
    mergeRunBranch.mockImplementation(() => { throw new Error('catastrophic git failure'); });
    getGitInstance.mockReturnValue({ add: vi.fn(), commit: vi.fn() });

    const result = await finishRun('/fake/project');

    expect(result.success).toBe(false);
    expect(result.error).toContain('catastrophic git failure');
  });

  it('returns fail result when generateReport throws in fallback path', async () => {
    setupFinishRunMocks(validState);
    getGitInstance.mockReturnValue({ add: vi.fn(), commit: vi.fn() });

    // Make AI report fail verification so fallback is triggered
    verifyReportContent.mockReturnValue(false);
    generateReport.mockImplementation(() => { throw new Error('cannot write report'); });

    const result = await finishRun('/fake/project');

    expect(result.success).toBe(false);
    expect(result.error).toContain('cannot write report');
  });

  it('returns fail when state version is wrong', async () => {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue(JSON.stringify({ version: 999, selectedSteps: [1] }));

    const result = await finishRun('/fake/project');

    expect(result.success).toBe(false);
    expect(result.error).toContain('No active orchestrator run');
  });

  it('sorts step results by selected order, not completion order', async () => {
    const mixedState = {
      ...validState,
      selectedSteps: [1, 2, 3],
      completedSteps: [
        { number: 3, name: 'Security Audit', status: 'completed', duration: 30000, attempts: 1 },
        { number: 1, name: 'Documentation', status: 'completed', duration: 60000, attempts: 1 },
      ],
      failedSteps: [
        { number: 2, name: 'Test Coverage', status: 'failed', duration: 10000, attempts: 4 },
      ],
    };
    setupFinishRunMocks(mixedState);
    mergeRunBranch.mockResolvedValue({ success: true });
    getGitInstance.mockReturnValue({ add: vi.fn(), commit: vi.fn() });

    // verifyReportContent returns false so fallback generateReport is called
    verifyReportContent.mockReturnValue(false);

    await finishRun('/fake/project');

    const [results] = generateReport.mock.calls[0];
    // Results should be sorted by selected order: 1, 2, 3
    expect(results.results[0].step.number).toBe(1);
    expect(results.results[1].step.number).toBe(2);
    expect(results.results[2].step.number).toBe(3);
  });
});

describe('runStep edge cases', () => {
  it('passes timeout from state file to executeSingleStep', async () => {
    const stateWithTimeout = {
      version: 1,
      originalBranch: 'main',
      runBranch: 'branch',
      tagName: 'tag',
      selectedSteps: [1],
      completedSteps: [],
      failedSteps: [],
      startTime: Date.now(),
      timeout: 2700000, // 45 minutes in ms
    };
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue(JSON.stringify(stateWithTimeout));
    executeSingleStep.mockResolvedValue({
      step: { number: 1, name: 'Documentation' },
      status: 'completed',
      output: 'done',
      duration: 60000,
      attempts: 1,
      error: null,
    });

    await runStep('/fake/project', 1);

    const callArgs = executeSingleStep.mock.calls[0];
    const options = callArgs[2]; // third argument is options
    expect(options.timeout).toBe(2700000);
  });

  it('prefers per-call timeout over state timeout', async () => {
    const stateWithTimeout = {
      version: 1,
      originalBranch: 'main',
      runBranch: 'branch',
      tagName: 'tag',
      selectedSteps: [1],
      completedSteps: [],
      failedSteps: [],
      startTime: Date.now(),
      timeout: 2700000,
    };
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue(JSON.stringify(stateWithTimeout));
    executeSingleStep.mockResolvedValue({
      step: { number: 1, name: 'Documentation' },
      status: 'completed',
      output: 'done',
      duration: 60000,
      attempts: 1,
      error: null,
    });

    await runStep('/fake/project', 1, { timeout: 1800000 });

    const callArgs = executeSingleStep.mock.calls[0];
    const options = callArgs[2];
    expect(options.timeout).toBe(1800000);
  });

  it('returns fail when readState returns null due to corrupt JSON', async () => {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue('not valid json');

    const result = await runStep('/fake/project', 1);

    expect(result.success).toBe(false);
    expect(result.error).toContain('No active orchestrator run');
  });
});

describe('initRun edge cases', () => {
  beforeEach(() => {
    getCurrentBranch.mockResolvedValue('main');
    createPreRunTag.mockResolvedValue('tag');
    createRunBranch.mockResolvedValue('branch');
  });

  it('stores timeout in state file', async () => {
    const result = await initRun('/fake/project', { steps: '1', timeout: 3600000 });

    expect(result.success).toBe(true);

    const stateCall = writeFileSync.mock.calls.find(c => c[0].includes('nightytidy-run-state.json.tmp'));
    const state = JSON.parse(stateCall[1]);
    expect(state.timeout).toBe(3600000);
  });

  it('stores null timeout when not provided', async () => {
    const result = await initRun('/fake/project', { steps: '1' });

    expect(result.success).toBe(true);

    const stateCall = writeFileSync.mock.calls.find(c => c[0].includes('nightytidy-run-state.json.tmp'));
    const state = JSON.parse(stateCall[1]);
    expect(state.timeout).toBeNull();
  });

  it('handles lock acquisition failure', async () => {
    const { acquireLock } = await import('../src/lock.js');
    acquireLock.mockRejectedValueOnce(new Error('Lock held by another process'));

    const result = await initRun('/fake/project', { steps: '1' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Lock held by another process');
  });
});
