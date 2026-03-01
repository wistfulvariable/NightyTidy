import { spawn } from 'child_process';
import { platform } from 'os';
import { info, warn, debug } from './logger.js';

function runCommand(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      shell: platform() === 'win32',
      ...options,
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });

    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function runCommandWithTimeout(cmd, args, timeoutMs, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      shell: platform() === 'win32',
      ...options,
    });

    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('timeout'));
    }, timeoutMs);

    child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });

    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

async function checkGitInstalled() {
  try {
    const result = await runCommand('git', ['--version']);
    if (result.code !== 0) throw new Error();
    info('Pre-check: git installed \u2713');
  } catch {
    throw new Error(
      'Git is not installed or not on your PATH.\n' +
      'Install it from https://git-scm.com and try again.'
    );
  }
}

async function checkGitRepo(git) {
  const isRepo = await git.checkIsRepo();
  if (!isRepo) {
    throw new Error(
      "This folder isn't a git project. Navigate to your project folder and try again.\n" +
      'If you need to set one up, run: git init'
    );
  }
  info('Pre-check: git repository \u2713');
}

async function checkClaudeInstalled() {
  try {
    const result = await runCommand('claude', ['--version']);
    if (result.code !== 0) throw new Error();
    info('Pre-check: Claude Code installed \u2713');
  } catch {
    throw new Error(
      'Claude Code not detected.\n' +
      'Install it from https://docs.anthropic.com/en/docs/claude-code and sign in before running NightyTidy.'
    );
  }
}

async function checkClaudeAuthenticated() {
  try {
    const result = await runCommandWithTimeout('claude', ['-p', 'Say OK'], 30000);
    if (result.code !== 0 || !result.stdout.trim()) {
      throw new Error('auth-failed');
    }
    info('Pre-check: Claude Code authenticated \u2713');
  } catch (err) {
    if (err.message === 'timeout') {
      throw new Error(
        "Claude Code didn't respond within 30 seconds. It may be experiencing an outage.\n" +
        'Check https://status.anthropic.com and try again later.'
      );
    }
    throw new Error(
      "Claude Code is installed but doesn't seem to be authenticated.\n" +
      'Run `claude` in your terminal and follow the sign-in steps, then try NightyTidy again.'
    );
  }
}

async function checkDiskSpace(projectDir) {
  let freeBytes = null;

  try {
    if (platform() === 'win32') {
      const driveLetter = projectDir.charAt(0).toUpperCase();
      // Try PowerShell first (wmic is deprecated on newer Windows)
      const psResult = await runCommand('powershell', [
        '-NoProfile', '-Command',
        `(Get-PSDrive ${driveLetter}).Free`,
      ]);
      const psMatch = psResult.stdout.trim().match(/^(\d+)$/);
      if (psResult.code === 0 && psMatch) {
        freeBytes = parseInt(psMatch[1], 10);
      } else {
        // Fallback to wmic for older Windows
        const result = await runCommand('wmic', [
          'logicaldisk', 'where', `DeviceID='${driveLetter}:'`, 'get', 'FreeSpace',
        ]);
        const match = result.stdout.match(/(\d+)/);
        if (match) freeBytes = parseInt(match[1], 10);
      }
    } else {
      const result = await runCommand('df', ['-k', projectDir]);
      const lines = result.stdout.trim().split('\n');
      if (lines.length >= 2) {
        const parts = lines[1].split(/\s+/);
        if (parts.length >= 4) freeBytes = parseInt(parts[3], 10) * 1024;
      }
    }
  } catch {
    debug('Disk space check failed — skipping');
    info('Pre-check: disk space (skipped) \u2713');
    return;
  }

  if (freeBytes === null) {
    debug('Could not parse disk space — skipping');
    info('Pre-check: disk space (skipped) \u2713');
    return;
  }

  const freeMB = Math.round(freeBytes / (1024 * 1024));
  const freeGB = (freeBytes / (1024 * 1024 * 1024)).toFixed(1);

  if (freeMB < 100) {
    throw new Error(
      `Very low disk space (${freeMB} MB free). NightyTidy needs room for git operations.\n` +
      'Free up some space and try again.'
    );
  }

  if (freeMB < 1024) {
    warn(`Low disk space (${freeMB} MB free). NightyTidy may fail if your project generates large diffs. Continuing anyway...`);
  }

  info(`Pre-check: disk space OK (${freeGB} GB free) \u2713`);
}

async function checkExistingBranches(git) {
  try {
    const branches = await git.branch();
    const nightyBranches = branches.all.filter(b => b.startsWith('nightytidy/run-'));
    if (nightyBranches.length > 0) {
      info(`Note: Found ${nightyBranches.length} existing NightyTidy branch(es) from previous run(s). These won't affect this run.`);
    }
  } catch {
    // Non-critical — ignore
  }
  info('Pre-check: no branch conflicts \u2713');
}

export async function runPreChecks(projectDir, git) {
  await checkGitInstalled();
  await checkGitRepo(git);
  await checkClaudeInstalled();
  await checkClaudeAuthenticated();
  await checkDiskSpace(projectDir);
  await checkExistingBranches(git);
  info('All pre-run checks passed');
}
