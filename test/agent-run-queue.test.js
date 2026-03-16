import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RunQueue } from '../src/agent/run-queue.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { robustCleanup } from './helpers/cleanup.js';

vi.mock('../src/logger.js', () => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  initLogger: vi.fn(),
}));

describe('RunQueue', () => {
  let tmpDir, queue;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-queue-'));
    queue = new RunQueue(tmpDir);
  });

  afterEach(async () => {
    await robustCleanup(tmpDir);
  });

  it('starts empty', () => {
    expect(queue.getQueue()).toEqual([]);
    expect(queue.getCurrent()).toBeNull();
  });

  it('enqueues a run', () => {
    const run = queue.enqueue({ projectId: 'abc', steps: [1, 2, 3], timeout: 45 });
    expect(run.id).toBeDefined();
    expect(run.status).toBe('queued');
    expect(queue.getQueue()).toHaveLength(1);
  });

  it('dequeues the next run', () => {
    queue.enqueue({ projectId: 'abc', steps: [1], timeout: 45 });
    const next = queue.dequeue();
    expect(next.projectId).toBe('abc');
    expect(next.status).toBe('running');
    expect(queue.getCurrent()).toEqual(next);
    expect(queue.getQueue()).toHaveLength(0);
  });

  it('returns null when dequeuing empty queue', () => {
    expect(queue.dequeue()).toBeNull();
  });

  it('completes the current run', () => {
    queue.enqueue({ projectId: 'abc', steps: [1], timeout: 45 });
    queue.dequeue();
    queue.completeCurrent({ success: true });
    expect(queue.getCurrent()).toBeNull();
  });

  it('reorders queued runs', () => {
    const r1 = queue.enqueue({ projectId: 'a', steps: [1], timeout: 45 });
    const r2 = queue.enqueue({ projectId: 'b', steps: [2], timeout: 45 });
    const r3 = queue.enqueue({ projectId: 'c', steps: [3], timeout: 45 });
    queue.reorder([r3.id, r1.id, r2.id]);
    const ids = queue.getQueue().map(r => r.id);
    expect(ids).toEqual([r3.id, r1.id, r2.id]);
  });

  it('cancels a queued run', () => {
    const run = queue.enqueue({ projectId: 'abc', steps: [1], timeout: 45 });
    queue.cancel(run.id);
    expect(queue.getQueue()).toHaveLength(0);
  });

  it('persists across instances', () => {
    queue.enqueue({ projectId: 'abc', steps: [1], timeout: 45 });
    const queue2 = new RunQueue(tmpDir);
    expect(queue2.getQueue()).toHaveLength(1);
  });

  it('ignores unknown IDs in reorder', () => {
    const r1 = queue.enqueue({ projectId: 'a', steps: [1], timeout: 45 });
    queue.reorder(['unknown', r1.id]);
    expect(queue.getQueue()).toHaveLength(1);
    expect(queue.getQueue()[0].id).toBe(r1.id);
  });
});
