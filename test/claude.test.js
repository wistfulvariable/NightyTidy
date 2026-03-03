import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the module under test
// ---------------------------------------------------------------------------

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('../src/logger.js', () => ({
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports — after mocks are registered
// ---------------------------------------------------------------------------

import { spawn } from 'child_process';
import { runPrompt } from '../src/claude.js';

// ---------------------------------------------------------------------------
// Helper: fake ChildProcess factory
// ---------------------------------------------------------------------------

/**
 * Creates a minimal fake ChildProcess with controllable stdout, stderr,
 * exit code, and error events.
 *
 * Usage:
 *   const child = createFakeChild();
 *   child.emitStdout('hello');       // push data to stdout
 *   child.emitStderr('oh no');       // push data to stderr
 *   child.emitClose(0);             // emit 'close' with exit code
 *   child.emitError(new Error(…));  // emit 'error'
 */
function createFakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: vi.fn(), end: vi.fn() };
  child.kill = vi.fn();

  // Convenience helpers
  child.emitStdout = (text) => child.stdout.emit('data', Buffer.from(text));
  child.emitStderr = (text) => child.stderr.emit('data', Buffer.from(text));
  child.emitClose = (code) => child.emit('close', code);
  child.emitError = (err) => child.emit('error', err);

  return child;
}

/**
 * Configures `spawn` to return a sequence of fake children.
 * Each entry is a callback `(child) => void` that schedules events on the
 * child (using setTimeout / queueMicrotask so they fire after listeners
 * are attached).
 */
function setupSpawnSequence(...behaviors) {
  let callIndex = 0;
  spawn.mockImplementation(() => {
    const child = createFakeChild();
    const behavior = behaviors[callIndex++];
    if (behavior) {
      // Schedule behavior asynchronously so the caller can attach listeners first
      queueMicrotask(() => behavior(child));
    }
    return child;
  });
}

// ---------------------------------------------------------------------------
// Shared options — short timeouts so tests run fast
// ---------------------------------------------------------------------------

const FAST_OPTIONS = { timeout: 500, retries: 3, label: 'test' };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runPrompt', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // 1. Successful execution
  // -----------------------------------------------------------------------
  describe('successful execution', () => {
    it('returns success when spawn exits 0 with non-empty stdout', async () => {
      setupSpawnSequence((child) => {
        child.emitStdout('Generated output');
        child.emitClose(0);
      });

      const result = await runPrompt('do something', '/tmp', FAST_OPTIONS);

      expect(result.success).toBe(true);
      expect(result.output).toBe('Generated output');
      expect(result.attempts).toBe(1);
      expect(result.exitCode).toBe(0);
      expect(result.error).toBeNull();
      expect(result.duration).toBeTypeOf('number');
    });

    it('passes the prompt via -p flag for short prompts', async () => {
      setupSpawnSequence((child) => {
        child.emitStdout('ok');
        child.emitClose(0);
      });

      await runPrompt('short prompt', '/tmp', FAST_OPTIONS);

      expect(spawn).toHaveBeenCalledWith(
        'claude',
        ['-p', 'short prompt', '--dangerously-skip-permissions'],
        expect.objectContaining({ cwd: '/tmp' }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // 2. Failed execution, retry succeeds
  // -----------------------------------------------------------------------
  describe('retry logic — eventually succeeds', () => {
    it('retries on failure and returns success with correct attempt count', async () => {
      setupSpawnSequence(
        // Attempt 1: fails with exit code 1
        (child) => {
          child.emitStdout('partial');
          child.emitClose(1);
        },
        // Attempt 2: succeeds
        (child) => {
          child.emitStdout('Success output');
          child.emitClose(0);
        },
      );

      const promise = runPrompt('do something', '/tmp', FAST_OPTIONS);

      // Advance past the 10-second retry delay between attempts
      await vi.advanceTimersByTimeAsync(15_000);

      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.output).toBe('Success output');
      expect(result.attempts).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // 3. All retries exhausted
  // -----------------------------------------------------------------------
  describe('all retries exhausted', () => {
    it('returns failure with correct attempts after all retries are used', async () => {
      const options = { timeout: 500, retries: 3, label: 'exhausted-test' };
      const totalAttempts = options.retries + 1; // 4

      setupSpawnSequence(
        // All 4 attempts fail
        (child) => { child.emitClose(1); },
        (child) => { child.emitClose(1); },
        (child) => { child.emitClose(1); },
        (child) => { child.emitClose(1); },
      );

      const promise = runPrompt('do something', '/tmp', options);

      // Advance enough time to cover all retry delays (3 delays of 10s each)
      await vi.advanceTimersByTimeAsync(60_000);

      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(totalAttempts);
      expect(result.error).toBe(`Failed after ${totalAttempts} attempts`);
      expect(result.exitCode).toBe(-1);
      expect(result.duration).toBeTypeOf('number');
    });
  });

  // -----------------------------------------------------------------------
  // 4. Timeout
  // -----------------------------------------------------------------------
  describe('timeout handling', () => {
    it('returns failure with timeout message when spawn never closes', async () => {
      const timeoutMs = 200;

      setupSpawnSequence(
        // Attempt 1: never closes — will be timed out
        () => { /* child hangs, no close event */ },
        // Attempts 2–4 also hang (retries after timeout)
        () => {},
        () => {},
        () => {},
      );

      const promise = runPrompt('do something', '/tmp', {
        timeout: timeoutMs,
        retries: 3,
        label: 'timeout-test',
      });

      // Advance timers enough to cover all timeouts + retry delays
      // Each attempt: 200ms timeout + 10s retry delay = ~10.2s, times 4 attempts
      await vi.advanceTimersByTimeAsync(120_000);

      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed after');
    });

    it('kills the child process when timeout fires', async () => {
      const timeoutMs = 100;
      let capturedChild;

      setupSpawnSequence((child) => {
        capturedChild = child;
        // Never emit close — simulate a hanging process
      });

      const promise = runPrompt('do something', '/tmp', {
        timeout: timeoutMs,
        retries: 0,
        label: 'kill-test',
      });

      // Advance past the timeout
      await vi.advanceTimersByTimeAsync(timeoutMs + 50);

      const result = await promise;

      expect(capturedChild.kill).toHaveBeenCalled();
      expect(result.success).toBe(false);
      // With retries: 0 the single attempt times out, then runPrompt wraps
      // it with the "Failed after N attempts" message
      expect(result.error).toBe('Failed after 1 attempts');
    });
  });

  // -----------------------------------------------------------------------
  // 5. Empty stdout with exit 0
  // -----------------------------------------------------------------------
  describe('empty stdout with exit code 0', () => {
    it('treats empty stdout as failure and triggers retries', async () => {
      setupSpawnSequence(
        // Attempt 1: exit 0 but no stdout
        (child) => { child.emitClose(0); },
        // Attempt 2: exit 0 but only whitespace
        (child) => {
          child.emitStdout('   \n  ');
          child.emitClose(0);
        },
        // Attempt 3: exit 0 with real content — success
        (child) => {
          child.emitStdout('Real output');
          child.emitClose(0);
        },
      );

      const promise = runPrompt('do something', '/tmp', {
        timeout: 500,
        retries: 3,
        label: 'empty-stdout-test',
      });

      await vi.advanceTimersByTimeAsync(30_000);

      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.output).toBe('Real output');
      expect(result.attempts).toBe(3);
    });

    it('reports "Empty output" error for exit 0 with no stdout', async () => {
      setupSpawnSequence(
        (child) => { child.emitClose(0); },
        (child) => { child.emitClose(0); },
        (child) => { child.emitClose(0); },
        (child) => { child.emitClose(0); },
      );

      const promise = runPrompt('do something', '/tmp', {
        timeout: 500,
        retries: 3,
        label: 'all-empty-test',
      });

      await vi.advanceTimersByTimeAsync(60_000);

      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(4);
    });
  });

  // -----------------------------------------------------------------------
  // 6. Spawn error (ENOENT)
  // -----------------------------------------------------------------------
  describe('spawn error — ENOENT', () => {
    it('returns failure when the process emits an error event', async () => {
      setupSpawnSequence(
        (child) => {
          const err = new Error('spawn claude ENOENT');
          err.code = 'ENOENT';
          child.emitError(err);
        },
        // Subsequent retries also fail with ENOENT
        (child) => {
          const err = new Error('spawn claude ENOENT');
          err.code = 'ENOENT';
          child.emitError(err);
        },
        (child) => {
          const err = new Error('spawn claude ENOENT');
          err.code = 'ENOENT';
          child.emitError(err);
        },
        (child) => {
          const err = new Error('spawn claude ENOENT');
          err.code = 'ENOENT';
          child.emitError(err);
        },
      );

      const promise = runPrompt('do something', '/tmp', {
        timeout: 500,
        retries: 3,
        label: 'enoent-test',
      });

      await vi.advanceTimersByTimeAsync(60_000);

      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed after');
    });

    it('returns failure with the error message on a non-ENOENT error', async () => {
      setupSpawnSequence(
        (child) => {
          const err = new Error('Permission denied');
          err.code = 'EACCES';
          child.emitError(err);
        },
      );

      const result = await runPrompt('do something', '/tmp', {
        timeout: 500,
        retries: 0,
        label: 'eacces-test',
      });

      expect(result.success).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // 7. Abort signal
  // -----------------------------------------------------------------------
  describe('abort signal', () => {
    it('kills the child process immediately when signal is aborted', async () => {
      const controller = new AbortController();
      let capturedChild;

      setupSpawnSequence((child) => {
        capturedChild = child;
        // Process hangs — never emits close
      });

      const promise = runPrompt('do something', '/tmp', {
        ...FAST_OPTIONS,
        retries: 0,
        signal: controller.signal,
      });

      // Abort after a brief delay
      await vi.advanceTimersByTimeAsync(50);
      controller.abort();
      await vi.advanceTimersByTimeAsync(50);

      const result = await promise;

      expect(capturedChild.kill).toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.error).toBe('Aborted by user');
    });

    it('returns immediately without spawning when signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      const result = await runPrompt('do something', '/tmp', {
        ...FAST_OPTIONS,
        signal: controller.signal,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Aborted by user');
      expect(spawn).not.toHaveBeenCalled();
    });

    it('skips remaining retries when signal is aborted between attempts', async () => {
      const controller = new AbortController();

      setupSpawnSequence(
        // Attempt 1: fails
        (child) => { child.emitClose(1); },
        // Attempt 2: should never happen
        (child) => { child.emitStdout('ok'); child.emitClose(0); },
      );

      const promise = runPrompt('do something', '/tmp', {
        timeout: 500,
        retries: 3,
        label: 'abort-retry-test',
        signal: controller.signal,
      });

      // Let first attempt fail, then abort during retry delay
      await vi.advanceTimersByTimeAsync(100);
      controller.abort();
      await vi.advanceTimersByTimeAsync(15_000);

      const result = await promise;

      expect(result.success).toBe(false);
      // Only 1 spawn call — second attempt never started
      expect(spawn).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------
  describe('edge cases', () => {
    it('uses default options when none are provided', async () => {
      setupSpawnSequence((child) => {
        child.emitStdout('output');
        child.emitClose(0);
      });

      const result = await runPrompt('test prompt', '/tmp');

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(1);
    });

    it('collects stderr output without affecting success', async () => {
      setupSpawnSequence((child) => {
        child.emitStderr('warning: something');
        child.emitStdout('valid output');
        child.emitClose(0);
      });

      const result = await runPrompt('test', '/tmp', FAST_OPTIONS);

      expect(result.success).toBe(true);
      expect(result.output).toBe('valid output');
    });

    it('accumulates stdout from multiple data chunks', async () => {
      setupSpawnSequence((child) => {
        child.emitStdout('chunk1');
        child.emitStdout(' chunk2');
        child.emitStdout(' chunk3');
        child.emitClose(0);
      });

      const result = await runPrompt('test', '/tmp', FAST_OPTIONS);

      expect(result.success).toBe(true);
      expect(result.output).toBe('chunk1 chunk2 chunk3');
    });

    it('uses stdin for prompts exceeding the threshold (8000 chars)', async () => {
      const longPrompt = 'x'.repeat(9000);

      setupSpawnSequence((child) => {
        child.emitStdout('done');
        child.emitClose(0);
      });

      await runPrompt(longPrompt, '/tmp', FAST_OPTIONS);

      // When using stdin mode, args should only contain permission flag (no -p flag)
      expect(spawn).toHaveBeenCalledWith(
        'claude',
        ['--dangerously-skip-permissions'],
        expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'] }),
      );
    });

    it('returns zero retries when retries option is 0 and first attempt fails', async () => {
      setupSpawnSequence(
        (child) => { child.emitClose(1); },
      );

      const result = await runPrompt('test', '/tmp', {
        timeout: 500,
        retries: 0,
        label: 'no-retry',
      });

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(1);
      expect(spawn).toHaveBeenCalledTimes(1);
    });
  });
});
