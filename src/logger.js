/**
 * @fileoverview File + stdout logger with chalk coloring.
 *
 * Error contract: Throws if used before initialization. After init, all
 * logging functions are safe to call and never throw.
 *
 * @module logger
 */

import { appendFileSync, writeFileSync } from 'fs';
import path from 'path';
import chalk from 'chalk';

/** @typedef {'debug' | 'info' | 'warn' | 'error'} LogLevel */

/** @type {Record<LogLevel, number>} */
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

/** @type {Record<string, string>} */
const LEVEL_COLORS = { debug: 'dim', warn: 'yellow', error: 'red' };

/** @type {string|null} */
let logFilePath = null;

/** @type {number} */
let minLevel = LEVELS.info;

/** @type {boolean} */
let logQuiet = false;

/**
 * Initialize the logger with a project directory.
 * Must be called before any other logging function.
 *
 * @param {string} projectDir - Directory where log file will be created
 * @param {Object} [options] - Configuration options
 * @param {boolean} [options.quiet=false] - If true, suppress stdout output
 * @throws {Error} If projectDir is invalid or file cannot be created
 */
export function initLogger(projectDir, { quiet = false } = {}) {
  logFilePath = path.join(projectDir, 'nightytidy-run.log');
  logQuiet = quiet;
  writeFileSync(logFilePath, '', 'utf8');

  const envLevel = (process.env.NIGHTYTIDY_LOG_LEVEL || 'info').toLowerCase();
  if (process.env.NIGHTYTIDY_LOG_LEVEL && !(envLevel in LEVELS)) {
    process.stderr.write(
      `[warn] Unknown NIGHTYTIDY_LOG_LEVEL="${process.env.NIGHTYTIDY_LOG_LEVEL}" — ` +
      `valid values: ${Object.keys(LEVELS).join(', ')}. Defaulting to "info".\n`
    );
  }
  minLevel = LEVELS[envLevel] ?? LEVELS.info;
}

/**
 * Internal log function that writes to file and optionally stdout.
 *
 * @param {LogLevel} level - Log level
 * @param {string} message - Message to log
 * @throws {Error} If logger not initialized
 */
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

  if (!logQuiet) {
    const colorFn = LEVEL_COLORS[level] ? chalk[LEVEL_COLORS[level]] : chalk.white;
    process.stdout.write(colorFn(line));
  }
}

/**
 * Log a debug-level message.
 * @param {string} message - Message to log
 */
export function debug(message) { log('debug', message); }

/**
 * Log an info-level message.
 * @param {string} message - Message to log
 */
export function info(message)  { log('info', message); }

/**
 * Log a warning-level message.
 * @param {string} message - Message to log
 */
export function warn(message)  { log('warn', message); }

/**
 * Log an error-level message.
 * @param {string} message - Message to log
 */
export function error(message) { log('error', message); }
