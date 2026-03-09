#!/usr/bin/env node

// Standalone TUI progress display for NightyTidy.
// Spawned in a separate terminal window by dashboard.js.
// Reads nightytidy-progress.json and renders a live terminal UI.
//
// Usage: node dashboard-tui.js <path-to-progress.json>

import { readFileSync } from 'fs';
import chalk from 'chalk';

const POLL_INTERVAL = 1000;
const EXIT_DELAY = 5000;
const BAR_WIDTH = 30;
const MAX_VISIBLE_STEPS = 16;
const MAX_OUTPUT_LINES = 20;

// Module-level state
let progressFilePath = null;
let lastJson = '';

function readState() {
  if (!progressFilePath) return null;
  try {
    const raw = readFileSync(progressFilePath, 'utf8');
    if (raw === lastJson) return null; // no change
    lastJson = raw;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function formatMs(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '0s';

  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, '0')}m`;
}

export function progressBar(done, total, hasActive = false) {
  const effective = hasActive ? done + 0.5 : done;
  const pct = total > 0 ? effective / total : 0;
  const filled = Math.round(pct * BAR_WIDTH);
  const empty = BAR_WIDTH - filled;
  const bar = chalk.cyan('\u2588'.repeat(filled)) + chalk.dim('\u2591'.repeat(empty));
  const label = `${done}/${total} (${Math.round(pct * 100)}%)`;
  return `${bar}  ${label}`;
}

const STATUS_COLORS = {
  starting: chalk.blue,
  running: chalk.blue,
  finishing: chalk.cyan,
  completed: chalk.green,
  stopped: chalk.yellow,
  error: chalk.red,
};

function statusColor(status) {
  const colorFn = STATUS_COLORS[status] || chalk.white;
  return colorFn(status.charAt(0).toUpperCase() + status.slice(1));
}

function stepIcon(status) {
  if (status === 'completed') return chalk.green('\u2713');
  if (status === 'failed') return chalk.red('\u2717');
  if (status === 'running') return chalk.cyan('\u23f3');
  return chalk.dim('\u25cb');
}

export function render(state) {
  const lines = [];

  // Header
  lines.push('');
  lines.push(chalk.cyan.bold('  NightyTidy \u2014 Live Progress'));
  lines.push('');

  // Status + elapsed
  const elapsed = state.startTime ? formatMs(Date.now() - state.startTime) : '0s';
  lines.push(`  Status: ${statusColor(state.status)}    Elapsed: ${chalk.white(elapsed)}`);
  lines.push('');

  // Progress bar
  const done = state.completedCount + state.failedCount;
  const hasActive = state.status === 'running' && state.currentStepIndex >= 0;
  lines.push(`  ${progressBar(done, state.totalSteps, hasActive)}`);
  lines.push('');

  // Step list
  const steps = state.steps || [];
  const visible = steps.slice(0, MAX_VISIBLE_STEPS);

  for (const step of visible) {
    const icon = stepIcon(step.status);
    const dur = step.duration ? chalk.dim(` ${formatMs(step.duration)}`) : '';
    const running = step.status === 'running' ? chalk.dim(' \u2190 running') : '';
    lines.push(`  ${icon} ${step.number}. ${step.name}${dur}${running}`);
  }

  if (steps.length > MAX_VISIBLE_STEPS) {
    const remaining = steps.length - MAX_VISIBLE_STEPS;
    lines.push(chalk.dim(`  ... (${remaining} more)`));
  }

  lines.push('');

  // Claude output panel
  if (state.currentStepOutput && state.status === 'running') {
    lines.push(chalk.cyan.bold('  Claude Code Output'));
    lines.push(chalk.dim('  ' + '\u2500'.repeat(50)));

    const outputLines = state.currentStepOutput.split('\n');
    const visible = outputLines.slice(-MAX_OUTPUT_LINES);

    if (outputLines.length > MAX_OUTPUT_LINES) {
      lines.push(chalk.dim(`  ... (${outputLines.length - MAX_OUTPUT_LINES} lines above)`));
    }

    for (const line of visible) {
      lines.push('  ' + chalk.dim(line));
    }
    lines.push('');
  }

  // Counts
  const parts = [];
  if (state.completedCount > 0) parts.push(chalk.green(`${state.completedCount} passed`));
  if (state.failedCount > 0) parts.push(chalk.red(`${state.failedCount} failed`));
  if (parts.length > 0) lines.push(`  ${parts.join(', ')}`);

  // Error message
  if (state.error) {
    lines.push('');
    lines.push(chalk.red(`  Error: ${state.error}`));
  }

  // Footer
  lines.push('');
  if (['completed', 'stopped', 'error'].includes(state.status)) {
    lines.push(chalk.dim('  Run finished. This window will close shortly.'));
  } else {
    lines.push(chalk.dim('  Press Ctrl+C to close this window.'));
    lines.push(chalk.dim('  NightyTidy continues running in the background.'));
  }
  lines.push('');

  // Clear screen and draw
  process.stdout.write('\x1B[2J\x1B[H');
  process.stdout.write(lines.join('\n'));
}

function startPolling(filePath) {
  progressFilePath = filePath;
  let lastState = null;

  const interval = setInterval(() => {
    try {
      const newState = readState();
      if (newState) lastState = newState;

      if (lastState) {
        render(lastState);

        if (['completed', 'stopped', 'error'].includes(lastState.status)) {
          clearInterval(interval);
          setTimeout(() => process.exit(0), EXIT_DELAY);
        }
      }
    } catch {
      // Render or read failed — retry on next tick; don't crash the window
    }
  }, POLL_INTERVAL);

  // Initial render attempt
  try {
    const initial = readState();
    if (initial) {
      lastState = initial;
      render(initial);
    }
  } catch {
    // Will retry on next interval
  }
}

// Only run as main entry point — safe to import without side effects
const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('dashboard-tui.js');

if (isMain) {
  // Prevent uncaught errors from silently closing the window
  process.on('uncaughtException', (err) => {
    try { process.stderr.write(`[dashboard-tui] uncaught: ${err?.message || err}\n`); } catch { /* ignore */ }
  });

  const path = process.argv[2];
  if (!path) {
    console.error('Usage: node dashboard-tui.js <progress-file-path>');
    process.exit(1);
  }
  startPolling(path);
}
