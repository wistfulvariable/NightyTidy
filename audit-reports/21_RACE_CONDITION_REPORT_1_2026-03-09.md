# Audit #21 -- Concurrency & Race Condition Audit

**Date**: 2026-03-09
**Scope**: All source files in `src/`, `gui/`, and `bin/`
**Context**: NightyTidy is a single-user CLI tool, not a multi-user server. Race conditions here concern signal handling, file I/O interleaving, HTTP server concurrent requests, GUI double-actions, and singleton state reinitialization.

---

## Executive Summary

NightyTidy has a generally sound concurrency posture for a single-user CLI tool. The lock file mechanism uses proper atomic semantics (`O_EXCL`), subprocess management has settled-flag patterns to prevent double-resolve, and the dashboard is correctly designed as fire-and-forget. However, the audit identified **7 findings** across 5 categories:

- **2 informational** (documented, accepted risks)
- **3 low-severity** (edge cases unlikely in normal use)
- **2 medium-severity** (fixable with low risk)

No critical race conditions were found. Two medium-severity issues were fixed in this audit.

---

## Phase 1: Shared Mutable State

### FINDING-01: Logger double-init clears log file (Informational)

**File**: `src/logger.js:12-25`
**Severity**: Informational (documented in pitfalls.md)

`initLogger()` calls `writeFileSync(logFilePath, '', 'utf8')` which truncates the log file. If called twice (e.g., in orchestrator mode where `initRun`, `runStep`, and `finishRun` each call `initLogger()`), all log entries from the previous invocation of the same process are lost.

**Interleaved timeline**:
```
T1: initLogger(dir)       -> logFilePath set, file created
T1: info("starting")      -> writes to file
T2: initLogger(dir)       -> logFilePath set, file TRUNCATED (empty string written)
T2: info("step 2")        -> writes to fresh file -- T1 logs gone
```

**Impact**: In orchestrator mode, each `--run-step` is a separate process invocation, so each gets its own logger init. The log file is truncated each time, meaning only the last invocation's logs survive. This is **accepted behavior** since orchestrator mode runs in quiet mode and the JSON output is the primary interface.

**Recommendation**: No fix needed. Already documented in `pitfalls.md` line 102.

---

### FINDING-02: Git singleton re-initialization (Informational)

**File**: `src/git.js:23-27`
**Severity**: Informational (documented in pitfalls.md)

`initGit()` replaces the module-level `git` and `projectRoot` variables. If called with a different directory, all callers see the new directory. In orchestrator mode, each command calls `initGit(projectDir)` with the same directory, so this is safe.

**Interleaved timeline (hypothetical multi-caller)**:
```
T1: initGit("/project-a")     -> git = simpleGit("/project-a")
T1: getCurrentBranch()         -> operates on /project-a
T2: initGit("/project-b")     -> git = simpleGit("/project-b")  -- REPLACES
T1: fallbackCommit(...)        -> operates on /project-b !!
```

**Impact**: Cannot happen in production (single-user, same project). Tests must be aware and re-init per test. Already documented in `pitfalls.md` line 103-104.

**Recommendation**: No fix needed.

---

### FINDING-03: Progress JSON torn reads (Low)

**Files**: `src/dashboard.js:192-213`, `src/orchestrator.js:111-115`, `src/dashboard-standalone.js:39-71`, `src/dashboard-tui.js:22-32`
**Severity**: Low

`writeFileSync` is not atomic on all platforms. If a reader (`dashboard-standalone.js` polling, `dashboard-tui.js` polling, or GUI `read-file` API) reads the progress JSON file at the exact moment the writer is mid-write, the reader could get truncated JSON.

**Interleaved timeline**:
```
Writer (executor):    writeFileSync(path, JSON.stringify(state))
                      -- kernel writes first 500 bytes --
Reader (dashboard):   readFileSync(path)  -> gets 500 bytes of 1200
                      JSON.parse(...)     -> SyntaxError
                      -- catch block swallows error, skips this tick --
                      -- next poll in 500ms reads complete data --
```

**Impact**: Extremely low. All readers wrap `JSON.parse` in try/catch and gracefully skip torn reads. The 500ms poll interval means the next read succeeds. The only consequence is a single skipped dashboard update -- invisible to the user.

**Recommendation**: No fix needed. The existing error handling is correct. A write-to-temp-then-rename pattern would eliminate this entirely but adds complexity for near-zero benefit.

---

## Phase 2: Signal Handling Races

### FINDING-04: SIGINT during git operations (Low)

**Files**: `src/cli.js:341-349`, `src/executor.js:86-97`
**Severity**: Low

When the user presses Ctrl+C, the SIGINT handler sets `interrupted = true` and calls `abortController.abort()`. The abort signal propagates to the running Claude subprocess (which is killed), but execution continues in `executeSingleStep` at lines 88-97 where `hasNewCommit()` and `fallbackCommit()` are called. These git operations run to completion because the abort signal is not checked between them.

**Interleaved timeline**:
```
User:     Ctrl+C
SIGINT:   interrupted = true, abortController.abort()
claude:   child process killed (via abort handler in waitForChild)
executor: result = await runPrompt(...)  -> returns { success: false, error: 'Aborted' }
executor: result.success is false -> return makeStepResult('failed', ...)
          -- skips doc update and commit verification (correct!) --
loop:     signal.aborted -> break (exits loop)
cli:      handleAbortedRun() -> generateReport() -> git add/commit
          -- git operations run normally here --
```

**Impact**: The signal handling is actually correct. The `if (!result.success)` check at line 64 causes early return before any git operations. The abort is checked at the top of the loop (line 115) causing a clean exit. The `handleAbortedRun` function then does git operations deliberately (committing a partial report). No data corruption risk.

**SIGINT during handleAbortedRun itself**: If the user presses Ctrl+C a second time during report generation or git commit, the `if (interrupted)` check at line 342 triggers a force `process.exit(1)`. This could leave a partial `NIGHTYTIDY-REPORT.md` file, but the git working tree is consistent (either the commit happened or it did not). The safety tag ensures recoverability.

**Recommendation**: No fix needed. The double-SIGINT pattern is correctly implemented.

---

### FINDING-05: Lock file not cleaned on SIGKILL (Low)

**File**: `src/lock.js:112-117`
**Severity**: Low

The lock file cleanup uses `process.on('exit', ...)` which fires on normal exit and SIGINT-triggered exit, but NOT on `kill -9` (SIGKILL) or a system crash. This leaves an orphaned lock file.

**Impact**: On the next run, `acquireLock()` reads the lock file, finds the PID dead (`isProcessAlive()` returns false), treats it as stale, removes it, and reacquires. The user sees a "Removed stale lock file from a previous run" warning but the run proceeds normally. The 24-hour age check (`MAX_LOCK_AGE_MS`) also catches PID-recycling edge cases on Windows.

**Recommendation**: No fix needed. The staleness detection handles this correctly.

---

## Phase 3: File I/O Races

### FINDING-06: State file non-atomic writes in orchestrator mode (Medium -- Fixed)

**Files**: `src/orchestrator.js:40-42`
**Severity**: Medium

`writeState()` uses `writeFileSync()` which is not atomic. In orchestrator mode, state transitions happen at critical moments (after step completion, during finishRun). While each orchestrator command (`--init-run`, `--run-step`, `--finish-run`) is a separate process, a crash during `writeState()` could leave a truncated `nightytidy-run-state.json` file.

**Interleaved timeline (crash scenario)**:
```
runStep:  state.completedSteps.push(entry)    -- state updated in memory
runStep:  writeState(projectDir, state)       -- writeFileSync begins
          -- process crashes mid-write (kill -9, power loss) --
          -- state file is truncated JSON --
next:     readState(projectDir)               -- JSON.parse fails
          -- returns null -> "No active orchestrator run" --
          -- user must --init-run again, losing progress --
```

**Impact**: User loses progress tracking (which steps completed) but code changes are preserved on the git branch. The safety tag allows recovery. This is already documented in `pitfalls.md` line 86-87.

**Fix Applied**: Changed `writeState()` to use write-to-temp-then-rename pattern. This is a safe, low-risk change that provides atomic file replacement on both Windows (with `fs.renameSync`) and Unix. The temp file is in the same directory to ensure same-filesystem rename.

---

### FINDING-07: broadcastOutput throttle timer reference after stopDashboard (Medium -- Fixed)

**Files**: `src/dashboard.js:255-274`, `src/dashboard.js:215-253`
**Severity**: Medium

`broadcastOutput()` sets a 500ms `setTimeout` for throttled disk writes (line 265). If `stopDashboard()` is called while this timer is pending, the timer fires after cleanup, attempting to write to a deleted progress file and referencing nulled state.

**Interleaved timeline**:
```
T=0ms:    broadcastOutput("chunk")           -> outputWritePending = true
          setTimeout(500ms, writeCallback)   -> timer scheduled
T=100ms:  stopDashboard()                    -> progressFilePath = null
                                             -> currentState = null
                                             -> outputBuffer = '' (via clearOutputBuffer)
T=500ms:  writeCallback fires                -> outputWritePending = false
          if (progressFilePath && currentState)  -> both null, skip
          -- SAFE due to null checks, but unnecessary timer still fires --
```

**Impact**: The existing null checks at line 267 prevent any actual error. However, the timer reference itself is not cleaned up, and in edge cases where `stopDashboard()` nulls `currentState` but the callback captures a closure reference to a mutated object, there could be a stale write.

**Fix Applied**: Added cleanup of the pending throttle timer in `stopDashboard()`. Track the timer ID in a module-level variable and clear it during shutdown.

---

## Phase 4: HTTP Server Races

### FINDING-08: Dashboard SSE client cleanup on server shutdown (No issue)

**Files**: `src/dashboard.js:241-250`, `src/dashboard-standalone.js:152-158`
**Severity**: None (correctly handled)

Both dashboard servers explicitly close SSE clients before calling `server.close()`. The standalone server also has a 10-second force-exit timeout (added in audit #20). This prevents the known Node.js issue where `server.close()` waits indefinitely for keep-alive connections.

**Analysis**: Correct. No fix needed.

---

### FINDING-09: GUI server concurrent request handling (No issue)

**File**: `gui/server.js:128-169`
**Severity**: None (correctly handled)

The GUI server handles requests sequentially per-connection (HTTP/1.1). The `activeProcesses` Map tracks spawned processes by ID, and cleanup on close/error removes entries atomically. The `readBody` helper has a size limit (`MAX_BODY_BYTES = 1MB`) preventing memory exhaustion.

**Analysis**: Correct. No fix needed.

---

### FINDING-10: CSRF token timing in dashboard (No issue)

**Files**: `src/dashboard.js:76-92`, `src/dashboard-standalone.js:100-115`
**Severity**: None (correctly handled)

The CSRF token is generated once at server start and embedded in the served HTML. The `/stop` endpoint validates it synchronously in the request handler. There is no time-of-check-to-time-of-use issue because the token is a simple string comparison within a single event loop tick.

**Analysis**: Correct. No fix needed.

---

## Phase 5: Frontend Concurrency (GUI)

### FINDING-11: Double-click on Run button (No issue)

**File**: `gui/resources/app.js:181-219`
**Severity**: None (correctly handled)

The `startRun()` function disables the button at line 197 (`btn-start-run.disabled = true`) before making the async CLI call, and re-enables it at line 199 only if the call fails. If the call succeeds, the screen transitions to RUNNING, making the button inaccessible. This prevents double-click races.

**Analysis**: Correct. No fix needed.

---

### FINDING-12: Polling while process is being stopped (No issue)

**File**: `gui/resources/app.js:298-345, 407-428`
**Severity**: None (correctly handled)

The `stopRun()` function sets `state.stopping = true` (line 409) before killing the process. The `runNextStep()` function checks `state.stopping` at lines 299 and 314, preventing new steps from being launched after a stop request. Progress polling is stopped explicitly in `finishRun()` (line 433).

**Analysis**: Correct. No fix needed.

---

### FINDING-13: Multiple browser tabs to same GUI server (Low, accepted)

**File**: `gui/server.js`
**Severity**: Low (accepted)

Opening multiple browser tabs to the same GUI server URL would allow multiple users to interact with the same state. Both tabs could initiate runs, leading to confusing behavior. However, this is a local-only server on `127.0.0.1` with no authentication, designed for single-user desktop use.

**Impact**: User confusion only. No data corruption risk because the CLI orchestrator commands have their own lock file protection -- a second `--init-run` would fail with "A run is already in progress."

**Recommendation**: No fix needed. The lock file mechanism provides the real protection.

---

## Lock File Analysis (Deep Dive)

The lock file mechanism in `src/lock.js` deserves special attention as it is the primary concurrency control.

### Atomic creation: CORRECT
`writeLockFile()` uses `openSync(path, 'wx')` -- the `O_CREAT | O_EXCL` combination is a single kernel operation. Two processes calling `acquireLock()` simultaneously will have exactly one succeed and one get `EEXIST`. No TOCTOU race.

### Stale lock detection: CORRECT with minor TOCTOU
```
Line 91-92:  lockData = JSON.parse(readFileSync(lockPath, 'utf8'))
Line 97:     if (isLockStale(lockData)) { removeLockAndReacquire(...) }
```
Between reading the lock file and removing it, another process could also detect staleness and try to remove+reacquire. The `removeLockAndReacquire()` function handles this with a second `'wx'` atomic create (line 62), catching `EEXIST` if another process won the race. This is correct.

### Process liveness check: platform-dependent
`process.kill(pid, 0)` is unreliable on Windows for detecting dead processes (Windows reuses PIDs aggressively). The 24-hour `MAX_LOCK_AGE_MS` provides a fallback. Both mechanisms together provide adequate coverage.

### Exit cleanup: correct
`process.on('exit', ...)` fires synchronously before exit, so `unlinkSync` completes. In persistent mode (orchestrator), cleanup is the caller's responsibility via `releaseLock()`.

---

## Summary Table

| ID | Severity | Category | Description | Action |
|----|----------|----------|-------------|--------|
| FINDING-01 | Info | Shared State | Logger double-init clears log | None (documented) |
| FINDING-02 | Info | Shared State | Git singleton re-init | None (documented) |
| FINDING-03 | Low | File I/O | Progress JSON torn reads | None (handled by try/catch) |
| FINDING-04 | Low | Signal | SIGINT during git ops | None (correctly sequenced) |
| FINDING-05 | Low | Signal | Lock file survives SIGKILL | None (staleness detection handles) |
| FINDING-06 | Medium | File I/O | State file non-atomic write | **Fixed**: write-to-temp-then-rename |
| FINDING-07 | Medium | File I/O | broadcastOutput timer after stop | **Fixed**: clear timer in stopDashboard |
| FINDING-08 | None | HTTP | SSE cleanup on shutdown | None (correct) |
| FINDING-09 | None | HTTP | GUI concurrent requests | None (correct) |
| FINDING-10 | None | HTTP | CSRF timing | None (correct) |
| FINDING-11 | None | Frontend | Double-click prevention | None (correct) |
| FINDING-12 | None | Frontend | Polling during stop | None (correct) |
| FINDING-13 | Low | Frontend | Multiple tabs | None (lock file protects) |

---

## Fixes Applied

### Fix 1: Atomic state file writes (FINDING-06)

Changed `writeState()` in `src/orchestrator.js` to use write-to-temp-then-rename pattern:
```js
// Before:
writeFileSync(statePath(projectDir), JSON.stringify(state, null, 2), 'utf8');

// After:
const tmpPath = statePath(projectDir) + '.tmp';
writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf8');
renameSync(tmpPath, statePath(projectDir));
```

### Fix 2: Clear broadcastOutput throttle timer on shutdown (FINDING-07)

Track the `setTimeout` ID in `src/dashboard.js` and clear it in `stopDashboard()`:
```js
// Added module-level variable:
let outputWriteTimer = null;

// In broadcastOutput():
outputWriteTimer = setTimeout(() => { ... }, OUTPUT_WRITE_INTERVAL);

// In stopDashboard():
if (outputWriteTimer) { clearTimeout(outputWriteTimer); outputWriteTimer = null; }
```

---

*Generated by NightyTidy Audit #21*
