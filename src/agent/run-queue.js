import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { debug } from '../logger.js';

const QUEUE_FILE = 'queue.json';
const QUEUE_VERSION = 1;

export class RunQueue {
  constructor(configDir) {
    this.configDir = configDir;
    this.filePath = path.join(configDir, QUEUE_FILE);
    const state = this._load();
    this.queue = state.queue;
    this.current = state.current;
  }

  getQueue() {
    return [...this.queue];
  }

  getCurrent() {
    return this.current;
  }

  enqueue({ projectId, steps, timeout }) {
    const run = {
      id: `run-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
      projectId,
      steps,
      timeout,
      status: 'queued',
      enqueuedAt: Date.now(),
    };
    this.queue.push(run);
    this._save();
    debug(`Enqueued run ${run.id} for project ${projectId}`);
    return run;
  }

  dequeue() {
    if (this.queue.length === 0) return null;
    this.current = this.queue.shift();
    this.current.status = 'running';
    this.current.startedAt = Date.now();
    this._save();
    debug(`Dequeued run ${this.current.id}`);
    return this.current;
  }

  completeCurrent(result) {
    if (this.current) {
      debug(`Completed run ${this.current.id}: ${result.success ? 'success' : 'failure'}`);
      this.current = null;
      this._save();
    }
  }

  cancel(runId) {
    this.queue = this.queue.filter(r => r.id !== runId);
    if (this.current && this.current.id === runId) {
      this.current = null;
    }
    this._save();
    debug(`Cancelled run ${runId}`);
  }

  reorder(orderIds) {
    const byId = new Map(this.queue.map(r => [r.id, r]));
    const reordered = [];
    for (const id of orderIds) {
      const run = byId.get(id);
      if (run) {
        reordered.push(run);
        byId.delete(id);
      }
    }
    // Append any remaining runs not in the reorder list
    for (const run of byId.values()) {
      reordered.push(run);
    }
    this.queue = reordered;
    this._save();
  }

  _load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      return { queue: data.queue || [], current: data.current || null };
    } catch {
      return { queue: [], current: null };
    }
  }

  _save() {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }
    fs.writeFileSync(this.filePath, JSON.stringify({
      version: QUEUE_VERSION,
      queue: this.queue,
      current: this.current,
    }, null, 2));
  }
}
