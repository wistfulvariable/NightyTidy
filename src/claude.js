import { spawn } from 'child_process';
import { platform } from 'os';
import { info, debug, warn, error as logError } from './logger.js';
import { cleanEnv } from './env.js';

const DEFAULT_TIMEOUT = 45 * 60 * 1000; // 45 minutes
const DEFAULT_RETRIES = 3;
const RETRY_DELAY = 10000; // 10 seconds
const STDIN_THRESHOLD = 8000; // chars
const SIGKILL_DELAY = 5000; // grace period before SIGKILL after initial kill

// ── Rate-limit error classification ─────────────────────────────────
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
 * Classify a Claude Code subprocess error based on stderr content.
 * Returns { type, retryAfterMs } where type is an ERROR_TYPE value.
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

function forceKillChild(child) {
  child.kill();
  const killTimer = setTimeout(() => {
    try { child.kill('SIGKILL'); } catch { /* already dead */ }
  }, SIGKILL_DELAY);
  killTimer.unref(); // Don't prevent Node.js from exiting if child dies quickly
}

function timeoutMessage(ms) {
  const minutes = Math.round(ms / 60000);
  return `Claude Code timed out after ${minutes} minutes`;
}

export function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) { resolve(); return; }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => { clearTimeout(timer); resolve(); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function spawnClaude(prompt, cwd, useShell = false, continueSession = false) {
  const useStdin = prompt.length > STDIN_THRESHOLD;

  // --dangerously-skip-permissions: required for non-interactive mode.
  // Without it, Claude Code blocks on tool permission prompts (Bash, Edit, etc.)
  // that cannot be approved without a TTY. NightyTidy is the permission layer —
  // it controls what prompts are sent and operates on a safety branch.
  // --output-format stream-json: streams NDJSON events in real-time as the
  // conversation progresses. Each line is a JSON object (assistant message,
  // tool use, etc.). The final line is a `result` event with total_cost_usd,
  // num_turns, duration_api_ms, and the response text in the `result` field.
  const args = useStdin
    ? ['--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions']
    : ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions'];
  if (continueSession) args.push('--continue');
  const stdinMode = useStdin ? 'pipe' : 'ignore';

  debug(`Spawn mode: ${useStdin ? 'stdin' : '-p flag'}, prompt length: ${prompt.length} chars`);

  const child = spawn('claude', args, {
    cwd,
    stdio: [stdinMode, 'pipe', 'pipe'],
    shell: useShell,
    env: cleanEnv(),
  });

  if (useStdin) {
    child.stdin.write(prompt);
    child.stdin.end();
  }

  return child;
}

function setupTimeout(child, timeoutMs, verbose, settle) {
  return setTimeout(() => {
    if (verbose) forceKillChild(child); else child.kill();
    settle({ success: false, error: timeoutMessage(timeoutMs), exitCode: -1 });
  }, timeoutMs);
}

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
 * Returns a short string like "▸ Read: /path/to/file".
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
 * Convert a parsed stream-json NDJSON event into human-readable display text.
 * Returns null for events that should not be displayed (system, result, etc.).
 *
 * Note: Claude Code CLI v2.1.29 does NOT emit token-level streaming events
 * (`stream_event` type). Output arrives only at turn boundaries as complete
 * `assistant` messages. The `stream_event` handler is kept for forward
 * compatibility in case future CLI versions add token streaming.
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

function waitForChild(child, timeoutMs, { verbose = true, signal, onOutput } = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let settled = false;
    let lineBuffer = ''; // Buffers incomplete NDJSON lines for onOutput parsing

    // Central settle function — guards against double-resolve and cleans up
    const settle = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (onAbort) signal?.removeEventListener('abort', onAbort);
      resolve({ ...result, output: result.output ?? stdout });
    };

    const timer = setupTimeout(child, timeoutMs, verbose, settle);
    const onAbort = setupAbortHandler(child, signal, settle);

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
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

    let stderrText = '';
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderrText += text;
      if (verbose && text.trim()) warn(`Claude Code warning output: ${text.trimEnd()}`);
    });

    child.on('error', (err) => {
      settle({ success: false, output: '', error: err.message, exitCode: -1, _errorCode: err.code });
    });

    child.on('close', (code) => {
      const ok = code === 0 && stdout.trim().length > 0;
      settle({
        success: ok,
        error: ok ? null : (code === 0 ? 'Claude Code returned empty output' : `Claude Code exited with error code ${code}`),
        exitCode: code,
        stderr: stderrText,
      });
    });
  });
}

/**
 * Parse Claude Code --output-format stream-json response.
 * Scans NDJSON lines for the final `result` event to extract cost metadata
 * and the response text. Falls back to single-JSON parse (backward compat
 * with --output-format json) and then to raw text (cost: null).
 */
function parseJsonOutput(result) {
  if (!result.output) return { ...result, cost: null };

  const lines = result.output.trim().split('\n');

  // Scan backwards for the "result" event (stream-json NDJSON format)
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const event = JSON.parse(lines[i]);
      if (event.type === 'result') {
        const usage = event.usage || {};
        return {
          ...result,
          output: event.result || '',
          cost: {
            costUSD: event.total_cost_usd ?? null,
            inputTokens: (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0) || null,
            outputTokens: usage.output_tokens ?? null,
            numTurns: event.num_turns ?? null,
            durationApiMs: event.duration_api_ms ?? null,
            sessionId: event.session_id ?? null,
          },
        };
      }
    } catch {
      continue;
    }
  }

  // Fallback: try parsing entire output as single JSON (--output-format json compat)
  try {
    const json = JSON.parse(result.output.trim());
    const usage = json.usage || {};
    return {
      ...result,
      output: json.result || '',
      cost: {
        costUSD: json.total_cost_usd ?? null,
        inputTokens: (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0) || null,
        outputTokens: usage.output_tokens ?? null,
        numTurns: json.num_turns ?? null,
        durationApiMs: json.duration_api_ms ?? null,
        sessionId: json.session_id ?? null,
      },
    };
  } catch {
    // Not valid JSON — CLI may be an old version without JSON output.
    return { ...result, cost: null };
  }
}

async function runOnce(prompt, cwd, timeoutMs, signal, continueSession = false, onOutput) {
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

  const result = await waitForChild(child, timeoutMs, { signal, onOutput });

  delete result._errorCode;
  const parsed = parseJsonOutput(result);
  const classification = classifyError(result.stderr || '', result.exitCode);
  return { ...parsed, errorType: classification.type, retryAfterMs: classification.retryAfterMs };
}

export async function runPrompt(prompt, cwd, options = {}) {
  const timeoutMs = options.timeout ?? DEFAULT_TIMEOUT;
  const maxRetries = options.retries ?? DEFAULT_RETRIES;
  const label = options.label ?? 'prompt';
  const signal = options.signal;
  const continueSession = options.continueSession ?? false;
  const onOutput = options.onOutput;
  const totalAttempts = maxRetries + 1;

  const startTime = Date.now();
  let lastResult = null;

  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    if (signal?.aborted) {
      const duration = Date.now() - startTime;
      return { success: false, output: '', error: 'Aborted by user', exitCode: -1, duration, attempts: attempt, cost: null };
    }

    info(`Running Claude Code: ${label} (attempt ${attempt}/${totalAttempts})`);

    const result = await runOnce(prompt, cwd, timeoutMs, signal, continueSession, onOutput);
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
