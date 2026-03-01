import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('../src/logger.js', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

import { spawn } from 'child_process';
import { runPreChecks } from '../src/checks.js';
import { EventEmitter } from 'events';

// ---------------------------------------------------------------------------
// Helpers (matching checks.test.js conventions)
// ---------------------------------------------------------------------------

function createMockProcess({ code = 0, stdout = '', stderr = '' } = {}) {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();

  process.nextTick(() => {
    if (stdout) proc.stdout.emit('data', Buffer.from(stdout));
    if (stderr) proc.stderr.emit('data', Buffer.from(stderr));
    proc.emit('close', code);
  });

  return proc;
}

function createErrorProcess(errorMessage = 'command not found') {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();

  process.nextTick(() => {
    proc.emit('error', new Error(errorMessage));
  });

  return proc;
}

function createTimeoutProcess() {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn(() => {
    process.nextTick(() => proc.emit('close', null));
  });
  // Never emits close or error on its own — simulates hang
  return proc;
}

function createMockGit({ isRepo = true, branches = [] } = {}) {
  return {
    checkIsRepo: vi.fn().mockResolvedValue(isRepo),
    branch: vi.fn().mockResolvedValue({ all: branches }),
  };
}

// A helper that creates a spawn sequence handler based on command matching
function mockSpawnForChecks({
  gitOk = true,
  claudeVersionOk = true,
  claudeAuthOk = true,
  claudeAuthTimeout = false,
  claudeAuthStdout = 'OK',
  diskSpaceStdout = 'FreeSpace\n50000000000\n',
  diskSpaceCode = 0,
  diskSpaceFail = false,
  powershellOk = true,
  powershellStdout = '50000000000',
} = {}) {
  spawn.mockImplementation((cmd, args) => {
    if (cmd === 'git') {
      if (!gitOk) return createErrorProcess('command not found');
      return createMockProcess({ code: 0, stdout: 'git version 2.40.0' });
    }
    if (cmd === 'claude' && args?.includes('--version')) {
      if (!claudeVersionOk) return createErrorProcess('command not found');
      return createMockProcess({ code: 0, stdout: 'claude 1.0.0' });
    }
    if (cmd === 'claude' && args?.includes('-p')) {
      if (claudeAuthTimeout) return createTimeoutProcess();
      if (!claudeAuthOk) return createMockProcess({ code: 1, stdout: '' });
      return createMockProcess({ code: 0, stdout: claudeAuthStdout });
    }
    if (cmd === 'powershell') {
      if (!powershellOk) return createMockProcess({ code: 1, stdout: '' });
      return createMockProcess({ code: 0, stdout: powershellStdout });
    }
    if (cmd === 'wmic') {
      return createMockProcess({ code: diskSpaceCode, stdout: diskSpaceStdout });
    }
    if (cmd === 'df') {
      if (diskSpaceFail) return createErrorProcess('df error');
      return createMockProcess({ code: 0, stdout: 'Filesystem 1K-blocks Used Available\n/dev/sda1 100000000 50000000 50000000' });
    }
    return createMockProcess({ code: 0, stdout: 'ok' });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests covering gaps in checks.test.js
// ---------------------------------------------------------------------------

describe('runPreChecks — extended coverage', () => {
  describe('Claude authentication', () => {
    it('throws when Claude auth returns empty stdout (exit 0 but no output)', async () => {
      mockSpawnForChecks({ claudeAuthStdout: '' });
      // Make claudeAuthOk still true (exit code 0) but empty stdout
      spawn.mockImplementation((cmd, args) => {
        if (cmd === 'git') return createMockProcess({ code: 0, stdout: 'git version 2.40.0' });
        if (cmd === 'claude' && args?.includes('--version'))
          return createMockProcess({ code: 0, stdout: 'claude 1.0.0' });
        if (cmd === 'claude' && args?.includes('-p'))
          return createMockProcess({ code: 0, stdout: '' });
        if (cmd === 'powershell')
          return createMockProcess({ code: 0, stdout: '50000000000' });
        return createMockProcess({ code: 0, stdout: 'ok' });
      });

      const mockGit = createMockGit({ isRepo: true });

      await expect(runPreChecks('/fake/project', mockGit)).rejects.toThrow(
        "doesn't seem to be authenticated"
      );
    });

    it('throws when Claude auth returns non-zero exit code', async () => {
      mockSpawnForChecks({ claudeAuthOk: false });
      spawn.mockImplementation((cmd, args) => {
        if (cmd === 'git') return createMockProcess({ code: 0, stdout: 'git version 2.40.0' });
        if (cmd === 'claude' && args?.includes('--version'))
          return createMockProcess({ code: 0, stdout: 'claude 1.0.0' });
        if (cmd === 'claude' && args?.includes('-p'))
          return createMockProcess({ code: 1, stdout: '' });
        if (cmd === 'powershell')
          return createMockProcess({ code: 0, stdout: '50000000000' });
        return createMockProcess({ code: 0, stdout: 'ok' });
      });

      const mockGit = createMockGit({ isRepo: true });

      await expect(runPreChecks('/fake/project', mockGit)).rejects.toThrow(
        "doesn't seem to be authenticated"
      );
    });
  });

  describe('disk space', () => {
    it('throws when disk space is critically low (under 100MB)', async () => {
      spawn.mockImplementation((cmd, args) => {
        if (cmd === 'git') return createMockProcess({ code: 0, stdout: 'git version 2.40.0' });
        if (cmd === 'claude' && args?.includes('--version'))
          return createMockProcess({ code: 0, stdout: 'claude 1.0.0' });
        if (cmd === 'claude' && args?.includes('-p'))
          return createMockProcess({ code: 0, stdout: 'OK' });
        // PowerShell returns very low space: 50MB = 52428800 bytes
        if (cmd === 'powershell')
          return createMockProcess({ code: 0, stdout: '52428800' });
        if (cmd === 'wmic')
          return createMockProcess({ code: 0, stdout: 'FreeSpace\n52428800\n' });
        if (cmd === 'df')
          return createMockProcess({ code: 0, stdout: 'Filesystem 1K-blocks Used Available\n/dev/sda1 100000000 99949000 51200' });
        return createMockProcess({ code: 0, stdout: 'ok' });
      });

      const mockGit = createMockGit({ isRepo: true });

      await expect(runPreChecks('/fake/project', mockGit)).rejects.toThrow('Very low disk space');
    });

    it('skips disk space check gracefully when command fails', async () => {
      spawn.mockImplementation((cmd, args) => {
        if (cmd === 'git') return createMockProcess({ code: 0, stdout: 'git version 2.40.0' });
        if (cmd === 'claude' && args?.includes('--version'))
          return createMockProcess({ code: 0, stdout: 'claude 1.0.0' });
        if (cmd === 'claude' && args?.includes('-p'))
          return createMockProcess({ code: 0, stdout: 'OK' });
        // Disk space commands all fail
        if (cmd === 'powershell') return createErrorProcess('powershell not found');
        if (cmd === 'wmic') return createErrorProcess('wmic not found');
        if (cmd === 'df') return createErrorProcess('df not found');
        return createMockProcess({ code: 0, stdout: 'ok' });
      });

      const mockGit = createMockGit({ isRepo: true });

      // Should NOT throw — disk space failure is non-fatal
      await expect(runPreChecks('/fake/project', mockGit)).resolves.toBeUndefined();
    });

    it('skips gracefully when disk space output cannot be parsed', async () => {
      spawn.mockImplementation((cmd, args) => {
        if (cmd === 'git') return createMockProcess({ code: 0, stdout: 'git version 2.40.0' });
        if (cmd === 'claude' && args?.includes('--version'))
          return createMockProcess({ code: 0, stdout: 'claude 1.0.0' });
        if (cmd === 'claude' && args?.includes('-p'))
          return createMockProcess({ code: 0, stdout: 'OK' });
        // Return garbage output that can't be parsed
        if (cmd === 'powershell') return createMockProcess({ code: 1, stdout: 'garbage' });
        if (cmd === 'wmic') return createMockProcess({ code: 0, stdout: 'no data' });
        return createMockProcess({ code: 0, stdout: 'ok' });
      });

      const mockGit = createMockGit({ isRepo: true });

      await expect(runPreChecks('/fake/project', mockGit)).resolves.toBeUndefined();
    });
  });

  describe('existing branches warning', () => {
    it('logs info when existing NightyTidy branches are found', async () => {
      const { info } = await import('../src/logger.js');

      spawn.mockImplementation((cmd, args) => {
        if (cmd === 'git') return createMockProcess({ code: 0, stdout: 'git version 2.40.0' });
        if (cmd === 'claude' && args?.includes('--version'))
          return createMockProcess({ code: 0, stdout: 'claude 1.0.0' });
        if (cmd === 'claude' && args?.includes('-p'))
          return createMockProcess({ code: 0, stdout: 'OK' });
        if (cmd === 'powershell')
          return createMockProcess({ code: 0, stdout: '50000000000' });
        return createMockProcess({ code: 0, stdout: 'ok' });
      });

      const mockGit = createMockGit({
        isRepo: true,
        branches: ['main', 'nightytidy/run-2026-01-01-0100', 'nightytidy/run-2026-02-01-0200'],
      });

      await runPreChecks('/fake/project', mockGit);

      expect(info).toHaveBeenCalledWith(
        expect.stringContaining('2 existing NightyTidy branch'),
      );
    });

    it('continues gracefully when branch listing fails', async () => {
      spawn.mockImplementation((cmd, args) => {
        if (cmd === 'git') return createMockProcess({ code: 0, stdout: 'git version 2.40.0' });
        if (cmd === 'claude' && args?.includes('--version'))
          return createMockProcess({ code: 0, stdout: 'claude 1.0.0' });
        if (cmd === 'claude' && args?.includes('-p'))
          return createMockProcess({ code: 0, stdout: 'OK' });
        if (cmd === 'powershell')
          return createMockProcess({ code: 0, stdout: '50000000000' });
        return createMockProcess({ code: 0, stdout: 'ok' });
      });

      const mockGit = createMockGit({ isRepo: true });
      mockGit.branch.mockRejectedValue(new Error('git branch failed'));

      // Should NOT throw — branch check is non-critical
      await expect(runPreChecks('/fake/project', mockGit)).resolves.toBeUndefined();
    });
  });

  describe('git --version non-zero exit', () => {
    it('throws when git --version exits with non-zero code', async () => {
      spawn.mockImplementation((cmd) => {
        if (cmd === 'git') return createMockProcess({ code: 1, stdout: '' });
        return createMockProcess({ code: 0, stdout: 'ok' });
      });

      const mockGit = createMockGit();

      await expect(runPreChecks('/fake/project', mockGit)).rejects.toThrow('Git is not installed');
    });
  });

  describe('claude --version non-zero exit', () => {
    it('throws when claude --version exits with non-zero code', async () => {
      spawn.mockImplementation((cmd, args) => {
        if (cmd === 'git') return createMockProcess({ code: 0, stdout: 'git version 2.40.0' });
        if (cmd === 'claude' && args?.includes('--version'))
          return createMockProcess({ code: 1, stdout: '' });
        return createMockProcess({ code: 0, stdout: 'ok' });
      });

      const mockGit = createMockGit({ isRepo: true });

      await expect(runPreChecks('/fake/project', mockGit)).rejects.toThrow('Claude Code not detected');
    });
  });
});
