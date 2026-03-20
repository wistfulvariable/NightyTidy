// test/agent-setup-flow.test.js
//
// Strategy: No node:http mock — use a real HTTP server so the callback
// mechanism works end-to-end. We find the ephemeral port by intercepting the
// console.log line that prints the auth URL (which contains the port).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'node:http';

// ── Universal logger mock ──────────────────────────────────────────────────
vi.mock('../src/logger.js', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  initLogger: vi.fn(),
}));

// ── Dependency mocks ───────────────────────────────────────────────────────

const mockGetConfigDir = vi.fn(() => '/home/user/.nightytidy');
const mockEnsureConfigDir = vi.fn();
vi.mock('../src/agent/config.js', () => ({
  getConfigDir: (...args) => mockGetConfigDir(...args),
  ensureConfigDir: (...args) => mockEnsureConfigDir(...args),
}));

const mockRegisterService = vi.fn(() => ({ success: true }));
vi.mock('../src/agent/service.js', () => ({
  registerService: (...args) => mockRegisterService(...args),
}));

const mockSetToken = vi.fn();
const MockFirebaseAuth = vi.fn().mockImplementation(() => ({
  setToken: mockSetToken,
}));
vi.mock('../src/agent/firebase-auth.js', () => ({
  FirebaseAuth: MockFirebaseAuth,
}));

// ── node:child_process mock ────────────────────────────────────────────────
// Use spawn: vi.fn() directly so we can inspect mockSpawn.mock.calls
const mockSpawn = vi.fn(() => ({ unref: vi.fn() }));
vi.mock('node:child_process', () => ({
  spawn: (...args) => mockSpawn(...args),
}));

// ── HTTP helpers ───────────────────────────────────────────────────────────

function postCallback(port, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/callback',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function sendOptions(port) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: '/callback', method: 'OPTIONS' },
      (res) => { let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => resolve(res)); },
    );
    req.on('error', reject);
    req.end();
  });
}

function sendUnknown(port) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: '/other', method: 'GET' },
      (res) => { let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => resolve(res)); },
    );
    req.on('error', reject);
    req.end();
  });
}

// ── driveFlow ─────────────────────────────────────────────────────────────

/**
 * Run setupAgent() and drive the OAuth callback.
 *
 * We intercept the console.log that prints "Opening: <authUrl>" to extract
 * the ephemeral port, then POST the callback payload to that port.
 *
 * @param {object} payload
 * @param {{ beforeCallback?: (port: number) => Promise<void> }} [opts]
 */
async function driveFlow(payload, opts = {}) {
  const { setupAgent } = await import('../src/agent/setup-flow.js');

  let resolvePort;
  const portPromise = new Promise((r) => { resolvePort = r; });

  // Intercept console.log to capture the "Opening: <url>" line.
  // The callback URL is URL-encoded in authUrl, so the port appears as
  // "127.0.0.1%3A<port>" (colon encoded). Match both raw and encoded forms.
  const origLog = console.log;
  console.log = (...args) => {
    const line = args.map(String).join(' ');
    // Raw form: http://127.0.0.1:<port>/callback
    const rawMatch = line.match(/127\.0\.0\.1:(\d+)/);
    // URL-encoded form: http%3A%2F%2F127.0.0.1%3A<port>%2Fcallback
    const encodedMatch = line.match(/127\.0\.0\.1%3A(\d+)/i);
    const match = rawMatch || encodedMatch;
    if (match) {
      resolvePort(parseInt(match[1], 10));
    }
    // Suppress terminal output during tests
  };

  const flowPromise = setupAgent();
  // Attach an early no-op catch so that if setupAgent() rejects before we
  // reach the .then() below (e.g. when process.exit(1) is called in the
  // payload handler), the rejection does not become an unhandled rejection
  // warning in the Vitest output.
  flowPromise.catch(() => {});

  // Wait for the port (means the server is listening and browser has been opened)
  const port = await portPromise;

  // Restore console.log before doing anything else
  console.log = origLog;

  if (opts.beforeCallback) {
    await opts.beforeCallback(port);
  }

  await postCallback(port, payload);

  const result = await flowPromise.then(
    (v) => ({ status: 'fulfilled', value: v }),
    (e) => ({ status: 'rejected', reason: e }),
  );

  return { result, port };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('setupAgent()', () => {
  let originalExit;
  let consoleLogSpy;
  let consoleErrorSpy;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the spawn mock implementation (clearAllMocks clears calls only)
    mockSpawn.mockReturnValue({ unref: vi.fn() });

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    originalExit = process.exit;
    process.exit = vi.fn((code) => {
      throw new Error(`process.exit(${code})`);
    });
  });

  afterEach(() => {
    process.exit = originalExit;
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('opens the browser with an auth URL pointing to nightytidy.com/auth/agent', async () => {
    const { result } = await driveFlow({ token: 'tok-abc' });
    expect(result.status).toBe('fulfilled');

    // First spawn call is the browser opener
    expect(mockSpawn).toHaveBeenCalled();
    const browserSpawnArgs = mockSpawn.mock.calls[0];
    const allArgs = browserSpawnArgs.flat(Infinity).join(' ');
    expect(allArgs).toMatch(/nightytidy\.com\/auth\/agent/);
  }, 15000);

  it('includes the encoded callback address with the ephemeral port in the auth URL', async () => {
    const { result, port } = await driveFlow({ token: 'tok-abc' });
    expect(result.status).toBe('fulfilled');

    const allArgs = mockSpawn.mock.calls[0].flat(Infinity).join(' ');
    expect(allArgs).toContain('callback=');
    expect(allArgs).toContain('127.0.0.1');
    expect(allArgs).toContain(String(port));
  }, 15000);

  it('calls FirebaseAuth.setToken with the token field from the callback', async () => {
    const { result } = await driveFlow({ token: 'firebase-token-xyz' });
    expect(result.status).toBe('fulfilled');
    expect(mockSetToken).toHaveBeenCalledWith('firebase-token-xyz');
  }, 15000);

  it('falls back to idToken when token field is absent', async () => {
    const { result } = await driveFlow({ idToken: 'id-token-fallback' });
    expect(result.status).toBe('fulfilled');
    expect(mockSetToken).toHaveBeenCalledWith('id-token-fallback');
  }, 15000);

  it('creates FirebaseAuth with the configDir from getConfigDir()', async () => {
    const { result } = await driveFlow({ token: 'tok-abc' });
    expect(result.status).toBe('fulfilled');
    expect(MockFirebaseAuth).toHaveBeenCalledWith('/home/user/.nightytidy');
  }, 15000);

  it('calls registerService()', async () => {
    const { result } = await driveFlow({ token: 'tok-abc' });
    expect(result.status).toBe('fulfilled');
    expect(mockRegisterService).toHaveBeenCalledTimes(1);
  }, 15000);

  it('spawns the agent process detached with "agent" argument', async () => {
    const { result } = await driveFlow({ token: 'tok-abc' });
    expect(result.status).toBe('fulfilled');

    // The last spawn call should be the agent start (browser is first)
    const agentSpawnCall = mockSpawn.mock.calls.find(
      ([execPath, args]) =>
        execPath === process.execPath && Array.isArray(args) && args.includes('agent'),
    );
    expect(agentSpawnCall).toBeDefined();
    // unref was called on the returned process
    const lastUnref = mockSpawn.mock.results[mockSpawn.mock.results.length - 1].value.unref;
    expect(lastUnref).toHaveBeenCalled();
  }, 15000);

  it('prints a done message referencing nightytidy.com', async () => {
    // We need to capture console.log output from the flow, but driveFlow
    // already intercepts it to extract the port. Run a version that captures too.
    const printedLines = [];
    const { setupAgent } = await import('../src/agent/setup-flow.js');

    let resolvePort;
    const portPromise = new Promise((r) => { resolvePort = r; });

    const origLog = console.log;
    console.log = (...args) => {
      const line = args.map(String).join(' ');
      printedLines.push(line);
      const rawM = line.match(/127\.0\.0\.1:(\d+)/);
      const encM = line.match(/127\.0\.0\.1%3A(\d+)/i);
      const match = rawM || encM;
      if (match) resolvePort(parseInt(match[1], 10));
    };

    const flowPromise = setupAgent();
    const port = await portPromise;
    await postCallback(port, { token: 'tok-abc' });
    const result = await flowPromise.then(
      (v) => ({ status: 'fulfilled', value: v }),
      (e) => ({ status: 'rejected', reason: e }),
    );
    console.log = origLog;

    expect(result.status).toBe('fulfilled');
    const allOutput = printedLines.join('\n');
    expect(allOutput.toLowerCase()).toMatch(/done/);
    expect(allOutput).toMatch(/nightytidy\.com/i);
  }, 15000);

  it('exits with code 1 when the callback has an error field', async () => {
    const { result } = await driveFlow({ error: 'access_denied' });
    expect(result.status).toBe('rejected');
    expect(result.reason.message).toMatch(/process\.exit\(1\)/);
    expect(process.exit).toHaveBeenCalledWith(1);
  }, 15000);

  it('exits with code 1 when the callback has neither token nor idToken', async () => {
    const { result } = await driveFlow({ uid: 'user-123' });
    expect(result.status).toBe('rejected');
    expect(result.reason.message).toMatch(/process\.exit\(1\)/);
    expect(process.exit).toHaveBeenCalledWith(1);
  }, 15000);

  it('continues with a warning when registerService() fails', async () => {
    mockRegisterService.mockReturnValueOnce({
      success: false,
      error: 'Permission denied',
      fallbackInstructions: 'Add to startup manually',
    });

    // Capture log output manually for this test
    const printedLines = [];
    const { setupAgent } = await import('../src/agent/setup-flow.js');

    let resolvePort;
    const portPromise = new Promise((r) => { resolvePort = r; });

    const origLog = console.log;
    console.log = (...args) => {
      const line = args.map(String).join(' ');
      printedLines.push(line);
      const rawM = line.match(/127\.0\.0\.1:(\d+)/);
      const encM = line.match(/127\.0\.0\.1%3A(\d+)/i);
      const match = rawM || encM;
      if (match) resolvePort(parseInt(match[1], 10));
    };

    const flowPromise = setupAgent();
    const port = await portPromise;
    await postCallback(port, { token: 'tok-abc' });
    const result = await flowPromise.then(
      (v) => ({ status: 'fulfilled', value: v }),
      (e) => ({ status: 'rejected', reason: e }),
    );
    console.log = origLog;

    expect(result.status).toBe('fulfilled');
    expect(mockSetToken).toHaveBeenCalledWith('tok-abc');

    const agentSpawnCall = mockSpawn.mock.calls.find(
      ([execPath, args]) =>
        execPath === process.execPath && Array.isArray(args) && args.includes('agent'),
    );
    expect(agentSpawnCall).toBeDefined();

    const allOutput = printedLines.join('\n');
    expect(allOutput.toLowerCase()).toMatch(/warning/);
  }, 15000);

  it('calls ensureConfigDir before creating FirebaseAuth', async () => {
    const callOrder = [];
    mockEnsureConfigDir.mockImplementation(() => callOrder.push('ensureConfigDir'));
    MockFirebaseAuth.mockImplementation(() => {
      callOrder.push('FirebaseAuth');
      return { setToken: mockSetToken };
    });

    const { result } = await driveFlow({ token: 'tok-abc' });
    expect(result.status).toBe('fulfilled');

    expect(callOrder.indexOf('ensureConfigDir')).toBeLessThan(callOrder.indexOf('FirebaseAuth'));
  }, 15000);

  it('responds 204 with CORS headers to OPTIONS preflight', async () => {
    let optionsRes;
    const { result } = await driveFlow({ token: 'tok-abc' }, {
      beforeCallback: async (port) => {
        optionsRes = await sendOptions(port);
      },
    });
    expect(result.status).toBe('fulfilled');
    expect(optionsRes.statusCode).toBe(204);
    expect(optionsRes.headers['access-control-allow-origin']).toBe('https://nightytidy.com');
  }, 15000);

  it('responds 404 for unknown routes', async () => {
    let unknownRes;
    const { result } = await driveFlow({ token: 'tok-abc' }, {
      beforeCallback: async (port) => {
        unknownRes = await sendUnknown(port);
      },
    });
    expect(result.status).toBe('fulfilled');
    expect(unknownRes.statusCode).toBe(404);
  }, 15000);
});
