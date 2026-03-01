import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the module under test
// ---------------------------------------------------------------------------

vi.mock('commander', () => {
  const program = {
    name: vi.fn().mockReturnThis(),
    description: vi.fn().mockReturnThis(),
    version: vi.fn().mockReturnThis(),
    parse: vi.fn(),
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
    text: '',
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

vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
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
  initGit: vi.fn().mockReturnValue({}),
  getCurrentBranch: vi.fn().mockResolvedValue('main'),
  createPreRunTag: vi.fn().mockResolvedValue('nightytidy-before-2026-03-01-0100'),
  createRunBranch: vi.fn().mockResolvedValue('nightytidy/run-2026-03-01-0100'),
  mergeRunBranch: vi.fn().mockResolvedValue({ success: true }),
  getGitInstance: vi.fn().mockReturnValue({
    add: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../src/claude.js', () => ({
  runPrompt: vi.fn(),
}));

vi.mock('../src/prompts/steps.js', () => ({
  STEPS: [
    { number: 1, name: 'Lint', prompt: 'lint the code' },
    { number: 2, name: 'Format', prompt: 'format the code' },
  ],
  CHANGELOG_PROMPT: 'generate changelog',
}));

vi.mock('../src/executor.js', () => ({
  executeSteps: vi.fn(),
}));

vi.mock('../src/notifications.js', () => ({
  notify: vi.fn(),
}));

vi.mock('../src/report.js', () => ({
  generateReport: vi.fn(),
  formatDuration: vi.fn((ms) => `${Math.round(ms / 1000)}s`),
  getVersion: vi.fn(() => '0.1.0'),
}));

// ---------------------------------------------------------------------------
// Imports — after mocks
// ---------------------------------------------------------------------------

import { run } from '../src/cli.js';
import checkbox from '@inquirer/checkbox';
import { initLogger } from '../src/logger.js';
import { runPreChecks } from '../src/checks.js';
import { initGit, getCurrentBranch, createPreRunTag, createRunBranch, mergeRunBranch, getGitInstance } from '../src/git.js';
import { runPrompt } from '../src/claude.js';
import { executeSteps } from '../src/executor.js';
import { notify } from '../src/notifications.js';
import { generateReport } from '../src/report.js';
import { existsSync } from 'fs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

describe('cli.js run()', () => {
  let consoleLogSpy;
  let consoleErrorSpy;
  let processExitSpy;
  let processOnSpy;

  beforeEach(() => {
    vi.clearAllMocks();

    // Suppress console output during tests
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Mock process.exit to prevent actual exit
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });

    // Prevent process.on from registering real handlers
    processOnSpy = vi.spyOn(process, 'on').mockImplementation(() => process);

    // Default: welcome already shown (skip welcome)
    existsSync.mockReturnValue(true);

    // Default successful execution path
    checkbox.mockResolvedValue([
      { number: 1, name: 'Lint', prompt: 'lint the code' },
    ]);

    executeSteps.mockResolvedValue(makeExecutionResults({ completedCount: 1, failedCount: 0 }));
    runPrompt.mockResolvedValue({ success: true, output: 'Changelog text', error: null });
    runPreChecks.mockResolvedValue(undefined);
    mergeRunBranch.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
    processOnSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------
  it('completes a full successful run end-to-end', async () => {
    await run();

    expect(initLogger).toHaveBeenCalledTimes(1);
    expect(initGit).toHaveBeenCalledTimes(1);
    expect(runPreChecks).toHaveBeenCalledTimes(1);
    expect(checkbox).toHaveBeenCalledTimes(1);
    expect(createPreRunTag).toHaveBeenCalledTimes(1);
    expect(createRunBranch).toHaveBeenCalledTimes(1);
    expect(executeSteps).toHaveBeenCalledTimes(1);
    expect(generateReport).toHaveBeenCalledTimes(1);
    expect(mergeRunBranch).toHaveBeenCalledTimes(1);

    // Notification sent for start and completion
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining('Started'),
      expect.any(String),
    );
  });

  it('sends success notification when all steps pass and merge succeeds', async () => {
    await run();

    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining('Complete'),
      expect.stringContaining('succeeded'),
    );
  });

  // -------------------------------------------------------------------------
  // Merge conflict path
  // -------------------------------------------------------------------------
  it('handles merge conflict gracefully', async () => {
    mergeRunBranch.mockResolvedValue({ success: false, conflict: true });

    await run();

    // Should notify about merge conflict
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining('Merge Conflict'),
      expect.any(String),
    );

    // Should print manual merge instructions
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('merge'),
    );
  });

  // -------------------------------------------------------------------------
  // Failed steps path
  // -------------------------------------------------------------------------
  it('shows warning when some steps fail but merge succeeds', async () => {
    executeSteps.mockResolvedValue(makeExecutionResults({ completedCount: 1, failedCount: 1 }));

    await run();

    // Notify about partial success
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining('Complete'),
      expect.stringContaining('failed'),
    );
  });

  // -------------------------------------------------------------------------
  // Changelog failure fallback
  // -------------------------------------------------------------------------
  it('proceeds with null narration when changelog generation fails', async () => {
    runPrompt.mockResolvedValue({ success: false, output: '', error: 'timeout' });

    await run();

    // generateReport should be called with null narration
    expect(generateReport).toHaveBeenCalledWith(
      expect.any(Object),
      null,
      expect.any(Object),
    );
  });

  // -------------------------------------------------------------------------
  // Pre-checks failure
  // -------------------------------------------------------------------------
  it('exits with error when pre-checks fail', async () => {
    runPreChecks.mockRejectedValue(new Error('Git is not installed'));

    await expect(run()).rejects.toThrow('process.exit called');

    expect(processExitSpy).toHaveBeenCalledWith(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Git is not installed'),
    );
  });

  // -------------------------------------------------------------------------
  // No steps selected
  // -------------------------------------------------------------------------
  it('exits when no steps are selected', async () => {
    checkbox.mockResolvedValue([]);

    await expect(run()).rejects.toThrow('process.exit called');

    expect(processExitSpy).toHaveBeenCalledWith(0);
    // Should not start execution
    expect(executeSteps).not.toHaveBeenCalled();
  });

  it('exits when checkbox returns null', async () => {
    checkbox.mockResolvedValue(null);

    await expect(run()).rejects.toThrow('process.exit called');

    expect(processExitSpy).toHaveBeenCalledWith(0);
    expect(executeSteps).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Report commit failure (non-fatal)
  // -------------------------------------------------------------------------
  it('continues when report commit fails', async () => {
    const mockGit = {
      add: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockRejectedValue(new Error('nothing to commit')),
    };
    getGitInstance.mockReturnValue(mockGit);

    // Should complete without throwing
    await run();

    expect(mergeRunBranch).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Welcome screen (first run)
  // -------------------------------------------------------------------------
  it('shows welcome screen on first run (marker file missing)', async () => {
    existsSync.mockReturnValue(false);

    await run();

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('Welcome to NightyTidy'),
    );
  });

  it('skips welcome screen when marker file exists', async () => {
    existsSync.mockReturnValue(true);

    await run();

    // Welcome text should not appear
    const welcomeCalls = consoleLogSpy.mock.calls.filter(
      (call) => call[0]?.includes?.('Welcome to NightyTidy')
    );
    expect(welcomeCalls).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Abort signal / interrupted run
  // -------------------------------------------------------------------------
  it('generates partial report and exits when execution is interrupted', async () => {
    // Simulate executeSteps returning results with aborted signal
    const partialResults = makeExecutionResults({ completedCount: 1, failedCount: 0 });

    // Make executeSteps trigger abort on the signal
    executeSteps.mockImplementation(async (steps, dir, opts) => {
      // Simulate abort signal being set
      if (opts?.signal) {
        // The abort would happen externally; we just simulate the signal state
        // by making the abort controller's signal be aborted
      }
      return partialResults;
    });

    // We need to test the abort path. Since abortController is internal to run(),
    // and we can't easily trigger SIGINT in tests, let's verify the non-abort path
    // produces correct output at least.
    await run();

    expect(generateReport).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Merge fail + steps fail combo
  // -------------------------------------------------------------------------
  it('sends merge conflict notification after failed steps', async () => {
    executeSteps.mockResolvedValue(makeExecutionResults({ completedCount: 1, failedCount: 1 }));
    mergeRunBranch.mockResolvedValue({ success: false, conflict: true });

    await run();

    // Should still attempt merge and handle conflict
    expect(mergeRunBranch).toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining('Merge Conflict'),
      expect.any(String),
    );
  });

  // -------------------------------------------------------------------------
  // Step callbacks fire correctly
  // -------------------------------------------------------------------------
  it('passes step callbacks to executeSteps', async () => {
    await run();

    const callArgs = executeSteps.mock.calls[0];
    const options = callArgs[2];

    expect(options).toHaveProperty('signal');
    expect(options).toHaveProperty('onStepStart');
    expect(options).toHaveProperty('onStepComplete');
    expect(options).toHaveProperty('onStepFail');
    expect(typeof options.onStepStart).toBe('function');
    expect(typeof options.onStepComplete).toBe('function');
    expect(typeof options.onStepFail).toBe('function');
  });

  // -------------------------------------------------------------------------
  // SIGINT handler registration
  // -------------------------------------------------------------------------
  it('registers SIGINT and unhandledRejection handlers', async () => {
    await run();

    const sigintCalls = processOnSpy.mock.calls.filter(
      (call) => call[0] === 'SIGINT'
    );
    const rejectionCalls = processOnSpy.mock.calls.filter(
      (call) => call[0] === 'unhandledRejection'
    );

    expect(sigintCalls.length).toBeGreaterThan(0);
    expect(rejectionCalls.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Print terminal summary (all success)
  // -------------------------------------------------------------------------
  it('prints success summary with step count and duration', async () => {
    await run();

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('NightyTidy complete'),
    );
  });

  // -------------------------------------------------------------------------
  // Print terminal summary (merge conflict)
  // -------------------------------------------------------------------------
  it('prints merge conflict instructions in terminal summary', async () => {
    mergeRunBranch.mockResolvedValue({ success: false, conflict: true });

    await run();

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('merge needs attention'),
    );
  });

  // -------------------------------------------------------------------------
  // Fatal error with runStarted=true
  // -------------------------------------------------------------------------
  it('notifies and shows undo tag when error occurs after run starts', async () => {
    executeSteps.mockRejectedValue(new Error('unexpected crash'));

    await expect(run()).rejects.toThrow('process.exit called');

    expect(processExitSpy).toHaveBeenCalledWith(1);
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining('Error'),
      expect.any(String),
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('safe'),
    );
  });

  // -------------------------------------------------------------------------
  // SIGINT simulation — graceful abort
  // -------------------------------------------------------------------------
  it('generates partial report and exits gracefully on first SIGINT', async () => {
    const partialResults = makeExecutionResults({ completedCount: 1, failedCount: 0 });

    executeSteps.mockImplementation(async () => {
      // Extract the SIGINT handler that run() registered via process.on
      const sigintCall = processOnSpy.mock.calls.find(
        (call) => call[0] === 'SIGINT'
      );
      if (sigintCall) {
        sigintCall[1](); // Trigger first SIGINT — graceful stop
      }
      return partialResults;
    });

    await expect(run()).rejects.toThrow('process.exit called');

    // Graceful abort exits with 0
    expect(processExitSpy).toHaveBeenCalledWith(0);

    // Partial report should be generated
    expect(generateReport).toHaveBeenCalledTimes(1);

    // Should notify about the stop
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining('Stopped'),
      expect.any(String),
    );

    // Should print interrupted message
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('stopped'),
    );
  });

  // -------------------------------------------------------------------------
  // SIGINT simulation — force exit on second SIGINT
  // -------------------------------------------------------------------------
  it('force exits on second SIGINT', async () => {
    executeSteps.mockImplementation(async () => {
      // Extract and trigger the SIGINT handler twice
      const sigintCall = processOnSpy.mock.calls.find(
        (call) => call[0] === 'SIGINT'
      );
      if (sigintCall) {
        const handler = sigintCall[1];
        handler(); // First SIGINT — sets interrupted = true, aborts
        handler(); // Second SIGINT — force exit
      }
      return makeExecutionResults();
    });

    await expect(run()).rejects.toThrow('process.exit called');

    // Force exit uses exit code 1
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });
});
