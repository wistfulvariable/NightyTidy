# Audit #07 -- API Design & Consistency Report

**Date**: 2026-03-09
**Scope**: All HTTP API surfaces + CLI flag interface + orchestrator JSON API
**Auditor**: Claude Opus 4.6

---

## Phase 1: API Surface Inventory

### 1A. Dashboard HTTP Server (`src/dashboard.js`)

Serves an in-process HTTP server during interactive CLI runs. Binds to `127.0.0.1:0` (random port).

| Method | Path | Request Body | Response | Auth | Status Codes |
|--------|------|-------------|----------|------|-------------|
| GET | `/` | -- | HTML page (inline CSS/JS) | None | 200 |
| GET | `/events` | -- | SSE stream (text/event-stream) | None | 200 |
| POST | `/stop` | `{ token: string }` | `{ ok: true }` or `{ error: string }` | CSRF token | 200, 403 |
| * | `*` | -- | `Not found` (plain text) | None | 404 |

**Security headers on HTML**: CSP, X-Frame-Options: DENY, X-Content-Type-Options: nosniff
**Security headers on JSON**: None (no X-Content-Type-Options on /stop responses)
**Security headers on SSE**: None
**Security headers on 404**: None

### 1B. Dashboard Standalone Server (`src/dashboard-standalone.js`)

Identical routing to dashboard.js -- serves same HTML/SSE/stop endpoints. Spawned as a detached process in orchestrator mode. Polls `nightytidy-progress.json` for state.

Same endpoint surface as 1A. Same security headers on HTML. Same gaps on JSON/SSE/404.

### 1C. GUI Server (`gui/server.js`)

Desktop GUI backend. Binds to `127.0.0.1:0`. Opens Chrome in `--app` mode.

| Method | Path | Request Body | Response | Auth | Status Codes |
|--------|------|-------------|----------|------|-------------|
| GET | `/` | -- | `index.html` (static) | None | 200 |
| GET | `/*` | -- | Static file from `gui/resources/` | None | 200, 403, 404 |
| POST | `/api/select-folder` | -- | `{ ok: true, folder: string\|null }` | **None** | 200 |
| POST | `/api/run-command` | `{ command: string, id?: string }` | `{ ok: true, exitCode, stdout, stderr }` or `{ ok: false, error }` | **None** | 200, 400 |
| POST | `/api/kill-process` | `{ id: string }` | `{ ok: true }` or `{ ok: false, error }` | **None** | 200 |
| POST | `/api/read-file` | `{ path: string }` | `{ ok: true, content }` or `{ ok: false, error }` | **None** | 200, 400 |
| POST | `/api/exit` | -- | `{ ok: true }` | **None** | 200 |
| OPTIONS | `*` | -- | (empty, CORS headers) | None | 204 |

**Security headers on static files**: X-Content-Type-Options: nosniff
**Security headers on JSON API**: Access-Control-Allow-Origin: * (on all responses via `sendJson`)
**Missing from GUI server**: CSP, X-Frame-Options, CSRF protection, request body size limits

### 1D. Orchestrator JSON API (`src/orchestrator.js`)

Not HTTP -- CLI flags that produce JSON stdout. Process exit code indicates success (0) or failure (1).

| Flag | Input | Output (JSON) | Error Output |
|------|-------|--------------|-------------|
| `--list --json` | -- | `{ steps: [{ number, name, description }] }` | N/A (exits 0) |
| `--init-run` | `--steps <nums>`, `--timeout <min>` | `{ success, runBranch, tagName, originalBranch, selectedSteps, dashboardUrl }` or `{ success: false, error }` | Exit 1 on failure |
| `--run-step <N>` | `--timeout <min>` | `{ success, step, name, status, duration, durationFormatted, attempts, remainingSteps }` or `{ success: false, error }` | Exit 1 on failure |
| `--finish-run` | -- | `{ success, completed, failed, totalDurationFormatted, merged, mergeConflict, reportPath, tagName, runBranch }` or `{ success: false, error }` | Exit 1 on failure |

### 1E. CLI Flag Surface (`src/cli.js`)

| Flag | Type | Default | Validation |
|------|------|---------|-----------|
| `--all` | boolean | false | N/A |
| `--steps <numbers>` | string (CSV) | -- | Numbers parsed, range-checked against STEPS.length |
| `--list` | boolean | false | N/A |
| `--setup` | boolean | false | N/A |
| `--timeout <minutes>` | integer | 45 | `parseInt`, checked for positive finite number |
| `--dry-run` | boolean | false | N/A |
| `--json` | boolean | false | Only meaningful with `--list` |
| `--init-run` | boolean | false | N/A |
| `--run-step <N>` | integer | -- | `parseInt` (no range validation in cli.js -- orchestrator validates) |
| `--finish-run` | boolean | false | N/A |

---

## Phase 2: Naming & URL Consistency

### 2A. URL Path Consistency

**Dashboard**: Uses bare paths (`/`, `/events`, `/stop`)
**GUI server**: Uses `/api/` prefix for API routes (`/api/select-folder`, `/api/run-command`, `/api/kill-process`, `/api/read-file`, `/api/exit`). Static files served at root.

**Assessment**: Within each server, naming is consistent. The dashboard and GUI server serve different purposes and are never accessed simultaneously by the same client, so the difference in URL patterns is acceptable. The GUI server's `/api/` prefix is a good practice.

**Issues found**:
- Minor: GUI server uses `kebab-case` for endpoint names (`select-folder`, `run-command`, `kill-process`, `read-file`). This is consistent. Good.
- Dashboard `/stop` lacks the `/api/` prefix, but this is a simple 3-endpoint server. Acceptable.

### 2B. JSON Response Field Naming

| Surface | Success Fields | Error Fields | Naming Convention |
|---------|---------------|-------------|-------------------|
| Dashboard `/stop` | `{ ok: true }` | `{ error: string }` | `ok` boolean + `error` string |
| Dashboard standalone `/stop` | `{ ok: true, message: string }` | `{ error: string }` | `ok` + `message` |
| GUI server (all endpoints) | `{ ok: true, ... }` | `{ ok: false, error: string }` | `ok` boolean + `error` string |
| Orchestrator JSON | `{ success: true, ... }` | `{ success: false, error: string }` | `success` boolean + `error` string |
| `--list --json` | `{ steps: [...] }` | -- | No success/error wrapper |

**Issues found**:
1. **INCONSISTENCY -- `ok` vs `success`**: Dashboard and GUI use `{ ok: true/false }`. Orchestrator uses `{ success: true/false }`. The `--list --json` output has no wrapper at all.
2. **Dashboard `/stop` success response lacks `ok` vs standalone**: Dashboard returns `{ ok: true }`. Standalone returns `{ ok: true, message: 'Stop not supported in orchestrator mode' }`. Not a problem since they serve different contexts.
3. **`--list --json` has no `success` wrapper**: Returns `{ steps: [...] }` directly. All other orchestrator endpoints wrap in `{ success: true, ...data }`.

**Risk assessment**: The `ok` vs `success` inconsistency is a design-level issue rather than a bug. The GUI client (`app.js`) only talks to the GUI server (uses `ok`). The orchestrator mode client (`app.js` via `parseCliOutput`) reads orchestrator output and checks `data.success`. These are separate consumers that never cross -- no breaking change needed. Documented as a known inconsistency.

### 2C. CLI Flag Naming Consistency

All flags use `--kebab-case`. Commander auto-converts to `camelCase` in options (e.g., `--dry-run` becomes `opts.dryRun`, `--init-run` becomes `opts.initRun`).

**Assessment**: Consistent. Good.

---

## Phase 3: HTTP Method & Status Code Correctness

### 3A. HTTP Methods

| Endpoint | Method | Correct? | Notes |
|----------|--------|----------|-------|
| Dashboard `GET /` | GET | Yes | Read-only, cacheable |
| Dashboard `GET /events` | GET | Yes | SSE is a GET upgrade |
| Dashboard `POST /stop` | POST | Yes | State-changing action |
| GUI `GET /` | GET | Yes | Static file |
| GUI `POST /api/select-folder` | POST | Yes | Triggers side effect (OS dialog) |
| GUI `POST /api/run-command` | POST | Yes | State-changing (spawns process) |
| GUI `POST /api/kill-process` | POST | Yes | State-changing (kills process) |
| GUI `POST /api/read-file` | POST | Yes | Acceptable. File path in body avoids URL encoding issues, though GET with query param would be semantically purer. |
| GUI `POST /api/exit` | POST | Yes | State-changing (process exit) |

**Assessment**: All methods are semantically correct.

### 3B. Status Codes

| Endpoint | Status | Correct? | Notes |
|----------|--------|----------|-------|
| Dashboard `GET /` | 200 | Yes | |
| Dashboard `GET /events` | 200 | Yes | SSE convention |
| Dashboard `POST /stop` (valid token) | 200 | Yes | |
| Dashboard `POST /stop` (invalid token) | 403 | Yes | Forbidden |
| Dashboard unknown route | 404 | Yes | |
| GUI static 200 | 200 | Yes | |
| GUI static traversal | 403 | Yes | |
| GUI static not found | 404 | Yes | |
| GUI `/api/run-command` (no command) | 400 | Yes | Bad request |
| GUI `/api/read-file` (no path) | 400 | Yes | Bad request |
| GUI `/api/read-file` (file not found) | **200** | **Issue** | Returns `{ ok: false, error }` with 200 status |
| GUI `/api/read-file` (success) | 200 | Yes | |
| GUI `/api/kill-process` (already dead) | 200 | Yes | Idempotent -- correct |
| GUI `/api/kill-process` (kill error) | **200** | **Issue** | Returns `{ ok: false, error }` with 200 status |
| GUI `/api/run-command` (spawn error) | **200** | **Issue** | Returns `{ ok: false, error }` with 200 status |
| GUI OPTIONS | 204 | Yes | No Content |

**Issues found**:
1. **GUI server returns 200 for some error conditions**: When `handleReadFile` can't read a file, when `handleKillProcess` fails to kill, and when `handleRunCommand` spawn errors occur, the response is `200` with `{ ok: false, error: ... }`. Changing these to 500 would be more HTTP-correct, but since the only consumer (`app.js`) checks `result.ok` not `res.status`, this is a consistency issue rather than a bug. The `readBody` fallback to `{}` on parse failure is already handled by the subsequent validation logic (no path -> 400).

---

## Phase 4: Error Response Consistency

### 4A. Error Response Shapes

| Surface | Error Shape | Consistent? |
|---------|------------|-------------|
| Dashboard `/stop` (403) | `{ error: "Invalid token" }` | No `ok` field |
| GUI `/api/run-command` (400) | `{ ok: false, error: "No command provided" }` | Has `ok` |
| GUI `/api/read-file` (400) | `{ ok: false, error: "No path provided" }` | Has `ok` |
| GUI `/api/read-file` (file error) | `{ ok: false, error: "File not found or unreadable" }` | Has `ok` |
| GUI `/api/run-command` (spawn error) | `{ ok: false, error: err.message }` | Has `ok` |
| GUI `/api/kill-process` (kill error) | `{ ok: false, error: err.message }` | Has `ok` |
| Orchestrator error | `{ success: false, error: "message" }` | Uses `success` not `ok` |

**Issues found**:
1. **Dashboard error responses omit `ok: false`**: The `/stop` endpoint returns `{ error: "Invalid token" }` on 403, without an `ok` field. The GUI server always includes `ok: false` on errors. The dashboard client JS (`stopRun()` in dashboard-html.js) uses a fire-and-forget fetch and doesn't check the response body, so this is a non-issue in practice.

### 4B. Sensitive Information Leakage

| Surface | Leak Risk | Assessment |
|---------|-----------|-----------|
| Dashboard HTML | Embeds CSRF token in inline JS | Expected -- token is for same-origin use |
| GUI `/api/run-command` | Returns full stdout/stderr | Expected -- GUI is localhost-only, same user |
| GUI `/api/read-file` | Returns arbitrary file contents | **Risk**: No path restriction beyond filesystem permissions. Localhost-only mitigates. |
| GUI error messages | `err.message` from spawn/kill | Safe -- Node.js error messages, no stack traces |
| Orchestrator errors | Step-level error messages | Safe -- actionable, no internals |
| Dashboard/standalone 404 | Plain text "Not found" | Safe |

**Issues found**:
1. **GUI `/api/read-file` is an unrestricted file reader**: Any file readable by the Node.js process can be read via POST. This is acceptable for a localhost-only desktop GUI where the user IS the operator, but should be documented as a trust boundary.
2. **No stack traces leaked**: Error handlers consistently return `err.message` only. Good.

---

## Phase 5: Request Validation

### 5A. HTTP Endpoint Input Validation

| Endpoint | Validates Input? | Details |
|----------|-----------------|---------|
| Dashboard `POST /stop` | **Yes** | CSRF token, JSON parse |
| GUI `POST /api/run-command` | **Partial** | Checks `command` is present. No body size limit. No command sanitization (by design -- trusted local client). |
| GUI `POST /api/read-file` | **Partial** | Checks `path` is present. No path traversal restriction (by design -- desktop app). No body size limit. |
| GUI `POST /api/kill-process` | **Partial** | Reads `id` from body. Does not validate `id` is a string or present (undefined -> Map.get(undefined) -> undefined -> returns `ok:true`). |
| GUI `POST /api/select-folder` | **N/A** | No input expected. |
| GUI `POST /api/exit` | **N/A** | No input expected. |
| Standalone `POST /stop` | **Yes** | Same CSRF as dashboard. |

**Issues found**:
1. **No request body size limit on any endpoint**: Neither dashboard nor GUI server limits incoming request body size. An attacker on localhost could send an unbounded body to exhaust memory. Risk: Low (localhost only), but easy to fix.
2. **`handleKillProcess` does not validate `id` parameter**: Missing `id` silently returns `ok: true` (already dead path). Not harmful, but a missing validation gap.
3. **`readBody` in GUI server silently swallows JSON parse errors**: Returns `{}` on invalid JSON. This is then caught by downstream validation (e.g., `!command` check). This is acceptable error handling.

### 5B. CLI Flag Validation

| Flag | Validated? | Details |
|------|-----------|---------|
| `--timeout` | **Yes** | `parseInt`, checked for positive finite. Error message with value shown. |
| `--steps` | **Yes** | Parsed to integers, range-checked against `STEPS.length`. In orchestrator: `validateStepNumbers()`. |
| `--run-step` | **Partial** | `parseInt` by Commander. Orchestrator validates against selected steps. NaN not explicitly caught by cli.js (Commander handles the parsing). |
| `--all`, `--list`, `--setup`, `--dry-run`, `--json`, `--init-run`, `--finish-run` | **N/A** | Booleans -- no validation needed. |

**Assessment**: CLI flag validation is thorough. Good.

---

## Phase 6: Miscellaneous API Quality

### 6A. Security Headers

| Server | CSP | X-Frame-Options | X-Content-Type-Options | CORS |
|--------|-----|-----------------|----------------------|------|
| Dashboard (HTML) | Yes | DENY | nosniff | No |
| Dashboard (JSON) | No | No | No | No |
| Dashboard (SSE) | No | No | No | No |
| Dashboard (404) | No | No | No | No |
| Standalone (HTML) | Yes | DENY | nosniff | No |
| Standalone (JSON) | No | No | No | No |
| GUI (static HTML) | No | No | nosniff | No |
| GUI (static CSS/JS) | No | No | nosniff | No |
| GUI (JSON API) | No | No | No | `Access-Control-Allow-Origin: *` |

**Issues found**:
1. **GUI server lacks CSP and X-Frame-Options on HTML**: `index.html` is served without Content-Security-Policy or X-Frame-Options. While localhost-only, adding these is defense-in-depth.
2. **GUI server has `Access-Control-Allow-Origin: *` on all JSON responses**: This means any website the user visits could make requests to the GUI server if it knows the port. Combined with no CSRF protection and the `/api/run-command` endpoint (which executes arbitrary shell commands), this is a **significant vulnerability** even for a localhost server. A malicious website could:
   - Enumerate ports and discover the GUI server
   - POST to `/api/run-command` with arbitrary shell commands
   - Read files via `/api/read-file`
   This is mitigated by the ephemeral random port, but the CORS `*` header actively removes browser protections.
3. **Dashboard server has NO CORS headers**: This is actually more secure than the GUI server's `*`. Browsers block cross-origin requests by default, which is the correct behavior for localhost servers.

### 6B. CSRF Protection

| Server | Has CSRF? | Details |
|--------|-----------|---------|
| Dashboard | **Yes** | Token generated via `crypto.randomBytes(16)`, embedded in HTML, verified on POST /stop |
| Dashboard standalone | **Yes** | Same pattern |
| GUI server | **No** | All POST endpoints unprotected |

**Issues found**:
1. **GUI server has no CSRF protection**: Combined with `Access-Control-Allow-Origin: *`, this is the highest-severity finding in this audit. A cross-origin POST to `/api/run-command` could execute arbitrary commands. **Fix: Remove `Access-Control-Allow-Origin: *` or restrict it to same-origin, and/or add CSRF tokens.**

### 6C. Rate Limiting

No rate limiting on any server. Acceptable for localhost-only servers with single-user access.

### 6D. Content Types

All JSON responses correctly set `Content-Type: application/json`. Static files correctly use MIME type lookup. SSE correctly uses `text/event-stream`. Good.

### 6E. Request Body Handling

- `readBody()` in GUI server has no size limit. A large POST body could exhaust memory.
- Dashboard `handleStop` reads body without size limit, but the expected body is tiny (CSRF token).
- Dashboard standalone has the same pattern.

---

## Summary of Findings

### Critical (Fix Required)

| # | Finding | Location | Impact |
|---|---------|----------|--------|
| C1 | **GUI server uses `Access-Control-Allow-Origin: *` with no CSRF on command execution endpoint** | `gui/server.js` `sendJson()` | Any website can execute shell commands on the user's machine if they know the port |

### Medium (Recommended Fix)

| # | Finding | Location | Impact |
|---|---------|----------|--------|
| M1 | GUI server lacks security headers (CSP, X-Frame-Options) on HTML | `gui/server.js` `serveStatic()` | Defense-in-depth gap |
| M2 | No request body size limit on any HTTP endpoint | `gui/server.js`, `dashboard.js`, `dashboard-standalone.js` | Memory exhaustion via large POST |
| M3 | `handleKillProcess` does not validate `id` parameter presence | `gui/server.js` line 149 | Silent no-op on missing id |

### Low (Informational)

| # | Finding | Location | Impact |
|---|---------|----------|--------|
| L1 | `ok` vs `success` inconsistency between GUI and orchestrator JSON | Multiple files | Cosmetic -- different consumers |
| L2 | Dashboard error responses omit `ok: false` field | `dashboard.js` line 71 | No consumer checks this |
| L3 | `--list --json` output lacks `success` wrapper | `cli.js` line 297 | Different pattern from other orchestrator outputs |
| L4 | GUI `/api/read-file` (file error) returns 200 not 404/500 | `gui/server.js` line 185 | Consumer uses `ok` field, not status code |
| L5 | Dashboard JSON/SSE/404 responses lack security headers | `dashboard.js` | Localhost only, low risk |

---

## Recommended Actions

### Immediate (Phase C)

1. **Fix C1**: Remove `Access-Control-Allow-Origin: *` from GUI server `sendJson()`. The GUI client (Chrome --app) makes same-origin requests -- CORS headers are unnecessary. Since the GUI is same-origin (served from the same server), removing CORS entirely is the correct fix.
2. **Fix M1**: Add security headers (CSP, X-Frame-Options, X-Content-Type-Options) to GUI server HTML responses.
3. **Fix M2**: Add a request body size limit to `readBody()` in GUI server (e.g., 1MB). Dashboard body limit is less critical (CSRF token is tiny) but easy to add.
4. **Fix M3**: Add `id` parameter validation to `handleKillProcess`.

### Future Consideration (Not in scope)

- Unify `ok` vs `success` field naming (breaking change -- requires coordinating GUI and orchestrator consumers)
- Add CSRF tokens to GUI server (defense-in-depth, but removing CORS is sufficient since same-origin requests work without CORS)
- Add security headers to dashboard JSON/SSE responses (very low risk)

---

## Test Impact

Changes in Phase C will require:
- `gui-server.test.js` updates to remove CORS header assertions
- New tests for body size limit enforcement
- New test for kill-process id validation
