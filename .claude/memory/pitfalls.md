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
Claude Code sets `CLAUDECODE` to prevent nested sessions. Must strip via `cleanEnv()` in both `claude.js` and `checks.js` before spawning.

### spawn stdin Defaults to Pipe
Node.js `spawn()` defaults stdin to `'pipe'`. If piped but never written to, `claude` hangs. Use `stdio: ['ignore', 'pipe', 'pipe']` when not sending via stdin.

### Empty Stdout on Success
Exit code 0 with no stdout → failure → retry. Whitespace-only also empty. Harmless but causes unnecessary retries.

### Timeout Race Condition
`runOnce()` has `settled` flag to prevent double-resolve. Both timeout and close/error handlers check it.

### SIGKILL Grace Period
`child.kill()` SIGTERM → 5s timer → SIGKILL. Timer NOT cleared if process exits during window. Harmless — `try { child.kill('SIGKILL') } catch {}`.

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

## Singleton State Risks

- `logger.js`: Re-calling `initLogger()` clears the log file.
- `git.js`: Re-calling `initGit()` changes working directory for all callers.
- Both safe in production (init once), but tests must re-init per test.
