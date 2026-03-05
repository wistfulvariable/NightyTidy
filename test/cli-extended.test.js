import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the module under test
// ---------------------------------------------------------------------------

vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => '{}'),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  openSync: vi.fn(() => 99),
  closeSync: vi.fn(),
}));

vi.mock('commander', () => {
  const program = {
    name: vi.fn().mockReturnThis(),
    description: vi.fn().mockReturnThis(),
    version: vi.fn().mockReturnThis(),
    option: vi.fn().mockReturnThis(),
    parse: vi.fn(),
    opts: vi.fn().mockReturnValue({}),
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
  excludeEphemeralFiles: vi.fn(),
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
    { number: 3, name: 'Test', prompt: 'test the code' },
  ],
  CHANGELOG_PROMPT: 'generate changelog',
}));

vi.mock('../src/executor.js', () => ({
  executeSteps: vi.fn(),
  SAFETY_PREAMBLE: '',
}));

vi.mock('../src/notifications.js', () => ({
  notify: vi.fn(),
}));

vi.mock('../src/report.js', () => ({
  generateReport: vi.fn(),
  formatDuration: vi.fn((ms) => `${Math.round(ms / 1000)}s`),
  getVersion: vi.fn(() => '0.1.0'),
}));

vi.mock('../src/setup.js', () => ({
  setupProject: vi.fn().mockReturnValue('created'),
}));

vi.mock('../src/dashboard.js', () => ({
  startDashboard: vi.fn().mockResolvedValue({ url: 'http://localhost:9999', port: 9999 }),
  updateDashboard: vi.fn(),
  stopDashboard: vi.fn(),
  scheduleShutdown: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports — after mocks
// ---------------------------------------------------------------------------

import { run } from '../src/cli.js';
import { existsSync, readFileSync, unlinkSync, openSync } from 'fs';
import checkbox from '@inquirer/checkbox';
import { Command } from 'commander';
import { warn } from '../src/logger.js';
import { runPreChecks } from '../src/checks.js';
import { mergeRunBranch } from '../src/git.js';
import { runPrompt } from '../src/claude.js';
import { executeSteps } from '../src/executor.js';
import { setupProject } from '../src/setup.js';
import { updateDashboard, startDashboard, stopDashboard } from '../src/dashboard.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeExecutionResults({ completedCount = 2, failedCount = 0, totalDuration = 60000 } = {}) {
  const results = [];
  for (let i = 0; i < completedCount; i++) {
    results.push({
      step: { number: i + 1, name: `Step${i + 1}` },
      status: 'completed', output: 'ok', duration: 30000, attempts: 1, error: null,
    });
  }
  for (let i = 0; i < failedCount; i++) {
    results.push({
      step: { number: completedCount + i + 1, name: `FailStep${i + 1}` },
      status: 'failed', output: '', duration: 10000, attempts: 4, error: 'timeout',
    });
  }
  return { results, completedCount, failedCount, totalDuration };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('cli.js extended coverage', () => {
  let consoleLogSpy;
  let consoleErrorSpy;
  let processExitSpy;
  let processOnSpy;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    processOnSpy = vi.spyOn(process, 'on').mockImplementation(() => process);
    process.stdin.isTTY = true;

    checkbox.mockResolvedValue([{ number: 1, name: 'Lint', prompt: 'lint the code' }]);
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
    delete process.stdin.isTTY;
  });

  // -------------------------------------------------------------------------
  // --list flag
  // -------------------------------------------------------------------------
  describe('--list flag', () => {
    it('lists all steps and exits without running', async () => {
      const program = new Command();
      program.opts.mockReturnValueOnce({ list: true });

      await expect(run()).rejects.toThrow('process.exit called');

      expect(processExitSpy).toHaveBeenCalledWith(0);
      // Should print step names
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('1. Lint'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('2. Format'));
      // Should NOT run pre-checks or execution
      expect(executeSteps).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // --steps flag (valid and invalid)
  // -------------------------------------------------------------------------
  describe('--steps flag', () => {
    it('runs only the requested steps', async () => {
      const program = new Command();
      program.opts.mockReturnValueOnce({ steps: '1,3' });

      await run();

      const stepsArg = executeSteps.mock.calls[0][0];
      expect(stepsArg).toHaveLength(2);
      expect(stepsArg[0].number).toBe(1);
      expect(stepsArg[1].number).toBe(3);
    });

    it('exits with error for invalid step numbers', async () => {
      const program = new Command();
      program.opts.mockReturnValueOnce({ steps: '1,99' });

      await expect(run()).rejects.toThrow('process.exit called');

      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid step number'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('99'));
    });

    it('exits with error for non-numeric step values', async () => {
      const program = new Command();
      program.opts.mockReturnValueOnce({ steps: 'abc' });

      await expect(run()).rejects.toThrow('process.exit called');

      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid'));
    });

    it('exits with error for step 0 (below valid range)', async () => {
      const program = new Command();
      program.opts.mockReturnValueOnce({ steps: '0' });

      await expect(run()).rejects.toThrow('process.exit called');

      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });

  // -------------------------------------------------------------------------
  // --setup flag with appended result
  // -------------------------------------------------------------------------
  describe('--setup flag result variants', () => {
    it('shows "Added" message when setup appends to existing CLAUDE.md', async () => {
      const program = new Command();
      program.opts.mockReturnValueOnce({ setup: true });
      setupProject.mockReturnValue('appended');

      await expect(run()).rejects.toThrow('process.exit called');

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Added'));
    });

    it('shows "Created" message when setup creates new CLAUDE.md', async () => {
      const program = new Command();
      program.opts.mockReturnValueOnce({ setup: true });
      setupProject.mockReturnValue('created');

      await expect(run()).rejects.toThrow('process.exit called');

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Created'));
    });
  });

  // -------------------------------------------------------------------------
  // Lock file handling
  // -------------------------------------------------------------------------
  describe('lock file handling', () => {
    it('removes stale lock file from crashed process and continues', async () => {
      // First openSync('wx') fails with EEXIST, then stale lock is read and removed,
      // second openSync('wx') succeeds
      const eexist = new Error('EEXIST');
      eexist.code = 'EEXIST';
      openSync.mockImplementationOnce(() => { throw eexist; });
      // Stale lock — PID not alive
      readFileSync.mockReturnValueOnce(JSON.stringify({ pid: 999999, started: '2026-01-01T00:00:00Z' }));
      // process.kill(999999, 0) will throw since PID doesn't exist

      await run();

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('stale lock'));
      expect(unlinkSync).toHaveBeenCalled();
    });

    it('removes corrupt lock file and continues', async () => {
      const eexist = new Error('EEXIST');
      eexist.code = 'EEXIST';
      openSync.mockImplementationOnce(() => { throw eexist; });
      readFileSync.mockReturnValueOnce('not-valid-json!!!');

      await run();

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('stale lock'));
      expect(unlinkSync).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Step callbacks (onStepStart, onStepComplete, onStepFail)
  // -------------------------------------------------------------------------
  describe('step callbacks', () => {
    it('onStepStart updates dashboard state to running', async () => {
      executeSteps.mockImplementation(async (steps, dir, opts) => {
        // Call onStepStart callback
        opts.onStepStart({ number: 1, name: 'Lint' }, 0, 1);
        return makeExecutionResults({ completedCount: 1, failedCount: 0 });
      });

      await run();

      // Dashboard should have been updated with running status
      const dashCalls = updateDashboard.mock.calls;
      const runningCall = dashCalls.find(c => c[0].steps?.[0]?.status === 'running');
      expect(runningCall).toBeDefined();
    });

    it('onStepComplete updates dashboard state and prints success', async () => {
      executeSteps.mockImplementation(async (steps, dir, opts) => {
        opts.onStepStart({ number: 1, name: 'Lint' }, 0, 1);
        opts.onStepComplete({ number: 1, name: 'Lint' }, 0, 1);
        return makeExecutionResults({ completedCount: 1, failedCount: 0 });
      });

      await run();

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('done'));
    });

    it('onStepFail updates dashboard state and prints failure', async () => {
      executeSteps.mockImplementation(async (steps, dir, opts) => {
        opts.onStepStart({ number: 1, name: 'Lint' }, 0, 1);
        opts.onStepFail({ number: 1, name: 'Lint' }, 0, 1);
        return makeExecutionResults({ completedCount: 0, failedCount: 1 });
      });

      await run();

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('failed'));
    });

    it('onStepComplete starts spinner for next step when more steps remain', async () => {
      // Select 2 steps so the callback can reference selected[1]
      checkbox.mockResolvedValue([
        { number: 1, name: 'Lint', prompt: 'lint the code' },
        { number: 2, name: 'Format', prompt: 'format the code' },
      ]);

      executeSteps.mockImplementation(async (steps, dir, opts) => {
        opts.onStepStart({ number: 1, name: 'Lint' }, 0, 2);
        opts.onStepComplete({ number: 1, name: 'Lint' }, 0, 2);
        return makeExecutionResults({ completedCount: 2, failedCount: 0 });
      });

      await run();

      // Should have printed the "done" message for step 1
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('done'));
    });

    it('callbacks work correctly when dashState is null', async () => {
      // Simulate dashboard failing to start
      startDashboard.mockResolvedValue(null);

      executeSteps.mockImplementation(async (steps, dir, opts) => {
        // These should not crash even with null dashState
        opts.onStepStart({ number: 1, name: 'Lint' }, 0, 1);
        opts.onStepComplete({ number: 1, name: 'Lint' }, 0, 1);
        return makeExecutionResults({ completedCount: 1, failedCount: 0 });
      });

      // Should not crash
      await run();

      expect(executeSteps).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Changelog warning
  // -------------------------------------------------------------------------
  describe('changelog generation', () => {
    it('warns when changelog generation fails', async () => {
      runPrompt.mockResolvedValue({ success: false, output: '', error: 'timeout' });

      await run();

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('changelog generation failed'));
    });
  });

  // -------------------------------------------------------------------------
  // Dashboard state transitions
  // dashState is a mutable reference — we snapshot the status at call time
  // -------------------------------------------------------------------------
  describe('dashboard state transitions', () => {
    it('updates dashboard to finishing state between execution and report', async () => {
      const statusSnapshots = [];
      updateDashboard.mockImplementation((state) => {
        statusSnapshots.push(state.status);
      });

      await run();

      expect(statusSnapshots).toContain('finishing');
    });

    it('abort path updates dashboard to stopped and calls stopDashboard', async () => {
      const statusSnapshots = [];
      updateDashboard.mockImplementation((state) => {
        statusSnapshots.push(state.status);
      });

      executeSteps.mockImplementation(async (steps, dir, opts) => {
        const sigintCall = processOnSpy.mock.calls.find(c => c[0] === 'SIGINT');
        if (sigintCall) sigintCall[1]();
        return makeExecutionResults({ completedCount: 1, failedCount: 0 });
      });

      await expect(run()).rejects.toThrow('process.exit called');

      expect(statusSnapshots).toContain('stopped');
      expect(stopDashboard).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // --all flag
  // -------------------------------------------------------------------------
  describe('--all flag', () => {
    it('runs all steps without interactive selection', async () => {
      const program = new Command();
      program.opts.mockReturnValueOnce({ all: true });

      await run();

      // Should not ask for checkbox
      expect(checkbox).not.toHaveBeenCalled();
      // Should pass all 3 steps
      const stepsArg = executeSteps.mock.calls[0][0];
      expect(stepsArg).toHaveLength(3);
    });
  });

  // -------------------------------------------------------------------------
  // --timeout NaN
  // -------------------------------------------------------------------------
  describe('--timeout edge cases', () => {
    it('exits with error when timeout is NaN', async () => {
      const program = new Command();
      program.opts.mockReturnValueOnce({ timeout: NaN });

      await expect(run()).rejects.toThrow('process.exit called');

      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('--timeout'));
    });

    it('exits with error when timeout is 0', async () => {
      const program = new Command();
      program.opts.mockReturnValueOnce({ timeout: 0 });

      await expect(run()).rejects.toThrow('process.exit called');

      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('includes the invalid value in the error message', async () => {
      const program = new Command();
      program.opts.mockReturnValueOnce({ timeout: -5 });

      await expect(run()).rejects.toThrow('process.exit called');

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('"-5"'));
    });
  });

  // -------------------------------------------------------------------------
  // --list flag shows descriptions and total count
  // -------------------------------------------------------------------------
  describe('--list with descriptions', () => {
    it('prints total step count header', async () => {
      const program = new Command();
      program.opts.mockReturnValueOnce({ list: true });

      await expect(run()).rejects.toThrow('process.exit called');

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('3 total'));
    });

    it('prints usage hint at the bottom', async () => {
      const program = new Command();
      program.opts.mockReturnValueOnce({ list: true });

      await expect(run()).rejects.toThrow('process.exit called');

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('--steps'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('--all'));
    });
  });

  // -------------------------------------------------------------------------
  // --dry-run flag
  // -------------------------------------------------------------------------
  describe('--dry-run flag', () => {
    it('shows plan and exits without executing', async () => {
      const program = new Command();
      program.opts.mockReturnValueOnce({ all: true, dryRun: true });

      await expect(run()).rejects.toThrow('process.exit called');

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Dry Run'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('passed'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Steps selected'));
      // Should NOT execute any steps
      expect(executeSteps).not.toHaveBeenCalled();
    });

    it('runs pre-checks before showing dry-run plan', async () => {
      const program = new Command();
      program.opts.mockReturnValueOnce({ all: true, dryRun: true });

      await expect(run()).rejects.toThrow('process.exit called');

      expect(runPreChecks).toHaveBeenCalledTimes(1);
    });

    it('shows selected step names in the plan', async () => {
      const program = new Command();
      program.opts.mockReturnValueOnce({ steps: '1', dryRun: true });

      await expect(run()).rejects.toThrow('process.exit called');

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Lint'));
    });

    it('shows custom timeout in the plan', async () => {
      const program = new Command();
      program.opts.mockReturnValueOnce({ all: true, dryRun: true, timeout: 60 });

      await expect(run()).rejects.toThrow('process.exit called');

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('60 min'));
    });

    it('exits with error if pre-checks fail during dry-run', async () => {
      const program = new Command();
      program.opts.mockReturnValueOnce({ all: true, dryRun: true });
      runPreChecks.mockRejectedValueOnce(new Error('Git not found'));

      await expect(run()).rejects.toThrow('process.exit called');

      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(executeSteps).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Progress summary during execution
  // -------------------------------------------------------------------------
  describe('progress summary', () => {
    it('prints progress summary every 5 steps for large runs', async () => {
      // Mock 6 steps so the summary triggers at step 5
      const sixSteps = Array.from({ length: 6 }, (_, i) => ({
        number: i + 1, name: `Step${i + 1}`, prompt: `do step ${i + 1}`,
      }));

      // Override STEPS mock for this test by selecting from --steps
      checkbox.mockResolvedValue(sixSteps);

      executeSteps.mockImplementation(async (steps, dir, opts) => {
        // Simulate 5 completed steps + 1 failed
        for (let i = 0; i < 5; i++) {
          opts.onStepStart(steps[i], i, 6);
          opts.onStepComplete(steps[i], i, 6);
        }
        opts.onStepStart(steps[5], 5, 6);
        opts.onStepFail(steps[5], 5, 6);
        return {
          results: steps.map((s, i) => ({
            step: { number: s.number, name: s.name },
            status: i < 5 ? 'completed' : 'failed',
            output: 'ok', duration: 30000, attempts: 1, error: null,
          })),
          completedCount: 5, failedCount: 1, totalDuration: 180000,
        };
      });

      await run();

      // Should have printed a progress summary after 5 steps
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Progress:'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('5/6 done'));
    });

    it('does not print progress summary for small runs', async () => {
      executeSteps.mockImplementation(async (steps, dir, opts) => {
        opts.onStepStart(steps[0], 0, 1);
        opts.onStepComplete(steps[0], 0, 1);
        return { results: [], completedCount: 1, failedCount: 0, totalDuration: 30000 };
      });

      await run();

      const progressCalls = consoleLogSpy.mock.calls.filter(
        c => typeof c[0] === 'string' && c[0].includes('Progress:')
      );
      expect(progressCalls).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Failed step summary at completion
  // -------------------------------------------------------------------------
  describe('failed step summary', () => {
    it('prints failed step names at the end of a run with failures', async () => {
      executeSteps.mockResolvedValue({
        results: [
          { step: { number: 1, name: 'Lint' }, status: 'completed', output: 'ok', duration: 30000, attempts: 1, error: null },
          { step: { number: 2, name: 'Format' }, status: 'failed', output: '', duration: 10000, attempts: 4, error: 'timeout' },
        ],
        completedCount: 1,
        failedCount: 1,
        totalDuration: 40000,
      });

      await run();

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Failed steps:'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Format'));
    });
  });
});
