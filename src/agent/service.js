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
 * Windows: Write a .cmd launcher to ~/.nightytidy/ and register it with
 * Task Scheduler (ONLOGON trigger). Task Scheduler is reliable on Windows 11
 * where VBS scripts in the Startup folder are silently blocked by SmartScreen.
 *
 * The .cmd file uses `start /min` to avoid a visible console window.
 * Falls back to the Startup folder VBS approach if schtasks fails.
 */
const STARTUP_DIR = process.platform === 'win32'
  ? path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')
  : '';
const STARTUP_VBS = path.join(STARTUP_DIR, 'NightyTidy Agent.vbs');
const AGENT_CMD = process.platform === 'win32'
  ? path.join(os.homedir(), '.nightytidy', 'start-agent.cmd')
  : '';

function _registerWindows(cmd) {
  // Write a .cmd launcher script to ~/.nightytidy/start-agent.cmd
  // Avoids quoting issues when passing to Task Scheduler or Startup folder.
  const cmdContent = `@echo off\r\nstart /min "" ${cmd}\r\n`;
  const cmdDir = path.dirname(AGENT_CMD);
  fs.mkdirSync(cmdDir, { recursive: true });
  fs.writeFileSync(AGENT_CMD, cmdContent, 'utf-8');
  debug(`Wrote launcher script: ${AGENT_CMD}`);

  // Primary: Task Scheduler via PowerShell (no admin required for user-level
  // logon triggers). schtasks.exe /sc onlogon needs admin, but PowerShell's
  // Register-ScheduledTask with a LogonTrigger does not.
  try {
    const escapedPath = AGENT_CMD.replace(/'/g, "''");
    const ps = [
      `$action = New-ScheduledTaskAction -Execute '${escapedPath}'`,
      `$trigger = New-ScheduledTaskTrigger -AtLogOn`,
      `$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable`,
      `Register-ScheduledTask -TaskName '${SERVICE_NAME}' -Action $action -Trigger $trigger -Settings $settings -Force`,
    ].join('; ');
    execSync(`powershell.exe -NoProfile -Command "${ps}"`, { stdio: 'pipe', timeout: 15000 });
    debug('Registered via Task Scheduler (PowerShell)');
    _removeStartupVbs();
    return;
  } catch (err) {
    debug(`Task Scheduler failed: ${err.message}, trying Startup folder`);
  }

  // Fallback: Startup folder — place .cmd directly (less restricted than .vbs
  // by Windows SmartScreen). The .cmd file runs the agent hidden via start /min.
  try {
    fs.mkdirSync(STARTUP_DIR, { recursive: true });
    const startupCmd = path.join(STARTUP_DIR, 'NightyTidy Agent.cmd');
    fs.copyFileSync(AGENT_CMD, startupCmd);
    debug('Registered via Startup folder (.cmd)');
    _removeStartupVbs();
    return;
  } catch (err) {
    debug(`Startup folder .cmd failed: ${err.message}, trying VBS`);
  }

  // Last resort: Startup folder VBS wrapper
  const vbsCmd = cmd.replace(/"/g, '""');
  const vbs = `' NightyTidy Agent - auto-start on login\r\nSet ws = CreateObject("WScript.Shell")\r\nws.Run "${vbsCmd}", 0, False\r\n`;
  fs.mkdirSync(STARTUP_DIR, { recursive: true });
  fs.writeFileSync(STARTUP_VBS, vbs, 'utf-8');
  debug('Registered via Windows Startup folder (VBS)');
}

function _removeStartupVbs() {
  try {
    if (fs.existsSync(STARTUP_VBS)) {
      fs.unlinkSync(STARTUP_VBS);
      debug('Removed stale Startup folder VBS');
    }
  } catch { /* ignore */ }
}

function _unregisterWindows() {
  // Remove Startup folder entries (VBS and .cmd)
  _removeStartupVbs();
  try {
    const startupCmd = path.join(STARTUP_DIR, 'NightyTidy Agent.cmd');
    if (fs.existsSync(startupCmd)) {
      fs.unlinkSync(startupCmd);
      debug('Removed Startup folder .cmd entry');
    }
  } catch { /* ignore */ }

  // Remove .cmd launcher script from ~/.nightytidy/
  try {
    if (fs.existsSync(AGENT_CMD)) {
      fs.unlinkSync(AGENT_CMD);
      debug('Removed launcher script');
    }
  } catch { /* ignore */ }

  // Remove Task Scheduler entry (try both PowerShell and schtasks)
  try {
    execSync(
      `powershell.exe -NoProfile -Command "Unregister-ScheduledTask -TaskName '${SERVICE_NAME}' -Confirm:\\$false"`,
      { stdio: 'pipe', timeout: 15000 },
    );
    debug('Removed Task Scheduler entry');
  } catch {
    try {
      execSync(`schtasks /delete /tn "${SERVICE_NAME}" /f`, { stdio: 'pipe' });
      debug('Removed Task Scheduler entry (schtasks)');
    } catch { /* ignore — may not have been registered */ }
  }
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
