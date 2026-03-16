# NightyTidy API Design Guide

This guide documents the API conventions for NightyTidy's HTTP servers and Cloud Functions. Follow these patterns when adding new endpoints or modifying existing ones.

---

## Overview

NightyTidy has two API layers with different conventions:

1. **Local APIs** (localhost-only, GUI/dashboard-to-server) — prioritize simplicity and frontend consistency over strict REST semantics.
2. **Cloud Functions** (Firebase-hosted, remote) — follow REST conventions with Bearer token auth.

## Servers

| Server | File | Purpose | Convention |
|--------|------|---------|------------|
| GUI Server | `gui/server.js` | Desktop GUI backend | Local |
| Dashboard | `src/dashboard.js` | Progress display (CLI mode) | Local |
| Standalone Dashboard | `src/dashboard-standalone.js` | Orchestrator mode dashboard | Local |
| Cloud Functions | `functions/src/*.ts` | Remote API (webhook, runs, health) | Cloud |

---

## URL Naming

### Pattern

```
/api/<action>-<resource>
```

### Rules

1. **Use `/api/` prefix** for JSON endpoints
2. **Use kebab-case** for path segments
3. **Use action-resource naming** (verb-noun)
4. **Keep paths shallow** (no nested resources)

### Examples

```
Good:
  /api/run-command
  /api/read-file
  /api/kill-process
  /api/log-error

Bad:
  /api/runCommand      (camelCase)
  /api/file/read       (resource-action reversed)
  /api/commands/run    (unnecessary nesting)
```

---

## HTTP Methods

### Internal GUI API Convention

Use **POST for all API endpoints**, including read operations.

**Rationale:**
- Consistency — all API calls use the same fetch pattern
- Security — keeps sensitive data out of URLs/logs
- Simplicity — no different configurations per endpoint

### When to Use Other Methods

Only static file serving uses GET:
```
GET /                    # Serve index.html
GET /<filename>          # Serve static files
GET /events              # SSE stream (special case)
```

---

## Request Format

### Content-Type

All POST requests use `application/json`:

```javascript
fetch('/api/endpoint', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ key: 'value' }),
});
```

### Field Naming

Use **camelCase** for all request fields:

```json
{
  "command": "npm test",
  "processId": "proc-123",
  "filePath": "/path/to/file"
}
```

---

## Response Format

### Success Response

```json
{
  "ok": true,
  "field1": "value1",
  "field2": "value2"
}
```

### Error Response

```json
{
  "ok": false,
  "error": "Human-readable error message"
}
```

### Rules

1. Always include `ok: boolean` as the first property
2. Use `error` (not `message` or `errorMessage`) for error text
3. Use camelCase for all field names
4. Keep responses flat when possible

---

## Status Codes

| Code | When to Use |
|------|-------------|
| **200** | Successful operation |
| **400** | Missing required field or invalid input |
| **403** | Authorization failure (CSRF, allowlist) |
| **404** | Resource not found (files, routes) |
| **413** | Request body too large |

### Example Patterns

```javascript
// Missing required field → 400
if (!body.command) {
  sendJson(res, { ok: false, error: 'No command provided' }, 400);
  return;
}

// Not in allowlist → 403
if (!ALLOWED.includes(filename)) {
  sendJson(res, { ok: false, error: 'Not an allowed file' }, 403);
  return;
}

// File not found → 200 with ok: false (soft error)
// OR → 404 (hard error, depends on use case)
```

---

## Validation

### Where to Validate

Validate at the **start of each handler function**:

```javascript
async function handleRunCommand(req, res) {
  const body = await readBody(req);

  // Validate first
  if (!body.command) {
    sendJson(res, { ok: false, error: 'No command provided' }, 400);
    return;
  }

  // Then process
  // ...
}
```

### What to Validate

1. **Required fields** — return 400 if missing
2. **Allowlists** — return 403 if not permitted
3. **CSRF tokens** — return 403 if invalid

### Error Message Pattern

```
"No <field> provided"
"Not an allowed <resource>"
"Invalid <thing>"
```

---

## Security Headers

### Required Headers

Include on **every response** (200 and error responses):

```javascript
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'",
};

res.writeHead(status, {
  'Content-Type': 'application/json; charset=utf-8',
  ...SECURITY_HEADERS,
});
```

### CSRF Protection

State-mutating endpoints that could be triggered cross-origin need CSRF protection:

```javascript
// Generate token on server start
const csrfToken = randomBytes(16).toString('hex');

// Embed in HTML response
const html = `... token: '${csrfToken}' ...`;

// Verify in POST handler
if (body.token !== csrfToken) {
  res.writeHead(403, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Invalid token' }));
  return;
}
```

---

## Body Size Limits

| Use Case | Limit |
|----------|-------|
| General API (commands, paths) | 1 MB |
| Simple actions (CSRF tokens) | 1 KB |

```javascript
const MAX_BODY_BYTES = 1024 * 1024; // 1 MB

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > MAX_BODY_BYTES) {
        req.destroy();
        resolve({});
      }
    });
    // ...
  });
}
```

---

## Timeouts

Configure on every HTTP server:

```javascript
server.requestTimeout = 30_000;  // 30s for entire request
server.headersTimeout = 15_000;  // 15s for headers
```

---

## Path Traversal Protection

When serving static files, use trailing separator boundary check:

```javascript
const boundary = RESOURCES_DIR.endsWith(sep) ? RESOURCES_DIR : RESOURCES_DIR + sep;
if (!filePath.startsWith(boundary) && filePath !== RESOURCES_DIR) {
  res.writeHead(403, { ...SECURITY_HEADERS });
  res.end('Forbidden');
  return;
}
```

---

## SSE (Server-Sent Events)

For real-time streaming:

```javascript
// Response headers
res.writeHead(200, {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive',
});

// Event format
res.write(`event: <event-name>\ndata: ${JSON.stringify(data)}\n\n`);
```

---

## Adding a New Endpoint

### Checklist

1. [ ] Use POST method
2. [ ] Use `/api/<action>-<resource>` path
3. [ ] Validate required fields at handler start
4. [ ] Return `{ ok: true, ... }` on success
5. [ ] Return `{ ok: false, error: "..." }` with appropriate status on failure
6. [ ] Include `SECURITY_HEADERS` on all responses
7. [ ] Add test coverage in `test/gui-server.test.js`
8. [ ] Document the contract in code comments

### Template

```javascript
async function handleNewEndpoint(req, res) {
  const body = await readBody(req);

  // Validate required fields
  if (!body.requiredField) {
    sendJson(res, { ok: false, error: 'No requiredField provided' }, 400);
    return;
  }

  try {
    // Process the request
    const result = await doSomething(body.requiredField);

    // Success response
    sendJson(res, { ok: true, result });
  } catch (err) {
    // Error response
    sendJson(res, { ok: false, error: err.message });
  }
}
```

---

## Anti-Patterns

### Don't Do This

```javascript
// Wrong: Using different methods for similar operations
GET /api/read-file?path=...
POST /api/write-file

// Wrong: Inconsistent error format
{ success: false, message: "Error" }  // Should be ok + error
{ error: true, msg: "Error" }         // Should be ok + error

// Wrong: Missing security headers on errors
res.writeHead(400);  // Missing SECURITY_HEADERS

// Wrong: camelCase in URLs
/api/readFile  // Should be /api/read-file

// Wrong: Nested resources
/api/files/read  // Should be /api/read-file
```

---

## Cloud Functions Conventions

Cloud Functions (`functions/src/*.ts`) follow different conventions from the local APIs. This section documents the target patterns for new Cloud Functions.

### URL Naming

Function names become URL paths automatically (Firebase convention):

```
/webhookIngest   → POST (camelCase — Firebase convention)
/runs            → GET  (resource name)
/status          → GET  (health check)
```

### HTTP Methods

Use standard REST semantics:
- **GET** for read-only endpoints
- **POST** for write/action endpoints

Guard methods at handler start:

```typescript
if (req.method !== 'POST') {
  res.status(405).send('Method not allowed');
  return;
}
```

### Authentication

All Cloud Functions (except health checks) require Firebase ID Token:

```typescript
const authHeader = req.headers.authorization;
if (!authHeader?.startsWith('Bearer ')) {
  res.status(401).send('Unauthorized');
  return;
}

const token = authHeader.split('Bearer ')[1];
const decoded = await admin.auth().verifyIdToken(token);
const uid = decoded.uid;
```

### Response Format

```typescript
// Success — JSON via res.json()
res.status(200).json({ ok: true });
res.status(200).json({ runs: data });

// Error — plain text via res.send() (current convention)
res.status(401).send('Unauthorized');
res.status(405).send('Method not allowed');
res.status(429).send('Too many requests');
```

### Rate Limiting

Apply to write endpoints. Use the Firestore-backed sliding window pattern:

```typescript
const RATE_LIMIT_PER_MIN = 60;
// ... (see webhookIngest.ts for full implementation)
```

Rate limiter **fails open** — if the Firestore transaction fails, the request proceeds. This prevents rate limiting infrastructure from blocking legitimate requests.

### Status Codes

| Code | When to Use |
|------|-------------|
| **200** | Successful operation |
| **401** | Missing or invalid auth token |
| **405** | Wrong HTTP method |
| **429** | Rate limit exceeded |

### Adding a New Cloud Function

1. [ ] Create `functions/src/<name>.ts`
2. [ ] Export from `functions/src/index.ts`
3. [ ] Add method guard (`if (req.method !== ...)`)
4. [ ] Add auth verification (Bearer token) unless public
5. [ ] Add rate limiting for write endpoints
6. [ ] Validate request body fields
7. [ ] Return JSON for success, plain text for errors
8. [ ] Add contract tests in `functions/src/__tests__/apiContracts.test.ts`

### Field Naming (All Layers)

Use **camelCase** everywhere — request bodies, response bodies, Firestore documents, TypeScript interfaces:

```
projectId, projectName, startedAt, finishedAt, totalCost, filesChanged
```

### Timestamp Fields

Use Unix milliseconds (not ISO strings, not Firestore Timestamps):

```
startedAt: Date.now()    // 1700000000000
finishedAt: Date.now()
updatedAt: Date.now()
```

---

*Last updated: 2026-03-16*
