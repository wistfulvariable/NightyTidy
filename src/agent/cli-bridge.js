import { spawn } from 'node:child_process';
import path from 'node:path';
import { debug, error as logError } from '../logger.js';

export class CliBridge {
  constructor(projectDir) {
    this.projectDir = projectDir;
    this.activeProcess = null;
  }

  async listSteps() {
    return this._run(CliBridge.buildArgs({ list: true }));
  }

  async initRun(steps, timeout) {
    return this._run(CliBridge.buildArgs({ initRun: true, steps, timeout }));
  }

  async runStep(stepNum, onOutput) {
    return this._run(CliBridge.buildArgs({ runStep: stepNum }), onOutput);
  }

  async finishRun() {
    return this._run(CliBridge.buildArgs({ finishRun: true }));
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

  _run(args, onOutput) {
    return new Promise((resolve, reject) => {
      const binPath = path.resolve(import.meta.dirname, '../../bin/nightytidy.js');
      const proc = spawn('node', [binPath, ...args], {
        cwd: this.projectDir,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.activeProcess = proc;

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        const text = data.toString();
        stdout += text;
        if (onOutput) onOutput(text);
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        this.activeProcess = null;
        const parsed = CliBridge.parseOutput(stdout);
        resolve({
          success: code === 0,
          exitCode: code,
          stdout,
          stderr,
          parsed,
        });
      });

      proc.on('error', (err) => {
        this.activeProcess = null;
        logError(`CLI process error: ${err.message}`);
        resolve({
          success: false,
          exitCode: -1,
          stdout,
          stderr: err.message,
          parsed: null,
        });
      });
    });
  }
}
