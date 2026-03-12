import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import path from 'path';
import os from 'os';
import { robustCleanup } from './helpers/cleanup.js';

vi.mock('../src/claude.js', () => ({
  runPrompt: vi.fn(),
  ERROR_TYPE: { RATE_LIMIT: 'rate_limit', UNKNOWN: 'unknown' },
  sleep: vi.fn(() => Promise.resolve()),
}));

vi.mock('../src/git.js', () => ({
  getHeadHash: vi.fn(),
  hasNewCommit: vi.fn(),
  fallbackCommit: vi.fn(),
}));

vi.mock('../src/notifications.js', () => ({
  notify: vi.fn(),
}));

import { createLoggerMock } from './helpers/mocks.js';

vi.mock('../src/logger.js', () => createLoggerMock());

vi.mock('../src/prompts/loader.js', () => ({
  STEPS: [],
  DOC_UPDATE_PROMPT: 'mock doc update prompt',
  reloadSteps: vi.fn(),
}));

import { executeSteps, executeSingleStep, FAST_COMPLETION_THRESHOLD_MS, copyPromptsToProject } from '../src/executor.js';
import { runPrompt, sleep } from '../src/claude.js';
import { getHeadHash, hasNewCommit, fallbackCommit } from '../src/git.js';
import { notify } from '../src/notifications.js';
import { warn, info } from '../src/logger.js';
import * as loader from '../src/prompts/loader.js';

function makeStep(number, name = `Step ${number}`) {
  return { number, name, prompt: `prompt for ${name}` };
}

beforeEach(() => {
  vi.clearAllMocks();
  getHeadHash.mockResolvedValue('abc123');
  hasNewCommit.mockResolvedValue(true);
  fallbackCommit.mockResolvedValue(true);
});

describe('executeSteps', () => {
  it('completes all steps when every prompt succeeds', async () => {
    const steps = [makeStep(1, 'Lint'), makeStep(2, 'Format'), makeStep(3, 'Docs')];

    runPrompt.mockResolvedValue({
      success: true,
      output: 'done',
      error: null,
      exitCode: 0,
      attempts: 1,
    });

    const result = await executeSteps(steps, '/fake/project');

    expect(result.completedCount).toBe(3);
    expect(result.failedCount).toBe(0);
    expect(result.results).toHaveLength(3);
    result.results.forEach((r) => {
      expect(r.status).toBe('completed');
    });
    // Each step calls runPrompt twice: once for improvement, once for doc update
    expect(runPrompt).toHaveBeenCalledTimes(6);
  });

  it('records a failed step, notifies, and continues with the rest', async () => {
    const steps = [makeStep(1, 'Lint'), makeStep(2, 'Format'), makeStep(3, 'Docs')];

    runPrompt
      // Step 1 improvement: success
      .mockResolvedValueOnce({ success: true, output: 'ok', error: null, exitCode: 0, attempts: 1 })
      // Step 1 doc update: success
      .mockResolvedValueOnce({ success: true, output: 'ok', error: null, exitCode: 0, attempts: 1 })
      // Step 2 improvement: failure
      .mockResolvedValueOnce({ success: false, output: '', error: 'timeout', exitCode: -1, attempts: 4 })
      // Step 3 improvement: success
      .mockResolvedValueOnce({ success: true, output: 'ok', error: null, exitCode: 0, attempts: 1 })
      // Step 3 doc update: success
      .mockResolvedValueOnce({ success: true, output: 'ok', error: null, exitCode: 0, attempts: 1 });

    const result = await executeSteps(steps, '/fake/project');

    expect(result.completedCount).toBe(2);
    expect(result.failedCount).toBe(1);
    expect(result.results[0].status).toBe('completed');
    expect(result.results[1].status).toBe('failed');
    expect(result.results[1].error).toBe('timeout');
    expect(result.results[1].attempts).toBe(4);
    expect(result.results[2].status).toBe('completed');

    // Notification sent for the failed step
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining('Step 2 Failed'),
      expect.stringContaining('failed after 4 attempts'),
    );
  });

  it('marks step completed with a warning when doc update fails but improvement succeeds', async () => {
    const steps = [makeStep(1, 'Lint')];

    runPrompt
      // Improvement: success
      .mockResolvedValueOnce({ success: true, output: 'improved', error: null, exitCode: 0, attempts: 1 })
      // Doc update: failure
      .mockResolvedValueOnce({ success: false, output: '', error: 'doc fail', exitCode: -1, attempts: 4 });

    const result = await executeSteps(steps, '/fake/project');

    expect(result.completedCount).toBe(1);
    expect(result.failedCount).toBe(0);
    expect(result.results[0].status).toBe('completed');

    // A warning should have been logged about the doc update failure
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Doc update failed'),
    );
  });

  it('calls fallbackCommit when hasNewCommit returns false', async () => {
    const steps = [makeStep(5, 'Refactor')];

    runPrompt.mockResolvedValue({ success: true, output: 'ok', error: null, exitCode: 0, attempts: 1 });
    hasNewCommit.mockResolvedValue(false);

    await executeSteps(steps, '/fake/project');

    // Only 1 call: the fallback commit (sweep skipped since committed=false)
    expect(fallbackCommit).toHaveBeenCalledTimes(1);
    expect(fallbackCommit).toHaveBeenCalledWith(5, 'Refactor');
  });

  it('sweeps uncommitted files after Claude commits (catches missed git add)', async () => {
    const steps = [makeStep(7, 'Audit')];

    runPrompt.mockResolvedValue({ success: true, output: 'ok', error: null, exitCode: 0, attempts: 1 });
    hasNewCommit.mockResolvedValue(true); // Claude committed
    fallbackCommit.mockResolvedValue(true); // Sweep finds uncommitted files

    await executeSteps(steps, '/fake/project');

    // fallbackCommit should be called once for the sweep
    // (not for the fallback — Claude already committed)
    expect(fallbackCommit).toHaveBeenCalledTimes(1);
    expect(fallbackCommit).toHaveBeenCalledWith(7, 'Audit');
    expect(info).toHaveBeenCalledWith(expect.stringContaining('swept uncommitted files'));
  });

  it('does not log sweep message when no uncommitted files remain', async () => {
    const steps = [makeStep(1, 'Lint')];

    runPrompt.mockResolvedValue({ success: true, output: 'ok', error: null, exitCode: 0, attempts: 1 });
    hasNewCommit.mockResolvedValue(true);
    fallbackCommit.mockResolvedValue(false); // No remaining changes to sweep

    await executeSteps(steps, '/fake/project');

    // fallbackCommit called but returned false — no sweep message logged
    const sweepMessages = info.mock.calls.filter(c => c[0]?.includes?.('swept'));
    expect(sweepMessages).toHaveLength(0);
  });

  it('does not log doc update warning when doc update succeeds', async () => {
    const steps = [makeStep(1, 'Lint')];

    // Both improvement and doc update succeed
    runPrompt.mockResolvedValue({
      success: true,
      output: 'ok',
      error: null,
      exitCode: 0,
      attempts: 1,
    });

    await executeSteps(steps, '/fake/project');

    // warn should NOT have been called with a doc update failure message
    const docUpdateWarnings = warn.mock.calls.filter(
      (call) => call[0]?.includes?.('Doc update failed')
    );
    expect(docUpdateWarnings).toHaveLength(0);
  });

  it('passes custom timeout to both runPrompt calls', async () => {
    const steps = [makeStep(1, 'Lint')];
    const customTimeout = 60 * 60 * 1000; // 60 minutes

    runPrompt.mockResolvedValue({ success: true, output: 'ok', error: null, exitCode: 0, attempts: 1 });

    await executeSteps(steps, '/fake/project', { timeout: customTimeout });

    expect(runPrompt).toHaveBeenCalledTimes(2);
    for (const call of runPrompt.mock.calls) {
      expect(call[2]).toHaveProperty('timeout', customTimeout);
    }
  });

  it('leaves timeout undefined when not specified', async () => {
    const steps = [makeStep(1, 'Lint')];

    runPrompt.mockResolvedValue({ success: true, output: 'ok', error: null, exitCode: 0, attempts: 1 });

    await executeSteps(steps, '/fake/project');

    expect(runPrompt).toHaveBeenCalledTimes(2);
    for (const call of runPrompt.mock.calls) {
      expect(call[2].timeout).toBeUndefined();
    }
  });

  it('passes an abort signal to runPrompt that tracks the external signal', async () => {
    const steps = [makeStep(1, 'Lint')];
    const controller = new AbortController();

    runPrompt.mockResolvedValue({ success: true, output: 'ok', error: null, exitCode: 0, attempts: 1 });

    await executeSteps(steps, '/fake/project', { signal: controller.signal });

    // Both the improvement and doc-update calls should receive an AbortSignal
    // (wrapped via AbortSignal.any to combine external + step-level timeout)
    expect(runPrompt).toHaveBeenCalledTimes(2);
    for (const call of runPrompt.mock.calls) {
      expect(call[2].signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('stops processing when abort signal fires after step 1', async () => {
    const steps = [makeStep(1, 'Lint'), makeStep(2, 'Format'), makeStep(3, 'Docs')];
    const controller = new AbortController();

    runPrompt.mockResolvedValue({ success: true, output: 'ok', error: null, exitCode: 0, attempts: 1 });

    // Abort after the first step completes
    const onStepComplete = vi.fn((_step, i) => {
      if (i === 0) controller.abort();
    });

    const result = await executeSteps(steps, '/fake/project', {
      signal: controller.signal,
      onStepComplete,
    });

    // Only step 1 should have completed; steps 2 and 3 should not have run
    expect(result.results).toHaveLength(1);
    expect(result.results[0].step.number).toBe(1);
    expect(result.completedCount).toBe(1);
  });

  it('passes onOutput callback to runPrompt options', async () => {
    const steps = [makeStep(1, 'Lint')];
    const onOutput = vi.fn();
    runPrompt.mockResolvedValue({ success: true, output: 'ok', error: null, exitCode: 0, attempts: 1 });

    await executeSteps(steps, '/fake/project', { onOutput });

    // Both improvement and doc update calls should include onOutput
    expect(runPrompt).toHaveBeenCalledTimes(2);
    for (const call of runPrompt.mock.calls) {
      expect(call[2]).toHaveProperty('onOutput', onOutput);
    }
  });

  it('works correctly without onOutput callback', async () => {
    const steps = [makeStep(1, 'Lint')];
    runPrompt.mockResolvedValue({ success: true, output: 'ok', error: null, exitCode: 0, attempts: 1 });

    const result = await executeSteps(steps, '/fake/project');

    expect(result.completedCount).toBe(1);
    // onOutput should be undefined in options
    for (const call of runPrompt.mock.calls) {
      expect(call[2].onOutput).toBeUndefined();
    }
  });
});

describe('cost tracking', () => {
  it('includes cost in step results when runPrompt returns cost data', async () => {
    const steps = [makeStep(1, 'Lint')];
    const mockCost = { costUSD: 0.05, numTurns: 3, durationApiMs: 2000, sessionId: 'sess-1' };

    runPrompt.mockResolvedValue({
      success: true, output: 'ok', error: null, exitCode: 0, attempts: 1,
      cost: mockCost,
    });

    const result = await executeSteps(steps, '/fake/project');

    expect(result.results[0].cost).toBeDefined();
    // Combined cost = improvement cost + doc-update cost (both have same mock cost)
    expect(result.results[0].cost.costUSD).toBe(0.10);
    expect(result.results[0].cost.numTurns).toBe(6);
    expect(result.results[0].cost.durationApiMs).toBe(4000);
  });

  it('sums improvement and doc-update costs into a single step cost', async () => {
    const steps = [makeStep(1, 'Lint')];
    const improvementCost = { costUSD: 0.08, numTurns: 4, durationApiMs: 3000, sessionId: 'sess-a' };
    const docUpdateCost = { costUSD: 0.02, numTurns: 1, durationApiMs: 500, sessionId: 'sess-a' };

    runPrompt
      .mockResolvedValueOnce({ success: true, output: 'ok', error: null, exitCode: 0, attempts: 1, cost: improvementCost })
      .mockResolvedValueOnce({ success: true, output: 'ok', error: null, exitCode: 0, attempts: 1, cost: docUpdateCost });

    const result = await executeSteps(steps, '/fake/project');

    expect(result.results[0].cost).toEqual({
      costUSD: 0.10,
      inputTokens: null,
      outputTokens: null,
      numTurns: 5,
      durationApiMs: 3500,
      sessionId: 'sess-a',
    });
  });

  it('uses improvement cost alone when doc-update has no cost', async () => {
    const steps = [makeStep(1, 'Lint')];

    runPrompt
      .mockResolvedValueOnce({ success: true, output: 'ok', error: null, exitCode: 0, attempts: 1, cost: { costUSD: 0.05, numTurns: 3, durationApiMs: 2000, sessionId: 'sess-1' } })
      .mockResolvedValueOnce({ success: true, output: 'ok', error: null, exitCode: 0, attempts: 1, cost: null });

    const result = await executeSteps(steps, '/fake/project');

    expect(result.results[0].cost.costUSD).toBe(0.05);
  });

  it('returns cost: null for failed steps', async () => {
    const steps = [makeStep(1, 'Lint')];

    runPrompt.mockResolvedValue({
      success: false, output: '', error: 'fail', exitCode: -1, attempts: 4, cost: null,
    });

    const result = await executeSteps(steps, '/fake/project');

    expect(result.results[0].cost).toBeNull();
  });

  it('handles steps with no cost data (null) gracefully', async () => {
    const steps = [makeStep(1, 'Lint')];

    runPrompt.mockResolvedValue({
      success: true, output: 'ok', error: null, exitCode: 0, attempts: 1,
    });

    const result = await executeSteps(steps, '/fake/project');

    // When runPrompt returns no cost field, the result should have cost: null
    expect(result.results[0].cost).toBeNull();
  });
});

describe('fast completion detection', () => {
  it('retries when improvement completes suspiciously fast', async () => {
    const step = makeStep(1, 'Lint');

    runPrompt
      // First call: fast success (21 seconds)
      .mockResolvedValueOnce({
        success: true, output: 'too quick', error: null, exitCode: 0,
        attempts: 1, duration: 21_000,
        cost: { costUSD: 0.01, numTurns: 1, durationApiMs: 500, sessionId: 's1' },
      })
      // Second call: retry success (normal duration)
      .mockResolvedValueOnce({
        success: true, output: 'thorough work', error: null, exitCode: 0,
        attempts: 1, duration: 300_000,
        cost: { costUSD: 0.08, numTurns: 5, durationApiMs: 4000, sessionId: 's2' },
      })
      // Third call: doc update
      .mockResolvedValueOnce({
        success: true, output: 'docs updated', error: null, exitCode: 0,
        attempts: 1,
        cost: { costUSD: 0.02, numTurns: 1, durationApiMs: 500, sessionId: 's2' },
      });

    const result = await executeSingleStep(step, '/fake/project');

    expect(result.status).toBe('completed');
    expect(result.suspiciousFast).toBe(true);
    // Uses retry output, not the fast output
    expect(result.output).toBe('thorough work');
    // 3 calls: original improvement + retry + doc update
    expect(runPrompt).toHaveBeenCalledTimes(3);
    // Retry prompt contains the context prefix
    const retryPromptArg = runPrompt.mock.calls[1][0];
    expect(retryPromptArg).toContain('completed it in under 2 minutes');
    expect(retryPromptArg).toContain(step.prompt);
    // Warning logged about suspicious speed
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('suspiciously fast'));
  });

  it('does not retry when improvement takes longer than threshold', async () => {
    const step = makeStep(1, 'Lint');

    runPrompt
      // Improvement: normal duration
      .mockResolvedValueOnce({
        success: true, output: 'ok', error: null, exitCode: 0,
        attempts: 1, duration: 300_000,
      })
      // Doc update
      .mockResolvedValueOnce({
        success: true, output: 'docs ok', error: null, exitCode: 0,
        attempts: 1,
      });

    const result = await executeSingleStep(step, '/fake/project');

    expect(result.status).toBe('completed');
    expect(result.suspiciousFast).toBeUndefined();
    // 2 calls only: improvement + doc update (no retry)
    expect(runPrompt).toHaveBeenCalledTimes(2);
  });

  it('does not check fast completion on failed improvement', async () => {
    const step = makeStep(1, 'Lint');

    runPrompt.mockResolvedValue({
      success: false, output: '', error: 'crash', exitCode: 1,
      attempts: 4, duration: 5_000,
    });

    const result = await executeSingleStep(step, '/fake/project');

    expect(result.status).toBe('failed');
    // Only 1 call (the failed improvement) — no retry, no doc update
    expect(runPrompt).toHaveBeenCalledTimes(1);
    expect(result.suspiciousFast).toBeUndefined();
  });

  it('falls back to original result when fast-retry fails', async () => {
    const step = makeStep(1, 'Lint');

    runPrompt
      // Original: fast success
      .mockResolvedValueOnce({
        success: true, output: 'quick but valid', error: null, exitCode: 0,
        attempts: 1, duration: 15_000,
        cost: { costUSD: 0.01, numTurns: 1, durationApiMs: 300, sessionId: 's1' },
      })
      // Retry: fails
      .mockResolvedValueOnce({
        success: false, output: '', error: 'timeout', exitCode: -1,
        attempts: 4, duration: 180_000,
        cost: { costUSD: 0.05, numTurns: 3, durationApiMs: 2000, sessionId: 's2' },
      })
      // Doc update still runs (using original session)
      .mockResolvedValueOnce({
        success: true, output: 'docs ok', error: null, exitCode: 0,
        attempts: 1, cost: null,
      });

    const result = await executeSingleStep(step, '/fake/project');

    expect(result.status).toBe('completed');
    expect(result.suspiciousFast).toBe(true);
    // Falls back to original output
    expect(result.output).toBe('quick but valid');
    // Warning logged about fallback
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('fast-retry failed'));
  });

  it('sums costs from fast attempt and retry attempt', async () => {
    const step = makeStep(1, 'Lint');
    const fastCost = { costUSD: 0.01, numTurns: 1, durationApiMs: 500, sessionId: 's1' };
    const retryCost = { costUSD: 0.08, numTurns: 5, durationApiMs: 4000, sessionId: 's2' };
    const docCost = { costUSD: 0.02, numTurns: 1, durationApiMs: 300, sessionId: 's2' };

    runPrompt
      .mockResolvedValueOnce({ success: true, output: 'fast', error: null, exitCode: 0, attempts: 1, duration: 10_000, cost: fastCost })
      .mockResolvedValueOnce({ success: true, output: 'thorough', error: null, exitCode: 0, attempts: 1, duration: 300_000, cost: retryCost })
      .mockResolvedValueOnce({ success: true, output: 'docs', error: null, exitCode: 0, attempts: 1, cost: docCost });

    const result = await executeSingleStep(step, '/fake/project');

    // Total cost = fast + retry + doc = 0.01 + 0.08 + 0.02 = 0.11
    expect(result.cost.costUSD).toBeCloseTo(0.11);
    expect(result.cost.numTurns).toBe(7);
    expect(result.cost.durationApiMs).toBe(4800);
  });

  it('attempts count includes both fast attempt and retry', async () => {
    const step = makeStep(1, 'Lint');

    runPrompt
      .mockResolvedValueOnce({ success: true, output: 'fast', error: null, exitCode: 0, attempts: 1, duration: 10_000 })
      .mockResolvedValueOnce({ success: true, output: 'thorough', error: null, exitCode: 0, attempts: 1, duration: 300_000 })
      .mockResolvedValueOnce({ success: true, output: 'docs', error: null, exitCode: 0, attempts: 1 });

    const result = await executeSingleStep(step, '/fake/project');

    // 1 (fast) + 1 (retry) = 2 attempts for the improvement phase
    expect(result.attempts).toBe(2);
  });
});

describe('executeSingleStep continueSession and promptOverride', () => {
  it('passes continueSession to improvement runPrompt when provided', async () => {
    const step = makeStep(1, 'Lint');
    runPrompt.mockResolvedValue({
      success: true, output: 'ok', error: null, exitCode: 0, attempts: 1, duration: 300_000, cost: null,
    });

    await executeSingleStep(step, '/fake/project', { continueSession: true });

    // First call (improvement) should have continueSession: true
    expect(runPrompt.mock.calls[0][2].continueSession).toBe(true);
    // Label should include (prod) suffix
    expect(runPrompt.mock.calls[0][2].label).toContain('(prod)');
  });

  it('uses promptOverride instead of SAFETY_PREAMBLE + step.prompt', async () => {
    const step = makeStep(1, 'Lint');
    const override = 'CUSTOM_OVERRIDE_PROMPT';
    runPrompt.mockResolvedValue({
      success: true, output: 'ok', error: null, exitCode: 0, attempts: 1, duration: 300_000, cost: null,
    });

    await executeSingleStep(step, '/fake/project', { promptOverride: override });

    // First call uses the override prompt
    expect(runPrompt.mock.calls[0][0]).toBe(override);
    // Doc-update (second call) still uses the standard prompt
    expect(runPrompt.mock.calls[1][0]).toContain('mock doc update prompt');
  });

  it('skips fast-completion detection when continueSession is true', async () => {
    const step = makeStep(1, 'Lint');
    // Return success in under 2 minutes (would normally trigger fast-retry)
    runPrompt
      .mockResolvedValueOnce({
        success: true, output: 'ok', error: null, exitCode: 0, attempts: 1, duration: 30_000, cost: null,
      })
      .mockResolvedValueOnce({
        success: true, output: 'docs', error: null, exitCode: 0, attempts: 1, duration: 5_000, cost: null,
      });

    await executeSingleStep(step, '/fake/project', { continueSession: true });

    // Only 2 calls: improvement + doc-update (no fast-retry)
    expect(runPrompt).toHaveBeenCalledTimes(2);
    // No warning about suspicious fast
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('suspiciously fast'));
  });

  it('defaults continueSession to falsy for improvement prompt', async () => {
    const step = makeStep(1, 'Lint');
    runPrompt.mockResolvedValue({
      success: true, output: 'ok', error: null, exitCode: 0, attempts: 1, duration: 300_000, cost: null,
    });

    await executeSingleStep(step, '/fake/project');

    const firstCallOpts = runPrompt.mock.calls[0][2];
    expect(firstCallOpts.continueSession).toBeFalsy();
    // Label should NOT include (prod) suffix
    expect(firstCallOpts.label).not.toContain('(prod)');
  });
});

describe('executeSingleStep errorType propagation', () => {
  it('propagates errorType and retryAfterMs from rate-limit failure', async () => {
    const step = makeStep(1, 'Documentation');

    runPrompt.mockResolvedValueOnce({
      success: false,
      output: '',
      error: 'rate limited',
      exitCode: -1,
      attempts: 4,
      errorType: 'rate_limit',
      retryAfterMs: 60000,
    });

    const result = await executeSingleStep(step, '/fake/project');

    expect(result.status).toBe('failed');
    expect(result.errorType).toBe('rate_limit');
    expect(result.retryAfterMs).toBe(60000);
  });

  it('does not include errorType on a regular failure', async () => {
    const step = makeStep(2, 'Lint');

    runPrompt.mockResolvedValueOnce({
      success: false,
      output: '',
      error: 'timeout',
      exitCode: -1,
      attempts: 4,
    });

    const result = await executeSingleStep(step, '/fake/project');

    expect(result.status).toBe('failed');
    expect(result.errorType).toBeUndefined();
    expect(result.retryAfterMs).toBeUndefined();
  });
});

describe('executeSingleStep step-level timeout', () => {
  it('aborts the step when total time exceeds the step timeout', async () => {
    const step = makeStep(1, 'Lint');
    const stepTimeout = 500; // 500ms for test speed

    // Improvement prompt: simulate a slow response that takes longer than the step timeout.
    // The runPrompt mock checks the signal — if aborted, returns failure.
    runPrompt.mockImplementation(async (_prompt, _dir, opts) => {
      // Wait longer than the step timeout
      await new Promise(resolve => setTimeout(resolve, stepTimeout + 200));
      if (opts.signal?.aborted) {
        return { success: false, output: '', error: 'Aborted by user', exitCode: -1, attempts: 1 };
      }
      return { success: true, output: 'ok', error: null, exitCode: 0, attempts: 1, duration: 300_000 };
    });

    const result = await executeSingleStep(step, '/fake/project', { timeout: stepTimeout });

    expect(result.status).toBe('failed');
    // Should only call runPrompt once (improvement) — no doc-update because it failed
    expect(runPrompt).toHaveBeenCalledTimes(1);
  });

  it('provides an AbortSignal even when no external signal is passed', async () => {
    const step = makeStep(1, 'Lint');

    runPrompt.mockResolvedValue({ success: true, output: 'ok', error: null, exitCode: 0, attempts: 1, duration: 300_000 });

    await executeSingleStep(step, '/fake/project');

    // The step-level timeout creates its own signal
    for (const call of runPrompt.mock.calls) {
      expect(call[2].signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('clears the step timer on normal completion', async () => {
    const step = makeStep(1, 'Lint');

    runPrompt.mockResolvedValue({ success: true, output: 'ok', error: null, exitCode: 0, attempts: 1, duration: 300_000 });

    const result = await executeSingleStep(step, '/fake/project', { timeout: 60_000 });

    // Step should complete normally — the timer should be cleared in finally block
    expect(result.status).toBe('completed');
  });

  it('logs a warning when step timeout fires', async () => {
    const step = makeStep(1, 'Lint');
    const stepTimeout = 500;

    runPrompt.mockImplementation(async (_prompt, _dir, opts) => {
      await new Promise(resolve => setTimeout(resolve, stepTimeout + 200));
      if (opts.signal?.aborted) {
        return { success: false, output: '', error: 'Aborted by user', exitCode: -1, attempts: 1 };
      }
      return { success: true, output: 'ok', error: null, exitCode: 0, attempts: 1, duration: 300_000 };
    });

    await executeSingleStep(step, '/fake/project', { timeout: stepTimeout });

    // Check that a warning about step timeout was logged
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('step timeout'));
  });
});

describe('executeSteps rate-limit handling', () => {
  it('calls onRateLimitPause with retryAfterMs when step hits rate limit', async () => {
    const steps = [makeStep(1, 'Documentation')];
    const onRateLimitPause = vi.fn();
    const onRateLimitResume = vi.fn();

    runPrompt
      // Step 1 improvement: rate-limit failure
      .mockResolvedValueOnce({
        success: false, output: '', error: 'rate limited', exitCode: -1, attempts: 4,
        errorType: 'rate_limit', retryAfterMs: 120000,
      })
      // Probe call from waitForRateLimit (uses backoff since retryAfterMs goes through the
      // server-provided path which does NOT probe — this test uses retryAfterMs path)
      // Actually: with retryAfterMs set, waitForRateLimit sleeps then returns true without probing
      // So after resume, the step is retried directly:
      // Step 1 retry improvement: success
      .mockResolvedValueOnce({
        success: true, output: 'done', error: null, exitCode: 0, attempts: 1, duration: 300_000,
      })
      // Step 1 retry doc update: success
      .mockResolvedValueOnce({
        success: true, output: 'docs', error: null, exitCode: 0, attempts: 1,
      });

    const result = await executeSteps(steps, '/fake/project', {
      onRateLimitPause,
      onRateLimitResume,
    });

    expect(onRateLimitPause).toHaveBeenCalledTimes(1);
    expect(onRateLimitPause).toHaveBeenCalledWith(120000, expect.objectContaining({
      results: expect.any(Array),
      completedCount: expect.any(Number),
      failedCount: expect.any(Number),
      currentStepIndex: expect.any(Number),
    }));
  });

  it('retries the step after rate-limit pause resolves with retryAfterMs', async () => {
    const steps = [makeStep(1, 'Documentation')];
    const onRateLimitPause = vi.fn();
    const onRateLimitResume = vi.fn();

    runPrompt
      // Step 1 improvement: rate-limit failure
      .mockResolvedValueOnce({
        success: false, output: '', error: 'rate limited', exitCode: -1, attempts: 4,
        errorType: 'rate_limit', retryAfterMs: 60000,
      })
      // After waitForRateLimit (retryAfterMs path: sleep then return true, no probe),
      // Step 1 retry improvement: success
      .mockResolvedValueOnce({
        success: true, output: 'retried ok', error: null, exitCode: 0, attempts: 1, duration: 300_000,
      })
      // Step 1 retry doc update: success
      .mockResolvedValueOnce({
        success: true, output: 'docs ok', error: null, exitCode: 0, attempts: 1,
      });

    const result = await executeSteps(steps, '/fake/project', {
      onRateLimitPause,
      onRateLimitResume,
    });

    // The failed result was popped and the step retried successfully
    expect(result.completedCount).toBe(1);
    expect(result.failedCount).toBe(0);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].status).toBe('completed');
    expect(result.results[0].output).toBe('retried ok');

    // sleep was called with retryAfterMs + 10s buffer
    expect(sleep).toHaveBeenCalledWith(70000, undefined);
  });

  it('retries after probe-based backoff when retryAfterMs is not provided', async () => {
    const steps = [makeStep(1, 'Documentation')];
    const onRateLimitPause = vi.fn();
    const onRateLimitResume = vi.fn();

    runPrompt
      // Step 1 improvement: rate-limit failure (no retryAfterMs)
      .mockResolvedValueOnce({
        success: false, output: '', error: 'rate limited', exitCode: -1, attempts: 4,
        errorType: 'rate_limit',
      })
      // Probe call from waitForRateLimit: success
      .mockResolvedValueOnce({
        success: true, output: 'OK', error: null, exitCode: 0, attempts: 1,
      })
      // Step 1 retry improvement: success
      .mockResolvedValueOnce({
        success: true, output: 'retried ok', error: null, exitCode: 0, attempts: 1, duration: 300_000,
      })
      // Step 1 retry doc update: success
      .mockResolvedValueOnce({
        success: true, output: 'docs ok', error: null, exitCode: 0, attempts: 1,
      });

    const result = await executeSteps(steps, '/fake/project', {
      onRateLimitPause,
      onRateLimitResume,
    });

    // Step retried successfully
    expect(result.completedCount).toBe(1);
    expect(result.failedCount).toBe(0);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].status).toBe('completed');

    // Probe call used the rate-limit-probe label
    const probeCall = runPrompt.mock.calls.find(
      call => call[2]?.label === 'rate-limit-probe'
    );
    expect(probeCall).toBeDefined();
    expect(probeCall[0]).toBe('Reply with the single word OK.');
    expect(probeCall[2]).toHaveProperty('retries', 0);

    // sleep was called with the first backoff interval (2 minutes)
    expect(sleep).toHaveBeenCalledWith(2 * 60_000, undefined);
  });

  it('calls onRateLimitResume after successful rate-limit recovery', async () => {
    const steps = [makeStep(1, 'Documentation')];
    const onRateLimitPause = vi.fn();
    const onRateLimitResume = vi.fn();

    runPrompt
      // Step 1 improvement: rate-limit failure
      .mockResolvedValueOnce({
        success: false, output: '', error: 'rate limited', exitCode: -1, attempts: 4,
        errorType: 'rate_limit', retryAfterMs: 30000,
      })
      // Step 1 retry improvement: success
      .mockResolvedValueOnce({
        success: true, output: 'done', error: null, exitCode: 0, attempts: 1, duration: 300_000,
      })
      // Step 1 retry doc update: success
      .mockResolvedValueOnce({
        success: true, output: 'docs', error: null, exitCode: 0, attempts: 1,
      });

    await executeSteps(steps, '/fake/project', {
      onRateLimitPause,
      onRateLimitResume,
    });

    expect(onRateLimitResume).toHaveBeenCalledTimes(1);
    // onRateLimitResume is called after onRateLimitPause
    const pauseOrder = onRateLimitPause.mock.invocationCallOrder[0];
    const resumeOrder = onRateLimitResume.mock.invocationCallOrder[0];
    expect(resumeOrder).toBeGreaterThan(pauseOrder);
  });

  it('stops the run when abort fires during rate-limit wait', async () => {
    const steps = [makeStep(1, 'Documentation'), makeStep(2, 'Lint')];
    const controller = new AbortController();
    const onRateLimitPause = vi.fn();
    const onRateLimitResume = vi.fn();

    // Make sleep abort-aware: when the signal is already aborted, resolve immediately
    sleep.mockImplementation((ms, sig) => {
      // Simulate: abort fires during sleep
      controller.abort();
      return Promise.resolve();
    });

    runPrompt
      // Step 1 improvement: rate-limit failure
      .mockResolvedValueOnce({
        success: false, output: '', error: 'rate limited', exitCode: -1, attempts: 4,
        errorType: 'rate_limit', retryAfterMs: 60000,
      });

    const result = await executeSteps(steps, '/fake/project', {
      signal: controller.signal,
      onRateLimitPause,
      onRateLimitResume,
    });

    // Run stopped — no retry, no resume callback
    expect(onRateLimitPause).toHaveBeenCalledTimes(1);
    expect(onRateLimitResume).not.toHaveBeenCalled();
    // Only the failed rate-limited result remains (not popped because waitForRateLimit returned false)
    // Actually: waitForRateLimit returns false, so the loop breaks without popping
    // The results array has the original failed result still in it
    expect(result.results).toHaveLength(1);
    expect(result.results[0].status).toBe('failed');
    // Step 2 never ran
    expect(result.completedCount).toBe(0);

    // Reset sleep mock to default for other tests
    sleep.mockImplementation(() => Promise.resolve());
  });

  it('stops the run when all backoff probes are exhausted', async () => {
    const steps = [makeStep(1, 'Documentation')];
    const onRateLimitPause = vi.fn();
    const onRateLimitResume = vi.fn();

    // Step 1: rate-limit failure (no retryAfterMs — triggers backoff loop)
    const calls = [
      {
        success: false, output: '', error: 'rate limited', exitCode: -1, attempts: 4,
        errorType: 'rate_limit',
      },
    ];
    // 9 probe attempts all fail with rate_limit (extended backoff schedule)
    for (let i = 0; i < 9; i++) {
      calls.push({
        success: false, output: '', error: 'still rate limited', exitCode: -1, attempts: 1,
        errorType: 'rate_limit',
      });
    }

    let callIndex = 0;
    runPrompt.mockImplementation(() => Promise.resolve(calls[callIndex++]));

    const result = await executeSteps(steps, '/fake/project', {
      onRateLimitPause,
      onRateLimitResume,
    });

    // All probes exhausted — run stopped
    expect(onRateLimitPause).toHaveBeenCalledTimes(1);
    expect(onRateLimitResume).not.toHaveBeenCalled();
    expect(result.completedCount).toBe(0);
    // The failed result stays in results (not popped because resumed=false)
    expect(result.results).toHaveLength(1);
    expect(result.results[0].status).toBe('failed');
  });

  it('does not call rate-limit callbacks for non-rate-limit failures', async () => {
    const steps = [makeStep(1, 'Lint'), makeStep(2, 'Docs')];
    const onRateLimitPause = vi.fn();
    const onRateLimitResume = vi.fn();

    runPrompt
      // Step 1: regular failure (no errorType)
      .mockResolvedValueOnce({
        success: false, output: '', error: 'timeout', exitCode: -1, attempts: 4,
      })
      // Step 2: success
      .mockResolvedValueOnce({
        success: true, output: 'ok', error: null, exitCode: 0, attempts: 1, duration: 300_000,
      })
      // Step 2 doc update
      .mockResolvedValueOnce({
        success: true, output: 'docs', error: null, exitCode: 0, attempts: 1,
      });

    const result = await executeSteps(steps, '/fake/project', {
      onRateLimitPause,
      onRateLimitResume,
    });

    // Regular failure goes through normal path — no rate-limit callbacks
    expect(onRateLimitPause).not.toHaveBeenCalled();
    expect(onRateLimitResume).not.toHaveBeenCalled();
    expect(result.failedCount).toBe(1);
    expect(result.completedCount).toBe(1);
  });

  it('includes snapshot with results data in onRateLimitPause callback', async () => {
    const steps = [makeStep(1, 'Lint'), makeStep(2, 'Format')];
    const onRateLimitPause = vi.fn();

    runPrompt
      // Step 1 improvement: success
      .mockResolvedValueOnce({
        success: true, output: 'lint done', error: null, exitCode: 0, attempts: 1, duration: 300_000,
      })
      // Step 1 doc update
      .mockResolvedValueOnce({
        success: true, output: 'docs1', error: null, exitCode: 0, attempts: 1,
      })
      // Step 2 improvement: rate-limit failure
      .mockResolvedValueOnce({
        success: false, output: '', error: 'rate limited', exitCode: -1, attempts: 4,
        errorType: 'rate_limit', retryAfterMs: 60000,
      })
      // waitForRateLimit sleeps (retryAfterMs provided) — no probe call needed
      // Step 2 retry improvement: success
      .mockResolvedValueOnce({
        success: true, output: 'format done', error: null, exitCode: 0, attempts: 1, duration: 300_000,
      })
      // Step 2 retry doc update
      .mockResolvedValueOnce({
        success: true, output: 'docs2', error: null, exitCode: 0, attempts: 1,
      });

    await executeSteps(steps, '/fake/project', { onRateLimitPause });

    const snapshot = onRateLimitPause.mock.calls[0][1];
    expect(snapshot).toBeDefined();
    expect(snapshot.completedCount).toBe(1);
    expect(snapshot.failedCount).toBe(0);
    expect(snapshot.currentStepIndex).toBe(1);
    expect(snapshot.results).toHaveLength(2); // completed Step 1 + failed Step 2
    expect(snapshot.results[0].status).toBe('completed');
    expect(snapshot.results[1].status).toBe('failed');
    expect(snapshot.results[1].errorType).toBe('rate_limit');
  });

  it('continues with remaining steps after rate-limit recovery', async () => {
    const steps = [makeStep(1, 'Lint'), makeStep(2, 'Format')];
    const onRateLimitPause = vi.fn();
    const onRateLimitResume = vi.fn();

    runPrompt
      // Step 1 improvement: rate-limit failure
      .mockResolvedValueOnce({
        success: false, output: '', error: 'rate limited', exitCode: -1, attempts: 4,
        errorType: 'rate_limit', retryAfterMs: 30000,
      })
      // Step 1 retry improvement: success
      .mockResolvedValueOnce({
        success: true, output: 'step1 done', error: null, exitCode: 0, attempts: 1, duration: 300_000,
      })
      // Step 1 retry doc update: success
      .mockResolvedValueOnce({
        success: true, output: 'docs1', error: null, exitCode: 0, attempts: 1,
      })
      // Step 2 improvement: success
      .mockResolvedValueOnce({
        success: true, output: 'step2 done', error: null, exitCode: 0, attempts: 1, duration: 300_000,
      })
      // Step 2 doc update: success
      .mockResolvedValueOnce({
        success: true, output: 'docs2', error: null, exitCode: 0, attempts: 1,
      });

    const result = await executeSteps(steps, '/fake/project', {
      onRateLimitPause,
      onRateLimitResume,
    });

    // Both steps completed after rate-limit recovery on step 1
    expect(result.completedCount).toBe(2);
    expect(result.failedCount).toBe(0);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].output).toBe('step1 done');
    expect(result.results[1].output).toBe('step2 done');
  });
});

describe('copyPromptsToProject', () => {
  let tmpDir;
  const savedSteps = [];

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'nt-test-prompts-'));
    // Save original (empty) STEPS so we can restore after each test
    savedSteps.length = 0;
    savedSteps.push(...loader.STEPS);
  });

  afterEach(async () => {
    // Restore original STEPS
    loader.STEPS.length = 0;
    loader.STEPS.push(...savedSteps);
    if (tmpDir) await robustCleanup(tmpDir);
  });

  function setSteps(...steps) {
    loader.STEPS.length = 0;
    loader.STEPS.push(...steps);
  }

  it('creates audit-reports/refactor-prompts directory and writes all prompt files', () => {
    setSteps(makeStep(1, 'Documentation'), makeStep(5, 'Test Consolidation'));

    copyPromptsToProject(tmpDir);

    const promptsDir = path.join(tmpDir, 'audit-reports', 'refactor-prompts');
    expect(existsSync(promptsDir)).toBe(true);

    const files = readdirSync(promptsDir).sort();
    expect(files).toEqual(['01-documentation.md', '05-test-consolidation.md']);

    expect(readFileSync(path.join(promptsDir, '01-documentation.md'), 'utf8')).toBe('prompt for Documentation');
    expect(readFileSync(path.join(promptsDir, '05-test-consolidation.md'), 'utf8')).toBe('prompt for Test Consolidation');
  });

  it('handles step names with special characters', () => {
    setSteps(makeStep(7, 'API Design'), makeStep(24, 'UI/UX Audit'));

    copyPromptsToProject(tmpDir);

    const files = readdirSync(path.join(tmpDir, 'audit-reports', 'refactor-prompts')).sort();
    expect(files).toEqual(['07-api-design.md', '24-ui-ux-audit.md']);
  });

  it('creates nested directories even if audit-reports does not exist', () => {
    setSteps(makeStep(1, 'Docs'));

    copyPromptsToProject(tmpDir);

    expect(existsSync(path.join(tmpDir, 'audit-reports', 'refactor-prompts', '01-docs.md'))).toBe(true);
  });

  it('overwrites existing prompt files when content changes', () => {
    setSteps({ number: 1, name: 'Documentation', prompt: 'version 1' });
    copyPromptsToProject(tmpDir);

    setSteps({ number: 1, name: 'Documentation', prompt: 'version 2' });
    copyPromptsToProject(tmpDir);

    const content = readFileSync(path.join(tmpDir, 'audit-reports', 'refactor-prompts', '01-documentation.md'), 'utf8');
    expect(content).toBe('version 2');
  });

  it('removes stale files from renamed prompts', () => {
    const promptsDir = path.join(tmpDir, 'audit-reports', 'refactor-prompts');

    // First run with old name
    setSteps({ number: 3, name: 'Old Name', prompt: 'content' });
    copyPromptsToProject(tmpDir);
    expect(readdirSync(promptsDir)).toEqual(['03-old-name.md']);

    // Second run with renamed prompt
    setSteps({ number: 3, name: 'New Name', prompt: 'content' });
    copyPromptsToProject(tmpDir);

    const files = readdirSync(promptsDir);
    expect(files).toEqual(['03-new-name.md']);
    expect(existsSync(path.join(promptsDir, '03-old-name.md'))).toBe(false);
  });

  it('preserves non-markdown files in the directory', () => {
    const promptsDir = path.join(tmpDir, 'audit-reports', 'refactor-prompts');
    mkdirSync(promptsDir, { recursive: true });
    writeFileSync(path.join(promptsDir, 'notes.txt'), 'keep me', 'utf8');

    setSteps(makeStep(1, 'Docs'));
    copyPromptsToProject(tmpDir);

    const files = readdirSync(promptsDir).sort();
    expect(files).toContain('notes.txt');
    expect(files).toContain('01-docs.md');
  });

  it('warns but does not throw on write failure', () => {
    setSteps(makeStep(1, 'Test'));
    copyPromptsToProject(path.join(tmpDir, '\0invalid'));

    expect(warn).toHaveBeenCalled();
  });

  it('creates empty directory when STEPS is empty', () => {
    setSteps(); // no steps

    copyPromptsToProject(tmpDir);

    const promptsDir = path.join(tmpDir, 'audit-reports', 'refactor-prompts');
    expect(existsSync(promptsDir)).toBe(true);
    expect(readdirSync(promptsDir)).toEqual([]);
  });
});
