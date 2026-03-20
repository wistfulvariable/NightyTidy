/**
 * @fileoverview One-liner setup command for the NightyTidy agent.
 *
 * Orchestrates: browser OAuth → token save → service registration → agent start.
 *
 * Error contract: Never throws. Prints errors and calls process.exit(1) on failure.
 *
 * @module agent/setup-flow
 */

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import chalk from 'chalk';
import { getConfigDir, ensureConfigDir } from './config.js';
import { registerService } from './service.js';
import { FirebaseAuth } from './firebase-auth.js';
import { debug } from '../logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// package root is two levels up from src/agent/
const PACKAGE_ROOT = path.resolve(__dirname, '..', '..');
const BIN_PATH = path.join(PACKAGE_ROOT, 'bin', 'nightytidy.js');

const AUTH_BASE_URL = 'https://nightytidy.com/auth/agent';

/**
 * Open a URL in the default system browser.
 * Fire-and-forget — detached, stdio ignored.
 * @param {string} url
 */
function openBrowser(url) {
  const platform = process.platform;
  if (platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
  } else if (platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  }
}

/**
 * Start a temporary HTTP server on 127.0.0.1 and wait for a POST /callback.
 * Resolves with the parsed JSON body, or rejects after a timeout.
 * @returns {{ server: import('node:http').Server, port: number, waitForCallback: () => Promise<object> }}
 */
function createCallbackServer() {
  let resolvePayload;
  let rejectPayload;

  const waitForCallback = () =>
    new Promise((resolve, reject) => {
      resolvePayload = resolve;
      rejectPayload = reject;
    });

  const server = createServer((req, res) => {
    // CORS preflight — the web app may send OPTIONS first
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': 'https://nightytidy.com',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }

    if (req.method !== 'POST' || req.url !== '/callback') {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': 'https://nightytidy.com',
        });
        res.end(JSON.stringify({ ok: true }));
        debug('OAuth callback received');
        resolvePayload(payload);
      } catch (err) {
        res.writeHead(400);
        res.end('Bad request');
        rejectPayload(new Error(`Invalid callback body: ${err.message}`));
      }
    });
  });

  // Bind to random port on localhost
  server.listen(0, '127.0.0.1');

  return { server, waitForCallback };
}

/**
 * Main setup flow. Runs all four steps sequentially.
 * Never throws — prints errors and calls process.exit(1).
 */
export async function setupAgent() {
  console.log(chalk.bold.cyan('\nNightyTidy Agent Setup'));
  console.log(chalk.dim('────────────────────────────────────────'));

  // ── Step 1: Authenticate ──────────────────────────────────────────────────

  console.log(chalk.bold('\nStep 1: Authenticate'));

  const { server, waitForCallback } = createCallbackServer();

  // Wait for the server to be assigned a port
  await new Promise((resolve) => server.once('listening', resolve));
  const port = server.address().port;
  debug(`Callback server listening on 127.0.0.1:${port}`);

  const callbackUrl = `http://127.0.0.1:${port}/callback`;
  const authUrl = `${AUTH_BASE_URL}?callback=${encodeURIComponent(callbackUrl)}`;

  console.log(chalk.dim(`Opening: ${authUrl}`));
  openBrowser(authUrl);
  console.log(chalk.yellow('Waiting for authorization in browser...'));

  let payload;
  try {
    payload = await waitForCallback();
  } catch (err) {
    server.close();
    console.error(chalk.red(`\nAuthorization failed: ${err.message}`));
    process.exit(1);
  } finally {
    server.close();
  }

  if (payload.error) {
    console.error(chalk.red(`\nAuthorization error: ${payload.error}`));
    process.exit(1);
  }

  // ── Step 2: Save credentials ──────────────────────────────────────────────

  console.log(chalk.bold('\nStep 2: Save credentials'));

  const configDir = getConfigDir();
  ensureConfigDir(configDir);

  const firebaseAuth = new FirebaseAuth(configDir);
  const token = payload.token || payload.idToken;

  if (!token) {
    console.error(chalk.red('\nNo token received in callback. Cannot authenticate.'));
    process.exit(1);
  }

  firebaseAuth.setToken(token);
  console.log(chalk.green('  Authenticated'));

  // ── Step 3: Register service ──────────────────────────────────────────────

  console.log(chalk.bold('\nStep 3: Register auto-start service'));

  const serviceResult = registerService();
  if (serviceResult.success) {
    console.log(chalk.green('  Service registered — agent will start automatically on login'));
  } else {
    console.log(chalk.yellow(`  Warning: Could not register service: ${serviceResult.error}`));
    console.log(chalk.dim(`  ${serviceResult.fallbackInstructions}`));
  }

  // ── Step 4: Start agent ───────────────────────────────────────────────────

  console.log(chalk.bold('\nStep 4: Start agent'));

  spawn(process.execPath, [BIN_PATH, 'agent'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    shell: process.platform === 'win32',
  }).unref();
  console.log(chalk.green('  Agent started'));

  // ── Done ──────────────────────────────────────────────────────────────────

  console.log(chalk.dim('\n────────────────────────────────────────'));
  console.log(
    chalk.bold.green('Done!') +
    ' Your agent is running. Visit nightytidy.com to add projects and configure schedules.',
  );
  console.log('');
}
