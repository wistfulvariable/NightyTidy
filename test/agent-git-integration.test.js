import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentGit } from '../src/agent/git-integration.js';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { robustCleanup } from './helpers/cleanup.js';

vi.mock('../src/logger.js', () => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  initLogger: vi.fn(),
}));

describe('AgentGit', () => {
  let tmpDir, git, defaultBranch;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-git-'));
    execSync('git init', { cwd: tmpDir });
    execSync('git config user.email "test@test.com"', { cwd: tmpDir });
    execSync('git config user.name "Test"', { cwd: tmpDir });
    fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'hello');
    execSync('git add . && git commit -m "init"', { cwd: tmpDir, shell: true });
    // Detect the actual default branch name (master or main depending on git config)
    defaultBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: tmpDir }).toString().trim();
    git = new AgentGit(tmpDir);
  });

  afterEach(async () => {
    await robustCleanup(tmpDir);
  });

  it('gets diff stat', async () => {
    execSync('git checkout -b test-branch', { cwd: tmpDir });
    fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'changed');
    execSync('git add . && git commit -m "change"', { cwd: tmpDir, shell: true });
    const stat = await git.getDiffStat(defaultBranch, 'test-branch');
    expect(stat).toContain('file.txt');
  });

  it('gets diff for files', async () => {
    execSync('git checkout -b test-branch', { cwd: tmpDir });
    fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'changed');
    execSync('git add . && git commit -m "change"', { cwd: tmpDir, shell: true });
    const diff = await git.getDiff(defaultBranch, 'test-branch');
    expect(diff).toContain('changed');
  });

  it('counts files changed', async () => {
    execSync('git checkout -b test-branch', { cwd: tmpDir });
    fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'changed');
    fs.writeFileSync(path.join(tmpDir, 'new.txt'), 'new');
    execSync('git add . && git commit -m "change"', { cwd: tmpDir, shell: true });
    const count = await git.countFilesChanged(defaultBranch, 'test-branch');
    expect(count).toBe(2);
  });
});
