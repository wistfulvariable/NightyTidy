import { vi } from 'vitest';
import { EventEmitter } from 'events';

/**
 * Creates a mock child process that emits data and closes on the next tick.
 * Used by checks.test.js and checks-extended.test.js.
 */
export function createMockProcess({ code = 0, stdout = '', stderr = '' } = {}) {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();

  process.nextTick(() => {
    if (stdout) proc.stdout.emit('data', Buffer.from(stdout));
    if (stderr) proc.stderr.emit('data', Buffer.from(stderr));
    proc.emit('close', code);
  });

  return proc;
}

/**
 * Creates a mock child process that emits an error on the next tick.
 */
export function createErrorProcess(errorMessage = 'command not found') {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();

  process.nextTick(() => {
    proc.emit('error', new Error(errorMessage));
  });

  return proc;
}

/**
 * Creates a mock child process that never resolves (simulates a hang).
 * Kill triggers close on the next tick.
 */
export function createTimeoutProcess() {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn(() => {
    process.nextTick(() => proc.emit('close', null));
  });
  return proc;
}

/**
 * Creates a mock simple-git instance for checks.js tests.
 */
export function createMockGit({ isRepo = true, branches = [], hasCommits = true, status = null } = {}) {
  const defaultStatus = { modified: [], not_added: [], deleted: [], renamed: [], staged: [] };
  return {
    checkIsRepo: vi.fn().mockResolvedValue(isRepo),
    branch: vi.fn().mockResolvedValue({ all: branches }),
    log: vi.fn().mockResolvedValue({ latest: hasCommits ? { hash: 'abc123' } : null }),
    status: vi.fn().mockResolvedValue(status || defaultStatus),
  };
}
