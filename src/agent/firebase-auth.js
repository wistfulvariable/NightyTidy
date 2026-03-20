import fs from 'node:fs';
import path from 'node:path';
import { debug, info, warn } from '../logger.js';

const REFRESH_BUFFER_MS = 15 * 60_000; // Request refresh 15 min before expiry
const MAX_BACKOFF_MS = 4 * 60_000;     // Cap retry backoff at 4 minutes
const MAX_QUEUED_WEBHOOKS = 200;       // Prevent unbounded queue growth

export class FirebaseAuth {
  constructor(configDir) {
    this.configDir = configDir;
    this.token = null;
    this.expiresAt = null;
    this._refreshRequested = false;
    this._refreshAttempts = 0;
    this._refreshTimer = null;
    this._pendingWebhooks = [];
    this._replayCallback = null;
  }

  /**
   * Parse the `exp` claim from a Firebase ID token (standard JWT).
   * Returns expiry as milliseconds since epoch, or null on failure.
   * No crypto needed — we only read the unverified payload for timing.
   */
  static parseJwtExpiry(token) {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
    } catch {
      return null;
    }
  }

  isAuthenticated() {
    return this.token !== null && this.expiresAt > Date.now();
  }

  getToken() {
    if (!this.isAuthenticated()) return null;
    return this.token;
  }

  /**
   * Store a Firebase ID token. Expiry is parsed from the JWT's `exp` claim
   * rather than assuming 1 hour from now — the token may have been minted
   * well before the agent received it.
   */
  setToken(token) {
    const jwtExpiry = FirebaseAuth.parseJwtExpiry(token);
    this.token = token;
    this.expiresAt = jwtExpiry || (Date.now() + 3600_000);
    this._refreshRequested = false;
    this._refreshAttempts = 0;
    if (this._refreshTimer) {
      clearTimeout(this._refreshTimer);
      this._refreshTimer = null;
    }
    const remainMin = Math.round((this.expiresAt - Date.now()) / 60_000);
    debug(`Firebase auth token updated (expires in ${remainMin}m)`);
    this.saveTokenToDisk(token);
    this._replayQueue();
  }

  getAuthHeader() {
    const token = this.getToken();
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
  }

  /**
   * Returns true if the token is within REFRESH_BUFFER_MS of expiry
   * and a refresh has not already been requested (or the retry timer
   * has reset the flag).
   */
  needsRefresh() {
    if (!this.token || !this.expiresAt) return false;
    if (this._refreshRequested) return false;
    return this.expiresAt - Date.now() < REFRESH_BUFFER_MS;
  }

  /**
   * Mark that a refresh has been requested. Starts a backoff timer
   * that resets the flag so needsRefresh() can fire again if the
   * web app doesn't respond.
   */
  markRefreshRequested() {
    this._refreshRequested = true;
    this._refreshAttempts++;
    const backoff = Math.min(30_000 * Math.pow(2, this._refreshAttempts - 1), MAX_BACKOFF_MS);
    debug(`Firebase auth refresh requested (attempt ${this._refreshAttempts}, retry in ${backoff / 1000}s)`);
    if (this._refreshTimer) clearTimeout(this._refreshTimer);
    this._refreshTimer = setTimeout(() => {
      this._refreshRequested = false;
      this._refreshTimer = null;
      debug('Firebase auth refresh request expired — will retry on next check');
    }, backoff);
  }

  /**
   * Register a callback that fires when a fresh token arrives,
   * receiving the array of queued webhook payloads to replay.
   */
  onTokenRefresh(callback) {
    this._replayCallback = callback;
  }

  /**
   * Queue a webhook payload for replay when a fresh token arrives.
   * Called by index.js when a webhook can't be sent due to expired auth.
   */
  queueWebhook(event, data) {
    this._pendingWebhooks.push({ event, data, queuedAt: Date.now() });
    if (this._pendingWebhooks.length > MAX_QUEUED_WEBHOOKS) {
      this._pendingWebhooks.shift(); // drop oldest
    }
    debug(`Queued webhook ${event} for replay (${this._pendingWebhooks.length} pending)`);
  }

  /**
   * Drain the queue and replay through the registered callback.
   * Called automatically by setToken() when a fresh token arrives.
   */
  _replayQueue() {
    if (this._pendingWebhooks.length === 0 || !this._replayCallback) return;
    const queue = [...this._pendingWebhooks];
    this._pendingWebhooks = [];
    info(`Replaying ${queue.length} queued webhook(s) with fresh token`);
    this._replayCallback(queue);
  }

  /**
   * Persist the raw JWT token to `{configDir}/firebase-token.json`.
   * Atomic write (temp file + rename). Best-effort — logs a warning on failure.
   */
  saveTokenToDisk(token) {
    try {
      const tokenPath = path.join(this.configDir, 'firebase-token.json');
      const tmpPath = tokenPath + '.tmp';
      const data = JSON.stringify({ token, savedAt: Date.now() });
      fs.writeFileSync(tmpPath, data, 'utf-8');
      fs.renameSync(tmpPath, tokenPath);
      debug('Firebase token saved to disk');
    } catch (err) {
      warn(`Failed to save Firebase token to disk: ${err.message}`);
    }
  }

  /**
   * Load a previously saved Firebase token from `{configDir}/firebase-token.json`.
   * Returns the token string, or null if missing, corrupt, or expired.
   * Deletes the file if the token is expired.
   */
  loadTokenFromDisk() {
    const tokenPath = path.join(this.configDir, 'firebase-token.json');
    try {
      const raw = fs.readFileSync(tokenPath, 'utf-8');
      const { token } = JSON.parse(raw);
      if (!token || typeof token !== 'string') return null;

      const expiry = FirebaseAuth.parseJwtExpiry(token);
      if (expiry !== null && expiry <= Date.now()) {
        // Token is expired — clean up the file
        try { fs.unlinkSync(tokenPath); } catch { /* ignore */ }
        debug('Stored Firebase token is expired — removed from disk');
        return null;
      }
      return token;
    } catch {
      // File missing or corrupt — not an error
      return null;
    }
  }

  /**
   * Attempt to restore Firebase auth state from the on-disk token.
   * Returns true if a valid token was found and restored, false otherwise.
   */
  restoreToken() {
    const token = this.loadTokenFromDisk();
    if (!token) return false;
    this.setToken(token);
    return true;
  }

  // Full OAuth flow will be implemented in integration phase
  // For now, this is a placeholder that stores/retrieves tokens
  async authenticate() {
    info('Firebase authentication required — browser OAuth flow needed');
    // TODO: Open browser to nightytidy.com/auth/agent, receive token via callback
    return false;
  }
}
