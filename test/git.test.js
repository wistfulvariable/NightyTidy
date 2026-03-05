import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile } from 'fs/promises';
import { readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { robustCleanup } from './helpers/cleanup.js';
import simpleGit from 'simple-git';

vi.mock('../src/logger.js', () => ({
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

import {
  initGit,
  excludeEphemeralFiles,
  createPreRunTag,
  createRunBranch,
  hasNewCommit,
  fallbackCommit,
  mergeRunBranch,
  getCurrentBranch,
  getHeadHash,
} from '../src/git.js';

let tempDir;
let tempGit;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), 'nightytidy-test-'));
  tempGit = simpleGit(tempDir);
  await tempGit.init();
  await tempGit.addConfig('user.email', 'test@test.com');
  await tempGit.addConfig('user.name', 'Test');
  // Create initial commit so HEAD exists
  await writeFile(path.join(tempDir, 'README.md'), 'test');
  await tempGit.add('.');
  await tempGit.commit('initial commit');

  initGit(tempDir);
});

afterEach(async () => {
  await robustCleanup(tempDir);
});

describe('createPreRunTag', () => {
  it('creates a tag that exists and points to HEAD', async () => {
    const tagName = await createPreRunTag();

    expect(tagName).toMatch(/^nightytidy-before-\d{4}-\d{2}-\d{2}-\d{4}$/);

    // Verify the tag exists in the repo
    const tags = await tempGit.tags();
    expect(tags.all).toContain(tagName);

    // Verify the tag points to HEAD
    const headHash = await getHeadHash();
    const tagHash = (await tempGit.raw(['rev-parse', tagName])).trim();
    expect(tagHash).toBe(headHash);
  });

  it('appends -2 suffix when the tag already exists', async () => {
    const firstTag = await createPreRunTag();
    const secondTag = await createPreRunTag();

    expect(secondTag).toBe(`${firstTag}-2`);

    const tags = await tempGit.tags();
    expect(tags.all).toContain(firstTag);
    expect(tags.all).toContain(secondTag);
  });
});

describe('createRunBranch', () => {
  it('creates and checks out a new branch', async () => {
    const originalBranch = await getCurrentBranch();
    const branchName = await createRunBranch(originalBranch);

    expect(branchName).toMatch(/^nightytidy\/run-\d{4}-\d{2}-\d{2}-\d{4}$/);

    // Verify we are now on the new branch
    const currentBranch = await getCurrentBranch();
    expect(currentBranch).toBe(branchName);

    // Verify the branch exists in the repo
    const branches = await tempGit.branch();
    expect(branches.all).toContain(branchName);
  });
});

describe('hasNewCommit', () => {
  it('returns false when no new commit has been made', async () => {
    const hashBefore = await getHeadHash();
    const result = await hasNewCommit(hashBefore);

    expect(result).toBe(false);
  });

  it('returns true after a new commit is made', async () => {
    const hashBefore = await getHeadHash();

    // Make a new commit
    await writeFile(path.join(tempDir, 'newfile.txt'), 'new content');
    await tempGit.add('.');
    await tempGit.commit('second commit');

    const result = await hasNewCommit(hashBefore);
    expect(result).toBe(true);
  });
});

describe('fallbackCommit', () => {
  it('creates a commit when there are staged changes', async () => {
    await writeFile(path.join(tempDir, 'changed.txt'), 'some content');

    const hashBefore = await getHeadHash();
    const result = await fallbackCommit(1, 'lint');

    expect(result).toBe(true);

    // Verify a new commit was created
    const hashAfter = await getHeadHash();
    expect(hashAfter).not.toBe(hashBefore);

    // Verify commit message
    const log = await tempGit.log({ maxCount: 1 });
    expect(log.latest.message).toContain('Step 1');
    expect(log.latest.message).toContain('lint');
  });

  it('skips commit on clean working tree without error', async () => {
    const hashBefore = await getHeadHash();
    const result = await fallbackCommit(2, 'format');

    expect(result).toBe(false);

    // Verify no new commit was created
    const hashAfter = await getHeadHash();
    expect(hashAfter).toBe(hashBefore);
  });
});

describe('mergeRunBranch', () => {
  it('merges run branch cleanly with --no-ff', async () => {
    const originalBranch = await getCurrentBranch();
    const runBranch = await createRunBranch(originalBranch);

    // Make a commit on the run branch
    await writeFile(path.join(tempDir, 'feature.txt'), 'feature work');
    await tempGit.add('.');
    await tempGit.commit('feature commit on run branch');

    const result = await mergeRunBranch(originalBranch, runBranch);

    expect(result).toEqual({ success: true });

    // Verify we are back on the original branch
    const currentBranch = await getCurrentBranch();
    expect(currentBranch).toBe(originalBranch);

    // Verify the merge commit exists (--no-ff creates a merge commit)
    const log = await tempGit.log({ maxCount: 1 });
    expect(log.latest.message).toContain('Merge');
  });

  it('returns conflict indicator when branches have conflicting changes', async () => {
    const originalBranch = await getCurrentBranch();
    const runBranch = await createRunBranch(originalBranch);

    // Make a commit on the run branch modifying README.md
    await writeFile(path.join(tempDir, 'README.md'), 'run branch content');
    await tempGit.add('.');
    await tempGit.commit('run branch change');

    // Switch back to original and make a conflicting commit
    await tempGit.checkout(originalBranch);
    await writeFile(path.join(tempDir, 'README.md'), 'original branch content');
    await tempGit.add('.');
    await tempGit.commit('conflicting change on original');

    // Switch back to run branch so mergeRunBranch can checkout original
    await tempGit.checkout(runBranch);

    const result = await mergeRunBranch(originalBranch, runBranch);

    expect(result).toEqual({ success: false, conflict: true });

    // Verify we ended up on the original branch (checkout happened before merge attempt)
    const currentBranch = await getCurrentBranch();
    expect(currentBranch).toBe(originalBranch);

    // Verify the merge was aborted (clean working tree, no merge in progress)
    const status = await tempGit.status();
    expect(status.conflicted).toHaveLength(0);
  });
});

describe('getCurrentBranch', () => {
  it('returns the correct branch name', async () => {
    const branch = await getCurrentBranch();

    // Default branch after git init is typically "master" or "main"
    expect(typeof branch).toBe('string');
    expect(branch.length).toBeGreaterThan(0);
  });

  it('returns updated branch name after switching branches', async () => {
    const originalBranch = await getCurrentBranch();
    await tempGit.checkoutLocalBranch('test-branch');
    initGit(tempDir); // re-init so the git instance picks up state

    const newBranch = await getCurrentBranch();
    expect(newBranch).toBe('test-branch');
    expect(newBranch).not.toBe(originalBranch);
  });
});

describe('excludeEphemeralFiles', () => {
  it('adds ephemeral file entries to .git/info/exclude', () => {
    excludeEphemeralFiles();

    const excludePath = path.join(tempDir, '.git', 'info', 'exclude');
    const content = readFileSync(excludePath, 'utf8');

    expect(content).toContain('nightytidy-run.log');
    expect(content).toContain('nightytidy-progress.json');
    expect(content).toContain('nightytidy-dashboard.url');
  });

  it('is idempotent — calling twice does not duplicate entries', () => {
    excludeEphemeralFiles();
    excludeEphemeralFiles();

    const excludePath = path.join(tempDir, '.git', 'info', 'exclude');
    const content = readFileSync(excludePath, 'utf8');

    const logCount = content.split('nightytidy-run.log').length - 1;
    expect(logCount).toBe(1);
  });

  it('prevents ephemeral files from being staged by git add -A', async () => {
    excludeEphemeralFiles();

    // Create both a normal file and ephemeral files
    await writeFile(path.join(tempDir, 'code.js'), 'console.log("hello")');
    await writeFile(path.join(tempDir, 'nightytidy-run.log'), 'log content');
    await writeFile(path.join(tempDir, 'nightytidy-progress.json'), '{}');

    await tempGit.add('-A');
    const status = await tempGit.status();

    // Normal file should be staged, ephemeral files should not
    expect(status.staged).toContain('code.js');
    expect(status.staged).not.toContain('nightytidy-run.log');
    expect(status.staged).not.toContain('nightytidy-progress.json');
  });
});

describe('fallbackCommit — ephemeral file exclusion', () => {
  it('excludes nightytidy-run.log from commits', async () => {
    excludeEphemeralFiles();
    await writeFile(path.join(tempDir, 'code.js'), 'console.log("hello")');
    await writeFile(path.join(tempDir, 'nightytidy-run.log'), 'log content');

    await fallbackCommit(1, 'test');

    // Verify the commit includes code.js but not the log file
    const show = await tempGit.raw(['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD']);
    expect(show).toContain('code.js');
    expect(show).not.toContain('nightytidy-run.log');
  });

  it('skips commit when only ephemeral files changed', async () => {
    excludeEphemeralFiles();
    await writeFile(path.join(tempDir, 'nightytidy-run.log'), 'log content');
    await writeFile(path.join(tempDir, 'nightytidy-progress.json'), '{}');

    const hashBefore = await getHeadHash();
    const result = await fallbackCommit(1, 'test');

    expect(result).toBe(false);

    const hashAfter = await getHeadHash();
    expect(hashAfter).toBe(hashBefore);
  });
});
