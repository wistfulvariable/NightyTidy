/**
 * Prevents the OS from sleeping while NightyTidy runs are active.
 *
 * Windows: Uses PowerShell to call SetThreadExecutionState with
 * ES_CONTINUOUS | ES_SYSTEM_REQUIRED (0x80000001). This tells Windows
 * "don't sleep, this process needs the system." The flag is automatically
 * cleared when the process exits or when releaseKeepAwake() is called.
 *
 * macOS/Linux: Uses caffeinate / systemd-inhibit respectively.
 *
 * No admin privileges required on any platform.
 */
import { execSync, spawn } from 'node:child_process';
import { debug, warn } from '../logger.js';

let keepAwakeProcess = null;

export function acquireKeepAwake() {
  if (keepAwakeProcess) return; // already held

  try {
    if (process.platform === 'win32') {
      // PowerShell script that sets ES_CONTINUOUS | ES_SYSTEM_REQUIRED
      // and then sleeps forever. When we kill this process, the flag clears.
      keepAwakeProcess = spawn('powershell', [
        '-NoProfile', '-WindowStyle', 'Hidden', '-Command',
        `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class SleepPreventer { [DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags); }'; [SleepPreventer]::SetThreadExecutionState(0x80000001); while($true) { Start-Sleep -Seconds 3600 }`,
      ], { stdio: 'ignore', detached: false });
      keepAwakeProcess.unref();
      keepAwakeProcess.on('error', () => { keepAwakeProcess = null; });
      debug('Sleep prevention acquired (Windows SetThreadExecutionState)');
    } else if (process.platform === 'darwin') {
      // macOS: caffeinate prevents sleep, -i = idle sleep, -s = system sleep
      keepAwakeProcess = spawn('caffeinate', ['-is'], { stdio: 'ignore' });
      keepAwakeProcess.unref();
      keepAwakeProcess.on('error', () => { keepAwakeProcess = null; });
      debug('Sleep prevention acquired (macOS caffeinate)');
    } else {
      // Linux: systemd-inhibit (may not exist on all distros)
      keepAwakeProcess = spawn('systemd-inhibit', [
        '--what=idle:sleep', '--who=NightyTidy', '--why=Running codebase improvement',
        'sleep', 'infinity',
      ], { stdio: 'ignore' });
      keepAwakeProcess.unref();
      keepAwakeProcess.on('error', () => { keepAwakeProcess = null; });
      debug('Sleep prevention acquired (Linux systemd-inhibit)');
    }
  } catch {
    warn('Could not acquire sleep prevention — system may sleep during runs');
  }
}

export function releaseKeepAwake() {
  if (!keepAwakeProcess) return;
  try {
    keepAwakeProcess.kill();
  } catch { /* already dead */ }
  keepAwakeProcess = null;
  debug('Sleep prevention released');
}
