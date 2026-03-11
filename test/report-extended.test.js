import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
  readdirSync: vi.fn(() => []),
}));

import { createLoggerMock } from './helpers/mocks.js';

vi.mock('../src/logger.js', () => createLoggerMock());

import { writeFileSync, readFileSync, existsSync } from 'fs';
import { generateReport, formatDuration } from '../src/report.js';
import { warn } from '../src/logger.js';
import { makeMetadata, makeResults } from './helpers/testdata.js';

beforeEach(() => {
  vi.clearAllMocks();
  existsSync.mockReturnValue(false);
});

// ---------------------------------------------------------------------------
// Extended tests for updateClaudeMd (lines 111-144 in report.js)
// ---------------------------------------------------------------------------

describe('generateReport — CLAUDE.md update', () => {
  it('creates a new CLAUDE.md when file does not exist', async () => {
    existsSync.mockReturnValue(false);

    await generateReport(makeResults(), 'narration', makeMetadata());

    // Second writeFileSync call should be CLAUDE.md creation
    const claudeWriteCall = writeFileSync.mock.calls.find(
      (call) => call[0].endsWith('CLAUDE.md')
    );

    expect(claudeWriteCall).toBeDefined();
    const content = claudeWriteCall[1];
    expect(content).toContain('## NightyTidy');
    expect(content).toContain('Last run:');
    expect(content).toContain('nightytidy-before-2026-02-28-0100');
  });

  it('appends NightyTidy section when CLAUDE.md exists without one', async () => {
    existsSync.mockImplementation((p) => {
      if (p.endsWith('CLAUDE.md')) return true;
      return false;
    });
    readFileSync.mockReturnValue('# Project\n\nSome existing content.\n');

    await generateReport(makeResults(), 'narration', makeMetadata());

    const claudeWriteCall = writeFileSync.mock.calls.find(
      (call) => call[0].endsWith('CLAUDE.md')
    );

    expect(claudeWriteCall).toBeDefined();
    const content = claudeWriteCall[1];
    expect(content).toContain('# Project');
    expect(content).toContain('Some existing content.');
    expect(content).toContain('## NightyTidy');
    expect(content).toContain('Last run:');
  });

  it('replaces existing NightyTidy section in CLAUDE.md', async () => {
    existsSync.mockImplementation((p) => {
      if (p.endsWith('CLAUDE.md')) return true;
      return false;
    });
    readFileSync.mockReturnValue(
      '# Project\n\n## NightyTidy — Last Run\n\nLast run: 2026-01-01. Old tag.\n\n## Other Section\n\nMore content.\n'
    );

    await generateReport(makeResults(), 'narration', makeMetadata());

    const claudeWriteCall = writeFileSync.mock.calls.find(
      (call) => call[0].endsWith('CLAUDE.md')
    );

    expect(claudeWriteCall).toBeDefined();
    const content = claudeWriteCall[1];

    // Old run date should be gone
    expect(content).not.toContain('2026-01-01');
    // New run info should be present
    expect(content).toContain('nightytidy-before-2026-02-28-0100');
    // Other section should be preserved
    expect(content).toContain('## Other Section');
    expect(content).toContain('More content.');
  });

  it('replaces NightyTidy section at end of file (no trailing section)', async () => {
    existsSync.mockImplementation((p) => {
      if (p.endsWith('CLAUDE.md')) return true;
      return false;
    });
    readFileSync.mockReturnValue(
      '# Project\n\n## NightyTidy — Last Run\n\nLast run: 2026-01-01. Old tag.\n'
    );

    await generateReport(makeResults(), 'narration', makeMetadata());

    const claudeWriteCall = writeFileSync.mock.calls.find(
      (call) => call[0].endsWith('CLAUDE.md')
    );

    expect(claudeWriteCall).toBeDefined();
    const content = claudeWriteCall[1];

    expect(content).not.toContain('2026-01-01');
    expect(content).toContain('nightytidy-before-2026-02-28-0100');
    expect(content).toContain('# Project');
  });

  it('warns but does not throw when CLAUDE.md write fails', async () => {
    existsSync.mockImplementation((p) => {
      if (p.endsWith('CLAUDE.md')) return true;
      return false;
    });
    readFileSync.mockImplementation((p) => {
      if (p.endsWith('CLAUDE.md')) throw new Error('read error');
      return '';
    });

    // Should not throw
    await generateReport(makeResults(), 'narration', makeMetadata());

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to update CLAUDE.md'),
    );
  });
});

// ---------------------------------------------------------------------------
// Extended formatDuration edge cases
// ---------------------------------------------------------------------------

describe('formatDuration — edge cases', () => {
  it.each([
    [0, '0m 00s', '0ms'],
    [3600000, '1h 00m', 'exactly 1 hour'],
    [13500000, '3h 45m', 'multi-hour (3h 45m)'],
    [59000, '0m 59s', '59 seconds'],
    [60000, '1m 00s', '1 minute exactly'],
    [3750000, '1h 02m', 'drops seconds when hours present (1h 2m 30s)'],
  ])('formats %i ms as "%s" (%s)', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Report content validation
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Cost column rendering
// ---------------------------------------------------------------------------

describe('generateReport — cost column', () => {
  it('shows dash for steps without cost when other steps have cost', async () => {
    const results = makeResults({ completedCount: 1, failedCount: 1, withCost: true });
    // Failed steps have cost: null — should render as dash
    await generateReport(results, 'narration', makeMetadata());

    const reportContent = writeFileSync.mock.calls[0][1];
    expect(reportContent).toContain('| Cost |');
    // Completed step has cost, failed step gets a dash
    expect(reportContent).toContain('$0.0500');
    expect(reportContent).toMatch(/\u2014/); // em-dash for null cost
  });

  it('handles mixed cost/null results in cost column', async () => {
    // Create a custom results object with one cost and one null
    const results = {
      results: [
        { step: { number: 1, name: 'Step1' }, status: 'completed', output: 'ok', duration: 60000, attempts: 1, error: null, cost: { costUSD: 0.0312, numTurns: 5, durationApiMs: 3000, sessionId: 's1' } },
        { step: { number: 2, name: 'Step2' }, status: 'completed', output: 'ok', duration: 45000, attempts: 1, error: null, cost: null },
      ],
      completedCount: 2,
      failedCount: 0,
    };

    await generateReport(results, 'narration', makeMetadata());

    const reportContent = writeFileSync.mock.calls[0][1];
    expect(reportContent).toContain('| Cost |');
    expect(reportContent).toContain('$0.0312');
    expect(reportContent).toMatch(/\u2014/); // dash for null cost step
  });
});

describe('generateReport — content structure', () => {
  it('includes the date from metadata in the report header', async () => {
    await generateReport(makeResults(), 'narration', makeMetadata());

    const reportContent = writeFileSync.mock.calls[0][1];
    expect(reportContent).toContain('2026-02-28');
  });

  it('includes step result table with correct status icons', async () => {
    const results = makeResults({ completedCount: 1, failedCount: 1 });
    await generateReport(results, 'narration', makeMetadata());

    const reportContent = writeFileSync.mock.calls[0][1];
    expect(reportContent).toContain('✅ Completed');
    expect(reportContent).toContain('❌ Failed');
  });

  it('includes undo section with safety tag name', async () => {
    await generateReport(makeResults(), 'narration', makeMetadata());

    const reportContent = writeFileSync.mock.calls[0][1];
    expect(reportContent).toContain('git reset --hard nightytidy-before-2026-02-28-0100');
    expect(reportContent).toContain('Generated by NightyTidy v0.1.0');
  });

  it('includes retry suggestion in failed steps section', async () => {
    const results = makeResults({ completedCount: 0, failedCount: 1 });
    await generateReport(results, 'narration', makeMetadata());

    const reportContent = writeFileSync.mock.calls[0][1];
    expect(reportContent).toContain('Suggestion');
    expect(reportContent).toContain('4 (1 initial + 3 retries)');
  });
});
