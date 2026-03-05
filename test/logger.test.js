import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { robustCleanup } from './helpers/cleanup.js';

// ---------------------------------------------------------------------------
// Logger tests — using real file I/O against temp directories
//
// Unlike other tests, we DON'T mock the logger here — we test the real one.
// We re-import a fresh module for each test to reset singleton state.
// ---------------------------------------------------------------------------

// We need to clear the module cache between tests to reset logger singleton state.
// Vitest's vi.resetModules() handles this.

describe('logger', () => {
  let tempDir;

  beforeEach(async () => {
    vi.resetModules();
    tempDir = await mkdtemp(path.join(tmpdir(), 'nightytidy-logger-'));
  });

  afterEach(async () => {
    await robustCleanup(tempDir);
  });

  it('throws if log functions are called before initLogger', async () => {
    const { info } = await import('../src/logger.js');

    // Capture stdout to avoid noise
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      expect(() => info('test')).toThrow('Logger not initialized');
    } finally {
      spy.mockRestore();
    }
  });

  it('creates an empty log file on initialization', async () => {
    const { initLogger } = await import('../src/logger.js');
    initLogger(tempDir);

    const logPath = path.join(tempDir, 'nightytidy-run.log');
    const content = readFileSync(logPath, 'utf8');
    expect(content).toBe('');
  });

  it('writes info-level messages to the log file', async () => {
    const { initLogger, info } = await import('../src/logger.js');

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      initLogger(tempDir);
      info('test message');

      const logPath = path.join(tempDir, 'nightytidy-run.log');
      const content = readFileSync(logPath, 'utf8');

      expect(content).toContain('[INFO ]');
      expect(content).toContain('test message');
    } finally {
      stdoutSpy.mockRestore();
    }
  });

  it('writes messages at all levels', async () => {
    const { initLogger, debug, info, warn, error } = await import('../src/logger.js');

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      // Set debug level so all messages pass the filter
      process.env.NIGHTYTIDY_LOG_LEVEL = 'debug';
      initLogger(tempDir);

      debug('debug-msg');
      info('info-msg');
      warn('warn-msg');
      error('error-msg');

      const logPath = path.join(tempDir, 'nightytidy-run.log');
      const content = readFileSync(logPath, 'utf8');

      expect(content).toContain('[DEBUG]');
      expect(content).toContain('debug-msg');
      expect(content).toContain('[INFO ]');
      expect(content).toContain('info-msg');
      expect(content).toContain('[WARN ]');
      expect(content).toContain('warn-msg');
      expect(content).toContain('[ERROR]');
      expect(content).toContain('error-msg');
    } finally {
      stdoutSpy.mockRestore();
      delete process.env.NIGHTYTIDY_LOG_LEVEL;
    }
  });

  it('filters messages below the configured log level', async () => {
    const { initLogger, debug, info } = await import('../src/logger.js');

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      // Default level is info — debug should be filtered
      delete process.env.NIGHTYTIDY_LOG_LEVEL;
      initLogger(tempDir);

      debug('should-not-appear');
      info('should-appear');

      const logPath = path.join(tempDir, 'nightytidy-run.log');
      const content = readFileSync(logPath, 'utf8');

      expect(content).not.toContain('should-not-appear');
      expect(content).toContain('should-appear');
    } finally {
      stdoutSpy.mockRestore();
    }
  });

  it('respects NIGHTYTIDY_LOG_LEVEL=warn (filters info and debug)', async () => {
    const { initLogger, debug, info, warn } = await import('../src/logger.js');

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      process.env.NIGHTYTIDY_LOG_LEVEL = 'warn';
      initLogger(tempDir);

      debug('debug-hidden');
      info('info-hidden');
      warn('warn-visible');

      const logPath = path.join(tempDir, 'nightytidy-run.log');
      const content = readFileSync(logPath, 'utf8');

      expect(content).not.toContain('debug-hidden');
      expect(content).not.toContain('info-hidden');
      expect(content).toContain('warn-visible');
    } finally {
      stdoutSpy.mockRestore();
      delete process.env.NIGHTYTIDY_LOG_LEVEL;
    }
  });

  it('falls back to info level for unknown NIGHTYTIDY_LOG_LEVEL values', async () => {
    const { initLogger, debug, info } = await import('../src/logger.js');

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      process.env.NIGHTYTIDY_LOG_LEVEL = 'nonsense';
      initLogger(tempDir);

      // Should warn on stderr about the invalid value
      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining('Unknown NIGHTYTIDY_LOG_LEVEL="nonsense"'),
      );

      debug('debug-hidden');
      info('info-visible');

      const logPath = path.join(tempDir, 'nightytidy-run.log');
      const content = readFileSync(logPath, 'utf8');

      expect(content).not.toContain('debug-hidden');
      expect(content).toContain('info-visible');
    } finally {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
      delete process.env.NIGHTYTIDY_LOG_LEVEL;
    }
  });

  it('writes to stdout in addition to the log file', async () => {
    const { initLogger, info } = await import('../src/logger.js');

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      initLogger(tempDir);
      info('stdout test');

      expect(stdoutSpy).toHaveBeenCalledWith(
        expect.stringContaining('stdout test'),
      );
    } finally {
      stdoutSpy.mockRestore();
    }
  });

  it('falls back to stderr when log file write fails', async () => {
    const { initLogger, info } = await import('../src/logger.js');

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      // Initialize logger in a temporary directory, then delete the directory
      // so appendFileSync fails on the next log call
      const ephemeralDir = await mkdtemp(path.join(tmpdir(), 'nightytidy-ephemeral-'));
      initLogger(ephemeralDir);

      // Remove the directory (and log file) so writes fail
      await robustCleanup(ephemeralDir);

      info('fallback test');

      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining('[logger file error]'),
      );
    } finally {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    }
  });

  it('includes ISO timestamp in log messages', async () => {
    const { initLogger, info } = await import('../src/logger.js');

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      initLogger(tempDir);
      info('timestamp test');

      const logPath = path.join(tempDir, 'nightytidy-run.log');
      const content = readFileSync(logPath, 'utf8');

      // Should match ISO 8601 timestamp format
      expect(content).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    } finally {
      stdoutSpy.mockRestore();
    }
  });
});
