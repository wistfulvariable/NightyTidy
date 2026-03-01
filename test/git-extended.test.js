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
});
