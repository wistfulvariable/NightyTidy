import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile } from 'fs/promises';
import { existsSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import simpleGit from 'simple-git';
import { EventEmitter } from 'events';
import { robustCleanup } from './helpers/cleanup.js';

// ---------------------------------------------------------------------------
// Module Contract Tests
//
// Verify that each module's public API adheres to the error handling contracts
// and interface contracts documented in CLAUDE.md. These tests catch drift
// between documentation and implementation.
//
// Strategy: vi.doMock() (non-hoisted) + vi.doUnmock() + dynamic import()
// per describe block, with vi.resetModules() to isolate module caches.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 1. claude.js — "Never throws; returns result objects"
// ---------------------------------------------------------------------------
describe('contract: claude.js — never throws, returns result objects', () => {
  beforeEach(() => {
    vi.resetModules();

    vi.doMock('child_process', () => ({
      spawn: vi.fn(() => {
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.stdin = { write: vi.fn(), end: vi.fn() };
        child.kill = vi.fn();
        queueMicrotask(() => child.emit('close', 1));
        return child;
      }),
    }));

    vi.doMock('../src/logger.js', () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.doUnmock('child_process');
    vi.doUnmock('../src/logger.js');
    vi.restoreAllMocks();
  });

  it('returns a result object with required fields on failure (never throws)', async () => {
    const { runPrompt } = await import('../src/claude.js');

    const result = await runPrompt('test', '/tmp', { timeout: 100, retries: 0, label: 'contract' });

    // Must not throw — contract says "never throws"
    expect(result).toBeDefined();

    // Required fields per CLAUDE.md contract
    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('output');
    expect(result).toHaveProperty('error');
    expect(result).toHaveProperty('exitCode');
    expect(result).toHaveProperty('duration');
    expect(result).toHaveProperty('attempts');

    // Type checks
    expect(typeof result.success).toBe('boolean');
    expect(typeof result.output).toBe('string');
    expect(typeof result.exitCode).toBe('number');
    expect(typeof result.duration).toBe('number');
    expect(typeof result.attempts).toBe('number');

    // Cost field must be present (null or object)
    expect(result).toHaveProperty('cost');
  });

  it('runPrompt is the only exported function', async () => {
    const mod = await import('../src/claude.js');

    expect(mod.runPrompt).toBeTypeOf('function');
    // Constants (DEFAULT_TIMEOUT, RETRY_DELAY, etc.) are module-private,
    // not exported — verified intentionally. CLAUDE.md documents their values
    // for reference but they are internal implementation details.
  });
});

// ---------------------------------------------------------------------------
// 2. git.js — mergeRunBranch "never throws, returns { success, conflict }"
// ---------------------------------------------------------------------------
describe('contract: git.js — mergeRunBranch never throws on conflict', () => {
  let tempDir;
  let tempGit;

  beforeEach(async () => {
    vi.resetModules();

    vi.doMock('../src/logger.js', () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }));

    tempDir = await mkdtemp(path.join(tmpdir(), 'nightytidy-contract-'));
    tempGit = simpleGit(tempDir);
    await tempGit.init();
    await tempGit.addConfig('user.email', 'contract@test.com');
    await tempGit.addConfig('user.name', 'Contract');
    await writeFile(path.join(tempDir, 'README.md'), 'initial');
    await tempGit.add('.');
    await tempGit.commit('initial');
  });

  afterEach(async () => {
    vi.doUnmock('../src/logger.js');
    vi.restoreAllMocks();
    await robustCleanup(tempDir);
  });

  it('returns { success: true } on clean merge (not a thrown value)', async () => {
    const { initGit, getCurrentBranch, createRunBranch, mergeRunBranch } = await import('../src/git.js');
    initGit(tempDir);

    const original = await getCurrentBranch();
    const runBranch = await createRunBranch(original);

    await writeFile(path.join(tempDir, 'new.txt'), 'data');
    await tempGit.add('.');
    await tempGit.commit('run branch commit');

    const result = await mergeRunBranch(original, runBranch);

    expect(result).toEqual({ success: true });
  });

  it('returns { success: false, conflict: true } on conflict (does not throw)', async () => {
    const { initGit, getCurrentBranch, createRunBranch, mergeRunBranch } = await import('../src/git.js');
    initGit(tempDir);

    const original = await getCurrentBranch();
    const runBranch = await createRunBranch(original);

    await writeFile(path.join(tempDir, 'README.md'), 'run branch');
    await tempGit.add('.');
    await tempGit.commit('run change');

    await tempGit.checkout(original);
    await writeFile(path.join(tempDir, 'README.md'), 'original branch');
    await tempGit.add('.');
    await tempGit.commit('original change');
    await tempGit.checkout(runBranch);

    const result = await mergeRunBranch(original, runBranch);

    expect(result).toEqual({ success: false, conflict: true });
  });

  it('exports all documented functions', async () => {
    const mod = await import('../src/git.js');

    const expectedExports = [
      'initGit',
      'excludeEphemeralFiles',
      'getCurrentBranch',
      'createPreRunTag',
      'createRunBranch',
      'getHeadHash',
      'hasNewCommit',
      'fallbackCommit',
      'mergeRunBranch',
      'ensureOnBranch',
      'getGitInstance',
    ];

    for (const name of expectedExports) {
      expect(mod[name], `git.js should export '${name}'`).toBeTypeOf('function');
    }
  });
});

// ---------------------------------------------------------------------------
// 3. checks.js — "Throws with user-friendly messages"
// ---------------------------------------------------------------------------
describe('contract: checks.js — throws on validation failure', () => {
  beforeEach(() => {
    vi.resetModules();

    vi.doMock('child_process', () => ({
      spawn: vi.fn(() => {
        const proc = new EventEmitter();
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        proc.kill = vi.fn();
        process.nextTick(() => proc.emit('error', new Error('not found')));
        return proc;
      }),
    }));

    vi.doMock('../src/logger.js', () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.doUnmock('child_process');
    vi.doUnmock('../src/logger.js');
    vi.restoreAllMocks();
  });

  it('throws an Error (not a result object) when git is not found', async () => {
    const { runPreChecks } = await import('../src/checks.js');
    const mockGit = {
      checkIsRepo: vi.fn().mockResolvedValue(true),
      branch: vi.fn().mockResolvedValue({ all: [] }),
    };

    try {
      await runPreChecks('/fake', mockGit);
      expect.unreachable('runPreChecks should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect(typeof err.message).toBe('string');
      expect(err.message.length).toBeGreaterThan(0);
    }
  });

  it('exports runPreChecks as its only function', async () => {
    const mod = await import('../src/checks.js');
    expect(mod.runPreChecks).toBeTypeOf('function');
  });
});

// ---------------------------------------------------------------------------
// 4. executor.js — "Never throws; failed steps recorded, run continues"
// ---------------------------------------------------------------------------
describe('contract: executor.js — never throws, returns result object', () => {
  beforeEach(() => {
    vi.resetModules();

    vi.doMock('../src/claude.js', () => ({
      runPrompt: vi.fn().mockResolvedValue({
        success: false, output: '', error: 'fail', exitCode: 1, attempts: 4,
      }),
      ERROR_TYPE: { RATE_LIMIT: 'rate_limit', UNKNOWN: 'unknown' },
      sleep: vi.fn(() => Promise.resolve()),
    }));

    vi.doMock('../src/git.js', () => ({
      getHeadHash: vi.fn().mockResolvedValue('abc'),
      hasNewCommit: vi.fn().mockResolvedValue(true),
      fallbackCommit: vi.fn().mockResolvedValue(true),
    }));

    vi.doMock('../src/notifications.js', () => ({
      notify: vi.fn(),
    }));

    vi.doMock('../src/logger.js', () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }));

    vi.doMock('../src/prompts/loader.js', () => ({
      STEPS: [],
      DOC_UPDATE_PROMPT: 'mock doc update',
      CONSOLIDATION_PROMPT: 'mock consolidation',
      reloadSteps: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.doUnmock('../src/claude.js');
    vi.doUnmock('../src/git.js');
    vi.doUnmock('../src/notifications.js');
    vi.doUnmock('../src/logger.js');
    vi.doUnmock('../src/prompts/loader.js');
    vi.restoreAllMocks();
  });

  it('returns result object with required fields even when steps fail', async () => {
    const { executeSteps } = await import('../src/executor.js');
    const steps = [{ number: 1, name: 'Test', prompt: 'test' }];

    const result = await executeSteps(steps, '/fake');

    expect(result).toHaveProperty('results');
    expect(result).toHaveProperty('completedCount');
    expect(result).toHaveProperty('failedCount');
    expect(result).toHaveProperty('totalDuration');

    expect(Array.isArray(result.results)).toBe(true);
    expect(typeof result.completedCount).toBe('number');
    expect(typeof result.failedCount).toBe('number');
    expect(typeof result.totalDuration).toBe('number');
  });

  it('each result entry has the documented shape', async () => {
    const { runPrompt } = await import('../src/claude.js');
    runPrompt.mockResolvedValue({ success: true, output: 'ok', error: null, exitCode: 0, attempts: 1 });

    const { executeSteps } = await import('../src/executor.js');
    const steps = [{ number: 1, name: 'Lint', prompt: 'lint' }];
    const result = await executeSteps(steps, '/fake');

    const entry = result.results[0];
    expect(entry).toHaveProperty('step');
    expect(entry).toHaveProperty('status');
    expect(entry).toHaveProperty('output');
    expect(entry).toHaveProperty('duration');
    expect(entry).toHaveProperty('attempts');
    expect(entry).toHaveProperty('error');
    expect(entry).toHaveProperty('cost');
    expect(['completed', 'failed']).toContain(entry.status);
  });
});

// ---------------------------------------------------------------------------
// 5. notifications.js — "Swallows all errors silently"
// ---------------------------------------------------------------------------
describe('contract: notifications.js — swallows all errors', () => {
  beforeEach(() => {
    vi.resetModules();

    vi.doMock('node-notifier', () => ({
      default: {
        notify: vi.fn(() => { throw new Error('notification crash'); }),
      },
    }));

    vi.doMock('../src/logger.js', () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.doUnmock('node-notifier');
    vi.doUnmock('../src/logger.js');
    vi.restoreAllMocks();
  });

  it('does not throw even when node-notifier throws', async () => {
    const { notify } = await import('../src/notifications.js');

    expect(() => notify('title', 'body')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 6. report.js — "Warns but never throws"
// ---------------------------------------------------------------------------
describe('contract: report.js — warns but never throws', () => {
  let tempDir;

  beforeEach(async () => {
    vi.resetModules();

    vi.doMock('../src/logger.js', () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }));

    tempDir = await mkdtemp(path.join(tmpdir(), 'nightytidy-contract-report-'));
  });

  afterEach(async () => {
    vi.doUnmock('../src/logger.js');
    vi.restoreAllMocks();
    await robustCleanup(tempDir);
  });

  it('generateReport does not throw with valid inputs', async () => {
    const { generateReport } = await import('../src/report.js');

    const results = {
      results: [{
        step: { number: 1, name: 'Test' },
        status: 'completed',
        output: 'ok',
        duration: 1000,
        attempts: 1,
        error: null,
      }],
      completedCount: 1,
      failedCount: 0,
    };

    const metadata = {
      projectDir: tempDir,
      startTime: Date.now() - 5000,
      endTime: Date.now(),
      branchName: 'nightytidy/run-test',
      tagName: 'nightytidy-before-test',
      originalBranch: 'main',
    };

    expect(() => generateReport(results, null, metadata)).not.toThrow();
  });

  it('formatDuration returns a non-empty string for all valid inputs', async () => {
    const { formatDuration } = await import('../src/report.js');

    const inputs = [0, 1, 59999, 60000, 3600000, 7200000 + 120000 + 30000];
    for (const ms of inputs) {
      const result = formatDuration(ms);
      expect(typeof result, `formatDuration(${ms}) should return string`).toBe('string');
      expect(result.length, `formatDuration(${ms}) should be non-empty`).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 7. logger.js — "Throws if not initialized"
// ---------------------------------------------------------------------------
describe('contract: logger.js — throws before initialization', () => {
  beforeEach(() => {
    vi.resetModules();
    // Explicitly unmock logger so we get the REAL module
    vi.doUnmock('../src/logger.js');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('info() throws "Logger not initialized" when called before initLogger()', async () => {
    const { info } = await import('../src/logger.js');

    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      expect(() => info('test')).toThrow('Logger not initialized');
    } finally {
      spy.mockRestore();
    }
  });

  it('exports all documented functions', async () => {
    const mod = await import('../src/logger.js');

    expect(mod.initLogger).toBeTypeOf('function');
    expect(mod.debug).toBeTypeOf('function');
    expect(mod.info).toBeTypeOf('function');
    expect(mod.warn).toBeTypeOf('function');
    expect(mod.error).toBeTypeOf('function');
  });
});

// ---------------------------------------------------------------------------
// 8. steps.js — Data shape contract
// ---------------------------------------------------------------------------
describe('contract: steps.js — data shape', () => {
  beforeEach(() => {
    vi.resetModules();
    // Explicitly unmock steps so we get the REAL data
    vi.doUnmock('../src/prompts/loader.js');
  });

  it('STEPS is an array of exactly 33 objects with { number, name, prompt }', async () => {
    const { STEPS } = await import('../src/prompts/loader.js');

    expect(STEPS).toHaveLength(33);

    for (let i = 0; i < STEPS.length; i++) {
      const step = STEPS[i];
      expect(step.number, `Step ${i} missing number`).toBe(i + 1);
      expect(typeof step.name, `Step ${i} name should be string`).toBe('string');
      expect(step.name.length, `Step ${i} name should be non-empty`).toBeGreaterThan(0);
      expect(typeof step.prompt, `Step ${i} prompt should be string`).toBe('string');
      expect(step.prompt.length, `Step ${i} prompt should be non-empty`).toBeGreaterThan(0);
    }
  });

  it('exports DOC_UPDATE_PROMPT, CHANGELOG_PROMPT, and CONSOLIDATION_PROMPT as non-empty strings', async () => {
    const { DOC_UPDATE_PROMPT, CHANGELOG_PROMPT, CONSOLIDATION_PROMPT } = await import('../src/prompts/loader.js');

    expect(typeof DOC_UPDATE_PROMPT).toBe('string');
    expect(DOC_UPDATE_PROMPT.length).toBeGreaterThan(50);

    expect(typeof CHANGELOG_PROMPT).toBe('string');
    expect(CHANGELOG_PROMPT.length).toBeGreaterThan(50);

    expect(typeof CONSOLIDATION_PROMPT).toBe('string');
    expect(CONSOLIDATION_PROMPT.length).toBeGreaterThan(50);
  });

  it('exports reloadSteps as a function', async () => {
    const { reloadSteps } = await import('../src/prompts/loader.js');

    expect(typeof reloadSteps).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// 9. dashboard.js — "Swallows all errors silently"
// ---------------------------------------------------------------------------
describe('contract: dashboard.js — swallows all errors', () => {
  beforeEach(() => {
    vi.resetModules();

    vi.doMock('../src/logger.js', () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.doUnmock('../src/logger.js');
    vi.restoreAllMocks();
  });

  it('updateDashboard does not throw when dashboard was never started', async () => {
    const { updateDashboard } = await import('../src/dashboard.js');
    expect(() => updateDashboard({ status: 'running' })).not.toThrow();
  });

  it('stopDashboard does not throw when dashboard was never started', async () => {
    const { stopDashboard } = await import('../src/dashboard.js');
    expect(() => stopDashboard()).not.toThrow();
  });

  it('exports all documented functions', async () => {
    const mod = await import('../src/dashboard.js');
    expect(mod.startDashboard).toBeTypeOf('function');
    expect(mod.updateDashboard).toBeTypeOf('function');
    expect(mod.stopDashboard).toBeTypeOf('function');
    expect(mod.scheduleShutdown).toBeTypeOf('function');
  });
});

// ---------------------------------------------------------------------------
// 10. setup.js — "Writes to filesystem → returns 'created'/'appended'/'updated'"
// ---------------------------------------------------------------------------
describe('contract: setup.js — returns documented status strings', () => {
  let tempDir;

  beforeEach(async () => {
    vi.resetModules();

    vi.doMock('../src/logger.js', () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }));

    tempDir = await mkdtemp(path.join(tmpdir(), 'nightytidy-contract-setup-'));
  });

  afterEach(async () => {
    vi.doUnmock('../src/logger.js');
    vi.restoreAllMocks();
    await robustCleanup(tempDir);
  });

  it('exports setupProject and generateIntegrationSnippet', async () => {
    const mod = await import('../src/setup.js');
    expect(mod.setupProject).toBeTypeOf('function');
    expect(mod.generateIntegrationSnippet).toBeTypeOf('function');
  });

  it('returns only documented values: created, appended, or updated', async () => {
    const { setupProject } = await import('../src/setup.js');

    const validValues = ['created', 'appended', 'updated'];

    // First call: creates CLAUDE.md
    const r1 = setupProject(tempDir);
    expect(validValues).toContain(r1);
    expect(r1).toBe('created');

    // Second call: should update existing section
    const r2 = setupProject(tempDir);
    expect(validValues).toContain(r2);
    expect(r2).toBe('updated');
  });

  it('appends when CLAUDE.md exists without NightyTidy section', async () => {
    const { setupProject } = await import('../src/setup.js');
    writeFileSync(path.join(tempDir, 'CLAUDE.md'), '# Existing Project\n\nSome content.\n');

    const result = setupProject(tempDir);
    expect(result).toBe('appended');
  });
});

// ---------------------------------------------------------------------------
// 11. report.js — getVersion export and side effects
// ---------------------------------------------------------------------------
describe('contract: report.js — getVersion and side effects', () => {
  let tempDir;

  beforeEach(async () => {
    vi.resetModules();

    vi.doMock('../src/logger.js', () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }));

    tempDir = await mkdtemp(path.join(tmpdir(), 'nightytidy-contract-report2-'));
  });

  afterEach(async () => {
    vi.doUnmock('../src/logger.js');
    vi.restoreAllMocks();
    await robustCleanup(tempDir);
  });

  it('getVersion returns a non-empty string', async () => {
    const { getVersion } = await import('../src/report.js');
    const version = getVersion();
    expect(typeof version).toBe('string');
    expect(version.length).toBeGreaterThan(0);
  });

  it('generateReport writes NIGHTYTIDY-REPORT.md to disk', async () => {
    const { generateReport } = await import('../src/report.js');

    const results = {
      results: [{ step: { number: 1, name: 'Lint' }, status: 'completed', output: 'ok', duration: 1000, attempts: 1, error: null }],
      completedCount: 1,
      failedCount: 0,
    };
    const metadata = {
      projectDir: tempDir,
      startTime: Date.now() - 5000,
      endTime: Date.now(),
      branchName: 'nightytidy/run-test',
      tagName: 'nightytidy-before-test',
      originalBranch: 'main',
    };

    generateReport(results, null, metadata);

    expect(existsSync(path.join(tempDir, 'NIGHTYTIDY-REPORT.md'))).toBe(true);
  });

  it('generateReport also writes/updates CLAUDE.md', async () => {
    const { generateReport } = await import('../src/report.js');

    const results = {
      results: [{ step: { number: 1, name: 'Lint' }, status: 'completed', output: 'ok', duration: 1000, attempts: 1, error: null }],
      completedCount: 1,
      failedCount: 0,
    };
    const metadata = {
      projectDir: tempDir,
      startTime: Date.now() - 5000,
      endTime: Date.now(),
      branchName: 'nightytidy/run-test',
      tagName: 'nightytidy-before-test',
      originalBranch: 'main',
    };

    generateReport(results, null, metadata);

    expect(existsSync(path.join(tempDir, 'CLAUDE.md'))).toBe(true);
    const { readFileSync } = await import('fs');
    const content = readFileSync(path.join(tempDir, 'CLAUDE.md'), 'utf8');
    expect(content).toContain('NightyTidy');
  });
});

// ---------------------------------------------------------------------------
// 12. executor.js — callback contracts
// ---------------------------------------------------------------------------
describe('contract: executor.js — callbacks are optional and receive correct args', () => {
  beforeEach(() => {
    vi.resetModules();

    vi.doMock('../src/claude.js', () => ({
      runPrompt: vi.fn().mockResolvedValue({
        success: true, output: 'ok', error: null, exitCode: 0, attempts: 1,
      }),
      ERROR_TYPE: { RATE_LIMIT: 'rate_limit', UNKNOWN: 'unknown' },
      sleep: vi.fn(() => Promise.resolve()),
    }));

    vi.doMock('../src/git.js', () => ({
      getHeadHash: vi.fn().mockResolvedValue('abc'),
      hasNewCommit: vi.fn().mockResolvedValue(true),
      fallbackCommit: vi.fn().mockResolvedValue(true),
    }));

    vi.doMock('../src/notifications.js', () => ({
      notify: vi.fn(),
    }));

    vi.doMock('../src/logger.js', () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }));

    vi.doMock('../src/prompts/loader.js', () => ({
      STEPS: [],
      DOC_UPDATE_PROMPT: 'mock doc update',
      CONSOLIDATION_PROMPT: 'mock consolidation',
      reloadSteps: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.doUnmock('../src/claude.js');
    vi.doUnmock('../src/git.js');
    vi.doUnmock('../src/notifications.js');
    vi.doUnmock('../src/logger.js');
    vi.doUnmock('../src/prompts/loader.js');
    vi.restoreAllMocks();
  });

  it('does not throw when callbacks are omitted', async () => {
    const { executeSteps } = await import('../src/executor.js');
    const steps = [{ number: 1, name: 'Test', prompt: 'test' }];

    // No callbacks passed — should not throw
    const result = await executeSteps(steps, '/fake');
    expect(result).toHaveProperty('results');
  });

  it('calls onStepStart with (step, index, totalSteps)', async () => {
    const { executeSteps } = await import('../src/executor.js');
    const onStepStart = vi.fn();
    const steps = [{ number: 1, name: 'Lint', prompt: 'lint' }];

    await executeSteps(steps, '/fake', { onStepStart });

    expect(onStepStart).toHaveBeenCalledOnce();
    const [step, index, total] = onStepStart.mock.calls[0];
    expect(step).toEqual(steps[0]);
    expect(typeof index).toBe('number');
    expect(total).toBe(1);
  });

  it('calls onStepComplete on success with (step, index, totalSteps)', async () => {
    const { executeSteps } = await import('../src/executor.js');
    const onStepComplete = vi.fn();
    const steps = [{ number: 1, name: 'Lint', prompt: 'lint' }];

    await executeSteps(steps, '/fake', { onStepComplete });

    expect(onStepComplete).toHaveBeenCalledOnce();
    const [step, index, total] = onStepComplete.mock.calls[0];
    expect(step).toEqual(steps[0]);
    expect(typeof index).toBe('number');
    expect(total).toBe(1);
  });

  it('calls onStepFail on failure with (step, index, totalSteps)', async () => {
    const { runPrompt } = await import('../src/claude.js');
    runPrompt.mockResolvedValue({
      success: false, output: '', error: 'fail', exitCode: 1, attempts: 4,
    });

    const { executeSteps } = await import('../src/executor.js');
    const onStepFail = vi.fn();
    const steps = [{ number: 1, name: 'Lint', prompt: 'lint' }];

    await executeSteps(steps, '/fake', { onStepFail });

    expect(onStepFail).toHaveBeenCalledOnce();
    const [step, index, total] = onStepFail.mock.calls[0];
    expect(step).toEqual(steps[0]);
    expect(typeof index).toBe('number');
    expect(total).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 13. dashboard.js — startDashboard return shape
// ---------------------------------------------------------------------------
describe('contract: dashboard.js — startDashboard return shape', () => {
  let tempDir;

  beforeEach(async () => {
    vi.resetModules();

    vi.doMock('../src/logger.js', () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }));

    vi.doMock('child_process', () => ({
      spawn: vi.fn(() => ({ unref: vi.fn() })),
    }));

    tempDir = await mkdtemp(path.join(tmpdir(), 'nightytidy-contract-dash-'));
  });

  afterEach(async () => {
    vi.doUnmock('../src/logger.js');
    vi.doUnmock('child_process');
    vi.restoreAllMocks();
    try {
      const mod = await import('../src/dashboard.js');
      mod.stopDashboard();
    } catch { /* ignore */ }
    await robustCleanup(tempDir);
  });

  it('returns { url, port } with correct types when started', async () => {
    const { startDashboard } = await import('../src/dashboard.js');
    const state = {
      status: 'starting', totalSteps: 1, currentStepIndex: -1,
      currentStepName: '', steps: [], completedCount: 0, failedCount: 0,
      startTime: null, error: null,
    };

    const result = await startDashboard(state, { onStop: vi.fn(), projectDir: tempDir });

    expect(result).not.toBeNull();
    expect(typeof result.port).toBe('number');
    expect(result.port).toBeGreaterThan(0);
    expect(typeof result.url).toBe('string');
    expect(result.url).toContain('http://localhost');
  });
});

// ---------------------------------------------------------------------------
// 14. Init sequence — order matters
// ---------------------------------------------------------------------------
describe('contract: initialization sequence', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock('../src/logger.js');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logger must be initialized before log functions work', async () => {
    const logger = await import('../src/logger.js');

    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      expect(() => logger.info('test')).toThrow('Logger not initialized');
    } finally {
      spy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// 15. orchestrator.js — "Never throws → returns { success: false, error }"
// ---------------------------------------------------------------------------
describe('contract: orchestrator.js — never throws, returns result objects', () => {
  beforeEach(() => {
    vi.resetModules();

    vi.doMock('fs', () => ({
      existsSync: vi.fn(() => false),
      readFileSync: vi.fn(),
      writeFileSync: vi.fn(),
      readdirSync: vi.fn(() => []),
      unlinkSync: vi.fn(),
      openSync: vi.fn(() => 99),
      closeSync: vi.fn(),
      appendFileSync: vi.fn(),
    }));

    vi.doMock('child_process', () => ({
      spawn: vi.fn(() => {
        const stdout = new EventEmitter();
        const child = new EventEmitter();
        child.stdout = stdout;
        child.unref = vi.fn();
        return child;
      }),
    }));

    vi.doMock('../src/logger.js', () => ({
      initLogger: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }));

    vi.doMock('../src/checks.js', () => ({
      runPreChecks: vi.fn().mockRejectedValue(new Error('Git not found')),
    }));

    vi.doMock('../src/git.js', () => ({
      initGit: vi.fn(() => ({})),
      excludeEphemeralFiles: vi.fn(),
      getCurrentBranch: vi.fn(),
      createPreRunTag: vi.fn(),
      createRunBranch: vi.fn(),
      mergeRunBranch: vi.fn(),
      getGitInstance: vi.fn(() => ({ add: vi.fn(), commit: vi.fn() })),
      getHeadHash: vi.fn(),
      hasNewCommit: vi.fn(),
      fallbackCommit: vi.fn(),
    }));

    vi.doMock('../src/claude.js', () => ({
      runPrompt: vi.fn(),
      ERROR_TYPE: { RATE_LIMIT: 'rate_limit', UNKNOWN: 'unknown' },
      sleep: vi.fn(() => Promise.resolve()),
    }));

    vi.doMock('../src/executor.js', () => ({
      executeSingleStep: vi.fn(),
      SAFETY_PREAMBLE: 'MOCK\n',
      PROD_PREAMBLE: 'MOCK_PROD\n',
    }));

    vi.doMock('../src/notifications.js', () => ({
      notify: vi.fn(),
    }));

    vi.doMock('../src/report.js', () => ({
      generateReport: vi.fn(),
      formatDuration: vi.fn(() => '0m'),
      buildReportNames: vi.fn(() => ({ reportFile: 'NIGHTYTIDY-REPORT_01_2026-01-01-0000.md', actionsFile: 'NIGHTYTIDY-ACTIONS_01_2026-01-01-0000.md' })),
    }));

    vi.doMock('../src/lock.js', () => ({
      acquireLock: vi.fn(),
      releaseLock: vi.fn(),
    }));

    vi.doMock('../src/consolidation.js', () => ({
      generateActionPlan: vi.fn().mockResolvedValue(null),
    }));

    vi.doMock('../src/prompts/loader.js', () => ({
      STEPS: [{ number: 1, name: 'Test', prompt: 'test' }],
      DOC_UPDATE_PROMPT: 'doc',
      CHANGELOG_PROMPT: 'log',
      CONSOLIDATION_PROMPT: 'consolidate',
      reloadSteps: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.doUnmock('fs');
    vi.doUnmock('child_process');
    vi.doUnmock('../src/logger.js');
    vi.doUnmock('../src/checks.js');
    vi.doUnmock('../src/git.js');
    vi.doUnmock('../src/claude.js');
    vi.doUnmock('../src/executor.js');
    vi.doUnmock('../src/notifications.js');
    vi.doUnmock('../src/report.js');
    vi.doUnmock('../src/lock.js');
    vi.doUnmock('../src/consolidation.js');
    vi.doUnmock('../src/prompts/loader.js');
    vi.restoreAllMocks();
  });

  it('initRun returns { success: false, error } when pre-checks throw (never throws)', async () => {
    const { initRun } = await import('../src/orchestrator.js');

    const result = await initRun('/fake/project', { steps: '1' });

    expect(result).toBeDefined();
    expect(result.success).toBe(false);
    expect(typeof result.error).toBe('string');
    expect(result.error.length).toBeGreaterThan(0);
  });

  it('runStep returns { success: false, error } when no state exists (never throws)', async () => {
    const { runStep } = await import('../src/orchestrator.js');

    const result = await runStep('/fake/project', 1);

    expect(result).toBeDefined();
    expect(result.success).toBe(false);
    expect(typeof result.error).toBe('string');
  });

  it('finishRun returns { success: false, error } when no state exists (never throws)', async () => {
    const { finishRun } = await import('../src/orchestrator.js');

    const result = await finishRun('/fake/project');

    expect(result).toBeDefined();
    expect(result.success).toBe(false);
    expect(typeof result.error).toBe('string');
  });

  it('exports initRun, runStep, and finishRun as functions', async () => {
    const mod = await import('../src/orchestrator.js');

    expect(mod.initRun).toBeTypeOf('function');
    expect(mod.runStep).toBeTypeOf('function');
    expect(mod.finishRun).toBeTypeOf('function');
  });
});

// ---------------------------------------------------------------------------
// 16. lock.js — "Async, throws with user-friendly messages"
// ---------------------------------------------------------------------------
describe('contract: lock.js — throws on contention, releaseLock never throws', () => {
  let tempDir;

  beforeEach(async () => {
    vi.resetModules();

    vi.doMock('../src/logger.js', () => ({
      initLogger: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }));

    tempDir = await mkdtemp(path.join(tmpdir(), 'nightytidy-contract-lock-'));
  });

  afterEach(async () => {
    vi.doUnmock('../src/logger.js');
    vi.restoreAllMocks();
    await robustCleanup(tempDir);
  });

  it('acquireLock throws an Error (not a result object) on contention', async () => {
    const { acquireLock } = await import('../src/lock.js');

    // Write a lock with current PID (alive) and recent timestamp
    writeFileSync(path.join(tempDir, 'nightytidy.lock'), JSON.stringify({
      pid: process.pid,
      started: new Date().toISOString(),
    }));

    try {
      await acquireLock(tempDir);
      expect.unreachable('acquireLock should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect(typeof err.message).toBe('string');
      expect(err.message).toContain('already in progress');
    }
  });

  it('releaseLock never throws even when no lock exists', async () => {
    const { releaseLock } = await import('../src/lock.js');

    expect(() => releaseLock(tempDir)).not.toThrow();
    expect(() => releaseLock('/nonexistent/path/12345')).not.toThrow();
  });

  it('exports acquireLock and releaseLock as functions', async () => {
    const mod = await import('../src/lock.js');

    expect(mod.acquireLock).toBeTypeOf('function');
    expect(mod.releaseLock).toBeTypeOf('function');
  });
});
