/**
 * OS service registration for the NightyTidy agent.
 *
 * Registers the agent to start on login/boot using the platform-native
 * service mechanism (Windows Task Scheduler, macOS LaunchAgent, Linux systemd).
 *
 * Never throws — all functions return result objects.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { debug } from '../logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// package root is two levels up from src/agent/
const PACKAGE_ROOT = path.resolve(__dirname, '..', '..');
const BIN_PATH = path.join(PACKAGE_ROOT, 'bin', 'nightytidy.js');

const SERVICE_NAME = 'NightyTidy Agent';
const PLIST_ID = 'com.nightytidy.agent';
const PLIST_PATH = path.join(os.homedir(), 'Library', 'LaunchAgents', `${PLIST_ID}.plist`);
const SYSTEMD_DIR = path.join(os.homedir(), '.config', 'systemd', 'user');
const SYSTEMD_PATH = path.join(SYSTEMD_DIR, 'nightytidy.service');

/**
 * Returns the command string used to start the agent.
 * Format: `"<node>" "<nightytidy bin>" agent`
 */
export function getAgentStartCommand() {
  return `"${process.execPath}" "${BIN_PATH}" agent`;
}

/**
 * Registers the agent as an OS service (run on login).
 * @returns {{ success: true } | { success: false, error: string, fallbackInstructions: string }}
 */
export function registerService() {
  const cmd = getAgentStartCommand();
  debug(`Registering service with command: ${cmd}`);

  try {
    if (process.platform === 'win32') {
      _registerWindows(cmd);
    } else if (process.platform === 'darwin') {
      _registerMacOS(cmd);
    } else {
      _registerLinux(cmd);
    }
    debug('Service registered successfully');
    return { success: true };
  } catch (err) {
    const error = err.message || String(err);
    debug(`Service registration failed: ${error}`);
    return {
      success: false,
      error,
      fallbackInstructions: `To start manually on login, add this to your startup: ${cmd}`,
    };
  }
}

/**
 * Unregisters the OS service.
 * @returns {{ success: true } | { success: false, error: string }}
 */
export function unregisterService() {
  debug('Unregistering service');

  try {
    if (process.platform === 'win32') {
      _unregisterWindows();
    } else if (process.platform === 'darwin') {
      _unregisterMacOS();
    } else {
      _unregisterLinux();
    }
    debug('Service unregistered successfully');
    return { success: true };
  } catch (err) {
    const error = err.message || String(err);
    debug(`Service unregistration failed: ${error}`);
    return { success: false, error };
  }
}

// --- Platform implementations ---

/**
 * Windows: Use the Startup folder (no admin needed).
 * Writes a .vbs wrapper script that launches the agent hidden (no console window).
 * Falls back to schtasks if Startup folder isn't writable.
 */
const STARTUP_DIR = process.platform === 'win32'
  ? path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')
  : '';
const STARTUP_VBS = path.join(STARTUP_DIR, 'NightyTidy Agent.vbs');

function _registerWindows(cmd) {
  // Primary: Startup folder (no admin required)
  try {
    // VBS wrapper runs the agent without showing a console window.
    // In VBS, quotes inside strings are doubled: "" not \"
    const vbsCmd = cmd.replace(/"/g, '""');
    const vbs = `' NightyTidy Agent - auto-start on login\r\nSet ws = CreateObject("WScript.Shell")\r\nws.Run "${vbsCmd}", 0, False\r\n`;
    fs.mkdirSync(STARTUP_DIR, { recursive: true });
    fs.writeFileSync(STARTUP_VBS, vbs, 'utf-8');
    debug('Registered via Windows Startup folder');
    return;
  } catch (err) {
    debug(`Startup folder failed: ${err.message}, trying schtasks`);
  }

  // Fallback: Task Scheduler (needs admin on some systems)
  execSync(
    `schtasks /create /tn "${SERVICE_NAME}" /tr "${cmd}" /sc onlogon /rl LIMITED /f`,
    { stdio: 'pipe' },
  );
}

function _unregisterWindows() {
  // Remove Startup folder entry
  try {
    if (fs.existsSync(STARTUP_VBS)) {
      fs.unlinkSync(STARTUP_VBS);
      debug('Removed Startup folder entry');
    }
  } catch { /* ignore */ }

  // Also try removing schtasks entry (may not exist)
  try {
    execSync(`schtasks /delete /tn "${SERVICE_NAME}" /f`, { stdio: 'pipe' });
    debug('Removed Task Scheduler entry');
  } catch { /* ignore — may not have been registered via schtasks */ }
}

function _registerMacOS(cmd) {
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_ID}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${BIN_PATH}</string>
    <string>agent</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${path.join(os.homedir(), '.nightytidy', 'agent-stdout.log')}</string>
  <key>StandardErrorPath</key>
  <string>${path.join(os.homedir(), '.nightytidy', 'agent-stderr.log')}</string>
</dict>
</plist>
`;
  const launchAgentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
  fs.mkdirSync(launchAgentsDir, { recursive: true });
  fs.writeFileSync(PLIST_PATH, plist, 'utf-8');
  execSync(`launchctl load "${PLIST_PATH}"`, { stdio: 'pipe' });
}

function _unregisterMacOS() {
  if (fs.existsSync(PLIST_PATH)) {
    execSync(`launchctl unload "${PLIST_PATH}"`, { stdio: 'pipe' });
    fs.unlinkSync(PLIST_PATH);
  }
}

function _registerLinux(cmd) {
  const unit = `[Unit]
Description=NightyTidy Agent
After=network.target

[Service]
ExecStart=${process.execPath} "${BIN_PATH}" agent
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
`;
  fs.mkdirSync(SYSTEMD_DIR, { recursive: true });
  fs.writeFileSync(SYSTEMD_PATH, unit, 'utf-8');
  execSync('systemctl --user enable --now nightytidy.service', { stdio: 'pipe' });
}

function _unregisterLinux() {
  execSync('systemctl --user disable --now nightytidy.service', { stdio: 'pipe' });
  if (fs.existsSync(SYSTEMD_PATH)) {
    fs.unlinkSync(SYSTEMD_PATH);
  }
}
