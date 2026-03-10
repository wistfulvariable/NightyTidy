/**
 * Extended tests for src/executor.js — covers additional edge cases
 * for better branch coverage.
 *
 * Tests added for:
 * - fallbackCommit error path (lines 159-161)
 * - waitForRateLimit probe returning non-rate-limit error (lines 216-220)
 * - Empty steps array
 * - Steps integrity check with hash mismatch
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Store original STEPS_HASH
let originalStepsHash;

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
  STEPS: [
    { number: 1, name: 'Test Step', prompt: 'test prompt content' },
  ],
  DOC_UPDATE_PROMPT: 'mock doc update prompt',
}));

import { executeSteps, executeSingleStep } from '../src/executor.js';
import { runPrompt, sleep } from '../src/claude.js';
import { getHeadHash, hasNewCommit, fallbackCommit } from '../src/git.js';
import { warn, error as logError, info } from '../src/logger.js';

function makeStep(number, name = `Step ${number}`) {
  return { number, name, prompt: `prompt for ${name}` };
}

beforeEach(() => {
  vi.clearAllMocks();
  getHeadHash.mockResolvedValue('abc123');
  hasNewCommit.mockResolvedValue(true);
  fallbackCommit.mockResolvedValue(true);
});

describe('executor.js extended', () => {
  describe('fallbackCommit error handling', () => {
    it('logs warning when fallbackCommit throws', async () => {
      const step = makeStep(1, 'Lint');

      runPrompt
        .mockResolvedValueOnce({ success: true, output: 'ok', error: null, exitCode: 0, attempts: 1, duration: 300_000 })
        .mockResolvedValueOnce({ success: true, output: 'docs', error: null, exitCode: 0, attempts: 1 });

      hasNewCommit.mockResolvedValue(false);
      fallbackCommit.mockRejectedValue(new Error('git add failed: permission denied'));

      const result = await executeSingleStep(step, '/fake/project');

      expect(result.status).toBe('completed');
      expect(fallbackCommit).toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('fallback commit failed'));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('permission denied'));
    });

    it('continues successfully even when fallbackCommit throws', async () => {
      const steps = [makeStep(1, 'Lint'), makeStep(2, 'Format')];

      runPrompt.mockResolvedValue({ success: true, output: 'ok', error: null, exitCode: 0, attempts: 1, duration: 300_000 });
      hasNewCommit.mockResolvedValue(false);
      fallbackCommit.mockRejectedValue(new Error('git error'));

      const result = await executeSteps(steps, '/fake/project');

      // Both steps should complete despite fallbackCommit errors
      expect(result.completedCount).toBe(2);
      expect(result.failedCount).toBe(0);
      // Verify fallback commit errors were logged (there's also a hash mismatch warning)
      const fallbackWarnings = warn.mock.calls.filter(c => c[0]?.includes('fallback commit'));
      expect(fallbackWarnings).toHaveLength(2); // Once per step
    });
  });

  describe('rate-limit probe edge cases', () => {
    it('resumes when probe returns a non-rate-limit error', async () => {
      const steps = [makeStep(1, 'Documentation')];
      const onRateLimitPause = vi.fn();
      const onRateLimitResume = vi.fn();

      runPrompt
        // Step 1: rate-limit failure (no retryAfterMs — triggers backoff)
        .mockResolvedValueOnce({
          success: false, output: '', error: 'rate limited', exitCode: -1, attempts: 4,
          errorType: 'rate_limit',
        })
        // Probe: returns a different error type (not rate_limit)
        .mockResolvedValueOnce({
          success: false, output: '', error: 'network timeout', exitCode: -1, attempts: 1,
          errorType: 'unknown', // NOT 'rate_limit'
        })
        // Step 1 retry: success
        .mockResolvedValueOnce({
          success: true, output: 'done', error: null, exitCode: 0, attempts: 1, duration: 300_000,
        })
        // Step 1 doc update
        .mockResolvedValueOnce({
          success: true, output: 'docs', error: null, exitCode: 0, attempts: 1,
        });

      const result = await executeSteps(steps, '/fake/project', {
        onRateLimitPause,
        onRateLimitResume,
      });

      // Should resume because the probe error was not rate_limit
      expect(onRateLimitResume).toHaveBeenCalled();
      expect(result.completedCount).toBe(1);
      expect(info).toHaveBeenCalledWith(expect.stringContaining('non-rate-limit error'));
    });
  });

  describe('empty steps array', () => {
    it('handles empty steps array without error', async () => {
      const result = await executeSteps([], '/fake/project');

      expect(result.completedCount).toBe(0);
      expect(result.failedCount).toBe(0);
      expect(result.results).toHaveLength(0);
      expect(result.totalDuration).toBeGreaterThanOrEqual(0);
      expect(runPrompt).not.toHaveBeenCalled();
    });
  });

  describe('abort signal already aborted at start', () => {
    it('does not run any steps when signal is already aborted', async () => {
      const steps = [makeStep(1, 'Lint'), makeStep(2, 'Format')];
      const controller = new AbortController();
      controller.abort(); // Abort immediately

      runPrompt.mockResolvedValue({ success: true, output: 'ok', error: null, exitCode: 0, attempts: 1 });

      const result = await executeSteps(steps, '/fake/project', {
        signal: controller.signal,
      });

      expect(result.results).toHaveLength(0);
      expect(result.completedCount).toBe(0);
      expect(runPrompt).not.toHaveBeenCalled();
    });
  });

  describe('steps integrity check', () => {
    it('logs warning when prompt hash does not match STEPS_HASH', async () => {
      // The mocked STEPS have different content than the real STEPS_HASH
      // so the integrity check should warn
      const steps = [makeStep(1, 'Lint')];

      runPrompt.mockResolvedValue({ success: true, output: 'ok', error: null, exitCode: 0, attempts: 1, duration: 300_000 });

      await executeSteps(steps, '/fake/project');

      // Should have logged a warning about hash mismatch
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('prompt content hash mismatch')
      );
    });
  });

  describe('callback invocation', () => {
    it('calls onStepStart with correct arguments', async () => {
      const steps = [makeStep(1, 'Lint'), makeStep(2, 'Format')];
      const onStepStart = vi.fn();

      runPrompt.mockResolvedValue({ success: true, output: 'ok', error: null, exitCode: 0, attempts: 1, duration: 300_000 });

      await executeSteps(steps, '/fake/project', { onStepStart });

      expect(onStepStart).toHaveBeenCalledTimes(2);
      expect(onStepStart).toHaveBeenNthCalledWith(1, steps[0], 0, 2);
      expect(onStepStart).toHaveBeenNthCalledWith(2, steps[1], 1, 2);
    });

    it('calls onStepComplete with correct arguments', async () => {
      const steps = [makeStep(1, 'Lint')];
      const onStepComplete = vi.fn();

      runPrompt.mockResolvedValue({ success: true, output: 'ok', error: null, exitCode: 0, attempts: 1, duration: 300_000 });

      await executeSteps(steps, '/fake/project', { onStepComplete });

      expect(onStepComplete).toHaveBeenCalledTimes(1);
      expect(onStepComplete).toHaveBeenCalledWith(steps[0], 0, 1);
    });

    it('calls onStepFail with correct arguments for non-rate-limit failure', async () => {
      const steps = [makeStep(1, 'Lint')];
      const onStepFail = vi.fn();

      runPrompt.mockResolvedValue({
        success: false, output: '', error: 'timeout', exitCode: -1, attempts: 4,
      });

      await executeSteps(steps, '/fake/project', { onStepFail });

      expect(onStepFail).toHaveBeenCalledTimes(1);
      expect(onStepFail).toHaveBeenCalledWith(steps[0], 0, 1);
    });
  });

  describe('cost handling edge cases', () => {
    it('handles cost with only inputTokens and outputTokens', async () => {
      const steps = [makeStep(1, 'Lint')];
      const improvementCost = { costUSD: 0.05, inputTokens: 1000, outputTokens: 500, numTurns: 2, durationApiMs: 1000, sessionId: 's1' };
      const docCost = { costUSD: 0.02, inputTokens: 200, outputTokens: 100, numTurns: 1, durationApiMs: 300, sessionId: 's1' };

      runPrompt
        .mockResolvedValueOnce({ success: true, output: 'ok', error: null, exitCode: 0, attempts: 1, duration: 300_000, cost: improvementCost })
        .mockResolvedValueOnce({ success: true, output: 'docs', error: null, exitCode: 0, attempts: 1, cost: docCost });

      const result = await executeSteps(steps, '/fake/project');

      expect(result.results[0].cost).toEqual({
        costUSD: 0.07,
        inputTokens: 1200,
        outputTokens: 600,
        numTurns: 3,
        durationApiMs: 1300,
        sessionId: 's1',
      });
    });

    it('handles null inputTokens and outputTokens in cost', async () => {
      const steps = [makeStep(1, 'Lint')];
      const cost = { costUSD: 0.05, inputTokens: null, outputTokens: null, numTurns: 2, durationApiMs: 1000 };

      runPrompt
        .mockResolvedValueOnce({ success: true, output: 'ok', error: null, exitCode: 0, attempts: 1, duration: 300_000, cost })
        .mockResolvedValueOnce({ success: true, output: 'docs', error: null, exitCode: 0, attempts: 1, cost: null });

      const result = await executeSteps(steps, '/fake/project');

      expect(result.results[0].cost.inputTokens).toBeNull();
      expect(result.results[0].cost.outputTokens).toBeNull();
    });

    it('handles missing costUSD field in first cost object (mutation-killing test)', async () => {
      // This test kills the mutation: (a.costUSD || 0) -> (a.costUSD || 1)
      const steps = [makeStep(1, 'Lint')];
      // First cost has no costUSD, second has valid costUSD
      const improvementCost = { inputTokens: 100, outputTokens: 50, numTurns: 1, durationApiMs: 500, sessionId: 's1' };
      const docCost = { costUSD: 0.02, inputTokens: 50, outputTokens: 25, numTurns: 1, durationApiMs: 200, sessionId: 's1' };

      runPrompt
        .mockResolvedValueOnce({ success: true, output: 'ok', error: null, exitCode: 0, attempts: 1, duration: 300_000, cost: improvementCost })
        .mockResolvedValueOnce({ success: true, output: 'docs', error: null, exitCode: 0, attempts: 1, cost: docCost });

      const result = await executeSteps(steps, '/fake/project');

      // If mutation was active (|| 1), this would be 1.02 instead of 0.02
      expect(result.results[0].cost.costUSD).toBe(0.02);
    });

    it('handles missing costUSD in both cost objects (mutation-killing test)', async () => {
      // Verifies sumCosts handles undefined + undefined correctly
      const steps = [makeStep(1, 'Lint')];
      const improvementCost = { inputTokens: 100, numTurns: 1, durationApiMs: 500, sessionId: 's1' };
      const docCost = { inputTokens: 50, numTurns: 1, durationApiMs: 200, sessionId: 's1' };

      runPrompt
        .mockResolvedValueOnce({ success: true, output: 'ok', error: null, exitCode: 0, attempts: 1, duration: 300_000, cost: improvementCost })
        .mockResolvedValueOnce({ success: true, output: 'docs', error: null, exitCode: 0, attempts: 1, cost: docCost });

      const result = await executeSteps(steps, '/fake/project');

      // If mutation was active (|| 1), this would be 2 instead of 0
      expect(result.results[0].cost.costUSD).toBe(0);
    });
  });
});
