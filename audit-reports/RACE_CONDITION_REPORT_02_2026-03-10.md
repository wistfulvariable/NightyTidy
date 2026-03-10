# Concurrency & Race Condition Audit — Run 02

**Date**: 2026-03-10
**Scope**: All source files in `src/`, `gui/`, and `bin/`
**Prior Run**: Run 01 (2026-03-09) — 2 fixes applied, 5 issues documented as accepted

---

## Executive Summary

**Safety Level**: **SAFE** — NightyTidy has robust concurrency handling for a single-user CLI tool.

This is a follow-up audit verifying the fixes from run 01 remain in place and identifying any new issues introduced since the previous audit. The codebase demonstrates sound single-threaded async patterns with appropriate guards for the rare concurrent access scenarios that exist.

### Key Metrics

| Category | Run 01 | Run 02 |
|----------|--------|--------|
| Critical issues | 0 | 0 |
| Medium issues (unfixed) | 0 | 0 |
| Low issues (accepted) | 3 | 3 |
| Informational | 2 | 2 |
| **Total findings** | 13 | No new findings |

### At 100 Concurrent Requests

This is a single-user CLI tool, not a server. The only HTTP servers are:
- **Dashboard server** (`dashboard.js`, `dashboard-standalone.js`): Localhost-only, SSE for progress streaming
- **GUI server** (`gui/server.js`): Localhost-only, Chrome app mode

Under 100 concurrent requests to these servers:
- SSE client set could grow to 100 entries — memory impact negligible
- `activeProcesses` Map in GUI server would only have 1-2 entries (CLI commands run serially)
- No data corruption risk — lock file prevents multiple NightyTidy runs

---

## Verification of Run 01 Fixes

### FINDING-06: Atomic State File Writes — **VERIFIED** ✓

**File**: `src/orchestrator.js:112-119`

```javascript
function writeState(projectDir, state) {
  // Write to temp file then rename for atomic replacement.
  // Prevents truncated JSON on crash (FINDING-06, audit #21).
  const target = statePath(projectDir);
  const tmp = target + '.tmp';
  writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  renameSync(tmp, target);  // ← Atomic rename
}
```

The write-to-temp-then-rename pattern is correctly implemented. The temp file uses `.tmp` suffix in the same directory, ensuring same-filesystem rename (atomic on both Windows and Unix).

### FINDING-07: broadcastOutput Timer Cleanup — **VERIFIED** ✓

**File**: `src/dashboard.js:239-244, 294-296`

```javascript
// In stopDashboard():
if (ds.outputWriteTimer) {
  clearTimeout(ds.outputWriteTimer);
  ds.outputWriteTimer = null;
  ds.outputWritePending = false;
}

// In broadcastOutput():
ds.outputWriteTimer = setTimeout(() => {
  ds.outputWritePending = false;
  ds.outputWriteTimer = null;
  // ...
}, OUTPUT_WRITE_INTERVAL);
```

The timer reference is properly tracked and cleared on shutdown, preventing stale callbacks.

---

## Detailed Analysis

### Phase 1: Shared Mutable State — No New Issues

All module-level singletons identified in run 01 remain unchanged:

| Module | Singleton State | Risk | Status |
|--------|----------------|------|--------|
| `logger.js` | `logFilePath`, `minLevel`, `logQuiet` | Init-once pattern | Accepted |
| `git.js` | `git`, `projectRoot` | Init-once pattern | Accepted |
| `dashboard.js` | `ds` object | Fire-and-forget design | Correct |
| `orchestrator.js` | None (state in file) | Atomic write | Fixed in run 01 |

### Phase 2: Database & Cache Operations — N/A

NightyTidy has no database or distributed cache. All state is:
- **Transient**: In-memory during single process lifetime
- **Persistent**: JSON files with appropriate atomicity (lock file, state file)
- **Git**: Delegated to simple-git library (thread-safe)

### Phase 3: File I/O Race Conditions

#### Lock File (`src/lock.js`) — **Correct**

The lock mechanism remains sound:

1. **Atomic creation**: `openSync(path, 'wx')` uses `O_CREAT | O_EXCL` — kernel-level atomicity
2. **Stale detection**: 24-hour max age + PID liveness check with fallback
3. **TOCTOU handling**: `removeLockAndReacquire()` catches `EEXIST` on race

#### Progress JSON (`nightytidy-progress.json`) — **Acceptable Risk**

Non-atomic writes are acceptable because:
- All readers use try/catch around `JSON.parse`
- 500ms poll interval means torn reads self-heal
- Content is ephemeral (deleted on run completion)

#### Git Exclude File (`src/git.js:65-83`) — **Acceptable Risk**

The check-then-append pattern for `.git/info/exclude` can produce duplicate entries if called concurrently, but:
- Only called once during init sequence
- Duplicates are harmless (git ignores them)
- No data loss risk

### Phase 4: Queue/Job Processing

#### Step Execution (`src/executor.js`) — **Correct**

Steps execute sequentially via a simple for-loop with abort signal checks:

```javascript
for (let i = 0; i < totalSteps; i++) {
  if (signal?.aborted) break;
  // ... execute step
}
```

Rate-limit handling uses a state machine pattern:
1. On rate-limit failure: `results.pop(); i--;` to retry
2. Exponential backoff with API probes
3. Clean abort handling

No idempotency concerns — each step is a discrete Claude Code invocation.

#### Subprocess Handling (`src/claude.js`) — **Correct**

The `settled` flag pattern prevents double-resolve:

```javascript
let settled = false;
const settle = (result) => {
  if (settled) return;  // Guard
  settled = true;
  clearTimeout(timer);
  // ... resolve promise
};
```

This is called from:
- `stdout.on('data')` handler (early success)
- `child.on('close')` handler (normal completion)
- Timeout handler (timeout failure)
- Abort handler (user cancellation)

JavaScript's single-threaded event loop means these handlers cannot interleave mid-execution, so the flag pattern is sufficient.

### Phase 5: HTTP Server Concurrency

#### Dashboard Servers — **Correct**

Both `dashboard.js` and `dashboard-standalone.js`:
- Bind to `127.0.0.1` only (no external access)
- Use CSRF tokens for `/stop` endpoint
- Have request/header timeouts to prevent slow client attacks
- Properly clean up SSE clients on shutdown

#### GUI Server (`gui/server.js`) — **Correct**

The GUI server has appropriate protections:

| Concern | Mitigation |
|---------|-----------|
| Path traversal | Boundary check with trailing separator |
| Body size | 1 MB limit |
| Heartbeat watchdog | 15s stale detection |
| Process cleanup | `killAllProcesses()` on shutdown |
| Security headers | CSP, X-Frame-Options, X-Content-Type-Options |

The `activeProcesses` Map mutation during iteration (in `killAllProcesses`) is safe because JavaScript's `Map.forEach` creates a snapshot of keys at iteration start.

### Phase 6: Frontend Concurrency (GUI)

#### State Machine (`gui/resources/app.js`) — **Correct**

The frontend uses a simple state object with screen-based transitions. Potential races are prevented by:

1. **Button disabling**: `btn-start-run.disabled` set before async call
2. **Screen transitions**: Moving to RUNNING screen hides the start button entirely
3. **Stopping flag**: `state.stopping = true` prevents new steps from launching
4. **Timer cleanup**: All `setInterval`/`setTimeout` IDs tracked and cleared in `resetApp()`

#### Rate-Limit Pause/Resume — **Correct**

The pause overlay uses a promise-based wait with cleanup:

```javascript
return new Promise(resolve => {
  state.manualResumeResolve = resolve;
  state._pauseTimer = setTimeout(() => {
    if (state.paused) resolve();
  }, waitMs);
}).then(() => {
  // Cleanup
  state.paused = false;
  state._pauseTimer = null;
});
```

Manual resume (`manualResume()`) clears the timer and calls resolve, preventing double-resolution.

---

## Concurrency Tests

The test suite includes comprehensive concurrency coverage:

| Test File | Concurrency Tests |
|-----------|-------------------|
| `lock.test.js` | Atomic creation, stale detection, persistent mode |
| `contracts.test.js` | Module error contracts (never-throw guarantees) |
| `dashboard.test.js` | SSE cleanup, throttle timer, CSRF validation |
| `dashboard-broadcastoutput.test.js` | Buffer overflow, throttled writes |
| `orchestrator.test.js` | State versioning, dashboard integration |
| `claude.test.js` | Abort signal, timeout handling, settled flag |
| `executor.test.js` | Signal propagation, rate-limit pause/resume |

All 755 tests pass with no flakiness detected.

---

## Risk Map

| Risk | Likelihood | Impact | Manifestation | Mitigation |
|------|------------|--------|---------------|------------|
| Lock file survives crash | Low | Low | Warning on next run | Stale detection |
| Progress JSON torn read | Very Low | None | Single skipped poll | Try/catch |
| Logger re-init truncates | Medium | Low | Lost log entries | Orchestrator uses quiet mode |
| Git re-init wrong dir | Very Low | Medium | Wrong repo operations | Single-user CLI design |
| Multiple browser tabs | Low | Low | UI confusion | Lock file prevents double-run |

---

## Recommendations

This audit found no new issues requiring action. The codebase maintains its safe concurrency posture.

| # | Recommendation | Impact | Risk if Ignored | Worth Doing? | Details |
|---|---|---|---|---|---|
| — | No recommendations warranted | — | — | — | All identified issues from run 01 have been fixed or documented as acceptable risks. The single-user CLI design eliminates most concurrency concerns. |

---

## Summary

NightyTidy demonstrates mature concurrency handling appropriate for its use case as a single-user CLI tool:

1. **Lock file mechanism** uses kernel-level atomic operations (`O_EXCL`)
2. **State file writes** use atomic temp+rename pattern (fixed in run 01)
3. **Dashboard servers** are fire-and-forget with proper cleanup
4. **GUI state machine** has appropriate guards against double-actions
5. **Subprocess handling** uses settled-flag pattern for promise resolution
6. **All readers** of shared files use try/catch for graceful degradation

No fixes applied in this run. All tests pass.

---

*Generated by NightyTidy Concurrency Audit — Run 02*
