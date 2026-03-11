/**
 * Shared test data factories for report test files.
 * Used by report.test.js and report-extended.test.js.
 */

export function makeMetadata(overrides = {}) {
  return {
    startTime: new Date('2026-02-28T01:00:00Z').getTime(),
    endTime: new Date('2026-02-28T01:30:00Z').getTime(),
    branchName: 'nightytidy/run-2026-02-28-0100',
    tagName: 'nightytidy-before-2026-02-28-0100',
    projectDir: '/fake/project',
    ...overrides,
  };
}

export function makeResults({ completedCount = 2, failedCount = 0, withCost = false } = {}) {
  const results = [];

  for (let i = 0; i < completedCount; i++) {
    results.push({
      step: { number: i + 1, name: `Step${i + 1}` },
      status: 'completed',
      output: 'done',
      duration: 60000,
      attempts: 1,
      error: null,
      cost: withCost ? { costUSD: 0.05 * (i + 1), inputTokens: 5000 * (i + 1), outputTokens: 1000 * (i + 1), numTurns: 3, durationApiMs: 5000, sessionId: `sess-${i + 1}` } : null,
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
      cost: null,
    });
  }

  return {
    results,
    completedCount,
    failedCount,
  };
}
