import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
  readdirSync: vi.fn(() => []),
}));

import { createLoggerMock } from './helpers/mocks.js';

vi.mock('../src/logger.js', () => createLoggerMock());

vi.mock('../src/prompts/loader.js', () => ({
  REPORT_PROMPT: 'mock report prompt template',
}));

import { writeFileSync, readFileSync, existsSync } from 'fs';
import { generateReport, formatDuration, cleanNarration, buildReportPrompt, verifyReportContent } from '../src/report.js';
import { makeMetadata, makeResults } from './helpers/testdata.js';

beforeEach(() => {
  vi.clearAllMocks();
  existsSync.mockReturnValue(false);
});

describe('generateReport', () => {
  it('generates a full success report with all sections and no Failed Steps section', async () => {
    const results = makeResults({ completedCount: 3, failedCount: 0 });
    const metadata = makeMetadata();
    const narration = 'Everything went great tonight.';

    await generateReport(results, narration, metadata);

    expect(writeFileSync).toHaveBeenCalled();

    // First call writes the report file
    const reportCall = writeFileSync.mock.calls[0];
    const reportContent = reportCall[1];

    expect(reportContent).toContain('# NightyTidy Report');
    expect(reportContent).toContain('Everything went great tonight.');
    expect(reportContent).toContain('## Run Summary');
    expect(reportContent).toContain('## Step Results');
    expect(reportContent).toContain('## How to Undo This Run');
    expect(reportContent).not.toContain('## Failed Steps');
  });

  it('includes a Failed Steps section when there are failures', async () => {
    const results = makeResults({ completedCount: 1, failedCount: 2 });
    const metadata = makeMetadata();
    const narration = 'Partial run.';

    await generateReport(results, narration, metadata);

    const reportContent = writeFileSync.mock.calls[0][1];

    expect(reportContent).toContain('## Failed Steps');
    expect(reportContent).toContain('Something went wrong');
    expect(reportContent).toContain('FailStep1');
    expect(reportContent).toContain('FailStep2');
  });

  it('uses the fallback narration paragraph when narration is null', async () => {
    const results = makeResults({ completedCount: 2, failedCount: 1 });
    const metadata = makeMetadata();

    await generateReport(results, null, metadata);

    const reportContent = writeFileSync.mock.calls[0][1];

    // Fallback narration mentions step counts and suggests a recovery action
    expect(reportContent).toContain('NightyTidy ran 3 improvement steps');
    expect(reportContent).toContain('2 steps completed successfully');
    expect(reportContent).toContain('Try re-running the changelog step individually');
  });

  it('includes inline action plan text when actionPlanText is provided', async () => {
    const results = makeResults({ completedCount: 2, failedCount: 0 });
    const metadata = makeMetadata();

    await generateReport(results, 'Narration.', metadata, {
      actionPlanText: '## NightyTidy Action Plan\n\nSome recommendations.',
    });

    const reportContent = writeFileSync.mock.calls[0][1];
    expect(reportContent).toContain('## NightyTidy Action Plan');
    expect(reportContent).toContain('Some recommendations.');
    expect(reportContent).not.toContain('NIGHTYTIDY-ACTIONS.md');
  });

  it('omits action plan section when actionPlanText is absent', async () => {
    const results = makeResults({ completedCount: 2, failedCount: 0 });
    const metadata = makeMetadata();

    await generateReport(results, 'Narration.', metadata);

    const reportContent = writeFileSync.mock.calls[0][1];
    expect(reportContent).not.toContain('Action Plan');
  });

  it('includes Cost column in step table when results have cost data', async () => {
    const results = makeResults({ completedCount: 2, failedCount: 0, withCost: true });
    const metadata = makeMetadata();

    await generateReport(results, 'Narration.', metadata);

    const reportContent = writeFileSync.mock.calls[0][1];
    expect(reportContent).toContain('| Cost |');
    expect(reportContent).toContain('$0.05');
    expect(reportContent).toContain('$0.10');
  });

  it('omits Cost column when no results have cost data', async () => {
    const results = makeResults({ completedCount: 2, failedCount: 0 });
    const metadata = makeMetadata();

    await generateReport(results, 'Narration.', metadata);

    const reportContent = writeFileSync.mock.calls[0][1];
    expect(reportContent).not.toContain('| Cost |');
  });

  it('includes total cost in summary when metadata has totalCostUSD', async () => {
    const results = makeResults({ completedCount: 2, failedCount: 0, withCost: true });
    const metadata = makeMetadata({ totalCostUSD: 0.15 });

    await generateReport(results, 'Narration.', metadata);

    const reportContent = writeFileSync.mock.calls[0][1];
    expect(reportContent).toContain('**Total cost**: $0.15');
  });

  it('omits total cost from summary when metadata has no totalCostUSD', async () => {
    const results = makeResults({ completedCount: 2, failedCount: 0 });
    const metadata = makeMetadata();

    await generateReport(results, 'Narration.', metadata);

    const reportContent = writeFileSync.mock.calls[0][1];
    expect(reportContent).not.toContain('**Total cost**');
  });
});

describe('formatDuration', () => {
  it.each([
    [30000, '0m 30s', '30 seconds'],
    [3720000, '1h 02m', '1 hour and 2 minutes'],
    [120000, '2m 00s', 'exact minutes with zero seconds'],
    [5000, '0m 05s', 'sub-minute with padded seconds'],
  ])('formats %i ms as "%s" (%s)', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });
});

describe('cleanNarration', () => {
  it('strips conversational preamble from narration', () => {
    const raw = "I understand. I'm ready to help.\n\nActual summary.";
    expect(cleanNarration(raw)).toBe('Actual summary.');
  });

  it('leaves normal narration unchanged', () => {
    const raw = 'Last night I worked on improving the test suite.';
    expect(cleanNarration(raw)).toBe(raw);
  });

  it('returns null for null input', () => {
    expect(cleanNarration(null)).toBeNull();
  });

  it('returns original text when text is only preamble', () => {
    const raw = 'I understand.';
    const result = cleanNarration(raw);
    // Should return the original trimmed text, not an empty string
    expect(result).toBe('I understand.');
    expect(result.length).toBeGreaterThan(0);
  });

  it('strips "I can see" preamble from narration', () => {
    const raw = 'I can see this is a React app. Last night I added 47 tests.';
    expect(cleanNarration(raw)).toBe('Last night I added 47 tests.');
  });

  it('returns null when entire output is a Claude greeting', () => {
    const raw = 'I can see this is an Electron desktop app. What would you like to work on? I can help with:\n- Bug fixes\n- Testing';
    expect(cleanNarration(raw)).toBeNull();
  });

  it('returns null when output contains "let me know what you need"', () => {
    const raw = 'This looks like a Node.js project. Let me know what you need!';
    expect(cleanNarration(raw)).toBeNull();
  });
});

describe('generateReport — tokens', () => {
  it('includes total tokens in summary when metadata has token data', async () => {
    const results = makeResults({ completedCount: 2, failedCount: 0, withCost: true });
    const metadata = makeMetadata({ totalCostUSD: 0.15, totalInputTokens: 1_250_000, totalOutputTokens: 45_000 });

    await generateReport(results, 'Narration.', metadata);

    const reportContent = writeFileSync.mock.calls[0][1];
    expect(reportContent).toContain('**Total tokens**: 1.3M input / 45k output');
  });

  it('omits total tokens from summary when metadata has no token data', async () => {
    const results = makeResults({ completedCount: 2, failedCount: 0 });
    const metadata = makeMetadata();

    await generateReport(results, 'Narration.', metadata);

    const reportContent = writeFileSync.mock.calls[0][1];
    expect(reportContent).not.toContain('**Total tokens**');
  });
});

describe('buildReportPrompt', () => {
  it('returns a string containing the REPORT_PROMPT template text', () => {
    const results = makeResults({ completedCount: 2, failedCount: 0 });
    const metadata = makeMetadata();

    const prompt = buildReportPrompt(results, metadata, { reportFile: '00_NIGHTYTIDY-REPORT_01_2026-02-28-0100.md' });

    expect(typeof prompt).toBe('string');
    expect(prompt).toContain('mock report prompt template');
  });

  it('includes VERBATIM markers for pre-built sections', () => {
    const results = makeResults({ completedCount: 1, failedCount: 0 });
    const metadata = makeMetadata();

    const prompt = buildReportPrompt(results, metadata, { reportFile: 'report.md' });

    expect(prompt).toContain('<!-- VERBATIM: summary -->');
    expect(prompt).toContain('<!-- END VERBATIM -->');
    expect(prompt).toContain('<!-- VERBATIM: table -->');
    expect(prompt).toContain('<!-- VERBATIM: undo -->');
  });

  it('includes the reportFile name in the prompt', () => {
    const results = makeResults({ completedCount: 1, failedCount: 0 });
    const metadata = makeMetadata();
    const reportFile = '00_NIGHTYTIDY-REPORT_05_2026-02-28-0100.md';

    const prompt = buildReportPrompt(results, metadata, { reportFile });

    expect(prompt).toContain(reportFile);
  });

  it('includes pre-built summary, table, and undo sections', () => {
    const results = makeResults({ completedCount: 2, failedCount: 0 });
    const metadata = makeMetadata();

    const prompt = buildReportPrompt(results, metadata, { reportFile: 'report.md' });

    expect(prompt).toContain('## Run Summary');
    expect(prompt).toContain('## Step Results');
    expect(prompt).toContain('## How to Undo This Run');
    expect(prompt).toContain(metadata.tagName);
    expect(prompt).toContain(metadata.branchName);
  });

  it('includes step outputs for completed steps', () => {
    const results = makeResults({ completedCount: 2, failedCount: 1 });
    const metadata = makeMetadata();

    const prompt = buildReportPrompt(results, metadata, { reportFile: 'report.md' });

    expect(prompt).toContain('Step 1: Step1 (completed)');
    expect(prompt).toContain('Step 2: Step2 (completed)');
    expect(prompt).toContain('Step 3: FailStep1 (failed)');
    expect(prompt).toContain('No output (step failed)');
  });

  it('includes failed section VERBATIM marker when there are failures', () => {
    const results = makeResults({ completedCount: 1, failedCount: 1 });
    const metadata = makeMetadata();

    const prompt = buildReportPrompt(results, metadata, { reportFile: 'report.md' });

    expect(prompt).toContain('<!-- VERBATIM: failed -->');
    expect(prompt).toContain('## Failed Steps');
  });

  it('omits failed section VERBATIM marker when no failures', () => {
    const results = makeResults({ completedCount: 2, failedCount: 0 });
    const metadata = makeMetadata();

    const prompt = buildReportPrompt(results, metadata, { reportFile: 'report.md' });

    expect(prompt).not.toContain('<!-- VERBATIM: failed -->');
    expect(prompt).not.toContain('## Failed Steps');
  });
});

describe('verifyReportContent', () => {
  const metadata = makeMetadata();

  /** Build a valid report string for testing */
  function validReport() {
    return (
      '# NightyTidy Report\n\n' +
      'Last night we improved your codebase significantly.\n\n' +
      '## Run Summary\n\n- **Date**: 2026-02-28\n- **Steps completed**: 2/2\n\n' +
      '## Step Results\n\n| # | Step | Status |\n|---|---|---|\n| 1 | Step1 | ok |\n\n' +
      '## How to Undo This Run\n\n' +
      `Reset to tag \`${metadata.tagName}\`\n`
    );
  }

  it('returns true for valid content with all required markers', () => {
    expect(verifyReportContent(validReport(), metadata)).toBe(true);
  });

  it('returns false for null content', () => {
    expect(verifyReportContent(null, metadata)).toBe(false);
  });

  it('returns false for empty string content', () => {
    expect(verifyReportContent('', metadata)).toBe(false);
  });

  it('returns false for content shorter than 200 chars', () => {
    const shortContent = '# NightyTidy Report\n## Run Summary\n## Step Results\n## How to Undo This Run\n' + metadata.tagName;
    expect(shortContent.length).toBeLessThan(200);
    expect(verifyReportContent(shortContent, metadata)).toBe(false);
  });

  it('returns false for content missing "# NightyTidy Report"', () => {
    const content = validReport().replace('# NightyTidy Report', '# Some Other Report');
    expect(verifyReportContent(content, metadata)).toBe(false);
  });

  it('returns false for content missing "## Run Summary"', () => {
    const content = validReport().replace('## Run Summary', '## Overview');
    expect(verifyReportContent(content, metadata)).toBe(false);
  });

  it('returns false for content missing "## Step Results"', () => {
    const content = validReport().replace('## Step Results', '## Outcomes');
    expect(verifyReportContent(content, metadata)).toBe(false);
  });

  it('returns false for content missing "## How to Undo This Run"', () => {
    const content = validReport().replace('## How to Undo This Run', '## Rollback');
    expect(verifyReportContent(content, metadata)).toBe(false);
  });

  it('returns false for content missing the tagName', () => {
    const content = validReport().replace(metadata.tagName, 'some-other-tag');
    expect(verifyReportContent(content, metadata)).toBe(false);
  });

  it('returns false for junk content containing "what would you like"', () => {
    const content = validReport() + '\nWhat would you like me to do next?\n';
    expect(verifyReportContent(content, metadata)).toBe(false);
  });

  it('returns false for junk content containing "let me know what you need"', () => {
    const content = validReport() + '\nLet me know what you need!\n';
    expect(verifyReportContent(content, metadata)).toBe(false);
  });

  it('returns false for junk content containing "how can i help"', () => {
    const content = validReport() + '\nHow can I help you today?\n';
    expect(verifyReportContent(content, metadata)).toBe(false);
  });
});

describe('generateReport — skipClaudeMdUpdate', () => {
  it('does not update CLAUDE.md when skipClaudeMdUpdate is true', () => {
    const results = makeResults({ completedCount: 1, failedCount: 0 });
    const metadata = makeMetadata();

    generateReport(results, 'Narration.', metadata, { skipClaudeMdUpdate: true });

    // Only the report file should be written, not CLAUDE.md
    const claudeWriteCall = writeFileSync.mock.calls.find(
      (call) => call[0].endsWith('CLAUDE.md')
    );
    expect(claudeWriteCall).toBeUndefined();
  });

  it('still updates CLAUDE.md by default (no skipClaudeMdUpdate option)', () => {
    existsSync.mockReturnValue(false);
    const results = makeResults({ completedCount: 1, failedCount: 0 });
    const metadata = makeMetadata();

    generateReport(results, 'Narration.', metadata);

    // CLAUDE.md should be written as well as the report
    const claudeWriteCall = writeFileSync.mock.calls.find(
      (call) => call[0].endsWith('CLAUDE.md')
    );
    expect(claudeWriteCall).toBeDefined();
  });
});
