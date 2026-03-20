import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FirebaseAuth } from '../src/agent/firebase-auth.js';

vi.mock('../src/logger.js', () => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  initLogger: vi.fn(),
}));

// Helper: build a fake JWT with a given exp (seconds since epoch)
function fakeJwt(exp) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ exp, sub: 'user123' })).toString('base64url');
  const sig = 'fakesig';
  return `${header}.${payload}.${sig}`;
}

describe('FirebaseAuth', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('checks if credentials are cached', () => {
    const auth = new FirebaseAuth('/tmp/fake-config');
    expect(auth.isAuthenticated()).toBe(false);
  });

  it('stores and retrieves token with JWT expiry', () => {
    const auth = new FirebaseAuth('/tmp/fake-config');
    const expSec = Math.floor(Date.now() / 1000) + 3600; // 1hr from now
    const token = fakeJwt(expSec);
    auth.setToken(token);
    expect(auth.isAuthenticated()).toBe(true);
    expect(auth.getToken()).toBe(token);
  });

  it('detects expired token via JWT exp claim', () => {
    const auth = new FirebaseAuth('/tmp/fake-config');
    const expSec = Math.floor(Date.now() / 1000) - 60; // expired 1 min ago
    const token = fakeJwt(expSec);
    auth.setToken(token);
    expect(auth.isAuthenticated()).toBe(false);
    expect(auth.getToken()).toBeNull();
  });

  it('returns auth header for webhook calls', () => {
    const auth = new FirebaseAuth('/tmp/fake-config');
    const token = fakeJwt(Math.floor(Date.now() / 1000) + 3600);
    auth.setToken(token);
    expect(auth.getAuthHeader()).toEqual({ Authorization: `Bearer ${token}` });
  });

  it('returns empty header when not authenticated', () => {
    const auth = new FirebaseAuth('/tmp/fake-config');
    expect(auth.getAuthHeader()).toEqual({});
  });

  describe('parseJwtExpiry', () => {
    it('extracts exp from a valid JWT', () => {
      const expSec = 1710000000;
      const token = fakeJwt(expSec);
      expect(FirebaseAuth.parseJwtExpiry(token)).toBe(expSec * 1000);
    });

    it('returns null for token without exp claim', () => {
      const header = Buffer.from('{}').toString('base64url');
      const payload = Buffer.from(JSON.stringify({ sub: 'user' })).toString('base64url');
      const token = `${header}.${payload}.sig`;
      expect(FirebaseAuth.parseJwtExpiry(token)).toBeNull();
    });

    it('returns null for non-JWT string', () => {
      expect(FirebaseAuth.parseJwtExpiry('not-a-jwt')).toBeNull();
    });

    it('returns null for malformed base64 payload', () => {
      expect(FirebaseAuth.parseJwtExpiry('a.!!!invalid!!!.c')).toBeNull();
    });

    it('returns null for non-numeric exp', () => {
      const header = Buffer.from('{}').toString('base64url');
      const payload = Buffer.from(JSON.stringify({ exp: 'not-a-number' })).toString('base64url');
      const token = `${header}.${payload}.sig`;
      expect(FirebaseAuth.parseJwtExpiry(token)).toBeNull();
    });
  });

  describe('setToken with JWT parsing', () => {
    it('uses JWT exp when available', () => {
      const auth = new FirebaseAuth('/tmp/fake-config');
      const expSec = Math.floor(Date.now() / 1000) + 1800; // 30 min from now
      auth.setToken(fakeJwt(expSec));
      expect(auth.expiresAt).toBe(expSec * 1000);
    });

    it('falls back to 1 hour when JWT parsing fails', () => {
      const auth = new FirebaseAuth('/tmp/fake-config');
      const before = Date.now();
      auth.setToken('not-a-jwt-token');
      // Should fall back to ~1 hour from now
      expect(auth.expiresAt).toBeGreaterThanOrEqual(before + 3600_000);
      expect(auth.expiresAt).toBeLessThanOrEqual(before + 3600_000 + 100);
    });

    it('detects token minted long ago (the original bug)', () => {
      const auth = new FirebaseAuth('/tmp/fake-config');
      // Token was minted 50 minutes ago, only 10 minutes left
      const expSec = Math.floor(Date.now() / 1000) + 600; // 10 min from now
      auth.setToken(fakeJwt(expSec));
      expect(auth.isAuthenticated()).toBe(true);
      // But needsRefresh should be true (within 15 min buffer)
      expect(auth.needsRefresh()).toBe(true);
    });
  });

  describe('refresh retry with backoff', () => {
    it('blocks needsRefresh after markRefreshRequested', () => {
      const auth = new FirebaseAuth('/tmp/fake-config');
      const expSec = Math.floor(Date.now() / 1000) + 600; // 10 min left
      auth.setToken(fakeJwt(expSec));
      expect(auth.needsRefresh()).toBe(true);
      auth.markRefreshRequested();
      expect(auth.needsRefresh()).toBe(false);
    });

    it('resets _refreshRequested after backoff timer (30s first attempt)', () => {
      const auth = new FirebaseAuth('/tmp/fake-config');
      const expSec = Math.floor(Date.now() / 1000) + 600;
      auth.setToken(fakeJwt(expSec));
      auth.markRefreshRequested();
      expect(auth.needsRefresh()).toBe(false);

      // Advance 30 seconds — first backoff
      vi.advanceTimersByTime(30_000);
      expect(auth.needsRefresh()).toBe(true);
    });

    it('uses exponential backoff for subsequent attempts', () => {
      const auth = new FirebaseAuth('/tmp/fake-config');
      const expSec = Math.floor(Date.now() / 1000) + 600;
      auth.setToken(fakeJwt(expSec));

      // First attempt: 30s
      auth.markRefreshRequested();
      vi.advanceTimersByTime(29_999);
      expect(auth.needsRefresh()).toBe(false);
      vi.advanceTimersByTime(1);
      expect(auth.needsRefresh()).toBe(true);

      // Second attempt: 60s
      auth.markRefreshRequested();
      vi.advanceTimersByTime(59_999);
      expect(auth.needsRefresh()).toBe(false);
      vi.advanceTimersByTime(1);
      expect(auth.needsRefresh()).toBe(true);

      // Third attempt: 120s
      auth.markRefreshRequested();
      vi.advanceTimersByTime(119_999);
      expect(auth.needsRefresh()).toBe(false);
      vi.advanceTimersByTime(1);
      expect(auth.needsRefresh()).toBe(true);
    });

    it('caps backoff at 4 minutes', () => {
      const auth = new FirebaseAuth('/tmp/fake-config');
      const expSec = Math.floor(Date.now() / 1000) + 600;
      auth.setToken(fakeJwt(expSec));

      // Simulate many attempts
      for (let i = 0; i < 10; i++) {
        auth.markRefreshRequested();
        vi.advanceTimersByTime(240_000); // 4 min cap
      }
      // After 10 attempts, should still be retrying at 4min cap
      expect(auth.needsRefresh()).toBe(true);
    });

    it('resets refresh attempts on setToken', () => {
      const auth = new FirebaseAuth('/tmp/fake-config');
      const expSec = Math.floor(Date.now() / 1000) + 600;
      auth.setToken(fakeJwt(expSec));
      auth.markRefreshRequested();
      auth.markRefreshRequested(); // _refreshAttempts = 2

      // Fresh token resets everything
      const newExpSec = Math.floor(Date.now() / 1000) + 3600;
      auth.setToken(fakeJwt(newExpSec));
      expect(auth._refreshAttempts).toBe(0);
      expect(auth._refreshRequested).toBe(false);
    });
  });

  describe('webhook queue', () => {
    it('queues webhook payloads', () => {
      const auth = new FirebaseAuth('/tmp/fake-config');
      auth.queueWebhook('step_completed', { step: 1 });
      auth.queueWebhook('step_completed', { step: 2 });
      expect(auth._pendingWebhooks).toHaveLength(2);
    });

    it('replays queue on setToken when callback is registered', () => {
      const auth = new FirebaseAuth('/tmp/fake-config');
      const replayed = [];
      auth.onTokenRefresh((queue) => {
        replayed.push(...queue);
      });

      auth.queueWebhook('step_completed', { step: 1 });
      auth.queueWebhook('step_completed', { step: 2 });
      auth.queueWebhook('run_completed', { total: 33 });

      // Setting a fresh token should drain the queue
      const expSec = Math.floor(Date.now() / 1000) + 3600;
      auth.setToken(fakeJwt(expSec));

      expect(replayed).toHaveLength(3);
      expect(replayed[0].event).toBe('step_completed');
      expect(replayed[0].data).toEqual({ step: 1 });
      expect(replayed[2].event).toBe('run_completed');
      expect(auth._pendingWebhooks).toHaveLength(0);
    });

    it('does not replay when no callback is registered', () => {
      const auth = new FirebaseAuth('/tmp/fake-config');
      auth.queueWebhook('step_completed', { step: 1 });

      // Should not throw
      const expSec = Math.floor(Date.now() / 1000) + 3600;
      auth.setToken(fakeJwt(expSec));
      expect(auth._pendingWebhooks).toHaveLength(1);
    });

    it('does not replay empty queue', () => {
      const auth = new FirebaseAuth('/tmp/fake-config');
      const callback = vi.fn();
      auth.onTokenRefresh(callback);

      const expSec = Math.floor(Date.now() / 1000) + 3600;
      auth.setToken(fakeJwt(expSec));
      expect(callback).not.toHaveBeenCalled();
    });

    it('caps queue at MAX_QUEUED_WEBHOOKS (200)', () => {
      const auth = new FirebaseAuth('/tmp/fake-config');
      for (let i = 0; i < 250; i++) {
        auth.queueWebhook('heartbeat', { i });
      }
      expect(auth._pendingWebhooks).toHaveLength(200);
      // Oldest entries should have been dropped
      expect(auth._pendingWebhooks[0].data.i).toBe(50);
    });

    it('includes queuedAt timestamp', () => {
      const auth = new FirebaseAuth('/tmp/fake-config');
      const before = Date.now();
      auth.queueWebhook('step_completed', { step: 1 });
      expect(auth._pendingWebhooks[0].queuedAt).toBeGreaterThanOrEqual(before);
    });
  });

  describe('token persistence', () => {
    let tmpDir;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-auth-test-'));
    });

    afterEach(() => {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    it('saveTokenToDisk writes JSON file to configDir', () => {
      const auth = new FirebaseAuth(tmpDir);
      const expSec = Math.floor(Date.now() / 1000) + 3600;
      const token = fakeJwt(expSec);
      auth.saveTokenToDisk(token);
      const tokenPath = path.join(tmpDir, 'firebase-token.json');
      expect(fs.existsSync(tokenPath)).toBe(true);
      const data = JSON.parse(fs.readFileSync(tokenPath, 'utf-8'));
      expect(data.token).toBe(token);
      expect(typeof data.savedAt).toBe('number');
    });

    it('loadTokenFromDisk returns token when file exists and is valid', () => {
      const auth = new FirebaseAuth(tmpDir);
      const expSec = Math.floor(Date.now() / 1000) + 3600;
      const token = fakeJwt(expSec);
      auth.saveTokenToDisk(token);
      expect(auth.loadTokenFromDisk()).toBe(token);
    });

    it('loadTokenFromDisk returns null when file is missing', () => {
      const auth = new FirebaseAuth(tmpDir);
      expect(auth.loadTokenFromDisk()).toBeNull();
    });

    it('loadTokenFromDisk returns null and deletes file when token is expired', () => {
      const auth = new FirebaseAuth(tmpDir);
      const expSec = Math.floor(Date.now() / 1000) - 60; // expired 1 min ago
      const token = fakeJwt(expSec);
      // Write the file directly (bypassing setToken's validity check isn't needed — saveTokenToDisk is unconditional)
      const tokenPath = path.join(tmpDir, 'firebase-token.json');
      fs.writeFileSync(tokenPath, JSON.stringify({ token, savedAt: Date.now() }), 'utf-8');
      expect(auth.loadTokenFromDisk()).toBeNull();
      expect(fs.existsSync(tokenPath)).toBe(false);
    });

    it('restoreToken calls setToken and returns true when valid token on disk', () => {
      const auth = new FirebaseAuth(tmpDir);
      const expSec = Math.floor(Date.now() / 1000) + 3600;
      const token = fakeJwt(expSec);
      auth.saveTokenToDisk(token);

      // Fresh instance to simulate restart
      const auth2 = new FirebaseAuth(tmpDir);
      const result = auth2.restoreToken();
      expect(result).toBe(true);
      expect(auth2.isAuthenticated()).toBe(true);
      expect(auth2.getToken()).toBe(token);
    });

    it('restoreToken returns false when no token on disk', () => {
      const auth = new FirebaseAuth(tmpDir);
      expect(auth.restoreToken()).toBe(false);
      expect(auth.isAuthenticated()).toBe(false);
    });

    it('setToken also saves to disk', () => {
      const auth = new FirebaseAuth(tmpDir);
      const expSec = Math.floor(Date.now() / 1000) + 3600;
      const token = fakeJwt(expSec);
      auth.setToken(token);
      const tokenPath = path.join(tmpDir, 'firebase-token.json');
      expect(fs.existsSync(tokenPath)).toBe(true);
      const data = JSON.parse(fs.readFileSync(tokenPath, 'utf-8'));
      expect(data.token).toBe(token);
    });
  });
});
