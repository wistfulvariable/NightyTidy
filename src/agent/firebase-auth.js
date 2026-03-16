import { debug, info } from '../logger.js';

export class FirebaseAuth {
  constructor(configDir) {
    this.configDir = configDir;
    this.token = null;
    this.expiresAt = null;
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
    debug('Firebase auth token updated');
  }

  getAuthHeader() {
    const token = this.getToken();
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
  }

  // Full OAuth flow will be implemented in integration phase
  // For now, this is a placeholder that stores/retrieves tokens
  async authenticate() {
    info('Firebase authentication required — browser OAuth flow needed');
    // TODO: Open browser to nightytidy.com/auth/agent, receive token via callback
    return false;
  }
}
