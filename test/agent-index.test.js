// test/agent-index.test.js
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/logger.js', () => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  initLogger: vi.fn(),
}));

// Mock fs so PID file write/unlink in startAgent doesn't hit the real filesystem
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    default: {
      ...actual.default,
      writeFileSync: vi.fn(),
      unlinkSync: vi.fn(),
    },
  };
});

vi.mock('../src/agent/websocket-server.js', () => ({
  AgentWebSocketServer: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(48372),
    stop: vi.fn().mockResolvedValue(),
    broadcast: vi.fn(),
  })),
}));

vi.mock('../src/agent/config.js', () => ({
  getConfigDir: vi.fn(() => '/tmp/test-config'),
  readConfig: vi.fn(() => ({ version: 1, port: 48372, token: 'test', machine: 'test' })),
  writeConfig: vi.fn(),
  ensureConfigDir: vi.fn(),
  CONFIG_VERSION: 1,
}));

vi.mock('../src/agent/project-manager.js', () => ({
  ProjectManager: vi.fn().mockImplementation(() => ({
    listProjects: vi.fn(() => []),
    pruneStaleProjects: vi.fn(),
  })),
}));

vi.mock('../src/agent/run-queue.js', () => ({
  RunQueue: vi.fn().mockImplementation(() => ({
    getQueue: vi.fn(() => []),
    getCurrent: vi.fn(() => null),
    getInterrupted: vi.fn(() => null),
  })),
}));

vi.mock('../src/agent/scheduler.js', () => ({
  Scheduler: vi.fn().mockImplementation(() => ({
    stopAll: vi.fn(),
    addSchedule: vi.fn(),
    getSchedules: vi.fn(() => []),
  })),
}));

vi.mock('../src/agent/webhook-dispatcher.js', () => ({
  WebhookDispatcher: vi.fn().mockImplementation(() => ({
    dispatch: vi.fn(),
  })),
}));

vi.mock('../src/agent/cli-bridge.js', () => ({
  CliBridge: vi.fn().mockImplementation(() => ({
    listSteps: vi.fn(),
    initRun: vi.fn(),
    runStep: vi.fn(),
    finishRun: vi.fn(),
    kill: vi.fn(),
  })),
}));

vi.mock('../src/agent/git-integration.js', () => ({
  AgentGit: vi.fn().mockImplementation(() => ({
    getDiffStat: vi.fn(),
    getDiff: vi.fn(),
    countFilesChanged: vi.fn(),
    rollback: vi.fn(),
    createPr: vi.fn(),
    merge: vi.fn(),
  })),
}));

vi.mock('../src/agent/firebase-auth.js', () => ({
  FirebaseAuth: vi.fn().mockImplementation(() => ({
    isAuthenticated: vi.fn(() => false),
    getAuthHeader: vi.fn(() => ({})),
    onTokenRefresh: vi.fn(),
    queueWebhook: vi.fn(),
    needsRefresh: vi.fn(() => false),
    setToken: vi.fn(),
  })),
}));

describe('agent index', () => {
  it('exports startAgent function', async () => {
    const { startAgent } = await import('../src/agent/index.js');
    expect(typeof startAgent).toBe('function');
  });

  it('startAgent returns wsServer, scheduler, projectManager, runQueue', async () => {
    const { startAgent } = await import('../src/agent/index.js');
    const result = await startAgent();
    expect(result).toHaveProperty('wsServer');
    expect(result).toHaveProperty('scheduler');
    expect(result).toHaveProperty('projectManager');
    expect(result).toHaveProperty('runQueue');
  });
});
