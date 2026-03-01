import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import simpleGit from 'simple-git';

// ---------------------------------------------------------------------------
// Integration tests — real git repos + real file I/O
//
// These tests wire together multiple modules to verify end-to-end workflows
// without mocking internal modules. Only the Claude subprocess is mocked
// (since we can't run real Claude in tests).
// ---------------------------------------------------------------------------

// Mock only claude.js (subprocess) and logger.js (to avoid log file noise)
vi.mock('../src/claude.js', () => ({
  runPrompt: vi.fn(),
}));

vi.mock('../src/logger.js', () => ({
  initLogger: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../src/notifications.js', () => ({
  notify: vi.fn(),
}));

import { runPrompt } from '../src/claude.js';
import { initGit, createPreRunTag, createRunBranch, getCurrentBranch, fallbackCommit, mergeRunBranch, getHeadHash } from '../src/git.js';
import { executeSteps } from '../src/executor.js';
import { generateReport, formatDuration } from '../src/report.js';

let tempDir;
let tempGit;

beforeEach(async () => {
  vi.clearAllMocks();

  tempDir = await mkdtemp(path.join(tmpdir(), 'nightytidy-integ-'));
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
  await rm(tempDir, { recursive: true, force: true });
});

describe('integration: full execution flow', () => {
  it('executes steps on a run branch and produces a commit per step', async () => {
    // Setup: mock Claude to succeed
    runPrompt.mockResolvedValue({
      success: true,
      output: 'Changes applied successfully',
      error: null,
      exitCode: 0,
      attempts: 1,
    });

    // 1. Save original branch
    const originalBranch = await getCurrentBranch();

    // 2. Create safety tag
    const tagName = await createPreRunTag();
    expect(tagName).toMatch(/^nightytidy-before-/);

    // 3. Create run branch
    const runBranch = await createRunBranch(originalBranch);
    expect(await getCurrentBranch()).toBe(runBranch);

    // 4. Simulate a step that creates a file (since Claude is mocked, we create
    //    the file ourselves, then fallbackCommit will pick it up)
    const steps = [
      { number: 1, name: 'Lint', prompt: 'lint the code' },
    ];

    // Mock runPrompt to also create a file (simulating Claude's work)
    runPrompt.mockImplementation(async () => {
      // Create a file to simulate Claude's changes
      await writeFile(path.join(tempDir, 'lint-fix.txt'), 'linted');
      return {
        success: true,
        output: 'Applied lint fixes',
        error: null,
        exitCode: 0,
        attempts: 1,
      };
    });

    const results = await executeSteps(steps, tempDir);

    expect(results.completedCount).toBe(1);
    expect(results.failedCount).toBe(0);

    // Verify a commit was made on the run branch
    const log = await tempGit.log();
    expect(log.all.length).toBeGreaterThan(1); // initial + step commit(s)

    // 5. Merge back to original
    const mergeResult = await mergeRunBranch(originalBranch, runBranch);
    expect(mergeResult.success).toBe(true);

    // Verify we're back on the original branch
    expect(await getCurrentBranch()).toBe(originalBranch);

    // Verify the lint fix file exists on the merged branch
    expect(existsSync(path.join(tempDir, 'lint-fix.txt'))).toBe(true);
  });

  it('handles step failure without breaking the run branch', async () => {
    const originalBranch = await getCurrentBranch();
    const tagName = await createPreRunTag();
    const runBranch = await createRunBranch(originalBranch);

    const steps = [
      { number: 1, name: 'Pass', prompt: 'passing step' },
      { number: 2, name: 'Fail', prompt: 'failing step' },
      { number: 3, name: 'Pass2', prompt: 'passing step 2' },
    ];

    let callCount = 0;
    runPrompt.mockImplementation(async () => {
      callCount++;
      // Steps 1 & 3 improve + doc update succeed
      // Step 2 improvement fails
      if (callCount === 3) {
        // Step 2 improvement prompt
        return { success: false, output: '', error: 'timeout', exitCode: -1, attempts: 4 };
      }
      // Create a file for successful steps
      if (callCount === 1) {
        await writeFile(path.join(tempDir, 'step1.txt'), 'step1');
      }
      if (callCount === 4) {
        await writeFile(path.join(tempDir, 'step3.txt'), 'step3');
      }
      return { success: true, output: 'ok', error: null, exitCode: 0, attempts: 1 };
    });

    const results = await executeSteps(steps, tempDir);

    expect(results.completedCount).toBe(2);
    expect(results.failedCount).toBe(1);
    expect(results.results[1].status).toBe('failed');

    // Run branch should still be clean (no uncommitted changes)
    const status = await tempGit.status();
    expect(status.isClean()).toBe(true);
  });
});

describe('integration: report generation with real files', () => {
  it('generates a report file and updates CLAUDE.md in a real directory', async () => {
    const results = {
      results: [
        { step: { number: 1, name: 'Lint' }, status: 'completed', output: 'ok', duration: 30000, attempts: 1, error: null },
        { step: { number: 2, name: 'Format' }, status: 'completed', output: 'ok', duration: 45000, attempts: 1, error: null },
      ],
      completedCount: 2,
      failedCount: 0,
    };

    const metadata = {
      projectDir: tempDir,
      startTime: Date.now() - 75000,
      endTime: Date.now(),
      branchName: 'nightytidy/run-test',
      tagName: 'nightytidy-before-test',
      originalBranch: 'main',
    };

    await generateReport(results, 'A narrated summary of changes.', metadata);

    // Verify NIGHTYTIDY-REPORT.md was created
    const reportPath = path.join(tempDir, 'NIGHTYTIDY-REPORT.md');
    expect(existsSync(reportPath)).toBe(true);

    const reportContent = readFileSync(reportPath, 'utf8');
    expect(reportContent).toContain('# NightyTidy Report');
    expect(reportContent).toContain('A narrated summary');
    expect(reportContent).toContain('Lint');
    expect(reportContent).toContain('Format');
    expect(reportContent).toContain('✅ Completed');

    // Verify CLAUDE.md was created/updated
    const claudePath = path.join(tempDir, 'CLAUDE.md');
    expect(existsSync(claudePath)).toBe(true);

    const claudeContent = readFileSync(claudePath, 'utf8');
    expect(claudeContent).toContain('## NightyTidy');
    expect(claudeContent).toContain('nightytidy-before-test');
  });

  it('appends NightyTidy section to existing CLAUDE.md without destroying content', async () => {
    // Pre-create a CLAUDE.md with existing content
    const existingContent = '# My Project\n\nSome important project documentation.\n\n## Build\n\n`npm run build`\n';
    await writeFile(path.join(tempDir, 'CLAUDE.md'), existingContent);

    const results = {
      results: [
        { step: { number: 1, name: 'Test' }, status: 'completed', output: 'ok', duration: 10000, attempts: 1, error: null },
      ],
      completedCount: 1,
      failedCount: 0,
    };

    const metadata = {
      projectDir: tempDir,
      startTime: Date.now() - 10000,
      endTime: Date.now(),
      branchName: 'nightytidy/run-test',
      tagName: 'nightytidy-before-test',
      originalBranch: 'main',
    };

    await generateReport(results, null, metadata);

    const claudeContent = readFileSync(path.join(tempDir, 'CLAUDE.md'), 'utf8');

    // Original content preserved
    expect(claudeContent).toContain('# My Project');
    expect(claudeContent).toContain('Some important project documentation');
    expect(claudeContent).toContain('## Build');

    // NightyTidy section appended
    expect(claudeContent).toContain('## NightyTidy');
    expect(claudeContent).toContain('nightytidy-before-test');
  });
});

describe('integration: git tag and branch lifecycle', () => {
  it('safety tag preserves the pre-run state even after changes', async () => {
    const preRunHash = await getHeadHash();
    const tagName = await createPreRunTag();

    // Make changes on a run branch
    const originalBranch = await getCurrentBranch();
    await createRunBranch(originalBranch);
    await writeFile(path.join(tempDir, 'new-file.txt'), 'content');
    await fallbackCommit(1, 'Test');

    // Verify the tag still points to the original commit
    const tagHash = (await tempGit.raw(['rev-parse', tagName])).trim();
    expect(tagHash).toBe(preRunHash);

    // The current HEAD should be different
    const currentHash = await getHeadHash();
    expect(currentHash).not.toBe(preRunHash);
  });
});
