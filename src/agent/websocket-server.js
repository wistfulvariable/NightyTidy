import http from 'node:http';
import { WebSocketServer } from 'ws';
import os from 'node:os';
import { info, debug, warn } from '../logger.js';

const RATE_LIMIT_PER_SEC = 10;

export class AgentWebSocketServer {
  constructor({ port, token, onCommand, onAuthCallback }) {
    this.port = port;
    this.token = token;
    this.onCommand = onCommand || (() => {});
    this.onAuthCallback = onAuthCallback || (() => {});
    this.wss = null;
    this.httpServer = null;
    this.clients = new Set();
  }

  start() {
    return new Promise((resolve, reject) => {
      this.httpServer = http.createServer((req, res) => {
        // CORS headers for cross-origin fetch from nightytidy.com
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', '*');

        // Handle OPTIONS preflight
        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        const remoteAddress = req.socket.remoteAddress;
        const isLocalhost =
          remoteAddress === '127.0.0.1' ||
          remoteAddress === '::1' ||
          remoteAddress === '::ffff:127.0.0.1';

        if (req.method === 'GET' && req.url === '/auth-info') {
          // Only respond to requests from localhost
          if (!isLocalhost) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Forbidden' }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ port: this.port, token: this.token }));
          return;
        }

        if (req.method === 'POST' && req.url === '/auth-callback') {
          let body = '';
          req.on('data', (chunk) => {
            body += chunk.toString();
            if (body.length > 65536) {
              req.destroy();
            }
          });
          req.on('end', () => {
            let parsed;
            try {
              parsed = JSON.parse(body);
            } catch {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Invalid JSON' }));
              return;
            }
            const { token } = parsed;
            if (!token || typeof token !== 'string') {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Missing token' }));
              return;
            }
            debug('Auth callback received Firebase token');
            this.onAuthCallback({ token });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          });
          return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      });

      this.wss = new WebSocketServer({ server: this.httpServer });

      this.httpServer.on('error', reject);

      this.httpServer.listen(this.port, '127.0.0.1', () => {
        const addr = this.httpServer.address();
        this.port = addr.port;
        info(`WebSocket server listening on ws://127.0.0.1:${this.port}`);
        resolve(this.port);
      });

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
        this.wss.close(() => {
          if (this.httpServer) {
            this.httpServer.close(resolve);
          } else {
            resolve();
          }
        });
      } else if (this.httpServer) {
        this.httpServer.close(resolve);
      } else {
        resolve();
      }
    });
  }
}
