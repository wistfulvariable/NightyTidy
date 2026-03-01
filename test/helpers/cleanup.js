import { rm } from 'fs/promises';

/**
 * Robustly removes a temporary directory with retry logic.
 *
 * On Windows, git processes may hold file handles briefly after operations
 * complete, causing EBUSY/EPERM errors when attempting immediate deletion.
 * This helper retries with a short delay to handle these transient locks.
 *
 * @param {string} dirPath - Absolute path to the directory to remove
 * @param {number} [maxAttempts=5] - Maximum number of cleanup attempts
 * @param {number} [delayMs=200] - Delay between attempts in milliseconds
 */
export async function robustCleanup(dirPath, maxAttempts = 5, delayMs = 200) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await rm(dirPath, { recursive: true, force: true });
      return;
    } catch (err) {
      const isTransient = err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'ENOTEMPTY';
      if (attempt < maxAttempts && isTransient) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      // Final attempt or non-transient error — swallow to avoid crashing the test runner.
      // The OS temp directory will be cleaned up eventually.
      if (isTransient) return;
      throw err;
    }
  }
}
