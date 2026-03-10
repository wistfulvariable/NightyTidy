/**
 * Tests for CLI sync command flow (--sync, --sync-dry-run)
 * Covers uncovered lines in cli.js around the sync path.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { robustCleanup } from './helpers/cleanup.js';

import { createLoggerMock } from './helpers/mocks.js';

vi.mock('../src/logger.js', () => createLoggerMock());

// Mock the sync module
const mockSyncPrompts = vi.fn();
vi.mock('../src/sync.js', () => ({
  syncPrompts: mockSyncPrompts,
}));

// Mock prompts/loader for STEPS
vi.mock('../src/prompts/loader.js', () => ({
  STEPS: [
    { number: 1, name: 'Step 1', prompt: 'prompt 1' },
    { number: 2, name: 'Step 2', prompt: 'prompt 2' },
  ],
  CHANGELOG_PROMPT: 'changelog prompt',
  reloadSteps: vi.fn(),
}));

// Mock chalk for terminal output
vi.mock('chalk', async () => {
  const actual = await vi.importActual('chalk');
  return {
    ...actual,
    default: {
      cyan: (s) => s,
      green: (s) => s,
      yellow: (s) => s,
      red: (s) => s,
      dim: (s) => s,
    },
  };
});

describe('CLI sync commands', () => {
  let tempDir;
  let originalArgv;
  let originalExit;
  let exitCode;

  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = await mkdtemp(path.join(tmpdir(), 'nightytidy-cli-sync-'));
    originalArgv = process.argv;
    originalExit = process.exit;
    exitCode = null;
    process.exit = vi.fn((code) => {
      exitCode = code;
      throw new Error(`process.exit(${code})`);
    });

    // Create necessary directories and files
    await mkdir(path.join(tempDir, 'src', 'prompts', 'steps'), { recursive: true });
    await writeFile(path.join(tempDir, 'src', 'prompts', 'manifest.json'), JSON.stringify({
      version: 1,
      sourceUrl: 'https://example.com/doc',
      steps: [],
    }));
  });

  afterEach(async () => {
    process.argv = originalArgv;
    process.exit = originalExit;
    await robustCleanup(tempDir);
    vi.resetModules();
  });

  describe('--sync flag', () => {
    it('calls syncPrompts and prints success summary', async () => {
      mockSyncPrompts.mockResolvedValue({
        success: true,
        summary: {
          updated: [{ id: '01-test', name: 'Test Step' }],
          added: [],
          removed: [],
          unchanged: [{ id: '02-other', name: 'Other Step' }],
          newStepsHash: 'abc123def456',
        },
        error: null,
      });

      // Capture console output
      const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

      process.argv = ['node', 'nightytidy', '--sync'];
      process.chdir(tempDir);

      try {
        const { run } = await import('../src/cli.js');
        await run();
      } catch (e) {
        expect(e.message).toBe('process.exit(0)');
      }

      expect(mockSyncPrompts).toHaveBeenCalledWith({
        dryRun: false,
        url: undefined,
      });
      expect(exitCode).toBe(0);

      consoleLog.mockRestore();
    });

    it('prints error and exits with 1 when sync fails', async () => {
      mockSyncPrompts.mockResolvedValue({
        success: false,
        summary: null,
        error: 'Network error: could not reach server',
      });

      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      process.argv = ['node', 'nightytidy', '--sync'];
      process.chdir(tempDir);

      try {
        const { run } = await import('../src/cli.js');
        await run();
      } catch (e) {
        expect(e.message).toBe('process.exit(1)');
      }

      expect(exitCode).toBe(1);
      expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('Network error'));

      consoleError.mockRestore();
    });
  });

  describe('--sync-dry-run flag', () => {
    it('calls syncPrompts with dryRun: true', async () => {
      mockSyncPrompts.mockResolvedValue({
        success: true,
        summary: {
          updated: [],
          added: [],
          removed: [],
          unchanged: [{ id: '01-test', name: 'Test' }],
          newStepsHash: null,
        },
        error: null,
      });

      const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

      process.argv = ['node', 'nightytidy', '--sync-dry-run'];
      process.chdir(tempDir);

      try {
        const { run } = await import('../src/cli.js');
        await run();
      } catch (e) {
        expect(e.message).toBe('process.exit(0)');
      }

      expect(mockSyncPrompts).toHaveBeenCalledWith({
        dryRun: true,
        url: undefined,
      });
      expect(exitCode).toBe(0);

      consoleLog.mockRestore();
    });
  });

  describe('--sync-url flag', () => {
    it('passes custom URL to syncPrompts', async () => {
      mockSyncPrompts.mockResolvedValue({
        success: true,
        summary: {
          updated: [],
          added: [],
          removed: [],
          unchanged: [],
          newStepsHash: null,
        },
        error: null,
      });

      const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

      process.argv = ['node', 'nightytidy', '--sync', '--sync-url', 'https://custom.url/doc'];
      process.chdir(tempDir);

      try {
        const { run } = await import('../src/cli.js');
        await run();
      } catch (e) {
        expect(e.message).toBe('process.exit(0)');
      }

      expect(mockSyncPrompts).toHaveBeenCalledWith({
        dryRun: false,
        url: 'https://custom.url/doc',
      });

      consoleLog.mockRestore();
    });
  });

  describe('sync summary printing', () => {
    it('prints all categories when present in summary', async () => {
      mockSyncPrompts.mockResolvedValue({
        success: true,
        summary: {
          updated: [{ id: '01-updated', name: 'Updated Step' }],
          added: [{ id: '02-added', name: 'Added Step' }],
          removed: [{ id: '03-removed', name: 'Removed Step' }],
          unchanged: [{ id: '04-unchanged', name: 'Unchanged Step' }],
          newStepsHash: 'newhash123',
        },
        error: null,
      });

      const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

      process.argv = ['node', 'nightytidy', '--sync'];
      process.chdir(tempDir);

      try {
        const { run } = await import('../src/cli.js');
        await run();
      } catch (e) {
        // Expected exit
      }

      // Verify summary was printed (check for key parts)
      const allOutput = consoleLog.mock.calls.map(c => c[0]).join('\n');
      expect(allOutput).toContain('Updated');
      expect(allOutput).toContain('Added');
      expect(allOutput).toContain('Removed');
      expect(allOutput).toContain('Unchanged');
      expect(allOutput).toContain('Total');

      consoleLog.mockRestore();
    });

    it('prints dry-run indicator in summary', async () => {
      mockSyncPrompts.mockResolvedValue({
        success: true,
        summary: {
          updated: [],
          added: [],
          removed: [],
          unchanged: [{ id: '01-test', name: 'Test' }],
          newStepsHash: null,
        },
        error: null,
      });

      const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

      process.argv = ['node', 'nightytidy', '--sync-dry-run'];
      process.chdir(tempDir);

      try {
        const { run } = await import('../src/cli.js');
        await run();
      } catch (e) {
        // Expected exit
      }

      const allOutput = consoleLog.mock.calls.map(c => c[0]).join('\n');
      expect(allOutput).toContain('DRY RUN');

      consoleLog.mockRestore();
    });
  });
});
