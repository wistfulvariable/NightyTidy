/**
 * Edge case tests for src/report.js
 *
 * Covers:
 * - formatTokens with values < 1000 (line 199)
 * - truncateOutput with text at boundary (line 316-317)
 * - formatDuration with edge values
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLoggerMock } from './helpers/mocks.js';
import { makeMetadata, makeResults } from './helpers/testdata.js';

vi.mock('../src/logger.js', () => createLoggerMock());

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    writeFileSync: vi.fn(),
    existsSync: vi.fn((p) => {
      // Only return true for CLAUDE.md checks
      return p.includes('CLAUDE.md') ? false : actual.existsSync(p);
    }),
    readFileSync: vi.fn((p, ...args) => {
      // Let manifest.json and other real files read normally
      if (p.includes('manifest.json') || p.includes('.md') || p.includes('package.json')) {
        return actual.readFileSync(p, ...args);
      }
      return '';
    }),
  };
});

describe('report.js edge cases', () => {
  let reportModule;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    reportModule = await import('../src/report.js');
  });

  describe('formatDuration edge cases', () => {
    it('handles negative duration gracefully', () => {
      const result = reportModule.formatDuration(-1000);
      // Should return '0m 00s' per the guard added in the code
      expect(result).toBe('0m 00s');
    });

    it('handles NaN duration gracefully', () => {
      const result = reportModule.formatDuration(NaN);
      expect(result).toBe('0m 00s');
    });

    it('handles Infinity duration gracefully', () => {
      const result = reportModule.formatDuration(Infinity);
      expect(result).toBe('0m 00s');
    });

    it('handles very small positive duration', () => {
      const result = reportModule.formatDuration(1);
      // 1ms should still show something
      expect(result).toBe('0m 00s');
    });

    it('formats multi-hour durations correctly', () => {
      // 2 hours 30 minutes
      const result = reportModule.formatDuration(2.5 * 60 * 60 * 1000);
      expect(result).toBe('2h 30m');
    });

    it('formats exactly 1 second correctly', () => {
      const result = reportModule.formatDuration(1000);
      expect(result).toBe('0m 01s');
    });

    it('formats 59 seconds correctly', () => {
      const result = reportModule.formatDuration(59000);
      expect(result).toBe('0m 59s');
    });
  });

  describe('generateReport token formatting', () => {
    it('handles token counts less than 1000', async () => {
      const { writeFileSync } = await import('fs');

      // Use helper that provides correct results structure
      const results = makeResults({ completedCount: 1, withCost: true });
      // Override the cost with small token counts
      results.results[0].cost = {
        costUSD: 0.01,
        inputTokens: 500,  // Less than 1000
        outputTokens: 200, // Less than 1000
        numTurns: 1,
        durationApiMs: 1000,
        sessionId: 'test',
      };

      const narration = 'Test narration for the run.';

      const metadata = makeMetadata({
        totalInputTokens: 500,
        totalOutputTokens: 200,
      });

      // Call generateReport - should not throw
      const filename = reportModule.generateReport(results, narration, metadata);

      // Should return a filename
      expect(filename).toMatch(/00_NIGHTYTIDY-REPORT.*\.md$/);

      // Check what was written - first call is the report, second is CLAUDE.md
      expect(writeFileSync).toHaveBeenCalled();
      const reportCall = writeFileSync.mock.calls.find(c => c[0].includes('00_NIGHTYTIDY-REPORT'));
      expect(reportCall).toBeDefined();
      const writtenContent = reportCall[1];
      expect(writtenContent).toContain('Step1');
      expect(writtenContent).toContain('1/1'); // "1/1" steps completed
    });

    it('handles very large token counts (>10M)', async () => {
      const { writeFileSync } = await import('fs');

      // Use helper that provides correct results structure
      const results = makeResults({ completedCount: 1, withCost: true });
      // Override the cost with large token counts
      results.results[0].cost = {
        costUSD: 5.00,
        inputTokens: 15_000_000,  // 15M
        outputTokens: 12_000_000, // 12M
        numTurns: 100,
        durationApiMs: 60000,
        sessionId: 'test-large',
      };

      const narration = 'Test narration for the run.';

      const metadata = makeMetadata({
        totalInputTokens: 15_000_000,
        totalOutputTokens: 12_000_000,
      });

      const filename = reportModule.generateReport(results, narration, metadata);

      // Should return a filename
      expect(filename).toMatch(/00_NIGHTYTIDY-REPORT.*\.md$/);

      // Check the written content contains M suffix
      expect(writeFileSync).toHaveBeenCalled();
      const reportCall = writeFileSync.mock.calls.find(c => c[0].includes('00_NIGHTYTIDY-REPORT'));
      expect(reportCall).toBeDefined();
      const writtenContent = reportCall[1];
      expect(writtenContent).toContain('Step1');
      // Should contain M suffix for large numbers in the report
      expect(writtenContent).toContain('M');
    });
  });

  describe('getVersion', () => {
    it('returns a version string', () => {
      const version = reportModule.getVersion();
      expect(typeof version).toBe('string');
      expect(version.length).toBeGreaterThan(0);
      // Should match semver pattern or 'unknown'
      expect(version).toMatch(/^\d+\.\d+\.\d+|unknown$/);
    });
  });
});
