/**
 * Additional error path tests for src/checks.js
 *
 * Covers:
 * - runCommand timer cleanup on process error (line 31)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

import { createLoggerMock } from './helpers/mocks.js';

function createMockProcess() {
  const emitter = new EventEmitter();
  emitter.stdout = new EventEmitter();
  emitter.stderr = new EventEmitter();
  emitter.kill = vi.fn();
  return emitter;
}

describe('checks.js additional error paths', () => {
  let mockSpawn;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockSpawn = vi.fn();
  });

  afterEach(async () => {
    vi.runAllTimers();
    vi.useRealTimers();
    await new Promise(r => setTimeout(r, 0));
    vi.resetModules();
  });

  describe('runCommand error handling', () => {
    it('clears timeout and rejects on process error (line 31)', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });

      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      vi.doMock('child_process', () => ({ spawn: mockSpawn }));
      vi.doMock('../src/logger.js', () => createLoggerMock());
      vi.doMock('../src/env.js', () => ({ cleanEnv: () => ({}) }));

      const { runPreChecks } = await import('../src/checks.js');

      const mockGit = {
        checkIsRepo: vi.fn().mockResolvedValue(true),
        log: vi.fn().mockResolvedValue({ latest: { hash: 'abc' } }),
        status: vi.fn().mockResolvedValue({ files: [], isClean: () => true }),
      };

      const checkPromise = runPreChecks('/test/dir', mockGit);

      // Emit error on git --version
      await vi.advanceTimersByTimeAsync(10);
      mockProcess.emit('error', new Error('ENOENT'));

      // Should fail gracefully with git error message
      await expect(checkPromise).rejects.toThrow(/Git is not installed/);

      vi.doUnmock('child_process');
      vi.doUnmock('../src/logger.js');
      vi.doUnmock('../src/env.js');
    });
  });
});
