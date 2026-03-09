# Audit #25 -- State Management Report

**Date**: 2026-03-09
**Scope**: All module-level mutable state, file-based state, GUI state machine, dashboard client state
**Files analyzed**: 18 source files, 4 GUI files, 2 standalone scripts

---

## Phase 1: State Source Inventory

### 1.1 Module-Level Mutable Variables

| File | Variable | Type | Initialized | Reset By |
|------|----------|------|-------------|----------|
| `src/logger.js` | `logFilePath` | `string\|null` | `initLogger()` | Never (process-lifetime) |
| `src/logger.js` | `minLevel` | `number` | `initLogger()` | Never |
| `src/logger.js` | `logQuiet` | `boolean` | `initLogger()` | Never |
| `src/git.js` | `git` | `SimpleGit\|null` | `initGit()` | Never |
| `src/git.js` | `projectRoot` | `string\|null` | `initGit()` | Never |
| `src/report.js` | `cachedVersion` | `string\|undefined` | `getVersion()` (lazy) | Never |
| `src/dashboard.js` | `server` | `Server\|null` | `startDashboard()` | `stopDashboard()` |
| `src/dashboard.js` | `sseClients` | `Set` | Module load | `stopDashboard()` |
| `src/dashboard.js` | `currentState` | `object\|null` | `startDashboard()` | `stopDashboard()` |
| `src/dashboard.js` | `urlFilePath` | `string\|null` | `startDashboard()` | `stopDashboard()` |
| `src/dashboard.js` | `progressFilePath` | `string\|null` | `startDashboard()` | `stopDashboard()` |
| `src/dashboard.js` | `shutdownTimer` | `Timer\|null` | `scheduleShutdown()` | `stopDashboard()` |
| `src/dashboard.js` | `tuiProcess` | `Process\|null` | `spawnTuiWindow()` | Never (FINDING-01) |
| `src/dashboard.js` | `csrfToken` | `string\|null` | `startDashboard()` | `stopDashboard()` |
| `src/dashboard.js` | `outputBuffer` | `string` | Module load (empty) | `clearOutputBuffer()` |
| `src/dashboard.js` | `outputWritePending` | `boolean` | Module load (false) | `stopDashboard()` |
| `src/dashboard.js` | `outputWriteTimer` | `Timer\|null` | `broadcastOutput()` | `stopDashboard()` |
| `src/dashboard-standalone.js` | `currentState` | `object\|null` | `pollProgress()` | Never |
| `src/dashboard-standalone.js` | `lastRawJson` | `string` | Module load (empty) | Never |
| `src/dashboard-standalone.js` | `lastOutputLength` | `number` | Module load (0) | Step change |
| `src/dashboard-standalone.js` | `lastStepName` | `string` | Module load (empty) | Step change |
| `src/dashboard-standalone.js` | `sseClients` | `Set` | Module load | SIGTERM handler |
| `src/dashboard-standalone.js` | `pollIntervalId` | `Interval\|null` | `server.listen()` | SIGTERM handler |
| `src/dashboard-tui.js` | `progressFilePath` | `string\|null` | `startPolling()` | Never |
| `src/dashboard-tui.js` | `lastJson` | `string` | Module load (empty) | Never |
| `gui/server.js` | `activeProcesses` | `Map` | Module load | `killAllProcesses()` |
| `gui/server.js` | `serverInstance` | `Server\|null` | Module load | `cleanup()` |

**Total**: 27 mutable module-level variables across 7 files.

### 1.2 GUI State Machine (app.js)

Single `state` object with 14 properties:

| Property | Type | Set By | Reset By |
|----------|------|--------|----------|
| `screen` | `string` | `showScreen()` | `resetApp()` |
| `projectDir` | `string\|null` | `selectFolder()` | Never (FINDING-02) |
| `steps` | `array` | `loadSteps()` | `resetApp()` |
| `selectedSteps` | `array` | `startRun()` | `resetApp()` |
| `timeout` | `number` | `startRun()` | `resetApp()` |
| `runInfo` | `object\|null` | `startRun()` | `resetApp()` |
| `completedSteps` | `array` | `runNextStep()` | `resetApp()` |
| `failedSteps` | `array` | `runNextStep()` | `resetApp()` |
| `stepResults` | `array` | `runNextStep()` | `resetApp()` |
| `currentProcessId` | `string\|null` | `runCli()` | `runCli()` / `resetApp()` |
| `pollTimer` | `Interval\|null` | `startProgressPolling()` | `stopProgressPolling()` / `resetApp()` |
| `elapsedTimer` | `Interval\|null` | `startElapsedTimer()` | `stopElapsedTimer()` / `resetApp()` |
| `runStartTime` | `number\|null` | `startRun()` | `resetApp()` |
| `finishResult` | `object\|null` | `finishRun()` | `resetApp()` |
| `stopping` | `boolean` | `stopRun()` | `resetApp()` |

Plus one separate module-level variable: `processCounter` (number, never reset).

### 1.3 Dashboard HTML Client State (dashboard-html.js inline JS)

| Variable | Type | Reset By |
|----------|------|----------|
| `state` | `object\|null` | SSE `state` event |
| `elapsedInterval` | `Interval\|null` | `render()` on finished state |
| `outputText` | `string` | Step change in `state` event |
| `lastStepName` | `string` | Step change in `state` event |

### 1.4 File-Based State

| File | Written By | Read By | Lifecycle |
|------|-----------|---------|-----------|
| `nightytidy-run.log` | `logger.js` | User/debug | Created per run, never deleted |
| `nightytidy-progress.json` | `dashboard.js`, `orchestrator.js` | `dashboard-tui.js`, `dashboard-standalone.js`, `gui/app.js` | Created on run start, deleted on stop/finish |
| `nightytidy-dashboard.url` | `dashboard.js`, `dashboard-standalone.js` | External (user) | Created on dashboard start, deleted on stop |
| `nightytidy-run-state.json` | `orchestrator.js` | `orchestrator.js` | Created by `--init-run`, deleted by `--finish-run` |
| `nightytidy.lock` | `lock.js` | `lock.js` | Created on acquire, deleted on release/exit |
| `NIGHTYTIDY-REPORT.md` | `report.js` | User | Created per run, committed to git |
| `CLAUDE.md` (appended) | `report.js` | User/Claude | Updated per run, committed to git |

---

## Phase 2: Duplicated State

### FINDING-03: Step results duplicated across three places (orchestrator mode)

In orchestrator mode, step completion data exists in three forms simultaneously:

1. **State file** (`nightytidy-run-state.json`): `completedSteps[]` and `failedSteps[]` arrays with `{ number, name, status, duration, attempts }`
2. **Progress JSON** (`nightytidy-progress.json`): `steps[]` array with `{ number, name, status, duration }`, plus `completedCount` and `failedCount`
3. **CLI JSON output** (stdout): Each `--run-step` returns `{ step, name, status, duration, attempts, remainingSteps }`

**Assessment**: This is intentional and correctly managed. The state file is the source of truth. Progress JSON is a derived view for dashboard display. CLI output is the ephemeral API response. `buildProgressState()` derives from state file. No desync risk because writes are sequential and single-threaded.

**Severity**: None -- correct architecture.

### FINDING-04: GUI duplicates orchestrator step tracking

The GUI `app.js` maintains its own `completedSteps[]`, `failedSteps[]`, and `stepResults[]` arrays, constructed from `--run-step` CLI output. The orchestrator's state file also tracks identical data.

**Assessment**: This is necessary and correct. The GUI drives the orchestrator via sequential CLI calls, so it needs local state to know which step to run next (via `getNextStep()`). The orchestrator state file persists across process invocations. No data flows backward from state file to GUI during a run -- they are synchronized by design.

**Severity**: None -- correct architecture.

### FINDING-05: Dashboard `currentState` duplicates progress JSON

In interactive mode, `dashboard.js` holds `currentState` in memory and also writes it to `nightytidy-progress.json`. Both are updated by `updateDashboard()` in the same call.

**Assessment**: The in-memory copy serves SSE push; the file serves the TUI poller. Same update call, no desync possible.

**Severity**: None -- correct architecture.

---

## Phase 3: Stale State

### FINDING-01: `tuiProcess` never cleaned up (LOW)

In `dashboard.js`, `tuiProcess` is set when spawning the TUI window but is never set to `null` in `stopDashboard()`. The TUI process itself is unref'd and self-terminating (reads progress JSON and exits when status is terminal), so this does not leak resources. However, the stale reference means a second `startDashboard()` call in the same process would not know the previous TUI is still referenced.

**Impact**: None in practice -- `startDashboard()` is called exactly once per CLI run.

**Fix**: Set `tuiProcess = null` in `stopDashboard()` for correctness.

### FINDING-02: `projectDir` not reset in GUI `resetApp()` (LOW)

When the user clicks "New Run" in the GUI summary screen, `resetApp()` resets all state properties except `projectDir`. This is intentional UX -- the user wants to run again on the same project. The folder remains displayed.

**Assessment**: Correct behavior. Not a bug.

### FINDING-06: GUI polling continues briefly after process ends (LOW)

In `app.js`, `pollProgress()` runs on a 500ms interval. When a step completes, `runNextStep()` immediately starts the next step. The poll may read stale progress JSON from the just-completed step for one tick before the new step updates it. The `renderProgressFromFile()` function only reads `currentStepOutput` for display, which is harmless.

**Assessment**: Cosmetic only. The step list is updated by the CLI response, not by polling. Output panel may briefly show old output, which is immediately replaced.

### FINDING-07: Dashboard SSE `elapsedInterval` accumulates on reconnect (MEDIUM)

In `dashboard-html.js` inline client JS, the `elapsedInterval` timer is started on the first `state` event that has `startTime`:

```js
if (s.startTime && !elapsedInterval) {
  elapsedInterval = setInterval(() => updateElapsed(s.startTime), 1000);
}
```

The guard `!elapsedInterval` prevents accumulation on repeated state events. However, if the SSE connection drops and reconnects, `evtSource.onopen` fires but `elapsedInterval` is NOT cleared. This is actually correct because the interval variable persists across reconnects (it is module-level, not connection-scoped). The EventSource auto-reconnects and the interval continues ticking.

**Assessment**: Correct. The `evtSource.onerror` handler only shows a reconnecting banner. The timer keeps running through reconnects.

### FINDING-08: Orchestrator state file survives process crash (BY DESIGN)

If the `--run-step` process crashes, the state file is left with the step's entry missing from both `completedSteps` and `failedSteps`. The next `--run-step` for the same step number will work because the validation only checks for existing entries. Running `--finish-run` will produce a report missing that step's result.

**Assessment**: Acceptable. The state file uses atomic write (write temp + rename) to prevent corruption. A crashed step can be retried. The outer orchestrator (Claude Code) manages step sequencing.

---

## Phase 4: Missing State Handling

### FINDING-09: GUI has no connection loss handling (MEDIUM)

In `app.js`, all API calls use bare `await api(...)` with no timeout or retry logic. If the GUI server (`gui/server.js`) becomes unresponsive:

- `selectFolder()` will hang indefinitely
- `runCli()` will hang indefinitely (waiting for the spawned CLI process)
- `pollProgress()` will silently catch errors and continue

The `api()` helper has no `AbortController` timeout. Long-running CLI commands (steps can take 30+ minutes) are expected, but a dead server connection has no recovery path.

**Assessment**: Low risk because GUI server and Chrome run on the same machine. If the server dies, Chrome stays open showing the last state. Adding a connection health check would add complexity without clear benefit for this local-only tool.

### FINDING-10: Dashboard SSE has reconnecting banner but no data recovery (LOW)

When SSE disconnects and reconnects, the client shows "Reconnecting..." and hides it on `onopen`. On reconnect, the server sends `currentState` immediately via `handleSSE()`. This is correct -- reconnection sends the latest state, not a replay of missed events.

However, `outputText` in the client is cleared on step change but NOT on reconnect. If the connection drops mid-step and reconnects, the output panel will only show output received after reconnect. The server sends the full `outputBuffer` on SSE connect (line 53-55 in dashboard.js), so this is actually handled correctly.

**Assessment**: Handled correctly.

### FINDING-11: Loading/error/empty states in GUI (ADEQUATE)

| State | Handled? | Details |
|-------|----------|---------|
| No folder selected | Yes | "Select Project Folder" button, start disabled |
| Loading steps | Yes | Spinner + "Loading steps..." shown |
| Step load error | Yes | Error message shown on setup screen |
| No steps returned | Yes | Error: "No steps returned from NightyTidy CLI" |
| Init-run failure | Yes | Error on steps screen |
| Step run failure | Yes | Step marked failed, continues to next |
| Finish-run failure | Yes | Error on finishing screen, proceeds to summary |
| Server connection lost | No | Calls hang; no timeout/retry (FINDING-09) |

### FINDING-12: `processCounter` never resets (NEGLIGIBLE)

In `app.js`, `processCounter` increments monotonically. Since the GUI runs in a browser session, this counter resets when the page reloads. Within a single page session, it only serves as a unique process ID. No risk of integer overflow in practical use.

---

## Phase 5: State Lifecycle

### FINDING-13: Dashboard output buffer not cleared between steps in standalone mode (LOW)

In `dashboard-standalone.js`, `lastOutputLength` and `lastStepName` track output for incremental SSE streaming. When the step changes, `lastOutputLength` resets to 0 and `lastStepName` updates. This is correct -- the orchestrator's `runStep()` calls `createOutputHandler()` which starts a fresh buffer per step, and `writeProgress()` replaces the progress JSON content.

The `lastRawJson` cache in `dashboard-standalone.js` correctly detects content changes because the progress JSON is fully rewritten each time.

**Assessment**: Correct lifecycle management.

### FINDING-14: Lock file cleanup on unexpected exit (ADEQUATE)

Interactive mode: `process.on('exit', ...)` auto-removes lock. This fires on clean exit, `process.exit()`, and SIGINT/SIGTERM.

Orchestrator mode: Lock is persistent (no exit handler). `--finish-run` calls `releaseLock()` explicitly. If the orchestrator crashes between `--init-run` and `--finish-run`, the lock file persists. On next `--init-run`, `acquireLock()` detects the stale lock (dead PID or 24h age) and removes it.

**Assessment**: Robust design. The 24h staleness check handles PID recycling on Windows.

### FINDING-15: `resetApp()` properly clears timers (ADEQUATE)

The GUI's `resetApp()` sets `pollTimer` and `elapsedTimer` to `null` but does NOT call `clearInterval()` on them first.

**Impact**: This is a bug. If `resetApp()` is called while timers are running (unlikely but possible if user triggers "New Run" during the finishing phase), the intervals will continue firing with stale state references.

**Fix**: Call `stopProgressPolling()` and `stopElapsedTimer()` at the top of `resetApp()`.

---

## Findings Summary

| ID | Finding | Severity | Fix |
|----|---------|----------|-----|
| FINDING-01 | `tuiProcess` never nulled in `stopDashboard()` | LOW | Set to null |
| FINDING-02 | `projectDir` not reset in `resetApp()` | NONE | Intentional UX |
| FINDING-03 | Step results exist in 3 places (orchestrator) | NONE | Correct architecture |
| FINDING-04 | GUI duplicates orchestrator step tracking | NONE | Necessary design |
| FINDING-05 | `currentState` duplicates progress JSON | NONE | Correct architecture |
| FINDING-06 | GUI polling reads stale data for one tick | LOW | Cosmetic, no fix needed |
| FINDING-07 | Dashboard elapsed timer across SSE reconnect | NONE | Already handled |
| FINDING-08 | State file survives process crash | NONE | By design |
| FINDING-09 | GUI has no API timeout/retry | MEDIUM | Acceptable for local tool |
| FINDING-10 | SSE reconnect data recovery | NONE | Already handled |
| FINDING-11 | Loading/error/empty states | ADEQUATE | All critical paths covered |
| FINDING-12 | `processCounter` never resets | NEGLIGIBLE | Resets on page reload |
| FINDING-13 | Standalone output buffer lifecycle | NONE | Correctly managed |
| FINDING-14 | Lock file cleanup on crash | ADEQUATE | Robust with staleness check |
| FINDING-15 | `resetApp()` does not clear running timers | LOW | Call stop functions first |

### Fixes to implement:

1. **FINDING-01**: Set `tuiProcess = null` in `stopDashboard()` in `src/dashboard.js`
2. **FINDING-15**: Call `stopProgressPolling()` and `stopElapsedTimer()` at top of `resetApp()` in `gui/resources/app.js`

---

## Architecture Assessment

**State management in this codebase is well-designed for its constraints:**

1. **Singleton pattern for init-once state** (logger, git) is appropriate for a single-run CLI tool. These modules are initialized exactly once per process lifetime. Tests handle this via module mocking.

2. **File-based state for cross-process coordination** (progress JSON, state file, lock file) is the correct approach for orchestrator mode where each command is a separate process invocation. Atomic writes (write-tmp + rename) prevent corruption.

3. **Push-based SSE for interactive dashboard** avoids polling overhead. The pull-based approach for standalone dashboard (polling progress JSON) is necessary because the dashboard runs in a detached process without IPC.

4. **GUI state machine** is simple and appropriate for a 5-screen wizard flow. The single `state` object is easy to reason about. No state library is needed.

5. **Dashboard state cleanup** in `stopDashboard()` is thorough -- clears timers, closes connections, deletes files, resets variables. The throttle timer cleanup (audit #21) prevents stale writes.

**No systemic state management issues found.** The two fixes identified (FINDING-01 and FINDING-15) are minor correctness improvements with no functional impact in current usage patterns.
