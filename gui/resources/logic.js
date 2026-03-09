/**
 * NightyTidy GUI — Pure logic functions (no Neutralino or DOM dependencies).
 * Exported via window.NtLogic for use by app.js and for unit testing.
 */

/**
 * Build a shell command that cd's into the project dir then runs nightytidy.
 * @param {string} projectDir - Absolute path to target project
 * @param {string} args - CLI arguments (e.g. '--list --json')
 * @param {string} [platform] - 'Windows', 'Linux', or 'Darwin'
 * @param {string} [binPath] - Absolute path to bin/nightytidy.js (uses npx fallback if omitted)
 * @returns {string} Full shell command
 */
function buildCommand(projectDir, args, platform, binPath) {
  const os = platform || 'Windows';
  const cmd = binPath ? `node "${binPath}"` : 'npx nightytidy';
  if (os === 'Windows') {
    return `cd /d "${projectDir}" && ${cmd} ${args}`;
  }
  return `cd "${projectDir}" && ${cmd} ${args}`;
}

/**
 * Extract JSON from CLI stdout buffer. The orchestrator outputs a single JSON
 * line to stdout. Other output (warnings, logs) may precede it.
 * @param {string} stdout - Raw stdout buffer
 * @returns {{ ok: boolean, data: any, error: string|null }}
 */
function parseCliOutput(stdout) {
  if (!stdout || typeof stdout !== 'string') {
    return { ok: false, data: null, error: 'No output received from CLI' };
  }

  const trimmed = stdout.trim();
  if (!trimmed) {
    return { ok: false, data: null, error: 'Empty output from CLI' };
  }

  // Try the whole output first (common case: single JSON line)
  try {
    return { ok: true, data: JSON.parse(trimmed), error: null };
  } catch {
    // Fall through — try last line
  }

  // Try the last non-empty line (JSON may follow warnings)
  const lines = trimmed.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      return { ok: true, data: JSON.parse(line), error: null };
    } catch {
      continue;
    }
  }

  return { ok: false, data: null, error: 'Could not parse JSON from CLI output' };
}

/**
 * Format milliseconds into human-readable duration.
 * @param {number} ms
 * @returns {string} e.g. '2h 15m 30s', '45m 12s', '8s'
 */
function formatMs(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return '0s';

  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;

  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/**
 * Escape HTML special characters for safe DOM insertion.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Determine the next step to run from the selected steps list.
 * @param {number[]} selected - All selected step numbers
 * @param {number[]} completed - Step numbers already completed
 * @param {number[]} failed - Step numbers that failed
 * @returns {number|null} Next step number, or null if all done
 */
function getNextStep(selected, completed, failed) {
  if (!selected || !selected.length) return null;
  const done = new Set([...(completed || []), ...(failed || [])]);
  for (const step of selected) {
    if (!done.has(step)) return step;
  }
  return null;
}

/**
 * Build step args string from selected step numbers.
 * @param {number[]} selectedSteps
 * @param {number} totalSteps - Total number of available steps
 * @returns {string} e.g. '--all' or '--steps 1,5,12'
 */
function buildStepArgs(selectedSteps, totalSteps) {
  if (selectedSteps.length === totalSteps) {
    return '--all';
  }
  return `--steps ${selectedSteps.join(',')}`;
}

/**
 * Format a cost in USD to a display string.
 * @param {number|null|undefined} costUSD
 * @returns {string|null} e.g. '$0.1234', or null if no cost data
 */
function formatCost(costUSD) {
  if (costUSD === null || costUSD === undefined || !Number.isFinite(costUSD)) return null;
  return '$' + costUSD.toFixed(4);
}

/**
 * Detect git-related errors from CLI error messages.
 * Returns 'no-repo' | 'no-commits' | null.
 * @param {string} errorMsg
 * @returns {string|null}
 */
function detectGitError(errorMsg) {
  if (!errorMsg || typeof errorMsg !== 'string') return null;
  if (errorMsg.includes("isn't a git project") || errorMsg.includes('not a git repository')) return 'no-repo';
  if (errorMsg.includes('no commits yet') || errorMsg.includes('has no commits')) return 'no-commits';
  return null;
}

/**
 * Detect a stale run-state error (previous run was interrupted).
 * @param {string} errorMsg
 * @returns {boolean}
 */
function detectStaleState(errorMsg) {
  if (!errorMsg || typeof errorMsg !== 'string') return false;
  return errorMsg.includes('already in progress') || errorMsg.includes('run-state.json');
}

// Export for browser (app.js) and for Node.js tests
const NtLogic = {
  buildCommand,
  parseCliOutput,
  formatMs,
  formatCost,
  escapeHtml,
  getNextStep,
  buildStepArgs,
  detectGitError,
  detectStaleState,
};

// Browser: attach to window. Node.js: attach to globalThis.
// Tests use globalThis.NtLogic to access functions.
if (typeof globalThis !== 'undefined') {
  globalThis.NtLogic = NtLogic;
}
