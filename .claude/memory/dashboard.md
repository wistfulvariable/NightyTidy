# Dashboard — Tier 2 Reference

Assumes CLAUDE.md loaded. Progress display in `src/dashboard.js` + `src/dashboard-tui.js`.

## Constants

| Constant | Value | File |
|----------|-------|------|
| `SHUTDOWN_DELAY` | 3,000 ms | dashboard.js |
| `MAX_BODY_BYTES` | 1,024 bytes | dashboard.js, dashboard-standalone.js |
| `POLL_INTERVAL` | 1,000 ms | dashboard-tui.js |
| `POLL_INTERVAL` | 500 ms | dashboard-standalone.js |
| `EXIT_DELAY` | 5,000 ms | dashboard-tui.js |
| `BAR_WIDTH` | 30 chars | dashboard-tui.js |
| `MAX_VISIBLE_STEPS` | 16 | dashboard-tui.js |
| `requestTimeout` | 30,000 ms | dashboard.js, dashboard-standalone.js |
| `headersTimeout` | 15,000 ms | dashboard.js, dashboard-standalone.js |
| `SHUTDOWN_FORCE_EXIT_MS` | 10,000 ms | dashboard-standalone.js |

## Architecture

Three display systems (context-dependent):
1. **TUI window**: `dashboard-tui.js` spawned in separate terminal, reads `nightytidy-progress.json`
2. **HTTP server (interactive)**: In-process server in `dashboard.js` — serves HTML + SSE, push-based
3. **HTTP server (orchestrator)**: Detached `dashboard-standalone.js` — serves same HTML + SSE, poll-based

Interactive mode uses #1 + #2. Orchestrator mode uses #3 only (spawned by `--init-run`, killed by `--finish-run`). All are fire-and-forget — failure must not crash the run.

## Exports (dashboard.js)

| Function | Purpose |
|----------|---------|
| `startDashboard(state, { onStop, projectDir })` | Start TUI + HTTP, write progress file |
| `updateDashboard(state)` | Write progress file + broadcast SSE |
| `stopDashboard()` | Clean up files, close server, kill TUI |
| `scheduleShutdown()` | 3s delay then `stopDashboard()` |
| `broadcastOutput(chunk)` | Stream Claude output to SSE + progress JSON |
| `clearOutputBuffer()` | Reset output buffer between steps |

## Exports (dashboard-tui.js — for testing)

`formatMs(ms)`, `progressBar(done, total, hasActive)`, `render(state)`

Main entry guarded: `process.argv[1]?.endsWith('dashboard-tui.js')` — prevents side effects on import.

## State Object (shared mutable reference)

```js
{ status, currentStep, completedCount, failedCount, totalSteps, steps: [...], startTime, elapsed }
```

Updated by `cli.js` callbacks -> passed to `updateDashboard()` -> written to JSON + SSE broadcast.

## HTTP Endpoints (dashboard.js + dashboard-standalone.js)

- `GET /` -> HTML dashboard (inline CSS/JS, dark theme, real-time updates). Security headers: CSP, X-Frame-Options: DENY, X-Content-Type-Options: nosniff
- `GET /events` -> SSE stream (text/event-stream, no-cache). No security headers (SSE streams).
- `POST /stop` -> CSRF-protected. Requires `{ token }` body matching server-generated token. Returns 403 on invalid token, 413 if body exceeds 1 KB, 200 with `{ ok: true }` on valid. Dashboard calls `onStop` callback; standalone returns `{ ok: true, message: 'Stop not supported in orchestrator mode' }`.
- Unknown routes -> 404 plain text with security headers (added in audit #11)
- Error responses on `/stop` use `{ error: string }` shape (no `ok` field). This differs from GUI server which always includes `ok: false`. Intentional — different clients.

## TUI Spawn (Platform-Specific)

- **Windows**: `spawn('start "NightyTidy" node "tui.js" "progress.json"', [], { shell: true })`
- **macOS**: `spawn('open', ['-a', 'Terminal', tuiScript, '--args', filePath])`
- **Linux**: `spawn('x-terminal-emulator', ['-e', 'node', tuiScript, filePath])`

## Standalone Polling Optimization (Audit #18)

`dashboard-standalone.js` compares raw file content strings (`lastRawJson`) instead of double-`JSON.stringify` to detect changes. This avoids one `JSON.parse` + one `JSON.stringify` per poll cycle when the file hasn't changed (the common case at 500ms polling).

## Shutdown & State Cleanup

- `stopDashboard()`: clear broadcastOutput throttle timer -> delete ephemeral files -> close SSE clients -> close HTTP server -> reset state (`tuiProcess = null` added audit #25)
- Throttle timer (`outputWriteTimer`) cleared in `stopDashboard()` to prevent stale writes after cleanup (audit #21)
- Called directly on abort (not `scheduleShutdown()` — `process.exit` kills timers)
- Orchestrator: `dashboard-standalone.js` killed via SIGTERM by `finishRun()` -> `stopDashboardServer(pid)`. Interval ID stored in `pollIntervalId` and cleared on SIGTERM (previously passed function reference to `clearInterval` by mistake).
- `dashboard-standalone.js` SIGTERM has 10s force-exit timeout (audit #20). `server.close()` waits for connections; SSE connections never close on their own. Force timer is `.unref()`ed to not block Node's event loop if server closes cleanly.

## Module-Level State (dashboard.js)

11 mutable variables. All reset by `stopDashboard()` except `tuiProcess` (unref'd, self-terminating).
SSE `outputBuffer` cleared by `clearOutputBuffer()` between steps and on stop.
Client-side `elapsedInterval` persists across SSE reconnects (correct: reconnect does not clear it).

## Error Handling

All errors swallowed. Server fail -> TUI-only. TUI fail -> HTTP-only. Both fail -> run continues.
Orchestrator mode: spawn fail -> `dashboardUrl: null` in output, run continues without dashboard.

## HTTP API Contract Tests

Dashboard endpoints verified in `dashboard.test.js` (20 tests) and `dashboard-broadcastoutput.test.js` (5 tests):
- `GET /` — returns 200, content-type text/html, includes CSP + X-Frame-Options headers
- `GET /events` — returns 200, content-type text/event-stream, sends initial state event
- `POST /stop` — requires CSRF token (403 without, 200 with), calls onStop callback
- Unknown routes — returns 404
- `startDashboard` return shape: `{ url: string, port: number }`
- SSE events: state events on connect + updateDashboard, output events on broadcastOutput
