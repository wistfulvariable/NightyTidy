import { createServer } from 'http';
import { randomBytes } from 'crypto';
import { spawn } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { info, warn } from './logger.js';
import { getHTML } from './dashboard-html.js';

const SHUTDOWN_DELAY = 3000;
const URL_FILENAME = 'nightytidy-dashboard.url';
const PROGRESS_FILENAME = 'nightytidy-progress.json';
const OUTPUT_BUFFER_SIZE = 100 * 1024; // 100KB rolling buffer per step
const OUTPUT_WRITE_INTERVAL = 500; // ms — throttle disk writes for output
const MAX_BODY_BYTES = 1024; // 1 KB — stop endpoint only needs a small JSON body

let server = null;
let sseClients = new Set();
let currentState = null;
let urlFilePath = null;
let progressFilePath = null;
let shutdownTimer = null;
let tuiProcess = null;
let csrfToken = null;
let outputBuffer = '';
let outputWritePending = false;
let outputWriteTimer = null;

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'",
};

function serveHTML(res) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS });
  res.end(getHTML(csrfToken));
}

function handleSSE(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  // Send current state immediately
  if (currentState) {
    res.write(`event: state\ndata: ${JSON.stringify(currentState)}\n\n`);
  }

  // Send current output buffer so late-joining clients see existing output
  if (outputBuffer) {
    res.write(`event: output\ndata: ${JSON.stringify(outputBuffer)}\n\n`);
  }

  sseClients.add(res);

  res.on('close', () => {
    sseClients.delete(res);
  });
}

function handleStop(req, res, onStop) {
  let body = '';
  req.on('data', chunk => {
    body += chunk;
    if (body.length > MAX_BODY_BYTES) {
      req.destroy();
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Request body too large' }));
      return;
    }
  });
  req.on('end', () => {
    // Verify CSRF token to prevent cross-origin stop requests
    try {
      const parsed = JSON.parse(body || '{}');
      if (parsed.token !== csrfToken) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid token' }));
        return;
      }
    } catch {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid token' }));
      return;
    }
    try { onStop(); } catch { /* abort may throw if already aborted */ }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
}

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

function spawnTuiWindow() {
  if (!progressFilePath) return;
  try {
    const tuiScript = fileURLToPath(new URL('./dashboard-tui.js', import.meta.url));

    if (process.platform === 'win32') {
      // Use shell:true so Node.js invokes cmd.exe /d /s /c "..." which:
      //   /d — disables AutoRun registry interference
      //   /s — reliably strips only the outer wrapper quotes
      // This avoids Node.js argument-escaping edge cases with cmd.exe
      // that can misparse paths containing spaces.
      tuiProcess = spawn(
        `start "NightyTidy Progress" node "${tuiScript}" "${progressFilePath}"`,
        [],
        { shell: true, stdio: 'ignore', windowsHide: true },
      );
    } else if (process.platform === 'darwin') {
      tuiProcess = spawn('open', ['-a', 'Terminal', tuiScript, '--args', progressFilePath], {
        detached: true,
        stdio: 'ignore',
      });
    } else {
      // Linux — try common terminal emulators
      tuiProcess = spawn('x-terminal-emulator', ['-e', 'node', tuiScript, progressFilePath], {
        detached: true,
        stdio: 'ignore',
      });
    }

    tuiProcess.unref();
    info('Dashboard window opened');
  } catch (err) {
    warn(`Could not open dashboard window: ${err.message}`);
    tuiProcess = null;
  }
}

export async function startDashboard(initialState, { onStop, projectDir }) {
  try {
    csrfToken = randomBytes(16).toString('hex');
    currentState = initialState;
    urlFilePath = path.join(projectDir, URL_FILENAME);
    progressFilePath = path.join(projectDir, PROGRESS_FILENAME);

    // Write initial progress file and spawn TUI window
    try {
      writeFileSync(progressFilePath, JSON.stringify(initialState), 'utf8');
    } catch { /* non-critical */ }
    spawnTuiWindow();

    return await new Promise((resolve, reject) => {
      server = createServer((req, res) => handleRequest(req, res, onStop));

      server.on('error', (err) => {
        info(`Dashboard server could not start: ${err.message} — continuing with TUI fallback`);
        server = null;
        // TUI still works via file — return success
        resolve({ url: null, port: null });
      });

      // Prevent slow/malicious clients from holding connections indefinitely.
      // SSE connections are excluded by design (they write headers immediately
      // and remain open). These timeouts only affect regular HTTP requests.
      server.requestTimeout = 30_000;  // 30s — max time for entire request
      server.headersTimeout = 15_000;  // 15s — max time to receive headers

      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        const url = `http://localhost:${port}`;

        try {
          writeFileSync(urlFilePath, url + '\n', 'utf8');
        } catch { /* non-critical */ }

        info(`Dashboard server at ${url}`);
        resolve({ url, port });
      });
    });
  } catch (err) {
    warn(`Dashboard could not start: ${err.message}`);
    server = null;
    return null;
  }
}

export function updateDashboard(state) {
  currentState = state;

  const json = JSON.stringify(state);

  if (progressFilePath) {
    try {
      writeFileSync(progressFilePath, json, 'utf8');
    } catch { /* non-critical */ }
  }

  if (!server) return;

  const ssePayload = `event: state\ndata: ${json}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(ssePayload);
    } catch {
      sseClients.delete(client);
    }
  }
}

export function stopDashboard() {
  clearOutputBuffer();

  // Clear any pending broadcastOutput throttle timer (FINDING-07, audit #21)
  if (outputWriteTimer) {
    clearTimeout(outputWriteTimer);
    outputWriteTimer = null;
    outputWritePending = false;
  }

  if (shutdownTimer) {
    clearTimeout(shutdownTimer);
    shutdownTimer = null;
  }

  // Always clean up ephemeral files, even if no HTTP server was started (TUI-only mode)
  if (urlFilePath) {
    try { unlinkSync(urlFilePath); } catch { /* already gone */ }
    urlFilePath = null;
  }

  if (progressFilePath) {
    try { unlinkSync(progressFilePath); } catch { /* already gone */ }
    progressFilePath = null;
  }

  csrfToken = null;

  if (!server) {
    currentState = null;
    return;
  }

  // Close all SSE connections
  for (const client of sseClients) {
    try { client.end(); } catch { /* ignore */ }
  }
  sseClients.clear();

  try {
    server.close();
  } catch { /* ignore */ }
  server = null;

  currentState = null;
}

export function broadcastOutput(chunk) {
  // Append to rolling buffer, trim from front if over limit
  outputBuffer += chunk;
  if (outputBuffer.length > OUTPUT_BUFFER_SIZE) {
    outputBuffer = outputBuffer.slice(outputBuffer.length - OUTPUT_BUFFER_SIZE);
  }

  // Throttled write to progress JSON (avoid thrashing disk on every chunk)
  if (!outputWritePending && progressFilePath && currentState) {
    outputWritePending = true;
    outputWriteTimer = setTimeout(() => {
      outputWritePending = false;
      outputWriteTimer = null;
      if (progressFilePath && currentState) {
        currentState.currentStepOutput = outputBuffer;
        try {
          writeFileSync(progressFilePath, JSON.stringify(currentState), 'utf8');
        } catch { /* non-critical */ }
      }
    }, OUTPUT_WRITE_INTERVAL);
  }

  if (!server) return;

  // Stream raw chunk to all SSE clients (JSON-encoded to handle newlines)
  const ssePayload = `event: output\ndata: ${JSON.stringify(chunk)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(ssePayload);
    } catch {
      sseClients.delete(client);
    }
  }
}

export function clearOutputBuffer() {
  outputBuffer = '';
  if (currentState) {
    delete currentState.currentStepOutput;
  }
}

export function scheduleShutdown() {
  shutdownTimer = setTimeout(() => stopDashboard(), SHUTDOWN_DELAY);
}
