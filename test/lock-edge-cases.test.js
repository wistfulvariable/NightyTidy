/**
 * Extended edge case tests for src/lock.js
 *
 * Covers:
 * - EEXIST race condition during removeLockAndReacquire (lines 68-74)
 * - User override prompt path in TTY mode (lines 105-110)
 * - Exit handler registration verification (lines 117-120)
 * - non-EEXIST errors in removeLockAndReacquire (line 74)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile } from 'fs/promises';
import { existsSync, writeFileSync, unlinkSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { robustCleanup } from './helpers/cleanup.js';

import { createLoggerMock } from './helpers/mocks.js';

vi.mock('../src/logger.js', () => createLoggerMock());

const LOCK_FILENAME = 'nightytidy.lock';

describe('lock.js edge cases', () => {
  let tempDir;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    tempDir = await mkdtemp(path.join(tmpdir(), 'nightytidy-lock-edge-'));
  });

  afterEach(async () => {
    const lockPath = path.join(tempDir, LOCK_FILENAME);
    try { unlinkSync(lockPath); } catch { /* already gone */ }
    await robustCleanup(tempDir);
  });

  describe('removeLockAndReacquire race condition', () => {
    it('throws clear error when another process acquires lock during cleanup (EEXIST race)', async () => {
      // This tests lines 68-72: when writeLockFile fails with EEXIST after unlinkSync
      // We need to simulate another process creating the lock between unlink and write

      // Reset modules to get fresh fs mock
      vi.doMock('fs', async (importOriginal) => {
        const actual = await importOriginal();
        let unlinkCalled = false;
        return {
          ...actual,
          unlinkSync: (p) => {
            actual.unlinkSync(p);
            unlinkCalled = true;
            // Simulate race: after unlink, another process creates the lock
            if (unlinkCalled && p.endsWith(LOCK_FILENAME)) {
              actual.writeFileSync(p, JSON.stringify({ pid: 88888, started: new Date().toISOString() }));
            }
          },
        };
      });

      const lockPath = path.join(tempDir, LOCK_FILENAME);

      // Create a stale lock that will trigger removeLockAndReacquire
      writeFileSync(lockPath, JSON.stringify({
        pid: 999999999, // dead PID
        started: new Date().toISOString(),
      }));

      // Need fresh import after vi.doMock
      const { acquireLock } = await import('../src/lock.js');

      // The acquireLock should throw because of the simulated race
      await expect(acquireLock(tempDir)).rejects.toThrow(/Another NightyTidy run acquired the lock/);

      vi.doUnmock('fs');
    });
  });

  describe('non-EEXIST errors during reacquire', () => {
    it('rethrows non-EEXIST errors from writeLockFile in removeLockAndReacquire (line 74)', async () => {
      // Create a directory with the lock filename - openSync will fail with EISDIR
      const lockPath = path.join(tempDir, LOCK_FILENAME);
      const { mkdirSync } = await import('fs');

      // First create a stale lock file
      writeFileSync(lockPath, JSON.stringify({
        pid: 999999999,
        started: new Date().toISOString(),
      }));

      // Now mock fs to have the lock path become a directory after unlink
      vi.doMock('fs', async (importOriginal) => {
        const actual = await importOriginal();
        let unlinkCalled = false;
        return {
          ...actual,
          unlinkSync: (p) => {
            actual.unlinkSync(p);
            // After unlink, create directory with same name to cause EISDIR
            if (p.endsWith(LOCK_FILENAME)) {
              try { actual.mkdirSync(p); } catch { /* may fail */ }
            }
          },
        };
      });

      const { acquireLock } = await import('../src/lock.js');

      // Should throw EISDIR or similar
      await expect(acquireLock(tempDir)).rejects.toThrow();

      vi.doUnmock('fs');

      // Cleanup the directory we created
      try {
        const { rmdirSync } = await import('fs');
        rmdirSync(lockPath);
      } catch { /* ignore */ }
    });
  });

  describe('exit handler registration', () => {
    it('registers exit handler when not in persistent mode', async () => {
      vi.resetModules();
      const onSpy = vi.spyOn(process, 'on');

      const { acquireLock } = await import('../src/lock.js');
      await acquireLock(tempDir);

      // Should have registered an 'exit' handler
      const exitCalls = onSpy.mock.calls.filter(([event]) => event === 'exit');
      expect(exitCalls.length).toBeGreaterThanOrEqual(1);

      onSpy.mockRestore();
    });

    it('exit handler removes lock file when process exits', async () => {
      vi.resetModules();
      const exitHandlers = [];
      const originalOn = process.on.bind(process);
      const onSpy = vi.spyOn(process, 'on').mockImplementation((event, handler) => {
        if (event === 'exit') {
          exitHandlers.push(handler);
        }
        return originalOn(event, handler);
      });

      const { acquireLock } = await import('../src/lock.js');
      await acquireLock(tempDir);

      const lockPath = path.join(tempDir, LOCK_FILENAME);
      expect(existsSync(lockPath)).toBe(true);

      // Simulate exit by calling the registered handlers
      for (const handler of exitHandlers) {
        handler();
      }

      // Lock should be removed
      expect(existsSync(lockPath)).toBe(false);

      onSpy.mockRestore();
    });
  });

  describe('user cancels override prompt', () => {
    it('throws when user declines to override active lock (lines 106-107)', async () => {
      vi.resetModules();

      // Mock readline to simulate user typing 'n'
      vi.doMock('readline', () => ({
        createInterface: () => ({
          question: (prompt, callback) => {
            // Simulate user typing 'n' (decline)
            setImmediate(() => callback('n'));
          },
          close: vi.fn(),
        }),
      }));

      // Mock process.stdin.isTTY to true
      const originalIsTTY = process.stdin.isTTY;
      Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true });

      const { acquireLock } = await import('../src/lock.js');

      // Create a lock with current PID (alive process) so it's not stale
      const lockPath = path.join(tempDir, LOCK_FILENAME);
      // Use a different alive PID - we'll use a parent process PID trick
      // Actually, use current PID but very recent timestamp - not stale
      writeFileSync(lockPath, JSON.stringify({
        pid: process.pid,
        started: new Date().toISOString(),
      }));

      await expect(acquireLock(tempDir)).rejects.toThrow(/lock file was not overridden/);

      // Restore
      Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY });
      vi.doUnmock('readline');
    });

    it('succeeds and logs when user confirms override (lines 109-110)', async () => {
      vi.resetModules();

      // Mock readline to simulate user typing 'y'
      vi.doMock('readline', () => ({
        createInterface: () => ({
          question: (prompt, callback) => {
            setImmediate(() => callback('y'));
          },
          close: vi.fn(),
        }),
      }));

      // Mock process.stdin.isTTY to true
      const originalIsTTY = process.stdin.isTTY;
      Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true });

      const { acquireLock } = await import('../src/lock.js');
      const { warn } = await import('../src/logger.js');

      // Create lock with current PID - alive, not stale
      const lockPath = path.join(tempDir, LOCK_FILENAME);
      writeFileSync(lockPath, JSON.stringify({
        pid: process.pid,
        started: new Date().toISOString(),
      }));

      await acquireLock(tempDir);

      // Should have logged override warning
      expect(warn).toHaveBeenCalledWith('Lock file overridden by user');

      // Lock should now be owned by us
      const content = JSON.parse(readFileSync(lockPath, 'utf8'));
      expect(content.pid).toBe(process.pid);

      // Restore
      Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY });
      vi.doUnmock('readline');
    });
  });
});
