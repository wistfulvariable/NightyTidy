#!/usr/bin/env node

// Standalone dashboard HTTP server for orchestrator mode.
// Spawned as a detached process by orchestrator.js during --init-run.
// Polls nightytidy-progress.json for state updates and serves the
// browser dashboard with SSE push. Killed by --finish-run via PID.

import { createServer } from 'http';
import { readFileSync, writeFileSync } from 'fs';
import { randomBytes } from 'crypto';
import { getHTML } from './dashboard-html.js';

const POLL_INTERVAL = 500;
const MAX_BODY_BYTES = 1024; // 1 KB — stop endpoint only needs a small JSON body

const projectDir = process.argv[2];
if (!projectDir) {
  process.stderr.write('Usage: dashboard-standalone.js <projectDir>\n');
  process.exit(1);
}

const progressPath = `${projectDir}/nightytidy-progress.json`;
const urlFilePath = `${projectDir}/nightytidy-dashboard.url`;
const csrfToken = randomBytes(16).toString('hex');

let currentState = null;
let lastRawJson = '';
let lastOutputLength = 0;
let lastStepName = '';
const sseClients = new Set();
let pollIntervalId = null;

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'",
};

function pollProgress() {
  try {
    const raw = readFileSync(progressPath, 'utf8');

    // Only push if file content actually changed (avoids redundant JSON.parse + stringify)
    if (raw === lastRawJson) return;
    lastRawJson = raw;

    const state = JSON.parse(raw);
    currentState = state;

    // Reset output tracking when step changes
    if (state.currentStepName !== lastStepName) {
      lastOutputLength = 0;
      lastStepName = state.currentStepName || '';
    }

    // Send only new output as SSE output event
    if (state.currentStepOutput && state.currentStepOutput.length > lastOutputLength) {
      const newChunk = state.currentStepOutput.slice(lastOutputLength);
      lastOutputLength = state.currentStepOutput.length;
      const outputPayload = `event: output\ndata: ${JSON.stringify(newChunk)}\n\n`;
      for (const client of sseClients) {
        try { client.write(outputPayload); } catch { sseClients.delete(client); }
      }
    }

    const payload = `event: state\ndata: ${raw}\n\n`;
    for (const client of sseClients) {
      try { client.write(payload); } catch { sseClients.delete(client); }
    }
  } catch { /* file being written or invalid — skip this tick */ }
}

function handleRequest(req, res) {
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS });
    res.end(getHTML(csrfToken));
  } else if (req.method === 'GET' && req.url === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    if (currentState) {
      res.write(`event: state\ndata: ${JSON.stringify(currentState)}\n\n`);
    }
    sseClients.add(res);
    res.on('close', () => sseClients.delete(res));
  } else if (req.method === 'POST' && req.url === '/stop') {
    // CSRF-protected stop endpoint — no-op in orchestrator mode (abort is handled externally)
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
      try {
        const parsed = JSON.parse(body || '{}');
        if (parsed.token !== csrfToken) {
          res.writeHead(403, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
          res.end(JSON.stringify({ error: 'Invalid token' }));
          return;
        }
      } catch {
        res.writeHead(403, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
        res.end(JSON.stringify({ error: 'Invalid token' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ ok: true, message: 'Stop not supported in orchestrator mode' }));
    });
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain', ...SECURITY_HEADERS });
    res.end('Not found');
  }
}

const server = createServer(handleRequest);

// Prevent slow/malicious clients from holding connections indefinitely.
// SSE connections excluded by design (headers written immediately, stay open).
server.requestTimeout = 30_000;  // 30s — max time for entire request
server.headersTimeout = 15_000;  // 15s — max time to receive headers

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  const url = `http://localhost:${port}`;

  try { writeFileSync(urlFilePath, url + '\n', 'utf8'); } catch { /* non-critical */ }

  // Pre-populate currentState from progress file so SSE clients connecting
  // before the first poll tick get immediate data instead of a blank dashboard.
  try {
    const raw = readFileSync(progressPath, 'utf8');
    currentState = JSON.parse(raw);
    lastRawJson = raw;
  } catch { /* file may not exist yet — first poll will pick it up */ }

  // Write port to stdout so the spawning process can capture it
  process.stdout.write(JSON.stringify({ port, url, pid: process.pid }) + '\n');

  pollIntervalId = setInterval(pollProgress, POLL_INTERVAL);
});

server.on('error', (err) => {
  process.stderr.write(`Dashboard server error: ${err.message}\n`);
  process.exit(1);
});

// Graceful shutdown with force-exit safety net.
// server.close() waits for all connections to drain, but SSE connections
// never close on their own. The 10s timeout guarantees termination even
// if client.end() fails silently or new connections arrive after cleanup.
const SHUTDOWN_FORCE_EXIT_MS = 10_000;

process.on('SIGTERM', () => {
  if (pollIntervalId) clearInterval(pollIntervalId);
  for (const client of sseClients) { try { client.end(); } catch { /* ignore */ } }
  sseClients.clear();
  const forceTimer = setTimeout(() => process.exit(0), SHUTDOWN_FORCE_EXIT_MS);
  forceTimer.unref();
  server.close(() => process.exit(0));
});
