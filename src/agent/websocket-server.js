import { WebSocketServer } from 'ws';
import os from 'node:os';
import { info, debug, warn } from '../logger.js';

const RATE_LIMIT_PER_SEC = 10;

export class AgentWebSocketServer {
  constructor({ port, token, onCommand }) {
    this.port = port;
    this.token = token;
    this.onCommand = onCommand || (() => {});
    this.wss = null;
    this.clients = new Set();
  }

  start() {
    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({
        port: this.port,
        host: '127.0.0.1',
      });

      this.wss.on('listening', () => {
        const addr = this.wss.address();
        this.port = addr.port;
        info(`WebSocket server listening on ws://127.0.0.1:${this.port}`);
        resolve(this.port);
      });

      this.wss.on('error', reject);

      this.wss.on('connection', (ws) => {
        let authenticated = false;
        let messageCount = 0;
        let lastSecond = Date.now();

        ws.on('message', (raw) => {
          // Rate limiting
          const now = Date.now();
          if (now - lastSecond > 1000) {
            messageCount = 0;
            lastSecond = now;
          }
          messageCount++;
          if (messageCount > RATE_LIMIT_PER_SEC) {
            ws.send(JSON.stringify({ type: 'error', message: 'Rate limit exceeded', code: 'rate_limited' }));
            return;
          }

          let msg;
          try {
            msg = JSON.parse(raw.toString());
          } catch {
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
            return;
          }

          // Auth handshake
          if (!authenticated) {
            if (msg.type === 'auth' && msg.token === this.token) {
              authenticated = true;
              this.clients.add(ws);
              ws.send(JSON.stringify({
                type: 'connected',
                machine: process.env.COMPUTERNAME || os.hostname(),
                version: '1.0.0',
              }));
              debug('Client authenticated');
            } else {
              ws.send(JSON.stringify({ type: 'error', message: 'Invalid token', code: 'auth_failed' }));
              ws.close();
            }
            return;
          }

          // Handle commands
          if (msg.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong', id: msg.id }));
            return;
          }

          Promise.resolve(this.onCommand(msg, (response) => {
            ws.send(JSON.stringify({ ...response, id: msg.id }));
          })).catch((err) => {
            ws.send(JSON.stringify({ type: 'error', message: err.message, code: 'internal_error', id: msg.id }));
          });
        });

        ws.on('close', () => {
          this.clients.delete(ws);
          debug('Client disconnected');
        });
      });
    });
  }

  broadcast(event) {
    const data = JSON.stringify(event);
    for (const client of this.clients) {
      if (client.readyState === 1) { // WebSocket.OPEN
        client.send(data);
      }
    }
  }

  stop() {
    return new Promise((resolve) => {
      if (this.wss) {
        for (const client of this.clients) {
          client.close();
        }
        this.wss.close(resolve);
      } else {
        resolve();
      }
    });
  }
}
