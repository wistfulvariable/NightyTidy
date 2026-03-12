/**
 * @fileoverview Atomic lock file to prevent concurrent NightyTidy runs.
 *
 * Error contract: Throws with user-friendly messages on lock acquisition failure.
 * Uses O_EXCL (exclusive create) for atomic lock file creation to prevent TOCTOU races.
 *
 * @module lock
 */

import { readFileSync, writeFileSync, unlinkSync, openSync, closeSync } from 'fs';
import { createInterface } from 'readline';
import path from 'path';
import { debug, warn } from './logger.js';

/**
 * @typedef {Object} LockData
 * @property {number} [pid] - Process ID of lock holder
 * @property {string} [started] - ISO timestamp when lock was acquired
 */

/** Lock file name in project directory */
const LOCK_FILENAME = 'nightytidy.lock';

/** Maximum lock age before treating as stale (24 hours) */
const MAX_LOCK_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Write lock file atomically using O_EXCL to prevent TOCTOU races.
 * @param {string} lockPath - Path to lock file
 * @param {string} content - JSON content to write
 * @throws {Error} If file already exists (EEXIST) or write fails
 */
function writeLockFile(lockPath, content) {
  const fd = openSync(lockPath, 'wx');
  writeFileSync(fd, content);
  closeSync(fd);
}

/**
 * Check if a process with the given PID is still running.
 * @param {number} pid - Process ID to check
 * @returns {boolean} True if process is alive
 */
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Determine if a lock is stale (can be safely removed).
 * A lock is stale if: the holding process is dead, or the lock is older than 24 hours.
 *
 * @param {LockData} lockData - Parsed lock file content
 * @returns {boolean} True if lock is stale
 */
function isLockStale(lockData) {
  // Process is dead — definitely stale
  if (!lockData.pid || !isProcessAlive(lockData.pid)) return true;

  // Lock is older than 24 hours — treat as stale regardless of PID
  // (handles PID recycling on Windows where process.kill(pid,0) is unreliable)
  if (lockData.started) {
    const age = Date.now() - new Date(lockData.started).getTime();
    if (age > MAX_LOCK_AGE_MS) return true;
  }

  return false;
}

/**
 * Prompt user to override an active lock (TTY only).
 * @param {LockData} lockData - Parsed lock file content
 * @returns {Promise<boolean>} True if user confirms override
 * @throws {Error} If not in TTY (non-interactive mode)
 */
function promptOverride(lockData) {
  if (!process.stdin.isTTY) {
    const pid = lockData.pid || 'unknown';
    const started = lockData.started || 'unknown time';
    throw new Error(
      `Another NightyTidy run is already in progress (PID ${pid}, started ${started}).\n` +
      `If this is wrong, delete ${LOCK_FILENAME} and try again.`
    );
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const pid = lockData.pid || 'unknown';
  const started = lockData.started || 'unknown time';
  return new Promise((resolve) => {
    rl.question(
      `A lock file exists (PID ${pid}, started ${started}). Override it? [y/N] `,
      (answer) => {
        rl.close();
        resolve(answer.trim().toLowerCase() === 'y');
      },
    );
  });
}

/**
 * Remove a stale lock file and immediately re-acquire it.
 * @param {string} lockPath - Path to lock file
 * @param {string} lockContent - New lock content to write
 * @throws {Error} If another process acquires the lock during cleanup
 */
function removeLockAndReacquire(lockPath, lockContent) {
  unlinkSync(lockPath);
  warn('Removed stale lock file from a previous run');
  try {
    writeLockFile(lockPath, lockContent);
  } catch (retryErr) {
    if (retryErr.code === 'EEXIST') {
      throw new Error(
        'Another NightyTidy run acquired the lock while cleaning up a stale lock file.\n' +
        `If this is wrong, delete ${LOCK_FILENAME} and try again.`
      );
    }
    throw retryErr;
  }
}

/**
 * Release the lock file for a project.
 * Safe to call even if lock doesn't exist.
 * @param {string} projectDir - Project directory containing lock
 */
export function releaseLock(projectDir) {
  const lockPath = path.join(projectDir, LOCK_FILENAME);
  try { unlinkSync(lockPath); } catch { /* already gone */ }
}

/**
 * Acquire a lock file to prevent concurrent runs.
 *
 * If a lock file exists, checks if it's stale (dead process or >24h old).
 * For active locks in TTY mode, prompts user to override.
 *
 * @param {string} projectDir - Project directory
 * @param {Object} [options] - Options
 * @param {boolean} [options.persistent=false] - If true, don't auto-remove on exit (for orchestrator mode)
 * @throws {Error} If lock cannot be acquired
 */
export async function acquireLock(projectDir, { persistent = false } = {}) {
  const lockPath = path.join(projectDir, LOCK_FILENAME);
  const lockContent = JSON.stringify({ pid: process.pid, started: new Date().toISOString() });

  // Try atomic create — O_WRONLY | O_CREAT | O_EXCL ('wx') fails if file exists
  try {
    writeLockFile(lockPath, lockContent);
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;

    // Lock file exists — check staleness
    let lockData = {};
    try {
      lockData = JSON.parse(readFileSync(lockPath, 'utf8'));
    } catch {
      // Corrupt lock file — treat as stale
    }

    if (isLockStale(lockData)) {
      removeLockAndReacquire(lockPath, lockContent);
    } else {
      // Lock appears active — prompt user for override
      const override = await promptOverride(lockData);
      if (!override) {
        throw new Error('NightyTidy run cancelled — lock file was not overridden.');
      }
      removeLockAndReacquire(lockPath, lockContent);
      warn('Lock file overridden by user');
    }
  }

  debug(`Lock acquired (PID ${process.pid})`);

  // Auto-remove on any exit (skip in persistent mode for orchestrator)
  if (!persistent) {
    process.on('exit', () => {
      try { unlinkSync(lockPath); } catch { /* already gone */ }
    });
  }
}
