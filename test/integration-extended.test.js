import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile } from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { robustCleanup } from './helpers/cleanup.js';
import simpleGit from 'simple-git';

// ---------------------------------------------------------------------------
// Integration tests — extended cross-module workflows
// ---------------------------------------------------------------------------

vi.mock('../src/claude.js', () => ({
  runPrompt: vi.fn(),
}));

import { createLoggerMock } from './helpers/mocks.js';

vi.mock('../src/logger.js', () => createLoggerMock());

vi.mock('../src/notifications.js', () => ({
  notify: vi.fn(),
}));

import { runPrompt } from '../src/claude.js';
import { initGit, createPreRunTag, createRunBranch, getCurrentBranch, mergeRunBranch, getHeadHash, excludeEphemeralFiles } from '../src/git.js';
import { executeSteps } from '../src/executor.js';
import { setupProject } from '../src/setup.js';
import { generateReport, formatDuration } from '../src/report.js';

let tempDir;
let tempGit;

beforeEach(async () => {
  vi.clearAllMocks();

  tempDir = await mkdtemp(path.join(tmpdir(), 'nightytidy-integ-ext-'));
  tempGit = simpleGit(tempDir);
  await tempGit.init();
  await tempGit.addConfig('user.email', 'integration@test.com');
  await tempGit.addConfig('user.name', 'Integration Test');
  await writeFile(path.join(tempDir, 'README.md'), '# Test Project');
  await tempGit.add('.');
  await tempGit.commit('initial commit');

  initGit(tempDir);
});

afterEach(async () => {
  await robustCleanup(tempDir);
});

describe('integration: setup module', () => {
  it('creates CLAUDE.md with NightyTidy integration snippet', () => {
    const result = setupProject(tempDir);

    expect(result).toBe('created');
    const claudePath = path.join(tempDir, 'CLAUDE.md');
    expect(existsSync(claudePath)).toBe(true);

    const content = readFileSync(claudePath, 'utf8');
    expect(content).toContain('NightyTidy');
    // Should mention how to run
    expect(content).toContain('nightytidy');
  });

  it('appends to existing CLAUDE.md without destroying content', () => {
    // Create existing CLAUDE.md
    const existing = '# My Project\n\nThis project is a REST API.\n';
    const claudePath = path.join(tempDir, 'CLAUDE.md');
    require('fs').writeFileSync(claudePath, existing);

    const result = setupProject(tempDir);

    expect(['appended', 'updated']).toContain(result);
    const content = readFileSync(claudePath, 'utf8');
    expect(content).toContain('# My Project');
    expect(content).toContain('NightyTidy');
  });

  it('is idempotent — calling twice does not duplicate section', () => {
    setupProject(tempDir);
    const first = readFileSync(path.join(tempDir, 'CLAUDE.md'), 'utf8');

    setupProject(tempDir);
    const second = readFileSync(path.join(tempDir, 'CLAUDE.md'), 'utf8');

    // Count NightyTidy mentions — should be same
    const countFirst = (first.match(/NightyTidy/g) || []).length;
    const countSecond = (second.match(/NightyTidy/g) || []).length;
    expect(countSecond).toBe(countFirst);
  });
});

describe('integration: executor with abort signal', () => {
  it('stops execution when abort signal fires between steps', { timeout: 15000 }, async () => {
    const abortController = new AbortController();

    const steps = [
      { number: 1, name: 'Step1', prompt: 'step 1' },
      { number: 2, name: 'Step2', prompt: 'step 2' },
      { number: 3, name: 'Step3', prompt: 'step 3' },
    ];

    let callCount = 0;
    runPrompt.mockImplementation(async () => {
      callCount++;
      if (callCount === 2) {
        // After first step's improvement + doc prompt, abort before step 2
        abortController.abort();
      }
      await writeFile(path.join(tempDir, `file${callCount}.txt`), `content${callCount}`);
      return { success: true, output: 'ok', error: null, exitCode: 0, attempts: 1 };
    });

    const originalBranch = await getCurrentBranch();
    await createRunBranch(originalBranch);

    const results = await executeSteps(steps, tempDir, { signal: abortController.signal });

    // Should have completed step 1 but stopped before or during step 2
    expect(results.completedCount).toBeGreaterThanOrEqual(1);
    expect(results.completedCount).toBeLessThan(3);
  });
});

describe('integration: ephemeral file exclusion', () => {
  it('excludeEphemeralFiles prevents log files from being tracked', { timeout: 10000 }, async () => {
    excludeEphemeralFiles();

    // Create ephemeral files
    await writeFile(path.join(tempDir, 'nightytidy-run.log'), 'log content');
    await writeFile(path.join(tempDir, 'nightytidy-progress.json'), '{}');
    await writeFile(path.join(tempDir, 'nightytidy-dashboard.url'), 'http://localhost:9999');

    // Also create a normal file
    await writeFile(path.join(tempDir, 'normal.txt'), 'normal');

    await tempGit.add('-A');
    const status = await tempGit.status();

    // Normal file should be staged
    const stagedFiles = status.staged;
    expect(stagedFiles).toContain('normal.txt');

    // Ephemeral files should NOT be staged
    expect(stagedFiles).not.toContain('nightytidy-run.log');
    expect(stagedFiles).not.toContain('nightytidy-progress.json');
    expect(stagedFiles).not.toContain('nightytidy-dashboard.url');
  });
});

describe('integration: report with failed steps', () => {
  it('generates report that distinguishes completed and failed steps', async () => {
    const results = {
      results: [
        { step: { number: 1, name: 'Lint' }, status: 'completed', output: 'ok', duration: 30000, attempts: 1, error: null },
        { step: { number: 2, name: 'Format' }, status: 'failed', output: '', duration: 120000, attempts: 4, error: 'All 4 attempts failed' },
        { step: { number: 3, name: 'Test' }, status: 'completed', output: 'ok', duration: 45000, attempts: 2, error: null },
      ],
      completedCount: 2,
      failedCount: 1,
    };

    const metadata = {
      projectDir: tempDir,
      startTime: Date.now() - 200000,
      endTime: Date.now(),
      branchName: 'nightytidy/run-test',
      tagName: 'nightytidy-before-test',
      originalBranch: 'main',
    };

    await generateReport(results, 'Changes summary.', metadata);

    const reportPath = path.join(tempDir, 'NIGHTYTIDY-REPORT.md');
    expect(existsSync(reportPath)).toBe(true);

    const content = readFileSync(reportPath, 'utf8');
    expect(content).toContain('Lint');
    expect(content).toContain('Format');
    expect(content).toContain('Test');
    expect(content).toContain('Completed');
    expect(content).toContain('Failed');
    expect(content).toContain('4 attempts');
  });
});
