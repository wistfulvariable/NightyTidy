/**
 * @fileoverview Pre-run validation checks for NightyTidy.
 *
 * Error contract: Throws with user-friendly messages on validation failure.
 * All thrown errors are intended to be caught by cli.js and displayed to the user.
 *
 * @module checks
 */

import { spawn } from 'child_process';
import { platform } from 'os';
import { info, debug, warn } from './logger.js';
import { cleanEnv } from './env.js';

/** @typedef {import('simple-git').SimpleGit} SimpleGit */

/**
 * @typedef {Object} CommandResult
 * @property {number|null} code - Exit code
 * @property {string} stdout - Standard output
 * @property {string} stderr - Standard error
 */

/** Timeout for Claude authentication check (ms) */
const AUTH_TIMEOUT_MS = 30000;

/** Critical disk space threshold (MB) - throws error below this */
const CRITICAL_DISK_MB = 100;

/** Low disk space threshold (MB) - warns below this */
const LOW_DISK_MB = 1024;

/**
 * Run a shell command with optional timeout.
 *
 * @param {string} cmd - Command to run
 * @param {string[]} args - Command arguments
 * @param {Object} [options] - Options
 * @param {number} [options.timeoutMs] - Timeout in milliseconds
 * @returns {Promise<CommandResult>} Command result
 */
function runCommand(cmd, args, { timeoutMs, ...spawnOptions } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      shell: platform() === 'win32',
      ...spawnOptions,
    });

    let stdout = '';
    let stderr = '';
    let timer;

    if (timeoutMs) {
      timer = setTimeout(() => {
        child.kill();
        reject(new Error('timeout'));
      }, timeoutMs);
    }

    child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });

    child.on('error', (err) => { if (timer) clearTimeout(timer); reject(err); });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

/**
 * Verify git is installed and available on PATH.
 * @throws {Error} If git is not installed
 */
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

/**
 * Verify the project directory is a git repository.
 * @param {SimpleGit} git - Git instance
 * @throws {Error} If not a git repository
 */
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

/**
 * Verify the repository has at least one commit.
 * @param {SimpleGit} git - Git instance
 * @throws {Error} If no commits exist
 */
async function checkHasCommits(git) {
  try {
    const log = await git.log({ maxCount: 1 });
    if (!log.latest) throw new Error('no commits');
  } catch {
    throw new Error(
      "Your project has no commits yet. NightyTidy needs at least one commit to create a safety tag.\n" +
      'Make an initial commit and try again: git add -A && git commit -m "Initial commit"'
    );
  }
  info('Pre-check: has commits \u2713');
}

/**
 * Verify Claude Code CLI is installed.
 * @throws {Error} If Claude Code is not installed
 */
async function checkClaudeInstalled() {
  try {
    const result = await runCommand('claude', ['--version'], { env: cleanEnv() });
    if (result.code !== 0) throw new Error();
    info('Pre-check: Claude Code installed \u2713');
  } catch {
    throw new Error(
      'Claude Code not detected.\n' +
      'Install it from https://docs.anthropic.com/en/docs/claude-code and sign in before running NightyTidy.'
    );
  }
}

/**
 * Run Claude Code interactively for sign-in with terminal access.
 * @returns {Promise<void>} Resolves on successful auth
 */
function runInteractiveAuth() {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['-p', 'Say OK'], {
      stdio: 'inherit',
      shell: platform() === 'win32',
      env: cleanEnv(),
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`claude exited with code ${code}`));
    });
  });
}

/**
 * Verify Claude Code is authenticated. Falls back to interactive sign-in if needed.
 * @throws {Error} If authentication fails or times out
 */
async function checkClaudeAuthenticated() {
  // First try silently (captured output) — fast path for already-authenticated
  try {
    const result = await runCommand('claude', ['-p', 'Say OK'], {
      timeoutMs: AUTH_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: cleanEnv(),
    });
    if (result.code !== 0 || !result.stdout.trim()) {
      throw new Error('auth-failed');
    }
    info('Pre-check: Claude Code authenticated \u2713');
    return;
  } catch (err) {
    if (err.message === 'timeout') {
      throw new Error(
        "Claude Code didn't respond within 30 seconds. It may be experiencing an outage.\n" +
        'Check https://status.anthropic.com and try again later.'
      );
    }
    // Fall through to interactive sign-in attempt
  }

  // Silent check failed — launch Claude with terminal access for sign-in
  info('Claude Code needs to sign in. Launching sign-in now...');
  try {
    await runInteractiveAuth();
    info('Pre-check: Claude Code authenticated \u2713');
  } catch {
    throw new Error(
      "Claude Code sign-in did not complete successfully.\n" +
      'If this keeps happening, check https://status.anthropic.com for outages.'
    );
  }
}

/**
 * Get free disk space on Windows.
 * @param {string} projectDir - Project directory (to determine drive)
 * @returns {Promise<number|null>} Free bytes or null if unavailable
 */
async function getFreeBytesWindows(projectDir) {
  const driveLetter = projectDir.charAt(0).toUpperCase();
  // Try PowerShell first (wmic is deprecated on newer Windows)
  const psResult = await runCommand('powershell', [
    '-NoProfile', '-Command',
    `(Get-PSDrive ${driveLetter}).Free`,
  ]);
  const psMatch = psResult.stdout.trim().match(/^(\d+)$/);
  if (psResult.code === 0 && psMatch) {
    return parseInt(psMatch[1], 10);
  }
  // Fallback to wmic for older Windows
  const result = await runCommand('wmic', [
    'logicaldisk', 'where', `DeviceID='${driveLetter}:'`, 'get', 'FreeSpace',
  ]);
  const match = result.stdout.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Get free disk space on Unix-like systems.
 * @param {string} projectDir - Project directory
 * @returns {Promise<number|null>} Free bytes or null if unavailable
 */
async function getFreeBytesUnix(projectDir) {
  const result = await runCommand('df', ['-k', projectDir]);
  const lines = result.stdout.trim().split('\n');
  if (lines.length >= 2) {
    const parts = lines[1].split(/\s+/);
    if (parts.length >= 4) return parseInt(parts[3], 10) * 1024;
  }
  return null;
}

/**
 * Get free disk space for the project directory.
 * @param {string} projectDir - Project directory
 * @returns {Promise<number|null>} Free bytes or null if unavailable
 */
async function getFreeBytes(projectDir) {
  return platform() === 'win32'
    ? getFreeBytesWindows(projectDir)
    : getFreeBytesUnix(projectDir);
}

/**
 * Check available disk space. Throws on critical low, warns on low.
 * @param {string} projectDir - Project directory
 * @throws {Error} If disk space is critically low
 */
async function checkDiskSpace(projectDir) {
  let freeBytes = null;

  try {
    freeBytes = await getFreeBytes(projectDir);
  } catch (err) {
    debug(`Disk space check failed (${err.code || err.message}) — skipping`);
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

  if (freeMB < CRITICAL_DISK_MB) {
    throw new Error(
      `Very low disk space (${freeMB} MB free). NightyTidy needs room for git operations.\n` +
      'Free up some space and try again.'
    );
  }

  if (freeMB < LOW_DISK_MB) {
    warn(`Low disk space (${freeMB} MB free). NightyTidy may fail if your project generates large diffs. Continuing anyway...`);
  }

  info(`Pre-check: disk space OK (${freeGB} GB free) \u2713`);
}

/**
 * Check for uncommitted changes and warn if present.
 * Non-critical check that never throws.
 * @param {SimpleGit} git - Git instance
 */
async function checkCleanWorkingTree(git) {
  try {
    const status = await git.status();
    const dirtyCount = status.modified.length + status.not_added.length +
      status.deleted.length + status.renamed.length + status.staged.length;
    if (dirtyCount > 0) {
      warn(
        `You have ${dirtyCount} uncommitted change(s). NightyTidy will carry these to the run branch. ` +
        'If you undo the run later with git reset --hard, uncommitted changes will be lost. ' +
        'Consider committing or stashing your work first.'
      );
    } else {
      info('Pre-check: clean working tree \u2713');
    }
  } catch (err) {
    // Non-critical — skip silently
    debug(`Working tree check failed (${err.message}) — skipping`);
  }
}

/**
 * Check for existing NightyTidy branches from previous runs.
 * Non-critical informational check that never throws.
 * @param {SimpleGit} git - Git instance
 */
async function checkExistingBranches(git) {
  try {
    const branches = await git.branch();
    const nightyBranches = branches.all.filter(b => b.startsWith('nightytidy/run-'));
    if (nightyBranches.length > 0) {
      info(`Note: Found ${nightyBranches.length} existing NightyTidy branch(es) from previous run(s). These won't affect this run.`);
    }
  } catch (err) {
    debug(`Branch check failed (${err.message}) — skipping`);
  }
  info('Pre-check: no branch conflicts \u2713');
}

/**
 * Run all pre-flight validation checks.
 *
 * Checks are run in an optimized order:
 * 1. Git installed (must pass before any git operations)
 * 2. Parallel checks: git chain, Claude chain, disk space
 *
 * @param {string} projectDir - Project directory
 * @param {SimpleGit} git - Git instance
 * @throws {Error} If any critical check fails
 */
export async function runPreChecks(projectDir, git) {
  // Phase 1: git-installed must pass before any git operations
  await checkGitInstalled();

  // Phase 2: Run independent check groups in parallel for faster perceived startup.
  // - Git chain: repo -> commits -> branches (sequential, each depends on the prior)
  // - Claude chain: installed -> authenticated (sequential dependency)
  // - Disk space: fully independent
  const gitChain = async () => {
    await checkGitRepo(git);
    await checkHasCommits(git);
    await checkCleanWorkingTree(git);
    await checkExistingBranches(git);
  };
  const claudeChain = async () => {
    await checkClaudeInstalled();
    await checkClaudeAuthenticated();
  };

  await Promise.all([
    gitChain(),
    claudeChain(),
    checkDiskSpace(projectDir),
  ]);

  info('All pre-run checks passed');
}
