import { debug, warn } from '../logger.js';

/**
 * FirestorePoller — polls Firestore REST API for queued runs.
 *
 * This is a SECONDARY trigger alongside the existing WebSocket command path.
 * It allows the agent to pick up runs queued by the web app even when no
 * browser is connected.
 *
 * Never throws — all errors are logged and swallowed.
 */
export class FirestorePoller {
  /**
   * @param {object} opts
   * @param {import('./firebase-auth.js').FirebaseAuth} opts.firebaseAuth
   * @param {string} opts.projectId  Firebase project ID (e.g. 'nightytidy-web')
   * @param {(run: object) => void} opts.onQueuedRunFound  Callback when a run is found
   */
  constructor({ firebaseAuth, projectId, onQueuedRunFound }) {
    this._firebaseAuth = firebaseAuth;
    this._projectId = projectId;
    this._onQueuedRunFound = onQueuedRunFound;
    this._intervalId = null;
  }

  /**
   * Start polling on a fixed interval.
   * @param {number} intervalMs  Polling interval (default 30 s)
   */
  start(intervalMs = 30_000) {
    if (this._intervalId !== null) return; // already running
    debug(`FirestorePoller: starting (interval ${intervalMs}ms)`);
    this._intervalId = setInterval(() => { this.poll(); }, intervalMs);
  }

  /** Stop polling. */
  stop() {
    if (this._intervalId !== null) {
      clearInterval(this._intervalId);
      this._intervalId = null;
      debug('FirestorePoller: stopped');
    }
  }

  /**
   * Run a single poll cycle.
   * Exported so tests can call it directly without timers.
   */
  async poll() {
    if (!this._firebaseAuth.isAuthenticated()) {
      debug('FirestorePoller: skipping poll — not authenticated');
      return;
    }

    const token = this._firebaseAuth.getToken();
    if (!token) {
      debug('FirestorePoller: skipping poll — no token');
      return;
    }

    const uid = FirestorePoller.extractUidFromToken(token);
    if (!uid) {
      warn('FirestorePoller: could not extract UID from token — skipping poll');
      return;
    }

    const url = `https://firestore.googleapis.com/v1/projects/${this._projectId}/databases/(default)/documents/users/${uid}:runQuery`;

    const body = JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'runs' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'status' },
            op: 'EQUAL',
            value: { stringValue: 'queued' },
          },
        },
        orderBy: [{ field: { fieldPath: 'startedAt' }, direction: 'ASCENDING' }],
        limit: 1,
      },
    });

    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body,
      });
    } catch (err) {
      warn(`FirestorePoller: network error during poll — ${err.message}`);
      return;
    }

    if (!response.ok) {
      warn(`FirestorePoller: poll returned HTTP ${response.status} — skipping`);
      return;
    }

    let results;
    try {
      results = await response.json();
    } catch (err) {
      warn(`FirestorePoller: failed to parse Firestore response — ${err.message}`);
      return;
    }

    // Firestore REST runQuery returns an array of { document } objects.
    // An empty result set is returned as [{}] (object with no document field).
    if (!Array.isArray(results) || results.length === 0) {
      return;
    }

    const first = results[0];
    if (!first || !first.document) {
      // No queued runs found
      return;
    }

    let run;
    try {
      run = FirestorePoller._parseRunDocument(first.document);
    } catch (err) {
      warn(`FirestorePoller: failed to parse run document — ${err.message}`);
      return;
    }

    debug(`FirestorePoller: found queued run ${run.runId} for project ${run.projectId}`);
    this._onQueuedRunFound(run);
  }

  /**
   * Extract UID from a Firebase ID token (JWT).
   * Reads `user_id` or `sub` from the unverified payload — no crypto needed.
   * Returns null on any parse failure.
   *
   * @param {string} token
   * @returns {string|null}
   */
  static extractUidFromToken(token) {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      return payload.user_id || payload.sub || null;
    } catch {
      return null;
    }
  }

  /**
   * Parse a Firestore document object into a plain run object.
   * Throws on missing required fields so callers can log and skip.
   *
   * @param {{ name: string, fields: object }} doc
   * @returns {{ runId, projectId, projectName, selectedSteps, timeout }}
   */
  static _parseRunDocument(doc) {
    // Document name format:
    // projects/{project}/databases/(default)/documents/users/{uid}/runs/{runId}
    const nameParts = doc.name.split('/');
    const runId = nameParts[nameParts.length - 1];

    const fields = doc.fields || {};

    const projectId = fields.projectId?.stringValue ?? null;
    const projectName = fields.projectName?.stringValue ?? null;

    // selectedSteps can be an arrayValue of integerValue/stringValue entries
    let selectedSteps = [];
    if (fields.selectedSteps?.arrayValue?.values) {
      selectedSteps = fields.selectedSteps.arrayValue.values.map((v) => {
        if (v.integerValue !== undefined) return Number(v.integerValue);
        if (v.stringValue !== undefined) return Number(v.stringValue);
        return null;
      }).filter((n) => n !== null && !isNaN(n));
    }

    const timeoutRaw = fields.timeout?.integerValue ?? fields.timeout?.stringValue ?? null;
    const timeout = timeoutRaw !== null ? Number(timeoutRaw) : 45;

    if (!runId) throw new Error('missing runId in document name');
    if (!projectId) throw new Error('missing projectId field');

    return { runId, projectId, projectName, selectedSteps, timeout };
  }
}
