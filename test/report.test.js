import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
}));

import { createLoggerMock } from './helpers/mocks.js';

vi.mock('../src/logger.js', () => createLoggerMock());

import { writeFileSync, readFileSync, existsSync } from 'fs';
import { generateReport, formatDuration } from '../src/report.js';
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

  it('includes Action Plan section when actionPlan option is true', async () => {
    const results = makeResults({ completedCount: 2, failedCount: 0 });
    const metadata = makeMetadata();

    await generateReport(results, 'Narration.', metadata, { actionPlan: true });

    const reportContent = writeFileSync.mock.calls[0][1];
    expect(reportContent).toContain('## Action Plan');
    expect(reportContent).toContain('NIGHTYTIDY-ACTIONS.md');
  });

  it('omits Action Plan section when actionPlan option is false or absent', async () => {
    const results = makeResults({ completedCount: 2, failedCount: 0 });
    const metadata = makeMetadata();

    await generateReport(results, 'Narration.', metadata);

    const reportContent = writeFileSync.mock.calls[0][1];
    expect(reportContent).not.toContain('## Action Plan');
  });

  it('includes Cost column in step table when results have cost data', async () => {
    const results = makeResults({ completedCount: 2, failedCount: 0, withCost: true });
    const metadata = makeMetadata();

    await generateReport(results, 'Narration.', metadata);

    const reportContent = writeFileSync.mock.calls[0][1];
    expect(reportContent).toContain('| Cost |');
    expect(reportContent).toContain('$0.0500');
    expect(reportContent).toContain('$0.1000');
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
    expect(reportContent).toContain('**Total cost**: $0.1500');
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
