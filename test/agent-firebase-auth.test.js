import { describe, it, expect, vi } from 'vitest';
import { FirebaseAuth } from '../src/agent/firebase-auth.js';

vi.mock('../src/logger.js', () => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  initLogger: vi.fn(),
}));

describe('FirebaseAuth', () => {
  it('checks if credentials are cached', () => {
    const auth = new FirebaseAuth('/tmp/fake-config');
    expect(auth.isAuthenticated()).toBe(false);
  });

  it('stores and retrieves token', () => {
    const auth = new FirebaseAuth('/tmp/fake-config');
    auth.setToken('fake-firebase-token', Date.now() + 3600000);
    expect(auth.isAuthenticated()).toBe(true);
    expect(auth.getToken()).toBe('fake-firebase-token');
  });

  it('detects expired token', () => {
    const auth = new FirebaseAuth('/tmp/fake-config');
    auth.setToken('expired-token', Date.now() - 1000);
    expect(auth.isAuthenticated()).toBe(false);
  });

  it('returns auth header for webhook calls', () => {
    const auth = new FirebaseAuth('/tmp/fake-config');
    auth.setToken('my-token', Date.now() + 3600000);
    expect(auth.getAuthHeader()).toEqual({ Authorization: 'Bearer my-token' });
  });

  it('returns empty header when not authenticated', () => {
    const auth = new FirebaseAuth('/tmp/fake-config');
    expect(auth.getAuthHeader()).toEqual({});
  });
});
