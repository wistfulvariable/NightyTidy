import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp } from 'fs/promises';
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

describe('scheduleShutdown', () => {
  let tempDir;
  let mod;

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    tempDir = await mkdtemp(path.join(tmpdir(), 'nightytidy-dash-'));
    mod = await import('../src/dashboard.js');
  });

  afterEach(async () => {
    vi.useRealTimers();
    try { mod.stopDashboard(); } catch { /* ignore */ }
    await robustCleanup(tempDir);
  });

  it('is a no-op when no server is running', () => {
    // scheduleShutdown with no server should not throw
    expect(() => mod.scheduleShutdown()).not.toThrow();
  });

  it('schedules delayed shutdown when server is running', async () => {
    vi.useRealTimers(); // need real timers for http listen
    await mod.startDashboard(makeInitialState(), {
      onStop: vi.fn(),
      projectDir: tempDir,
    });

    vi.useFakeTimers();
    mod.scheduleShutdown();

    // Server should still be alive before delay
    const urlFile = path.join(tempDir, 'nightytidy-dashboard.url');
    // File exists because server started
    expect(existsSync(urlFile)).toBe(true);

    // Advance past the 3s delay
    vi.advanceTimersByTime(3500);

    // After the delay, stopDashboard should have been called
    // which removes ephemeral files
    expect(existsSync(urlFile)).toBe(false);
  });

  it('stopDashboard cancels a pending scheduled shutdown', async () => {
    vi.useRealTimers();
    await mod.startDashboard(makeInitialState(), {
      onStop: vi.fn(),
      projectDir: tempDir,
    });

    vi.useFakeTimers();
    mod.scheduleShutdown();

    // Stop immediately — should cancel the timer
    mod.stopDashboard();

    // Advance timer — the scheduled callback should NOT fire again
    // (it would throw or error since server is already stopped)
    expect(() => vi.advanceTimersByTime(5000)).not.toThrow();
  });
});
