import { spawn } from 'child_process';
import { platform } from 'os';
import { info, debug, warn, error as logError } from './logger.js';

const DEFAULT_TIMEOUT = 30 * 60 * 1000; // 30 minutes
const DEFAULT_RETRIES = 3;
const RETRY_DELAY = 10000; // 10 seconds
const STDIN_THRESHOLD = 8000; // chars
const TIMEOUT_MESSAGE = 'Claude Code timed out after 30 minutes';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
  });

  if (useStdin) {
    child.stdin.write(prompt);
    child.stdin.end();
  }

  return child;
}

function waitForChild(child, timeoutMs, { verbose = true } = {}) {
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

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (verbose) debug(text.trimEnd());
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      if (verbose && text.trim()) warn(`Claude stderr: ${text.trimEnd()}`);
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ success: false, output: '', error: err.message, exitCode: -1, _errorCode: err.code });
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const ok = code === 0 && stdout.trim().length > 0;
      resolve({
        success: ok,
        output: stdout,
        error: ok ? null : (code === 0 ? 'Empty output' : `Exit code ${code}`),
        exitCode: code,
      });
    });
  });
}

async function runOnce(prompt, cwd, timeoutMs) {
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
        warn('Claude Code spawned with shell: true (Windows fallback)');
      } catch (err) {
        return { success: false, output: '', error: err.message, exitCode: -1 };
      }
    } else {
      return { success: false, output: '', error: 'Failed to spawn claude process', exitCode: -1 };
    }
  }

  const result = await waitForChild(child, timeoutMs);

  // Windows ENOENT fallback — retry with shell: true
  if (result._errorCode === 'ENOENT' && platform() === 'win32' && !useShell) {
    warn('Claude Code ENOENT — retrying with shell: true (Windows fallback)');
    const shellChild = spawnClaude(prompt, cwd, true);
    const shellResult = await waitForChild(shellChild, timeoutMs, { verbose: false });
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
  const totalAttempts = maxRetries + 1;

  const startTime = Date.now();

  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    info(`Running Claude Code: ${label} (attempt ${attempt}/${totalAttempts})`);

    const result = await runOnce(prompt, cwd, timeoutMs);

    if (result.success) {
      const duration = Date.now() - startTime;
      info(`Claude Code completed: ${label} — exit code ${result.exitCode}, ${Math.round(duration / 1000)}s`);
      return { ...result, duration, attempts: attempt };
    }

    warn(`Claude Code failed: ${label} — ${result.error} (attempt ${attempt}/${totalAttempts})`);

    if (attempt < totalAttempts) {
      warn(`Retrying ${label} in 10s (attempt ${attempt + 1}/${totalAttempts})`);
      await sleep(RETRY_DELAY);
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
