import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('os', () => ({
  platform: vi.fn(() => 'win32'),
}));

import { createLoggerMock, createMockProcess, createErrorProcess, createTimeoutProcess, createMockGit } from './helpers/mocks.js';

vi.mock('../src/logger.js', () => createLoggerMock());

import { spawn } from 'child_process';
import { platform } from 'os';
import { runPreChecks } from '../src/checks.js';

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
  describe('empty repo (no commits)', () => {
    it('throws when repo has no commits', async () => {
      mockSpawnForChecks();

      const mockGit = createMockGit({ isRepo: true, hasCommits: false });

      await expect(runPreChecks('/fake/project', mockGit)).rejects.toThrow(
        'no commits yet'
      );
    });

    it('passes when repo has at least one commit', async () => {
      mockSpawnForChecks();

      const mockGit = createMockGit({ isRepo: true, hasCommits: true });

      await expect(runPreChecks('/fake/project', mockGit)).resolves.toBeUndefined();
    });
  });

  describe('Claude authentication', () => {
    it('throws when both silent and interactive auth fail (non-zero exit, empty stdout)', async () => {
      // Every claude -p call returns non-zero exit + empty stdout → both auth paths fail
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
        'sign-in did not complete successfully'
      );
    });

    it('recovers when silent auth fails but interactive sign-in succeeds', async () => {
      let claudeCallCount = 0;
      spawn.mockImplementation((cmd, args) => {
        if (cmd === 'git') return createMockProcess({ code: 0, stdout: 'git version 2.40.0' });
        if (cmd === 'claude' && args?.includes('--version'))
          return createMockProcess({ code: 0, stdout: 'claude 1.0.0' });
        if (cmd === 'claude' && args?.includes('-p')) {
          claudeCallCount++;
          // First call (silent) fails, second call (interactive) succeeds
          if (claudeCallCount === 1) return createMockProcess({ code: 1, stdout: '' });
          return createMockProcess({ code: 0, stdout: 'OK' });
        }
        if (cmd === 'powershell')
          return createMockProcess({ code: 0, stdout: '50000000000' });
        return createMockProcess({ code: 0, stdout: 'ok' });
      });

      const mockGit = createMockGit({ isRepo: true });

      // Should NOT throw — interactive sign-in recovered
      await expect(runPreChecks('/fake/project', mockGit)).resolves.toBeUndefined();
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

    it('warns but continues when disk space is low but not critical (100-1024 MB)', async () => {
      const { warn } = await import('../src/logger.js');

      spawn.mockImplementation((cmd, args) => {
        if (cmd === 'git') return createMockProcess({ code: 0, stdout: 'git version 2.40.0' });
        if (cmd === 'claude' && args?.includes('--version'))
          return createMockProcess({ code: 0, stdout: 'claude 1.0.0' });
        if (cmd === 'claude' && args?.includes('-p'))
          return createMockProcess({ code: 0, stdout: 'OK' });
        // 500 MB = 524288000 bytes (between CRITICAL 100MB and LOW 1024MB)
        if (cmd === 'powershell')
          return createMockProcess({ code: 0, stdout: '524288000' });
        if (cmd === 'wmic')
          return createMockProcess({ code: 0, stdout: 'FreeSpace\n524288000\n' });
        if (cmd === 'df')
          return createMockProcess({ code: 0, stdout: 'Filesystem 1K-blocks Used Available\n/dev/sda1 100000000 99488000 512000' });
        return createMockProcess({ code: 0, stdout: 'ok' });
      });

      const mockGit = createMockGit({ isRepo: true });

      // Should NOT throw — low disk is a warning, not a failure
      await expect(runPreChecks('/fake/project', mockGit)).resolves.toBeUndefined();

      // Should warn about low disk space
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Low disk space'));
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

  describe('dirty working tree warning', () => {
    it('warns when there are uncommitted changes', async () => {
      const { warn } = await import('../src/logger.js');

      mockSpawnForChecks();

      const mockGit = createMockGit({
        isRepo: true,
        status: { modified: ['file1.js', 'file2.js'], not_added: [], deleted: [], renamed: [], staged: ['file3.js'] },
      });

      await runPreChecks('/fake/project', mockGit);

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('3 uncommitted change(s)')
      );
    });

    it('does not warn when working tree is clean', async () => {
      const { warn } = await import('../src/logger.js');

      mockSpawnForChecks();

      const mockGit = createMockGit({ isRepo: true });

      await runPreChecks('/fake/project', mockGit);

      expect(warn).not.toHaveBeenCalledWith(
        expect.stringContaining('uncommitted change')
      );
    });

    it('continues gracefully when status check fails', async () => {
      mockSpawnForChecks();

      const mockGit = createMockGit({ isRepo: true });
      mockGit.status.mockRejectedValue(new Error('git status failed'));

      // Should NOT throw — working tree check is non-critical
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

  // -----------------------------------------------------------------------
  // Characterization tests for checkDiskSpace() — exercises platform paths
  // -----------------------------------------------------------------------
  describe('checkDiskSpace — Windows paths', () => {
    beforeEach(() => {
      platform.mockReturnValue('win32');
    });

    it('parses PowerShell output with leading/trailing whitespace', async () => {
      const { info } = await import('../src/logger.js');

      spawn.mockImplementation((cmd, args) => {
        if (cmd === 'git') return createMockProcess({ code: 0, stdout: 'git version 2.40.0' });
        if (cmd === 'claude' && args?.includes('--version'))
          return createMockProcess({ code: 0, stdout: 'claude 1.0.0' });
        if (cmd === 'claude' && args?.includes('-p'))
          return createMockProcess({ code: 0, stdout: 'OK' });
        // PowerShell output with whitespace around the number
        if (cmd === 'powershell')
          return createMockProcess({ code: 0, stdout: '  \n50000000000\n  ' });
        return createMockProcess({ code: 0, stdout: 'ok' });
      });

      const mockGit = createMockGit({ isRepo: true });
      await runPreChecks('C:\\project', mockGit);

      expect(info).toHaveBeenCalledWith(expect.stringContaining('disk space OK'));
    });

    it('falls back to wmic when PowerShell returns non-zero exit code', async () => {
      const { info } = await import('../src/logger.js');

      spawn.mockImplementation((cmd, args) => {
        if (cmd === 'git') return createMockProcess({ code: 0, stdout: 'git version 2.40.0' });
        if (cmd === 'claude' && args?.includes('--version'))
          return createMockProcess({ code: 0, stdout: 'claude 1.0.0' });
        if (cmd === 'claude' && args?.includes('-p'))
          return createMockProcess({ code: 0, stdout: 'OK' });
        // PowerShell fails
        if (cmd === 'powershell')
          return createMockProcess({ code: 1, stdout: '' });
        // wmic provides the data
        if (cmd === 'wmic')
          return createMockProcess({ code: 0, stdout: 'FreeSpace\n50000000000\n' });
        return createMockProcess({ code: 0, stdout: 'ok' });
      });

      const mockGit = createMockGit({ isRepo: true });
      await runPreChecks('C:\\project', mockGit);

      expect(info).toHaveBeenCalledWith(expect.stringContaining('disk space OK'));
    });

    it('returns null when both PowerShell and wmic output are unparseable', async () => {
      const { info } = await import('../src/logger.js');

      spawn.mockImplementation((cmd, args) => {
        if (cmd === 'git') return createMockProcess({ code: 0, stdout: 'git version 2.40.0' });
        if (cmd === 'claude' && args?.includes('--version'))
          return createMockProcess({ code: 0, stdout: 'claude 1.0.0' });
        if (cmd === 'claude' && args?.includes('-p'))
          return createMockProcess({ code: 0, stdout: 'OK' });
        // Both Windows commands return garbage
        if (cmd === 'powershell')
          return createMockProcess({ code: 1, stdout: 'error text' });
        if (cmd === 'wmic')
          return createMockProcess({ code: 0, stdout: 'No instances available.' });
        return createMockProcess({ code: 0, stdout: 'ok' });
      });

      const mockGit = createMockGit({ isRepo: true });
      // Should not throw — null bytes => skip
      await expect(runPreChecks('C:\\project', mockGit)).resolves.toBeUndefined();
      expect(info).toHaveBeenCalledWith(expect.stringContaining('disk space (skipped)'));
    });

    it('throws when zero bytes free on Windows', async () => {
      spawn.mockImplementation((cmd, args) => {
        if (cmd === 'git') return createMockProcess({ code: 0, stdout: 'git version 2.40.0' });
        if (cmd === 'claude' && args?.includes('--version'))
          return createMockProcess({ code: 0, stdout: 'claude 1.0.0' });
        if (cmd === 'claude' && args?.includes('-p'))
          return createMockProcess({ code: 0, stdout: 'OK' });
        if (cmd === 'powershell')
          return createMockProcess({ code: 0, stdout: '0' });
        return createMockProcess({ code: 0, stdout: 'ok' });
      });

      const mockGit = createMockGit({ isRepo: true });
      await expect(runPreChecks('C:\\project', mockGit)).rejects.toThrow('Very low disk space');
    });
  });

  describe('checkDiskSpace — Unix paths', () => {
    beforeEach(() => {
      platform.mockReturnValue('linux');
    });

    it('parses df output with standard columns', async () => {
      const { info } = await import('../src/logger.js');

      spawn.mockImplementation((cmd, args) => {
        if (cmd === 'git') return createMockProcess({ code: 0, stdout: 'git version 2.40.0' });
        if (cmd === 'claude' && args?.includes('--version'))
          return createMockProcess({ code: 0, stdout: 'claude 1.0.0' });
        if (cmd === 'claude' && args?.includes('-p'))
          return createMockProcess({ code: 0, stdout: 'OK' });
        // df -k output: Available column (4th) is in 1K-blocks
        if (cmd === 'df')
          return createMockProcess({ code: 0, stdout: 'Filesystem 1K-blocks Used Available Use%\n/dev/sda1 100000000 50000000 50000000 50%' });
        return createMockProcess({ code: 0, stdout: 'ok' });
      });

      const mockGit = createMockGit({ isRepo: true });
      await runPreChecks('/project', mockGit);

      expect(info).toHaveBeenCalledWith(expect.stringContaining('disk space OK'));
    });

    it('skips when df output has fewer than 2 lines', async () => {
      const { info } = await import('../src/logger.js');

      spawn.mockImplementation((cmd, args) => {
        if (cmd === 'git') return createMockProcess({ code: 0, stdout: 'git version 2.40.0' });
        if (cmd === 'claude' && args?.includes('--version'))
          return createMockProcess({ code: 0, stdout: 'claude 1.0.0' });
        if (cmd === 'claude' && args?.includes('-p'))
          return createMockProcess({ code: 0, stdout: 'OK' });
        // df returns only a header, no data line
        if (cmd === 'df')
          return createMockProcess({ code: 0, stdout: 'Filesystem 1K-blocks Used Available' });
        return createMockProcess({ code: 0, stdout: 'ok' });
      });

      const mockGit = createMockGit({ isRepo: true });
      await expect(runPreChecks('/project', mockGit)).resolves.toBeUndefined();
      expect(info).toHaveBeenCalledWith(expect.stringContaining('disk space (skipped)'));
    });
  });

  describe('checkDiskSpace — boundary values', () => {
    beforeEach(() => {
      platform.mockReturnValue('win32');
    });

    it('does not throw at exactly 100MB (boundary of CRITICAL_DISK_MB)', async () => {
      const { warn } = await import('../src/logger.js');

      // 100 MB = 104857600 bytes. freeMB = Math.round(104857600 / 1048576) = 100
      // 100 is NOT < 100, so no critical error. But 100 < 1024, so low disk warning.
      spawn.mockImplementation((cmd, args) => {
        if (cmd === 'git') return createMockProcess({ code: 0, stdout: 'git version 2.40.0' });
        if (cmd === 'claude' && args?.includes('--version'))
          return createMockProcess({ code: 0, stdout: 'claude 1.0.0' });
        if (cmd === 'claude' && args?.includes('-p'))
          return createMockProcess({ code: 0, stdout: 'OK' });
        if (cmd === 'powershell')
          return createMockProcess({ code: 0, stdout: '104857600' });
        return createMockProcess({ code: 0, stdout: 'ok' });
      });

      const mockGit = createMockGit({ isRepo: true });
      // Should NOT throw — exactly at boundary
      await expect(runPreChecks('C:\\project', mockGit)).resolves.toBeUndefined();
      // But should warn (100 < 1024)
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Low disk space'));
    });

    it('does not warn at exactly 1024MB (boundary of LOW_DISK_MB)', async () => {
      const { warn, info } = await import('../src/logger.js');

      // 1024 MB = 1073741824 bytes. freeMB = 1024. 1024 is NOT < 1024. No warning.
      spawn.mockImplementation((cmd, args) => {
        if (cmd === 'git') return createMockProcess({ code: 0, stdout: 'git version 2.40.0' });
        if (cmd === 'claude' && args?.includes('--version'))
          return createMockProcess({ code: 0, stdout: 'claude 1.0.0' });
        if (cmd === 'claude' && args?.includes('-p'))
          return createMockProcess({ code: 0, stdout: 'OK' });
        if (cmd === 'powershell')
          return createMockProcess({ code: 0, stdout: '1073741824' });
        return createMockProcess({ code: 0, stdout: 'ok' });
      });

      const mockGit = createMockGit({ isRepo: true });
      await runPreChecks('C:\\project', mockGit);

      expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('Low disk space'));
      expect(info).toHaveBeenCalledWith(expect.stringContaining('disk space OK'));
    });
  });
});
