// test/agent-setup-flow.test.js
//
// Strategy: Full mocking — no real HTTP servers, no real browser launches.
// We mock node:http createServer to capture the request handler, then drive
// the OAuth callback by calling that handler directly with fake req/res objects.
// This makes tests instant and reliable across all platforms.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
const mockSpawn = vi.fn(() => ({ unref: vi.fn() }));
vi.mock('node:child_process', () => ({
  spawn: (...args) => mockSpawn(...args),
}));

// ── node:http mock — fake server that captures the request handler ──────────
//
// The fake server:
//   - exposes `capturedHandler` so tests can invoke it directly
//   - tracks its `listening` state
//   - calls the 'listening' event immediately in listen()
//   - provides address() returning a fixed port (48399)
//
let capturedHandler = null;

const FAKE_PORT = 48399;

function makeFakeServer() {
  let listeningFired = false;
  const server = {
    capturedHandler: null,
    _closed: false,
    once(event, cb) {
      if (event === 'listening') {
        if (listeningFired) {
          // listen() was already called — fire immediately
          cb();
        } else {
          // Store for when listen() is called
          server._listeningCb = cb;
        }
      }
      return server;
    },
    address() {
      return { port: FAKE_PORT };
    },
    listen(port, host) {
      listeningFired = true;
      if (server._listeningCb) {
        server._listeningCb();
        server._listeningCb = null;
      }
      return server;
    },
    close(cb) {
      server._closed = true;
      if (cb) cb();
    },
  };
  return server;
}

let fakeServer = null;

vi.mock('node:http', () => ({
  default: {
    createServer: (handler) => {
      capturedHandler = handler;
      fakeServer = makeFakeServer();
      fakeServer.capturedHandler = handler;
      return fakeServer;
    },
    request: vi.fn(),
  },
  createServer: (handler) => {
    capturedHandler = handler;
    fakeServer = makeFakeServer();
    fakeServer.capturedHandler = handler;
    return fakeServer;
  },
}));

// ── Fake req/res helpers ───────────────────────────────────────────────────

/**
 * Create a minimal fake IncomingMessage-like object.
 * To simulate body data, call triggerData() then triggerEnd().
 */
function makeFakeReq({ method = 'POST', url = '/callback', body = null } = {}) {
  const listeners = {};
  const req = {
    method,
    url,
    on(event, cb) {
      listeners[event] = cb;
      return req;
    },
    _emit(event, ...args) {
      if (listeners[event]) listeners[event](...args);
    },
  };
  return req;
}

/**
 * Create a minimal fake ServerResponse-like object that captures written output.
 */
function makeFakeRes() {
  const res = {
    statusCode: null,
    headers: {},
    body: '',
    writeHead(code, headers) {
      res.statusCode = code;
      if (headers) Object.assign(res.headers, headers);
    },
    end(data) {
      if (data) res.body += data;
    },
  };
  return res;
}

/**
 * Simulate a full POST /callback request through the captured handler,
 * delivering the given payload as JSON body.
 */
async function simulateCallback(payload) {
  const req = makeFakeReq({ method: 'POST', url: '/callback' });
  const res = makeFakeRes();
  capturedHandler(req, res);
  // Deliver body chunks
  req._emit('data', JSON.stringify(payload));
  req._emit('end');
  return res;
}

/**
 * Simulate an OPTIONS preflight request.
 */
async function simulateOptions() {
  const req = makeFakeReq({ method: 'OPTIONS', url: '/callback' });
  const res = makeFakeRes();
  capturedHandler(req, res);
  return res;
}

/**
 * Simulate an unknown route request.
 */
async function simulateUnknown() {
  const req = makeFakeReq({ method: 'GET', url: '/unknown-route' });
  const res = makeFakeRes();
  capturedHandler(req, res);
  return res;
}

// ── driveFlow ──────────────────────────────────────────────────────────────

/**
 * Start setupAgent() and immediately drive the OAuth callback by invoking
 * the captured request handler directly — no real HTTP, no real browser.
 *
 * @param {object} payload - OAuth callback payload
 * @param {{ beforeCallback?: () => Promise<void> }} [opts]
 */
async function driveFlow(payload, opts = {}) {
  const { setupAgent } = await import('../src/agent/setup-flow.js');

  // Start the flow — it creates the server, sets capturedHandler, then awaits
  // the 'listening' event (which our fake server fires synchronously in listen()).
  const flowPromise = setupAgent();
  // Silence unhandled-rejection warnings for flows that call process.exit(1)
  flowPromise.catch(() => {});

  // Yield a microtask to let setupAgent() advance past the server.listen() call
  // and reach the waitForCallback() await.
  await Promise.resolve();

  if (opts.beforeCallback) {
    await opts.beforeCallback();
  }

  // Drive the callback through the captured handler
  await simulateCallback(payload);

  const result = await flowPromise.then(
    (v) => ({ status: 'fulfilled', value: v }),
    (e) => ({ status: 'rejected', reason: e }),
  );

  return { result };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('setupAgent()', () => {
  let originalExit;
  let consoleLogSpy;
  let consoleErrorSpy;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedHandler = null;
    fakeServer = null;

    // Reset spawn mock
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
  });

  it('includes the encoded callback address with the ephemeral port in the auth URL', async () => {
    const { result } = await driveFlow({ token: 'tok-abc' });
    expect(result.status).toBe('fulfilled');

    const allArgs = mockSpawn.mock.calls[0].flat(Infinity).join(' ');
    expect(allArgs).toContain('callback=');
    expect(allArgs).toContain('127.0.0.1');
    expect(allArgs).toContain(String(FAKE_PORT));
  });

  it('calls FirebaseAuth.setToken with the token field from the callback', async () => {
    const { result } = await driveFlow({ token: 'firebase-token-xyz' });
    expect(result.status).toBe('fulfilled');
    expect(mockSetToken).toHaveBeenCalledWith('firebase-token-xyz');
  });

  it('falls back to idToken when token field is absent', async () => {
    const { result } = await driveFlow({ idToken: 'id-token-fallback' });
    expect(result.status).toBe('fulfilled');
    expect(mockSetToken).toHaveBeenCalledWith('id-token-fallback');
  });

  it('creates FirebaseAuth with the configDir from getConfigDir()', async () => {
    const { result } = await driveFlow({ token: 'tok-abc' });
    expect(result.status).toBe('fulfilled');
    expect(MockFirebaseAuth).toHaveBeenCalledWith('/home/user/.nightytidy');
  });

  it('calls registerService()', async () => {
    const { result } = await driveFlow({ token: 'tok-abc' });
    expect(result.status).toBe('fulfilled');
    expect(mockRegisterService).toHaveBeenCalledTimes(1);
  });

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
  });

  it('prints a done message referencing nightytidy.com', async () => {
    // Capture console.log calls for this test
    const printedLines = [];
    consoleLogSpy.mockImplementation((...args) => {
      printedLines.push(args.map(String).join(' '));
    });

    const { result } = await driveFlow({ token: 'tok-abc' });
    expect(result.status).toBe('fulfilled');

    const allOutput = printedLines.join('\n');
    expect(allOutput.toLowerCase()).toMatch(/done/);
    expect(allOutput).toMatch(/nightytidy\.com/i);
  });

  it('exits with code 1 when the callback has an error field', async () => {
    const { result } = await driveFlow({ error: 'access_denied' });
    expect(result.status).toBe('rejected');
    expect(result.reason.message).toMatch(/process\.exit\(1\)/);
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('exits with code 1 when the callback has neither token nor idToken', async () => {
    const { result } = await driveFlow({ uid: 'user-123' });
    expect(result.status).toBe('rejected');
    expect(result.reason.message).toMatch(/process\.exit\(1\)/);
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('continues with a warning when registerService() fails', async () => {
    mockRegisterService.mockReturnValueOnce({
      success: false,
      error: 'Permission denied',
      fallbackInstructions: 'Add to startup manually',
    });

    const printedLines = [];
    consoleLogSpy.mockImplementation((...args) => {
      printedLines.push(args.map(String).join(' '));
    });

    const { result } = await driveFlow({ token: 'tok-abc' });
    expect(result.status).toBe('fulfilled');
    expect(mockSetToken).toHaveBeenCalledWith('tok-abc');

    // Agent should still be spawned
    const agentSpawnCall = mockSpawn.mock.calls.find(
      ([execPath, args]) =>
        execPath === process.execPath && Array.isArray(args) && args.includes('agent'),
    );
    expect(agentSpawnCall).toBeDefined();

    const allOutput = printedLines.join('\n');
    expect(allOutput.toLowerCase()).toMatch(/warning/);
  });

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
  });

  it('responds 204 with CORS headers to OPTIONS preflight', async () => {
    const { setupAgent } = await import('../src/agent/setup-flow.js');
    const flowPromise = setupAgent();
    flowPromise.catch(() => {});

    await Promise.resolve();

    // Send OPTIONS before the real callback
    const optionsRes = await simulateOptions();
    expect(optionsRes.statusCode).toBe(204);
    // The source uses 'Access-Control-Allow-Origin' (mixed case); check case-insensitively
    const corsHeader =
      optionsRes.headers['Access-Control-Allow-Origin'] ||
      optionsRes.headers['access-control-allow-origin'];
    expect(corsHeader).toBe('https://nightytidy.com');

    // Complete the flow with a valid callback
    await simulateCallback({ token: 'tok-abc' });
    const result = await flowPromise.then(
      (v) => ({ status: 'fulfilled', value: v }),
      (e) => ({ status: 'rejected', reason: e }),
    );
    expect(result.status).toBe('fulfilled');
  });

  it('responds 404 for unknown routes', async () => {
    const { setupAgent } = await import('../src/agent/setup-flow.js');
    const flowPromise = setupAgent();
    flowPromise.catch(() => {});

    await Promise.resolve();

    // Send unknown route before the real callback
    const unknownRes = await simulateUnknown();
    expect(unknownRes.statusCode).toBe(404);

    // Complete the flow
    await simulateCallback({ token: 'tok-abc' });
    const result = await flowPromise.then(
      (v) => ({ status: 'fulfilled', value: v }),
      (e) => ({ status: 'rejected', reason: e }),
    );
    expect(result.status).toBe('fulfilled');
  });
});
