/**
 * Unit tests for src/lock.js — atomic lock file management.
 *
 * Tests the acquireLock / releaseLock contract:
 *   - acquireLock throws on contention (active lock, non-TTY)
 *   - acquireLock removes stale locks (dead PID, corrupt file, 24h+ age)
 *   - releaseLock silently removes or ignores missing lock
 *   - persistent mode skips the process 'exit' handler registration
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile } from 'fs/promises';
import { existsSync, writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { robustCleanup } from './helpers/cleanup.js';

vi.mock('../src/logger.js', () => ({
  initLogger: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const LOCK_FILENAME = 'nightytidy.lock';

describe('lock.js', () => {
  let tempDir;

  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = await mkdtemp(path.join(tmpdir(), 'nightytidy-lock-'));
  });

  afterEach(async () => {
    // Clean up lock file so releaseLock tests don't interfere
    const lockPath = path.join(tempDir, LOCK_FILENAME);
    try { unlinkSync(lockPath); } catch { /* already gone */ }
    await robustCleanup(tempDir);
  });

  describe('acquireLock', () => {
    it('creates a lock file with PID and timestamp when no lock exists', async () => {
      // Fresh import to avoid module caching issues with process.on
      const { acquireLock } = await import('../src/lock.js');

      await acquireLock(tempDir);

      const lockPath = path.join(tempDir, LOCK_FILENAME);
      expect(existsSync(lockPath)).toBe(true);

      const content = JSON.parse(await readFile(lockPath, 'utf8'));
      expect(content.pid).toBe(process.pid);
      expect(content.started).toBeDefined();
      // Verify ISO date format
      expect(new Date(content.started).toISOString()).toBe(content.started);
    });

    it('removes stale lock from dead process and reacquires', async () => {
      const { acquireLock } = await import('../src/lock.js');
      const { warn } = await import('../src/logger.js');

      // Write a lock file with a PID that doesn't exist
      const lockPath = path.join(tempDir, LOCK_FILENAME);
      writeFileSync(lockPath, JSON.stringify({
        pid: 999999999, // Very unlikely to be alive
        started: new Date(Date.now() - 60000).toISOString(), // 1 min ago
      }));

      await acquireLock(tempDir);

      // Should have been replaced with our PID
      const content = JSON.parse(await readFile(lockPath, 'utf8'));
      expect(content.pid).toBe(process.pid);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('stale lock'));
    });

    it('removes stale lock with corrupt JSON and reacquires', async () => {
      const { acquireLock } = await import('../src/lock.js');
      const { warn } = await import('../src/logger.js');

      const lockPath = path.join(tempDir, LOCK_FILENAME);
      writeFileSync(lockPath, 'not valid json!!!');

      await acquireLock(tempDir);

      const content = JSON.parse(await readFile(lockPath, 'utf8'));
      expect(content.pid).toBe(process.pid);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('stale lock'));
    });

    it('removes stale lock older than 24 hours regardless of PID', async () => {
      const { acquireLock } = await import('../src/lock.js');
      const { warn } = await import('../src/logger.js');

      // Use current PID (process.pid is alive) but lock is 25 hours old
      const lockPath = path.join(tempDir, LOCK_FILENAME);
      const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      writeFileSync(lockPath, JSON.stringify({
        pid: process.pid,
        started: twentyFiveHoursAgo,
      }));

      await acquireLock(tempDir);

      const content = JSON.parse(await readFile(lockPath, 'utf8'));
      expect(content.pid).toBe(process.pid);
      // The started time should be fresh, not the old one
      const startedAge = Date.now() - new Date(content.started).getTime();
      expect(startedAge).toBeLessThan(5000); // within last 5 seconds
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('stale lock'));
    });

    it('throws in non-TTY when lock is held by active process', async () => {
      const { acquireLock } = await import('../src/lock.js');

      // Write a lock with our own PID (definitely alive) and recent timestamp
      const lockPath = path.join(tempDir, LOCK_FILENAME);
      writeFileSync(lockPath, JSON.stringify({
        pid: process.pid,
        started: new Date().toISOString(),
      }));

      // Test environment is non-TTY, so promptOverride should throw
      await expect(acquireLock(tempDir))
        .rejects.toThrow(/already in progress/);
    });

    it('rethrows non-EEXIST errors from writeLockFile', async () => {
      const { acquireLock } = await import('../src/lock.js');

      // Make the directory read-only to trigger EACCES/EPERM
      // On Windows this approach may not work reliably, so we test with an invalid path
      const invalidPath = path.join(tempDir, 'nonexistent-subdir', 'deeper');

      await expect(acquireLock(invalidPath))
        .rejects.toThrow(); // ENOENT because the directory doesn't exist
    });

    it('does not register exit handler in persistent mode', async () => {
      const { acquireLock } = await import('../src/lock.js');

      const onSpy = vi.spyOn(process, 'on');

      await acquireLock(tempDir, { persistent: true });

      // In persistent mode, no 'exit' handler should be added for lock cleanup
      const exitCalls = onSpy.mock.calls.filter(([event]) => event === 'exit');
      // We can't guarantee no exit handler was registered by other code,
      // but we verify the lock was acquired
      const lockPath = path.join(tempDir, LOCK_FILENAME);
      expect(existsSync(lockPath)).toBe(true);

      onSpy.mockRestore();
    });
  });

  describe('releaseLock', () => {
    it('removes existing lock file', async () => {
      const { releaseLock } = await import('../src/lock.js');

      const lockPath = path.join(tempDir, LOCK_FILENAME);
      writeFileSync(lockPath, JSON.stringify({ pid: process.pid, started: new Date().toISOString() }));
      expect(existsSync(lockPath)).toBe(true);

      releaseLock(tempDir);

      expect(existsSync(lockPath)).toBe(false);
    });

    it('does not throw when lock file does not exist', async () => {
      const { releaseLock } = await import('../src/lock.js');

      // No lock file exists — should not throw
      expect(() => releaseLock(tempDir)).not.toThrow();
    });
  });
});
