import { appendFileSync, writeFileSync } from 'fs';
import path from 'path';
import chalk from 'chalk';

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

let logFilePath = null;
let minLevel = LEVELS.info;

export function initLogger(projectDir) {
  logFilePath = path.join(projectDir, 'nightytidy-run.log');
  writeFileSync(logFilePath, '', 'utf8');

  const envLevel = (process.env.NIGHTYTIDY_LOG_LEVEL || 'info').toLowerCase();
  minLevel = LEVELS[envLevel] ?? LEVELS.info;
}

function log(level, message) {
  if (!logFilePath) {
    throw new Error('Logger not initialized. Call initLogger(projectDir) first.');
  }

  if (LEVELS[level] < minLevel) return;

  const timestamp = new Date().toISOString();
  const tag = level.toUpperCase().padEnd(5);
  const line = `[${timestamp}] [${tag}] ${message}\n`;

  try {
    appendFileSync(logFilePath, line, 'utf8');
  } catch {
    // If file write fails, still print to stderr
    process.stderr.write(`[logger file error] ${line}`);
  }

  const colorFn =
    level === 'debug' ? chalk.dim :
    level === 'warn'  ? chalk.yellow :
    level === 'error' ? chalk.red :
    chalk.white;

  process.stdout.write(colorFn(line));
}

export function debug(message) { log('debug', message); }
export function info(message)  { log('info', message); }
export function warn(message)  { log('warn', message); }
export function error(message) { log('error', message); }
