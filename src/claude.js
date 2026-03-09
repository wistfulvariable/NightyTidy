import { spawn } from 'child_process';
import { platform } from 'os';
import { info, debug, warn, error as logError } from './logger.js';
import { cleanEnv } from './env.js';

const DEFAULT_TIMEOUT = 45 * 60 * 1000; // 45 minutes
const DEFAULT_RETRIES = 3;
const RETRY_DELAY = 10000; // 10 seconds
const STDIN_THRESHOLD = 8000; // chars
const SIGKILL_DELAY = 5000; // grace period before SIGKILL after initial kill

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

function sleep(ms, signal) {
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
  // --output-format json: returns structured JSON with total_cost_usd, num_turns,
  // duration_api_ms, and the response text in the `result` field.
  const args = useStdin
    ? ['--output-format', 'json', '--dangerously-skip-permissions']
    : ['-p', prompt, '--output-format', 'json', '--dangerously-skip-permissions'];
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

function waitForChild(child, timeoutMs, { verbose = true, signal, onOutput } = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let settled = false;

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
        try { onOutput(text); } catch { /* callback failure must not crash subprocess */ }
      }
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
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
      });
    });
  });
}

/**
 * Parse Claude Code --output-format json response.
 * Extracts the text response from `result` field and cost metadata.
 * Falls back gracefully if output isn't valid JSON (e.g., old CLI version).
 */
function parseJsonOutput(result) {
  if (!result.output) return { ...result, cost: null };

  try {
    const json = JSON.parse(result.output.trim());
    return {
      ...result,
      output: json.result || '',
      cost: {
        costUSD: json.total_cost_usd ?? null,
        numTurns: json.num_turns ?? null,
        durationApiMs: json.duration_api_ms ?? null,
        sessionId: json.session_id ?? null,
      },
    };
  } catch {
    // Not valid JSON — CLI may not support --output-format json.
    // Return original result with null cost.
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
  return parseJsonOutput(result);
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
