import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FirestorePoller } from '../src/agent/firestore-poller.js';

vi.mock('../src/logger.js', () => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  initLogger: vi.fn(),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal fake JWT with the given payload fields. */
function fakeJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.fakesig`;
}

/** A valid token carrying uid 'user-abc'. */
const VALID_TOKEN = fakeJwt({
  sub: 'user-abc',
  user_id: 'user-abc',
  exp: Math.floor(Date.now() / 1000) + 3600,
});

/** Make a minimal FirebaseAuth mock. */
function makeAuth({ authenticated = true, token = VALID_TOKEN } = {}) {
  return {
    isAuthenticated: vi.fn(() => authenticated),
    getToken: vi.fn(() => (authenticated ? token : null)),
  };
}

/** Build a Firestore REST runQuery response with one document. */
function firestoreResponse({
  runId = 'run-123',
  uid = 'user-abc',
  projectId = 'proj-1',
  projectName = 'My Project',
  selectedSteps = [1, 2, 3],
  timeout = 45,
} = {}) {
  return [
    {
      document: {
        name: `projects/nightytidy-web/databases/(default)/documents/users/${uid}/runs/${runId}`,
        fields: {
          status: { stringValue: 'queued' },
          projectId: { stringValue: projectId },
          projectName: { stringValue: projectName },
          selectedSteps: {
            arrayValue: {
              values: selectedSteps.map((n) => ({ integerValue: String(n) })),
            },
          },
          timeout: { integerValue: String(timeout) },
        },
      },
    },
  ];
}

/** Build an empty Firestore runQuery response (no documents). */
function emptyFirestoreResponse() {
  return [{}]; // Firestore returns [{} ] when no documents match
}

/** Set up global.fetch to return the given JSON body. */
function mockFetch(json, { ok = true, status = 200 } = {}) {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    status,
    json: vi.fn().mockResolvedValue(json),
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('FirestorePoller', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    vi.useFakeTimers();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── poll() — basic behaviour ────────────────────────────────────────────────

  describe('poll() — authentication guard', () => {
    it('skips poll when not authenticated', async () => {
      global.fetch = vi.fn();
      const auth = makeAuth({ authenticated: false });
      const onFound = vi.fn();
      const poller = new FirestorePoller({ firebaseAuth: auth, projectId: 'nightytidy-web', onQueuedRunFound: onFound });

      await poller.poll();

      expect(global.fetch).not.toHaveBeenCalled();
      expect(onFound).not.toHaveBeenCalled();
    });

    it('skips poll when getToken() returns null even if isAuthenticated() returns true', async () => {
      global.fetch = vi.fn();
      const auth = { isAuthenticated: vi.fn(() => true), getToken: vi.fn(() => null) };
      const onFound = vi.fn();
      const poller = new FirestorePoller({ firebaseAuth: auth, projectId: 'nightytidy-web', onQueuedRunFound: onFound });

      await poller.poll();

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('skips poll when UID cannot be extracted from token', async () => {
      global.fetch = vi.fn();
      const auth = { isAuthenticated: vi.fn(() => true), getToken: vi.fn(() => 'not-a-jwt') };
      const onFound = vi.fn();
      const poller = new FirestorePoller({ firebaseAuth: auth, projectId: 'nightytidy-web', onQueuedRunFound: onFound });

      await poller.poll();

      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('poll() — Firestore query', () => {
    it('sends correct Firestore REST POST with auth header', async () => {
      mockFetch(emptyFirestoreResponse());
      const auth = makeAuth();
      const poller = new FirestorePoller({ firebaseAuth: auth, projectId: 'nightytidy-web', onQueuedRunFound: vi.fn() });

      await poller.poll();

      expect(global.fetch).toHaveBeenCalledOnce();
      const [url, opts] = global.fetch.mock.calls[0];
      expect(url).toBe(
        'https://firestore.googleapis.com/v1/projects/nightytidy-web/databases/(default)/documents/users/user-abc:runQuery'
      );
      expect(opts.method).toBe('POST');
      expect(opts.headers.Authorization).toBe(`Bearer ${VALID_TOKEN}`);
      expect(opts.headers['Content-Type']).toBe('application/json');

      // Body should be a structuredQuery filtering status == "queued"
      const body = JSON.parse(opts.body);
      expect(body.structuredQuery.where.fieldFilter.field.fieldPath).toBe('status');
      expect(body.structuredQuery.where.fieldFilter.value.stringValue).toBe('queued');
      expect(body.structuredQuery.limit).toBe(1);
    });

    it('uses the correct Firebase projectId in the URL', async () => {
      mockFetch(emptyFirestoreResponse());
      const auth = makeAuth();
      const poller = new FirestorePoller({ firebaseAuth: auth, projectId: 'my-custom-project', onQueuedRunFound: vi.fn() });

      await poller.poll();

      const [url] = global.fetch.mock.calls[0];
      expect(url).toContain('projects/my-custom-project/');
    });
  });

  describe('poll() — queued run found', () => {
    it('calls onQueuedRunFound with parsed run data', async () => {
      mockFetch(firestoreResponse({
        runId: 'run-abc',
        projectId: 'proj-x',
        projectName: 'Project X',
        selectedSteps: [1, 5, 12],
        timeout: 60,
      }));
      const auth = makeAuth();
      const onFound = vi.fn();
      const poller = new FirestorePoller({ firebaseAuth: auth, projectId: 'nightytidy-web', onQueuedRunFound: onFound });

      await poller.poll();

      expect(onFound).toHaveBeenCalledOnce();
      const run = onFound.mock.calls[0][0];
      expect(run.runId).toBe('run-abc');
      expect(run.projectId).toBe('proj-x');
      expect(run.projectName).toBe('Project X');
      expect(run.selectedSteps).toEqual([1, 5, 12]);
      expect(run.timeout).toBe(60);
    });

    it('parses selectedSteps as numbers (not strings)', async () => {
      mockFetch(firestoreResponse({ selectedSteps: [3, 7, 21] }));
      const auth = makeAuth();
      const onFound = vi.fn();
      const poller = new FirestorePoller({ firebaseAuth: auth, projectId: 'nightytidy-web', onQueuedRunFound: onFound });

      await poller.poll();

      const run = onFound.mock.calls[0][0];
      expect(run.selectedSteps).toEqual([3, 7, 21]);
      expect(run.selectedSteps.every((n) => typeof n === 'number')).toBe(true);
    });

    it('defaults timeout to 45 when not present in document', async () => {
      const response = firestoreResponse({ timeout: 45 });
      // Remove the timeout field from the document
      delete response[0].document.fields.timeout;
      mockFetch(response);
      const auth = makeAuth();
      const onFound = vi.fn();
      const poller = new FirestorePoller({ firebaseAuth: auth, projectId: 'nightytidy-web', onQueuedRunFound: onFound });

      await poller.poll();

      expect(onFound.mock.calls[0][0].timeout).toBe(45);
    });
  });

  describe('poll() — no queued runs', () => {
    it('does not call onQueuedRunFound when response is empty', async () => {
      mockFetch(emptyFirestoreResponse());
      const auth = makeAuth();
      const onFound = vi.fn();
      const poller = new FirestorePoller({ firebaseAuth: auth, projectId: 'nightytidy-web', onQueuedRunFound: onFound });

      await poller.poll();

      expect(onFound).not.toHaveBeenCalled();
    });

    it('does not call onQueuedRunFound when response is an empty array', async () => {
      mockFetch([]);
      const auth = makeAuth();
      const onFound = vi.fn();
      const poller = new FirestorePoller({ firebaseAuth: auth, projectId: 'nightytidy-web', onQueuedRunFound: onFound });

      await poller.poll();

      expect(onFound).not.toHaveBeenCalled();
    });
  });

  describe('poll() — error handling', () => {
    it('does not throw on network error', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      const auth = makeAuth();
      const poller = new FirestorePoller({ firebaseAuth: auth, projectId: 'nightytidy-web', onQueuedRunFound: vi.fn() });

      await expect(poller.poll()).resolves.toBeUndefined();
    });

    it('does not throw on 401 response', async () => {
      mockFetch({}, { ok: false, status: 401 });
      const auth = makeAuth();
      const poller = new FirestorePoller({ firebaseAuth: auth, projectId: 'nightytidy-web', onQueuedRunFound: vi.fn() });

      await expect(poller.poll()).resolves.toBeUndefined();
    });

    it('does not throw on 403 response', async () => {
      mockFetch({}, { ok: false, status: 403 });
      const auth = makeAuth();
      const poller = new FirestorePoller({ firebaseAuth: auth, projectId: 'nightytidy-web', onQueuedRunFound: vi.fn() });

      await expect(poller.poll()).resolves.toBeUndefined();
    });

    it('does not call onQueuedRunFound on HTTP error response', async () => {
      mockFetch({}, { ok: false, status: 500 });
      const auth = makeAuth();
      const onFound = vi.fn();
      const poller = new FirestorePoller({ firebaseAuth: auth, projectId: 'nightytidy-web', onQueuedRunFound: onFound });

      await poller.poll();

      expect(onFound).not.toHaveBeenCalled();
    });

    it('does not throw when JSON parsing fails', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token')),
      });
      const auth = makeAuth();
      const poller = new FirestorePoller({ firebaseAuth: auth, projectId: 'nightytidy-web', onQueuedRunFound: vi.fn() });

      await expect(poller.poll()).resolves.toBeUndefined();
    });

    it('does not throw when document fields are malformed', async () => {
      // Document with no projectId field — _parseRunDocument should throw internally
      const badResponse = [{
        document: {
          name: 'projects/nightytidy-web/databases/(default)/documents/users/uid/runs/run-bad',
          fields: {
            // Missing projectId
            status: { stringValue: 'queued' },
          },
        },
      }];
      mockFetch(badResponse);
      const auth = makeAuth();
      const poller = new FirestorePoller({ firebaseAuth: auth, projectId: 'nightytidy-web', onQueuedRunFound: vi.fn() });

      await expect(poller.poll()).resolves.toBeUndefined();
    });
  });

  // ── extractUidFromToken ────────────────────────────────────────────────────

  describe('extractUidFromToken()', () => {
    it('extracts user_id when present', () => {
      const token = fakeJwt({ user_id: 'uid-from-user_id', sub: 'other' });
      expect(FirestorePoller.extractUidFromToken(token)).toBe('uid-from-user_id');
    });

    it('falls back to sub when user_id is absent', () => {
      const token = fakeJwt({ sub: 'uid-from-sub' });
      expect(FirestorePoller.extractUidFromToken(token)).toBe('uid-from-sub');
    });

    it('returns null for a non-JWT string', () => {
      expect(FirestorePoller.extractUidFromToken('not-a-jwt')).toBeNull();
    });

    it('returns null for malformed base64 payload', () => {
      expect(FirestorePoller.extractUidFromToken('a.!!!invalid!!!.c')).toBeNull();
    });

    it('returns null when payload has neither user_id nor sub', () => {
      const token = fakeJwt({ email: 'user@example.com' });
      expect(FirestorePoller.extractUidFromToken(token)).toBeNull();
    });
  });

  // ── start() / stop() ──────────────────────────────────────────────────────

  describe('start() and stop()', () => {
    it('start() triggers poll on interval', async () => {
      mockFetch(emptyFirestoreResponse());
      const auth = makeAuth();
      const onFound = vi.fn();
      const poller = new FirestorePoller({ firebaseAuth: auth, projectId: 'nightytidy-web', onQueuedRunFound: onFound });

      poller.start(10_000);

      // No immediate poll on start — first fires after interval
      expect(global.fetch).not.toHaveBeenCalled();

      // Advance one interval
      await vi.advanceTimersByTimeAsync(10_000);
      expect(global.fetch).toHaveBeenCalledOnce();

      // Advance another interval
      await vi.advanceTimersByTimeAsync(10_000);
      expect(global.fetch).toHaveBeenCalledTimes(2);

      poller.stop();
    });

    it('stop() prevents further polls', async () => {
      mockFetch(emptyFirestoreResponse());
      const auth = makeAuth();
      const poller = new FirestorePoller({ firebaseAuth: auth, projectId: 'nightytidy-web', onQueuedRunFound: vi.fn() });

      poller.start(10_000);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(global.fetch).toHaveBeenCalledOnce();

      poller.stop();
      await vi.advanceTimersByTimeAsync(30_000);

      // No additional polls after stop
      expect(global.fetch).toHaveBeenCalledOnce();
    });

    it('calling start() twice does not double the interval', async () => {
      mockFetch(emptyFirestoreResponse());
      const auth = makeAuth();
      const poller = new FirestorePoller({ firebaseAuth: auth, projectId: 'nightytidy-web', onQueuedRunFound: vi.fn() });

      poller.start(10_000);
      poller.start(10_000); // second call should be a no-op

      await vi.advanceTimersByTimeAsync(10_000);
      expect(global.fetch).toHaveBeenCalledOnce(); // not twice

      poller.stop();
    });

    it('stop() is safe to call when not started', () => {
      const poller = new FirestorePoller({ firebaseAuth: makeAuth(), projectId: 'nightytidy-web', onQueuedRunFound: vi.fn() });
      expect(() => poller.stop()).not.toThrow();
    });
  });
});
