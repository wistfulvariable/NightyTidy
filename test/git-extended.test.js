import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile } from 'fs/promises';
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
  getGitInstance,
  getHeadHash,
  createPreRunTag,
  createRunBranch,
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
