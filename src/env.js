/**
 * @fileoverview Shared environment helpers for safe subprocess spawning.
 *
 * Uses an explicit allowlist to filter environment variables before passing
 * them to Claude Code subprocesses. This prevents secret leakage and
 * interference from unknown environment variables.
 *
 * @module env
 */

import { debug } from './logger.js';

/**
 * Allowlist of env vars safe to pass to Claude Code subprocess.
 * Blocks CLAUDECODE (prevents subprocess refusing to start when invoked
 * from within a Claude Code session) and any unknown vars that could
 * leak secrets or interfere with subprocess behavior.
 * @type {Set<string>}
 */
const ALLOWED_ENV_VARS = new Set([
  // System paths
  'PATH', 'PATHEXT',
  // Home / user identity
  'HOME', 'USERPROFILE', 'USER', 'USERNAME', 'LOGNAME',
  // Temp directories
  'TEMP', 'TMP', 'TMPDIR',
  // Locale
  'LANG', 'LANGUAGE',
  // Terminal / shell
  'TERM', 'SHELL', 'COMSPEC',
  // Windows system
  'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR',
  'APPDATA', 'LOCALAPPDATA',
  'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMDATA',
  'COMMONPROGRAMFILES', 'COMMONPROGRAMFILES(X86)',
  // Node.js
  'NODE_PATH', 'NODE_EXTRA_CA_CERTS',
  // SSH (for git operations)
  'SSH_AUTH_SOCK', 'SSH_AGENT_PID',
  // Editor
  'EDITOR', 'VISUAL',
  // NightyTidy
  'NIGHTYTIDY_LOG_LEVEL',
]);

/**
 * Prefixes that are allowed for environment variables.
 * @type {string[]}
 */
const ALLOWED_ENV_PREFIXES = [
  'ANTHROPIC_',  // API keys, config
  'CLAUDE_',     // Claude Code config (CLAUDECODE blocked separately below)
  'LC_',         // Locale categories
  'XDG_',        // Linux XDG directories
  'GIT_',        // Git configuration
];

/**
 * Explicitly blocked even if they match a prefix.
 * @type {Set<string>}
 */
const BLOCKED_ENV_VARS = new Set([
  'CLAUDECODE',
]);

/**
 * Create a filtered copy of process.env safe for subprocess spawning.
 *
 * Includes only allowlisted variables and prefixes, logs filtered vars via debug().
 * Safe to call before logger initialization (silently skips logging).
 *
 * @returns {Record<string, string>} Filtered environment variables
 */
export function cleanEnv() {
  const env = {};
  const filtered = [];

  for (const [key, value] of Object.entries(process.env)) {
    if (BLOCKED_ENV_VARS.has(key)) {
      filtered.push(key);
      continue;
    }

    const upperKey = key.toUpperCase();
    if (ALLOWED_ENV_VARS.has(key) || ALLOWED_ENV_VARS.has(upperKey) ||
        ALLOWED_ENV_PREFIXES.some(p => upperKey.startsWith(p))) {
      env[key] = value;
    } else {
      filtered.push(key);
    }
  }

  if (filtered.length > 0) {
    try {
      debug(`cleanEnv filtered ${filtered.length} env var(s): ${filtered.join(', ')}`);
    } catch { /* logger may not be initialized */ }
  }

  return env;
}
