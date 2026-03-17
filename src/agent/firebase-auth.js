import { debug, info, warn } from '../logger.js';

const REFRESH_BUFFER_MS = 15 * 60_000; // Request refresh 15 min before expiry

export class FirebaseAuth {
  constructor(configDir) {
    this.configDir = configDir;
    this.token = null;
    this.expiresAt = null;
    this._refreshRequested = false;
  }

  isAuthenticated() {
    return this.token !== null && this.expiresAt > Date.now();
  }

  getToken() {
    if (!this.isAuthenticated()) return null;
    return this.token;
  }

  setToken(token, expiresAt) {
    this.token = token;
    this.expiresAt = expiresAt;
    this._refreshRequested = false;
    debug('Firebase auth token updated');
  }

  getAuthHeader() {
    const token = this.getToken();
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
  }

  /**
   * Returns true if the token is within REFRESH_BUFFER_MS of expiry
   * and a refresh has not already been requested.
   */
  needsRefresh() {
    if (!this.token || !this.expiresAt) return false;
    if (this._refreshRequested) return false;
    return this.expiresAt - Date.now() < REFRESH_BUFFER_MS;
  }

  /**
   * Mark that a refresh has been requested so we don't spam requests.
   * Cleared when setToken() is called with a new token.
   */
  markRefreshRequested() {
    this._refreshRequested = true;
    debug('Firebase auth token refresh requested');
  }

  // Full OAuth flow will be implemented in integration phase
  // For now, this is a placeholder that stores/retrieves tokens
  async authenticate() {
    info('Firebase authentication required — browser OAuth flow needed');
    // TODO: Open browser to nightytidy.com/auth/agent, receive token via callback
    return false;
  }
}
