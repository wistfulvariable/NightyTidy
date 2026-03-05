import { spawn } from 'child_process';
import { platform } from 'os';
import { info, debug, warn, error as logError } from './logger.js';

const DEFAULT_TIMEOUT = 45 * 60 * 1000; // 45 minutes
const DEFAULT_RETRIES = 3;
const RETRY_DELAY = 10000; // 10 seconds
const STDIN_THRESHOLD = 8000; // chars
function timeoutMessage(ms) {
  const minutes = Math.round(ms / 60000);
  return `Claude Code timed out after ${minutes} minutes`;
}

// Remove CLAUDECODE env var so subprocess doesn't refuse to start
// when NightyTidy is invoked from within a Claude Code session.
// Safe because NightyTidy only uses non-interactive `claude -p` calls.
function cleanEnv() {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  return env;
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
  const args = useStdin
    ? ['--dangerously-skip-permissions']
    : ['-p', prompt, '--dangerously-skip-permissions'];
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

function waitForChild(child, timeoutMs, { verbose = true, signal } = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      if (verbose) {
        setTimeout(() => {
          try { child.kill('SIGKILL'); } catch { /* already dead */ }
        }, 5000);
      }
      resolve({ success: false, output: stdout, error: timeoutMessage(timeoutMs), exitCode: -1 });
    }, timeoutMs);

    // Kill child when abort signal fires
    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* already dead */ }
      }, 5000);
      resolve({ success: false, output: stdout, error: 'Aborted by user', exitCode: -1 });
    };
    if (signal?.aborted) { onAbort(); return; }
    signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (verbose) debug(text.trimEnd());
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      if (verbose && text.trim()) warn(`Claude Code warning output: ${text.trimEnd()}`);
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve({ success: false, output: '', error: err.message, exitCode: -1, _errorCode: err.code });
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      const ok = code === 0 && stdout.trim().length > 0;
      resolve({
        success: ok,
        output: stdout,
        error: ok ? null : (code === 0 ? 'Claude Code returned empty output' : `Claude Code exited with error code ${code}`),
        exitCode: code,
      });
    });
  });
}

async function runOnce(prompt, cwd, timeoutMs, signal, continueSession = false) {
  // On Windows, always use shell — 'claude' is a .cmd script that
  // requires shell interpretation. Spawning without shell always gets
  // ENOENT, and the failed-spawn + shell-retry pattern can exhaust
  // Windows process resources (STATUS_DLL_INIT_FAILED / 0xC0000142).
  const useShell = platform() === 'win32';

  let child;
  try {
    child = spawnClaude(prompt, cwd, useShell, continueSession);
  } catch (err) {
    return { success: false, output: '', error: err.message || 'Failed to start Claude Code', exitCode: -1 };
  }

  const result = await waitForChild(child, timeoutMs, { signal });

  delete result._errorCode;
  return result;
}

export async function runPrompt(prompt, cwd, options = {}) {
  const timeoutMs = options.timeout ?? DEFAULT_TIMEOUT;
  const maxRetries = options.retries ?? DEFAULT_RETRIES;
  const label = options.label ?? 'prompt';
  const signal = options.signal;
  const continueSession = options.continueSession ?? false;
  const totalAttempts = maxRetries + 1;

  const startTime = Date.now();

  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    if (signal?.aborted) {
      const duration = Date.now() - startTime;
      return { success: false, output: '', error: 'Aborted by user', exitCode: -1, duration, attempts: attempt };
    }

    info(`Running Claude Code: ${label} (attempt ${attempt}/${totalAttempts})`);

    const result = await runOnce(prompt, cwd, timeoutMs, signal, continueSession);

    // Abort detected — return immediately without retry
    if (signal?.aborted) {
      const duration = Date.now() - startTime;
      return { success: false, output: result.output || '', error: 'Aborted by user', exitCode: -1, duration, attempts: attempt };
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
    output: '',
    error: `Failed after ${totalAttempts} attempts`,
    exitCode: -1,
    duration,
    attempts: totalAttempts,
  };
}
