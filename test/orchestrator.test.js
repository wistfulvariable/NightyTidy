import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

// Mock child_process.spawn for dashboard server spawning
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
  sumCosts: vi.fn((a, b) => {
    if (!a && !b) return null;
    if (!a) return b;
    if (!b) return a;
    return { costUSD: (a.costUSD || 0) + (b.costUSD || 0), inputTokens: (a.inputTokens || 0) + (b.inputTokens || 0), outputTokens: (a.outputTokens || 0) + (b.outputTokens || 0) };
  }),
  SAFETY_PREAMBLE: 'MOCK_PREAMBLE\n',
  PROD_PREAMBLE: 'MOCK_PROD\n',
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
  buildReportNames: vi.fn(() => ({ reportFile: 'NIGHTYTIDY-REPORT_01_2026-01-01-0000.md' })),
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
import { initLogger } from '../src/logger.js';
import { runPreChecks } from '../src/checks.js';
import { getCurrentBranch, createPreRunTag, createRunBranch, mergeRunBranch, getGitInstance, ensureOnBranch } from '../src/git.js';
import { executeSingleStep, sumCosts } from '../src/executor.js';
import { runPrompt } from '../src/claude.js';
import { acquireLock, releaseLock } from '../src/lock.js';
import { generateReport, buildReportPrompt, verifyReportContent, updateClaudeMd } from '../src/report.js';
import { syncPrompts } from '../src/sync.js';
import { reloadSteps } from '../src/prompts/loader.js';

function createMockChildProcess(jsonOutput) {
  const stdout = new EventEmitter();
  const child = new EventEmitter();
  child.stdout = stdout;
  child.unref = vi.fn();
  // Emit data on next tick so the listener is attached first
  if (jsonOutput !== undefined) {
    process.nextTick(() => stdout.emit('data', JSON.stringify(jsonOutput) + '\n'));
  }
  return child;
}

beforeEach(() => {
  vi.clearAllMocks();
  existsSync.mockReturnValue(false);
  // Default: dashboard spawns successfully
  mockSpawn.mockReturnValue(createMockChildProcess({ url: 'http://localhost:9999', port: 9999, pid: 12345 }));
});

describe('initRun', () => {
  beforeEach(() => {
    runPreChecks.mockResolvedValue(undefined);
    getCurrentBranch.mockResolvedValue('main');
    createPreRunTag.mockResolvedValue('nightytidy-before-2026-03-06-1430');
    createRunBranch.mockResolvedValue('nightytidy/run-2026-03-06-1430');
    // Restore sync mock default after vi.clearAllMocks()
    syncPrompts.mockResolvedValue({
      success: true,
      summary: { updated: [], added: [], removed: [], unchanged: [] },
      error: null,
    });
  });

  it('succeeds with valid steps and returns run metadata', async () => {
    const result = await initRun('/fake/project', { steps: '1,3' });

    expect(result.success).toBe(true);
    expect(result.runBranch).toBe('nightytidy/run-2026-03-06-1430');
    expect(result.tagName).toBe('nightytidy-before-2026-03-06-1430');
    expect(result.originalBranch).toBe('main');
    expect(result.selectedSteps).toEqual([1, 3]);
    expect(result.dashboardUrl).toBe('http://localhost:9999');
  });

  it('selects all steps when --steps is not provided', async () => {
    const result = await initRun('/fake/project', {});

    expect(result.success).toBe(true);
    expect(result.selectedSteps).toEqual([1, 2, 3]);
  });

  it('initializes logger in quiet mode', async () => {
    await initRun('/fake/project', {});

    expect(initLogger).toHaveBeenCalledWith('/fake/project', { quiet: true });
  });

  it('acquires persistent lock', async () => {
    await initRun('/fake/project', {});

    expect(acquireLock).toHaveBeenCalledWith('/fake/project', { persistent: true });
  });

  it('writes state file on success', async () => {
    await initRun('/fake/project', { steps: '1,2' });

    expect(writeFileSync).toHaveBeenCalled();
    const stateCall = writeFileSync.mock.calls.find(c => c[0].includes('nightytidy-run-state.json.tmp'));
    expect(stateCall).toBeDefined();
    const state = JSON.parse(stateCall[1]);
    expect(state.version).toBe(1);
    expect(state.selectedSteps).toEqual([1, 2]);
    expect(state.runBranch).toBe('nightytidy/run-2026-03-06-1430');
  });

  it('fails with invalid step numbers', async () => {
    const result = await initRun('/fake/project', { steps: '1,99' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid step number');
    expect(result.error).toContain('99');
  });

  it('fails when state file already exists', async () => {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue(JSON.stringify({ version: 1 }));

    const result = await initRun('/fake/project', {});

    expect(result.success).toBe(false);
    expect(result.error).toContain('already in progress');
  });

  it('fails when pre-checks throw', async () => {
    runPreChecks.mockRejectedValue(new Error('Git is not installed'));

    const result = await initRun('/fake/project', {});

    expect(result.success).toBe(false);
    expect(result.error).toContain('Git is not installed');
  });

  // -------------------------------------------------------------------------
  // Auto-sync during initRun
  // -------------------------------------------------------------------------

  it('calls syncPrompts during initialization', async () => {
    await initRun('/fake/project', { steps: '1' });

    expect(syncPrompts).toHaveBeenCalledTimes(1);
  });

  it('calls reloadSteps when sync has changes', async () => {
    syncPrompts.mockResolvedValue({
      success: true,
      summary: { updated: [{ name: 'Docs' }], added: [], removed: [], unchanged: [] },
      error: null,
    });

    await initRun('/fake/project', { steps: '1' });

    expect(reloadSteps).toHaveBeenCalledTimes(1);
  });

  it('does not call reloadSteps when sync has no changes', async () => {
    syncPrompts.mockResolvedValue({
      success: true,
      summary: { updated: [], added: [], removed: [], unchanged: [{ name: 'Docs' }] },
      error: null,
    });

    await initRun('/fake/project', { steps: '1' });

    expect(reloadSteps).not.toHaveBeenCalled();
  });

  it('continues successfully when sync fails', async () => {
    syncPrompts.mockResolvedValue({
      success: false,
      summary: null,
      error: 'Network error',
    });

    const result = await initRun('/fake/project', { steps: '1' });

    expect(result.success).toBe(true);
  });

  it('continues successfully when sync throws', async () => {
    syncPrompts.mockRejectedValue(new Error('fetch failed'));

    const result = await initRun('/fake/project', { steps: '1' });

    expect(result.success).toBe(true);
  });
});

describe('runStep', () => {
  const validState = {
    version: 1,
    originalBranch: 'main',
    runBranch: 'nightytidy/run-2026-03-06-1430',
    tagName: 'nightytidy-before-2026-03-06-1430',
    selectedSteps: [1, 2, 3],
    completedSteps: [],
    failedSteps: [],
    startTime: Date.now(),
    timeout: null,
  };

  beforeEach(() => {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue(JSON.stringify(validState));
  });

  it('executes a step and returns success result', async () => {
    executeSingleStep.mockResolvedValue({
      step: { number: 1, name: 'Documentation' },
      status: 'completed',
      output: 'done',
      duration: 120000,
      attempts: 1,
      error: null,
    });

    const result = await runStep('/fake/project', 1);

    expect(result.success).toBe(true);
    expect(result.step).toBe(1);
    expect(result.name).toBe('Documentation');
    expect(result.status).toBe('completed');
    expect(result.remainingSteps).toEqual([2, 3]);
  });

  it('updates state file with completed step', async () => {
    executeSingleStep.mockResolvedValue({
      step: { number: 1, name: 'Documentation' },
      status: 'completed',
      output: 'done',
      duration: 120000,
      attempts: 1,
      error: null,
    });

    await runStep('/fake/project', 1);

    const stateCall = writeFileSync.mock.calls.find(c => c[0].includes('nightytidy-run-state.json.tmp'));
    const updatedState = JSON.parse(stateCall[1]);
    expect(updatedState.completedSteps).toHaveLength(1);
    expect(updatedState.completedSteps[0].number).toBe(1);
  });

  it('records failed steps in state', async () => {
    executeSingleStep.mockResolvedValue({
      step: { number: 1, name: 'Documentation' },
      status: 'failed',
      output: '',
      duration: 30000,
      attempts: 4,
      error: 'Claude timed out',
    });

    const result = await runStep('/fake/project', 1);

    expect(result.success).toBe(true); // Command succeeded even though step failed
    expect(result.status).toBe('failed');

    const stateCall = writeFileSync.mock.calls.find(c => c[0].includes('nightytidy-run-state.json.tmp'));
    const updatedState = JSON.parse(stateCall[1]);
    expect(updatedState.failedSteps).toHaveLength(1);
  });

  it('fails when no state file exists', async () => {
    existsSync.mockReturnValue(false);

    const result = await runStep('/fake/project', 1);

    expect(result.success).toBe(false);
    expect(result.error).toContain('No active orchestrator run');
  });

  it('fails when step is not in selected steps', async () => {
    const result = await runStep('/fake/project', 99);

    expect(result.success).toBe(false);
    expect(result.error).toContain('not in the selected steps');
  });

  it('fails when step has already been completed', async () => {
    const stateWithCompleted = {
      ...validState,
      completedSteps: [{ number: 1, name: 'Documentation', status: 'completed', duration: 120000, attempts: 1 }],
    };
    readFileSync.mockReturnValue(JSON.stringify(stateWithCompleted));

    const result = await runStep('/fake/project', 1);

    expect(result.success).toBe(false);
    expect(result.error).toContain('already been completed');
  });

  it('allows retrying a previously-failed step and removes old entry on success', async () => {
    const stateWithFailed = {
      ...validState,
      failedSteps: [{ number: 1, name: 'Documentation', status: 'failed', duration: 30000, attempts: 4, errorType: 'rate_limit' }],
    };
    readFileSync.mockReturnValue(JSON.stringify(stateWithFailed));

    executeSingleStep.mockResolvedValue({
      step: { number: 1, name: 'Documentation' },
      status: 'completed',
      output: 'done on retry',
      duration: 90000,
      attempts: 1,
      error: null,
    });

    const result = await runStep('/fake/project', 1);

    expect(result.success).toBe(true);
    expect(result.status).toBe('completed');

    // State should have step in completedSteps, NOT in failedSteps (no duplicate)
    const stateCall = writeFileSync.mock.calls.find(c => c[0].includes('nightytidy-run-state.json.tmp'));
    const savedState = JSON.parse(stateCall[1]);
    expect(savedState.completedSteps).toHaveLength(1);
    expect(savedState.completedSteps[0].number).toBe(1);
    expect(savedState.failedSteps).toHaveLength(0);
  });

  it('removes old failed entry when step fails again on retry (no duplicates)', async () => {
    const stateWithFailed = {
      ...validState,
      failedSteps: [{ number: 1, name: 'Documentation', status: 'failed', duration: 30000, attempts: 4, errorType: 'rate_limit' }],
    };
    readFileSync.mockReturnValue(JSON.stringify(stateWithFailed));

    executeSingleStep.mockResolvedValue({
      step: { number: 1, name: 'Documentation' },
      status: 'failed',
      output: 'failed again',
      duration: 60000,
      attempts: 2,
      error: 'Step failed again',
    });

    const result = await runStep('/fake/project', 1);

    expect(result.success).toBe(true);
    expect(result.status).toBe('failed');

    // State should have exactly ONE entry in failedSteps (the new one, not the old)
    const stateCall = writeFileSync.mock.calls.find(c => c[0].includes('nightytidy-run-state.json.tmp'));
    const savedState = JSON.parse(stateCall[1]);
    expect(savedState.failedSteps).toHaveLength(1);
    expect(savedState.failedSteps[0].output).toBe('failed again');
    expect(savedState.completedSteps).toHaveLength(0);
  });

  it('computes remaining steps correctly after completion', async () => {
    const stateWithSomeCompleted = {
      ...validState,
      completedSteps: [{ number: 1, name: 'Documentation', status: 'completed', duration: 120000, attempts: 1 }],
    };
    readFileSync.mockReturnValue(JSON.stringify(stateWithSomeCompleted));

    executeSingleStep.mockResolvedValue({
      step: { number: 2, name: 'Test Coverage' },
      status: 'completed',
      output: 'done',
      duration: 180000,
      attempts: 1,
      error: null,
    });

    const result = await runStep('/fake/project', 2);

    expect(result.remainingSteps).toEqual([3]);
  });

  it('includes costUSD in return value when step has cost', async () => {
    executeSingleStep.mockResolvedValue({
      step: { number: 1, name: 'Documentation' },
      status: 'completed',
      output: 'done',
      duration: 120000,
      attempts: 1,
      error: null,
      cost: { costUSD: 0.0512, inputTokens: 800, outputTokens: 50, numTurns: 5, durationApiMs: 2100, sessionId: 'sess-1' },
    });

    const result = await runStep('/fake/project', 1);

    expect(result.success).toBe(true);
    expect(result.costUSD).toBe(0.0512);
    expect(result.inputTokens).toBe(800);
    expect(result.outputTokens).toBe(50);
  });

  it('stores cost in state file entry', async () => {
    executeSingleStep.mockResolvedValue({
      step: { number: 1, name: 'Documentation' },
      status: 'completed',
      output: 'done',
      duration: 120000,
      attempts: 1,
      error: null,
      cost: { costUSD: 0.03, inputTokens: 600, outputTokens: 40, numTurns: 2, durationApiMs: 1500, sessionId: 'sess-x' },
    });

    await runStep('/fake/project', 1);

    const stateCall = writeFileSync.mock.calls.find(c => c[0].includes('nightytidy-run-state.json.tmp'));
    const updatedState = JSON.parse(stateCall[1]);
    expect(updatedState.completedSteps[0].cost).toEqual({
      costUSD: 0.03, inputTokens: 600, outputTokens: 40, numTurns: 2, durationApiMs: 1500, sessionId: 'sess-x',
    });
  });

  it('returns costUSD: null when step has no cost data', async () => {
    executeSingleStep.mockResolvedValue({
      step: { number: 1, name: 'Documentation' },
      status: 'completed',
      output: 'done',
      duration: 120000,
      attempts: 1,
      error: null,
    });

    const result = await runStep('/fake/project', 1);

    expect(result.costUSD).toBeNull();
    expect(result.inputTokens).toBeNull();
    expect(result.outputTokens).toBeNull();
  });

  it('passes suspiciousFast flag through from executeSingleStep', async () => {
    executeSingleStep.mockResolvedValue({
      step: { number: 1, name: 'Documentation' },
      status: 'completed',
      output: 'done',
      duration: 120000,
      attempts: 2,
      error: null,
      cost: { costUSD: 0.05, inputTokens: 500, outputTokens: 30, numTurns: 3, durationApiMs: 2000, sessionId: 'sess-1' },
      suspiciousFast: true,
    });

    const result = await runStep('/fake/project', 1);

    expect(result.success).toBe(true);
    expect(result.suspiciousFast).toBe(true);
  });

  it('returns suspiciousFast: false when step completes normally', async () => {
    executeSingleStep.mockResolvedValue({
      step: { number: 1, name: 'Documentation' },
      status: 'completed',
      output: 'done',
      duration: 300000,
      attempts: 1,
      error: null,
    });

    const result = await runStep('/fake/project', 1);

    expect(result.success).toBe(true);
    expect(result.suspiciousFast).toBe(false);
  });
});

describe('finishRun', () => {
  const validState = {
    version: 1,
    originalBranch: 'main',
    runBranch: 'nightytidy/run-2026-03-06-1430',
    tagName: 'nightytidy-before-2026-03-06-1430',
    selectedSteps: [1, 2],
    completedSteps: [
      { number: 1, name: 'Documentation', status: 'completed', duration: 120000, attempts: 1 },
    ],
    failedSteps: [
      { number: 2, name: 'Test Coverage', status: 'failed', duration: 30000, attempts: 4 },
    ],
    startTime: Date.now() - 300000,
    timeout: null,
    dashboardPid: 12345,
    dashboardUrl: 'http://localhost:9999',
  };

  beforeEach(() => {
    existsSync.mockReturnValue(true);
    readFileSync.mockImplementation((filePath) => {
      if (typeof filePath === 'string' && filePath.includes('NIGHTYTIDY-REPORT')) {
        return 'mock report file content';
      }
      return JSON.stringify(validState);
    });
    mergeRunBranch.mockResolvedValue({ success: true });
    getGitInstance.mockReturnValue({ add: vi.fn(), commit: vi.fn() });
    runPrompt.mockResolvedValue({ success: true, output: 'Report generated successfully' });
    buildReportPrompt.mockReturnValue('mock report prompt');
    verifyReportContent.mockReturnValue(true);
  });

  it('generates report and merges successfully', async () => {
    const result = await finishRun('/fake/project');

    expect(result.success).toBe(true);
    expect(result.completed).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.merged).toBe(true);
    expect(result.reportPath).toBe('NIGHTYTIDY-REPORT_01_2026-01-01-0000.md');
    expect(result.reportContent).toBeTypeOf('string');
    // AI report succeeded, so generateReport fallback should NOT be called
    expect(buildReportPrompt).toHaveBeenCalled();
    expect(verifyReportContent).toHaveBeenCalled();
    expect(generateReport).not.toHaveBeenCalled();
  });

  it('calls buildReportPrompt with execution results and metadata', async () => {
    await finishRun('/fake/project');

    expect(buildReportPrompt).toHaveBeenCalledOnce();
    const [executionResults, metadata, options] = buildReportPrompt.mock.calls[0];
    expect(executionResults.completedCount).toBe(1);
    expect(executionResults.failedCount).toBe(1);
    expect(executionResults.results).toHaveLength(2);
    expect(metadata.branchName).toBe('nightytidy/run-2026-03-06-1430');
    expect(options.reportFile).toBe('NIGHTYTIDY-REPORT_01_2026-01-01-0000.md');
  });

  it('passes totalInputTokens and totalOutputTokens in metadata to buildReportPrompt', async () => {
    const stateWithCost = {
      ...validState,
      completedSteps: [
        { number: 1, name: 'Documentation', status: 'completed', duration: 120000, attempts: 1, cost: { costUSD: 0.05, inputTokens: 8000, outputTokens: 2000 } },
      ],
      failedSteps: [
        { number: 2, name: 'Test Coverage', status: 'failed', duration: 30000, attempts: 4, cost: { costUSD: 0.03, inputTokens: 5000, outputTokens: 1000 } },
      ],
    };
    readFileSync.mockImplementation((filePath) => {
      if (typeof filePath === 'string' && filePath.includes('NIGHTYTIDY-REPORT')) {
        return 'mock report file content';
      }
      return JSON.stringify(stateWithCost);
    });

    await finishRun('/fake/project');

    const [, metadata] = buildReportPrompt.mock.calls[0];
    // Steps: 8000+5000=13000 input, 2000+1000=3000 output
    expect(metadata.totalInputTokens).toBe(13000);
    expect(metadata.totalOutputTokens).toBe(3000);
  });

  it('releases lock and deletes state file', async () => {
    await finishRun('/fake/project');

    expect(releaseLock).toHaveBeenCalledWith('/fake/project');
    expect(unlinkSync).toHaveBeenCalled();
  });

  it('reports merge conflict without throwing', async () => {
    mergeRunBranch.mockResolvedValue({ success: false, conflict: true });

    const result = await finishRun('/fake/project');

    expect(result.success).toBe(true);
    expect(result.merged).toBe(false);
    expect(result.mergeConflict).toBe(true);
  });

  it('works with no completed steps (empty report)', async () => {
    const emptyState = {
      ...validState,
      completedSteps: [],
      failedSteps: [],
    };
    readFileSync.mockImplementation((filePath) => {
      if (typeof filePath === 'string' && filePath.includes('NIGHTYTIDY-REPORT')) {
        return 'mock report file content';
      }
      return JSON.stringify(emptyState);
    });

    const result = await finishRun('/fake/project');

    expect(result.success).toBe(true);
    expect(result.completed).toBe(0);
    expect(result.failed).toBe(0);
  });

  it('fails when no state file exists', async () => {
    existsSync.mockReturnValue(false);

    const result = await finishRun('/fake/project');

    expect(result.success).toBe(false);
    expect(result.error).toContain('No active orchestrator run');
  });

  it('makes a single runPrompt call for report generation', async () => {
    await finishRun('/fake/project');

    expect(runPrompt).toHaveBeenCalledOnce();
    const [promptArg, , options] = runPrompt.mock.calls[0];
    expect(promptArg).toContain('mock report prompt');
    expect(options.label).toBe('Report generation');
  });

  it('falls back to generateReport when AI report fails verification', async () => {
    verifyReportContent.mockReturnValue(false);

    const result = await finishRun('/fake/project');

    expect(result.success).toBe(true);
    expect(generateReport).toHaveBeenCalledOnce();
    const [, narration, , options] = generateReport.mock.calls[0];
    expect(narration).toBeNull();
    expect(options.skipClaudeMdUpdate).toBe(true);
  });

  it('commits report and CLAUDE.md', async () => {
    const mockGit = { add: vi.fn(), commit: vi.fn() };
    getGitInstance.mockReturnValue(mockGit);

    await finishRun('/fake/project');

    const addedFiles = mockGit.add.mock.calls[0][0];
    expect(addedFiles).toEqual(['NIGHTYTIDY-REPORT_01_2026-01-01-0000.md', 'CLAUDE.md']);
  });

  it('calls updateClaudeMd independently', async () => {
    await finishRun('/fake/project');

    expect(updateClaudeMd).toHaveBeenCalledOnce();
    const [metadata] = updateClaudeMd.mock.calls[0];
    expect(metadata.branchName).toBe('nightytidy/run-2026-03-06-1430');
  });

  it('stops dashboard server and cleans up ephemeral files', async () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {});

    await finishRun('/fake/project');

    expect(killSpy).toHaveBeenCalledWith(12345, 'SIGTERM');
    // Verify ephemeral file cleanup (progress.json and dashboard.url)
    const unlinkCalls = unlinkSync.mock.calls.map(c => c[0]);
    expect(unlinkCalls.some(p => p.includes('nightytidy-progress.json'))).toBe(true);
    expect(unlinkCalls.some(p => p.includes('nightytidy-dashboard.url'))).toBe(true);

    killSpy.mockRestore();
  });

  it('handles missing dashboard PID gracefully', async () => {
    const stateNoDash = { ...validState, dashboardPid: null, dashboardUrl: null };
    readFileSync.mockImplementation((filePath) => {
      if (typeof filePath === 'string' && filePath.includes('NIGHTYTIDY-REPORT')) {
        return 'mock report file content';
      }
      return JSON.stringify(stateNoDash);
    });

    const result = await finishRun('/fake/project');

    expect(result.success).toBe(true);
  });

});

describe('dashboard integration', () => {
  beforeEach(() => {
    runPreChecks.mockResolvedValue();
    getCurrentBranch.mockResolvedValue('main');
    createPreRunTag.mockResolvedValue('nightytidy-before-2026-03-06-1430');
    createRunBranch.mockResolvedValue('nightytidy/run-2026-03-06-1430');
  });

  it('initRun spawns dashboard server and saves PID in state', async () => {
    const result = await initRun('/fake/project', { steps: '1' });

    expect(result.success).toBe(true);
    expect(result.dashboardUrl).toBe('http://localhost:9999');

    // State should include dashboard PID
    const stateCalls = writeFileSync.mock.calls.filter(c => c[0].includes('nightytidy-run-state.json.tmp'));
    const lastState = JSON.parse(stateCalls[stateCalls.length - 1][1]);
    expect(lastState.dashboardPid).toBe(12345);
    expect(lastState.dashboardUrl).toBe('http://localhost:9999');
  });

  it('initRun writes initial progress JSON', async () => {
    await initRun('/fake/project', { steps: '1,2' });

    // Find the final 'running' progress (init phases write 'initializing' first)
    const progressCall = writeFileSync.mock.calls.find(c => {
      if (!c[0].includes('nightytidy-progress.json')) return false;
      const data = JSON.parse(c[1]);
      return data.status === 'running';
    });
    expect(progressCall).toBeDefined();
    const progress = JSON.parse(progressCall[1]);
    expect(progress.status).toBe('running');
    expect(progress.totalSteps).toBe(2);
    expect(progress.steps).toHaveLength(2);
    expect(progress.steps[0].status).toBe('pending');
  });

  it('initRun writes init phase progress at each stage', async () => {
    await initRun('/fake/project', { steps: '1,2' });

    const initProgressCalls = writeFileSync.mock.calls
      .filter(c => c[0].includes('nightytidy-progress.json'))
      .map(c => JSON.parse(c[1]))
      .filter(p => p.status === 'initializing');

    // Should have all 8 init phases
    expect(initProgressCalls.length).toBe(8);

    // Phases should appear in correct order
    const phases = initProgressCalls.map(p => p.initPhase);
    expect(phases).toEqual([
      'lock', 'git_init', 'pre_checks', 'sync_prompts',
      'validate_steps', 'git_branch', 'copy_prompts', 'dashboard',
    ]);

    // Each should only contain status + initPhase
    for (const p of initProgressCalls) {
      expect(p.status).toBe('initializing');
      expect(typeof p.initPhase).toBe('string');
    }
  });

  it('initRun with skipDashboard skips dashboard phase and spawn', async () => {
    const result = await initRun('/fake/project', { steps: '1,2', skipDashboard: true });

    expect(result.success).toBe(true);
    expect(result.dashboardUrl).toBeNull();

    // Dashboard spawn should not have been called
    expect(mockSpawn).not.toHaveBeenCalled();

    // Should have only 7 init phases (no 'dashboard')
    const initProgressCalls = writeFileSync.mock.calls
      .filter(c => c[0].includes('nightytidy-progress.json'))
      .map(c => JSON.parse(c[1]))
      .filter(p => p.status === 'initializing');

    expect(initProgressCalls.length).toBe(7);
    const phases = initProgressCalls.map(p => p.initPhase);
    expect(phases).not.toContain('dashboard');
    expect(phases).toEqual([
      'lock', 'git_init', 'pre_checks', 'sync_prompts',
      'validate_steps', 'git_branch', 'copy_prompts',
    ]);
  });

  it('initRun succeeds without dashboard URL when spawn fails', async () => {
    mockSpawn.mockReturnValue(createMockChildProcess(undefined));
    // Override: child emits error instead of data
    mockSpawn.mockImplementation(() => {
      const child = createMockChildProcess(undefined);
      process.nextTick(() => child.emit('error', new Error('ENOENT')));
      return child;
    });

    const result = await initRun('/fake/project', { steps: '1' });

    expect(result.success).toBe(true);
    expect(result.dashboardUrl).toBeNull();
  });

  it('runStep writes progress JSON with running status', async () => {
    const validState = {
      version: 1,
      originalBranch: 'main',
      runBranch: 'nightytidy/run-2026-03-06-1430',
      tagName: 'tag',
      selectedSteps: [1, 2],
      completedSteps: [],
      failedSteps: [],
      startTime: Date.now(),
      timeout: null,
      dashboardPid: 12345,
      dashboardUrl: 'http://localhost:9999',
    };
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue(JSON.stringify(validState));
    executeSingleStep.mockResolvedValue({
      step: { number: 1, name: 'Documentation' },
      status: 'completed',
      output: 'done',
      duration: 60000,
      attempts: 1,
      error: null,
    });

    await runStep('/fake/project', 1);

    const progressCalls = writeFileSync.mock.calls.filter(c => c[0].includes('nightytidy-progress.json'));
    expect(progressCalls.length).toBeGreaterThanOrEqual(2); // before + after step

    // First progress write: step marked as running
    const beforeProgress = JSON.parse(progressCalls[0][1]);
    expect(beforeProgress.currentStepName).toBe('Documentation');
    expect(beforeProgress.steps[0].status).toBe('running');

    // Last progress write: step completed
    const afterProgress = JSON.parse(progressCalls[progressCalls.length - 1][1]);
    expect(afterProgress.steps[0].status).toBe('completed');
  });

  it('finishRun writes completed progress before cleanup', async () => {
    const validState = {
      version: 1,
      originalBranch: 'main',
      runBranch: 'nightytidy/run-2026-03-06-1430',
      tagName: 'tag',
      selectedSteps: [1],
      completedSteps: [{ number: 1, name: 'Documentation', status: 'completed', duration: 60000, attempts: 1 }],
      failedSteps: [],
      startTime: Date.now() - 60000,
      timeout: null,
      dashboardPid: 12345,
      dashboardUrl: 'http://localhost:9999',
    };
    existsSync.mockReturnValue(true);
    readFileSync.mockImplementation((filePath) => {
      if (typeof filePath === 'string' && filePath.includes('NIGHTYTIDY-REPORT')) {
        return 'mock report file content';
      }
      return JSON.stringify(validState);
    });
    mergeRunBranch.mockResolvedValue({ success: true });
    runPrompt.mockResolvedValue({ success: true, output: 'changelog', attempts: 1 });
    buildReportPrompt.mockReturnValue('mock report prompt');
    verifyReportContent.mockReturnValue(true);
    getGitInstance.mockReturnValue({ add: vi.fn(), commit: vi.fn() });
    vi.spyOn(process, 'kill').mockImplementation(() => {});

    await finishRun('/fake/project');

    const progressCalls = writeFileSync.mock.calls.filter(c => c[0].includes('nightytidy-progress.json'));
    expect(progressCalls.length).toBeGreaterThanOrEqual(1);
    const finalProgress = JSON.parse(progressCalls[progressCalls.length - 1][1]);
    expect(finalProgress.status).toBe('completed');

    process.kill.mockRestore();
  });
});

// ── Rate-limit propagation in runStep ────────────────────────────

describe('runStep rate-limit propagation', () => {
  const validState = {
    version: 1,
    originalBranch: 'main',
    runBranch: 'nightytidy/run-2026-03-06-1430',
    tagName: 'nightytidy-before-2026-03-06-1430',
    selectedSteps: [1, 2],
    completedSteps: [],
    failedSteps: [],
    startTime: Date.now(),
    timeout: null,
  };

  beforeEach(() => {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue(JSON.stringify(validState));
  });

  it('includes errorType and retryAfterMs in response when step is rate-limited', async () => {
    executeSingleStep.mockResolvedValue({
      step: { number: 1, name: 'Documentation' },
      status: 'failed',
      output: '',
      duration: 5000,
      attempts: 1,
      error: 'Rate limit exceeded',
      errorType: 'rate_limit',
      retryAfterMs: 120000,
    });

    const result = await runStep('/fake/project', 1);

    expect(result.success).toBe(true);
    expect(result.status).toBe('failed');
    expect(result.errorType).toBe('rate_limit');
    expect(result.retryAfterMs).toBe(120000);
  });

  it('includes null errorType for non-rate-limit failures', async () => {
    executeSingleStep.mockResolvedValue({
      step: { number: 1, name: 'Documentation' },
      status: 'failed',
      output: '',
      duration: 30000,
      attempts: 4,
      error: 'Claude timed out',
    });

    const result = await runStep('/fake/project', 1);

    expect(result.success).toBe(true);
    expect(result.errorType).toBeNull();
    expect(result.retryAfterMs).toBeNull();
  });

  it('stores errorType in state file for rate-limited steps', async () => {
    executeSingleStep.mockResolvedValue({
      step: { number: 1, name: 'Documentation' },
      status: 'failed',
      output: '',
      duration: 5000,
      attempts: 1,
      error: 'Rate limit exceeded',
      errorType: 'rate_limit',
      retryAfterMs: 60000,
    });

    await runStep('/fake/project', 1);

    const stateCall = writeFileSync.mock.calls.find(c => c[0].includes('nightytidy-run-state.json.tmp'));
    const updatedState = JSON.parse(stateCall[1]);
    expect(updatedState.failedSteps[0].errorType).toBe('rate_limit');
    expect(updatedState.failedSteps[0].retryAfterMs).toBe(60000);
  });

  it('includes errorType in completed step entries (null for success)', async () => {
    executeSingleStep.mockResolvedValue({
      step: { number: 1, name: 'Documentation' },
      status: 'completed',
      output: 'done',
      duration: 120000,
      attempts: 1,
      error: null,
    });

    const result = await runStep('/fake/project', 1);

    expect(result.errorType).toBeNull();
    expect(result.retryAfterMs).toBeNull();
  });
});

// ── 3-tier step recovery in runStep ──────────────────────────────

describe('runStep 3-tier recovery', () => {
  const validState = {
    version: 1,
    originalBranch: 'main',
    runBranch: 'nightytidy/run-2026-03-06-1430',
    tagName: 'nightytidy-before-2026-03-06-1430',
    selectedSteps: [1, 2],
    completedSteps: [],
    failedSteps: [],
    startTime: Date.now(),
    timeout: null,
  };

  const failedResult = (overrides = {}) => ({
    step: { number: 1, name: 'Documentation' },
    status: 'failed',
    output: '',
    duration: 5000,
    attempts: 4,
    error: 'Claude timed out',
    errorType: 'unknown',
    ...overrides,
  });

  const completedResult = (overrides = {}) => ({
    step: { number: 1, name: 'Documentation' },
    status: 'completed',
    output: 'Fixed docs',
    duration: 10000,
    attempts: 1,
    error: null,
    ...overrides,
  });

  beforeEach(() => {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue(JSON.stringify(validState));
  });

  it('Tier 2 (prod) is attempted before fresh retry with continueSession', async () => {
    executeSingleStep
      .mockResolvedValueOnce(failedResult())
      .mockResolvedValueOnce(completedResult());

    const result = await runStep('/fake/project', 1);

    expect(result.success).toBe(true);
    expect(result.status).toBe('completed');
    expect(executeSingleStep).toHaveBeenCalledTimes(2);

    // Second call (prod) should have continueSession and promptOverride
    const prodCall = executeSingleStep.mock.calls[1][2];
    expect(prodCall.continueSession).toBe(true);
    expect(prodCall.promptOverride).toContain('MOCK_PROD');
    expect(prodCall.promptOverride).toContain('MOCK_PREAMBLE');
  });

  it('all 3 tiers execute when first two fail — Tier 3 has no continueSession', async () => {
    executeSingleStep
      .mockResolvedValueOnce(failedResult())                    // Tier 1
      .mockResolvedValueOnce(failedResult({ attempts: 3 }))     // Tier 2 prod
      .mockResolvedValueOnce(completedResult());                 // Tier 3 fresh

    const result = await runStep('/fake/project', 1);

    expect(result.success).toBe(true);
    expect(result.status).toBe('completed');
    expect(executeSingleStep).toHaveBeenCalledTimes(3);

    // Tier 3 (fresh retry) should NOT have continueSession or promptOverride
    const freshCall = executeSingleStep.mock.calls[2][2];
    expect(freshCall.continueSession).toBeUndefined();
    expect(freshCall.promptOverride).toBeUndefined();
  });

  it('does NOT attempt recovery on rate-limit failure', async () => {
    executeSingleStep.mockResolvedValue(failedResult({
      errorType: 'rate_limit',
      retryAfterMs: 120000,
      error: 'Rate limit exceeded',
    }));

    const result = await runStep('/fake/project', 1);

    expect(result.success).toBe(true);
    expect(result.status).toBe('failed');
    expect(result.errorType).toBe('rate_limit');
    expect(executeSingleStep).toHaveBeenCalledTimes(1);
  });

  it('skips Tier 3 if Tier 2 hits rate limit', async () => {
    executeSingleStep
      .mockResolvedValueOnce(failedResult())
      .mockResolvedValueOnce(failedResult({
        errorType: 'rate_limit',
        retryAfterMs: 60000,
        error: 'Rate limit exceeded',
      }));

    const result = await runStep('/fake/project', 1);

    expect(result.success).toBe(true);
    expect(result.status).toBe('failed');
    expect(executeSingleStep).toHaveBeenCalledTimes(2);
  });

  it('combines costs across all 3 tiers', async () => {
    executeSingleStep
      .mockResolvedValueOnce(failedResult({
        cost: { input: 100, output: 50, cacheRead: 10, cacheCreate: 5, total: 165 },
      }))
      .mockResolvedValueOnce(failedResult({
        cost: { input: 200, output: 100, cacheRead: 20, cacheCreate: 10, total: 330 },
      }))
      .mockResolvedValueOnce(completedResult({
        cost: { input: 300, output: 150, cacheRead: 30, cacheCreate: 15, total: 495 },
      }));

    await runStep('/fake/project', 1);

    // sumCosts called twice: Tier1+Tier2, then combined+Tier3
    expect(sumCosts).toHaveBeenCalledTimes(2);
  });

  it('combines attempts across all 3 tiers', async () => {
    executeSingleStep
      .mockResolvedValueOnce(failedResult({ attempts: 4 }))
      .mockResolvedValueOnce(failedResult({ attempts: 3 }))
      .mockResolvedValueOnce(completedResult({ attempts: 2 }));

    await runStep('/fake/project', 1);

    const stateCall = writeFileSync.mock.calls.find(c => c[0].includes('nightytidy-run-state.json.tmp'));
    const updatedState = JSON.parse(stateCall[1]);
    expect(updatedState.completedSteps[0].attempts).toBe(9); // 4 + 3 + 2
  });

  it('writes prodding flag before Tier 2 and retrying flag before Tier 3', async () => {
    executeSingleStep
      .mockResolvedValueOnce(failedResult())
      .mockResolvedValueOnce(failedResult())
      .mockResolvedValueOnce(completedResult());

    await runStep('/fake/project', 1);

    const progressWrites = writeFileSync.mock.calls.filter(c => c[0].includes('nightytidy-progress.json'));

    // Should find a write with prodding: true
    const proddingWrite = progressWrites.find(c => {
      const data = JSON.parse(c[1]);
      return data.prodding === true;
    });
    expect(proddingWrite).toBeDefined();
    const prodProgress = JSON.parse(proddingWrite[1]);
    expect(prodProgress.retrying).toBe(false);
    expect(prodProgress.currentStepOutput).toBe('');

    // Should find a write with retrying: true
    const retryingWrite = progressWrites.find(c => {
      const data = JSON.parse(c[1]);
      return data.retrying === true && data.prodding === false;
    });
    expect(retryingWrite).toBeDefined();
  });

  it('records as failed when all 3 tiers fail', async () => {
    executeSingleStep.mockResolvedValue(failedResult({ attempts: 4 }));

    const result = await runStep('/fake/project', 1);

    expect(result.success).toBe(true);
    expect(result.status).toBe('failed');
    expect(executeSingleStep).toHaveBeenCalledTimes(3);

    const stateCall = writeFileSync.mock.calls.find(c => c[0].includes('nightytidy-run-state.json.tmp'));
    const updatedState = JSON.parse(stateCall[1]);
    expect(updatedState.failedSteps).toHaveLength(1);
    expect(updatedState.failedSteps[0].attempts).toBe(12); // 4 + 4 + 4
  });
});

describe('runStep branch guard', () => {
  const guardState = {
    version: 1,
    originalBranch: 'main',
    runBranch: 'nightytidy/run-2026-03-06-1430',
    tagName: 'nightytidy-before-2026-03-06-1430',
    selectedSteps: [1, 2, 3],
    completedSteps: [],
    failedSteps: [],
    startTime: Date.now(),
    timeout: null,
  };

  beforeEach(() => {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue(JSON.stringify(guardState));
    vi.mocked(executeSingleStep).mockResolvedValue({
      step: { number: 1, name: 'Documentation' },
      status: 'completed', output: 'done', duration: 1000, attempts: 1, error: null,
    });
  });

  it('calls ensureOnBranch before and after step execution', async () => {
    await runStep('/fake/project', 1);

    // Should be called at least twice: once before step, once after
    expect(ensureOnBranch).toHaveBeenCalledWith('nightytidy/run-2026-03-06-1430');
    expect(ensureOnBranch.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('continues successfully when ensureOnBranch reports recovery', async () => {
    vi.mocked(ensureOnBranch).mockResolvedValue({
      recovered: true, strayBranch: 'stray-branch', mergeOk: true,
    });

    const result = await runStep('/fake/project', 1);

    expect(result.success).toBe(true);
    expect(result.status).toBe('completed');
  });

  it('continues when ensureOnBranch merge fails (work preserved on stray branch)', async () => {
    vi.mocked(ensureOnBranch).mockResolvedValue({
      recovered: true, strayBranch: 'stray-branch', mergeOk: false,
    });

    const result = await runStep('/fake/project', 1);

    expect(result.success).toBe(true);
    expect(result.status).toBe('completed');
  });

  it('calls ensureOnBranch between recovery tiers (Tier 1 fail → guard → Tier 2 → guard → Tier 3)', async () => {
    // Tier 1 fails, Tier 2 fails, Tier 3 succeeds
    vi.mocked(executeSingleStep)
      .mockResolvedValueOnce({
        step: { number: 1, name: 'Documentation' },
        status: 'failed', output: '', duration: 1000, attempts: 4, error: 'timeout',
        errorType: 'unknown',
      })
      .mockResolvedValueOnce({
        step: { number: 1, name: 'Documentation' },
        status: 'failed', output: '', duration: 1000, attempts: 4, error: 'timeout',
        errorType: 'unknown',
      })
      .mockResolvedValueOnce({
        step: { number: 1, name: 'Documentation' },
        status: 'completed', output: 'done', duration: 1000, attempts: 1, error: null,
      });

    await runStep('/fake/project', 1);

    // Pre-step (1) + post-Tier2 (1) + post-Tier3 (1) + final (1) = at least 4 calls
    expect(ensureOnBranch.mock.calls.length).toBeGreaterThanOrEqual(4);
    // All calls should be for the run branch
    for (const call of ensureOnBranch.mock.calls) {
      expect(call[0]).toBe('nightytidy/run-2026-03-06-1430');
    }
  });
});
