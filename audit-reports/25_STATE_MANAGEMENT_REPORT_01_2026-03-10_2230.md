# State Management Audit Report

**Project:** NightyTidy
**Date:** 2026-03-10
**Time:** 22:30 (local)
**Auditor:** Claude Opus 4.5

---

## 1. Executive Summary

**Health Rating: SOLID**

NightyTidy employs a pragmatic state management architecture well-suited to its CLI orchestrator + desktop GUI structure. The codebase uses:
- Module-level singletons (logger, git) for process-wide configuration
- File-based JSON for cross-process persistence (orchestrator state, progress)
- Mutable state objects for real-time UI coordination (dashboard, app.js)

No critical state bugs found. The architecture is simple by design (no Redux, no server cache) which reduces complexity but requires careful manual synchronization.

| Metric | Count |
|--------|-------|
| State Containers Audited | 14 |
| Duplicated State Patterns | 3 (acceptable) |
| Stale State Risks | 2 (documented) |
| Missing UI States | 0 |
| Lifecycle Bugs | 0 |
| Edge Cases Documented | 4 |
| Fixes Applied | 0 |
| Recommendations | 4 |

---

## 2. State Source Map

### Module-Level Singleton State

| Data | Canonical Source | Lifecycle | Survives Refresh? | Should Survive? |
|------|-----------------|-----------|-------------------|-----------------|
| Log file path | `logger.js:8` `logFilePath` | Session | No | No |
| Log level | `logger.js:9` `minLevel` | Session | No | No (env var) |
| Quiet mode | `logger.js:10` `logQuiet` | Session | No | No |
| Git instance | `git.js:32` `git` | Session | No | No |
| Project root | `git.js:34` `projectRoot` | Session | No | No |

### File-Based Persistent State

| Data | Canonical Source | Lifecycle | Survives Refresh? | Should Survive? |
|------|-----------------|-----------|-------------------|-----------------|
| Orchestrator state | `nightytidy-run-state.json` | Multi-invocation | Yes | Yes |
| Progress snapshot | `nightytidy-progress.json` | Per-run (ephemeral) | Yes | Yes |
| Dashboard URL | `nightytidy-dashboard.url` | Per-run (ephemeral) | Yes | No (auto-cleanup) |
| Lock file | `nightytidy.lock` | Per-run | Yes | Yes (persistent mode) |

### GUI Server State (server.js)

| Data | Canonical Source | Lifecycle | Notes |
|------|-----------------|-----------|-------|
| Active processes | `server.js:108` `activeProcesses` | Server lifetime | Map<id, ChildProcess> |
| Last heartbeat | `server.js:115` `lastHeartbeat` | Server lifetime | For watchdog idle detection |
| GUI log path | `server.js:123` `guiLogFilePath` | Server lifetime | Set once on project select |
| GUI log buffer | `server.js:124` `guiLogBuffer` | Server lifetime | Buffered until path set |

### GUI Client State (app.js)

| Data | Canonical Source | Lifecycle | Notes |
|------|-----------------|-----------|-------|
| Screen | `app.js:100` `state.screen` | Page | Current screen enum |
| Project directory | `app.js:101` `state.projectDir` | Page | Set on folder select |
| Step definitions | `app.js:103` `state.steps` | Page | From CLI --list --json |
| Selected steps | `app.js:104` `state.selectedSteps` | Run | User checkbox selections |
| Run info | `app.js:106` `state.runInfo` | Run | From --init-run response |
| Completed steps | `app.js:107` `state.completedSteps` | Run | Step numbers array |
| Failed steps | `app.js:108` `state.failedSteps` | Run | Step numbers array |
| Step results | `app.js:109` `state.stepResults` | Run | Detailed results with output |
| Process ID | `app.js:110` `state.currentProcessId` | Step | For kill capability |
| Poll timer | `app.js:111` `state.pollTimer` | Run | setInterval ID |
| Elapsed timer | `app.js:112` `state.elapsedTimer` | Run | setInterval ID |
| Pause state | `app.js:122-128` | Pause duration | Rate limit handling |
| Last rendered output | `app.js:80` | Step | DOM change tracking |
| Last output change time | `app.js:86` | Step | For "working" indicator |

### Dashboard State (dashboard.js)

| Data | Canonical Source | Lifecycle | Notes |
|------|-----------------|-----------|-------|
| HTTP server | `dashboard.js:18` `ds.server` | Run | null → Server → null |
| SSE clients | `dashboard.js:19` `ds.sseClients` | Run | Set of response streams |
| Current state | `dashboard.js:20` `ds.currentState` | Run | Progress state object |
| Output buffer | `dashboard.js:26` `ds.outputBuffer` | Step | 100KB rolling buffer |
| CSRF token | `dashboard.js:25` `ds.csrfToken` | Run | For /stop endpoint |

---

## 3. Duplicated State

### DUPLICATION-01: Step Status Tracking (Acceptable)

**Files:** `app.js` (lines 107-109)

```javascript
completedSteps: [],     // step numbers only
failedSteps: [],        // step numbers only
stepResults: [],        // detailed objects with status, output, cost
```

**Analysis:** `completedSteps` and `failedSteps` contain step numbers; `stepResults` contains detailed result objects including status. The arrays serve different purposes:
- `completedSteps/failedSteps`: Fast O(1) lookup for progress calculation
- `stepResults`: Full data for output viewing and summary rendering

**Divergence Risk:** Low. Status is set atomically in `runNextStep()` (lines 723-746). Both arrays are updated in the same code path.

**Verdict:** Acceptable design trade-off for performance. No fix needed.

---

### DUPLICATION-02: Orchestrator vs Progress State (Acceptable)

**Files:** `orchestrator.js`, `nightytidy-progress.json`

The orchestrator state file (`nightytidy-run-state.json`) contains `completedSteps` and `failedSteps` arrays. The progress file (`nightytidy-progress.json`) contains derived `completedCount` and `failedCount` integers plus a `steps` array with status.

**Analysis:** Progress file is rebuilt from orchestrator state via `buildProgressState()` (line 237). The progress file is for dashboard consumption only.

**Divergence Risk:** None. Progress is always derived from state, never the reverse.

**Verdict:** Correct architecture. No fix needed.

---

### DUPLICATION-03: Output Buffer (Acceptable)

**Files:** `dashboard.js:26`, `dashboard.js:298`, `nightytidy-progress.json`

Output is stored in:
1. `ds.outputBuffer` (memory) — 100KB rolling buffer
2. `ds.currentState.currentStepOutput` (memory) — written by throttled timer
3. `nightytidy-progress.json` (disk) — for dashboard-standalone.js polling

**Divergence Risk:** Low. The 500ms throttle means disk can be slightly behind memory, but this is acceptable for display purposes.

**Verdict:** Acceptable. The slight lag is intentional to reduce disk I/O.

---

## 4. Stale State Bugs

### STALE-01: Progress File Lag (Non-Issue)

**Scenario:** Dashboard reads progress JSON while a step is running. Output buffer in memory may be up to 500ms ahead of disk.

**Impact:** Dashboard shows slightly delayed output. Acceptable for real-time display.

**Current Mitigation:** SSE clients receive output chunks directly via `broadcastOutput()`. File-polling dashboards (standalone) see throttled updates.

**Fix Status:** No fix needed. By design.

---

### STALE-02: Heartbeat Starvation During Blocking Dialogs

**Scenario:** `handleSelectFolder()` calls `execSync()` which blocks the event loop. If the dialog is open for >15s, the watchdog might terminate the server.

**Current Mitigation:** `lastHeartbeat = Date.now()` is called immediately after each blocking dialog returns (lines 231, 242, 251, 258, 272).

**Fix Status:** Already fixed. The heartbeat refresh was added precisely for this case.

---

## 5. Missing UI States

### Loading States

| Location | Loading Indicator | Status |
|----------|------------------|--------|
| Folder selection | None (native dialog) | OK - OS handles this |
| `loadSteps()` | `setup-loading` element | ✓ Present |
| `startRun()` / init-run | `showInitOverlay()` with rotating messages | ✓ Present |
| Step execution | Spinner icon on step item | ✓ Present |
| Progress polling | No indicator (invisible) | OK - background operation |
| `finishRun()` | FINISHING screen with spinner | ✓ Present |

### Error States

| Location | Error Display | Status |
|----------|--------------|--------|
| API failures | `showError()` with message | ✓ Present |
| Git not ready | `showGitSetupError()` with action button | ✓ Present |
| Stale state | `showStaleStateError()` with Reset button | ✓ Present |
| Step failure | Red X icon, status in list | ✓ Present |
| Rate limit | Pause overlay with countdown | ✓ Present |
| Finish skip/timeout | Error message, partial summary | ✓ Present |

### Empty States

| Location | Empty Handling | Status |
|----------|---------------|--------|
| No steps returned | "No steps returned from NightyTidy CLI" error | ✓ Present |
| No step output | "(No output recorded)" fallback | ✓ Present (lines 1010, 1051) |

**Verdict:** All expected loading/error/empty states are handled. No gaps found.

---

## 6. Lifecycle Bugs

### State Doesn't Survive When It Should

| Scenario | Current Behavior | Expected | Status |
|----------|-----------------|----------|--------|
| Tab refresh during run | State lost, run orphaned | State lost | ⚠️ See EDGE-01 |
| Browser back button | State lost | State lost | OK (SPA) |

### State Survives When It Shouldn't

| Scenario | Current Behavior | Expected | Status |
|----------|-----------------|----------|--------|
| `resetApp()` | All state cleared | All cleared | ✓ Correct |
| Window unload | `sendBeacon('/api/exit')` sent | Server cleanup | ✓ Correct |
| New run after completion | `resetApp()` clears all | Fresh state | ✓ Correct |

### Timer Cleanup

All timers are properly cleaned up in `resetApp()` (lines 1542-1591):
- `pollTimer` → `stopProgressPolling()`
- `elapsedTimer` → `stopElapsedTimer()`
- `countdownTimer` → `stopCountdownTimer()`
- `initMsgTimer` → cleared in `hideInitOverlay()`
- `_pauseTimer` → cleared explicitly

**Verdict:** No lifecycle bugs found. Timer cleanup is thorough.

---

## 7. Hydration Mismatches

**Not Applicable.** NightyTidy is a client-only SPA with no SSR.

---

## 8. Edge Cases

### EDGE-01: Tab Refresh Mid-Run

**Scenario:** User refreshes browser tab while a run is in progress.

**Current Behavior:**
1. `beforeunload` shows native browser confirmation dialog
2. If user proceeds, state is lost
3. GUI server continues running (heartbeat Web Worker dies, but process safety timeout keeps server alive during active work)
4. CLI subprocess continues running
5. Orchestrator state file persists on disk

**Impact:** User loses GUI state but underlying run continues. User must re-open GUI or wait for CLI to complete.

**Recommendation:** On page load, check for `nightytidy-progress.json` and offer to reconnect to an in-progress run.

---

### EDGE-02: Multi-Tab Operation

**Scenario:** User opens multiple browser tabs to the same GUI server.

**Current Behavior:**
1. Both tabs receive heartbeat connection
2. State is per-tab (no synchronization)
3. Both tabs can send API calls

**Impact:** Undefined behavior if both tabs try to start runs. Lock file prevents concurrent orchestrated runs but GUI doesn't surface this cleanly.

**Recommendation:** Document as unsupported. Consider adding a "primary tab" concept with BroadcastChannel API.

---

### EDGE-03: Network Interruption (Local Only)

**Scenario:** Theoretically N/A since GUI talks to localhost server.

**Current Behavior:** `api()` has 30s/50min timeouts. Polling has 5s timeout.

**Impact:** Minimal — localhost rarely fails.

---

### EDGE-04: Session Expiry

**Scenario:** N/A — no user authentication, no session tokens.

---

## 9. Re-render Hot Spots

### High-Frequency Renders

| Location | Frequency | Mitigation |
|----------|-----------|------------|
| `pollProgress()` | 500ms | Only re-renders if output changed (line 919) |
| `updateElapsed()` | 1000ms | Lightweight DOM updates |
| `renderProgressFromFile()` | 500ms | Short-circuits when viewing stored output (line 843) |

### Optimization Opportunities

1. **`state.stepResults.find()`** called in render loops (lines 549, 1000, 1035) — could be pre-indexed but array size is ≤33 steps, so O(n) is acceptable.

2. **Output rendering** — `renderMarkdown()` is called on every output change. Could cache if same input, but markdown library is fast.

**Verdict:** No critical hot spots. Performance is acceptable for the use case.

---

## 10. Architecture Assessment

### Strengths

1. **Simplicity:** No state management library overhead. Direct mutations in focused state objects.
2. **File-based persistence:** Cross-process coordination without IPC complexity.
3. **Atomic writes:** State file uses write-to-temp + rename pattern.
4. **Clear boundaries:** CLI vs GUI vs Orchestrator state is well-separated.
5. **Fire-and-forget patterns:** Dashboard/notifications don't block main execution.

### Weaknesses (By Design)

1. **No client-side storage:** All state is in-memory. Tab refresh loses state.
2. **No server cache:** API results are not cached. Each call is fresh.
3. **Manual synchronization:** Developer must remember to update both `completedSteps` and `stepResults`.

### Migration Paths (If Ever Needed)

| Current Pattern | Potential Migration | Trigger |
|-----------------|--------------------|---------|
| Direct mutations | Zustand/Jotai | If state grows >50 fields |
| File polling | WebSocket | If <500ms latency needed |
| No client storage | IndexedDB | If offline support needed |

---

## 11. Fixes Applied

No fixes were applied during this audit. The state management architecture is sound.

---

## 12. Recommendations

| # | Recommendation | Impact | Risk if Ignored | Worth Doing? | Details |
|---|----------------|--------|-----------------|--------------|---------|
| 1 | Add reconnection on page load | Medium | Orphaned runs confuse users | Yes | Check for `nightytidy-progress.json` on init, offer to reconnect |
| 2 | Document multi-tab as unsupported | Low | Edge case confusion | Yes | Add note to docs/README |
| 3 | Add `state` version field | Low | Future-proof state schema | Maybe | Add `version: 1` to app.js state for future migrations |
| 4 | Pre-index `stepResults` lookup | Low | Micro-optimization | No | Array is ≤33 items, O(n) is fine |

---

## Chat Summary

1. **Status:** Completed comprehensive state management audit. All major state containers cataloged (14 total across 7 modules). No tests to run (documentation-only audit). Duration: ~15 minutes.

2. **Key Findings:**
   - **SOLID architecture** — pragmatic, simple state management appropriate for CLI+GUI tool
   - **3 acceptable duplications** — step status tracking, orchestrator vs progress, output buffer (all by design)
   - **2 stale state scenarios** — progress file lag (by design) and heartbeat starvation (already mitigated)
   - **0 missing UI states** — loading, error, and empty states all present
   - **0 lifecycle bugs** — timer cleanup is thorough, reset logic is complete
   - **4 edge cases documented** — tab refresh (main one), multi-tab, network, session

3. **Changes Made:** None. The architecture is sound. Created this audit report.

4. **Recommendations:**

| # | Recommendation | Impact | Risk if Ignored | Worth Doing? | Details |
|---|----------------|--------|-----------------|--------------|---------|
| 1 | Reconnect on page load | Medium | Orphaned run confusion | Yes | Check for progress.json on init |
| 2 | Document multi-tab | Low | Edge case confusion | Yes | Add to docs |
| 3 | Add state version field | Low | Future-proofing | Maybe | Minor schema change |
| 4 | Pre-index stepResults | Low | Micro-optimization | No | Premature optimization |

5. **Report Location:** `audit-reports/25_STATE_MANAGEMENT_REPORT_01_2026-03-10_2230.md`
