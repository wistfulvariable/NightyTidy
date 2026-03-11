import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { robustCleanup } from './helpers/cleanup.js';
import simpleGit from 'simple-git';

import { createLoggerMock } from './helpers/mocks.js';

vi.mock('../src/logger.js', () => createLoggerMock());

import {
  initGit,
  getGitInstance,
  getHeadHash,
  createPreRunTag,
  createRunBranch,
  getCurrentBranch,
  ensureOnBranch,
} from '../src/git.js';

let tempDir;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), 'nightytidy-gitex-'));
  const git = simpleGit(tempDir);
  await git.init();
  await git.addConfig('user.email', 'test@test.com');
  await git.addConfig('user.name', 'Test');
  await writeFile(path.join(tempDir, 'README.md'), 'test');
  await git.add('.');
  await git.commit('initial commit');

  initGit(tempDir);
});

afterEach(async () => {
  await robustCleanup(tempDir);
});

describe('getGitInstance', () => {
  it('returns the initialized git instance', () => {
    const instance = getGitInstance();
    expect(instance).toBeDefined();
    expect(instance).not.toBeNull();
  });

  it('returns an instance that can perform git operations', async () => {
    const instance = getGitInstance();
    const status = await instance.status();
    expect(status.isClean()).toBe(true);
  });
});

describe('getHeadHash', () => {
  it('returns a 40-character hex hash', async () => {
    const hash = await getHeadHash();
    expect(hash).toMatch(/^[0-9a-f]{40}$/);
  });

  it('returns null on a repo with no commits', async () => {
    // Create a fresh empty repo (no commits)
    const emptyDir = await mkdtemp(path.join(tmpdir(), 'nightytidy-empty-'));
    const emptyGit = simpleGit(emptyDir);
    await emptyGit.init();
    initGit(emptyDir);

    const hash = await getHeadHash();
    expect(hash).toBeNull();

    // Re-init original tempDir for afterEach cleanup
    initGit(tempDir);
    await robustCleanup(emptyDir);
  });
});

describe('createPreRunTag', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('appends counter when tag already exists', async () => {
    // Freeze Date to prevent minute-boundary race between test setup and SUT
    const frozen = new Date(2026, 2, 5, 14, 30, 0);
    vi.useFakeTimers({ now: frozen, shouldAdvanceTime: true });

    const git = getGitInstance();
    const timestamp = '2026-03-05-1430';
    const manualTag = `nightytidy-before-${timestamp}`;
    await git.tag([manualTag]);

    const tag = await createPreRunTag();
    expect(tag).toBe(`${manualTag}-2`);
  });

  it('increments counter beyond -2 on repeated collisions', async () => {
    // Freeze Date to prevent minute-boundary race between test setup and SUT
    const frozen = new Date(2026, 2, 5, 14, 30, 0);
    vi.useFakeTimers({ now: frozen, shouldAdvanceTime: true });

    const git = getGitInstance();
    const timestamp = '2026-03-05-1430';
    const baseName = `nightytidy-before-${timestamp}`;
    await git.tag([baseName]);
    await git.tag([`${baseName}-2`]);

    const tag = await createPreRunTag();
    expect(tag).toBe(`${baseName}-3`);
  });
});

describe('createRunBranch', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('appends counter when branch already exists', async () => {
    // Freeze Date to prevent minute-boundary race between test setup and SUT
    const frozen = new Date(2026, 2, 5, 14, 30, 0);
    vi.useFakeTimers({ now: frozen, shouldAdvanceTime: true });

    const git = getGitInstance();
    const timestamp = '2026-03-05-1430';
    const manualBranch = `nightytidy/run-${timestamp}`;
    await git.checkoutLocalBranch(manualBranch);
    await git.checkout('master');

    const branch = await createRunBranch('master');
    expect(branch).toBe(`${manualBranch}-2`);
  });
});

describe('ensureOnBranch', () => {
  it('returns recovered:false when already on the expected branch', async () => {
    const branch = await getCurrentBranch();
    const result = await ensureOnBranch(branch);
    expect(result.recovered).toBe(false);
  });

  it('recovers when on a different branch by merging and checking out expected', async () => {
    const git = getGitInstance();
    // Create run branch and add a commit
    await git.checkoutLocalBranch('nightytidy/run-test');
    await writeFile(path.join(tempDir, 'run-file.txt'), 'run work');
    await git.add('.');
    await git.commit('work on run branch');

    // Simulate Claude Code creating a stray branch with different work
    await git.checkoutLocalBranch('stray-branch');
    await writeFile(path.join(tempDir, 'stray-file.txt'), 'stray work');
    await git.add('.');
    await git.commit('work on stray branch');

    // Now ensureOnBranch should recover
    const result = await ensureOnBranch('nightytidy/run-test');
    expect(result.recovered).toBe(true);
    expect(result.strayBranch).toBe('stray-branch');
    expect(result.mergeOk).toBe(true);

    // Should be back on the run branch
    const current = await getCurrentBranch();
    expect(current).toBe('nightytidy/run-test');

    // Stray file should be merged in
    const status = await git.status();
    expect(status.isClean()).toBe(true);
  });

  it('commits uncommitted work on stray branch before recovery', async () => {
    const git = getGitInstance();
    await git.checkoutLocalBranch('nightytidy/run-test');

    // Simulate stray branch with uncommitted changes
    await git.checkoutLocalBranch('stray-branch');
    await writeFile(path.join(tempDir, 'uncommitted.txt'), 'uncommitted work');
    // Don't commit — leave it dirty

    const result = await ensureOnBranch('nightytidy/run-test');
    expect(result.recovered).toBe(true);
    expect(result.mergeOk).toBe(true);

    const current = await getCurrentBranch();
    expect(current).toBe('nightytidy/run-test');
  });

  it('handles merge conflict gracefully without throwing', async () => {
    const git = getGitInstance();
    await git.checkoutLocalBranch('nightytidy/run-test');

    // Create conflicting content on the run branch
    await writeFile(path.join(tempDir, 'conflict.txt'), 'run version');
    await git.add('.');
    await git.commit('run: add conflict.txt');

    // Create conflicting content on a stray branch (from the same base)
    await git.checkout('master');
    await git.checkoutLocalBranch('stray-conflict');
    await writeFile(path.join(tempDir, 'conflict.txt'), 'stray version');
    await git.add('.');
    await git.commit('stray: add conflict.txt');

    const result = await ensureOnBranch('nightytidy/run-test');
    expect(result.recovered).toBe(true);
    expect(result.strayBranch).toBe('stray-conflict');
    expect(result.mergeOk).toBe(false);

    // Should still be on the expected branch despite merge failure
    const current = await getCurrentBranch();
    expect(current).toBe('nightytidy/run-test');
  });
});
