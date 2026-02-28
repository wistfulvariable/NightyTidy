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

vi.mock('../src/logger.js', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../src/prompts/steps.js', () => ({
  DOC_UPDATE_PROMPT: 'mock doc update prompt',
}));

import { executeSteps } from '../src/executor.js';
import { runPrompt } from '../src/claude.js';
import { getHeadHash, hasNewCommit, fallbackCommit } from '../src/git.js';
import { notify } from '../src/notifications.js';
import { warn } from '../src/logger.js';

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
});
