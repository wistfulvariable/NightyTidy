import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
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

vi.mock('../src/logger.js', () => ({
  initLogger: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

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
}));

vi.mock('../src/claude.js', () => ({
  runPrompt: vi.fn(),
}));

vi.mock('../src/executor.js', () => ({
  executeSingleStep: vi.fn(),
  SAFETY_PREAMBLE: 'MOCK_PREAMBLE\n',
}));

vi.mock('../src/notifications.js', () => ({
  notify: vi.fn(),
}));

vi.mock('../src/report.js', () => ({
  generateReport: vi.fn(),
  formatDuration: vi.fn((ms) => `${Math.floor(ms / 60000)}m`),
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
  CHANGELOG_PROMPT: 'Generate changelog',
}));

import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { initRun, runStep, finishRun } from '../src/orchestrator.js';
import { initLogger } from '../src/logger.js';
import { runPreChecks } from '../src/checks.js';
import { getCurrentBranch, createPreRunTag, createRunBranch, mergeRunBranch, getGitInstance } from '../src/git.js';
import { executeSingleStep } from '../src/executor.js';
import { runPrompt } from '../src/claude.js';
import { acquireLock, releaseLock } from '../src/lock.js';
import { generateReport } from '../src/report.js';

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
    getCurrentBranch.mockResolvedValue('main');
    createPreRunTag.mockResolvedValue('nightytidy-before-2026-03-06-1430');
    createRunBranch.mockResolvedValue('nightytidy/run-2026-03-06-1430');
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
    const stateCall = writeFileSync.mock.calls.find(c => c[0].includes('nightytidy-run-state.json'));
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

    const stateCall = writeFileSync.mock.calls.find(c => c[0].includes('nightytidy-run-state.json'));
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

    const stateCall = writeFileSync.mock.calls.find(c => c[0].includes('nightytidy-run-state.json'));
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

  it('fails when step has already been attempted and failed', async () => {
    const stateWithFailed = {
      ...validState,
      failedSteps: [{ number: 1, name: 'Documentation', status: 'failed', duration: 30000, attempts: 4 }],
    };
    readFileSync.mockReturnValue(JSON.stringify(stateWithFailed));

    const result = await runStep('/fake/project', 1);

    expect(result.success).toBe(false);
    expect(result.error).toContain('already been attempted');
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
    readFileSync.mockReturnValue(JSON.stringify(validState));
    mergeRunBranch.mockResolvedValue({ success: true });
    runPrompt.mockResolvedValue({ success: true, output: 'Changes made...', attempts: 1 });
    getGitInstance.mockReturnValue({ add: vi.fn(), commit: vi.fn() });
  });

  it('generates report and merges successfully', async () => {
    const result = await finishRun('/fake/project');

    expect(result.success).toBe(true);
    expect(result.completed).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.merged).toBe(true);
    expect(result.reportPath).toBe('NIGHTYTIDY-REPORT.md');
  });

  it('calls generateReport with accumulated results', async () => {
    await finishRun('/fake/project');

    expect(generateReport).toHaveBeenCalledOnce();
    const [results, narration, metadata] = generateReport.mock.calls[0];
    expect(results.completedCount).toBe(1);
    expect(results.failedCount).toBe(1);
    expect(results.results).toHaveLength(2);
    expect(metadata.branchName).toBe('nightytidy/run-2026-03-06-1430');
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
    readFileSync.mockReturnValue(JSON.stringify(emptyState));

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

  it('skips changelog generation when no steps completed', async () => {
    const emptyState = {
      ...validState,
      completedSteps: [],
      failedSteps: [],
    };
    readFileSync.mockReturnValue(JSON.stringify(emptyState));

    await finishRun('/fake/project');

    expect(runPrompt).not.toHaveBeenCalled();
  });

  it('uses fallback narration when changelog fails', async () => {
    runPrompt.mockResolvedValue({ success: false, output: '', attempts: 4 });

    await finishRun('/fake/project');

    const [, narration] = generateReport.mock.calls[0];
    expect(narration).toBeNull();
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
    readFileSync.mockReturnValue(JSON.stringify(stateNoDash));

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
    const stateCalls = writeFileSync.mock.calls.filter(c => c[0].includes('nightytidy-run-state.json'));
    const lastState = JSON.parse(stateCalls[stateCalls.length - 1][1]);
    expect(lastState.dashboardPid).toBe(12345);
    expect(lastState.dashboardUrl).toBe('http://localhost:9999');
  });

  it('initRun writes initial progress JSON', async () => {
    await initRun('/fake/project', { steps: '1,2' });

    const progressCall = writeFileSync.mock.calls.find(c => c[0].includes('nightytidy-progress.json'));
    expect(progressCall).toBeDefined();
    const progress = JSON.parse(progressCall[1]);
    expect(progress.status).toBe('running');
    expect(progress.totalSteps).toBe(2);
    expect(progress.steps).toHaveLength(2);
    expect(progress.steps[0].status).toBe('pending');
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
    readFileSync.mockReturnValue(JSON.stringify(validState));
    mergeRunBranch.mockResolvedValue({ success: true });
    runPrompt.mockResolvedValue({ success: true, output: 'changelog', attempts: 1 });
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
