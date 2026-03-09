import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/claude.js', () => ({
  runPrompt: vi.fn(),
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
}));

import { executeSteps, executeSingleStep, FAST_COMPLETION_THRESHOLD_MS } from '../src/executor.js';
import { runPrompt } from '../src/claude.js';
import { getHeadHash, hasNewCommit, fallbackCommit } from '../src/git.js';
import { notify } from '../src/notifications.js';
import { warn, info } from '../src/logger.js';

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

    expect(fallbackCommit).toHaveBeenCalledTimes(1);
    expect(fallbackCommit).toHaveBeenCalledWith(5, 'Refactor');
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

  it('passes the abort signal to runPrompt', async () => {
    const steps = [makeStep(1, 'Lint')];
    const controller = new AbortController();

    runPrompt.mockResolvedValue({ success: true, output: 'ok', error: null, exitCode: 0, attempts: 1 });

    await executeSteps(steps, '/fake/project', { signal: controller.signal });

    // Both the improvement and doc-update calls should receive the signal
    expect(runPrompt).toHaveBeenCalledTimes(2);
    for (const call of runPrompt.mock.calls) {
      expect(call[2]).toHaveProperty('signal', controller.signal);
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
