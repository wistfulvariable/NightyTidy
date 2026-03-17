import { spawn, execFileSync } from 'child_process';
import { platform } from 'os';
import { info, debug, warn, error as logError } from './logger.js';
import { cleanEnv } from './env.js';

/**
 * @fileoverview Claude Code subprocess wrapper.
 *
 * Spawns Claude Code CLI as a subprocess with retry logic, timeout handling,
 * and error classification. This module never throws — it always returns
 * result objects.
 *
 * Error contract: Returns { success, output, error, exitCode, duration, attempts, cost, errorType, retryAfterMs }
 */

/** @typedef {'rate_limit' | 'unknown'} ErrorType */

/**
 * @typedef {Object} CostData
 * @property {number|null} costUSD - Total cost in USD
 * @property {number|null} inputTokens - Total input tokens (including cache)
 * @property {number|null} outputTokens - Total output tokens
 * @property {number|null} numTurns - Number of conversation turns
 * @property {number|null} durationApiMs - API call duration in milliseconds
 * @property {string|null} sessionId - Claude session ID for --continue
 */

/**
 * @typedef {Object} RunPromptResult
 * @property {boolean} success - Whether the prompt completed successfully
 * @property {string} output - Claude's response text (empty string if failed)
 * @property {string|null} error - Error message if failed, null if success
 * @property {number} exitCode - Process exit code (-1 for internal errors)
 * @property {number} duration - Total duration in milliseconds
 * @property {number} attempts - Number of attempts made (1 + retries)
 * @property {CostData|null} cost - Cost and token usage data
 * @property {ErrorType} [errorType] - Type of error (rate_limit or unknown)
 * @property {number|null} [retryAfterMs] - Suggested retry delay for rate limits
 */

/**
 * @typedef {Object} RunPromptOptions
 * @property {number} [timeout] - Timeout per attempt in milliseconds (default: 45 min)
 * @property {number} [retries] - Number of retry attempts (default: 3)
 * @property {string} [label] - Human-readable label for logging
 * @property {AbortSignal} [signal] - Abort signal for cancellation
 * @property {boolean} [continueSession] - Use --continue flag for session continuity
 * @property {(chunk: string) => void} [onOutput] - Callback for streaming output
 * @property {number} [inactivityTimeout] - Max silence per attempt in ms (default: 5 min; 0 disables)
 */

const DEFAULT_TIMEOUT = 45 * 60 * 1000; // 45 minutes
const DEFAULT_RETRIES = 3;
const RETRY_DELAY = 10000; // 10 seconds
const SIGKILL_DELAY = 5000; // grace period before SIGKILL after initial kill
export const INACTIVITY_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes — no stdout or stderr data

// ── Rate-limit error classification ─────────────────────────────────

/**
 * Error type constants for classification.
 * @type {Readonly<{RATE_LIMIT: 'rate_limit', UNKNOWN: 'unknown'}>}
 */
export const ERROR_TYPE = Object.freeze({
  RATE_LIMIT: 'rate_limit',
  UNKNOWN: 'unknown',
});

const RATE_LIMIT_PATTERNS = [
  /429/i,
  /rate.?limit/i,
  /quota/i,
  /exceeded/i,
  /overloaded/i,
  /capacity/i,
  /too many requests/i,
  /usage.?limit/i,
  /throttl/i,
  /billing/i,
  /plan.?limit/i,
];

const RETRY_AFTER_PATTERN = /retry.?after[:\s]+(\d+)/i;

/**
 * @typedef {Object} ErrorClassification
 * @property {ErrorType} type - The error type (rate_limit or unknown)
 * @property {number|null} retryAfterMs - Suggested retry delay in ms, or null
 */

/**
 * Classify a Claude Code subprocess error based on stderr content.
 *
 * @param {string} stderr - Stderr output from the subprocess
 * @param {number} exitCode - Process exit code (unused but kept for future use)
 * @returns {ErrorClassification} Classification with type and retry delay
 */
export function classifyError(stderr, exitCode) {
  if (!stderr) return { type: ERROR_TYPE.UNKNOWN, retryAfterMs: null };
  const isRateLimit = RATE_LIMIT_PATTERNS.some(p => p.test(stderr));
  if (isRateLimit) {
    const match = stderr.match(RETRY_AFTER_PATTERN);
    const retryAfterMs = match ? parseInt(match[1], 10) * 1000 : null;
    return { type: ERROR_TYPE.RATE_LIMIT, retryAfterMs };
  }
  return { type: ERROR_TYPE.UNKNOWN, retryAfterMs: null };
}

/**
 * Force-kill a child process, including its entire process tree.
 *
 * On Windows with shell: true, child.kill() only terminates the cmd.exe
 * shell — the underlying process tree (claude, node, chrome, etc.)
 * survives as orphans. We use `taskkill /F /T` to kill the full tree.
 *
 * @param {import('child_process').ChildProcess} child - The child process to kill
 * @returns {void}
 */
function forceKillChild(child) {
  if (platform() === 'win32') {
    try {
      execFileSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], {
        stdio: 'ignore',
        timeout: 5000,
      });
    } catch {
      // taskkill failed (process already dead or permissions issue).
      // Fall back to Node's child.kill() which at least kills cmd.exe.
      try { child.kill(); } catch { /* already dead */ }
    }
  } else {
    child.kill();
    const killTimer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* already dead */ }
    }, SIGKILL_DELAY);
    killTimer.unref();
  }
}

/**
 * Generate a human-readable timeout error message.
 *
 * @param {number} ms - Timeout duration in milliseconds
 * @returns {string} Error message
 */
function timeoutMessage(ms) {
  const minutes = Math.round(ms / 60000);
  return `Claude Code timed out after ${minutes} minutes`;
}

/**
 * Generate a human-readable inactivity timeout error message.
 *
 * @param {number} ms - Inactivity timeout duration in milliseconds
 * @returns {string} Error message
 */
function inactivityMessage(ms) {
  const minutes = Math.round(ms / 60000);
  return `Claude Code stalled — no output for ${minutes} minutes`;
}

/**
 * Sleep for a given duration, with optional abort signal support.
 *
 * @param {number} ms - Duration to sleep in milliseconds
 * @param {AbortSignal} [signal] - Optional abort signal to cancel sleep early
 * @returns {Promise<void>} Resolves when sleep completes or is aborted
 */
export function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) { resolve(); return; }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => { clearTimeout(timer); resolve(); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Spawn a Claude Code subprocess with the given prompt.
 *
 * @param {string} prompt - The prompt to send to Claude
 * @param {string} cwd - Working directory for the subprocess
 * @param {boolean} [useShell=false] - Whether to spawn with shell (required on Windows)
 * @param {boolean} [continueSession=false] - Whether to use --continue flag
 * @returns {import('child_process').ChildProcess} The spawned child process
 */
function spawnClaude(prompt, cwd, useShell = false, continueSession = false) {
  // Always deliver prompts via stdin pipe. The previous approach used the -p flag
  // for short prompts, but on Windows (shell: true), cmd.exe silently mangles
  // special characters (|, &, (, ), <, >) in the command string, causing Claude
  // Code to receive a garbled or empty prompt and fall back to a generic greeting.
  // Stdin is binary-safe and immune to shell escaping issues on all platforms.
  const args = ['--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions'];
  if (continueSession) args.push('--continue');

  debug(`Spawn: stdin pipe, prompt length: ${prompt.length} chars`);

  const child = spawn('claude', args, {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: useShell,
    env: cleanEnv(),
  });

  child.stdin.write(prompt);
  child.stdin.end();

  return child;
}

/**
 * Set up a timeout that kills the child process and settles the promise.
 *
 * @param {import('child_process').ChildProcess} child - The child process
 * @param {number} timeoutMs - Timeout duration in milliseconds
 * @param {boolean} verbose - Whether to force-kill (verbose) or simple kill
 * @param {(result: object) => void} settle - Callback to settle the promise
 * @returns {NodeJS.Timeout} The timeout handle (for clearTimeout)
 */
function setupTimeout(child, timeoutMs, verbose, settle) {
  return setTimeout(() => {
    forceKillChild(child);
    settle({ success: false, error: timeoutMessage(timeoutMs), exitCode: -1 });
  }, timeoutMs);
}

/**
 * Set up an abort signal handler that kills the child process.
 *
 * @param {import('child_process').ChildProcess} child - The child process
 * @param {AbortSignal|undefined} signal - The abort signal (optional)
 * @param {(result: object) => void} settle - Callback to settle the promise
 * @returns {(() => void)|null} The abort handler function, or null if no signal
 */
function setupAbortHandler(child, signal, settle) {
  if (!signal) return null;
  const onAbort = () => {
    forceKillChild(child);
    settle({ success: false, error: 'Aborted by user', exitCode: -1 });
  };
  if (signal.aborted) { onAbort(); return onAbort; }
  signal.addEventListener('abort', onAbort, { once: true });
  return onAbort;
}

/**
 * Extract a human-readable summary from a single tool_use content block.
 *
 * @param {Object|null|undefined} input - The tool input object
 * @returns {string} A short summary string (e.g., file path, command snippet)
 */
function summarizeToolInput(input) {
  if (!input) return '';
  if (input.file_path) return input.file_path;
  if (input.command) return input.command.length > 80 ? input.command.slice(0, 80) + '...' : input.command;
  if (input.pattern) return input.pattern;
  if (input.query) return input.query.length > 80 ? input.query.slice(0, 80) + '...' : input.query;
  return '';
}

/**
 * @typedef {Object} StreamEvent
 * @property {string} type - Event type ('result', 'system', 'user', 'assistant', 'stream_event')
 * @property {Object} [message] - Message content for user/assistant events
 * @property {Object} [event] - Nested event for stream_event type
 * @property {string} [result] - Final result text for result events
 */

/**
 * Convert a parsed stream-json NDJSON event into human-readable display text.
 * Returns null for events that should not be displayed (system, result, etc.).
 *
 * Note: Claude Code CLI v2.1.29 does NOT emit token-level streaming events
 * (`stream_event` type). Output arrives only at turn boundaries as complete
 * `assistant` messages. The `stream_event` handler is kept for forward
 * compatibility in case future CLI versions add token streaming.
 *
 * @param {StreamEvent|null|undefined} event - Parsed NDJSON event
 * @returns {string|null} Display text, or null for non-display events
 */
function formatStreamEvent(event) {
  if (!event || !event.type) return null;

  // Final result — cost data handled by parseJsonOutput, not displayed
  if (event.type === 'result') return null;
  // System init — not useful for display
  if (event.type === 'system') return null;

  // Tool results — content is too verbose (full file contents, bash output)
  // but emit a brief marker so the output updates when tools complete.
  // Without this, the GUI shows nothing during multi-minute tool executions.
  if (event.type === 'user') {
    const content = event.message?.content;
    if (!Array.isArray(content)) return null;
    const count = content.filter(b => b.type === 'tool_result').length;
    if (count > 0) return `  \u2190 ${count === 1 ? 'result received' : count + ' results received'}\n`;
    return null;
  }

  // Forward compat: token-by-token deltas (not emitted by CLI v2.1.29)
  if (event.type === 'stream_event') {
    const delta = event.event?.delta;
    if (delta?.type === 'text_delta' && delta.text) return delta.text;
    return null;
  }

  // Assistant messages — extract text and tool_use content blocks
  if (event.type === 'assistant') {
    const content = event.message?.content;
    if (!Array.isArray(content)) return null;

    const parts = [];
    for (const block of content) {
      if (block.type === 'text' && block.text) {
        parts.push(block.text);
      } else if (block.type === 'tool_use' && block.name) {
        const detail = summarizeToolInput(block.input);
        parts.push(`\u25B8 ${block.name}${detail ? ': ' + detail : ''}`);
      }
    }
    return parts.length > 0 ? parts.join('\n') + '\n' : null;
  }

  return null;
}

/**
 * Parse a single NDJSON line and return display text (or null).
 * Non-JSON lines are passed through as-is for backward compatibility.
 *
 * @param {string} line - A single line from stdout
 * @returns {string|null} Display text, or null for non-display lines
 */
function formatEventLine(line) {
  try {
    const event = JSON.parse(line);
    return formatStreamEvent(event);
  } catch {
    // Not valid JSON — pass through raw text (backward compat with older CLI)
    return line.trim() ? line + '\n' : null;
  }
}

/**
 * @typedef {Object} WaitResult
 * @property {boolean} success - Whether the process completed successfully
 * @property {string} output - Stdout content
 * @property {string|null} error - Error message if failed
 * @property {number} exitCode - Process exit code
 * @property {string} [stderr] - Stderr content (if available)
 */

/**
 * Wait for a child process to complete, with timeout and abort handling.
 *
 * @param {import('child_process').ChildProcess} child - The child process
 * @param {number} timeoutMs - Timeout duration in milliseconds
 * @param {Object} [options] - Options
 * @param {boolean} [options.verbose=true] - Whether to log debug output
 * @param {AbortSignal} [options.signal] - Abort signal for cancellation
 * @param {(chunk: string) => void} [options.onOutput] - Callback for streaming output
 * @param {number} [options.inactivityTimeout] - Max silence before kill (default: INACTIVITY_TIMEOUT_MS; 0 disables)
 * @returns {Promise<WaitResult>} Result object with success, output, error, exitCode
 */
function waitForChild(child, timeoutMs, { verbose = true, signal, onOutput, inactivityTimeout } = {}) {
  return new Promise((resolve) => {
    // Use array accumulation instead of string concatenation to avoid O(n²) memory
    // allocations on large outputs. Join once at the end when needed.
    const stdoutChunks = [];
    let settled = false;
    let lineBuffer = ''; // Buffers incomplete NDJSON lines for onOutput parsing

    // Central settle function — guards against double-resolve and cleans up
    const settle = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (inactivityTimer) clearTimeout(inactivityTimer);
      if (onAbort) signal?.removeEventListener('abort', onAbort);
      const stdout = stdoutChunks.join('');
      resolve({ ...result, output: result.output ?? stdout });
    };

    const timer = setupTimeout(child, timeoutMs, verbose, settle);
    const onAbort = setupAbortHandler(child, signal, settle);

    // ── Inactivity timer ────────────────────────────────────────────
    // Resets on every stdout or stderr data event. If no data arrives
    // within the inactivity window, the process is presumed stalled
    // and force-killed so the retry loop can attempt recovery.
    const inactivityMs = inactivityTimeout ?? INACTIVITY_TIMEOUT_MS;
    let inactivityTimer = null;

    function resetInactivityTimer() {
      if (inactivityTimer) clearTimeout(inactivityTimer);
      if (inactivityMs > 0) {
        inactivityTimer = setTimeout(() => {
          warn(`Claude Code inactivity timeout (${Math.round(inactivityMs / 60000)} min) — killing stalled process`);
          forceKillChild(child);
          settle({ success: false, error: inactivityMessage(inactivityMs), exitCode: -1 });
        }, inactivityMs);
        inactivityTimer.unref();
      }
    }

    resetInactivityTimer();

    child.stdout.on('data', (chunk) => {
      resetInactivityTimer();
      const text = chunk.toString();
      stdoutChunks.push(text);
      if (verbose) debug(text.trimEnd());
      if (onOutput) {
        // Parse complete NDJSON lines and extract display text
        lineBuffer += text;
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop(); // Keep incomplete last line in buffer
        for (const line of lines) {
          if (!line.trim()) continue;
          const display = formatEventLine(line);
          if (display) {
            try { onOutput(display); } catch { /* callback failure must not crash subprocess */ }
          }
        }
      }
    });

    const stderrChunks = [];
    child.stderr.on('data', (chunk) => {
      resetInactivityTimer();
      const text = chunk.toString();
      stderrChunks.push(text);
      if (verbose && text.trim()) warn(`Claude Code warning output: ${text.trimEnd()}`);
    });

    child.on('error', (err) => {
      settle({ success: false, output: '', error: err.message, exitCode: -1, _errorCode: err.code });
    });

    child.on('close', (code) => {
      const stdout = stdoutChunks.join('');
      const ok = code === 0 && stdout.trim().length > 0;
      settle({
        success: ok,
        error: ok ? null : (code === 0 ? 'Claude Code returned empty output' : `Claude Code exited with error code ${code}`),
        exitCode: code,
        stderr: stderrChunks.join(''),
      });
    });
  });
}

/**
 * Extract cost metadata from a parsed JSON event.
 * Consolidates the repeated cost object construction logic.
 *
 * @param {Object} json - Parsed JSON from Claude CLI output
 * @param {number} [json.total_cost_usd] - Total cost in USD
 * @param {Object} [json.usage] - Token usage object
 * @param {number} [json.num_turns] - Number of conversation turns
 * @param {number} [json.duration_api_ms] - API duration in milliseconds
 * @param {string} [json.session_id] - Claude session ID
 * @returns {CostData} Normalized cost data object
 */
function extractCost(json) {
  const usage = json.usage || {};
  return {
    costUSD: json.total_cost_usd ?? null,
    inputTokens: (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0) || null,
    outputTokens: usage.output_tokens ?? null,
    numTurns: json.num_turns ?? null,
    durationApiMs: json.duration_api_ms ?? null,
    sessionId: json.session_id ?? null,
  };
}

/**
 * Parse Claude Code --output-format stream-json response.
 * Scans NDJSON lines for the final `result` event to extract cost metadata
 * and the response text. Falls back to single-JSON parse (backward compat
 * with --output-format json) and then to raw text (cost: null).
 *
 * @param {WaitResult} result - Raw result from waitForChild
 * @returns {WaitResult & {cost: CostData|null}} Result with parsed output and cost
 */
function parseJsonOutput(result) {
  if (!result.output) return { ...result, cost: null };

  const lines = result.output.trim().split('\n');

  // Scan backwards for the "result" event (stream-json NDJSON format)
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const event = JSON.parse(lines[i]);
      if (event.type === 'result') {
        return {
          ...result,
          output: event.result || '',
          cost: extractCost(event),
        };
      }
    } catch {
      continue;
    }
  }

  // Fallback: try parsing entire output as single JSON (--output-format json compat)
  try {
    const json = JSON.parse(result.output.trim());
    return {
      ...result,
      output: json.result || '',
      cost: extractCost(json),
    };
  } catch {
    // Not valid JSON — CLI may be an old version without JSON output.
    return { ...result, cost: null };
  }
}

/**
 * Run a single Claude Code invocation (no retries).
 *
 * @param {string} prompt - The prompt to send
 * @param {string} cwd - Working directory
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {AbortSignal|undefined} signal - Abort signal
 * @param {boolean} [continueSession=false] - Use --continue flag
 * @param {(chunk: string) => void} [onOutput] - Streaming output callback
 * @returns {Promise<RunPromptResult>} Result with success, output, error, cost, etc.
 */
async function runOnce(prompt, cwd, timeoutMs, signal, continueSession = false, onOutput, inactivityTimeout) {
  // On Windows, always use shell — 'claude' is a .cmd script that
  // requires shell interpretation. Spawning without shell always gets
  // ENOENT, and the failed-spawn + shell-retry pattern can exhaust
  // Windows process resources (STATUS_DLL_INIT_FAILED / 0xC0000142).
  const useShell = platform() === 'win32';

  let child;
  try {
    child = spawnClaude(prompt, cwd, useShell, continueSession);
  } catch (err) {
    return { success: false, output: '', error: err.message || 'Failed to start Claude Code', exitCode: -1, cost: null };
  }

  const result = await waitForChild(child, timeoutMs, { signal, onOutput, inactivityTimeout });

  delete result._errorCode;
  const parsed = parseJsonOutput(result);
  const classification = classifyError(result.stderr || '', result.exitCode);
  return { ...parsed, errorType: classification.type, retryAfterMs: classification.retryAfterMs };
}

/**
 * Run a Claude Code prompt with retry logic and error handling.
 *
 * This is the main entry point for running Claude Code. It handles:
 * - Retry logic with configurable attempts
 * - Timeout handling per attempt
 * - Rate-limit detection (skips retries for rate limits)
 * - Abort signal support
 * - Session continuation via --continue flag
 * - Streaming output via onOutput callback
 *
 * Error contract: This function NEVER throws. It always returns a result object.
 *
 * @param {string} prompt - The prompt to send to Claude
 * @param {string} cwd - Working directory for the subprocess
 * @param {RunPromptOptions} [options] - Configuration options
 * @returns {Promise<RunPromptResult>} Result object (always defined, never throws)
 */
export async function runPrompt(prompt, cwd, options = {}) {
  const timeoutMs = options.timeout ?? DEFAULT_TIMEOUT;
  const maxRetries = options.retries ?? DEFAULT_RETRIES;
  const label = options.label ?? 'prompt';
  const signal = options.signal;
  const continueSession = options.continueSession ?? false;
  const onOutput = options.onOutput;
  const inactivityTimeout = options.inactivityTimeout;
  const totalAttempts = maxRetries + 1;

  const startTime = Date.now();
  let lastResult = null;

  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    if (signal?.aborted) {
      const duration = Date.now() - startTime;
      return { success: false, output: '', error: 'Aborted by user', exitCode: -1, duration, attempts: attempt, cost: null };
    }

    info(`Running Claude Code: ${label} (attempt ${attempt}/${totalAttempts})`);

    const result = await runOnce(prompt, cwd, timeoutMs, signal, continueSession, onOutput, inactivityTimeout);
    lastResult = result;

    // Abort detected — return immediately without retry
    if (signal?.aborted) {
      const duration = Date.now() - startTime;
      return { success: false, output: result.output || '', error: 'Aborted by user', exitCode: -1, duration, attempts: attempt, cost: null };
    }

    if (result.success) {
      const duration = Date.now() - startTime;
      info(`Claude Code completed: ${label} — ${Math.round(duration / 1000)}s`);
      return { ...result, duration, attempts: attempt };
    }

    // Rate-limit errors won't resolve in 10s — fail fast so caller can pause
    if (result.errorType === ERROR_TYPE.RATE_LIMIT) {
      const duration = Date.now() - startTime;
      warn(`Claude Code rate limited: ${label} — not retrying (would fail again)`);
      return {
        success: false,
        output: result.output || '',
        error: result.error || 'Rate limit exceeded',
        exitCode: result.exitCode,
        duration,
        attempts: attempt,
        cost: result.cost ?? null,
        errorType: result.errorType,
        retryAfterMs: result.retryAfterMs,
      };
    }

    warn(`Claude Code failed: ${label} — ${result.error} (attempt ${attempt}/${totalAttempts})`);

    if (attempt < totalAttempts) {
      warn(`Retrying ${label} in 10s (attempt ${attempt + 1}/${totalAttempts})`);
      await sleep(RETRY_DELAY, signal);
    }
  }

  const duration = Date.now() - startTime;
  logError(`Claude Code failed: ${label} — all ${totalAttempts} attempts exhausted`);
  return {
    success: false,
    output: lastResult?.output || '',
    error: `Failed after ${totalAttempts} attempts`,
    exitCode: -1,
    duration,
    attempts: totalAttempts,
    cost: lastResult?.cost ?? null,
  };
}
