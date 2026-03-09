/**
 * NightyTidy Desktop GUI — Node.js backend server.
 * Serves static files + API endpoints for the GUI.
 * Opens Chrome in --app mode for a native-feeling window.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { statSync, writeFileSync, unlinkSync } from 'node:fs';
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
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'",
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
        const result = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${script}"`, { encoding: 'utf-8', timeout: 60000 });
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
    const proc = spawn(command, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: true,
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
      killProcess(proc);
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

// ── API: Shutdown ──────────────────────────────────────────────────

function handleExit(res) {
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
  killAllProcesses();
  if (serverInstance) {
    serverInstance.close();
    serverInstance = null;
  }
}

// ── Main ───────────────────────────────────────────────────────────

const server = createServer(handleRequest);
serverInstance = server;

// Prevent slow clients from holding connections indefinitely.
server.requestTimeout = 30_000;  // 30s — max time for entire request
server.headersTimeout = 15_000;  // 15s — max time to receive headers

server.listen(0, '127.0.0.1', () => {
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}`;
  console.log(`NightyTidy GUI server running on ${url}`);
  launchChrome(url);
});

// Graceful shutdown with force-exit safety net.
// cleanup() calls server.close() which waits for active connections to drain.
// If a long-running command response or stuck connection prevents draining,
// the 5s timeout guarantees the process terminates.
const SHUTDOWN_FORCE_EXIT_MS = 5000;

function shutdownHandler() {
  cleanup();
  const forceTimer = setTimeout(() => process.exit(1), SHUTDOWN_FORCE_EXIT_MS);
  forceTimer.unref();
  process.exit(0);
}

process.on('SIGINT', shutdownHandler);
process.on('SIGTERM', shutdownHandler);
