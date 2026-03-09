# Pitfalls — Tier 2 Reference

Assumes CLAUDE.md loaded. Platform-specific issues, bugs, and gotchas.

## Windows

### spawn Shell Mode (CRITICAL)
`spawn('claude', ...)` without `shell: true` gets ENOENT on Windows — `claude` is a `.cmd` file. Both `claude.js` and `checks.js` set `shell: platform() === 'win32'` upfront. **Never** use spawn-then-ENOENT-retry — causes 0xC0000142 under sustained use.

### TUI Window Spawn
`spawn('cmd', ['/c', 'start', ...])` misparses paths with spaces. Instead: `spawn('start "title" node "path"', [], { shell: true, windowsHide: true })`. Add `uncaughtException` handler in TUI — `cmd` windows close silently on crash.

### EBUSY on Temp Dirs
`simple-git` holds file handles after operations. Tests MUST use `robustCleanup()` from `test/helpers/cleanup.js` (5 retries, 200ms delays) instead of raw `rm()`.

### Disk Space Check
Tries PowerShell `Get-PSDrive` first, falls back to `wmic logicaldisk`. Unix uses `df -k`. All methods can fail — check logs "skipped" and continues.

### Path Separators
`simple-git` handles normalization. Use `path.join()` throughout — no hardcoded separators.

## Subprocess

### CLAUDECODE Env Var Blocks Nesting
Claude Code sets `CLAUDECODE` to prevent nested sessions. Must strip via `cleanEnv()` from `src/env.js` (shared utility imported by both `claude.js` and `checks.js`) before spawning.

### spawn stdin Defaults to Pipe
Node.js `spawn()` defaults stdin to `'pipe'`. If piped but never written to, `claude` hangs. Use `stdio: ['ignore', 'pipe', 'pipe']` when not sending via stdin.

### Empty Stdout on Success
Exit code 0 with no stdout → failure → retry. Whitespace-only also empty. Harmless but causes unnecessary retries.

### Timeout Race Condition
`runOnce()` has `settled` flag to prevent double-resolve. Both timeout and close/error handlers check it.

### SIGKILL Grace Period
`child.kill()` SIGTERM → 5s timer → SIGKILL. Timer NOT cleared if process exits during window. Harmless — `try { child.kill('SIGKILL') } catch {}`.

### clearInterval Requires the ID, Not the Function
`clearInterval(myFunction)` is a no-op — must pass the ID returned by `setInterval()`. Found in audit #18 on `dashboard-standalone.js`. Always store interval IDs when cleanup is needed.

## Testing

### vi.doMock() Leaks Across Tests
`vi.doMock()` registrations persist across `vi.resetModules()`. Must `vi.doUnmock()` in `afterEach`.

### ESM Main-Module Guard
Standalone scripts calling `process.exit()` at top level crash smoke tests on import. Guard with: `process.argv[1]?.replace(/\\/g, '/').endsWith('script.js')`. See `dashboard-tui.js`.

### Dashboard State Mutability
`dashState` in `cli.js` is shared object reference. Callbacks mutate asynchronously. Test shape/properties, not initial values.

### Non-TTY Requires Explicit Flags
`process.stdin.isTTY` is falsy in CI/non-interactive environments. CLI exits with error unless `--all` or `--steps` provided.

## Git

### Ephemeral Files Must Never Be Tracked
`nightytidy-run.log`, `nightytidy-progress.json`, `nightytidy-dashboard.url` in target project root. `git add -A` would track them. Fix: `excludeEphemeralFiles()` adds them to `.git/info/exclude` — `fallbackCommit` then uses plain `git add -A` which respects these exclusions.

## Logging Conventions

### Log Message Prefixes
Each module uses a consistent prefix for log messages so they can be traced in the log file:
- `checks.js`: `Pre-check: ...`
- `claude.js`: `Claude Code ...` / `Running Claude Code: ...`
- `executor.js`: `Step N: StepName — ...`
- `orchestrator.js`: `Orchestrator: ...` (not `NightyTidy orchestrator:`)
- `dashboard.js`: `Dashboard ...`
- `lock.js`: No prefix (context is clear)

### Dashboard Log Levels
Dashboard failures use `info()`, not `warn()`, because dashboard is non-critical (TUI fallback exists). The run continues fine without the dashboard. Reserve `warn()` for actual degradation.

### GUI Error Messages
GUI (`gui/resources/app.js`) must never show raw JS error objects or Node.js internals (ENOENT, stack traces). Always wrap with user-friendly message. See `docs/ERROR_MESSAGES.md` GUI section.

## Data Integrity

### JSON File Reads
All JSON file reads (`lock`, `state`, `progress`) have `try/catch` around `JSON.parse`. Corrupt or torn files are handled gracefully (lock = stale, state = no run, progress = skip tick). **Never add a JSON read without a parse error handler.**

### Lock File Atomicity
Uses `openSync(path, 'wx')` — O_CREAT + O_EXCL. This is a single kernel operation; no TOCTOU race. **Do not replace with exists-then-write.**

### State File Atomic Writes
`writeState()` in `orchestrator.js` uses write-to-temp-then-rename (`writeFileSync` to `.tmp` then `renameSync`). This prevents truncated JSON on crash. `readState()` still returns `null` on parse failure as a safety net. The `.tmp` file is in the ephemeral files list (`git.js`). Fixed in audit #21.

### CLI Argument Validation
`parseInt` coercion can produce `NaN` for non-numeric strings. Always guard with `Number.isFinite()` after `parseInt` for numeric CLI args (`--run-step`, `--timeout`).

## HTTP Server Shutdown

### server.close() Waits for Connections
Node's `server.close()` waits for all active connections to drain. SSE connections never close on their own. Any shutdown handler using `server.close(callback)` must have a force-exit timeout to prevent hanging. Pattern: close SSE clients explicitly, then `setTimeout(() => process.exit(), ms).unref()` before `server.close()`. The `.unref()` lets Node exit naturally if `server.close()` completes before the timer. Applied in `dashboard-standalone.js` (10s) and `gui/server.js` (5s) in audit #20.

### Request Timeouts on HTTP Servers
All HTTP servers must set `server.requestTimeout` and `server.headersTimeout` to prevent slow/malicious clients from holding connections indefinitely. SSE connections are excluded by design (headers written immediately). Applied to `dashboard.js`, `dashboard-standalone.js`, and `gui/server.js` in audit #20 (30s request, 15s headers).

## Singleton State Risks

- `logger.js`: Re-calling `initLogger()` clears the log file.
- `git.js`: Re-calling `initGit()` changes working directory for all callers.
- Both safe in production (init once), but tests must re-init per test.

## Concurrency & Race Conditions (Audit #21)

### broadcastOutput Throttle Timer
`broadcastOutput()` uses a 500ms `setTimeout` for throttled disk writes. `stopDashboard()` clears this timer to prevent stale writes after cleanup. Track timer ID in `outputWriteTimer` module variable.

### Progress JSON Torn Reads
`writeFileSync` is not atomic. Dashboard/TUI readers may see truncated JSON if they read mid-write. All readers wrap `JSON.parse` in try/catch and skip the tick. No fix needed -- the polling interval (500ms-1s) ensures the next read succeeds.

### SIGINT Sequencing
First SIGINT aborts the current Claude subprocess and sets `abortController.abort()`. The executor checks `signal.aborted` at loop top and breaks cleanly. `handleAbortedRun()` commits a partial report. Second SIGINT calls `process.exit(1)`. No git corruption risk -- safety tag preserves pre-run state.

### Lock File vs SIGKILL
`process.on('exit')` handler cleans the lock file on normal exit. SIGKILL leaves an orphan, but `isLockStale()` detects dead PIDs and auto-removes. 24-hour `MAX_LOCK_AGE_MS` catches PID recycling on Windows.

### fs Mock Must Include renameSync
Orchestrator tests mock `fs`. Since `writeState()` uses `renameSync`, the mock must include it: `renameSync: vi.fn()`. Without it, the try/catch in orchestrator functions catches the error and returns `{ success: false }`.
