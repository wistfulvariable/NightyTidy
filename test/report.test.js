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

    // Fallback narration mentions step counts and suggests checking the log
    expect(reportContent).toContain('NightyTidy ran 3 improvement steps');
    expect(reportContent).toContain('2 steps completed successfully');
    expect(reportContent).toContain('nightytidy-run.log');
  });
});

describe('formatDuration', () => {
  it('formats 30 seconds correctly', () => {
    expect(formatDuration(30000)).toBe('0m 30s');
  });

  it('formats 1 hour and 2 minutes correctly', () => {
    expect(formatDuration(3720000)).toBe('1h 02m');
  });

  it('formats exact minutes with zero seconds', () => {
    expect(formatDuration(120000)).toBe('2m 00s');
  });

  it('formats sub-minute durations with padded seconds', () => {
    expect(formatDuration(5000)).toBe('0m 05s');
  });
});
