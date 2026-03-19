import { spawn } from 'node:child_process';
import path from 'node:path';
import { debug, warn, error as logError } from '../logger.js';

const INIT_TIMEOUT_MS = 5 * 60_000;   // 5 minutes — init should never take this long
const FINISH_TIMEOUT_MS = 10 * 60_000; // 10 minutes — finish includes report generation

export class CliBridge {
  constructor(projectDir) {
    this.projectDir = projectDir;
    this.activeProcess = null;
  }

  async listSteps() {
    return this._run(CliBridge.buildArgs({ list: true }), null, { timeout: 30_000 });
  }

  async initRun(steps, timeout) {
    return this._run(CliBridge.buildArgs({ initRun: true, steps, timeout }), null, { timeout: INIT_TIMEOUT_MS });
  }

  async runStep(stepNum, onOutput) {
    // No timeout on steps — they have their own per-step timeout via the CLI
    return this._run(CliBridge.buildArgs({ runStep: stepNum }), onOutput);
  }

  async finishRun() {
    return this._run(CliBridge.buildArgs({ finishRun: true }), null, { timeout: FINISH_TIMEOUT_MS });
  }

  kill() {
    if (this.activeProcess) {
      const pid = this.activeProcess.pid;
      debug(`Killing CLI process ${pid}`);
      if (process.platform === 'win32') {
        spawn('taskkill', ['/F', '/T', '/PID', String(pid)]);
      } else {
        this.activeProcess.kill('SIGTERM');
      }
      this.activeProcess = null;
    }
  }

  static buildArgs(opts) {
    const args = [];
    if (opts.list) {
      args.push('--list', '--json');
    }
    if (opts.initRun) {
      args.push('--init-run');
      args.push('--skip-dashboard');
      args.push('--skip-sync');
      if (opts.steps) args.push('--steps', opts.steps.join(','));
      if (opts.timeout) args.push('--timeout', String(opts.timeout));
    }
    if (opts.runStep !== undefined) {
      args.push('--run-step', String(opts.runStep));
    }
    if (opts.finishRun) {
      args.push('--finish-run');
    }
    return args;
  }

  static parseOutput(stdout) {
    const lines = stdout.trim().split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (line.startsWith('{') || line.startsWith('[')) {
        try {
          return JSON.parse(line);
        } catch { /* continue */ }
      }
    }
    return null;
  }

  _run(args, onOutput, opts = {}) {
    return new Promise((resolve) => {
      const binPath = path.resolve(import.meta.dirname, '../../bin/nightytidy.js');
      const proc = spawn('node', [binPath, ...args], {
        cwd: this.projectDir,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.activeProcess = proc;

      let stdout = '';
      let stderr = '';
      let killed = false;
      let settled = false;

      const settle = (result) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
        resolve(result);
      };

      // Timeout — kill the process if it takes too long
      let timer = null;
      let killTimer = null;
      if (opts.timeout) {
        timer = setTimeout(() => {
          killed = true;
          const timeoutSec = Math.round(opts.timeout / 1000);
          warn(`CLI process timed out after ${timeoutSec}s: ${args.join(' ')}`);
          this.kill();
          // On Windows, taskkill is fire-and-forget — the 'close' event may
          // never fire. Force-resolve after 5s to prevent the agent from
          // hanging forever.
          killTimer = setTimeout(() => {
            warn(`CLI process did not exit within 5s after kill — force-resolving`);
            this.activeProcess = null;
            settle({
              success: false,
              exitCode: -1,
              stdout,
              stderr: `Process timed out after ${timeoutSec}s — Claude Code may be unavailable`,
              parsed: CliBridge.parseOutput(stdout),
              timedOut: true,
            });
          }, 5000);
        }, opts.timeout);
      }

      proc.stdout.on('data', (data) => {
        const text = data.toString();
        stdout += text;
        // Filter the final JSON result line from streaming output — it's the
        // orchestrator's return value, not Claude's output. The parsed result
        // is extracted separately by parseOutput() after process close.
        if (onOutput) {
          const trimmed = text.trim();
          if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            try {
              const obj = JSON.parse(trimmed);
              if ('success' in obj && ('step' in obj || 'error' in obj)) return;
            } catch { /* not JSON, forward as normal output */ }
          }
          onOutput(text);
        }
      });

      proc.stderr.on('data', (data) => {
        const text = data.toString();
        stderr += text;
        // Filter Node.js ExperimentalWarning noise before forwarding to UI
        if (onOutput && !text.includes('ExperimentalWarning') && !text.includes('--experimental-')) {
          onOutput(text);
        }
      });

      proc.on('close', (code) => {
        this.activeProcess = null;
        settle({
          success: code === 0 && !killed,
          exitCode: code,
          stdout,
          stderr: killed
            ? `Process timed out after ${Math.round(opts.timeout / 1000)}s — Claude Code may be unavailable`
            : stderr,
          parsed: CliBridge.parseOutput(stdout),
          timedOut: killed,
        });
      });

      proc.on('error', (err) => {
        this.activeProcess = null;
        logError(`CLI process error: ${err.message}`);
        settle({
          success: false,
          exitCode: -1,
          stdout,
          stderr: err.message,
          parsed: null,
          timedOut: false,
        });
      });
    });
  }
}
