import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the module under test
// ---------------------------------------------------------------------------

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('os', () => ({
  platform: vi.fn(() => 'linux'),
}));

import { createLoggerMock } from './helpers/mocks.js';

vi.mock('../src/logger.js', () => createLoggerMock());

// ---------------------------------------------------------------------------
// Imports — after mocks are registered
// ---------------------------------------------------------------------------

import { spawn } from 'child_process';
import { platform } from 'os';
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
    platform.mockReturnValue('linux');
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
        ['-p', 'short prompt', '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions'],
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
      // No stdout emitted → output is empty
      expect(result.output).toBe('');
    });

    it('preserves last attempt output for diagnostics when all retries exhausted', async () => {
      const options = { timeout: 500, retries: 2, label: 'output-preserved-test' };

      setupSpawnSequence(
        // Attempt 1: some output, then fails
        (child) => {
          child.emitStdout('attempt 1 output');
          child.emitClose(1);
        },
        // Attempt 2: different output, then fails
        (child) => {
          child.emitStdout('attempt 2 output');
          child.emitClose(1);
        },
        // Attempt 3 (last): diagnostic info, then fails
        (child) => {
          child.emitStdout('Error: module not found\nStack trace here');
          child.emitClose(1);
        },
      );

      const promise = runPrompt('do something', '/tmp', options);
      await vi.advanceTimersByTimeAsync(60_000);
      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(3);
      // Last attempt's stdout is preserved — not empty string
      expect(result.output).toBe('Error: module not found\nStack trace here');
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

      // When using stdin mode, args should only contain output-format + permission flag (no -p flag)
      expect(spawn).toHaveBeenCalledWith(
        'claude',
        ['--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions'],
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

  // -----------------------------------------------------------------------
  // Windows shell mode
  // -----------------------------------------------------------------------
  describe('Windows shell mode', () => {
    it('uses shell: true on Windows to avoid ENOENT from .cmd resolution', async () => {
      platform.mockReturnValue('win32');

      setupSpawnSequence((child) => {
        child.emitStdout('output');
        child.emitClose(0);
      });

      await runPrompt('test', '/tmp', FAST_OPTIONS);

      expect(spawn).toHaveBeenCalledWith(
        'claude',
        ['-p', 'test', '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions'],
        expect.objectContaining({ shell: true }),
      );
    });

    it('does not use shell on non-Windows', async () => {
      platform.mockReturnValue('linux');

      setupSpawnSequence((child) => {
        child.emitStdout('output');
        child.emitClose(0);
      });

      await runPrompt('test', '/tmp', FAST_OPTIONS);

      expect(spawn).toHaveBeenCalledWith(
        'claude',
        ['-p', 'test', '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions'],
        expect.objectContaining({ shell: false }),
      );
    });

    it('spawns only once per attempt on Windows (no ENOENT double-spawn)', async () => {
      platform.mockReturnValue('win32');

      setupSpawnSequence(
        (child) => { child.emitClose(1); },
        (child) => {
          child.emitStdout('ok');
          child.emitClose(0);
        },
      );

      const promise = runPrompt('test', '/tmp', FAST_OPTIONS);
      await vi.advanceTimersByTimeAsync(15_000);
      const result = await promise;

      expect(result.success).toBe(true);
      // Exactly 2 spawn calls — one per attempt, no ENOENT retry doubling
      expect(spawn).toHaveBeenCalledTimes(2);
    });
  });

  // -----------------------------------------------------------------------
  // onOutput callback
  // -----------------------------------------------------------------------
  describe('onOutput callback', () => {
    it('receives formatted output from stdout NDJSON lines in real time', async () => {
      const chunks = [];
      setupSpawnSequence((child) => {
        // Emit non-JSON lines with newlines — passed through as raw text
        child.emitStdout('chunk1\n');
        child.emitStdout('chunk2\n');
        child.emitClose(0);
      });

      const result = await runPrompt('test', '/tmp', {
        ...FAST_OPTIONS,
        onOutput: (text) => chunks.push(text),
      });

      expect(result.success).toBe(true);
      expect(chunks).toEqual(['chunk1\n', 'chunk2\n']);
    });

    it('is not called when not provided', async () => {
      setupSpawnSequence((child) => {
        child.emitStdout('output');
        child.emitClose(0);
      });

      // Should not throw — no callback provided
      const result = await runPrompt('test', '/tmp', FAST_OPTIONS);
      expect(result.success).toBe(true);
    });

    it('swallows callback errors without crashing subprocess', async () => {
      setupSpawnSequence((child) => {
        child.emitStdout('output');
        child.emitClose(0);
      });

      const result = await runPrompt('test', '/tmp', {
        ...FAST_OPTIONS,
        onOutput: () => { throw new Error('callback exploded'); },
      });

      expect(result.success).toBe(true);
      expect(result.output).toBe('output');
    });

    it('is called on each retry attempt', async () => {
      const chunks = [];
      setupSpawnSequence(
        // Attempt 1: fails
        (child) => {
          child.emitStdout('attempt1\n');
          child.emitClose(1);
        },
        // Attempt 2: succeeds
        (child) => {
          child.emitStdout('attempt2\n');
          child.emitClose(0);
        },
      );

      const promise = runPrompt('test', '/tmp', {
        ...FAST_OPTIONS,
        retries: 1,
        onOutput: (text) => chunks.push(text),
      });
      await vi.advanceTimersByTimeAsync(15_000);
      const result = await promise;

      expect(result.success).toBe(true);
      expect(chunks).toContain('attempt1\n');
      expect(chunks).toContain('attempt2\n');
    });
  });

  // -----------------------------------------------------------------------
  // JSON output parsing and cost extraction
  // -----------------------------------------------------------------------
  describe('stream-json output parsing (--output-format stream-json)', () => {
    it('extracts text and cost from NDJSON result event', async () => {
      // stream-json outputs multiple NDJSON lines; final line is the result event
      const assistantLine = JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Working on it...' }] },
      });
      const resultLine = JSON.stringify({
        type: 'result',
        subtype: 'success',
        total_cost_usd: 0.0512,
        is_error: false,
        duration_ms: 3000,
        duration_api_ms: 2100,
        num_turns: 5,
        result: 'Refactored the authentication module.',
        session_id: 'sess-abc-123',
        usage: { input_tokens: 100, cache_creation_input_tokens: 500, cache_read_input_tokens: 200, output_tokens: 50 },
      });

      setupSpawnSequence((child) => {
        child.emitStdout(assistantLine + '\n' + resultLine + '\n');
        child.emitClose(0);
      });

      const result = await runPrompt('refactor auth', '/tmp', FAST_OPTIONS);

      expect(result.success).toBe(true);
      expect(result.output).toBe('Refactored the authentication module.');
      expect(result.cost).toEqual({
        costUSD: 0.0512,
        inputTokens: 800,
        outputTokens: 50,
        numTurns: 5,
        durationApiMs: 2100,
        sessionId: 'sess-abc-123',
      });
    });

    it('extracts cost from result event even with many preceding NDJSON lines', async () => {
      const lines = [
        JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-1' }),
        JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Step 1' }] } }),
        JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/src/main.js' } }] } }),
        JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'file data' }] } }),
        JSON.stringify({ type: 'result', result: 'All done.', total_cost_usd: 0.10, num_turns: 3, duration_api_ms: 5000, session_id: 'sess-1', usage: { input_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 30 } }),
      ].join('\n') + '\n';

      setupSpawnSequence((child) => {
        child.emitStdout(lines);
        child.emitClose(0);
      });

      const result = await runPrompt('test', '/tmp', FAST_OPTIONS);

      expect(result.success).toBe(true);
      expect(result.output).toBe('All done.');
      expect(result.cost).toEqual({
        costUSD: 0.10,
        inputTokens: 50,
        outputTokens: 30,
        numTurns: 3,
        durationApiMs: 5000,
        sessionId: 'sess-1',
      });
    });

    it('returns cost: null when stdout is not valid JSON (graceful fallback)', async () => {
      setupSpawnSequence((child) => {
        child.emitStdout('Plain text output from old CLI');
        child.emitClose(0);
      });

      const result = await runPrompt('test', '/tmp', FAST_OPTIONS);

      expect(result.success).toBe(true);
      expect(result.output).toBe('Plain text output from old CLI');
      expect(result.cost).toBeNull();
    });

    it('handles result event with empty result field', async () => {
      const resultLine = JSON.stringify({
        type: 'result',
        total_cost_usd: 0.001,
        num_turns: 1,
        duration_api_ms: 500,
        result: '',
        session_id: 'sess-empty',
        usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 5 },
      });

      setupSpawnSequence((child) => {
        child.emitStdout(resultLine + '\n');
        child.emitClose(0);
      });

      // Empty result field means empty output text → treated as failure
      const result = await runPrompt('test', '/tmp', { ...FAST_OPTIONS, retries: 0 });

      // Parsed successfully, but empty result = empty output = failure
      expect(result.cost).toEqual({
        costUSD: 0.001,
        inputTokens: 10,
        outputTokens: 5,
        numTurns: 1,
        durationApiMs: 500,
        sessionId: 'sess-empty',
      });
    });

    it('returns cost: null when process fails (no output)', async () => {
      setupSpawnSequence((child) => {
        child.emitClose(1);
      });

      const result = await runPrompt('test', '/tmp', { ...FAST_OPTIONS, retries: 0 });

      expect(result.success).toBe(false);
      expect(result.cost).toBeNull();
    });

    it('handles result event with missing optional cost fields', async () => {
      const resultLine = JSON.stringify({
        type: 'result',
        result: 'Done.',
      });

      setupSpawnSequence((child) => {
        child.emitStdout(resultLine + '\n');
        child.emitClose(0);
      });

      const result = await runPrompt('test', '/tmp', FAST_OPTIONS);

      expect(result.success).toBe(true);
      expect(result.output).toBe('Done.');
      expect(result.cost).toEqual({
        costUSD: null,
        inputTokens: null,
        outputTokens: null,
        numTurns: null,
        durationApiMs: null,
        sessionId: null,
      });
    });

    it('falls back to single-JSON parse for backward compat (--output-format json)', async () => {
      // If CLI still uses --output-format json, it outputs a single JSON object
      const jsonResponse = JSON.stringify({
        type: 'result',
        result: 'Legacy output.',
        total_cost_usd: 0.02,
        num_turns: 2,
        duration_api_ms: 1000,
        session_id: 'sess-legacy',
        usage: { input_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 15 },
      });

      setupSpawnSequence((child) => {
        child.emitStdout(jsonResponse);
        child.emitClose(0);
      });

      const result = await runPrompt('test', '/tmp', FAST_OPTIONS);

      expect(result.success).toBe(true);
      expect(result.output).toBe('Legacy output.');
      expect(result.cost).toEqual({
        costUSD: 0.02,
        inputTokens: 20,
        outputTokens: 15,
        numTurns: 2,
        durationApiMs: 1000,
        sessionId: 'sess-legacy',
      });
    });
  });

  // -----------------------------------------------------------------------
  // onOutput callback — stream-json NDJSON event formatting
  // -----------------------------------------------------------------------
  describe('onOutput with stream-json formatting', () => {
    it('passes formatted assistant text events to onOutput', async () => {
      const chunks = [];
      const assistantLine = JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Analyzing the code...' }] },
      });
      const resultLine = JSON.stringify({
        type: 'result', result: 'Done.', total_cost_usd: 0.01,
      });

      setupSpawnSequence((child) => {
        child.emitStdout(assistantLine + '\n' + resultLine + '\n');
        child.emitClose(0);
      });

      await runPrompt('test', '/tmp', {
        ...FAST_OPTIONS,
        onOutput: (text) => chunks.push(text),
      });

      // Should receive formatted assistant text, not raw JSON
      expect(chunks).toEqual(['Analyzing the code...\n']);
    });

    it('formats tool_use events as readable summaries', async () => {
      const chunks = [];
      const toolLine = JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/src/main.js' } }] },
      });
      const resultLine = JSON.stringify({ type: 'result', result: 'Done.' });

      setupSpawnSequence((child) => {
        child.emitStdout(toolLine + '\n' + resultLine + '\n');
        child.emitClose(0);
      });

      await runPrompt('test', '/tmp', {
        ...FAST_OPTIONS,
        onOutput: (text) => chunks.push(text),
      });

      expect(chunks).toEqual(['\u25B8 Read: /src/main.js\n']);
    });

    it('skips system, user, and result events in onOutput', async () => {
      const chunks = [];
      const lines = [
        JSON.stringify({ type: 'system', subtype: 'init' }),
        JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result' }] } }),
        JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hello' }] } }),
        JSON.stringify({ type: 'result', result: 'Done.' }),
      ].join('\n') + '\n';

      setupSpawnSequence((child) => {
        child.emitStdout(lines);
        child.emitClose(0);
      });

      await runPrompt('test', '/tmp', {
        ...FAST_OPTIONS,
        onOutput: (text) => chunks.push(text),
      });

      // Only the assistant text event should pass through
      expect(chunks).toEqual(['Hello\n']);
    });

    it('passes through non-JSON lines for backward compat', async () => {
      const chunks = [];
      setupSpawnSequence((child) => {
        child.emitStdout('Some plain text output\n');
        child.emitClose(0);
      });

      await runPrompt('test', '/tmp', {
        ...FAST_OPTIONS,
        onOutput: (text) => chunks.push(text),
      });

      expect(chunks).toEqual(['Some plain text output\n']);
    });
  });
});
