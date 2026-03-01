import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
}));

vi.mock('../src/logger.js', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
}));

import { writeFileSync, readFileSync, existsSync } from 'fs';
import { generateReport, formatDuration } from '../src/report.js';
import { warn } from '../src/logger.js';

// ---------------------------------------------------------------------------
// Helpers (matching report.test.js conventions)
// ---------------------------------------------------------------------------

function makeMetadata(overrides = {}) {
  return {
    startTime: new Date('2026-02-28T01:00:00Z').getTime(),
    endTime: new Date('2026-02-28T01:30:00Z').getTime(),
    branchName: 'nightytidy/run-2026-02-28-0100',
    tagName: 'nightytidy-before-2026-02-28-0100',
    projectDir: '/fake/project',
    ...overrides,
  };
}

function makeResults({ completedCount = 2, failedCount = 0 } = {}) {
  const results = [];

  for (let i = 0; i < completedCount; i++) {
    results.push({
      step: { number: i + 1, name: `Step${i + 1}` },
      status: 'completed',
      output: 'done',
      duration: 60000,
      attempts: 1,
      error: null,
    });
  }

  for (let i = 0; i < failedCount; i++) {
    results.push({
      step: { number: completedCount + i + 1, name: `FailStep${i + 1}` },
      status: 'failed',
      output: '',
      duration: 30000,
      attempts: 4,
      error: 'Something went wrong',
    });
  }

  return {
    results,
    completedCount,
    failedCount,
  };
}

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
  it('formats 0ms as 0m 00s', () => {
    expect(formatDuration(0)).toBe('0m 00s');
  });

  it('formats exactly 1 hour as 1h 00m', () => {
    expect(formatDuration(3600000)).toBe('1h 00m');
  });

  it('formats multi-hour durations correctly', () => {
    // 3h 45m = 3*3600000 + 45*60000 = 13500000
    expect(formatDuration(13500000)).toBe('3h 45m');
  });

  it('formats 59 seconds correctly', () => {
    expect(formatDuration(59000)).toBe('0m 59s');
  });

  it('formats 1 minute exactly', () => {
    expect(formatDuration(60000)).toBe('1m 00s');
  });

  it('drops seconds when hours are present', () => {
    // 1h 2m 30s = 3750000ms — should show as 1h 02m (not 1h 02m 30s)
    expect(formatDuration(3750000)).toBe('1h 02m');
  });
});

// ---------------------------------------------------------------------------
// Report content validation
// ---------------------------------------------------------------------------

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
