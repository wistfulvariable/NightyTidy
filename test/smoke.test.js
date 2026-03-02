import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { robustCleanup } from './helpers/cleanup.js';

// ---------------------------------------------------------------------------
// Smoke tests — structural integrity of the NightyTidy CLI tool
//
// These verify "is it on fire?" — not correctness of every feature.
// Target: under 30 seconds for the full suite, 3–7 tests.
// Run independently after deploys or major refactors.
// ---------------------------------------------------------------------------

describe('smoke tests', () => {
  // -------------------------------------------------------------------------
  // 1. All source modules import without error
  // -------------------------------------------------------------------------
  it('all source modules import without crashing', async () => {
    // If any module has a syntax error, bad import, or top-level throw,
    // the dynamic import will reject.
    const modules = [
      '../src/logger.js',
      '../src/git.js',
      '../src/claude.js',
      '../src/checks.js',
      '../src/executor.js',
      '../src/notifications.js',
      '../src/report.js',
      '../src/setup.js',
      '../src/dashboard.js',
      '../src/dashboard-tui.js',
      '../src/prompts/steps.js',
    ];

    for (const mod of modules) {
      await expect(import(mod)).resolves.toBeDefined();
    }
  });

  // -------------------------------------------------------------------------
  // 2. Logger initializes and produces a log file
  // -------------------------------------------------------------------------
  it('logger initializes successfully and creates a log file', async () => {
    const { existsSync } = await import('fs');
    const tempDir = await mkdtemp(path.join(tmpdir(), 'nightytidy-smoke-'));

    try {
      // We need a fresh module instance since logger has singleton state.
      // Just verify the function exists and doesn't throw.
      const { initLogger, info } = await import('../src/logger.js');

      // initLogger should not throw for a valid directory
      expect(() => initLogger(tempDir)).not.toThrow();

      // The log file should have been created
      const logPath = path.join(tempDir, 'nightytidy-run.log');
      expect(existsSync(logPath)).toBe(true);
    } finally {
      await robustCleanup(tempDir);
    }
  });

  // -------------------------------------------------------------------------
  // 3. Git module initializes with a real git repo
  // -------------------------------------------------------------------------
  it('git module initializes against a real repo and returns a git instance', async () => {
    const simpleGit = (await import('simple-git')).default;
    const tempDir = await mkdtemp(path.join(tmpdir(), 'nightytidy-smoke-'));

    try {
      const git = simpleGit(tempDir);
      await git.init();
      await git.addConfig('user.email', 'smoke@test.com');
      await git.addConfig('user.name', 'Smoke');
      await writeFile(path.join(tempDir, 'init.txt'), 'smoke');
      await git.add('.');
      await git.commit('smoke init');

      const { initGit, getCurrentBranch } = await import('../src/git.js');
      const instance = initGit(tempDir);

      expect(instance).toBeDefined();
      const branch = await getCurrentBranch();
      expect(typeof branch).toBe('string');
      expect(branch.length).toBeGreaterThan(0);
    } finally {
      await robustCleanup(tempDir);
    }
  });

  // -------------------------------------------------------------------------
  // 4. Steps data is structurally valid (critical path for execution)
  // -------------------------------------------------------------------------
  it('steps data exports 28 valid steps and special prompts', async () => {
    const { STEPS, DOC_UPDATE_PROMPT, CHANGELOG_PROMPT } = await import('../src/prompts/steps.js');

    // Must have exactly 28 steps
    expect(STEPS).toHaveLength(28);

    // First and last steps have required shape
    expect(STEPS[0]).toMatchObject({
      number: 1,
      name: expect.any(String),
      prompt: expect.any(String),
    });
    expect(STEPS[27]).toMatchObject({
      number: 28,
      name: expect.any(String),
      prompt: expect.any(String),
    });

    // Special prompts exist and are non-trivial
    expect(DOC_UPDATE_PROMPT.length).toBeGreaterThan(100);
    expect(CHANGELOG_PROMPT.length).toBeGreaterThan(100);
  });

  // -------------------------------------------------------------------------
  // 5. Entry point module loads (bin/nightytidy.js)
  // -------------------------------------------------------------------------
  it('entry point module (bin/nightytidy.js) can be imported', async () => {
    // The entry point imports cli.js and calls run().
    // We can't actually call run() (it launches interactive UI),
    // but we can verify the module loads without errors.
    // cli.js imports everything, so this transitively verifies the full dependency tree.
    const mod = await import('../src/cli.js');

    expect(mod.run).toBeTypeOf('function');
  });

  // -------------------------------------------------------------------------
  // 6. Report module's formatDuration utility works
  // -------------------------------------------------------------------------
  it('formatDuration produces valid human-readable strings', async () => {
    const { formatDuration } = await import('../src/report.js');

    // Sanity checks on the most used utility function
    expect(formatDuration(0)).toBe('0m 00s');
    expect(formatDuration(60000)).toBe('1m 00s');
    expect(formatDuration(3600000)).toBe('1h 00m');

    // Should never return empty
    expect(formatDuration(1).length).toBeGreaterThan(0);
  });
});
