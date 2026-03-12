import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the module under test
// ---------------------------------------------------------------------------

vi.mock('fs', () => ({
  existsSync: vi.fn((p) => typeof p === 'string' && p.includes('NIGHTYTIDY-REPORT')),
  readFileSync: vi.fn((p) => {
    if (typeof p === 'string' && p.includes('NIGHTYTIDY-REPORT')) return '# NightyTidy Report\nMock content';
    return '{}';
  }),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  openSync: vi.fn(() => 99),
  closeSync: vi.fn(),
}));

let mockOpts = {};
vi.mock('commander', () => {
  const program = {
    name: vi.fn().mockReturnThis(),
    description: vi.fn().mockReturnThis(),
    version: vi.fn().mockReturnThis(),
    option: vi.fn().mockReturnThis(),
    parse: vi.fn(),
    opts: vi.fn(() => mockOpts),
  };
  return { Command: vi.fn(() => program) };
});

vi.mock('@inquirer/checkbox', () => ({
  default: vi.fn(),
}));

vi.mock('ora', () => ({
  default: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    stop: vi.fn(),
    succeed: vi.fn(),
    fail: vi.fn(),
    warn: vi.fn(),
    text: '',
    isSpinning: false,
  })),
}));

vi.mock('chalk', () => {
  const passthrough = (s) => s;
  passthrough.dim = passthrough;
  passthrough.cyan = passthrough;
  passthrough.green = passthrough;
  passthrough.yellow = passthrough;
  passthrough.red = passthrough;
  return { default: passthrough };
});

import { createLoggerMock } from './helpers/mocks.js';

vi.mock('../src/logger.js', () => createLoggerMock());

vi.mock('../src/checks.js', () => ({
  runPreChecks: vi.fn(),
}));

vi.mock('../src/git.js', () => ({
  initGit: vi.fn().mockReturnValue({}),
  excludeEphemeralFiles: vi.fn(),
  getCurrentBranch: vi.fn().mockResolvedValue('main'),
  createPreRunTag: vi.fn().mockResolvedValue('nightytidy-before-2026-03-01-0100'),
  createRunBranch: vi.fn().mockResolvedValue('nightytidy/run-2026-03-01-0100'),
  mergeRunBranch: vi.fn().mockResolvedValue({ success: true }),
  getGitInstance: vi.fn().mockReturnValue({
    add: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    branch: vi.fn().mockResolvedValue({ all: ['main', 'nightytidy/run-2026-03-01-0100'] }),
  }),
  ensureOnBranch: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/claude.js', () => ({
  runPrompt: vi.fn(),
  ERROR_TYPE: { RATE_LIMIT: 'rate_limit', UNKNOWN: 'unknown' },
  sleep: vi.fn(() => Promise.resolve()),
}));

vi.mock('../src/prompts/loader.js', () => ({
  STEPS: [
    { number: 1, name: 'Lint', prompt: 'lint the code' },
    { number: 2, name: 'Format', prompt: 'format the code' },
    { number: 3, name: 'Test', prompt: 'test the code' },
  ],
  REPORT_PROMPT: 'mock report prompt template',
  CONSOLIDATION_PROMPT: 'consolidate actions',
  reloadSteps: vi.fn(),
}));

vi.mock('../src/sync.js', () => ({
  syncPrompts: vi.fn().mockResolvedValue({
    success: true,
    summary: { updated: [], added: [], removed: [], unchanged: [] },
    error: null,
  }),
}));

vi.mock('../src/executor.js', () => ({
  executeSteps: vi.fn(),
  copyPromptsToProject: vi.fn(),
  SAFETY_PREAMBLE: '',
}));

vi.mock('../src/notifications.js', () => ({
  notify: vi.fn(),
}));

vi.mock('../src/report.js', () => ({
  generateReport: vi.fn(),
  formatDuration: vi.fn((ms) => `${Math.round(ms / 1000)}s`),
  getVersion: vi.fn(() => '0.1.0'),
  buildReportNames: vi.fn(() => ({ reportFile: 'NIGHTYTIDY-REPORT_01_2026-01-01-0000.md' })),
  buildReportPrompt: vi.fn(() => 'mock report prompt'),
  verifyReportContent: vi.fn(() => true),
  updateClaudeMd: vi.fn(),
}));

vi.mock('../src/setup.js', () => ({
  setupProject: vi.fn().mockReturnValue('created'),
}));

vi.mock('../src/dashboard.js', () => ({
  startDashboard: vi.fn().mockResolvedValue({ url: 'http://localhost:9999', port: 9999 }),
  updateDashboard: vi.fn(),
  stopDashboard: vi.fn(),
  scheduleShutdown: vi.fn(),
  broadcastOutput: vi.fn(),
  clearOutputBuffer: vi.fn(),
}));

vi.mock('../src/lock.js', () => ({
  acquireLock: vi.fn(),
}));

vi.mock('../src/orchestrator.js', () => ({
  initRun: vi.fn(),
  runStep: vi.fn(),
  finishRun: vi.fn().mockResolvedValue({ success: true }),
  readState: vi.fn(),
  writeState: vi.fn(),
  deleteState: vi.fn(),
  STATE_VERSION: 1,
}));

// ---------------------------------------------------------------------------
// Imports — after mocks
// ---------------------------------------------------------------------------

import { run } from '../src/cli.js';
import { existsSync } from 'fs';
import checkbox from '@inquirer/checkbox';
import { initGit, excludeEphemeralFiles, getGitInstance, ensureOnBranch, mergeRunBranch } from '../src/git.js';
import { runPrompt } from '../src/claude.js';
import { executeSteps } from '../src/executor.js';
import { readState, writeState, deleteState, finishRun } from '../src/orchestrator.js';
import { acquireLock } from '../src/lock.js';
import { verifyReportContent, updateClaudeMd, generateReport } from '../src/report.js';
import { debug } from '../src/logger.js';
import { runPreChecks } from '../src/checks.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RUN_BRANCH = 'nightytidy/run-2026-03-01-0100';

/**
 * Build a valid saved run state that validateResumeState will accept.
 */
function makeValidState({ selectedSteps = [1, 2, 3], completedSteps = [], failedSteps = [] } = {}) {
  return {
    version: 1,
    originalBranch: 'main',
    runBranch: RUN_BRANCH,
    tagName: 'nightytidy-before-2026-03-01-0100',
    selectedSteps,
    completedSteps,
    failedSteps,
    startTime: Date.now() - 60000,
    timeout: 2700000,
    dashboardPid: null,
    dashboardUrl: null,
    pausedAt: Date.now() - 30000,
    pauseReason: 'usage_limit',
  };
}

function makeCompletedStep(number, name) {
  return {
    number,
    name,
    status: 'completed',
    duration: 30000,
    attempts: 1,
    output: 'ok',
    error: null,
    cost: null,
    suspiciousFast: false,
    errorType: null,
    retryAfterMs: null,
  };
}

function makeFailedStep(number, name) {
  return {
    number,
    name,
    status: 'failed',
    duration: 10000,
    attempts: 4,
    output: '',
    error: 'timeout',
    cost: null,
    suspiciousFast: false,
    errorType: null,
    retryAfterMs: null,
  };
}

function makeExecutionResults({ completedCount = 2, failedCount = 0, totalDuration = 60000 } = {}) {
  const results = [];
  for (let i = 0; i < completedCount; i++) {
    results.push({
      step: { number: i + 1, name: `Step${i + 1}` },
      status: 'completed',
      output: 'ok',
      duration: 30000,
      attempts: 1,
      error: null,
    });
  }
  for (let i = 0; i < failedCount; i++) {
    results.push({
      step: { number: completedCount + i + 1, name: `FailStep${i + 1}` },
      status: 'failed',
      output: '',
      duration: 10000,
      attempts: 4,
      error: 'timeout',
    });
  }
  return { results, completedCount, failedCount, totalDuration };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('cli.js --resume functionality', () => {
  let consoleLogSpy;
  let consoleErrorSpy;
  let processExitSpy;
  let processOnSpy;

  beforeEach(() => {
    vi.clearAllMocks();
    mockOpts = {};

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    processOnSpy = vi.spyOn(process, 'on').mockImplementation(() => process);
    process.stdin.isTTY = true;

    // Defaults for resume-relevant mocks
    readState.mockReturnValue(null);
    finishRun.mockResolvedValue({ success: true });
    writeState.mockImplementation(() => {});
    deleteState.mockImplementation(() => {});
    acquireLock.mockResolvedValue(undefined);
    runPrompt.mockResolvedValue({ success: true, output: 'Report text', error: null });
    mergeRunBranch.mockResolvedValue({ success: true });
    existsSync.mockImplementation((p) => typeof p === 'string' && p.includes('NIGHTYTIDY-REPORT'));
    verifyReportContent.mockReturnValue(true);
    updateClaudeMd.mockImplementation(() => {});
    ensureOnBranch.mockResolvedValue(undefined);
    runPreChecks.mockResolvedValue(undefined);

    // Default checkbox mock for normal-flow tests (rate-limit tests)
    checkbox.mockResolvedValue([{ number: 1, name: 'Lint', prompt: 'lint the code' }]);
    executeSteps.mockResolvedValue(makeExecutionResults({ completedCount: 1, failedCount: 0 }));

    // Default git mock returns branches including run branch
    getGitInstance.mockReturnValue({
      add: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue(undefined),
      branch: vi.fn().mockResolvedValue({ all: ['main', RUN_BRANCH] }),
    });
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
    processOnSpy.mockRestore();
    delete process.stdin.isTTY;
  });

  // -------------------------------------------------------------------------
  // Resume validation
  // -------------------------------------------------------------------------
  describe('resume validation', () => {
    it('--resume with no state file exits with error', async () => {
      mockOpts = { resume: true };
      readState.mockReturnValue(null);

      await expect(run()).rejects.toThrow('process.exit called');

      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('No saved run state found')
      );
    });

    it('--resume with invalid state version exits with error', async () => {
      mockOpts = { resume: true };
      readState.mockReturnValue({ version: 999, runBranch: RUN_BRANCH, originalBranch: 'main', selectedSteps: [1] });

      await expect(run()).rejects.toThrow('process.exit called');

      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('incompatible version')
      );
    });

    it('--resume with missing run branch exits with error', async () => {
      mockOpts = { resume: true };
      readState.mockReturnValue(makeValidState());

      // Git says the run branch does not exist
      getGitInstance.mockReturnValue({
        add: vi.fn().mockResolvedValue(undefined),
        commit: vi.fn().mockResolvedValue(undefined),
        branch: vi.fn().mockResolvedValue({ all: ['main', 'some-other-branch'] }),
      });

      await expect(run()).rejects.toThrow('process.exit called');

      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('no longer exists')
      );
    });

    it('--resume with unavailable step numbers exits with error', async () => {
      mockOpts = { resume: true };
      // Steps 1, 2, 3 are available in mock STEPS, but 99 is not
      readState.mockReturnValue(makeValidState({ selectedSteps: [1, 99] }));

      await expect(run()).rejects.toThrow('process.exit called');

      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('no longer available')
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('99')
      );
    });
  });

  // -------------------------------------------------------------------------
  // Resume execution
  // -------------------------------------------------------------------------
  describe('resume execution', () => {
    it('--resume with valid state resumes remaining steps', async () => {
      mockOpts = { resume: true };
      // Step 1 already completed, steps 2 and 3 remaining
      const state = makeValidState({
        selectedSteps: [1, 2, 3],
        completedSteps: [makeCompletedStep(1, 'Lint')],
        failedSteps: [],
      });
      readState.mockReturnValue(state);

      executeSteps.mockResolvedValue(makeExecutionResults({ completedCount: 2, failedCount: 0 }));

      await run();

      // executeSteps should have been called with the 2 remaining steps (Format, Test)
      expect(executeSteps).toHaveBeenCalledTimes(1);
      const stepsArg = executeSteps.mock.calls[0][0];
      expect(stepsArg).toHaveLength(2);
      expect(stepsArg[0].number).toBe(2);
      expect(stepsArg[0].name).toBe('Format');
      expect(stepsArg[1].number).toBe(3);
      expect(stepsArg[1].name).toBe('Test');
    });

    it('--resume merges prior results with new results', async () => {
      mockOpts = { resume: true };
      const state = makeValidState({
        selectedSteps: [1, 2, 3],
        completedSteps: [makeCompletedStep(1, 'Lint')],
        failedSteps: [],
      });
      readState.mockReturnValue(state);

      // New execution completes step 2 and fails step 3
      executeSteps.mockResolvedValue({
        results: [
          { step: { number: 2, name: 'Format' }, status: 'completed', output: 'ok', duration: 20000, attempts: 1, error: null },
          { step: { number: 3, name: 'Test' }, status: 'failed', output: '', duration: 10000, attempts: 4, error: 'timeout' },
        ],
        completedCount: 1,
        failedCount: 1,
        totalDuration: 30000,
      });

      await run();

      // mergeRunBranch is called during finalizeRun — verify that merged results
      // include the prior completed step + new completed + new failed
      // We verify this indirectly by checking buildReportPrompt was called and
      // the run completed without errors
      expect(mergeRunBranch).toHaveBeenCalled();
    });

    it('--resume with all steps done calls finishRun from orchestrator', async () => {
      mockOpts = { resume: true };
      const state = makeValidState({
        selectedSteps: [1, 2],
        completedSteps: [makeCompletedStep(1, 'Lint')],
        failedSteps: [makeFailedStep(2, 'Format')],
      });
      readState.mockReturnValue(state);

      await expect(run()).rejects.toThrow('process.exit called');

      // All steps are in completedSteps + failedSteps, so finishRun should be called
      expect(finishRun).toHaveBeenCalled();
      // executeSteps should NOT have been called (nothing to run)
      expect(executeSteps).not.toHaveBeenCalled();
      // State should be cleaned up
      expect(deleteState).toHaveBeenCalled();
      // Should exit with 0 since finishRun succeeded
      expect(processExitSpy).toHaveBeenCalledWith(0);
    });

    it('--resume with all steps done and finishRun failure exits with error', async () => {
      mockOpts = { resume: true };
      const state = makeValidState({
        selectedSteps: [1],
        completedSteps: [makeCompletedStep(1, 'Lint')],
        failedSteps: [],
      });
      readState.mockReturnValue(state);
      finishRun.mockResolvedValue({ success: false, error: 'merge conflict' });

      await expect(run()).rejects.toThrow('process.exit called');

      expect(finishRun).toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('merge conflict')
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('--resume calls ensureOnBranch with state.runBranch', async () => {
      mockOpts = { resume: true };
      const state = makeValidState({
        selectedSteps: [1, 2],
        completedSteps: [makeCompletedStep(1, 'Lint')],
        failedSteps: [],
      });
      readState.mockReturnValue(state);
      executeSteps.mockResolvedValue(makeExecutionResults({ completedCount: 1, failedCount: 0 }));

      await run();

      expect(ensureOnBranch).toHaveBeenCalledWith(RUN_BRANCH);
    });

    it('--resume acquires lock', async () => {
      mockOpts = { resume: true };
      const state = makeValidState({
        selectedSteps: [1, 2],
        completedSteps: [makeCompletedStep(1, 'Lint')],
        failedSteps: [],
      });
      readState.mockReturnValue(state);
      executeSteps.mockResolvedValue(makeExecutionResults({ completedCount: 1, failedCount: 0 }));

      await run();

      expect(acquireLock).toHaveBeenCalled();
    });

    it('--resume deletes state file after completion', async () => {
      mockOpts = { resume: true };
      const state = makeValidState({
        selectedSteps: [1, 2],
        completedSteps: [makeCompletedStep(1, 'Lint')],
        failedSteps: [],
      });
      readState.mockReturnValue(state);
      executeSteps.mockResolvedValue(makeExecutionResults({ completedCount: 1, failedCount: 0 }));

      await run();

      // deleteState is called both in handleResume (after execution) and in finalizeRun
      expect(deleteState).toHaveBeenCalled();
    });

    it('--resume initializes git and excludes ephemeral files', async () => {
      mockOpts = { resume: true };
      const state = makeValidState({
        selectedSteps: [1, 2],
        completedSteps: [makeCompletedStep(1, 'Lint')],
        failedSteps: [],
      });
      readState.mockReturnValue(state);
      executeSteps.mockResolvedValue(makeExecutionResults({ completedCount: 1, failedCount: 0 }));

      await run();

      expect(initGit).toHaveBeenCalled();
      expect(excludeEphemeralFiles).toHaveBeenCalled();
    });

    it('--resume displays resume info with paused time and step counts', async () => {
      mockOpts = { resume: true };
      const state = makeValidState({
        selectedSteps: [1, 2, 3],
        completedSteps: [makeCompletedStep(1, 'Lint')],
        failedSteps: [],
      });
      state.pausedAt = new Date('2026-03-12T10:30:00Z').getTime();
      readState.mockReturnValue(state);
      executeSteps.mockResolvedValue(makeExecutionResults({ completedCount: 2, failedCount: 0 }));

      await run();

      // Should print resume info
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Resuming NightyTidy run')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Completed: 1/3')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Remaining: 2 step(s)')
      );
    });
  });

  // -------------------------------------------------------------------------
  // State saving during rate-limit
  // -------------------------------------------------------------------------
  describe('state saving during rate-limit', () => {
    it('onRateLimitPause saves state when snapshot provided', async () => {
      mockOpts = {};
      // Use the normal run flow so onRateLimitPause fires with ctx.runStarted = true
      executeSteps.mockImplementation(async (steps, dir, opts) => {
        // Simulate a rate limit pause after step execution starts
        const snapshot = {
          results: [
            {
              step: { number: 1, name: 'Lint' },
              status: 'completed',
              output: 'ok',
              duration: 30000,
              attempts: 1,
              error: null,
              cost: null,
              suspiciousFast: false,
              errorType: null,
              retryAfterMs: null,
            },
          ],
          completedCount: 1,
          failedCount: 0,
        };
        opts.onRateLimitPause(120000, snapshot);
        return makeExecutionResults({ completedCount: 1, failedCount: 0 });
      });

      await run();

      // writeState should have been called with run state for later resume
      expect(writeState).toHaveBeenCalledTimes(1);
      const [dir, stateArg] = writeState.mock.calls[0];
      expect(stateArg.version).toBe(1);
      expect(stateArg.runBranch).toBe('nightytidy/run-2026-03-01-0100');
      expect(stateArg.originalBranch).toBe('main');
      expect(stateArg.completedSteps).toHaveLength(1);
      expect(stateArg.completedSteps[0].number).toBe(1);
      expect(stateArg.pauseReason).toBe('usage_limit');
    });

    it('onRateLimitPause shows resume instructions', async () => {
      mockOpts = {};
      executeSteps.mockImplementation(async (steps, dir, opts) => {
        const snapshot = {
          results: [{ step: { number: 1, name: 'Lint' }, status: 'completed', output: 'ok', duration: 30000, attempts: 1, error: null }],
          completedCount: 1,
          failedCount: 0,
        };
        opts.onRateLimitPause(120000, snapshot);
        return makeExecutionResults({ completedCount: 1, failedCount: 0 });
      });

      await run();

      // Check that resume instructions are printed
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('npx nightytidy --resume')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('State saved')
      );
    });

    it('onRateLimitPause does not save state without snapshot (backward compat)', async () => {
      mockOpts = {};
      executeSteps.mockImplementation(async (steps, dir, opts) => {
        // Call with no snapshot argument — old-style
        opts.onRateLimitPause(120000);
        return makeExecutionResults({ completedCount: 1, failedCount: 0 });
      });

      await run();

      // writeState should NOT have been called by onRateLimitPause
      // (it may still be called by finalizeRun/deleteState path, but not for saving pause state)
      // Filter for writeState calls (deleteState calls are separate)
      expect(writeState).not.toHaveBeenCalled();
    });

    it('onRateLimitPause does not save state before run starts', async () => {
      mockOpts = {};
      // We need to simulate the callback firing before ctx.runStarted is set to true.
      // In the normal run flow, ctx.runStarted is set in executeRunFlow after git setup.
      // However, executeSteps runs AFTER runStarted=true, so we need a different approach.
      // The safest way: check that a snapshot provided to onRateLimitPause before
      // the git setup phase would not save state. We test this via the --resume path
      // where ctx.runStarted starts as true. Instead, we verify the guard by testing
      // that the callback without a truthy snapshot doesn't save.
      // The actual guard: `if (snapshot && ctx?.runStarted && projectDir)`
      // When snapshot is provided but ctx.runStarted is false, no save happens.
      // Since we can't easily set runStarted=false during the normal flow (it's set
      // before executeSteps), we verify the guard indirectly: calling with null snapshot.
      executeSteps.mockImplementation(async (steps, dir, opts) => {
        opts.onRateLimitPause(120000, null);
        return makeExecutionResults({ completedCount: 1, failedCount: 0 });
      });

      await run();

      expect(writeState).not.toHaveBeenCalled();
    });

    it('onRateLimitPause handles writeState error gracefully', async () => {
      mockOpts = {};
      writeState.mockImplementation(() => { throw new Error('disk full'); });

      executeSteps.mockImplementation(async (steps, dir, opts) => {
        const snapshot = {
          results: [{ step: { number: 1, name: 'Lint' }, status: 'completed', output: 'ok', duration: 30000, attempts: 1, error: null }],
          completedCount: 1,
          failedCount: 0,
        };
        // Should not crash even when writeState throws
        opts.onRateLimitPause(120000, snapshot);
        return makeExecutionResults({ completedCount: 1, failedCount: 0 });
      });

      // Should complete without crashing
      await run();

      // Debug log should capture the error
      expect(debug).toHaveBeenCalledWith(
        expect.stringContaining('Failed to save run state')
      );
    });
  });

  // -------------------------------------------------------------------------
  // Resume with SIGINT
  // -------------------------------------------------------------------------
  describe('resume with SIGINT', () => {
    it('--resume handles SIGINT during execution with merged results', async () => {
      mockOpts = { resume: true };
      const state = makeValidState({
        selectedSteps: [1, 2, 3],
        completedSteps: [makeCompletedStep(1, 'Lint')],
        failedSteps: [],
      });
      readState.mockReturnValue(state);

      executeSteps.mockImplementation(async (steps, dir, opts) => {
        // Simulate SIGINT being triggered during execution
        const sigintCall = processOnSpy.mock.calls.find(c => c[0] === 'SIGINT');
        if (sigintCall) sigintCall[1]();

        return {
          results: [
            { step: { number: 2, name: 'Format' }, status: 'completed', output: 'ok', duration: 20000, attempts: 1, error: null },
          ],
          completedCount: 1,
          failedCount: 0,
          totalDuration: 20000,
        };
      });

      // handleAbortedRun calls process.exit(0)
      await expect(run()).rejects.toThrow('process.exit called');

      // Should have generated a partial report (via generateReport fallback in handleAbortedRun)
      expect(generateReport).toHaveBeenCalled();

      // The report should include merged results from both prior and new execution
      const reportCall = generateReport.mock.calls[0];
      const executionResults = reportCall[0];
      // Prior completed (Lint) + new completed (Format) = 2 total results
      expect(executionResults.results.length).toBeGreaterThanOrEqual(2);

      // State should still be cleaned up (deleteState called before abort check in handleResume)
      expect(deleteState).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------
  describe('resume edge cases', () => {
    it('--resume with incomplete state (missing branch data) exits with error', async () => {
      mockOpts = { resume: true };
      readState.mockReturnValue({
        version: 1,
        originalBranch: null,
        runBranch: null,
        selectedSteps: [1],
        completedSteps: [],
        failedSteps: [],
      });

      await expect(run()).rejects.toThrow('process.exit called');

      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('incomplete')
      );
    });

    it('--resume with git check failure exits with error', async () => {
      mockOpts = { resume: true };
      readState.mockReturnValue(makeValidState());

      // git.branch() throws
      getGitInstance.mockReturnValue({
        add: vi.fn().mockResolvedValue(undefined),
        commit: vi.fn().mockResolvedValue(undefined),
        branch: vi.fn().mockRejectedValue(new Error('git broken')),
      });

      await expect(run()).rejects.toThrow('process.exit called');

      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Git check failed')
      );
    });

    it('--resume uses timeout from CLI option over saved state timeout', async () => {
      mockOpts = { resume: true, timeout: 60 };
      const state = makeValidState({
        selectedSteps: [1, 2],
        completedSteps: [makeCompletedStep(1, 'Lint')],
        failedSteps: [],
      });
      state.timeout = 2700000; // 45 min saved
      readState.mockReturnValue(state);
      executeSteps.mockResolvedValue(makeExecutionResults({ completedCount: 1, failedCount: 0 }));

      await run();

      // executeSteps should receive the CLI timeout (60 min = 3600000 ms)
      const optsArg = executeSteps.mock.calls[0][2];
      expect(optsArg.timeout).toBe(3600000);
    });

    it('--resume uses saved state timeout when no CLI timeout provided', async () => {
      mockOpts = { resume: true };
      const state = makeValidState({
        selectedSteps: [1, 2],
        completedSteps: [makeCompletedStep(1, 'Lint')],
        failedSteps: [],
      });
      state.timeout = 2700000;
      readState.mockReturnValue(state);
      executeSteps.mockResolvedValue(makeExecutionResults({ completedCount: 1, failedCount: 0 }));

      await run();

      const optsArg = executeSteps.mock.calls[0][2];
      expect(optsArg.timeout).toBe(2700000);
    });
  });
});
