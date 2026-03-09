# Audit #11 -- Cross-Cutting Concerns Consistency Report

**Date**: 2026-03-09
**Scope**: All source files in `src/`, `gui/`, `bin/`
**Auditor**: Claude Opus 4.6

---

## Phase 1: Pagination -- SKIPPED

**Reason**: NightyTidy is a CLI orchestration tool with no paginated data endpoints. The dashboard HTTP servers serve a single HTML page and SSE stream. The GUI server has no list endpoints that return paginated results. Not applicable.

## Phase 2: Sorting & Filtering -- SKIPPED

**Reason**: No sortable or filterable API endpoints exist. Steps are ordered by manifest number (fixed). The `--list --json` endpoint returns all steps in fixed order. Not applicable.

## Phase 3: Soft Delete & Data Lifecycle -- SKIPPED

**Reason**: No database. NightyTidy operates on files and git repositories. Ephemeral files (`nightytidy-run.log`, `nightytidy-progress.json`, etc.) are deleted on cleanup, not soft-deleted. Not applicable.

## Phase 6: Currency -- SKIPPED

**Reason**: No money, pricing, or financial data anywhere in the codebase. Not applicable.

## Phase 7: Multi-Tenancy -- SKIPPED

**Reason**: Single-user CLI tool running locally. No user accounts, no tenant isolation, no shared state between users. Not applicable.

---

## Phase 4: Audit Logging & Activity Tracking

### 4.1 Logger Architecture

The codebase has a single canonical logger at `src/logger.js` with 4 levels:
- `debug(message)` -- verbose tracing
- `info(message)` -- normal operations
- `warn(message)` -- recoverable issues
- `error(message)` -- failures

**Log format**: `[{ISO 8601 timestamp}] [{LEVEL padded to 5}] {message}\n`
Example: `[2026-03-09T12:00:00.000Z] [INFO ] Step 1 completed`

### 4.2 Logger Usage Inventory

| Module | Uses Logger? | Functions Used | Notes |
|--------|-------------|----------------|-------|
| `src/logger.js` | Self | All | Canonical source |
| `src/cli.js` | Yes | `info`, `error`, `debug`, `warn` | Also uses `console.log/error` for terminal UX (documented exception) |
| `src/executor.js` | Yes | `info`, `warn`, `error` | Correct usage |
| `src/orchestrator.js` | Yes | `info`, `warn`, `error` | Correct usage |
| `src/claude.js` | Yes | `info`, `debug`, `warn`, `error` | Correct usage |
| `src/checks.js` | Yes | `info`, `debug`, `warn` | Correct usage |
| `src/git.js` | Yes | `info`, `debug`, `warn` | Correct usage |
| `src/notifications.js` | Yes | `debug`, `warn` | Correct usage |
| `src/lock.js` | Yes | `debug`, `warn` | Correct usage |
| `src/report.js` | Yes | `info`, `warn` | Correct usage |
| `src/setup.js` | Yes | `info` | Correct usage |
| `src/dashboard.js` | Yes | `info`, `warn` | Correct usage |
| `src/dashboard-html.js` | No | N/A | Pure HTML template -- correct |
| `src/dashboard-tui.js` | No | N/A | Standalone script, uses `chalk` directly -- correct (no logger access) |
| `src/dashboard-standalone.js` | No | N/A | Standalone detached process, uses `process.stderr.write` -- correct (can't import logger) |
| `gui/server.js` | No | N/A | Standalone GUI process, uses `console.log` -- correct (separate process) |
| `gui/resources/logic.js` | No | N/A | Browser-side -- correct |
| `gui/resources/app.js` | No | N/A | Browser-side -- correct |

### 4.3 Console Usage in Production Code

CLAUDE.md rule: "No bare `console.log` in production code -- use logger (exception: `cli.js` terminal UX output)".

| File | `console.log` | `console.error` | Justified? |
|------|--------------|-----------------|------------|
| `src/cli.js` | 31 calls | 3 calls | Yes -- documented exception for terminal UX |
| `src/dashboard-tui.js` | 0 | 1 call | Yes -- standalone process, usage output only |
| `src/dashboard-standalone.js` | 0 | 0 | Correct -- uses `process.stderr.write` |
| `gui/server.js` | 3 calls | 0 | Yes -- standalone GUI process, not part of main CLI |

**Assessment**: CONSISTENT. All production modules use the logger. Exceptions are standalone processes and documented UX output in `cli.js`.

### 4.4 Log Level Consistency

| Operation Type | Expected Level | Actual | Consistent? |
|----------------|---------------|--------|-------------|
| Pre-check pass | `info` | `info` | Yes |
| Pre-check fail | thrown Error | thrown Error | Yes |
| Step start | `info` | `info` | Yes |
| Step complete | `info` | `info` | Yes |
| Step fail | `error` | `error` | Yes |
| Retry | `warn` | `warn` | Yes |
| Non-critical failure | `warn` | `warn` | Yes |
| Spawn details | `debug` | `debug` | Yes |
| Notification sent | `debug` | `debug` | Yes |

**Assessment**: CONSISTENT. Log levels follow a clear, documented convention across all modules.

### 4.5 Significant Operations Missing Logs

| Operation | Logged? | File |
|-----------|---------|------|
| Logger init | No (implicit -- file created) | logger.js |
| Lock acquired | Yes (`debug`) | lock.js |
| Lock released | No | lock.js |
| Dashboard start | Yes (`info`) | dashboard.js |
| Dashboard stop | No | dashboard.js |
| Git branch create | Yes (`info`) | git.js |
| Git tag create | Yes (`info`) | git.js |
| Git merge | Yes (`info`) | git.js |
| Report written | Yes (`info`) | report.js |
| CLAUDE.md updated | Yes (`info`) | report.js |
| Orchestrator init | Yes (`info`) | orchestrator.js |
| Orchestrator finish | Yes (`info`) | orchestrator.js |

**Gap**: `stopDashboard()` and `releaseLock()` produce no log output. Both are fire-and-forget cleanup operations, so this is low-impact. Not worth fixing as they always run at process exit.

---

## Phase 5: Timezone & Date/Time Handling

### 5.1 Date Creation Patterns

| File | Pattern | Purpose | TZ-aware? |
|------|---------|---------|-----------|
| `logger.js:34` | `new Date().toISOString()` | Log timestamps | Yes (UTC) |
| `lock.js:81` | `new Date().toISOString()` | Lock file timestamp | Yes (UTC) |
| `lock.js:31` | `new Date(lockData.started).getTime()` | Parse lock age | Yes (parses ISO 8601) |
| `report.js:30` | `new Date(timestamp).toISOString().split('T')[0]` | Report date (YYYY-MM-DD) | Yes (UTC) |
| `git.js:14-20` | `new Date()` with manual field extraction | Branch/tag naming | **No -- local TZ** |

All `Date.now()` calls (28 total) are used for duration measurement via subtraction, which is TZ-agnostic. No issues there.

### 5.2 Date Format Consistency

| Context | Format | Source |
|---------|--------|--------|
| Log timestamps | ISO 8601 full (`2026-03-09T12:00:00.000Z`) | `logger.js` |
| Lock file `started` | ISO 8601 full | `lock.js` |
| Report date | `YYYY-MM-DD` (extracted from ISO) | `report.js:formatDate()` |
| Git branch/tag names | `YYYY-MM-DD-HHmm` (local time) | `git.js:getTimestamp()` |
| Lock display | ISO 8601 (raw from lock file) | `lock.js:promptOverride()` |

**Drift**: `git.js:getTimestamp()` uses local timezone (`new Date().getHours()`, `.getMinutes()`) while all other date operations use UTC (`toISOString()`). This means:
- Log says `[2026-03-09T23:30:00.000Z]` (UTC)
- Branch name is `nightytidy/run-2026-03-10-0730` (UTC+8 local)

This is a cosmetic inconsistency. The timestamp is only used for naming, not comparison. Using local time is arguably more user-friendly for branch names. **Not a bug, but a deliberate design choice worth documenting.**

### 5.3 Duration Formatting -- THREE Implementations

This is the most significant cross-cutting drift found:

#### Implementation 1: `report.js:formatDuration(ms)`
```js
export function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
  return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
}
```
- Used by: `cli.js`, `orchestrator.js`, `report.js`
- Output: `0m 00s`, `1m 30s`, `2h 15m` (zero-padded components)

#### Implementation 2: `dashboard-tui.js:formatMs(ms)`
```js
export function formatMs(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, '0')}m`;
}
```
- Used by: `dashboard-tui.js`
- Output: `0s`, `30s`, `1m 30s`, `2h 15m` (sub-minute shows bare seconds, not `0m 00s`)

#### Implementation 3: `dashboard-html.js:formatMs(ms)` (client-side)
```js
function formatMs(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ' + String(s % 60).padStart(2, '0') + 's';
  const h = Math.floor(m / 60);
  return h + 'h ' + String(m % 60).padStart(2, '0') + 'm';
}
```
- Used by: `dashboard-html.js` (browser dashboard)
- Output: identical to Implementation 2

#### Implementation 4: `gui/resources/logic.js:formatMs(ms)`
```js
function formatMs(ms) {
  if (!ms || ms < 0) return '0s';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
```
- Used by: `gui/resources/app.js`
- Output: `0s`, `30s`, `1m 30s`, `2h 15m 30s` (shows all three components for hours, NO zero-padding)

#### Comparison Table

| Input | `formatDuration` | `formatMs` (TUI/HTML) | `formatMs` (GUI) |
|-------|----------------|-----------------------|------------------|
| 0 | `0m 00s` | `0s` | `0s` |
| 5000 | `0m 05s` | `5s` | `5s` |
| 90000 | `1m 30s` | `1m 30s` | `1m 30s` |
| 3661000 | `1h 01m` | `1h 01m` | `1h 1m 1s` |

**Drift Summary**:
- `formatDuration` (report.js): Shows seconds even for 0ms (`0m 00s`), drops seconds for hours
- `formatMs` (TUI/HTML): Shows bare seconds for sub-minute, drops seconds for hours
- `formatMs` (GUI): Shows all components, no zero-padding, never drops seconds

**Impact**: Low. Each format is used in its own context (reports vs TUI vs GUI). Users won't see them side-by-side. However, the GUI version showing `1h 1m 1s` vs the report showing `1h 01m` is noticeable if a user compares.

---

## Phase 8: Error Response & Status Code Consistency

### 8.1 HTTP Server Inventory

Three HTTP servers exist:

1. **Dashboard server** (`src/dashboard.js`) -- interactive mode
2. **Dashboard standalone** (`src/dashboard-standalone.js`) -- orchestrator mode
3. **GUI server** (`gui/server.js`) -- desktop GUI

### 8.2 Error Response Shape Comparison

#### 404 Not Found

| Server | Status | Content-Type | Body | Security Headers |
|--------|--------|-------------|------|------------------|
| Dashboard | 404 | none | `Not found` (plain text) | No |
| Standalone | 404 | none | `Not found` (plain text) | No |
| GUI | 404 | none | `Not Found` (plain text, capitalized) | No |

**Drift**: Capitalization inconsistency (`Not found` vs `Not Found`). No security headers on 404 responses in any server. All servers omit Content-Type on 404 (Node.js defaults to `text/plain`).

#### 403 Forbidden

| Server | Context | Content-Type | Body | Security Headers |
|--------|---------|-------------|------|------------------|
| Dashboard | Invalid CSRF | `application/json` | `{ "error": "Invalid token" }` | No |
| Dashboard | Malformed JSON | `application/json` | `{ "error": "Invalid token" }` | No |
| Standalone | Invalid CSRF | `application/json` | `{ "error": "Invalid token" }` | No |
| Standalone | Malformed JSON | `application/json` | `{ "error": "Invalid token" }` | No |
| GUI | Path traversal | none | `Forbidden` (plain text) | No |

**Drift**: Dashboard/Standalone return JSON errors; GUI returns plain text. Dashboard/Standalone lack security headers on error responses. GUI also lacks security headers on 403.

#### 413 Request Too Large

| Server | Content-Type | Body | Security Headers |
|--------|-------------|------|------------------|
| Dashboard | `application/json` | `{ "error": "Request body too large" }` | No |
| Standalone | `application/json` | `{ "error": "Request body too large" }` | No |
| GUI | N/A (silently resolves `{}`) | N/A | N/A |

**Drift**: GUI server's `readBody()` silently swallows oversized bodies by resolving to `{}` instead of returning a 413 error. The downstream handler then returns `{ ok: false, error: "No command provided" }` with 400 status -- a misleading error message for what was actually a body-too-large issue.

#### API Error Response Shape

| Server | Success Shape | Error Shape | Consistent? |
|--------|-------------|-------------|-------------|
| Dashboard `/stop` | `{ ok: true }` | `{ error: "..." }` (no `ok` field) | **No** |
| Standalone `/stop` | `{ ok: true, message: "..." }` | `{ error: "..." }` (no `ok` field) | **No** |
| GUI API endpoints | `{ ok: true, ... }` | `{ ok: false, error: "..." }` | Yes |

**Drift**: Dashboard servers use `{ error: string }` for errors (no `ok: false`), while the GUI server consistently uses `{ ok: false, error: string }`. This means error checking differs:
- GUI client: `if (!result.ok)` -- works correctly
- Dashboard client (HTML): checks for `.error` presence in the response

This drift is **already documented** in `.claude/memory/dashboard.md` line 57: "Error responses on `/stop` use `{ error: string }` shape (no `ok` field). This differs from GUI server which always includes `ok: false`."

### 8.3 Security Headers on Error Responses

| Server | 200 responses | Error responses (4xx) |
|--------|--------------|----------------------|
| Dashboard | Yes (CSP, X-Frame, X-Content-Type) | **No** |
| Standalone | Yes (HTML only) | **No** |
| GUI | Yes (all responses via `sendJson` and `serveStatic`) | **Only on `sendJson`** (400 errors have headers; 403/404 plain text does not) |

**Drift**: All three servers apply security headers to 200 responses but inconsistently on error responses. The GUI server is closest to correct (400 errors via `sendJson` get headers) but its 403 and 404 plain-text responses lack them.

### 8.4 CSP Header Inconsistency

| Server | CSP `script-src` | CSP `style-src` |
|--------|-----------------|-----------------|
| Dashboard | `'unsafe-inline'` | `'unsafe-inline'` |
| Standalone | `'unsafe-inline'` | `'unsafe-inline'` |
| GUI | `'self'` | `'self'` |

This is **correct behavior**, not drift: the dashboard serves inline CSS/JS within the HTML template (`dashboard-html.js`), so it requires `'unsafe-inline'`. The GUI serves separate static files, so `'self'` is correct.

### 8.5 Orchestrator JSON Output Consistency

All orchestrator commands output consistent JSON:

| Command | Success Shape | Failure Shape |
|---------|-------------|---------------|
| `--list --json` | `{ steps: [...] }` | N/A (always succeeds) |
| `--init-run` | `{ success: true, runBranch, tagName, ... }` | `{ success: false, error: "..." }` |
| `--run-step` | `{ success: true, step, name, status, ... }` | `{ success: false, error: "..." }` |
| `--finish-run` | `{ success: true, completed, failed, ... }` | `{ success: false, error: "..." }` |

**Assessment**: CONSISTENT. The `ok()` and `fail()` helper functions in `orchestrator.js` enforce a uniform shape.

### 8.6 Information Leakage Check

| Server | Stack traces? | Internal paths? | PID exposure? |
|--------|--------------|-----------------|---------------|
| Dashboard | No | No | No |
| Standalone | No | No | stdout only (captured by spawner) |
| GUI | No | No (file errors say "File not found or unreadable") | No |

**Assessment**: CONSISTENT. No information leakage in error responses.

---

## Phase 9: Synthesis & Drift Map

### Concern Ratings

| Concern | Rating | Notes |
|---------|--------|-------|
| Logging (logger usage) | **Consistent** | All production modules use logger; exceptions are documented standalone processes |
| Logging (level consistency) | **Consistent** | Levels follow clear patterns across all modules |
| Date creation (UTC vs local) | **Minor drift** | `git.js:getTimestamp()` uses local time; all others use UTC. Documented design choice. |
| Duration formatting | **Significant drift** | 4 independent implementations with different output formats |
| Error response shape | **Minor drift** | Dashboard `{ error }` vs GUI `{ ok: false, error }`. Already documented. |
| Security headers on errors | **Minor drift** | Applied to 200 responses but inconsistently on 4xx responses |
| 404 body text | **Minor drift** | `Not found` vs `Not Found` capitalization |
| Body-too-large handling | **Minor drift** | Dashboard returns 413; GUI silently swallows to `{}` |

### Root Cause Analysis

1. **Duration formatting drift**: The 4 implementations were created independently across different development phases. `formatDuration` in `report.js` was the original. `formatMs` in `dashboard-tui.js` was written for the TUI progress display. `dashboard-html.js` copied the TUI version into client-side JS. `gui/resources/logic.js` wrote a fresh implementation for the GUI. No shared utility was created.

2. **Error response shape drift**: Dashboard endpoints predate the GUI server. The dashboard's `/stop` endpoint returns `{ error: string }` directly, while the GUI server established the `{ ok: boolean, error?: string }` convention later with `sendJson()`.

3. **Security headers on errors**: Each server was implemented separately. The pattern of spreading `...SECURITY_HEADERS` was consistently applied to success responses but forgotten on plain-text error responses (403, 404) which use raw `res.writeHead(status)` without the spread.

### Prevention Recommendations

1. **Duration formatting**: Not worth consolidating now -- each context (reports, TUI, browser dashboard, GUI) has slightly different needs and display contexts. Document the intentional differences. If a shared format is ever needed, extract to a shared utility.

2. **Error responses**: For new HTTP endpoints, follow the GUI server pattern: always use `sendJson()` with `{ ok: boolean, error?: string }` shape. The dashboard servers serve a narrow internal purpose and don't need to be changed.

3. **Security headers on errors**: Add `SECURITY_HEADERS` to 404 and 403 responses across all servers. This is a safe, mechanical fix.

---

## Recommended Actions

### Safe Mechanical Fixes

1. **Add security headers to error responses in dashboard servers** (`dashboard.js`, `dashboard-standalone.js`): 404 responses should include security headers.
2. **Normalize 404 body text**: Use `Not found` consistently (lowercase `f`) across all three servers. The GUI server uses `Not Found` (capitalized).
3. **Add security headers to GUI server plain-text error responses**: 403 and 404 responses in `gui/server.js` should include security headers.

### Deferred (Not Safe for Mechanical Fix)

4. **Duration formatting consolidation**: Document the differences; do not consolidate (different display contexts).
5. **Error response shape unification**: Document the convention; do not change dashboard servers (different clients, already documented).
6. **GUI `readBody` oversized body handling**: The silent `resolve({})` pattern is safe but misleading. Could return a 413 error, but this would change behavior for the GUI client.

---

## Changes Made

1. Added security headers to 404 responses in `dashboard.js` and `dashboard-standalone.js`
2. Added security headers to 403 and 404 responses in `gui/server.js`
3. Normalized 404 body text to `Not found` (lowercase) in `gui/server.js`
4. Updated `gui-server.test.js` to match normalized 404 body text
