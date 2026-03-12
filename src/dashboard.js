/**
 * @fileoverview Dashboard progress display with HTTP server, SSE, and TUI fallback.
 *
 * Error contract: All errors are swallowed silently. Dashboard failure must not
 * crash a run. Fire-and-forget design.
 *
 * @module dashboard
 */

import { createServer } from 'http';
import { randomBytes } from 'crypto';
import { spawn } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { info, warn, debug } from './logger.js';
import { getHTML } from './dashboard-html.js';

/**
 * @typedef {Object} DashboardState
 * @property {string} status - Current status (e.g., 'running', 'completed')
 * @property {number} currentStep - Current step number
 * @property {number} totalSteps - Total number of steps
 * @property {string} [currentStepName] - Name of current step
 * @property {string} [currentStepOutput] - Output buffer for current step
 */

/**
 * @typedef {Object} DashboardResult
 * @property {string|null} url - Dashboard URL or null if server failed
 * @property {number|null} port - Server port or null if server failed
 */

/** Delay before auto-shutdown after run completion (ms) */
const SHUTDOWN_DELAY = 3000;

/** Dashboard URL file name in project directory */
const URL_FILENAME = 'nightytidy-dashboard.url';

/** Progress JSON file name in project directory */
const PROGRESS_FILENAME = 'nightytidy-progress.json';

/** Rolling output buffer size (100KB) */
const OUTPUT_BUFFER_SIZE = 100 * 1024;

/** Throttle interval for disk writes of output buffer (ms) */
const OUTPUT_WRITE_INTERVAL = 500;

/** Maximum POST body size for stop endpoint (1KB) */
const MAX_BODY_BYTES = 1024;

/**
 * Internal dashboard state object (singleton pattern).
 * @type {Object}
 */
let ds = {
  server: null,
  sseClients: new Set(),
  currentState: null,
  urlFilePath: null,
  progressFilePath: null,
  shutdownTimer: null,
  tuiProcess: null,
  csrfToken: null,
  outputBuffer: '',
  outputWritePending: false,
  outputWriteTimer: null,
};

/**
 * Reset dashboard state to initial values. Used for testing.
 */
export function resetDashboardState() {
  ds = {
    server: null,
    sseClients: new Set(),
    currentState: null,
    urlFilePath: null,
    progressFilePath: null,
    shutdownTimer: null,
    tuiProcess: null,
    csrfToken: null,
    outputBuffer: '',
    outputWritePending: false,
    outputWriteTimer: null,
  };
}

/**
 * Security headers applied to all responses.
 * @type {Record<string, string>}
 */
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'",
};

/**
 * Serve the dashboard HTML page.
 * @param {import('http').ServerResponse} res - HTTP response
 */
function serveHTML(res) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS });
  res.end(getHTML(ds.csrfToken));
}

/**
 * Handle Server-Sent Events connection.
 * @param {import('http').ServerResponse} res - HTTP response
 */
function handleSSE(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  // Send current state immediately
  if (ds.currentState) {
    res.write(`event: state\ndata: ${JSON.stringify(ds.currentState)}\n\n`);
  }

  // Send current output buffer so late-joining clients see existing output
  if (ds.outputBuffer) {
    res.write(`event: output\ndata: ${JSON.stringify(ds.outputBuffer)}\n\n`);
  }

  ds.sseClients.add(res);

  res.on('close', () => {
    ds.sseClients.delete(res);
  });
}

/**
 * Handle stop request with CSRF validation.
 * @param {import('http').IncomingMessage} req - HTTP request
 * @param {import('http').ServerResponse} res - HTTP response
 * @param {Function} onStop - Callback to invoke when stop is confirmed
 */
function handleStop(req, res, onStop) {
  let body = '';
  req.on('data', chunk => {
    body += chunk;
    if (body.length > MAX_BODY_BYTES) {
      req.destroy();
      res.writeHead(413, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: 'Request body too large' }));
      return;
    }
  });
  req.on('end', () => {
    // Verify CSRF token to prevent cross-origin stop requests
    try {
      const parsed = JSON.parse(body || '{}');
      if (parsed.token !== ds.csrfToken) {
        res.writeHead(403, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
        res.end(JSON.stringify({ error: 'Invalid token' }));
        return;
      }
    } catch {
      res.writeHead(403, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: 'Invalid token' }));
      return;
    }
    try { onStop(); } catch { /* abort may throw if already aborted */ }
    res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
    res.end(JSON.stringify({ ok: true }));
  });
}

/**
 * Main HTTP request router.
 * @param {import('http').IncomingMessage} req - HTTP request
 * @param {import('http').ServerResponse} res - HTTP response
 * @param {Function} onStop - Stop callback
 */
function handleRequest(req, res, onStop) {
  if (req.method === 'GET' && req.url === '/') {
    serveHTML(res);
  } else if (req.method === 'GET' && req.url === '/events') {
    handleSSE(res);
  } else if (req.method === 'POST' && req.url === '/stop') {
    handleStop(req, res, onStop);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain', ...SECURITY_HEADERS });
    res.end('Not found');
  }
}

/**
 * Spawn a TUI progress window in a terminal emulator.
 * Platform-specific: Windows uses 'start', macOS uses 'open', Linux uses x-terminal-emulator.
 */
function spawnTuiWindow() {
  if (!ds.progressFilePath) return;
  try {
    const tuiScript = fileURLToPath(new URL('./dashboard-tui.js', import.meta.url));

    if (process.platform === 'win32') {
      // Use shell:true so Node.js invokes cmd.exe /d /s /c "..." which:
      //   /d — disables AutoRun registry interference
      //   /s — reliably strips only the outer wrapper quotes
      // This avoids Node.js argument-escaping edge cases with cmd.exe
      // that can misparse paths containing spaces.
      ds.tuiProcess = spawn(
        `start "NightyTidy Progress" node "${tuiScript}" "${ds.progressFilePath}"`,
        [],
        { shell: true, stdio: 'ignore', windowsHide: true },
      );
    } else if (process.platform === 'darwin') {
      ds.tuiProcess = spawn('open', ['-a', 'Terminal', tuiScript, '--args', ds.progressFilePath], {
        detached: true,
        stdio: 'ignore',
      });
    } else {
      // Linux — try common terminal emulators
      ds.tuiProcess = spawn('x-terminal-emulator', ['-e', 'node', tuiScript, ds.progressFilePath], {
        detached: true,
        stdio: 'ignore',
      });
    }

    ds.tuiProcess.unref();
    info('Dashboard window opened');
  } catch (err) {
    warn(`Could not open dashboard window: ${err.message}`);
    ds.tuiProcess = null;
  }
}

/**
 * Start the dashboard HTTP server and TUI window.
 *
 * @param {DashboardState} initialState - Initial progress state
 * @param {Object} options - Options
 * @param {Function} options.onStop - Callback when user requests stop
 * @param {string} options.projectDir - Project directory for progress files
 * @returns {Promise<DashboardResult|null>} Dashboard info or null on failure
 */
export async function startDashboard(initialState, { onStop, projectDir }) {
  try {
    ds.csrfToken = randomBytes(16).toString('hex');
    ds.currentState = initialState;
    ds.urlFilePath = path.join(projectDir, URL_FILENAME);
    ds.progressFilePath = path.join(projectDir, PROGRESS_FILENAME);

    // Write initial progress file and spawn TUI window
    try {
      writeFileSync(ds.progressFilePath, JSON.stringify(initialState), 'utf8');
    } catch { /* non-critical */ }
    spawnTuiWindow();

    return await new Promise((resolve, reject) => {
      ds.server = createServer((req, res) => handleRequest(req, res, onStop));

      ds.server.on('error', (err) => {
        info(`Dashboard server could not start: ${err.message} — continuing with TUI fallback`);
        ds.server = null;
        // TUI still works via file — return success
        resolve({ url: null, port: null });
      });

      // Prevent slow/malicious clients from holding connections indefinitely.
      // SSE connections are excluded by design (they write headers immediately
      // and remain open). These timeouts only affect regular HTTP requests.
      ds.server.requestTimeout = 30_000;  // 30s — max time for entire request
      ds.server.headersTimeout = 15_000;  // 15s — max time to receive headers

      ds.server.listen(0, '127.0.0.1', () => {
        const port = ds.server.address().port;
        const url = `http://localhost:${port}`;

        try {
          writeFileSync(ds.urlFilePath, url + '\n', 'utf8');
        } catch (urlErr) {
          debug(`Could not write dashboard URL file: ${urlErr.message}`);
        }

        info(`Dashboard server at ${url}`);
        resolve({ url, port });
      });
    });
  } catch (err) {
    warn(`Dashboard could not start: ${err.message}`);
    ds.server = null;
    return null;
  }
}

/**
 * Update dashboard with new state. Broadcasts to SSE clients and writes progress file.
 * @param {DashboardState} state - New state to broadcast
 */
export function updateDashboard(state) {
  ds.currentState = state;

  const json = JSON.stringify(state);

  if (ds.progressFilePath) {
    try {
      writeFileSync(ds.progressFilePath, json, 'utf8');
    } catch { /* non-critical */ }
  }

  if (!ds.server) return;

  const ssePayload = `event: state\ndata: ${json}\n\n`;
  for (const client of ds.sseClients) {
    try {
      client.write(ssePayload);
    } catch {
      ds.sseClients.delete(client);
    }
  }
}

/**
 * Stop the dashboard server and clean up all resources.
 * Safe to call even if server isn't running.
 */
export function stopDashboard() {
  clearOutputBuffer();

  // Clear any pending broadcastOutput throttle timer (FINDING-07, audit #21)
  if (ds.outputWriteTimer) {
    clearTimeout(ds.outputWriteTimer);
    ds.outputWriteTimer = null;
    ds.outputWritePending = false;
  }

  if (ds.shutdownTimer) {
    clearTimeout(ds.shutdownTimer);
    ds.shutdownTimer = null;
  }

  // Always clean up ephemeral files, even if no HTTP server was started (TUI-only mode)
  if (ds.urlFilePath) {
    try { unlinkSync(ds.urlFilePath); } catch { /* already gone */ }
    ds.urlFilePath = null;
  }

  if (ds.progressFilePath) {
    try { unlinkSync(ds.progressFilePath); } catch { /* already gone */ }
    ds.progressFilePath = null;
  }

  ds.csrfToken = null;
  ds.tuiProcess = null;

  if (!ds.server) {
    ds.currentState = null;
    return;
  }

  // Close all SSE connections
  for (const client of ds.sseClients) {
    try { client.end(); } catch { /* ignore */ }
  }
  ds.sseClients.clear();

  try {
    ds.server.close();
  } catch { /* ignore */ }
  ds.server = null;

  ds.currentState = null;
}

/**
 * Broadcast output chunk to SSE clients and rolling buffer.
 * Throttles disk writes to avoid excessive I/O.
 * @param {string} chunk - Output chunk to broadcast
 */
export function broadcastOutput(chunk) {
  // Append to rolling buffer, trim from front if over limit
  ds.outputBuffer += chunk;
  if (ds.outputBuffer.length > OUTPUT_BUFFER_SIZE) {
    ds.outputBuffer = ds.outputBuffer.slice(ds.outputBuffer.length - OUTPUT_BUFFER_SIZE);
  }

  // Throttled write to progress JSON (avoid thrashing disk on every chunk)
  if (!ds.outputWritePending && ds.progressFilePath && ds.currentState) {
    ds.outputWritePending = true;
    ds.outputWriteTimer = setTimeout(() => {
      ds.outputWritePending = false;
      ds.outputWriteTimer = null;
      if (ds.progressFilePath && ds.currentState) {
        ds.currentState.currentStepOutput = ds.outputBuffer;
        try {
          writeFileSync(ds.progressFilePath, JSON.stringify(ds.currentState), 'utf8');
        } catch { /* non-critical */ }
      }
    }, OUTPUT_WRITE_INTERVAL);
  }

  if (!ds.server) return;

  // Stream raw chunk to all SSE clients (JSON-encoded to handle newlines)
  const ssePayload = `event: output\ndata: ${JSON.stringify(chunk)}\n\n`;
  for (const client of ds.sseClients) {
    try {
      client.write(ssePayload);
    } catch {
      ds.sseClients.delete(client);
    }
  }
}

/**
 * Clear the output buffer and remove from current state.
 */
export function clearOutputBuffer() {
  ds.outputBuffer = '';
  if (ds.currentState) {
    delete ds.currentState.currentStepOutput;
  }
}

/**
 * Schedule automatic dashboard shutdown after a delay.
 * Used when run completes to allow user to see final state.
 */
export function scheduleShutdown() {
  ds.shutdownTimer = setTimeout(() => stopDashboard(), SHUTDOWN_DELAY);
}
