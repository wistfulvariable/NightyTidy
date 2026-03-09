/**
 * NightyTidy Desktop GUI — Node.js backend server.
 * Serves static files + API endpoints for the GUI.
 * Opens Chrome in --app mode for a native-feeling window.
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { spawn, execSync } from 'node:child_process';
import { join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const RESOURCES_DIR = join(__dirname, 'resources');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const MAX_BODY_BYTES = 1024 * 1024; // 1 MB — prevents memory exhaustion from oversized POST bodies

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'",
};

// Track spawned processes for cleanup
const activeProcesses = new Map();
let serverInstance = null;

// ── Static File Serving ────────────────────────────────────────────

async function serveStatic(res, urlPath) {
  const safePath = urlPath === '/' ? '/index.html' : urlPath;
  const filePath = join(RESOURCES_DIR, safePath);

  // Prevent directory traversal
  if (!filePath.startsWith(RESOURCES_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const content = await readFile(filePath);
    const ext = extname(filePath);
    const headers = {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      ...SECURITY_HEADERS,
    };
    res.writeHead(200, headers);
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not Found');
  }
}

// ── API: Folder Dialog ─────────────────────────────────────────────

async function handleSelectFolder(res) {
  const platform = process.platform;

  try {
    let folder = null;

    if (platform === 'win32') {
      // Use PowerShell's folder browser dialog
      const ps = `Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = 'Select target project'; $f.ShowNewFolderButton = $false; if ($f.ShowDialog() -eq 'OK') { $f.SelectedPath } else { '' }`;
      const result = execSync(`powershell -NoProfile -Command "${ps}"`, { encoding: 'utf-8', timeout: 60000 });
      folder = result.trim() || null;
    } else if (platform === 'darwin') {
      // macOS: use osascript
      const result = execSync(
        `osascript -e 'POSIX path of (choose folder with prompt "Select target project")'`,
        { encoding: 'utf-8', timeout: 60000 }
      ).trim();
      folder = result || null;
    } else {
      // Linux: try zenity, then kdialog
      try {
        const result = execSync(
          `zenity --file-selection --directory --title="Select target project"`,
          { encoding: 'utf-8', timeout: 60000 }
        ).trim();
        folder = result || null;
      } catch {
        const result = execSync(
          `kdialog --getexistingdirectory .`,
          { encoding: 'utf-8', timeout: 60000 }
        ).trim();
        folder = result || null;
      }
    }

    sendJson(res, { ok: true, folder });
  } catch (err) {
    // User cancelled or dialog failed
    sendJson(res, { ok: true, folder: null });
  }
}

// ── API: Run Command ───────────────────────────────────────────────

async function handleRunCommand(req, res) {
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

    // Track for cleanup
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
}

// ── API: Kill Process ──────────────────────────────────────────────

async function handleKillProcess(req, res) {
  const body = await readBody(req);
  const { id } = body;

  if (!id) {
    sendJson(res, { ok: false, error: 'No process id provided' }, 400);
    return;
  }

  const proc = activeProcesses.get(id);
  if (proc) {
    try {
      // On Windows, kill the process tree
      if (process.platform === 'win32') {
        execSync(`taskkill /pid ${proc.pid} /T /F`, { windowsHide: true });
      } else {
        proc.kill('SIGTERM');
      }
      activeProcesses.delete(id);
      sendJson(res, { ok: true });
    } catch (err) {
      sendJson(res, { ok: false, error: err.message });
    }
  } else {
    sendJson(res, { ok: true }); // Already dead
  }
}

// ── API: Read File ─────────────────────────────────────────────────

async function handleReadFile(req, res) {
  const body = await readBody(req);
  const { path: filePath } = body;

  if (!filePath) {
    sendJson(res, { ok: false, error: 'No path provided' }, 400);
    return;
  }

  try {
    const content = await readFile(resolve(filePath), 'utf-8');
    sendJson(res, { ok: true, content });
  } catch {
    sendJson(res, { ok: false, error: 'File not found or unreadable' });
  }
}

// ── API: Shutdown ──────────────────────────────────────────────────

function handleExit(res) {
  sendJson(res, { ok: true });
  // Kill all active processes
  for (const [id, proc] of activeProcesses) {
    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /pid ${proc.pid} /T /F`, { windowsHide: true });
      } else {
        proc.kill('SIGTERM');
      }
    } catch { /* ignore */ }
  }
  activeProcesses.clear();
  setTimeout(() => process.exit(0), 200);
}

// ── Helpers ────────────────────────────────────────────────────────

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
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve({});
      }
    });
  });
}

function sendJson(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
  });
  res.end(JSON.stringify(data));
}

// ── Router ─────────────────────────────────────────────────────────

function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost`);

  // API routes
  if (url.pathname === '/api/select-folder' && req.method === 'POST') {
    return handleSelectFolder(res);
  }
  if (url.pathname === '/api/run-command' && req.method === 'POST') {
    return handleRunCommand(req, res);
  }
  if (url.pathname === '/api/kill-process' && req.method === 'POST') {
    return handleKillProcess(req, res);
  }
  if (url.pathname === '/api/read-file' && req.method === 'POST') {
    return handleReadFile(req, res);
  }
  if (url.pathname === '/api/exit' && req.method === 'POST') {
    return handleExit(res);
  }

  // Static files
  return serveStatic(res, url.pathname);
}

// ── Chrome Launcher ────────────────────────────────────────────────

function findChrome() {
  const paths = process.platform === 'win32'
    ? [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
      ]
    : process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
      : ['google-chrome', 'google-chrome-stable', 'chromium-browser', 'chromium'];

  for (const p of paths) {
    try {
      // Check if path exists (absolute) or is in PATH (basename)
      if (p.includes('/') || p.includes('\\')) {
        const s = statSync(p);
        if (s.isFile()) return p;
      } else {
        execSync(`which ${p}`, { stdio: 'ignore' });
        return p;
      }
    } catch { /* try next */ }
  }
  return null;
}

function launchChrome(url) {
  const chromePath = findChrome();
  if (!chromePath) {
    console.log(`\n  NightyTidy GUI is running at: ${url}`);
    console.log('  Chrome not found — open the URL above in any browser.\n');
    return null;
  }

  const args = [
    `--app=${url}`,
    '--disable-extensions',
    '--disable-default-apps',
    `--window-size=900,700`,
  ];

  const chrome = spawn(chromePath, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });

  chrome.unref();

  // Note: Do NOT auto-exit when Chrome closes. If Chrome is already
  // running, the spawned process exits immediately (delegates to
  // existing instance). Server shuts down via /api/exit or Ctrl+C.

  return chrome;
}

// ── Cleanup ────────────────────────────────────────────────────────

function cleanup() {
  for (const [id, proc] of activeProcesses) {
    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /pid ${proc.pid} /T /F`, { windowsHide: true });
      } else {
        proc.kill('SIGTERM');
      }
    } catch { /* ignore */ }
  }
  activeProcesses.clear();
  if (serverInstance) {
    serverInstance.close();
    serverInstance = null;
  }
}

// ── Main ───────────────────────────────────────────────────────────

const server = createServer(handleRequest);
serverInstance = server;

server.listen(0, '127.0.0.1', () => {
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}`;
  console.log(`NightyTidy GUI server running on ${url}`);
  launchChrome(url);
});

// Graceful shutdown
process.on('SIGINT', () => { cleanup(); process.exit(0); });
process.on('SIGTERM', () => { cleanup(); process.exit(0); });
