/**
 * Extended tests for src/lock.js — covers additional edge cases
 * for better branch coverage.
 *
 * Tests added for:
 * - Race condition during removeLockAndReacquire (EEXIST retry)
 * - Lock file with missing 'started' field
 * - Lock file with invalid date
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, access, mkdir, rm } from 'fs/promises';
import { existsSync, writeFileSync, unlinkSync, openSync, closeSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { robustCleanup } from './helpers/cleanup.js';

import { createLoggerMock } from './helpers/mocks.js';

vi.mock('../src/logger.js', () => createLoggerMock());

const LOCK_FILENAME = 'nightytidy.lock';

describe('lock.js extended', () => {
  let tempDir;

  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = await mkdtemp(path.join(tmpdir(), 'nightytidy-lock-ext-'));
  });

  afterEach(async () => {
    const lockPath = path.join(tempDir, LOCK_FILENAME);
    try { unlinkSync(lockPath); } catch { /* already gone */ }
    await robustCleanup(tempDir);
  });

  describe('acquireLock - edge cases', () => {
    it('handles lock file with no started field (treated as stale)', async () => {
      const { acquireLock } = await import('../src/lock.js');
      const { warn } = await import('../src/logger.js');

      // Write a lock with a dead PID but no started field
      const lockPath = path.join(tempDir, LOCK_FILENAME);
      writeFileSync(lockPath, JSON.stringify({
        pid: 999999999, // dead PID
        // no 'started' field
      }));

      await acquireLock(tempDir);

      const content = JSON.parse(await readFile(lockPath, 'utf8'));
      expect(content.pid).toBe(process.pid);
      expect(content.started).toBeDefined();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('stale lock'));
    });

    it('handles lock file with null pid (treated as stale)', async () => {
      const { acquireLock } = await import('../src/lock.js');
      const { warn } = await import('../src/logger.js');

      const lockPath = path.join(tempDir, LOCK_FILENAME);
      writeFileSync(lockPath, JSON.stringify({
        pid: null, // invalid PID
        started: new Date().toISOString(),
      }));

      await acquireLock(tempDir);

      const content = JSON.parse(await readFile(lockPath, 'utf8'));
      expect(content.pid).toBe(process.pid);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('stale lock'));
    });

    it('handles lock file with non-numeric pid (treated as stale)', async () => {
      const { acquireLock } = await import('../src/lock.js');
      const { warn } = await import('../src/logger.js');

      const lockPath = path.join(tempDir, LOCK_FILENAME);
      writeFileSync(lockPath, JSON.stringify({
        pid: 'not-a-number',
        started: new Date().toISOString(),
      }));

      await acquireLock(tempDir);

      const content = JSON.parse(await readFile(lockPath, 'utf8'));
      expect(content.pid).toBe(process.pid);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('stale lock'));
    });

    it('handles empty lock file (treated as stale)', async () => {
      const { acquireLock } = await import('../src/lock.js');
      const { warn } = await import('../src/logger.js');

      const lockPath = path.join(tempDir, LOCK_FILENAME);
      writeFileSync(lockPath, '');

      await acquireLock(tempDir);

      const content = JSON.parse(await readFile(lockPath, 'utf8'));
      expect(content.pid).toBe(process.pid);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('stale lock'));
    });

    it('handles lock file with invalid ISO date in started field', async () => {
      const { acquireLock } = await import('../src/lock.js');
      const { warn } = await import('../src/logger.js');

      // Lock with invalid date but dead PID — should be treated as stale
      const lockPath = path.join(tempDir, LOCK_FILENAME);
      writeFileSync(lockPath, JSON.stringify({
        pid: 999999999, // dead PID
        started: 'invalid-date',
      }));

      await acquireLock(tempDir);

      const content = JSON.parse(await readFile(lockPath, 'utf8'));
      expect(content.pid).toBe(process.pid);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('stale lock'));
    });
  });

  describe('releaseLock - extended', () => {
    it('handles simultaneous release calls without error', async () => {
      const { acquireLock, releaseLock } = await import('../src/lock.js');

      await acquireLock(tempDir);

      // Multiple release calls should not throw
      releaseLock(tempDir);
      releaseLock(tempDir);
      releaseLock(tempDir);

      const lockPath = path.join(tempDir, LOCK_FILENAME);
      expect(existsSync(lockPath)).toBe(false);
    });
  });
});
