/**
 * NightyTidy Desktop GUI — Node.js backend server.
 * Serves static files + API endpoints for the GUI.
 * Opens Chrome in --app mode for a native-feeling window.
 */

import http from 'node:http';
const { createServer } = http;
import { readFile } from 'node:fs/promises';
import { appendFileSync, openSync, closeSync, readFileSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import { spawn, execSync } from 'node:child_process';
import { join, extname, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const RESOURCES_DIR = join(__dirname, 'resources');
const NIGHTYTIDY_BIN = join(__dirname, '..', 'bin', 'nightytidy.js');

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
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; worker-src blob:",
};

// PowerShell script for the modern Windows folder picker (IFileOpenDialog COM).
// Uses FOS_PICKFOLDERS to show the standard Explorer-style dialog instead of the
// legacy FolderBrowserDialog tree view.
const FOLDER_PICKER_PS1 = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

[ComImport, Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")]
class FileOpenDialogRCW {}

[ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"),
 InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IShellItem {
    void BindToHandler();
    void GetParent();
    void GetDisplayName([In] uint sigdnName,
        [MarshalAs(UnmanagedType.LPWStr)] out string ppszName);
    void GetAttributes();
    void Compare();
}

[ComImport, Guid("42F85136-DB7E-439C-85F1-E4075D135FC8"),
 InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IFileDialog {
    [PreserveSig] int Show(IntPtr hwndOwner);
    void SetFileTypes();
    void SetFileTypeIndex();
    void GetFileTypeIndex();
    void Advise();
    void Unadvise();
    void SetOptions(uint fos);
    void GetOptions(out uint pfos);
    void SetDefaultFolder(IShellItem psi);
    void SetFolder(IShellItem psi);
    void GetFolder(out IShellItem ppsi);
    void GetCurrentSelection(out IShellItem ppsi);
    void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
    void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
    void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
    void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
    void GetResult(out IShellItem ppsi);
    void AddPlace();
    void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string pszExt);
    void Close(int hr);
    void SetClientGuid();
    void ClearClientData();
    void SetFilter();
}

public static class FolderPicker {
    public static string Pick(string title) {
        var dlg = (IFileDialog)new FileOpenDialogRCW();
        uint opts;
        dlg.GetOptions(out opts);
        // FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST | FOS_DEFAULTNOMINIMODE
        dlg.SetOptions(opts | 0x20u | 0x40u | 0x800u | 0x20000000u);
        dlg.SetTitle(title);
        if (dlg.Show(IntPtr.Zero) != 0) return "";
        IShellItem item;
        dlg.GetResult(out item);
        string path;
        item.GetDisplayName(0x80058000u, out path);
        return path;
    }
}
"@
[FolderPicker]::Pick("Select target project")
`;

// Track spawned processes for cleanup
const activeProcesses = new Map();
let serverInstance = null;

// ── Singleton Guard ────────────────────────────────────────────────
// Prevents multiple GUI servers from running simultaneously.
// Lock file in temp dir stores PID + URL. On startup, checks if an
// existing instance is alive (process signal + HTTP probe) and exits
// with a message if so — the user should use the existing window.
const GUI_LOCK_FILE = join(tmpdir(), 'nightytidy-gui.lock');

function checkExistingInstance() {
  let existing;
  try {
    existing = JSON.parse(readFileSync(GUI_LOCK_FILE, 'utf8').trim());
  } catch {
    return Promise.resolve(null); // No lock file or unreadable
  }

  const { pid, url } = existing;

  // Check if the process is still alive
  try { process.kill(pid, 0); } catch {
    try { unlinkSync(GUI_LOCK_FILE); } catch { /* ignore */ }
    return Promise.resolve(null); // Process dead — stale lock
  }

  // Process alive — probe HTTP to confirm server is responsive
  return new Promise((resolve) => {
    const req = http.get(`${url}/api/heartbeat`, { timeout: 2000 }, (res) => {
      res.resume();
      resolve(url); // Server alive and responsive
    });
    req.on('error', () => {
      try { unlinkSync(GUI_LOCK_FILE); } catch { /* ignore */ }
      resolve(null); // Process exists but server not responding — stale
    });
    req.on('timeout', () => {
      req.destroy();
      try { unlinkSync(GUI_LOCK_FILE); } catch { /* ignore */ }
      resolve(null);
    });
  });
}

function writeGuiLock(port) {
  writeFileSync(GUI_LOCK_FILE, JSON.stringify({ pid: process.pid, url: `http://127.0.0.1:${port}`, port }), 'utf8');
}

function removeGuiLock() {
  try { unlinkSync(GUI_LOCK_FILE); } catch { /* ignore */ }
}

// Heartbeat — frontend pings every 5s; server self-terminates if stale.
// When active processes are running, use a much longer threshold (5 min) because
// Chrome aggressively throttles/freezes background tabs, killing heartbeat timers.
// The watchdog exists to catch orphaned servers, not to kill active runs.
let lastHeartbeat = Date.now();
const HEARTBEAT_CHECK_MS = 5000;
const HEARTBEAT_STALE_IDLE_MS = 15_000;    // 15s — only checked when no processes running

// ── GUI Logger ──────────────────────────────────────────────────────
// Writes to nightytidy-gui.log in the project directory once selected.
// Before selection, entries buffer in memory and flush on setGuiLogDir().
const GUI_LOG_FILE = 'nightytidy-gui.log';
let guiLogFilePath = null;
const guiLogBuffer = [];
const MAX_BUFFER = 500;

function guiLog(level, message) {
  const timestamp = new Date().toISOString();
  const tag = level.toUpperCase().padEnd(5);
  const line = `[${timestamp}] [${tag}] ${message}\n`;

  if (guiLogFilePath) {
    try {
      appendFileSync(guiLogFilePath, line, 'utf8');
    } catch {
      if (guiLogBuffer.length < MAX_BUFFER) guiLogBuffer.push(line);
    }
  } else {
    if (guiLogBuffer.length < MAX_BUFFER) guiLogBuffer.push(line);
  }
}

function setGuiLogDir(projectDir) {
  guiLogFilePath = join(projectDir, GUI_LOG_FILE);
  try {
    writeFileSync(guiLogFilePath, '', 'utf8');
  } catch (err) {
    console.error(`Failed to create GUI log file: ${err.message}`);
    return;
  }
  flushGuiLogBuffer();
}

function flushGuiLogBuffer() {
  if (!guiLogFilePath || guiLogBuffer.length === 0) return;
  try {
    appendFileSync(guiLogFilePath, guiLogBuffer.join(''), 'utf8');
    guiLogBuffer.length = 0;
  } catch {
    // Silently fail — don't crash the server over logging
  }
}

function killProcess(proc) {
  if (process.platform === 'win32') {
    execSync(`taskkill /pid ${proc.pid} /T /F`, { windowsHide: true });
  } else {
    proc.kill('SIGTERM');
  }
}

function killAllProcesses() {
  for (const [, proc] of activeProcesses) {
    try { killProcess(proc); } catch { /* ignore */ }
  }
  activeProcesses.clear();
}

// ── Static File Serving ────────────────────────────────────────────

async function serveStatic(res, urlPath) {
  const safePath = urlPath === '/' ? '/index.html' : urlPath;
  const filePath = join(RESOURCES_DIR, safePath);

  // Prevent directory traversal — use trailing separator to avoid prefix
  // confusion (e.g. "resources-extra" matching "resources")
  const boundary = RESOURCES_DIR.endsWith(sep) ? RESOURCES_DIR : RESOURCES_DIR + sep;
  if (!filePath.startsWith(boundary) && filePath !== RESOURCES_DIR) {
    guiLog('warn', `Blocked path traversal attempt: ${urlPath}`);
    res.writeHead(403, { 'Content-Type': 'text/plain', ...SECURITY_HEADERS });
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
    res.writeHead(404, { 'Content-Type': 'text/plain', ...SECURITY_HEADERS });
    res.end('Not found');
  }
}

// ── API: Config ─────────────────────────────────────────────────────

function handleConfig(res) {
  sendJson(res, { ok: true, bin: NIGHTYTIDY_BIN });
}

// ── API: Folder Dialog ─────────────────────────────────────────────

async function handleSelectFolder(res) {
  const platform = process.platform;

  try {
    let folder = null;

    if (platform === 'win32') {
      // Modern Windows folder picker (IFileOpenDialog COM with FOS_PICKFOLDERS)
      // Written to temp .ps1 to avoid Windows cmd escaping issues
      const script = join(tmpdir(), `nt-folder-${Date.now()}.ps1`);
      try {
        writeFileSync(script, FOLDER_PICKER_PS1);
        const result = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -STA -File "${script}"`, { encoding: 'utf-8', timeout: 60000 });
        lastHeartbeat = Date.now(); // Blocking dialog starved the event loop — refresh before watchdog fires
        folder = result.trim() || null;
      } finally {
        try { unlinkSync(script); } catch { /* ignore cleanup failure */ }
      }
    } else if (platform === 'darwin') {
      // macOS: use osascript
      const result = execSync(
        `osascript -e 'POSIX path of (choose folder with prompt "Select target project")'`,
        { encoding: 'utf-8', timeout: 60000 }
      ).trim();
      lastHeartbeat = Date.now(); // Blocking dialog starved the event loop — refresh before watchdog fires
      folder = result || null;
    } else {
      // Linux: try zenity, then kdialog
      try {
        const result = execSync(
          `zenity --file-selection --directory --title="Select target project"`,
          { encoding: 'utf-8', timeout: 60000 }
        ).trim();
        lastHeartbeat = Date.now(); // Blocking dialog starved the event loop — refresh before watchdog fires
        folder = result || null;
      } catch {
        const result = execSync(
          `kdialog --getexistingdirectory .`,
          { encoding: 'utf-8', timeout: 60000 }
        ).trim();
        lastHeartbeat = Date.now(); // Blocking dialog starved the event loop — refresh before watchdog fires
        folder = result || null;
      }
    }

    if (folder) {
      guiLog('info', `Folder selected: ${folder}`);
      setGuiLogDir(folder);
    } else {
      guiLog('info', 'Folder dialog closed without selection');
    }
    sendJson(res, { ok: true, folder });
  } catch (err) {
    // User cancelled or dialog failed — still refresh heartbeat after blocking execSync
    lastHeartbeat = Date.now();
    guiLog('info', 'Folder dialog cancelled or failed');
    sendJson(res, { ok: true, folder: null });
  }
}

// ── API: Run Command ───────────────────────────────────────────────

const PROCESS_TIMEOUT_MS = 48 * 60_000; // 48 min — must exceed step timeout (45 min) + overhead

async function handleRunCommand(req, res) {
  const body = await readBody(req);
  const { command, id } = body;

  if (!command) {
    sendJson(res, { ok: false, error: 'No command provided' }, 400);
    return;
  }

  const startTime = Date.now();
  // Truncate command for logging (avoid logging huge prompts)
  const cmdPreview = command.length > 200 ? command.slice(0, 200) + '...' : command;

  try {
    guiLog('info', `Spawning process id=${id || 'none'} cmd=${cmdPreview}`);
    const proc = spawn(command, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: true,
    });

    let stdout = '';
    let stderr = '';
    let responded = false;
    let lastActivity = Date.now();

    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      lastActivity = Date.now();
    });
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      lastActivity = Date.now();
    });

    // Track for cleanup
    if (id) activeProcesses.set(id, proc);

    // Safety timeout: kill process if it runs longer than allowed.
    // This prevents hung processes from holding the HTTP response forever.
    const safetyTimer = setTimeout(() => {
      if (responded) return;
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const idle = Math.round((Date.now() - lastActivity) / 1000);
      guiLog('error', `Process ${id || 'unknown'} hit safety timeout after ${elapsed}s (idle ${idle}s, stdout=${stdout.length} bytes, stderr=${stderr.length} bytes)`);
      try { killProcess(proc); } catch { /* ignore */ }
    }, PROCESS_TIMEOUT_MS);
    safetyTimer.unref();

    function respond(data) {
      if (responded) return;
      responded = true;
      clearTimeout(safetyTimer);
      if (id) activeProcesses.delete(id);
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      guiLog('info', `Process ${id || 'unknown'} done in ${elapsed}s (stdout=${stdout.length} bytes, stderr=${stderr.length} bytes, code=${data.exitCode ?? 'n/a'})`);
      sendJson(res, data);
    }

    proc.on('close', (exitCode) => {
      respond({ ok: true, exitCode: exitCode ?? 1, stdout, stderr });
    });

    proc.on('error', (err) => {
      guiLog('error', `Process ${id || 'unknown'} error: ${err.message}`);
      respond({ ok: false, error: err.message });
    });
  } catch (err) {
    guiLog('error', `Spawn failed: ${err.message}`);
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
      killProcess(proc);
      activeProcesses.delete(id);
      guiLog('info', `Killed process ${id}`);
      sendJson(res, { ok: true });
    } catch (err) {
      guiLog('error', `Failed to kill process ${id}: ${err.message}`);
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

  const resolved = resolve(filePath);
  try {
    const content = await readFile(resolved, 'utf-8');
    sendJson(res, { ok: true, content });
  } catch (err) {
    guiLog('warn', `read-file failed: path="${resolved}" error="${err.code || err.message}"`);
    const detail = err.code === 'ENOENT' ? 'File not found' : err.code || err.message;
    sendJson(res, { ok: false, error: detail, path: resolved });
  }
}

// ── API: Delete File ──────────────────────────────────────────────

async function handleDeleteFile(req, res) {
  const body = await readBody(req);
  const { path: filePath } = body;

  if (!filePath) {
    sendJson(res, { ok: false, error: 'No path provided' }, 400);
    return;
  }

  // Only allow deleting NightyTidy ephemeral files
  const name = filePath.replace(/\\/g, '/').split('/').pop();
  const ALLOWED = ['nightytidy-run-state.json', 'nightytidy.lock', 'nightytidy-progress.json'];
  if (!ALLOWED.includes(name)) {
    sendJson(res, { ok: false, error: 'Not an allowed file' }, 403);
    return;
  }

  try {
    unlinkSync(resolve(filePath));
    sendJson(res, { ok: true });
  } catch {
    sendJson(res, { ok: true }); // Already gone — not an error
  }
}

// ── API: Heartbeat ─────────────────────────────────────────────────

function handleHeartbeat(res) {
  lastHeartbeat = Date.now();
  sendJson(res, { ok: true });
}

// ── API: Log Error (from frontend) ─────────────────────────────────

async function handleLogError(req, res) {
  const body = await readBody(req);
  const { level, message } = body;

  if (!message) {
    sendJson(res, { ok: false, error: 'No message provided' }, 400);
    return;
  }

  const safeLevel = ['error', 'warn', 'info'].includes(level) ? level : 'error';
  guiLog(safeLevel, `[frontend] ${message}`);
  sendJson(res, { ok: true });
}

// ── API: Log Path ──────────────────────────────────────────────────

function handleLogPath(res) {
  sendJson(res, { ok: true, path: guiLogFilePath });
}

// ── API: Shutdown ──────────────────────────────────────────────────

function handleExit(res) {
  guiLog('info', 'Exit requested by frontend');
  sendJson(res, { ok: true });
  killAllProcesses();
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
    ...SECURITY_HEADERS,
  });
  res.end(JSON.stringify(data));
}

// ── Router ─────────────────────────────────────────────────────────

function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost`);

  // Log API requests (skip heartbeat — too noisy)
  if (url.pathname.startsWith('/api/') && url.pathname !== '/api/heartbeat') {
    guiLog('debug', `${req.method} ${url.pathname}`);
  }

  // API routes
  if (url.pathname === '/api/config' && req.method === 'POST') {
    return handleConfig(res);
  }
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
  if (url.pathname === '/api/delete-file' && req.method === 'POST') {
    return handleDeleteFile(req, res);
  }
  if (url.pathname === '/api/heartbeat' && req.method === 'POST') {
    return handleHeartbeat(res);
  }
  if (url.pathname === '/api/log-error' && req.method === 'POST') {
    return handleLogError(req, res);
  }
  if (url.pathname === '/api/log-path' && req.method === 'POST') {
    return handleLogPath(res);
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
  if (process.env.NIGHTYTIDY_NO_CHROME) {
    console.log(`\n  NightyTidy GUI is running at: ${url}`);
    console.log('  Chrome launch suppressed (NIGHTYTIDY_NO_CHROME is set).\n');
    return null;
  }
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
  removeGuiLock();
  killAllProcesses();
  if (serverInstance) {
    serverInstance.close();
    serverInstance = null;
  }
}

// ── Main ───────────────────────────────────────────────────────────

(async () => {
  // Singleton check — exit early if another GUI is already running
  const existingUrl = await checkExistingInstance();
  if (existingUrl) {
    console.log(`NightyTidy GUI is already running at ${existingUrl}`);
    console.log('Opening existing window...');
    launchChrome(existingUrl);
    process.exit(0);
  }

  const server = createServer(handleRequest);
  serverInstance = server;

  // Request timeouts:
  // - headersTimeout: reject connections that are slow to send headers (DoS protection)
  // - requestTimeout: disabled (0) because run-command can legitimately take 45+ min per step.
  //   The per-process safety timeout in handleRunCommand() handles stuck processes instead.
  server.requestTimeout = 0;
  server.headersTimeout = 15_000;  // 15s — max time to receive headers

  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    const url = `http://127.0.0.1:${port}`;
    writeGuiLock(port);
    guiLog('info', `GUI server started on ${url}`);
    console.log(`NightyTidy GUI server running on ${url}`);
    launchChrome(url);

    // Watchdog: self-terminate if no heartbeat from the browser.
    // Catches cases where Chrome crashes or is force-killed (unload never fires).
    //
    // CRITICAL: When processes are actively running, SKIP the heartbeat check entirely.
    // Chrome aggressively throttles/freezes background tabs (even --app mode), which
    // can stop heartbeat timers. The per-process safety timeout in handleRunCommand()
    // (48 min) handles truly stuck processes. We must NEVER kill the server while
    // steps are running — that's the #1 cause of "Run Failed" for users.
    const watchdog = setInterval(() => {
      if (activeProcesses.size > 0) return; // Never self-terminate during active work
      const gap = Date.now() - lastHeartbeat;
      if (gap > HEARTBEAT_STALE_IDLE_MS) {
        guiLog('warn', `No heartbeat for ${Math.round(gap / 1000)}s — shutting down (server was idle)`);
        console.log(`No heartbeat for ${Math.round(gap / 1000)}s — shutting down.`);
        clearInterval(watchdog);
        cleanup();
        process.exit(0);
      }
    }, HEARTBEAT_CHECK_MS);
    watchdog.unref(); // Don't keep the process alive solely for the watchdog
  });
})();

// Graceful shutdown with force-exit safety net.
// cleanup() calls server.close() which waits for active connections to drain.
// If a long-running command response or stuck connection prevents draining,
// the 5s timeout guarantees the process terminates.
const SHUTDOWN_FORCE_EXIT_MS = 5000;

function shutdownHandler() {
  guiLog('info', 'Shutdown signal received');
  cleanup();
  const forceTimer = setTimeout(() => process.exit(1), SHUTDOWN_FORCE_EXIT_MS);
  forceTimer.unref();
  process.exit(0);
}

process.on('uncaughtException', (err) => {
  guiLog('error', `Uncaught exception: ${err.stack || err.message}`);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.stack : String(reason);
  guiLog('error', `Unhandled rejection: ${msg}`);
});

process.on('SIGINT', shutdownHandler);
process.on('SIGTERM', shutdownHandler);
process.on('SIGHUP', shutdownHandler);
