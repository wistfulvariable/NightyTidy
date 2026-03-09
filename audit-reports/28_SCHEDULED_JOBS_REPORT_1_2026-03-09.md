# Audit #28 — Scheduled Jobs & Background Processes

**Date**: 2026-03-09
**Scope**: All `setInterval`/`setTimeout` usage, child process lifecycle, lock file concurrency guard, CI pipeline

## Executive Summary

NightyTidy has no traditional scheduled jobs, cron tasks, message queues, or background workers. It **is** the scheduled job — users run it overnight. The audit focused on timer lifecycle (cleanup of `setInterval`/`setTimeout`), child process management, the lock file concurrency guard, and the CI pipeline.

**Result**: 2 low-severity findings, 0 high/medium. All `setInterval` timers are properly cleared. All child processes have cleanup paths. Two `setTimeout` instances lack `.unref()` calls that could delay Node.js shutdown by up to 5 seconds in edge cases.

## Timer Inventory

### setInterval (5 production instances)

| Location | Purpose | Cleanup | Verdict |
|----------|---------|---------|---------|
| `dashboard-html.js:378` | Elapsed time display (1s, client-side JS in browser) | Cleared on terminal status at line 440 | OK |
| `dashboard-standalone.js:146` | Poll progress JSON (500ms) | Cleared on SIGTERM at line 161 | OK |
| `dashboard-tui.js:162` | Poll progress JSON (1s) | Cleared on terminal status at line 171 | OK |
| `gui/resources/app.js:355` | Poll progress file (500ms) | Cleared by `stopProgressPolling()` | OK |
| `gui/resources/app.js:367` | Elapsed time display (1s) | Cleared by `stopElapsedTimer()` | OK |

All `setInterval` timers are properly cleared. The GUI app also clears both timers in `finishRun()` and `resetApp()`.

### setTimeout (10 production instances)

| Location | Purpose | Cleared? | Verdict |
|----------|---------|----------|---------|
| `claude.js:14` (in `forceKillChild`) | SIGKILL escalation after 5s | No clearTimeout, no .unref() | **FINDING-01** |
| `claude.js:27` (in `sleep`) | Retry delay between attempts | Cleared on abort signal | OK |
| `claude.js:68` (in `waitForChild`) | Step timeout | Cleared on close/error/abort | OK |
| `checks.js:22` (in `runCommand`) | Command timeout | Cleared on close/error | OK |
| `dashboard.js:274` (in `broadcastOutput`) | Throttled progress write (500ms) | Cleared in `stopDashboard()` | OK |
| `dashboard.js:307` (in `scheduleShutdown`) | Delayed dashboard shutdown (3s) | Cleared in `stopDashboard()` | OK |
| `dashboard-standalone.js:164` | Force-exit safety net (10s) | `.unref()` called | OK |
| `gui/server.js:220` (in `handleExit`) | Delayed process.exit (200ms) | One-shot, process exits | OK |
| `gui/server.js:374` (in `shutdownHandler`) | Force-exit safety net (5s) | `.unref()` called | OK |
| `orchestrator.js:136` (in `createOutputHandler`) | Throttled output write (500ms) | No explicit cleanup | **FINDING-02** |
| `orchestrator.js:165` (in `spawnDashboardServer`) | Dashboard startup timeout (5s) | Cleared when dashboard responds | OK |
| `orchestrator.js:424` (in `finishRun`) | SSE flush delay (500ms) | One-shot, awaited | OK |

## Child Process Inventory

| Location | What it spawns | Lifecycle | Cleanup | Verdict |
|----------|---------------|-----------|---------|---------|
| `claude.js:48` | `claude` CLI subprocess | Killed on timeout/abort via `forceKillChild()` | Close/error handlers remove event listeners and clear timers | OK |
| `checks.js:12` | `git`, `claude`, `powershell`/`wmic`/`df` | Short-lived, completes or times out | Timeout kills child, close/error clear timer | OK |
| `checks.js:91` | `claude` interactive auth | `stdio: 'inherit'`, waits for close | Close/error handlers | OK |
| `dashboard.js:119-134` | TUI terminal window | `detached: true`, `.unref()` | Fire-and-forget by design | OK |
| `orchestrator.js:156` | `dashboard-standalone.js` | `detached: true`, `.unref()` after setup | Killed via `stopDashboardServer(pid)` sending SIGTERM in `finishRun()` | OK |
| `gui/server.js:143` | Shell command (user-initiated) | Tracked in `activeProcesses` Map | `killAllProcesses()` on shutdown/exit, removed from Map on close/error | OK |
| `gui/server.js:325` | Chrome browser | `detached: true`, `.unref()` | Fire-and-forget by design | OK |
| `gui/server.js:94-114` | PowerShell/osascript/zenity folder dialog | `execSync` with 60s timeout | Synchronous, blocks until done | OK |

## Lock File (Concurrency Guard)

The lock file (`nightytidy.lock`) serves as NightyTidy's overlap protection, analogous to what a job scheduler would provide.

| Aspect | Implementation | Verdict |
|--------|---------------|---------|
| Atomic creation | `openSync(path, 'wx')` — O_EXCL flag prevents TOCTOU | OK |
| Staleness detection | PID liveness check + 24h age limit (handles PID recycling on Windows) | OK |
| Auto-cleanup (interactive) | `process.on('exit')` handler removes lock | OK |
| Auto-cleanup (orchestrator) | Persistent mode — `releaseLock()` called explicitly in `finishRun()` | OK |
| TTY override prompt | Async readline prompt when lock appears active | OK |
| Non-TTY rejection | Throws with actionable error message | OK |

## CI Pipeline

The CI pipeline (`.github/workflows/ci.yml`) is event-triggered (push/PR), not scheduled:

| Aspect | Status | Notes |
|--------|--------|-------|
| Trigger type | `push` + `pull_request` on `master` | Not scheduled — no cron |
| Job timeout | Uses GitHub Actions default (6h) | Adequate for test suites |
| Matrix | 2 OS x 3 Node versions = 6 runners | Parallelized |
| Path filtering | Skips docs-only changes | Efficient |

No findings for CI.

## Findings

### FINDING-01: `forceKillChild` setTimeout lacks `.unref()` (Low)

**File**: `src/claude.js:14`
**Risk**: Low — cosmetic / shutdown delay

The `setTimeout` in `forceKillChild()` that escalates from SIGTERM to SIGKILL after 5 seconds neither has a `clearTimeout` nor calls `.unref()`. If the child process exits immediately after the initial `kill()`, the 5-second timer still runs. This can delay Node.js process exit by up to 5 seconds in edge cases (e.g., user presses Ctrl+C and process would otherwise exit sooner).

The try/catch around `child.kill('SIGKILL')` handles the already-dead case correctly, so there is no functional bug — just an unnecessary process linger.

**Fix**: Call `.unref()` on the timer so it does not prevent Node.js from exiting.

### FINDING-02: `createOutputHandler` throttle timer not cleaned up (Low)

**File**: `src/orchestrator.js:136`
**Risk**: Low — non-critical, non-blocking

The `setTimeout` inside `createOutputHandler` (500ms throttle for writing progress JSON) has no explicit cleanup. When `executeSingleStep` completes, a pending timer may fire and write one final progress JSON update. This is harmless because:

1. The timer is only 500ms, so it resolves quickly.
2. The write is to a non-critical progress file.
3. Each orchestrator command (`--run-step`) is a separate process invocation, so the timer dies with the process.

However, unlike `dashboard.js` which explicitly clears its `outputWriteTimer` in `stopDashboard()`, the orchestrator version has no equivalent cleanup.

**Fix**: No code fix needed — the timer is short-lived and the process exits after each `--run-step` invocation. Documented for awareness only.

## Summary Table

| ID | Severity | File | Issue | Action |
|----|----------|------|-------|--------|
| FINDING-01 | Low | `claude.js:14` | `forceKillChild` timer lacks `.unref()` | Fix: add `.unref()` |
| FINDING-02 | Low | `orchestrator.js:136` | Output throttle timer not explicitly cleaned | No fix needed — process exits |

## Conclusion

NightyTidy's timer and process lifecycle management is well-implemented. All `setInterval` timers are properly cleared. All child processes have cleanup paths (tracked Maps, SIGTERM, `forceKillChild`). The lock file provides robust concurrency protection with atomic creation, staleness detection, and both automatic and manual cleanup paths.

The only actionable fix is adding `.unref()` to the SIGKILL escalation timer in `claude.js`, which prevents a potential 5-second shutdown delay.
