import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentWebSocketServer } from '../src/agent/websocket-server.js';
import WebSocket from 'ws';

vi.mock('../src/logger.js', () => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  initLogger: vi.fn(),
}));

describe('AgentWebSocketServer', () => {
  let server, port, token;

  beforeEach(async () => {
    token = 'test-token-123';
    server = new AgentWebSocketServer({ port: 0, token }); // port 0 = random
    port = await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  it('starts and listens on a port', () => {
    expect(port).toBeGreaterThan(0);
  });

  it('rejects connections without valid token', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise((resolve) => {
      ws.on('close', resolve);
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'auth', token: 'wrong' }));
      });
    });
  });

  it('accepts connections with valid token', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const msg = await new Promise((resolve) => {
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'auth', token }));
      });
      ws.on('message', (data) => {
        resolve(JSON.parse(data.toString()));
      });
    });
    expect(msg.type).toBe('connected');
    ws.close();
  });

  it('broadcasts events to connected clients', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise((resolve) => {
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'auth', token }));
      });
      ws.on('message', resolve); // connected message
    });

    const eventPromise = new Promise((resolve) => {
      ws.on('message', (data) => resolve(JSON.parse(data.toString())));
    });

    server.broadcast({ type: 'run-started', runId: 'test' });
    const event = await eventPromise;
    expect(event.type).toBe('run-started');
    ws.close();
  });

  it('handles ping/pong', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise((resolve) => {
      ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token })));
      ws.on('message', resolve);
    });

    const pongPromise = new Promise((resolve) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'pong') resolve(msg);
      });
    });

    ws.send(JSON.stringify({ type: 'ping' }));
    const pong = await pongPromise;
    expect(pong.type).toBe('pong');
    ws.close();
  });
});
