import { spawn } from 'child_process';
import { platform } from 'os';
import { info, debug, warn, error as logError } from './logger.js';

const DEFAULT_TIMEOUT = 30 * 60 * 1000; // 30 minutes
const DEFAULT_RETRIES = 3;
const RETRY_DELAY = 10000; // 10 seconds
const STDIN_THRESHOLD = 8000; // chars
const TIMEOUT_MESSAGE = 'Claude Code timed out after 30 minutes';

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

function spawnClaude(prompt, cwd, useShell = false) {
  const useStdin = prompt.length > STDIN_THRESHOLD;

  const args = useStdin ? [] : ['-p', prompt];
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
      resolve({ success: false, output: stdout, error: TIMEOUT_MESSAGE, exitCode: -1 });
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

async function runOnce(prompt, cwd, timeoutMs, signal) {
  let child;
  let useShell = false;

  try {
    child = spawnClaude(prompt, cwd, false);
  } catch {
    // If spawn fails immediately, try with shell on Windows
    if (platform() === 'win32') {
      useShell = true;
      try {
        child = spawnClaude(prompt, cwd, true);
        warn('Claude Code started using shell mode (Windows compatibility)');
      } catch (err) {
        return { success: false, output: '', error: err.message, exitCode: -1 };
      }
    } else {
      return { success: false, output: '', error: 'Failed to start Claude Code. Ensure the "claude" command is installed and on your PATH.', exitCode: -1 };
    }
  }

  const result = await waitForChild(child, timeoutMs, { signal });

  // Windows ENOENT fallback — retry with shell: true
  if (result._errorCode === 'ENOENT' && platform() === 'win32' && !useShell) {
    warn('Claude Code command not found — retrying with shell mode (Windows)');
    const shellChild = spawnClaude(prompt, cwd, true);
    const shellResult = await waitForChild(shellChild, timeoutMs, { verbose: false, signal });
    delete shellResult._errorCode;
    return shellResult;
  }

  delete result._errorCode;
  return result;
}

export async function runPrompt(prompt, cwd, options = {}) {
  const timeoutMs = options.timeout ?? DEFAULT_TIMEOUT;
  const maxRetries = options.retries ?? DEFAULT_RETRIES;
  const label = options.label ?? 'prompt';
  const signal = options.signal;
  const totalAttempts = maxRetries + 1;

  const startTime = Date.now();

  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    if (signal?.aborted) {
      const duration = Date.now() - startTime;
      return { success: false, output: '', error: 'Aborted by user', exitCode: -1, duration, attempts: attempt };
    }

    info(`Running Claude Code: ${label} (attempt ${attempt}/${totalAttempts})`);

    const result = await runOnce(prompt, cwd, timeoutMs, signal);

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
