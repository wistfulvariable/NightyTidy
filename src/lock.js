import { readFileSync, writeFileSync, unlinkSync, openSync, closeSync } from 'fs';
import path from 'path';
import { warn } from './logger.js';

const LOCK_FILENAME = 'nightytidy.lock';

function writeLockFile(lockPath, content) {
  const fd = openSync(lockPath, 'wx');
  writeFileSync(fd, content);
  closeSync(fd);
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function acquireLock(projectDir) {
  const lockPath = path.join(projectDir, LOCK_FILENAME);
  const lockContent = JSON.stringify({ pid: process.pid, started: new Date().toISOString() });

  // Try atomic create — O_WRONLY | O_CREAT | O_EXCL ('wx') fails if file exists
  try {
    writeLockFile(lockPath, lockContent);
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;

    // Lock file exists — check if the owning process is still alive
    try {
      const lockData = JSON.parse(readFileSync(lockPath, 'utf8'));
      if (lockData.pid && isProcessAlive(lockData.pid)) {
        throw new Error(
          `Another NightyTidy run is already in progress (PID ${lockData.pid}, started ${lockData.started}).\n` +
          `If this is wrong, delete ${LOCK_FILENAME} and try again.`
        );
      }
    } catch (readErr) {
      if (readErr.message.includes('already in progress')) throw readErr;
      // Corrupt lock file — treat as stale
    }

    // Stale lock — remove and retry atomically
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

  // Auto-remove on any exit
  process.on('exit', () => {
    try { unlinkSync(lockPath); } catch { /* already gone */ }
  });
}
