/**
 * Integration tests for gui/server.js — HTTP server API endpoints.
 *
 * gui/server.js has top-level side effects (createServer + listen + Chrome launch),
 * so it cannot be imported directly. Instead, we re-implement the routing logic
 * here to verify the API contracts: request/response shapes, error handling, and
 * security behavior (traversal prevention, security headers).
 *
 * API surface tested:
 *   - GET / and static files (index.html, css, js)
 *   - POST /api/config — returns nightytidy binary path
 *   - POST /api/read-file — read file by path
 *   - POST /api/run-command — execute shell command
 *   - POST /api/kill-process — kill active process by id
 *   - Security headers (CSP, X-Frame-Options, X-Content-Type-Options)
 *   - Directory traversal prevention (403)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { unlinkSync, existsSync } from 'node:fs';
import { join, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESOURCES_DIR = join(__dirname, '..', 'gui', 'resources');
const NIGHTYTIDY_BIN = join(__dirname, '..', 'bin', 'nightytidy.js');

// ── Minimal test server (mirrors server.js routing) ────────────────
// We re-implement the core routing to test without launching Chrome.

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const MAX_BODY_BYTES = 1024 * 1024; // 1 MB — mirrors server.js

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'",
};

// Track spawned processes — mirrors server.js activeProcesses
const activeProcesses = new Map();

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    let aborted = false;
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > MAX_BODY_BYTES) {
        aborted = true;
        req.destroy();
        resolve({});
      }
    });
    req.on('end', () => {
      if (aborted) return;
      try { resolve(JSON.parse(data)); } catch { resolve({}); }
    });
  });
}

function sendJson(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
  });
  res.end(JSON.stringify(data));
}

let server;
let baseUrl;

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');

    // API: config
    if (url.pathname === '/api/config' && req.method === 'POST') {
      sendJson(res, { ok: true, bin: NIGHTYTIDY_BIN });
      return;
    }

    // API: read-file
    if (url.pathname === '/api/read-file' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.path) {
        sendJson(res, { ok: false, error: 'No path provided' }, 400);
        return;
      }
      try {
        const content = await readFile(resolve(body.path), 'utf-8');
        sendJson(res, { ok: true, content });
      } catch {
        sendJson(res, { ok: false, error: 'File not found or unreadable' });
      }
      return;
    }

    // API: run-command — mirrors server.js handleRunCommand
    if (url.pathname === '/api/run-command' && req.method === 'POST') {
      const body = await readBody(req);
      const { command, id } = body;
      if (!command) {
        sendJson(res, { ok: false, error: 'No command provided' }, 400);
        return;
      }
      try {
        const isWin = process.platform === 'win32';
        const shell = isWin ? 'cmd.exe' : '/bin/sh';
        const shellArgs = isWin ? ['/c', command] : ['-c', command];
        const proc = spawn(shell, shellArgs, {
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        });
        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
        proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
        if (id) activeProcesses.set(id, proc);
        proc.on('close', (exitCode) => {
          if (id) activeProcesses.delete(id);
          sendJson(res, { ok: true, exitCode: exitCode ?? 1, stdout, stderr });
        });
        proc.on('error', (err) => {
          if (id) activeProcesses.delete(id);
          sendJson(res, { ok: false, error: err.message });
        });
      } catch (err) {
        sendJson(res, { ok: false, error: err.message });
      }
      return;
    }

    // API: kill-process — mirrors server.js handleKillProcess
    if (url.pathname === '/api/kill-process' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.id) {
        sendJson(res, { ok: false, error: 'No process id provided' }, 400);
        return;
      }
      const proc = activeProcesses.get(body.id);
      if (proc) {
        try {
          proc.kill('SIGTERM');
          activeProcesses.delete(body.id);
          sendJson(res, { ok: true });
        } catch (err) {
          sendJson(res, { ok: false, error: err.message });
        }
      } else {
        sendJson(res, { ok: true }); // Already dead
      }
      return;
    }

    // API: delete-file — mirrors server.js handleDeleteFile
    if (url.pathname === '/api/delete-file' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.path) {
        sendJson(res, { ok: false, error: 'No path provided' }, 400);
        return;
      }
      const name = body.path.replace(/\\/g, '/').split('/').pop();
      const ALLOWED = ['nightytidy-run-state.json', 'nightytidy.lock', 'nightytidy-progress.json'];
      if (!ALLOWED.includes(name)) {
        sendJson(res, { ok: false, error: 'Not an allowed file' }, 403);
        return;
      }
      try {
        unlinkSync(resolve(body.path));
        sendJson(res, { ok: true });
      } catch {
        sendJson(res, { ok: true }); // Already gone
      }
      return;
    }

    // Static files
    const safePath = url.pathname === '/' ? '/index.html' : url.pathname;
    const filePath = join(RESOURCES_DIR, safePath);
    if (!filePath.startsWith(RESOURCES_DIR)) {
      res.writeHead(403, { 'Content-Type': 'text/plain', ...SECURITY_HEADERS });
      res.end('Forbidden');
      return;
    }
    try {
      const content = await readFile(filePath);
      const ext = extname(filePath);
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        ...SECURITY_HEADERS,
      });
      res.end(content);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain', ...SECURITY_HEADERS });
      res.end('Not found');
    }
  });

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  // Kill any lingering test processes
  for (const [, proc] of activeProcesses) {
    try { proc.kill('SIGTERM'); } catch { /* ignore */ }
  }
  activeProcesses.clear();
  if (server) server.close();
});

// ── Static File Serving ────────────────────────────────────────────

describe('static file serving', () => {
  it('serves index.html at root path', async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('<!DOCTYPE html>');
    expect(body).toContain('NightyTidy');
  });

  it('serves styles.css', async () => {
    const res = await fetch(`${baseUrl}/styles.css`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/css');
    const body = await res.text();
    expect(body).toContain(':root');
    expect(body).toContain('--cyan');
  });

  it('serves logic.js', async () => {
    const res = await fetch(`${baseUrl}/logic.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('javascript');
    const body = await res.text();
    expect(body).toContain('buildCommand');
    expect(body).toContain('parseCliOutput');
  });

  it('serves app.js', async () => {
    const res = await fetch(`${baseUrl}/app.js`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('showScreen');
    expect(body).toContain('runCli');
  });

  it('returns 404 for nonexistent files', async () => {
    const res = await fetch(`${baseUrl}/nonexistent.txt`);
    expect(res.status).toBe(404);
  });
});

// ── API: Config ────────────────────────────────────────────────────

describe('config API', () => {
  it('returns ok:true with nightytidy bin path', async () => {
    const res = await fetch(`${baseUrl}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.bin).toBe(NIGHTYTIDY_BIN);
    expect(data.bin).toContain('nightytidy.js');
  });
});

// ── API: Read File ─────────────────────────────────────────────────

describe('read-file API', () => {
  it('reads an existing file', async () => {
    const testFile = join(RESOURCES_DIR, 'logic.js');
    const res = await fetch(`${baseUrl}/api/read-file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: testFile }),
    });
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.content).toContain('buildCommand');
  });

  it('returns error for nonexistent file', async () => {
    const res = await fetch(`${baseUrl}/api/read-file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/tmp/nonexistent-file-12345.json' }),
    });
    const data = await res.json();
    expect(data.ok).toBe(false);
  });
});

// ── Delete File API ────────────────────────────────────────────────

describe('delete-file API', () => {
  it('deletes an allowed NightyTidy ephemeral file', async () => {
    const { tmpdir } = await import('node:os');
    const target = join(tmpdir(), 'nightytidy-run-state.json');
    await writeFile(target, '{}');
    expect(existsSync(target)).toBe(true);

    const res = await fetch(`${baseUrl}/api/delete-file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: target }),
    });
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(existsSync(target)).toBe(false);
  });

  it('returns ok even if the file does not exist', async () => {
    const res = await fetch(`${baseUrl}/api/delete-file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/tmp/nightytidy-run-state.json' }),
    });
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  it('rejects deletion of non-allowed files', async () => {
    const res = await fetch(`${baseUrl}/api/delete-file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/tmp/package.json' }),
    });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.ok).toBe(false);
  });

  it('returns 400 when no path provided', async () => {
    const res = await fetch(`${baseUrl}/api/delete-file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('allows deleting nightytidy.lock', async () => {
    const { tmpdir } = await import('node:os');
    const target = join(tmpdir(), 'nightytidy.lock');
    await writeFile(target, '{}');

    const res = await fetch(`${baseUrl}/api/delete-file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: target }),
    });
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(existsSync(target)).toBe(false);
  });
});

// ── HTML Structure Tests ───────────────────────────────────────────

describe('HTML structure', () => {
  let html;

  beforeAll(async () => {
    const res = await fetch(`${baseUrl}/`);
    html = await res.text();
  });

  it('has all 5 screen sections', () => {
    expect(html).toContain('id="screen-setup"');
    expect(html).toContain('id="screen-steps"');
    expect(html).toContain('id="screen-running"');
    expect(html).toContain('id="screen-finishing"');
    expect(html).toContain('id="screen-summary"');
  });

  it('has the setup screen active by default', () => {
    expect(html).toContain('id="screen-setup" class="screen active"');
  });

  it('has all required buttons', () => {
    expect(html).toContain('id="btn-select-folder"');
    expect(html).toContain('id="btn-start-run"');
    expect(html).toContain('id="btn-stop-run"');
    expect(html).toContain('id="btn-new-run"');
    expect(html).toContain('id="btn-close-app"');
  });

  it('has the step checklist container', () => {
    expect(html).toContain('id="step-checklist"');
  });

  it('has the progress elements', () => {
    expect(html).toContain('id="progress-bar-fill"');
    expect(html).toContain('id="progress-counter"');
    expect(html).toContain('id="output-content"');
  });

  it('includes script references', () => {
    expect(html).toContain('src="/logic.js"');
    expect(html).toContain('src="/app.js"');
  });
});

// ── API: Run Command ────────────────────────────────────────────────

describe('run-command API', () => {
  it('executes a simple command and returns stdout', async () => {
    const echoCmd = process.platform === 'win32' ? 'echo hello' : 'echo hello';
    const res = await fetch(`${baseUrl}/api/run-command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: echoCmd, id: 'test-echo' }),
    });
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.exitCode).toBe(0);
    expect(data.stdout).toContain('hello');
  });

  it('returns non-zero exit code for failing commands', async () => {
    const failCmd = process.platform === 'win32' ? 'exit /b 42' : 'exit 42';
    const res = await fetch(`${baseUrl}/api/run-command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: failCmd }),
    });
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.exitCode).toBe(42);
  });

  it('returns 400 when no command provided', async () => {
    const res = await fetch(`${baseUrl}/api/run-command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toContain('No command');
  });

  it('captures stderr output', async () => {
    const stderrCmd = process.platform === 'win32'
      ? 'echo error message 1>&2'
      : 'echo error message >&2';
    const res = await fetch(`${baseUrl}/api/run-command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: stderrCmd }),
    });
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.stderr).toContain('error message');
  });
});

// ── API: Kill Process ───────────────────────────────────────────────

describe('kill-process API', () => {
  it('returns ok:true for nonexistent process id (already dead)', async () => {
    const res = await fetch(`${baseUrl}/api/kill-process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'nonexistent-process-id' }),
    });
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  it('returns 400 when no id provided', async () => {
    const res = await fetch(`${baseUrl}/api/kill-process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toContain('No process id');
  });
});

// ── API: Read File — additional edge cases ──────────────────────────

describe('read-file API — edge cases', () => {
  it('returns 400 when no path provided', async () => {
    const res = await fetch(`${baseUrl}/api/read-file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toContain('No path');
  });

  it('handles invalid JSON body gracefully', async () => {
    const res = await fetch(`${baseUrl}/api/read-file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    // readBody falls back to {} — missing path → 400
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.ok).toBe(false);
  });
});

// ── Security Headers ────────────────────────────────────────────────

describe('security headers on static files', () => {
  it('HTML response includes CSP, X-Frame-Options, and X-Content-Type-Options', async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
  });

  it('JS files include security headers', async () => {
    const res = await fetch(`${baseUrl}/logic.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
  });
});

// ── Security: Directory Traversal ───────────────────────────────────

describe('directory traversal protection', () => {
  it('returns 404 for path traversal attempts (not 200 with sensitive data)', async () => {
    // Attempt to escape RESOURCES_DIR — the resolved path won't start with RESOURCES_DIR
    const res = await fetch(`${baseUrl}/../../../package.json`);
    // Depending on URL normalization, this should be 403 or 404, never 200 with real content
    expect([403, 404]).toContain(res.status);
  });

  it('returns 404 for encoded traversal attempts', async () => {
    const res = await fetch(`${baseUrl}/%2e%2e/%2e%2e/package.json`);
    expect([403, 404]).toContain(res.status);
  });
});

// ── Response Shape Contracts ────────────────────────────────────────

describe('API response shape contracts', () => {
  it('JSON API responses do not include Access-Control-Allow-Origin (same-origin only)', async () => {
    const endpoints = [
      { url: '/api/read-file', body: { path: '/nonexistent' } },
      { url: '/api/kill-process', body: { id: 'fake' } },
    ];

    for (const ep of endpoints) {
      const res = await fetch(`${baseUrl}${ep.url}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ep.body),
      });
      expect(
        res.headers.get('access-control-allow-origin'),
        `${ep.url} should NOT have CORS header`,
      ).toBeNull();
    }
  });

  it('all JSON API responses have content-type application/json', async () => {
    const res = await fetch(`${baseUrl}/api/kill-process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'fake' }),
    });
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it('static files include X-Content-Type-Options: nosniff', async () => {
    const res = await fetch(`${baseUrl}/logic.js`);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});
