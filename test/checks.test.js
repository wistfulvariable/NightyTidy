import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

import { createLoggerMock, createMockProcess, createErrorProcess, createMockGit } from './helpers/mocks.js';

vi.mock('../src/logger.js', () => createLoggerMock());

import { spawn } from 'child_process';
import { runPreChecks } from '../src/checks.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runPreChecks', () => {
  it('passes when all checks succeed', async () => {
    // git --version succeeds, claude --version succeeds, claude -p succeeds,
    // disk space succeeds
    spawn.mockImplementation((cmd, args) => {
      if (cmd === 'git') {
        return createMockProcess({ code: 0, stdout: 'git version 2.40.0' });
      }
      if (cmd === 'claude' && args.includes('--version')) {
        return createMockProcess({ code: 0, stdout: 'claude 1.0.0' });
      }
      if (cmd === 'claude' && args.includes('-p')) {
        return createMockProcess({ code: 0, stdout: 'OK' });
      }
      // Disk space check — wmic on Windows, df on Unix
      if (cmd === 'wmic') {
        return createMockProcess({ code: 0, stdout: 'FreeSpace\n50000000000\n' });
      }
      // df fallback for non-Windows
      return createMockProcess({ code: 0, stdout: 'Filesystem 1K-blocks Used Available\n/dev/sda1 100000000 50000000 50000000' });
    });

    const mockGit = createMockGit({ isRepo: true });

    // Should not throw
    await expect(runPreChecks('/fake/project', mockGit)).resolves.toBeUndefined();
  });

  it('throws when git is not installed', async () => {
    spawn.mockImplementation((cmd) => {
      if (cmd === 'git') {
        return createErrorProcess('command not found');
      }
      return createMockProcess({ code: 0, stdout: 'ok' });
    });

    const mockGit = createMockGit();

    await expect(runPreChecks('/fake/project', mockGit)).rejects.toThrow('Git is not installed');
  });

  it('throws when the directory is not a git repo', async () => {
    spawn.mockImplementation((cmd) => {
      if (cmd === 'git') {
        return createMockProcess({ code: 0, stdout: 'git version 2.40.0' });
      }
      return createMockProcess({ code: 0, stdout: 'ok' });
    });

    const mockGit = createMockGit({ isRepo: false });

    await expect(runPreChecks('/fake/project', mockGit)).rejects.toThrow("isn't a git project");
  });

  it('throws when Claude Code is not installed', async () => {
    spawn.mockImplementation((cmd, args) => {
      if (cmd === 'git') {
        return createMockProcess({ code: 0, stdout: 'git version 2.40.0' });
      }
      if (cmd === 'claude' && args.includes('--version')) {
        return createErrorProcess('command not found');
      }
      return createMockProcess({ code: 0, stdout: 'ok' });
    });

    const mockGit = createMockGit({ isRepo: true });

    await expect(runPreChecks('/fake/project', mockGit)).rejects.toThrow('Claude Code not detected');
  });
});
