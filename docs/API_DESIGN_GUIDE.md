# NightyTidy API Design Guide

This guide documents the API conventions for NightyTidy's internal HTTP servers. Follow these patterns when adding new endpoints or modifying existing ones.

---

## Overview

NightyTidy has **internal APIs** (localhost-only, GUI-to-server communication), not public REST APIs. Design decisions prioritize simplicity and frontend consistency over strict REST semantics.

## Servers

| Server | File | Purpose |
|--------|------|---------|
| GUI Server | `gui/server.js` | Desktop GUI backend |
| Dashboard | `src/dashboard.js` | Progress display (CLI mode) |
| Standalone Dashboard | `src/dashboard-standalone.js` | Orchestrator mode dashboard |

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

*Last updated: 2026-03-10*
