import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'http';
import { mkdtemp, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { robustCleanup } from './helpers/cleanup.js';

vi.mock('../src/logger.js', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  initLogger: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({ unref: vi.fn() })),
}));

function makeInitialState(overrides = {}) {
  return {
    status: 'starting',
    totalSteps: 3,
    currentStepIndex: -1,
    currentStepName: '',
    steps: [
      { number: 1, name: 'Lint', status: 'pending', duration: null },
      { number: 2, name: 'Tests', status: 'pending', duration: null },
      { number: 3, name: 'Docs', status: 'pending', duration: null },
    ],
    completedCount: 0,
    failedCount: 0,
    startTime: null,
    error: null,
    ...overrides,
  };
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    }).on('error', reject);
  });
}

function httpPost(url) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'POST' }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.end();
  });
}

function connectSSE(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      const events = [];
      let buffer = '';

      res.on('data', chunk => {
        buffer += chunk;
        const parts = buffer.split('\n\n');
        buffer = parts.pop(); // keep incomplete part
        for (const part of parts) {
          if (!part.trim()) continue;
          const lines = part.split('\n');
          const event = {};
          for (const line of lines) {
            if (line.startsWith('event: ')) event.event = line.slice(7);
            if (line.startsWith('data: ')) event.data = line.slice(6);
          }
          events.push(event);
        }
      });

      // Give the initial event a moment to arrive
      setTimeout(() => resolve({ res, events }), 50);
    }).on('error', reject);
  });
}

describe('startDashboard', () => {
  let tempDir;
  let mod;

  beforeEach(async () => {
    vi.resetModules();
    tempDir = await mkdtemp(path.join(tmpdir(), 'nightytidy-dash-'));
    mod = await import('../src/dashboard.js');
  });

  afterEach(async () => {
    try { mod.stopDashboard(); } catch { /* ignore */ }
    await robustCleanup(tempDir);
  });

  it('starts an HTTP server and returns url and port', async () => {
    const result = await mod.startDashboard(makeInitialState(), {
      onStop: vi.fn(),
      projectDir: tempDir,
    });

    expect(result).not.toBeNull();
    expect(result.port).toBeGreaterThan(0);
    expect(result.url).toBe(`http://localhost:${result.port}`);
  });

  it('creates nightytidy-dashboard.url file', async () => {
    const result = await mod.startDashboard(makeInitialState(), {
      onStop: vi.fn(),
      projectDir: tempDir,
    });

    const urlFile = path.join(tempDir, 'nightytidy-dashboard.url');
    expect(existsSync(urlFile)).toBe(true);

    const content = await readFile(urlFile, 'utf8');
    expect(content.trim()).toBe(result.url);
  });

  it('creates nightytidy-progress.json file with initial state', async () => {
    const state = makeInitialState();
    await mod.startDashboard(state, {
      onStop: vi.fn(),
      projectDir: tempDir,
    });

    const progressFile = path.join(tempDir, 'nightytidy-progress.json');
    expect(existsSync(progressFile)).toBe(true);

    const content = JSON.parse(await readFile(progressFile, 'utf8'));
    expect(content.status).toBe('starting');
    expect(content.totalSteps).toBe(3);
  });

  it('serves HTML on GET /', async () => {
    const result = await mod.startDashboard(makeInitialState(), {
      onStop: vi.fn(),
      projectDir: tempDir,
    });

    const res = await httpGet(result.url);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('NightyTidy');
    expect(res.body).toContain('Live Dashboard');
  });

  it('returns 404 for unknown routes', async () => {
    const result = await mod.startDashboard(makeInitialState(), {
      onStop: vi.fn(),
      projectDir: tempDir,
    });

    const res = await httpGet(`${result.url}/unknown`);
    expect(res.status).toBe(404);
  });
});

describe('SSE events', () => {
  let tempDir;
  let mod;

  beforeEach(async () => {
    vi.resetModules();
    tempDir = await mkdtemp(path.join(tmpdir(), 'nightytidy-dash-'));
    mod = await import('../src/dashboard.js');
  });

  afterEach(async () => {
    try { mod.stopDashboard(); } catch { /* ignore */ }
    await robustCleanup(tempDir);
  });

  it('GET /events returns content-type text/event-stream', async () => {
    const result = await mod.startDashboard(makeInitialState(), {
      onStop: vi.fn(),
      projectDir: tempDir,
    });

    const { res } = await connectSSE(`${result.url}/events`);
    expect(res.headers['content-type']).toContain('text/event-stream');
    res.destroy();
  });

  it('sends current state as initial event on SSE connect', async () => {
    const state = makeInitialState();
    const result = await mod.startDashboard(state, {
      onStop: vi.fn(),
      projectDir: tempDir,
    });

    const { res, events } = await connectSSE(`${result.url}/events`);
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].event).toBe('state');

    const parsed = JSON.parse(events[0].data);
    expect(parsed.status).toBe('starting');
    expect(parsed.totalSteps).toBe(3);
    res.destroy();
  });

  it('sends updated state when updateDashboard is called', async () => {
    const state = makeInitialState();
    const result = await mod.startDashboard(state, {
      onStop: vi.fn(),
      projectDir: tempDir,
    });

    const { res, events } = await connectSSE(`${result.url}/events`);

    // Wait for initial event
    await new Promise(r => setTimeout(r, 30));

    // Push an update
    state.status = 'running';
    state.currentStepIndex = 0;
    state.currentStepName = 'Lint';
    mod.updateDashboard(state);

    // Wait for SSE delivery
    await new Promise(r => setTimeout(r, 50));

    const runningEvents = events.filter(e => {
      if (e.event !== 'state') return false;
      const d = JSON.parse(e.data);
      return d.status === 'running';
    });
    expect(runningEvents.length).toBeGreaterThanOrEqual(1);
    res.destroy();
  });
});

describe('stop endpoint', () => {
  let tempDir;
  let mod;

  beforeEach(async () => {
    vi.resetModules();
    tempDir = await mkdtemp(path.join(tmpdir(), 'nightytidy-dash-'));
    mod = await import('../src/dashboard.js');
  });

  afterEach(async () => {
    try { mod.stopDashboard(); } catch { /* ignore */ }
    await robustCleanup(tempDir);
  });

  it('POST /stop calls the onStop callback', async () => {
    const onStop = vi.fn();
    const result = await mod.startDashboard(makeInitialState(), {
      onStop,
      projectDir: tempDir,
    });

    const res = await httpPost(`${result.url}/stop`);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    expect(onStop).toHaveBeenCalledOnce();
  });
});

describe('stopDashboard', () => {
  let tempDir;
  let mod;

  beforeEach(async () => {
    vi.resetModules();
    tempDir = await mkdtemp(path.join(tmpdir(), 'nightytidy-dash-'));
    mod = await import('../src/dashboard.js');
  });

  afterEach(async () => {
    await robustCleanup(tempDir);
  });

  it('closes the server and removes URL file and progress file', async () => {
    await mod.startDashboard(makeInitialState(), {
      onStop: vi.fn(),
      projectDir: tempDir,
    });

    const urlFile = path.join(tempDir, 'nightytidy-dashboard.url');
    const progressFile = path.join(tempDir, 'nightytidy-progress.json');
    expect(existsSync(urlFile)).toBe(true);
    expect(existsSync(progressFile)).toBe(true);

    mod.stopDashboard();

    expect(existsSync(urlFile)).toBe(false);
    expect(existsSync(progressFile)).toBe(false);
  });

  it('does not throw if called when dashboard was never started', () => {
    expect(() => mod.stopDashboard()).not.toThrow();
  });

  it('does not throw if called multiple times', async () => {
    await mod.startDashboard(makeInitialState(), {
      onStop: vi.fn(),
      projectDir: tempDir,
    });

    expect(() => mod.stopDashboard()).not.toThrow();
    expect(() => mod.stopDashboard()).not.toThrow();
  });
});

describe('updateDashboard', () => {
  let tempDir;
  let mod;

  beforeEach(async () => {
    vi.resetModules();
    tempDir = await mkdtemp(path.join(tmpdir(), 'nightytidy-dash-'));
    mod = await import('../src/dashboard.js');
  });

  afterEach(async () => {
    try { mod.stopDashboard(); } catch { /* ignore */ }
    await robustCleanup(tempDir);
  });

  it('is a no-op when dashboard was never started', () => {
    expect(() => mod.updateDashboard({ status: 'running' })).not.toThrow();
  });

  it('writes updated state to progress file', async () => {
    const state = makeInitialState();
    await mod.startDashboard(state, {
      onStop: vi.fn(),
      projectDir: tempDir,
    });

    state.status = 'running';
    state.currentStepIndex = 0;
    mod.updateDashboard(state);

    const progressFile = path.join(tempDir, 'nightytidy-progress.json');
    const content = JSON.parse(await readFile(progressFile, 'utf8'));
    expect(content.status).toBe('running');
    expect(content.currentStepIndex).toBe(0);
  });
});
