import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/claude.js', () => ({
  runPrompt: vi.fn(),
  ERROR_TYPE: { RATE_LIMIT: 'rate_limit', UNKNOWN: 'unknown' },
  sleep: vi.fn(() => Promise.resolve()),
}));

import { createLoggerMock } from './helpers/mocks.js';

vi.mock('../src/logger.js', () => createLoggerMock());

vi.mock('../src/executor.js', () => ({
  SAFETY_PREAMBLE: 'MOCK_PREAMBLE\n',
}));

vi.mock('../src/prompts/loader.js', () => ({
  CONSOLIDATION_PROMPT: 'Mock consolidation prompt template with Recommended Refactors (Critical High Medium Low tiers) and Requires Human Review sections for consolidated, prioritized action plan instructions.',
  reloadSteps: vi.fn(),
}));

import { runPrompt } from '../src/claude.js';
import { info, warn } from '../src/logger.js';
import { buildConsolidationPrompt, generateActionPlan } from '../src/consolidation.js';
import { makeResults } from './helpers/testdata.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('buildConsolidationPrompt', () => {
  it('includes step output sections for completed steps', () => {
    const results = makeResults({ completedCount: 2, failedCount: 0 });
    results.results[0].output = 'Found unused imports in app.js';
    results.results[1].output = 'Refactored auth module';

    const prompt = buildConsolidationPrompt(results);

    expect(prompt).toContain('### Step 1: Step1 (completed)');
    expect(prompt).toContain('Found unused imports in app.js');
    expect(prompt).toContain('### Step 2: Step2 (completed)');
    expect(prompt).toContain('Refactored auth module');
  });

  it('shows "No output (step failed)" for failed steps', () => {
    const results = makeResults({ completedCount: 1, failedCount: 1 });

    const prompt = buildConsolidationPrompt(results);

    expect(prompt).toContain('### Step 2: FailStep1 (failed)');
    expect(prompt).toContain('No output (step failed)');
  });

  it('truncates outputs exceeding 6000 chars', () => {
    const results = makeResults({ completedCount: 1, failedCount: 0 });
    results.results[0].output = 'x'.repeat(7000);

    const prompt = buildConsolidationPrompt(results);

    expect(prompt).toContain('x'.repeat(6000));
    expect(prompt).toContain('[...truncated');
    expect(prompt).not.toContain('x'.repeat(6001));
  });

  it('passes through outputs under 6000 chars unchanged', () => {
    const results = makeResults({ completedCount: 1, failedCount: 0 });
    results.results[0].output = 'short output';

    const prompt = buildConsolidationPrompt(results);

    expect(prompt).toContain('short output');
    expect(prompt).not.toContain('[...truncated');
  });

  it('handles empty results array', () => {
    const results = { results: [], completedCount: 0, failedCount: 0 };

    const prompt = buildConsolidationPrompt(results);

    // Should still include the consolidation prompt template text
    expect(prompt).toContain('consolidated, prioritized action plan');
  });

  it('includes the consolidation prompt template text', () => {
    const results = makeResults({ completedCount: 1, failedCount: 0 });

    const prompt = buildConsolidationPrompt(results);

    expect(prompt).toContain('consolidated, prioritized action plan');
    expect(prompt).toContain('Recommended Refactors');
    expect(prompt).toContain('Human Review');
  });

  it('handles null/undefined output gracefully', () => {
    const results = makeResults({ completedCount: 1, failedCount: 0 });
    results.results[0].output = null;

    const prompt = buildConsolidationPrompt(results);

    // null output for completed step should render as empty (truncateOutput returns '')
    expect(prompt).toContain('### Step 1: Step1 (completed)');
    expect(prompt).not.toContain('No output (step failed)');
  });
});

describe('generateActionPlan', () => {
  it('returns action plan content on successful Claude response', async () => {
    const mockCost = { costUSD: 0.05, inputTokens: 1000, outputTokens: 500 };
    runPrompt.mockResolvedValue({
      success: true,
      output: '# NightyTidy Action Plan\n\n## Recommended Refactors\n\nNo items.',
      cost: mockCost,
    });

    const results = makeResults({ completedCount: 2, failedCount: 0 });
    const { text, cost } = await generateActionPlan(results, '/fake/project', {});

    expect(text).toContain('## NightyTidy Action Plan');
    expect(text).toContain('### Recommended Refactors');
    expect(text).toContain('No items.');
    expect(cost).toEqual(mockCost);
  });

  it('downgrades heading levels in returned text', async () => {
    runPrompt.mockResolvedValue({
      success: true,
      output: '# NightyTidy Action Plan\n\n## Recommended Refactors\n\n### Critical',
      cost: null,
    });

    const results = makeResults({ completedCount: 1, failedCount: 0 });
    const { text } = await generateActionPlan(results, '/fake/project', {});

    expect(text).toBe('## NightyTidy Action Plan\n\n### Recommended Refactors\n\n#### Critical');
  });

  it('returns null text when Claude returns failure', async () => {
    const mockCost = { costUSD: 0.01, inputTokens: 200, outputTokens: 0 };
    runPrompt.mockResolvedValue({ success: false, output: '', error: 'timeout', cost: mockCost });

    const results = makeResults({ completedCount: 1, failedCount: 0 });
    const { text, cost } = await generateActionPlan(results, '/fake/project', {});

    expect(text).toBeNull();
    expect(cost).toEqual(mockCost);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('failed'));
  });

  it('returns null text when Claude returns empty output', async () => {
    runPrompt.mockResolvedValue({ success: true, output: '   ', cost: null });

    const results = makeResults({ completedCount: 1, failedCount: 0 });
    const { text } = await generateActionPlan(results, '/fake/project', {});

    expect(text).toBeNull();
  });

  it('returns null text and cost when completedCount is 0', async () => {
    const results = makeResults({ completedCount: 0, failedCount: 3 });
    const { text, cost } = await generateActionPlan(results, '/fake/project', {});

    expect(text).toBeNull();
    expect(cost).toBeNull();
    expect(runPrompt).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(expect.stringContaining('no steps completed'));
  });

  it('passes timeout and onOutput options through to runPrompt', async () => {
    runPrompt.mockResolvedValue({ success: true, output: '# Plan', cost: null });

    const results = makeResults({ completedCount: 1, failedCount: 0 });
    const onOutput = vi.fn();
    await generateActionPlan(results, '/fake/project', { timeout: 3600000, onOutput });

    expect(runPrompt).toHaveBeenCalledWith(
      expect.any(String),
      '/fake/project',
      expect.objectContaining({ timeout: 3600000, onOutput })
    );
  });

  it('returns null text/cost and warns on thrown error (never throws)', async () => {
    runPrompt.mockRejectedValue(new Error('network failure'));

    const results = makeResults({ completedCount: 1, failedCount: 0 });
    const { text, cost } = await generateActionPlan(results, '/fake/project', {});

    expect(text).toBeNull();
    expect(cost).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('network failure'));
  });

  it('returns processed text without version footer', async () => {
    runPrompt.mockResolvedValue({ success: true, output: '# Plan content\n\nDetails here.', cost: null });

    const results = makeResults({ completedCount: 1, failedCount: 0 });
    const { text } = await generateActionPlan(results, '/fake/project', {});

    expect(text).toBe('## Plan content\n\nDetails here.');
    expect(text).not.toContain('Generated by NightyTidy');
  });
});
