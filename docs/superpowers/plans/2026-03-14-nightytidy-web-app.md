# NightyTidy Web App — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deployed web app (nightytidy.com) with a local agent that enables polished, intuitive NightyTidy runs with remote monitoring, scheduling, and analytics.

**Architecture:** Two codebases — (1) local agent as `agent` subcommand in existing NightyTidy repo (`src/agent/`), (2) Next.js web app in new `nightytidy-web` repo with Firebase Hosting + Cloud Functions + Firestore. Agent communicates with browser via localhost WebSocket, pushes status to cloud via webhooks.

**Tech Stack:** Node.js (agent), Next.js/React (web), Firebase Auth/Hosting/Functions/Firestore (cloud), WebSocket (ws), node-cron (scheduling), Recharts (analytics)

**Spec:** `docs/superpowers/specs/2026-03-14-nightytidy-web-app-design.md`

---

## Plan Structure

This plan is split into 3 sequential chunks:

1. **Chunk 1: Local Agent** (NightyTidy repo) — the foundation
2. **Chunk 2: Web App + Cloud** (nightytidy-web repo) — frontend + Firebase
3. **Chunk 3: Integration + Deploy** — connecting everything, deployment

Each chunk produces working, testable software independently.

---

## Chunk 1: Local Agent

The agent runs on the user's machine, manages projects, queues runs, schedules cron jobs, and communicates via WebSocket. It shells out to the NightyTidy CLI for actual execution.

### File Structure

```
src/agent/
├── index.js                  # Entry point — starts all components, graceful shutdown
├── websocket-server.js       # WebSocket server (localhost:48372, token auth, ping/pong)
├── project-manager.js        # CRUD for ~/.nightytidy/projects.json
├── run-queue.js              # Sequential run queue with persistence
├── scheduler.js              # Cron scheduling (node-cron wrapper)
├── cli-bridge.js             # NightyTidy CLI subprocess wrapper + output parsing
├── webhook-dispatcher.js     # Send webhooks to nightytidy.com + external endpoints
├── git-integration.js        # git diff, PR creation via gh, rollback
├── firebase-auth.js          # Firebase auth (browser OAuth, token caching)
├── config.js                 # Read/write ~/.nightytidy/config.json (versioned)
test/
├── agent-config.test.js
├── agent-project-manager.test.js
├── agent-run-queue.test.js
├── agent-scheduler.test.js
├── agent-cli-bridge.test.js
├── agent-webhook-dispatcher.test.js
├── agent-git-integration.test.js
├── agent-websocket-server.test.js
├── agent-index.test.js
```

---

### Task 1: Config Module

**Files:**
- Create: `src/agent/config.js`
- Create: `test/agent-config.test.js`

- [ ] **Step 1: Write failing tests for config module**

```javascript
// test/agent-config.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readConfig, writeConfig, getConfigDir, CONFIG_VERSION } from '../src/agent/config.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { robustCleanup } from './helpers/cleanup.js';

vi.mock('../src/logger.js', () => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  initLogger: vi.fn(),
}));

describe('agent config', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-config-'));
  });

  afterEach(async () => {
    await robustCleanup(tmpDir);
  });

  it('returns default config when file does not exist', () => {
    const config = readConfig(tmpDir);
    expect(config.version).toBe(CONFIG_VERSION);
    expect(config.port).toBe(48372);
    expect(config.token).toBeDefined();
    expect(typeof config.token).toBe('string');
    expect(config.token.length).toBeGreaterThan(0);
  });

  it('writes and reads config', () => {
    const config = { version: CONFIG_VERSION, port: 48372, token: 'abc123', machine: 'test' };
    writeConfig(tmpDir, config);
    const read = readConfig(tmpDir);
    expect(read).toEqual(config);
  });

  it('includes version field', () => {
    expect(CONFIG_VERSION).toBe(1);
  });

  it('getConfigDir returns ~/.nightytidy path', () => {
    const dir = getConfigDir();
    expect(dir).toContain('.nightytidy');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/agent-config.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement config module**

```javascript
// src/agent/config.js
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { debug, warn } from '../logger.js';

export const CONFIG_VERSION = 1;
const CONFIG_FILE = 'config.json';
const PROJECTS_FILE = 'projects.json';
const QUEUE_FILE = 'queue.json';

export function getConfigDir() {
  return path.join(os.homedir(), '.nightytidy');
}

export function ensureConfigDir(configDir) {
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
    debug(`Created config directory: ${configDir}`);
  }
}

export function readConfig(configDir) {
  const filePath = path.join(configDir, CONFIG_FILE);
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (data.version === CONFIG_VERSION) return data;
    debug(`Config version mismatch: ${data.version} → ${CONFIG_VERSION}, migrating`);
    return migrateConfig(data);
  } catch {
    return createDefaultConfig();
  }
}

export function writeConfig(configDir, config) {
  ensureConfigDir(configDir);
  const filePath = path.join(configDir, CONFIG_FILE);
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2));
}

function createDefaultConfig() {
  return {
    version: CONFIG_VERSION,
    port: 48372,
    token: crypto.randomBytes(24).toString('hex'),
    machine: os.hostname(),
  };
}

function migrateConfig(data) {
  // Future migrations go here
  return { ...createDefaultConfig(), ...data, version: CONFIG_VERSION };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/agent-config.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agent/config.js test/agent-config.test.js
git commit -m "feat(agent): add config module with versioned ~/.nightytidy/config.json"
```

---

### Task 2: Project Manager

**Files:**
- Create: `src/agent/project-manager.js`
- Create: `test/agent-project-manager.test.js`

- [ ] **Step 1: Write failing tests**

```javascript
// test/agent-project-manager.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProjectManager } from '../src/agent/project-manager.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { robustCleanup } from './helpers/cleanup.js';

vi.mock('../src/logger.js', () => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  initLogger: vi.fn(),
}));

describe('ProjectManager', () => {
  let tmpDir, pm;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-pm-'));
    pm = new ProjectManager(tmpDir);
  });

  afterEach(async () => {
    await robustCleanup(tmpDir);
  });

  it('starts with empty project list', () => {
    expect(pm.listProjects()).toEqual([]);
  });

  it('adds a project', () => {
    const project = pm.addProject(tmpDir, 'TestProject');
    expect(project.id).toBeDefined();
    expect(project.name).toBe('TestProject');
    expect(project.path).toBe(tmpDir);
    expect(pm.listProjects()).toHaveLength(1);
  });

  it('removes a project', () => {
    const project = pm.addProject(tmpDir, 'TestProject');
    pm.removeProject(project.id);
    expect(pm.listProjects()).toEqual([]);
  });

  it('persists projects across instances', () => {
    pm.addProject(tmpDir, 'TestProject');
    const pm2 = new ProjectManager(tmpDir);
    expect(pm2.listProjects()).toHaveLength(1);
  });

  it('generates unique IDs', () => {
    const p1 = pm.addProject(tmpDir, 'A');
    const p2 = pm.addProject(path.join(tmpDir, '..'), 'B');
    expect(p1.id).not.toBe(p2.id);
  });

  it('gets project by ID', () => {
    const project = pm.addProject(tmpDir, 'TestProject');
    const found = pm.getProject(project.id);
    expect(found.name).toBe('TestProject');
  });

  it('returns null for unknown project ID', () => {
    expect(pm.getProject('nonexistent')).toBeNull();
  });

  it('updates project fields', () => {
    const project = pm.addProject(tmpDir, 'TestProject');
    pm.updateProject(project.id, { lastRunAt: Date.now() });
    const found = pm.getProject(project.id);
    expect(found.lastRunAt).toBeDefined();
  });

  it('prunes projects with non-existent paths', () => {
    pm.addProject('/nonexistent/path/12345', 'Ghost');
    pm.pruneStaleProjects();
    expect(pm.listProjects()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/agent-project-manager.test.js`
Expected: FAIL

- [ ] **Step 3: Implement ProjectManager**

```javascript
// src/agent/project-manager.js
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { debug, warn } from '../logger.js';

const PROJECTS_FILE = 'projects.json';
const PROJECTS_VERSION = 1;

export class ProjectManager {
  constructor(configDir) {
    this.configDir = configDir;
    this.filePath = path.join(configDir, PROJECTS_FILE);
    this.projects = this._load();
  }

  listProjects() {
    return [...this.projects];
  }

  getProject(id) {
    const project = this.projects.find(p => p.id === id);
    return project ? { ...project } : null;
  }

  addProject(projectPath, name) {
    const project = {
      id: crypto.randomBytes(8).toString('hex'),
      name,
      path: projectPath,
      addedAt: Date.now(),
      lastRunAt: null,
      schedule: null,
      webhooks: [],
    };
    this.projects.push(project);
    this._save();
    debug(`Added project: ${name} at ${projectPath}`);
    return project;
  }

  removeProject(id) {
    this.projects = this.projects.filter(p => p.id !== id);
    this._save();
    debug(`Removed project: ${id}`);
  }

  updateProject(id, updates) {
    // Find directly in array (not via getProject which returns a copy)
    const project = this.projects.find(p => p.id === id);
    if (project) {
      Object.assign(project, updates);
      this._save();
    }
  }

  pruneStaleProjects() {
    const before = this.projects.length;
    this.projects = this.projects.filter(p => {
      if (!fs.existsSync(p.path)) {
        warn(`Pruning stale project: ${p.name} (${p.path})`);
        return false;
      }
      return true;
    });
    if (this.projects.length < before) this._save();
  }

  _load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      if (data.version === PROJECTS_VERSION) return data.projects || [];
      return this._migrate(data);
    } catch {
      return [];
    }
  }

  _save() {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }
    fs.writeFileSync(this.filePath, JSON.stringify({
      version: PROJECTS_VERSION,
      projects: this.projects,
    }, null, 2));
  }

  _migrate(data) {
    return data.projects || [];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/agent-project-manager.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agent/project-manager.js test/agent-project-manager.test.js
git commit -m "feat(agent): add project manager with CRUD and stale pruning"
```

---

### Task 3: Run Queue

**Files:**
- Create: `src/agent/run-queue.js`
- Create: `test/agent-run-queue.test.js`

- [ ] **Step 1: Write failing tests**

```javascript
// test/agent-run-queue.test.js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/agent-run-queue.test.js`
Expected: FAIL

- [ ] **Step 3: Implement RunQueue**

```javascript
// src/agent/run-queue.js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/agent-run-queue.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agent/run-queue.js test/agent-run-queue.test.js
git commit -m "feat(agent): add run queue with persistence and reorder"
```

---

### Task 4: Scheduler

**Files:**
- Create: `src/agent/scheduler.js`
- Create: `test/agent-scheduler.test.js`
- Modify: `package.json` — add `node-cron` dependency

- [ ] **Step 1: Install node-cron**

```bash
npm install node-cron
```

- [ ] **Step 2: Write failing tests**

```javascript
// test/agent-scheduler.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Scheduler } from '../src/agent/scheduler.js';

vi.mock('../src/logger.js', () => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  initLogger: vi.fn(),
}));

vi.mock('node-cron', () => ({
  default: {
    schedule: vi.fn(() => ({ stop: vi.fn() })),
    validate: vi.fn((expr) => {
      // Accept standard 5-field cron expressions (minute hour day month weekday)
      const parts = expr.trim().split(/\s+/);
      return parts.length === 5 && parts.every(p => /^[\d*,/\-]+$/.test(p));
    }),
  },
}));

describe('Scheduler', () => {
  let scheduler, onTrigger;

  beforeEach(() => {
    onTrigger = vi.fn();
    scheduler = new Scheduler(onTrigger);
  });

  afterEach(() => {
    scheduler.stopAll();
  });

  it('adds a schedule for a project', () => {
    scheduler.addSchedule('proj1', '0 2 * * *');
    expect(scheduler.getSchedules()).toHaveLength(1);
  });

  it('removes a schedule', () => {
    scheduler.addSchedule('proj1', '0 2 * * *');
    scheduler.removeSchedule('proj1');
    expect(scheduler.getSchedules()).toHaveLength(0);
  });

  it('replaces existing schedule for same project', () => {
    scheduler.addSchedule('proj1', '0 2 * * *');
    scheduler.addSchedule('proj1', '0 3 * * *');
    expect(scheduler.getSchedules()).toHaveLength(1);
  });

  it('validates cron expressions', () => {
    expect(Scheduler.isValidCron('0 2 * * *')).toBe(true);
    expect(Scheduler.isValidCron('invalid')).toBe(false);
  });

  it('stops all schedules', () => {
    scheduler.addSchedule('proj1', '0 2 * * *');
    scheduler.addSchedule('proj2', '0 3 * * *');
    scheduler.stopAll();
    expect(scheduler.getSchedules()).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/agent-scheduler.test.js`
Expected: FAIL

- [ ] **Step 4: Implement Scheduler**

```javascript
// src/agent/scheduler.js
import cron from 'node-cron';
import { info, debug } from '../logger.js';

export class Scheduler {
  constructor(onTrigger) {
    this.onTrigger = onTrigger;
    this.jobs = new Map(); // projectId → { cron, task }
  }

  addSchedule(projectId, cronExpression) {
    this.removeSchedule(projectId);
    const task = cron.schedule(cronExpression, () => {
      info(`Scheduled run triggered for project ${projectId}`);
      this.onTrigger(projectId, cronExpression);
    });
    this.jobs.set(projectId, { cron: cronExpression, task });
    debug(`Scheduled project ${projectId}: ${cronExpression}`);
  }

  removeSchedule(projectId) {
    const job = this.jobs.get(projectId);
    if (job) {
      job.task.stop();
      this.jobs.delete(projectId);
      debug(`Removed schedule for project ${projectId}`);
    }
  }

  getSchedules() {
    return Array.from(this.jobs.entries()).map(([projectId, { cron: expr }]) => ({
      projectId,
      cron: expr,
    }));
  }

  stopAll() {
    const ids = [...this.jobs.keys()];
    for (const id of ids) {
      this.removeSchedule(id);
    }
  }

  static isValidCron(expression) {
    return cron.validate(expression);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/agent-scheduler.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/agent/scheduler.js test/agent-scheduler.test.js package.json package-lock.json
git commit -m "feat(agent): add cron scheduler for automated runs"
```

---

### Task 5: CLI Bridge

**Files:**
- Create: `src/agent/cli-bridge.js`
- Create: `test/agent-cli-bridge.test.js`

- [ ] **Step 1: Write failing tests**

```javascript
// test/agent-cli-bridge.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CliBridge } from '../src/agent/cli-bridge.js';
import { EventEmitter } from 'node:events';

vi.mock('../src/logger.js', () => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  initLogger: vi.fn(),
}));

function createMockProcess(stdout = '', exitCode = 0) {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.pid = 12345;
  proc.kill = vi.fn();
  setTimeout(() => {
    if (stdout) proc.stdout.emit('data', Buffer.from(stdout));
    proc.emit('close', exitCode);
  }, 10);
  return proc;
}

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => createMockProcess('{"steps":[{"number":1,"name":"Documentation"}]}\n')),
}));

describe('CliBridge', () => {
  let bridge;

  beforeEach(() => {
    bridge = new CliBridge('/path/to/project');
  });

  it('lists steps via --list --json', async () => {
    const result = await bridge.listSteps();
    expect(result).toBeDefined();
  });

  it('builds correct command for init-run', () => {
    const cmd = CliBridge.buildArgs({ initRun: true, steps: [1, 5, 12] });
    expect(cmd).toContain('--init-run');
    expect(cmd).toContain('--steps');
    expect(cmd).toContain('1,5,12');
    expect(cmd).toContain('--skip-dashboard');
    expect(cmd).toContain('--skip-sync');
  });

  it('builds correct command for run-step', () => {
    const cmd = CliBridge.buildArgs({ runStep: 5 });
    expect(cmd).toContain('--run-step');
    expect(cmd).toContain('5');
  });

  it('builds correct command for finish-run', () => {
    const cmd = CliBridge.buildArgs({ finishRun: true });
    expect(cmd).toContain('--finish-run');
  });

  it('includes timeout when specified', () => {
    const cmd = CliBridge.buildArgs({ initRun: true, steps: [1], timeout: 60 });
    expect(cmd).toContain('--timeout');
    expect(cmd).toContain('60');
  });

  it('parses JSON from CLI stdout', () => {
    const parsed = CliBridge.parseOutput('some warning\n{"success":true}\n');
    expect(parsed).toEqual({ success: true });
  });

  it('returns null for unparseable output', () => {
    const parsed = CliBridge.parseOutput('not json at all');
    expect(parsed).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/agent-cli-bridge.test.js`
Expected: FAIL

- [ ] **Step 3: Implement CliBridge**

```javascript
// src/agent/cli-bridge.js
import { spawn } from 'node:child_process';
import path from 'node:path';
import { debug, error as logError } from '../logger.js';

export class CliBridge {
  constructor(projectDir) {
    this.projectDir = projectDir;
    this.activeProcess = null;
  }

  async listSteps() {
    return this._run(CliBridge.buildArgs({ list: true }));
  }

  async initRun(steps, timeout) {
    return this._run(CliBridge.buildArgs({ initRun: true, steps, timeout }));
  }

  async runStep(stepNum, onOutput) {
    return this._run(CliBridge.buildArgs({ runStep: stepNum }), onOutput);
  }

  async finishRun() {
    return this._run(CliBridge.buildArgs({ finishRun: true }));
  }

  kill() {
    if (this.activeProcess) {
      const pid = this.activeProcess.pid;
      debug(`Killing CLI process ${pid}`);
      if (process.platform === 'win32') {
        spawn('taskkill', ['/F', '/T', '/PID', String(pid)]);
      } else {
        this.activeProcess.kill('SIGTERM');
      }
      this.activeProcess = null;
    }
  }

  static buildArgs(opts) {
    const args = [];
    if (opts.list) {
      args.push('--list', '--json');
    }
    if (opts.initRun) {
      args.push('--init-run');
      args.push('--skip-dashboard');
      args.push('--skip-sync');
      if (opts.steps) args.push('--steps', opts.steps.join(','));
      if (opts.timeout) args.push('--timeout', String(opts.timeout));
    }
    if (opts.runStep !== undefined) {
      args.push('--run-step', String(opts.runStep));
    }
    if (opts.finishRun) {
      args.push('--finish-run');
    }
    return args;
  }

  static parseOutput(stdout) {
    const lines = stdout.trim().split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (line.startsWith('{') || line.startsWith('[')) {
        try {
          return JSON.parse(line);
        } catch { /* continue */ }
      }
    }
    return null;
  }

  _run(args, onOutput) {
    return new Promise((resolve, reject) => {
      const binPath = path.resolve(import.meta.dirname, '../../bin/nightytidy.js');
      const proc = spawn('node', [binPath, ...args], {
        cwd: this.projectDir,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.activeProcess = proc;

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        const text = data.toString();
        stdout += text;
        if (onOutput) onOutput(text);
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        this.activeProcess = null;
        const parsed = CliBridge.parseOutput(stdout);
        resolve({
          success: code === 0,
          exitCode: code,
          stdout,
          stderr,
          parsed,
        });
      });

      proc.on('error', (err) => {
        this.activeProcess = null;
        logError(`CLI process error: ${err.message}`);
        resolve({
          success: false,
          exitCode: -1,
          stdout,
          stderr: err.message,
          parsed: null,
        });
      });
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/agent-cli-bridge.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agent/cli-bridge.js test/agent-cli-bridge.test.js
git commit -m "feat(agent): add CLI bridge for NightyTidy subprocess orchestration"
```

---

### Task 6: Webhook Dispatcher

**Files:**
- Create: `src/agent/webhook-dispatcher.js`
- Create: `test/agent-webhook-dispatcher.test.js`

- [ ] **Step 1: Write failing tests**

```javascript
// test/agent-webhook-dispatcher.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebhookDispatcher } from '../src/agent/webhook-dispatcher.js';

vi.mock('../src/logger.js', () => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  initLogger: vi.fn(),
}));

// Mock global fetch
const mockFetch = vi.fn(() => Promise.resolve({ ok: true, status: 200 }));
vi.stubGlobal('fetch', mockFetch);

describe('WebhookDispatcher', () => {
  let dispatcher;

  beforeEach(() => {
    vi.useFakeTimers();
    mockFetch.mockClear();
    dispatcher = new WebhookDispatcher({ machine: 'TestPC', version: '1.0.0' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends webhook to a single endpoint', async () => {
    const endpoints = [{ url: 'https://example.com/hook', label: 'test' }];
    await dispatcher.dispatch('step_completed', {
      project: 'TestApp',
      step: { number: 1, name: 'Docs', status: 'completed' },
    }, endpoints);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('sends to multiple endpoints', async () => {
    const endpoints = [
      { url: 'https://a.com/hook', label: 'a' },
      { url: 'https://b.com/hook', label: 'b' },
    ];
    await dispatcher.dispatch('run_completed', { project: 'TestApp' }, endpoints);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('includes agent metadata in payload', async () => {
    const endpoints = [{ url: 'https://example.com/hook', label: 'test' }];
    await dispatcher.dispatch('run_started', { project: 'X' }, endpoints);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.agent.machine).toBe('TestPC');
    expect(body.event).toBe('run_started');
  });

  it('retries on failure up to 3 times', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    const endpoints = [{ url: 'https://example.com/hook', label: 'test' }];
    const promise = dispatcher.dispatch('run_started', { project: 'X' }, endpoints);
    // Advance through retry delays (1s + 5s)
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(5000);
    await promise;
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('gives up after 3 failed attempts', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    const endpoints = [{ url: 'https://example.com/hook', label: 'test' }];
    const promise = dispatcher.dispatch('run_started', { project: 'X' }, endpoints);
    // Advance through retry delays (1s + 5s)
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(5000);
    await promise;
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('formats Slack-style payload for slack URLs', async () => {
    const endpoints = [{ url: 'https://hooks.slack.com/services/T0/B0/x', label: 'slack' }];
    await dispatcher.dispatch('step_completed', {
      project: 'App',
      step: { number: 5, name: 'Security', status: 'completed', duration: 180000 },
      run: { progress: '5/33', costSoFar: 2.10 },
    }, endpoints);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.blocks).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/agent-webhook-dispatcher.test.js`
Expected: FAIL

- [ ] **Step 3: Implement WebhookDispatcher**

```javascript
// src/agent/webhook-dispatcher.js
import { debug, warn } from '../logger.js';

const RETRY_DELAYS = [1000, 5000, 15000];

export class WebhookDispatcher {
  constructor(agentInfo) {
    this.agentInfo = agentInfo; // { machine, version }
  }

  async dispatch(event, data, endpoints) {
    const promises = endpoints.map(ep => this._sendWithRetry(ep, event, data));
    await Promise.allSettled(promises);
  }

  async _sendWithRetry(endpoint, event, data) {
    const isSlack = endpoint.url.includes('hooks.slack.com');
    const isDiscord = endpoint.url.includes('discord.com/api/webhooks');
    const payload = isSlack
      ? this._formatSlack(event, data)
      : isDiscord
        ? this._formatDiscord(event, data)
        : this._formatGeneric(event, data);

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(endpoint.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(endpoint.headers || {}) },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          debug(`Webhook sent to ${endpoint.label}: ${event}`);
          return;
        }
        warn(`Webhook ${endpoint.label} returned ${res.status}, attempt ${attempt + 1}/3`);
      } catch (err) {
        warn(`Webhook ${endpoint.label} error: ${err.message}, attempt ${attempt + 1}/3`);
      }
      if (attempt < 2) {
        await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
      }
    }
    warn(`Webhook ${endpoint.label} failed after 3 attempts`);
  }

  _formatGeneric(event, data) {
    return {
      event,
      ...data,
      agent: this.agentInfo,
    };
  }

  _formatSlack(event, data) {
    const emoji = event.includes('completed') ? ':white_check_mark:'
      : event.includes('failed') ? ':x:'
      : event.includes('started') ? ':rocket:'
      : ':information_source:';

    const step = data.step;
    const run = data.run;
    let text = `${emoji} *${data.project}*`;
    if (step) {
      text += ` — Step ${step.number} "${step.name}" ${step.status}`;
    } else {
      text += ` — ${event.replace(/_/g, ' ')}`;
    }
    if (run) {
      text += `\nProgress: ${run.progress} · $${run.costSoFar?.toFixed(2) || '0.00'} total`;
    }
    return {
      blocks: [{
        type: 'section',
        text: { type: 'mrkdwn', text },
      }],
    };
  }

  _formatDiscord(event, data) {
    const step = data.step;
    const description = step
      ? `Step ${step.number} "${step.name}" ${step.status}`
      : event.replace(/_/g, ' ');
    return {
      embeds: [{
        title: `${data.project} — ${description}`,
        color: event.includes('completed') ? 0x22c55e
          : event.includes('failed') ? 0xef4444
          : 0x3b82f6,
      }],
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/agent-webhook-dispatcher.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agent/webhook-dispatcher.js test/agent-webhook-dispatcher.test.js
git commit -m "feat(agent): add webhook dispatcher with Slack/Discord formatting and retry"
```

---

### Task 7: Git Integration

**Files:**
- Create: `src/agent/git-integration.js`
- Create: `test/agent-git-integration.test.js`

- [ ] **Step 1: Write failing tests**

```javascript
// test/agent-git-integration.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentGit } from '../src/agent/git-integration.js';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { robustCleanup } from './helpers/cleanup.js';

vi.mock('../src/logger.js', () => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  initLogger: vi.fn(),
}));

describe('AgentGit', () => {
  let tmpDir, git;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-git-'));
    execSync('git init', { cwd: tmpDir });
    execSync('git config user.email "test@test.com"', { cwd: tmpDir });
    execSync('git config user.name "Test"', { cwd: tmpDir });
    fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'hello');
    execSync('git add . && git commit -m "init"', { cwd: tmpDir });
    git = new AgentGit(tmpDir);
  });

  afterEach(async () => {
    await robustCleanup(tmpDir);
  });

  it('gets diff stat', async () => {
    // Create a branch with changes
    execSync('git checkout -b test-branch', { cwd: tmpDir });
    fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'changed');
    execSync('git add . && git commit -m "change"', { cwd: tmpDir });
    const stat = await git.getDiffStat('master', 'test-branch');
    expect(stat).toContain('file.txt');
  });

  it('gets diff for files', async () => {
    execSync('git checkout -b test-branch', { cwd: tmpDir });
    fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'changed');
    execSync('git add . && git commit -m "change"', { cwd: tmpDir });
    const diff = await git.getDiff('master', 'test-branch');
    expect(diff).toContain('changed');
  });

  it('counts files changed', async () => {
    execSync('git checkout -b test-branch', { cwd: tmpDir });
    fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'changed');
    fs.writeFileSync(path.join(tmpDir, 'new.txt'), 'new');
    execSync('git add . && git commit -m "change"', { cwd: tmpDir });
    const count = await git.countFilesChanged('master', 'test-branch');
    expect(count).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/agent-git-integration.test.js`
Expected: FAIL

- [ ] **Step 3: Implement AgentGit**

```javascript
// src/agent/git-integration.js
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { debug, warn } from '../logger.js';

const execFileAsync = promisify(execFile);

export class AgentGit {
  constructor(projectDir) {
    this.projectDir = projectDir;
  }

  async getDiffStat(baseBranch, runBranch) {
    return this._exec('git', ['diff', '--stat', `${baseBranch}...${runBranch}`]);
  }

  async getDiff(baseBranch, runBranch) {
    return this._exec('git', ['diff', `${baseBranch}...${runBranch}`]);
  }

  async countFilesChanged(baseBranch, runBranch) {
    const output = await this._exec('git', ['diff', '--name-only', `${baseBranch}...${runBranch}`]);
    return output.trim().split('\n').filter(Boolean).length;
  }

  async rollback(tag) {
    // Safety: verify tag exists and is a nightytidy tag
    const tagExists = (await this._exec('git', ['tag', '-l', tag])).trim();
    if (!tagExists || !tag.startsWith('nightytidy-before-')) {
      throw new Error(`Invalid rollback tag: ${tag}`);
    }
    debug(`Rolling back to tag: ${tag}`);
    await this._exec('git', ['reset', '--hard', tag]);
  }

  async createPr(branch, title, body) {
    try {
      // Use execFile with args array to prevent command injection
      const result = await this._exec('gh', [
        'pr', 'create', '--head', branch, '--title', title, '--body', body,
      ]);
      const url = result.trim().split('\n').pop();
      return { success: true, url };
    } catch (err) {
      warn(`PR creation failed: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  async merge(runBranch, targetBranch) {
    try {
      await this._exec('git', ['checkout', targetBranch]);
      await this._exec('git', ['merge', runBranch, '--no-edit']);
      return { success: true };
    } catch (err) {
      // Abort failed merge
      try { await this._exec('git', ['merge', '--abort']); } catch { /* ignore */ }
      return { success: false, conflict: true, error: err.message };
    }
  }

  async _exec(cmd, args) {
    const { stdout } = await execFileAsync(cmd, args, { cwd: this.projectDir });
    return stdout;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/agent-git-integration.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agent/git-integration.js test/agent-git-integration.test.js
git commit -m "feat(agent): add git integration for diff, rollback, PR, merge"
```

---

### Task 8: WebSocket Server

**Files:**
- Create: `src/agent/websocket-server.js`
- Create: `test/agent-websocket-server.test.js`
- Modify: `package.json` — add `ws` dependency

- [ ] **Step 1: Install ws**

```bash
npm install ws
```

- [ ] **Step 2: Write failing tests**

```javascript
// test/agent-websocket-server.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentWebSocketServer } from '../src/agent/websocket-server.js';
import WebSocket from 'ws';

vi.mock('../src/logger.js', () => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  initLogger: vi.fn(),
}));

describe('AgentWebSocketServer', () => {
  let server, port, token;

  beforeEach(async () => {
    token = 'test-token-123';
    server = new AgentWebSocketServer({ port: 0, token }); // port 0 = random
    port = await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  it('starts and listens on a port', () => {
    expect(port).toBeGreaterThan(0);
  });

  it('rejects connections without valid token', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise((resolve) => {
      ws.on('close', resolve);
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'auth', token: 'wrong' }));
      });
    });
  });

  it('accepts connections with valid token', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const msg = await new Promise((resolve) => {
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'auth', token }));
      });
      ws.on('message', (data) => {
        resolve(JSON.parse(data.toString()));
      });
    });
    expect(msg.type).toBe('connected');
    ws.close();
  });

  it('broadcasts events to connected clients', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise((resolve) => {
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'auth', token }));
      });
      ws.on('message', resolve); // connected message
    });

    const eventPromise = new Promise((resolve) => {
      ws.on('message', (data) => resolve(JSON.parse(data.toString())));
    });

    server.broadcast({ type: 'run-started', runId: 'test' });
    const event = await eventPromise;
    expect(event.type).toBe('run-started');
    ws.close();
  });

  it('handles ping/pong', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise((resolve) => {
      ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token })));
      ws.on('message', resolve);
    });

    const pongPromise = new Promise((resolve) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'pong') resolve(msg);
      });
    });

    ws.send(JSON.stringify({ type: 'ping' }));
    const pong = await pongPromise;
    expect(pong.type).toBe('pong');
    ws.close();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/agent-websocket-server.test.js`
Expected: FAIL

- [ ] **Step 4: Implement AgentWebSocketServer**

```javascript
// src/agent/websocket-server.js
import { WebSocketServer } from 'ws';
import os from 'node:os';
import { info, debug, warn } from '../logger.js';

const RATE_LIMIT_PER_SEC = 10;

export class AgentWebSocketServer {
  constructor({ port, token, onCommand }) {
    this.port = port;
    this.token = token;
    this.onCommand = onCommand || (() => {});
    this.wss = null;
    this.clients = new Set();
  }

  start() {
    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({
        port: this.port,
        host: '127.0.0.1',
      });

      this.wss.on('listening', () => {
        const addr = this.wss.address();
        this.port = addr.port;
        info(`WebSocket server listening on ws://127.0.0.1:${this.port}`);
        resolve(this.port);
      });

      this.wss.on('error', reject);

      this.wss.on('connection', (ws) => {
        let authenticated = false;
        let messageCount = 0;
        let lastSecond = Date.now();

        ws.on('message', (raw) => {
          // Rate limiting
          const now = Date.now();
          if (now - lastSecond > 1000) {
            messageCount = 0;
            lastSecond = now;
          }
          messageCount++;
          if (messageCount > RATE_LIMIT_PER_SEC) {
            ws.send(JSON.stringify({ type: 'error', message: 'Rate limit exceeded', code: 'rate_limited' }));
            return;
          }

          let msg;
          try {
            msg = JSON.parse(raw.toString());
          } catch {
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
            return;
          }

          // Auth handshake
          if (!authenticated) {
            if (msg.type === 'auth' && msg.token === this.token) {
              authenticated = true;
              this.clients.add(ws);
              ws.send(JSON.stringify({
                type: 'connected',
                machine: process.env.COMPUTERNAME || os.hostname(),
                version: '1.0.0',
              }));
              debug('Client authenticated');
            } else {
              ws.send(JSON.stringify({ type: 'error', message: 'Invalid token', code: 'auth_failed' }));
              ws.close();
            }
            return;
          }

          // Handle commands
          if (msg.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong', id: msg.id }));
            return;
          }

          Promise.resolve(this.onCommand(msg, (response) => {
            ws.send(JSON.stringify({ ...response, id: msg.id }));
          })).catch((err) => {
            ws.send(JSON.stringify({ type: 'error', message: err.message, code: 'internal_error', id: msg.id }));
          });
        });

        ws.on('close', () => {
          this.clients.delete(ws);
          debug('Client disconnected');
        });
      });
    });
  }

  broadcast(event) {
    const data = JSON.stringify(event);
    for (const client of this.clients) {
      if (client.readyState === 1) { // WebSocket.OPEN
        client.send(data);
      }
    }
  }

  stop() {
    return new Promise((resolve) => {
      if (this.wss) {
        for (const client of this.clients) {
          client.close();
        }
        this.wss.close(resolve);
      } else {
        resolve();
      }
    });
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/agent-websocket-server.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/agent/websocket-server.js test/agent-websocket-server.test.js package.json package-lock.json
git commit -m "feat(agent): add WebSocket server with token auth and rate limiting"
```

---

### Task 9: Firebase Auth Module

**Files:**
- Create: `src/agent/firebase-auth.js`
- Create: `test/agent-firebase-auth.test.js`

- [ ] **Step 1: Write failing tests**

```javascript
// test/agent-firebase-auth.test.js
import { describe, it, expect, vi } from 'vitest';
import { FirebaseAuth } from '../src/agent/firebase-auth.js';

vi.mock('../src/logger.js', () => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  initLogger: vi.fn(),
}));

describe('FirebaseAuth', () => {
  it('checks if credentials are cached', () => {
    const auth = new FirebaseAuth('/tmp/fake-config');
    expect(auth.isAuthenticated()).toBe(false);
  });

  it('stores and retrieves token', () => {
    const auth = new FirebaseAuth('/tmp/fake-config');
    auth.setToken('fake-firebase-token', Date.now() + 3600000);
    expect(auth.isAuthenticated()).toBe(true);
    expect(auth.getToken()).toBe('fake-firebase-token');
  });

  it('detects expired token', () => {
    const auth = new FirebaseAuth('/tmp/fake-config');
    auth.setToken('expired-token', Date.now() - 1000);
    expect(auth.isAuthenticated()).toBe(false);
  });

  it('returns auth header for webhook calls', () => {
    const auth = new FirebaseAuth('/tmp/fake-config');
    auth.setToken('my-token', Date.now() + 3600000);
    expect(auth.getAuthHeader()).toEqual({ Authorization: 'Bearer my-token' });
  });

  it('returns empty header when not authenticated', () => {
    const auth = new FirebaseAuth('/tmp/fake-config');
    expect(auth.getAuthHeader()).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/agent-firebase-auth.test.js`
Expected: FAIL

- [ ] **Step 3: Implement FirebaseAuth**

```javascript
// src/agent/firebase-auth.js
import { debug, info } from '../logger.js';

export class FirebaseAuth {
  constructor(configDir) {
    this.configDir = configDir;
    this.token = null;
    this.expiresAt = null;
  }

  isAuthenticated() {
    return this.token !== null && this.expiresAt > Date.now();
  }

  getToken() {
    if (!this.isAuthenticated()) return null;
    return this.token;
  }

  setToken(token, expiresAt) {
    this.token = token;
    this.expiresAt = expiresAt;
    debug('Firebase auth token updated');
  }

  getAuthHeader() {
    const token = this.getToken();
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
  }

  // Full OAuth flow will be implemented in integration phase
  // For now, this is a placeholder that stores/retrieves tokens
  async authenticate() {
    info('Firebase authentication required — browser OAuth flow needed');
    // TODO: Open browser to nightytidy.com/auth/agent, receive token via callback
    return false;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/agent-firebase-auth.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agent/firebase-auth.js test/agent-firebase-auth.test.js
git commit -m "feat(agent): add Firebase auth module with token caching"
```

---

### Task 10: Agent Entry Point + CLI Integration

**Files:**
- Create: `src/agent/index.js`
- Create: `test/agent-index.test.js`
- Modify: `src/cli.js` — add `agent` subcommand

- [ ] **Step 1: Write failing tests for agent index**

```javascript
// test/agent-index.test.js
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/logger.js', () => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  initLogger: vi.fn(),
}));

vi.mock('../src/agent/websocket-server.js', () => ({
  AgentWebSocketServer: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(48372),
    stop: vi.fn().mockResolvedValue(),
    broadcast: vi.fn(),
  })),
}));

vi.mock('../src/agent/config.js', () => ({
  getConfigDir: vi.fn(() => '/tmp/test-config'),
  readConfig: vi.fn(() => ({ version: 1, port: 48372, token: 'test', machine: 'test' })),
  writeConfig: vi.fn(),
  ensureConfigDir: vi.fn(),
  CONFIG_VERSION: 1,
}));

vi.mock('../src/agent/project-manager.js', () => ({
  ProjectManager: vi.fn().mockImplementation(() => ({
    listProjects: vi.fn(() => []),
    pruneStaleProjects: vi.fn(),
  })),
}));

vi.mock('../src/agent/run-queue.js', () => ({
  RunQueue: vi.fn().mockImplementation(() => ({
    getQueue: vi.fn(() => []),
    getCurrent: vi.fn(() => null),
  })),
}));

vi.mock('../src/agent/scheduler.js', () => ({
  Scheduler: vi.fn().mockImplementation(() => ({
    stopAll: vi.fn(),
    addSchedule: vi.fn(),
    getSchedules: vi.fn(() => []),
  })),
}));

describe('agent index', () => {
  it('exports startAgent function', async () => {
    const { startAgent } = await import('../src/agent/index.js');
    expect(typeof startAgent).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/agent-index.test.js`
Expected: FAIL

- [ ] **Step 3: Implement agent entry point**

```javascript
// src/agent/index.js
import { info, warn, debug } from '../logger.js';
import { getConfigDir, readConfig, writeConfig, ensureConfigDir } from './config.js';
import { ProjectManager } from './project-manager.js';
import { RunQueue } from './run-queue.js';
import { Scheduler } from './scheduler.js';
import { AgentWebSocketServer } from './websocket-server.js';
import { WebhookDispatcher } from './webhook-dispatcher.js';
import { CliBridge } from './cli-bridge.js';
import { AgentGit } from './git-integration.js';
import { FirebaseAuth } from './firebase-auth.js';

export async function startAgent() {
  const configDir = getConfigDir();
  ensureConfigDir(configDir);
  const config = readConfig(configDir);

  info(`NightyTidy Agent starting on ${config.machine}`);

  // Initialize components
  const projectManager = new ProjectManager(configDir);
  projectManager.pruneStaleProjects();

  const runQueue = new RunQueue(configDir);
  const firebaseAuth = new FirebaseAuth(configDir);
  const webhookDispatcher = new WebhookDispatcher({
    machine: config.machine,
    version: '1.0.0',
  });

  // Command handler (async — some commands need await)
  const handleCommand = async (msg, reply) => {
    switch (msg.type) {
      case 'list-projects':
        reply({ type: 'projects', projects: projectManager.listProjects() });
        break;

      case 'add-project':
        try {
          const name = msg.path.split(/[\\/]/).pop();
          const project = projectManager.addProject(msg.path, name);
          reply({ type: 'projects', projects: projectManager.listProjects() });
        } catch (err) {
          reply({ type: 'error', message: err.message, code: 'add_failed' });
        }
        break;

      case 'remove-project':
        projectManager.removeProject(msg.projectId);
        reply({ type: 'projects', projects: projectManager.listProjects() });
        break;

      case 'get-queue':
        reply({
          type: 'queue-updated',
          queue: runQueue.getQueue(),
          current: runQueue.getCurrent(),
        });
        break;

      case 'start-run':
        handleStartRun(msg, reply);
        break;

      case 'stop-run':
        handleStopRun(msg, reply);
        break;

      case 'select-folder': {
        // Browser sends the selected path (picked via <input type="file" webkitdirectory>
        // or the agent could open a native dialog — platform-specific, same approach as gui/server.js)
        reply({ type: 'folder-selected', path: msg.path || null });
        break;
      }

      case 'pause-run': {
        // Pause is agent-level: set a flag that processQueue checks between steps
        pauseRequested = true;
        wsServer.broadcast({ type: 'run-paused', runId: msg.runId });
        reply({ type: 'run-paused', runId: msg.runId });
        break;
      }

      case 'resume-run': {
        pauseRequested = false;
        wsServer.broadcast({ type: 'run-resumed', runId: msg.runId });
        reply({ type: 'run-resumed', runId: msg.runId });
        break;
      }

      case 'skip-step': {
        // Skip is agent-level: set flag checked in step loop
        skipCurrentStep = true;
        reply({ type: 'step-skipped', runId: msg.runId, step: msg.step });
        break;
      }

      case 'get-diff': {
        const proj = projectManager.getProject(msg.projectId);
        if (!proj) { reply({ type: 'error', message: 'Project not found', code: 'project_not_found' }); break; }
        const gitObj = new AgentGit(proj.path);
        const diff = await gitObj.getDiff(msg.baseBranch, msg.runBranch);
        const stat = await gitObj.getDiffStat(msg.baseBranch, msg.runBranch);
        reply({ type: 'diff', diff, stat });
        break;
      }

      case 'merge': {
        const proj = projectManager.getProject(msg.projectId);
        if (!proj) { reply({ type: 'error', message: 'Project not found', code: 'project_not_found' }); break; }
        const gitObj = new AgentGit(proj.path);
        const result = await gitObj.merge(msg.runBranch, msg.targetBranch);
        reply({ type: 'merge-result', ...result });
        break;
      }

      case 'rollback': {
        const proj = projectManager.getProject(msg.projectId);
        if (!proj) { reply({ type: 'error', message: 'Project not found', code: 'project_not_found' }); break; }
        const gitObj = new AgentGit(proj.path);
        try {
          // rollback() has built-in safety checks (tag existence + nightytidy-before- prefix)
          await gitObj.rollback(msg.tag);
          reply({ type: 'rollback-result', success: true });
        } catch (err) {
          reply({ type: 'error', message: err.message, code: 'rollback_failed' });
        }
        break;
      }

      case 'create-pr': {
        const proj = projectManager.getProject(msg.projectId);
        if (!proj) { reply({ type: 'error', message: 'Project not found', code: 'project_not_found' }); break; }
        const gitObj = new AgentGit(proj.path);
        const result = await gitObj.createPr(msg.branch, msg.title, msg.body);
        reply({ type: 'pr-result', ...result });
        break;
      }

      case 'retry-step': {
        // Retry a failed step as a fresh mini-run
        const proj = projectManager.getProject(msg.projectId);
        if (!proj) { reply({ type: 'error', message: 'Project not found', code: 'project_not_found' }); break; }
        // Enqueue a single-step run
        const retryRun = runQueue.enqueue({
          projectId: msg.projectId,
          steps: [msg.step],
          timeout: msg.timeout || 45,
        });
        wsServer.broadcast({ type: 'queue-updated', queue: runQueue.getQueue() });
        reply({ type: 'retry-queued', runId: retryRun.id });
        if (!runQueue.getCurrent()) processQueue();
        break;
      }

      case 'reorder-queue': {
        // msg.order is array of runId strings (excluding running item)
        runQueue.reorder(msg.order);
        wsServer.broadcast({ type: 'queue-updated', queue: runQueue.getQueue() });
        reply({ type: 'queue-updated', queue: runQueue.getQueue() });
        break;
      }

      case 'cancel-queued': {
        runQueue.cancel(msg.runId);
        wsServer.broadcast({ type: 'queue-updated', queue: runQueue.getQueue() });
        reply({ type: 'queue-updated', queue: runQueue.getQueue() });
        break;
      }

      case 'get-schedules': {
        reply({ type: 'schedules', schedules: scheduler.getSchedules() });
        break;
      }

      case 'set-schedule': {
        if (!Scheduler.isValidCron(msg.cron)) {
          reply({ type: 'error', message: 'Invalid cron expression', code: 'invalid_cron' });
          break;
        }
        scheduler.addSchedule(msg.projectId, msg.cron);
        projectManager.updateProject(msg.projectId, {
          schedule: { cron: msg.cron, enabled: true, steps: msg.steps || [] },
        });
        reply({ type: 'schedule-updated', projectId: msg.projectId });
        break;
      }

      case 'remove-schedule': {
        scheduler.removeSchedule(msg.projectId);
        projectManager.updateProject(msg.projectId, {
          schedule: { cron: null, enabled: false, steps: [] },
        });
        reply({ type: 'schedule-removed', projectId: msg.projectId });
        break;
      }

      default:
        reply({ type: 'error', message: `Unknown command: ${msg.type}`, code: 'unknown_command' });
    }
  };

  // Start WebSocket server
  const wsServer = new AgentWebSocketServer({
    port: config.port,
    token: config.token,
    onCommand: handleCommand,
  });

  const actualPort = await wsServer.start();

  // Update config with actual port
  config.port = actualPort;
  writeConfig(configDir, config);

  // Initialize scheduler
  const scheduler = new Scheduler((projectId) => {
    const project = projectManager.getProject(projectId);
    if (project) {
      runQueue.enqueue({
        projectId,
        steps: project.schedule?.steps || [],
        timeout: 45,
      });
      wsServer.broadcast({ type: 'queue-updated', queue: runQueue.getQueue() });
      webhookDispatcher.dispatch('schedule_triggered', {
        project: project.name,
        projectId,
      }, project.webhooks || []);
    }
  });

  // Load schedules from projects
  for (const project of projectManager.listProjects()) {
    if (project.schedule?.enabled && project.schedule?.cron) {
      scheduler.addSchedule(project.id, project.schedule.cron);
    }
  }

  // Track the active CLI bridge so stop-run can kill it
  let activeBridge = null;
  let pauseRequested = false;
  let skipCurrentStep = false;

  // Run execution handler
  async function handleStartRun(msg, reply) {
    const project = projectManager.getProject(msg.projectId);
    if (!project) {
      reply({ type: 'error', message: 'Project not found', code: 'project_not_found' });
      return;
    }

    const run = runQueue.enqueue({
      projectId: msg.projectId,
      steps: msg.steps,
      timeout: msg.timeout || 45,
    });

    wsServer.broadcast({ type: 'queue-updated', queue: runQueue.getQueue() });
    reply({ type: 'run-started', runId: run.id, projectId: msg.projectId });

    // Process queue if nothing is running
    if (!runQueue.getCurrent()) {
      processQueue();
    }
  }

  async function processQueue() {
    const run = runQueue.dequeue();
    if (!run) return;

    const project = projectManager.getProject(run.projectId);
    if (!project) {
      runQueue.completeCurrent({ success: false });
      processQueue();
      return;
    }

    const bridge = new CliBridge(project.path);
    activeBridge = bridge;

    // Init run
    wsServer.broadcast({ type: 'run-started', runId: run.id, projectId: run.projectId, branch: '' });
    const initResult = await bridge.initRun(run.steps, run.timeout);
    if (!initResult.success) {
      wsServer.broadcast({ type: 'run-failed', runId: run.id, error: initResult.stderr });
      runQueue.completeCurrent({ success: false });
      processQueue();
      return;
    }

    // Run each step — use index-based loop so rate-limit retry works safely
    const stepsToRun = [...run.steps];
    const totalSteps = stepsToRun.length;
    let stepIndex = 0;
    while (stepIndex < stepsToRun.length) {
      // Check for pause between steps
      while (pauseRequested) {
        await new Promise(r => setTimeout(r, 1000));
      }
      // Check for skip
      if (skipCurrentStep) {
        skipCurrentStep = false;
        wsServer.broadcast({ type: 'step-skipped', runId: run.id, step: { number: stepsToRun[stepIndex] } });
        stepIndex++;
        continue;
      }

      const stepNum = stepsToRun[stepIndex];
      wsServer.broadcast({ type: 'step-started', runId: run.id, step: { number: stepNum } });

      const stepResult = await bridge.runStep(stepNum, (text) => {
        wsServer.broadcast({ type: 'step-output', runId: run.id, text, mode: 'raw' });
      });

      const stepParsed = stepResult.parsed || {};
      if (stepParsed.success) {
        // Count files changed via git
        const git = new AgentGit(project.path);
        let filesChanged = 0;
        try {
          const branch = initResult.parsed?.runInfo?.branch;
          const tag = initResult.parsed?.runInfo?.tag;
          if (branch && tag) {
            filesChanged = await git.countFilesChanged(tag, branch);
          }
        } catch { /* ignore */ }

        wsServer.broadcast({
          type: 'step-completed',
          runId: run.id,
          step: { number: stepNum, ...stepParsed.step, filesChanged },
          cost: stepParsed.step?.cost,
        });

        // Build webhook endpoints — always include cloud endpoint if authenticated
        const endpoints = [...(project.webhooks || [])];
        if (firebaseAuth.isAuthenticated()) {
          endpoints.push({
            url: 'https://us-central1-nightytidy.cloudfunctions.net/webhookIngest',
            label: 'nightytidy.com',
            headers: firebaseAuth.getAuthHeader(),
          });
        }
        webhookDispatcher.dispatch('step_completed', {
          project: project.name,
          projectId: project.id,
          step: { number: stepNum, ...stepParsed.step, filesChanged },
          run: { progress: `${stepIndex + 1}/${totalSteps}` },
        }, endpoints);
        stepIndex++;
      } else {
        const errorType = stepParsed.errorType;
        if (errorType === 'rate_limit') {
          wsServer.broadcast({
            type: 'rate-limit',
            runId: run.id,
            retryAfterMs: stepParsed.retryAfterMs || 120000,
            step: { number: stepNum },
          });
          // Wait for rate limit — do NOT advance stepIndex, retry same step
          await new Promise(r => setTimeout(r, stepParsed.retryAfterMs || 120000));
          wsServer.broadcast({ type: 'rate-limit-resumed', runId: run.id });
          continue; // retry same stepIndex
        }
        wsServer.broadcast({
          type: 'step-failed',
          runId: run.id,
          step: { number: stepNum },
          error: stepParsed.error || stepResult.stderr,
        });

        const endpoints = [...(project.webhooks || [])];
        if (firebaseAuth.isAuthenticated()) {
          endpoints.push({
            url: 'https://us-central1-nightytidy.cloudfunctions.net/webhookIngest',
            label: 'nightytidy.com',
            headers: firebaseAuth.getAuthHeader(),
          });
        }
        webhookDispatcher.dispatch('step_failed', {
          project: project.name,
          step: { number: stepNum, status: 'failed' },
        }, endpoints);
        stepIndex++;
      }
    }

    // Finish run
    await bridge.finishRun();
    projectManager.updateProject(run.projectId, { lastRunAt: Date.now() });

    wsServer.broadcast({ type: 'run-completed', runId: run.id, results: {} });

    // Build webhook endpoints — always include cloud endpoint if authenticated
    const completionEndpoints = [...(project.webhooks || [])];
    if (firebaseAuth.isAuthenticated()) {
      completionEndpoints.push({
        url: 'https://us-central1-nightytidy.cloudfunctions.net/webhookIngest',
        label: 'nightytidy.com',
        headers: firebaseAuth.getAuthHeader(),
      });
    }
    webhookDispatcher.dispatch('run_completed', {
      project: project.name,
      projectId: project.id,
    }, completionEndpoints);

    activeBridge = null;
    runQueue.completeCurrent({ success: true });
    processQueue(); // Next in queue
  }

  function handleStopRun(msg, reply) {
    const current = runQueue.getCurrent();
    if (current && current.id === msg.runId) {
      // Kill the running CLI process
      if (activeBridge) {
        activeBridge.kill();
        activeBridge = null;
      }
      runQueue.completeCurrent({ success: false });
      wsServer.broadcast({ type: 'run-failed', runId: msg.runId, error: 'Stopped by user' });
      reply({ type: 'run-failed', runId: msg.runId, error: 'Stopped by user' });
      processQueue(); // Start next in queue if any
    } else {
      // Cancel queued
      runQueue.cancel(msg.runId);
      reply({ type: 'queue-updated', queue: runQueue.getQueue() });
    }
  }

  // Graceful shutdown
  const shutdown = async () => {
    info('Agent shutting down...');
    scheduler.stopAll();
    await wsServer.stop();
    info('Agent stopped');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Print startup info
  console.log(`\nNightyTidy Agent v1.0.0`);
  console.log(`WebSocket: ws://127.0.0.1:${actualPort}`);
  console.log(`Token: ${config.token.slice(0, 6)}...(see ~/.nightytidy/config.json)`);
  console.log(`\nOpen nightytidy.com to connect.\n`);

  return { wsServer, scheduler, projectManager, runQueue };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/agent-index.test.js`
Expected: PASS

- [ ] **Step 5: Add `agent` subcommand to CLI**

In `src/cli.js`, add a Commander subcommand (after the program option definitions, before `.parse()`):

```javascript
program
  .command('agent')
  .description('Start the NightyTidy agent for web app connectivity')
  .action(async () => {
    const { initLogger } = await import('./logger.js');
    initLogger(process.cwd());
    const { startAgent } = await import('./agent/index.js');
    await startAgent();
  });
```

This uses Commander's subcommand pattern (`npx nightytidy agent`) instead of a flat `--agent` flag, matching the spec and avoiding conflicts with existing option routing.

- [ ] **Step 6: Run test to verify CLI still works**

Run: `npx vitest run test/agent-index.test.js test/smoke.test.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/agent/index.js test/agent-index.test.js src/cli.js
git commit -m "feat(agent): add agent entry point and agent subcommand"
```

---

### Task 11: Run All Agent Tests

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass (existing + 9 new agent test files)

- [ ] **Step 2: Fix any failures**

Address any test failures or import issues.

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "fix: resolve any agent test integration issues"
```

---

## End of Chunk 1

Chunk 1 produces a working local agent that can:
- Manage projects (add, remove, list)
- Queue runs (enqueue, dequeue, reorder, cancel)
- Schedule cron-triggered runs
- Execute NightyTidy via CLI subprocess
- Send webhooks (generic, Slack, Discord)
- Generate git diffs, create PRs, rollback
- Communicate via WebSocket (token auth, rate limiting, ping/pong)
- Persist all state across restarts

**Test coverage:** 9 test files covering all agent modules.

**Next:** Chunk 2 covers the Next.js web app + Firebase setup.

---

## Chunk 2: Web App + Firebase

This chunk covers the `nightytidy-web` repository — Next.js frontend, Firebase setup, and Cloud Functions.

### Task 12: Repository + Firebase Initialization

**Files:**
- Create: `nightytidy-web/` repo with Next.js + Firebase scaffolding

- [ ] **Step 1: Create the nightytidy-web repo**

```bash
mkdir nightytidy-web && cd nightytidy-web
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --no-import-alias
```

- [ ] **Step 2: Install Firebase dependencies**

```bash
npm install firebase firebase-admin
npm install -D firebase-tools
```

- [ ] **Step 3: Install additional dependencies**

```bash
npm install recharts ws
```

- [ ] **Step 4: Initialize Firebase**

```bash
npx firebase init
# Select: Hosting, Functions, Firestore
# Project: create new or select existing
# Hosting: use `out` directory (Next.js static export) or configure for SSR
# Functions: TypeScript
```

- [ ] **Step 5: Create firebase.json config**

```json
{
  "hosting": {
    "public": "out",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [{ "source": "**", "destination": "/index.html" }]
  },
  "functions": {
    "source": "functions",
    "runtime": "nodejs20"
  },
  "firestore": {
    "rules": "firestore.rules"
  }
}
```

- [ ] **Step 6: Create Firestore security rules**

Write the rules from the spec to `firestore.rules`.

- [ ] **Step 7: Commit**

```bash
git init
git add -A
git commit -m "feat: initialize Next.js + Firebase project"
```

---

### Task 13: Firebase Auth + lib modules

**Files:**
- Create: `src/lib/firebase.ts`
- Create: `src/lib/auth.ts`
- Create: `src/lib/types.ts`
- Create: `src/lib/firestore.ts`
- Create: `src/lib/websocket.ts`

- [ ] **Step 1: Create Firebase client config**

```typescript
// src/lib/firebase.ts
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, GithubAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
export const auth = getAuth(app);
export const db = getFirestore(app);
export const githubProvider = new GithubAuthProvider();
```

- [ ] **Step 2: Create TypeScript types**

```typescript
// src/lib/types.ts
// LocalProject is used by the agent — includes path (never sent to Firestore)
export interface LocalProject {
  id: string;
  name: string;
  path: string; // local only — NEVER stored in Firestore
  addedAt: number;
  lastRunAt: number | null;
  schedule: Schedule | null;
  webhooks: Webhook[];
}

// CloudProject is the Firestore representation — no path field
export interface CloudProject {
  id: string;
  name: string;
  addedAt: number;
  lastRunAt: number | null;
  schedule: Schedule | null;
}

// Alias for agent-side code
export type Project = LocalProject;

export interface Schedule {
  cron: string | null;
  presetId: string | null;
  enabled: boolean;
}

export interface Webhook {
  id: string;
  url: string;
  label: string;
  icon: string;
  active: boolean;
}

export interface Preset {
  id: string;
  name: string;
  steps: number[];
  icon: string;
}

export interface Run {
  id: string;
  projectId: string;
  projectName: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: number;
  finishedAt: number | null;
  selectedSteps: number[];
  completedSteps: number;
  failedSteps: number;
  totalCost: number;
  duration: number;
  filesChanged: number;
  gitBranch: string;
  gitTag: string;
}

export interface StepResult {
  number: number;
  name: string;
  status: 'completed' | 'failed' | 'skipped';
  duration: number;
  cost: number;
  attempts: number;
  filesChanged: number;
  summary: string | null;
  error: string | null;
}

export interface UserSettings {
  defaultTimeout: number;
  defaultPreset: string | null;
  googleDocUrl: string | null;
  logLevel: string;
  theme: 'dark' | 'light' | 'system';
  notifyOn: string[];
}

// WebSocket message types
export interface WsCommand {
  type: string;
  id?: string;
  [key: string]: unknown;
}

export interface WsEvent {
  type: string;
  id?: string;
  [key: string]: unknown;
}
```

- [ ] **Step 3: Create auth helpers**

```typescript
// src/lib/auth.ts
import { signInWithPopup, signOut as firebaseSignOut } from 'firebase/auth';
import { auth, githubProvider } from './firebase';

export async function signInWithGithub() {
  const result = await signInWithPopup(auth, githubProvider);
  return result.user;
}

export async function signOut() {
  await firebaseSignOut(auth);
}

export function getCurrentUser() {
  return auth.currentUser;
}
```

- [ ] **Step 4: Create Firestore helpers**

```typescript
// src/lib/firestore.ts
import { doc, getDoc, setDoc, updateDoc, collection, getDocs, query, orderBy, limit, where, deleteDoc } from 'firebase/firestore';
import { db } from './firebase';
import type { Run, UserSettings, Preset, Webhook } from './types';

export async function getUserSettings(uid: string): Promise<UserSettings | null> {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? (snap.data().settings as UserSettings) : null;
}

export async function saveUserSettings(uid: string, settings: UserSettings) {
  await setDoc(doc(db, 'users', uid), { settings, updatedAt: Date.now() }, { merge: true });
}

export async function ensureUserDoc(uid: string, displayName: string | null) {
  const ref = doc(db, 'users', uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, { displayName, createdAt: Date.now(), settings: null });
  }
}

export async function getRuns(uid: string, projectId?: string, maxResults = 20): Promise<Run[]> {
  const runsRef = collection(db, 'users', uid, 'runs');
  const constraints = [orderBy('startedAt', 'desc'), limit(maxResults)];
  if (projectId) constraints.unshift(where('projectId', '==', projectId));
  const snap = await getDocs(query(runsRef, ...constraints));
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as Run));
}

export async function getRun(uid: string, runId: string): Promise<Run | null> {
  const snap = await getDoc(doc(db, 'users', uid, 'runs', runId));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as Run) : null;
}

export async function getStepResults(uid: string, runId: string): Promise<import('./types').StepResult[]> {
  const snap = await getDocs(collection(db, 'users', uid, 'runs', runId, 'steps'));
  return snap.docs.map(d => ({ number: parseInt(d.id), ...d.data() } as import('./types').StepResult));
}

export async function getPresets(uid: string, projectId: string): Promise<Preset[]> {
  const snap = await getDocs(collection(db, 'users', uid, 'projects', projectId, 'presets'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as Preset));
}

export async function savePreset(uid: string, projectId: string, preset: Omit<Preset, 'id'>) {
  const ref = doc(collection(db, 'users', uid, 'projects', projectId, 'presets'));
  await setDoc(ref, preset);
  return ref.id;
}

export async function getWebhooks(uid: string): Promise<Webhook[]> {
  const snap = await getDocs(collection(db, 'users', uid, 'webhooks'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as Webhook));
}
```

- [ ] **Step 5: Create WebSocket client**

```typescript
// src/lib/websocket.ts
import type { WsCommand, WsEvent } from './types';

type EventHandler = (event: WsEvent) => void;

export class AgentConnection {
  private ws: WebSocket | null = null;
  private handlers: Map<string, EventHandler[]> = new Map();
  private messageId = 0;
  private pendingReplies: Map<string, (event: WsEvent) => void> = new Map();

  connect(port: number, token: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.ws = new WebSocket(`ws://127.0.0.1:${port}`);

      this.ws.onopen = () => {
        this.ws!.send(JSON.stringify({ type: 'auth', token }));
      };

      this.ws.onmessage = (event) => {
        const msg: WsEvent = JSON.parse(event.data);

        if (msg.type === 'connected') {
          resolve(true);
        }

        // Handle pending replies
        if (msg.id && this.pendingReplies.has(msg.id)) {
          this.pendingReplies.get(msg.id)!(msg);
          this.pendingReplies.delete(msg.id);
        }

        // Notify handlers
        const handlers = this.handlers.get(msg.type) || [];
        handlers.forEach(h => h(msg));
        const allHandlers = this.handlers.get('*') || [];
        allHandlers.forEach(h => h(msg));
      };

      this.ws.onclose = () => {
        this.emit('disconnected');
        resolve(false);
      };

      this.ws.onerror = () => resolve(false);
    });
  }

  send(command: WsCommand): Promise<WsEvent> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Not connected'));
        return;
      }
      const id = String(++this.messageId);
      this.pendingReplies.set(id, resolve);
      this.ws.send(JSON.stringify({ ...command, id }));

      // Timeout after 30s
      setTimeout(() => {
        if (this.pendingReplies.has(id)) {
          this.pendingReplies.delete(id);
          reject(new Error('Timeout'));
        }
      }, 30000);
    });
  }

  on(event: string, handler: EventHandler) {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event)!.push(handler);
  }

  off(event: string, handler: EventHandler) {
    const handlers = this.handlers.get(event);
    if (handlers) {
      this.handlers.set(event, handlers.filter(h => h !== handler));
    }
  }

  disconnect() {
    this.ws?.close();
    this.ws = null;
  }

  get isConnected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private emit(type: string, data?: Record<string, unknown>) {
    const handlers = this.handlers.get(type) || [];
    handlers.forEach(h => h({ type, ...data }));
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/
git commit -m "feat: add Firebase, auth, Firestore, WebSocket, and types libs"
```

---

### Task 14: React Hooks

**Files:**
- Create: `src/hooks/useAgent.ts`
- Create: `src/hooks/useProjects.ts`
- Create: `src/hooks/useRuns.ts`
- Create: `src/hooks/useSettings.ts`

- [ ] **Step 1: Create useAgent hook**

```typescript
// src/hooks/useAgent.ts
'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { AgentConnection } from '@/lib/websocket';
import type { WsEvent, Project } from '@/lib/types';

const DEFAULT_PORT = 48372;

export function useAgent() {
  const [connected, setConnected] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const connectionRef = useRef<AgentConnection | null>(null);

  const connect = useCallback(async (token: string, port = DEFAULT_PORT) => {
    const conn = new AgentConnection();
    connectionRef.current = conn;

    conn.on('projects', (e) => setProjects((e as any).projects));
    conn.on('queue-updated', (e) => {
      // dispatch to queue state
    });

    const success = await conn.connect(port, token);
    setConnected(success);
    if (success) {
      conn.send({ type: 'list-projects' });
    }
    return success;
  }, []);

  const disconnect = useCallback(() => {
    connectionRef.current?.disconnect();
    setConnected(false);
  }, []);

  const send = useCallback(async (command: any) => {
    if (!connectionRef.current) throw new Error('Not connected');
    return connectionRef.current.send(command);
  }, []);

  const on = useCallback((event: string, handler: (e: WsEvent) => void) => {
    const conn = connectionRef.current;
    if (conn) conn.on(event, handler);
    // Return cleanup function so callers can unsubscribe
    return () => { if (conn) conn.off(event, handler); };
  }, []);

  useEffect(() => {
    return () => { connectionRef.current?.disconnect(); };
  }, []);

  return { connected, projects, connect, disconnect, send, on };
}
```

- [ ] **Step 2: Create useSettings hook**

```typescript
// src/hooks/useSettings.ts
'use client';
import { useState, useEffect, useCallback } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { getUserSettings, saveUserSettings } from '@/lib/firestore';
import type { UserSettings } from '@/lib/types';

const DEFAULT_SETTINGS: UserSettings = {
  defaultTimeout: 45,
  defaultPreset: null,
  googleDocUrl: null,
  logLevel: 'info',
  theme: 'dark',
  notifyOn: ['run_started', 'run_completed', 'step_failed', 'rate_limit', 'schedule_triggered'],
};

export function useSettings() {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const s = await getUserSettings(user.uid);
        setSettings(s || DEFAULT_SETTINGS);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const updateSettings = useCallback(async (updates: Partial<UserSettings>) => {
    const user = auth.currentUser;
    if (!user) return;
    const newSettings = { ...settings, ...updates };
    setSettings(newSettings);
    await saveUserSettings(user.uid, newSettings);
  }, [settings]);

  return { settings, loading, updateSettings };
}
```

- [ ] **Step 3: Create useRuns and useProjects hooks**

Similar pattern to useSettings — read from Firestore, provide CRUD functions.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/
git commit -m "feat: add React hooks for agent, settings, runs, projects"
```

---

### Task 15: Layout (Sidebar, TopBar, AgentIndicator)

**Files:**
- Create: `src/components/layout/Sidebar.tsx`
- Create: `src/components/layout/TopBar.tsx`
- Create: `src/components/layout/AgentIndicator.tsx`
- Create: `src/app/layout.tsx` (modify default)

**Reference:** All mockups share the same sidebar and top bar pattern.

- [ ] **Step 1: Create Sidebar component**

```tsx
// src/components/layout/Sidebar.tsx
'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/', label: 'Dashboard', icon: '🏠' },
  { href: '/projects', label: 'Projects', icon: '📁' },
  { href: '/queue', label: 'Queue', icon: '📋' },
  { href: '/schedules', label: 'Schedules', icon: '⏰' },
  { href: '/analytics', label: 'Analytics', icon: '📊' },
  { href: '/settings', label: 'Settings', icon: '⚙️' },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="w-[200px] border-r border-white/10 p-4 flex flex-col">
      <div className="font-bold text-lg mb-6">🧹 NightyTidy</div>
      <nav className="flex flex-col gap-1">
        {NAV_ITEMS.map(item => (
          <Link key={item.href} href={item.href}
            className={`px-3 py-2 rounded-md text-sm ${
              pathname === item.href
                ? 'bg-blue-500/15 text-blue-300'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}>
            {item.icon} {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
```

- [ ] **Step 2: Create AgentIndicator component**

```tsx
// src/components/layout/AgentIndicator.tsx
'use client';

export function AgentIndicator({ connected }: { connected: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
      <span className="text-slate-400 text-sm">
        {connected ? 'Agent connected' : 'Agent offline'}
      </span>
    </div>
  );
}
```

- [ ] **Step 3: Update root layout with sidebar and top bar**
- [ ] **Step 4: Commit**

```bash
git add src/components/layout/ src/app/layout.tsx
git commit -m "feat: add shared layout with sidebar and agent indicator"
```

---

### Task 16: Screen 1 — Landing/Login + First-Time Setup

**Files:**
- Create: `src/app/login/page.tsx`
- Create: `src/components/auth/LoginCard.tsx`
- Create: `src/components/auth/SetupWizard.tsx`

**Reference:** `.superpowers/brainstorm/2281-1773499944/screen-1-landing.html`

- [ ] **Step 1: Create LoginCard with GitHub OAuth button**

Uses `signInWithGithub()` from `src/lib/auth.ts`. After sign-in, calls `ensureUserDoc()` to create user document with `createdAt`.

- [ ] **Step 2: Create SetupWizard component**

Three steps: (1) Agent discovery — attempts `fetch('http://127.0.0.1:48372/auth-info')`, shows green check or red X with install instructions. (2) Claude Code check — displays status. (3) First project — folder picker via agent WebSocket `select-folder` command.

- [ ] **Step 3: Add route protection — redirect unauthenticated users to /login**
- [ ] **Step 4: Commit**

```bash
git add src/app/login/ src/components/auth/
git commit -m "feat: add login page and first-time setup wizard"
```

---

### Task 17: Screen 2 — Dashboard

**Files:**
- Create: `src/app/page.tsx` (dashboard is the root page)
- Create: `src/components/dashboard/ProjectCard.tsx`
- Create: `src/components/dashboard/QueuePanel.tsx`
- Create: `src/components/dashboard/ActivityFeed.tsx`

**Reference:** `.superpowers/brainstorm/2281-1773499944/screen-2-dashboard.html`

- [ ] **Step 1: Create ProjectCard** — shows project name, last run date, status badge, step count, quick-launch button.
- [ ] **Step 2: Create QueuePanel** — lists queued runs with drag-to-reorder (uses `reorder-queue` WS command). Shows currently running item with progress bar.
- [ ] **Step 3: Create ActivityFeed** — recent events from Firestore `runs` subcollection, auto-updates via `onSnapshot`.
- [ ] **Step 4: Wire up dashboard page** — grid layout with project cards, queue panel sidebar, activity feed below.
- [ ] **Step 5: Commit**

```bash
git add src/app/page.tsx src/components/dashboard/
git commit -m "feat: add dashboard with project cards, queue, and activity feed"
```

---

### Task 18: Screen 3 — Project Detail

**Files:**
- Create: `src/app/projects/[id]/page.tsx`
- Create: `src/components/project/RunHistory.tsx`
- Create: `src/components/project/PresetManager.tsx`
- Create: `src/components/project/ScheduleConfig.tsx`

**Reference:** `.superpowers/brainstorm/2281-1773499944/screen-3-project-detail.html`

- [ ] **Step 1: Create RunHistory** — table of past runs with columns: date, steps, pass/fail, cost, duration, files changed. Links to run results page.
- [ ] **Step 2: Create PresetManager** — CRUD for step presets (saved to Firestore). Shows preset name, step count, icons.
- [ ] **Step 3: Create ScheduleConfig** — cron expression builder (presets for daily/weekly/biweekly + custom). Uses `set-schedule`/`remove-schedule` WS commands.
- [ ] **Step 4: Wire up project detail page** — stats header, tabs (Runs / Presets / Schedule).
- [ ] **Step 5: Commit**

```bash
git add src/app/projects/ src/components/project/
git commit -m "feat: add project detail with run history, presets, and scheduling"
```

---

### Task 19: Screen 4 — Run Setup

**Files:**
- Create: `src/app/projects/[id]/run/page.tsx`
- Create: `src/components/run/StepSelector.tsx`
- Create: `src/components/run/StepCategory.tsx`

**Reference:** `.superpowers/brainstorm/2281-1773499944/screen-4-run-setup.html`

- [ ] **Step 1: Create StepSelector** — checkbox grid of 33 steps grouped by category (Testing, Code Quality, Ops, Frontend, Infrastructure, Strategic). Each step shows name, description on hover, and recommended badge. Category headers with select-all toggles.
- [ ] **Step 2: Add preset quick-select** — dropdown to load saved presets. "Save as preset" button.
- [ ] **Step 3: Add cost estimate** — based on historical data from Firestore runs. Shows estimated time and cost range.
- [ ] **Step 4: "Start Run" button** — sends `start-run` WS command with selected steps and timeout. Navigates to live run view.
- [ ] **Step 5: Commit**

```bash
git add src/app/projects/*/run/ src/components/run/
git commit -m "feat: add run setup with categorized step selection and cost estimates"
```

---

### Task 20: Screen 5 — Live Run View + Rate Limit Overlay

**Files:**
- Create: `src/app/runs/[id]/page.tsx`
- Create: `src/components/run/LiveProgress.tsx`
- Create: `src/components/run/OutputPanel.tsx`
- Create: `src/components/run/RateLimitOverlay.tsx`

**Reference:** `.superpowers/brainstorm/2281-1773499944/screen-5-live-run.html`

- [ ] **Step 1: Create LiveProgress** — step progress bar (completed/running/remaining). Current step name with spinner. Elapsed time, cost counter.
- [ ] **Step 2: Create OutputPanel** — toggle between "Summarized" (parsed step results) and "Raw" (streaming stdout). Auto-scrolls. Uses `step-output` WS events.
- [ ] **Step 3: Create RateLimitOverlay** — modal overlay triggered by `rate-limit` WS event. Shows countdown timer (`formatCountdown`), "Resume Now" button (sends `resume-run`), "Finish with Partial Results" button (sends `stop-run`), "Save & Close" option.
- [ ] **Step 4: Add action buttons** — "Pause" (sends `pause-run`), "Skip Step" (sends `skip-step` with confirmation), "Stop Run" (sends `stop-run` with confirmation).
- [ ] **Step 5: Commit**

```bash
git add src/app/runs/ src/components/run/
git commit -m "feat: add live run view with output streaming and rate limit overlay"
```

---

### Task 21: Screen 6 — Run Results + Diff Viewer

**Files:**
- Create: `src/app/runs/[id]/results/page.tsx`
- Create: `src/components/results/StepResultsTable.tsx`
- Create: `src/components/results/DiffViewer.tsx`
- Create: `src/components/results/ActionButtons.tsx`

**Reference:** `.superpowers/brainstorm/2281-1773499944/screen-6-results.html`

- [ ] **Step 1: Create StepResultsTable** — rows for each step: status icon, name, duration, cost, files changed, summary. Expandable rows for full output.
- [ ] **Step 2: Create DiffViewer** — fetches diff via `get-diff` WS command. Syntax-highlighted unified diff view. File tree sidebar.
- [ ] **Step 3: Create ActionButtons** — "Merge to main" (sends `merge` with confirmation dialog), "Create PR" (sends `create-pr`), "Rollback" (sends `rollback` with confirmation), "Retry Failed Steps" (sends `retry-step` for each failed step).
- [ ] **Step 4: Add summary stats** — total cost, duration, pass rate, files changed.
- [ ] **Step 5: Commit**

```bash
git add src/app/runs/*/results/ src/components/results/
git commit -m "feat: add run results with diff viewer and action buttons"
```

---

### Task 22: Screen 7 — Settings

**Files:**
- Create: `src/app/settings/page.tsx`
- Create: `src/components/settings/AccountTab.tsx`
- Create: `src/components/settings/AgentTab.tsx`
- Create: `src/components/settings/DefaultsTab.tsx`
- Create: `src/components/settings/NotificationsTab.tsx`
- Create: `src/components/settings/AppearanceTab.tsx`

**Reference:** `.superpowers/brainstorm/2281-1773499944/screen-7-settings.html`

- [ ] **Step 1: Create AccountTab** — GitHub profile card, sign-out button.
- [ ] **Step 2: Create AgentTab** — connection status, machine name, version, uptime, reconnect instructions.
- [ ] **Step 3: Create DefaultsTab** — timeout input, default preset select, Google Doc sync URL, log level select.
- [ ] **Step 4: Create NotificationsTab** — webhook endpoint CRUD list (add/edit/remove). Checkboxes for notification events. Uses `useSettings` hook for persistence.
- [ ] **Step 5: Create AppearanceTab** — dark/light/system theme selector. Saves to user settings.
- [ ] **Step 6: Wire up with tab navigation** — uses URL params or state for active tab.
- [ ] **Step 7: Commit**

```bash
git add src/app/settings/ src/components/settings/
git commit -m "feat: add settings page with account, agent, defaults, notifications, appearance tabs"
```

---

### Task 23: Analytics Dashboard

**Files:**
- Create: `src/app/analytics/page.tsx`
- Create: `src/components/analytics/CostChart.tsx`
- Create: `src/components/analytics/PassRateChart.tsx`
- Create: `src/components/analytics/StepPerformance.tsx`

- [ ] **Step 1: Create CostChart** — Recharts `BarChart` showing cost per run over time.
- [ ] **Step 2: Create PassRateChart** — Recharts `LineChart` showing pass rate trend.
- [ ] **Step 3: Create StepPerformance** — Recharts `RadarChart` or bar chart showing which steps produce the most improvements (by filesChanged).
- [ ] **Step 4: Add value score display** — computed as `(passRate * avgFilesChanged) / avgCost`. Shows per-step recommendations ("most bang for your buck").
- [ ] **Step 5: Commit**

```bash
git add src/app/analytics/ src/components/analytics/
git commit -m "feat: add analytics dashboard with Recharts visualizations"
```

**Note for implementer:** Reference the mockup HTML files in `.superpowers/brainstorm/2281-1773499944/` for exact layout, colors, and component structure. The mockups use inline styles that should be translated to Tailwind classes.

---

### Task 24: Cloud Functions

**Files:**
- Create: `functions/src/index.ts`
- Create: `functions/src/webhookIngest.ts`
- Create: `functions/src/status.ts`
- Create: `functions/src/runs.ts`

- [ ] **Step 1: Implement webhook ingest function**

```typescript
// functions/src/webhookIngest.ts
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

const RATE_LIMIT_PER_MIN = 60;

export const webhookIngest = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }

  // Verify Firebase auth token
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).send('Unauthorized');
    return;
  }

  let uid: string;
  try {
    const token = authHeader.split('Bearer ')[1];
    const decoded = await admin.auth().verifyIdToken(token);
    uid = decoded.uid;
  } catch {
    res.status(401).send('Invalid token');
    return;
  }

  // Rate limiting — uses Firestore counters (survives cold starts)
  const db = admin.firestore();
  const rateLimitRef = db.doc(`rateLimits/${uid}`);
  const now = Date.now();
  const windowStart = now - 60000;
  try {
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(rateLimitRef);
      const data = snap.data();
      if (data && data.windowStart > windowStart && data.count >= RATE_LIMIT_PER_MIN) {
        return false; // rate limited
      }
      if (!data || data.windowStart <= windowStart) {
        tx.set(rateLimitRef, { count: 1, windowStart: now });
      } else {
        tx.update(rateLimitRef, { count: admin.firestore.FieldValue.increment(1) });
      }
      return true;
    });
    if (!result) {
      res.status(429).send('Too many requests');
      return;
    }
  } catch {
    // If rate limit check fails, allow the request (fail open)
  }

  const body = req.body;

  // Update run document (db already declared above for rate limiting)
  if (body.run?.id) {
    const runRef = db.doc(`users/${uid}/runs/${body.run.id}`);
    await runRef.set({
      projectId: body.projectId,
      projectName: body.project,
      status: body.event === 'run_completed' ? 'completed'
        : body.event === 'run_failed' ? 'failed'
        : 'running',
      ...(body.run.costSoFar !== undefined && { totalCost: body.run.costSoFar }),
      ...(body.run.elapsedMs !== undefined && { duration: body.run.elapsedMs }),
    }, { merge: true });

    // Update step if present
    if (body.step) {
      await db.doc(`users/${uid}/runs/${body.run.id}/steps/${body.step.number}`).set(body.step);
    }
  }

  res.status(200).json({ ok: true });
});
```

- [ ] **Step 2: Implement status and runs endpoints**

Similar pattern — verify auth, query Firestore, return JSON.

- [ ] **Step 3: Export all functions**

```typescript
// functions/src/index.ts
import * as admin from 'firebase-admin';
admin.initializeApp();

export { webhookIngest } from './webhookIngest';
export { status } from './status';
export { runs } from './runs';
```

- [ ] **Step 4: Write Cloud Functions tests**

```typescript
// functions/src/__tests__/webhookIngest.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock firebase-admin
const mockVerifyIdToken = vi.fn();
const mockSet = vi.fn().mockResolvedValue(undefined);
const mockDoc = vi.fn(() => ({ set: mockSet }));
const mockRunTransaction = vi.fn().mockImplementation(async (fn) => {
  const tx = {
    get: vi.fn().mockResolvedValue({ data: () => null }),
    set: vi.fn(),
    update: vi.fn(),
  };
  return fn(tx);
});

vi.mock('firebase-admin', () => ({
  auth: () => ({ verifyIdToken: mockVerifyIdToken }),
  firestore: Object.assign(
    () => ({ doc: mockDoc, runTransaction: mockRunTransaction }),
    { FieldValue: { increment: (n: number) => n } }
  ),
  initializeApp: vi.fn(),
}));

// Import after mocks
import { webhookIngest } from '../webhookIngest';

function mockRequest(overrides = {}) {
  return {
    method: 'POST',
    headers: { authorization: 'Bearer valid-token' },
    body: { event: 'step_completed', project: 'TestApp', projectId: 'p1', run: { id: 'r1' }, step: { number: 1, name: 'Docs', status: 'completed' } },
    ...overrides,
  } as any;
}

function mockResponse() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.send = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe('webhookIngest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyIdToken.mockResolvedValue({ uid: 'user-123' });
  });

  it('rejects non-POST requests', async () => {
    const res = mockResponse();
    await webhookIngest(mockRequest({ method: 'GET' }), res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  it('rejects missing auth header', async () => {
    const res = mockResponse();
    await webhookIngest(mockRequest({ headers: {} }), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects invalid token', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('invalid'));
    const res = mockResponse();
    await webhookIngest(mockRequest(), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('accepts valid webhook and updates Firestore', async () => {
    const res = mockResponse();
    await webhookIngest(mockRequest(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockDoc).toHaveBeenCalledWith('users/user-123/runs/r1');
    expect(mockSet).toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: Run Cloud Functions tests**

Run: `cd functions && npx vitest run`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add functions/
git commit -m "feat: add Cloud Functions for webhook ingest, status, runs API with tests"
```

---

## End of Chunk 2

Chunk 2 produces a working Next.js web app with:
- GitHub OAuth login
- 7 screens matching the spec mockups
- Firestore data persistence (runs, settings, webhooks, presets)
- WebSocket client for connecting to the local agent
- Cloud Functions for webhook ingestion and remote status API
- Analytics dashboard with Recharts

---

## Chunk 3: Integration + Deployment

### Task 25: Agent ↔ Web App Integration

- [ ] **Step 1: Implement agent auth token discovery**

The browser at nightytidy.com needs to discover the local agent. Implement the localhost HTTP endpoint on the agent that serves the token:

In `src/agent/websocket-server.js`, add an HTTP server on the same port that responds to `GET /auth-info`:

```javascript
// Returns { port, token } for the browser to use
// Only responds to requests from 127.0.0.1
```

- [ ] **Step 2: Add token discovery to the web app**

In `src/hooks/useAgent.ts`, add auto-discovery: on page load, try fetching `http://127.0.0.1:48372/auth-info`, then use the returned token to open the WebSocket.

- [ ] **Step 3: Implement Firebase auth flow for agent**

When the agent runs for the first time, it opens the browser to `nightytidy.com/auth/agent?callback=http://127.0.0.1:PORT/auth-callback`. The web app authenticates with GitHub, gets a Firebase token, and POSTs it back to the agent's callback URL.

- [ ] **Step 4: Test end-to-end flow**

1. Start agent: `npx nightytidy agent`
2. Open nightytidy.com in browser
3. Sign in with GitHub
4. Verify agent connects (green dot)
5. Add a project, select steps, start a run
6. Verify live output streams
7. Verify webhooks fire to nightytidy.com dashboard
8. Check run results from a different device

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: integrate agent auth discovery and Firebase token exchange"
```

---

### Task 26: Deployment

- [ ] **Step 1: Configure Firebase project**

```bash
firebase login
firebase use --add  # select or create project
```

- [ ] **Step 2: Set up GitHub OAuth in Firebase Console**

- Go to Firebase Console → Authentication → Sign-in method
- Enable GitHub provider
- Add GitHub OAuth app credentials (Client ID + Secret)
- Add authorized domain: nightytidy.com

- [ ] **Step 3: Configure custom domain**

- Firebase Console → Hosting → Add custom domain → nightytidy.com
- Update DNS records as instructed

- [ ] **Step 4: Deploy**

```bash
npm run build
firebase deploy
```

- [ ] **Step 5: Verify production**

- Visit nightytidy.com
- Sign in with GitHub
- Verify all screens load
- Test agent connection from local machine

- [ ] **Step 6: Commit and tag**

```bash
git tag v1.0.0
git push origin main --tags
```

---

### Task 27: README + Documentation

- [ ] **Step 1: Write README.md for nightytidy-web repo**

Cover: what it is, how to set up locally, how to deploy, architecture overview.

- [ ] **Step 2: Update NightyTidy main repo README**

Add section about the web app and `agent` subcommand.

- [ ] **Step 3: Commit**

```bash
git commit -m "docs: add README and update main repo docs for web app"
```

---

## End of Chunk 3

The full system is now deployed:
- **nightytidy.com** — live web app with all 7 screens
- **npx nightytidy agent** — local agent connecting to the web app
- **Firebase** — hosting, auth, Firestore, Cloud Functions
- **Remote monitoring** — webhook-driven dashboard accessible from any device
