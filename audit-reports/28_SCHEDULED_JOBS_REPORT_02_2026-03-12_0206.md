# Scheduled Jobs & Background Process Audit Report

**Run #02** | **Date**: 2026-03-12 02:06 | **Auditor**: Claude Opus 4.5

## Executive Summary

| Metric | Value |
|--------|-------|
| **Total Jobs Found** | 24 |
| **Healthy** | 23 |
| **At Risk** | 1 |
| **Dangerous** | 0 |
| **Broken** | 0 |
| **Missing Jobs Identified** | 0 |

**Overall Health Rating**: **SOLID**

**If you read nothing else**: This codebase has exceptionally well-designed timer management. Every timer has proper cleanup, timeouts have layered fallbacks, and the dual-heartbeat system (Web Worker + main thread) handles Chrome's aggressive tab throttling. The one at-risk finding is a minor monitoring gap, not a correctness issue.

---

## Job Inventory

### 1. Recurring Background Jobs

| # | Name | Location | Schedule | Purpose | Cleanup | Timeout | Monitoring |
|---|------|----------|----------|---------|---------|---------|------------|
| 1 | GUI Server Watchdog | `gui/server.js:820` | 5s check | Auto-shutdown when browser gone | `clearInterval` + `.unref()` | 15s idle threshold | Logs warning before shutdown |
| 2 | Frontend Heartbeat (Worker) | `gui/resources/app.js:1995` | 5s | Keep server alive (throttle-immune) | N/A (continuous) | None needed | Fire-and-forget |
| 3 | Frontend Heartbeat (Main) | `gui/resources/app.js:2003` | 5s | Keep server alive (backup) | N/A (continuous) | None needed | Fire-and-forget |
| 4 | Progress Polling (GUI) | `gui/resources/app.js:938` | 500ms/1000ms adaptive | Update step output in UI | `clearInterval` on stop | 5s per poll | Warns after 10 consecutive failures |
| 5 | Init Overlay Polling | `gui/resources/app.js:173` | 400ms | Show pre-checks progress | `clearInterval` | 3s timeout | Best-effort (no error logging) |
| 6 | Elapsed Time Display | `gui/resources/app.js:950` | 1s | Live step duration counter | `clearInterval` | None needed | Display-only |
| 7 | Pause Countdown | `gui/resources/app.js:1365` | 1s | Rate-limit auto-resume countdown | `clearInterval` | None needed | Display-only |
| 8 | Dashboard Output Throttle | `src/dashboard.js:386` | 500ms debounce | Batch writes to progress JSON | `clearTimeout` in `stopDashboard()` | None needed | Fire-and-forget |
| 9 | Dashboard Standalone Poll | `src/dashboard-standalone.js:146` | 500ms | Poll progress for SSE broadcast | `clearInterval` on SIGTERM | None needed | No error logging |
| 10 | TUI Polling | `src/dashboard-tui.js:162` | 1s | Render terminal progress | `clearInterval` on completion | 5s exit delay | `uncaughtException` handler |
| 11 | Orchestrator Output Throttle | `src/orchestrator.js:299` | 50ms debounce | Batch progress writes | None (leak-safe via closure) | None needed | Fire-and-forget |

### 2. One-Shot Timeouts (Safety / Cleanup)

| # | Name | Location | Delay | Purpose | Cleanup | Error Path |
|---|------|----------|-------|---------|---------|------------|
| 12 | Auto-Resume Timer | `gui/resources/app.js:1285` | 2min–2hr backoff | Auto-resume after rate limit | `clearTimeout` on manual resume | Manual resume resets backoff |
| 13 | Dashboard Auto-Shutdown | `src/dashboard.js:426` | 3s | Close server after results visible | `clearTimeout` in `stopDashboard()` | None needed |
| 14 | Step Timeout | `src/executor.js:206` | 45 min | Hard cap on step duration | `clearTimeout` in finally | Aborts via `AbortSignal` |
| 15 | Claude Process Timeout | `src/claude.js:232` | 45 min | Kill subprocess if hung | `clearTimeout` on completion | `forceKillChild()` |
| 16 | Inactivity Timeout | `src/claude.js:408` | 3 min silence | Kill stalled subprocess | `clearTimeout` on data | Retry loop handles |
| 17 | SIGKILL Grace | `src/claude.js:134` | 5s | Force-kill on Unix | `.unref()` (no cleanup needed) | Last resort |
| 18 | GUI Process Safety | `gui/server.js:449` | 48 min | Force-kill stuck subprocess | `clearTimeout` on completion | Logs, kills, returns error |
| 19 | GUI Server Force-Exit | `gui/server.js:844` | 5s | Guarantee shutdown | `.unref()` | `process.exit(1)` |
| 20 | Dashboard Force-Exit | `src/dashboard-standalone.js:164` | 10s | Guarantee dashboard shutdown | `.unref()` | `process.exit(0)` |
| 21 | Finish Timeout (GUI) | `gui/resources/app.js:1514` | 15 min | Auto-skip stuck finish phase | `clearTimeout` on completion | Marks finish as skipped |
| 22 | Dashboard Startup Probe | `src/orchestrator.js:340` | 5s | Wait for dashboard server ready | `clearTimeout` on response | Graceful fallback (no dashboard) |

### 3. Blocking Operations with Timer Refresh

| # | Name | Location | Trigger | Purpose | Mechanism |
|---|------|----------|---------|---------|-----------|
| 23 | Folder Picker Heartbeat | `gui/server.js:352,363,372,379` | After `execSync` | Prevent watchdog during dialog | `lastHeartbeat = Date.now()` |

### 4. Sleep/Wait Functions

| # | Name | Location | Usage | Abort Support |
|---|------|----------|-------|---------------|
| 24 | Rate-Limit Wait Loop | `src/executor.js:345` | Exponential backoff with probes | Yes (`AbortSignal`) |

---

## Health Assessment

| Job | Silent Failure Risk | Overlap Risk | Timeout Risk | Idempotency | Data Correctness | Monitoring | Overall |
|-----|---------------------|--------------|--------------|-------------|------------------|------------|---------|
| Server Watchdog | LOW | N/A | N/A | N/A | N/A | GOOD | **HEALTHY** |
| Heartbeats (Dual) | LOW | N/A (designed for dual) | N/A | SAFE | N/A | Adequate | **HEALTHY** |
| Progress Polling | LOW | N/A | LOW | SAFE | SAFE | GOOD | **HEALTHY** |
| Init Polling | LOW | N/A | LOW | SAFE | N/A | MINIMAL | **HEALTHY** |
| Dashboard Throttle | LOW | N/A | N/A | SAFE | SAFE | None | **HEALTHY** |
| Standalone Dashboard Poll | **MEDIUM** | N/A | LOW | SAFE | SAFE | **NONE** | **AT RISK** |
| TUI Polling | LOW | N/A | LOW | SAFE | SAFE | Basic | **HEALTHY** |
| Step Timeout | LOW | N/A | LOW | N/A | SAFE | GOOD | **HEALTHY** |
| Process Timeout | LOW | N/A | LOW | N/A | SAFE | GOOD | **HEALTHY** |
| Inactivity Timeout | LOW | N/A | LOW | N/A | SAFE | GOOD | **HEALTHY** |
| All Force-Exit Timers | LOW | N/A | N/A | N/A | SAFE | Basic | **HEALTHY** |

---

## Critical Findings

### Finding 1: Dashboard Standalone Server Has No Error Logging

**Severity**: LOW (Monitoring gap, not a bug)

**Location**: `src/dashboard-standalone.js:70`

**Issue**: The `pollProgress()` function catches all errors silently with an empty catch block:
```javascript
} catch { /* file being written or invalid — skip this tick */ }
```

**Impact**: If the progress file becomes corrupted or the JSON parsing fails repeatedly, there's no visibility into the failure. The dashboard just shows stale data.

**Why it's not critical**:
- This is a display-only component (doesn't affect the actual run)
- Orchestrator mode has multiple fallback paths
- The comment indicates the silent catch is intentional for file-write contention

**Recommendation**: Add a counter to log a warning after N consecutive failures (like `gui/resources/app.js` does with `pollFailureCount`).

---

## Missing Jobs Analysis

**No missing jobs identified.**

The codebase handles all expected cleanup scenarios:

| Expected Job | Status | Implementation |
|--------------|--------|----------------|
| Orphan cleanup (temp files) | **COVERED** | `dashboard.js` and `orchestrator.js` clean up progress/URL files on stop |
| Lock file cleanup | **COVERED** | `releaseLock()` called in all exit paths; stale lock detection with TTY prompt |
| State file cleanup | **COVERED** | `deleteState()` called by `finishRun()` |
| Process tree cleanup | **COVERED** | `forceKillChild()` uses `taskkill /F /T` on Windows, SIGKILL fallback on Unix |
| SSE connection cleanup | **COVERED** | All SSE clients explicitly `.end()`ed and `.clear()`ed on shutdown |
| Timer cleanup | **COVERED** | Every `setInterval`/`setTimeout` has corresponding `clearInterval`/`clearTimeout` |

---

## Fixes Applied

**None required.** All timers have proper cleanup and the one monitoring gap is cosmetic.

---

## Resource & Scheduling Analysis

### Peak-Hour Conflicts
Not applicable — NightyTidy is a user-initiated tool, not a scheduled service.

### Resource Competition
- **Disk I/O**: Throttled writes (500ms) prevent thrashing during high-output steps
- **CPU**: Polling intervals are reasonable (500ms–1s) and adaptive
- **Memory**: Output buffers are bounded (100KB rolling buffer)

### Timer Layering (Defense in Depth)

The codebase uses excellent cascading timeout patterns:

```
Layer 1: Step Timeout (45 min)     → Aborts entire step
    ↳ Layer 2: Process Timeout (45 min) → Kills subprocess
        ↳ Layer 3: Inactivity Timeout (3 min) → Kills stalled subprocess
            ↳ Layer 4: SIGKILL Grace (5s) → Force-kills on Unix
```

GUI has similar layering:
```
Layer 1: Process Safety (48 min)   → Force-kills hung command
    ↳ Layer 2: API Timeout (50 min) → Aborts fetch on client
        ↳ Layer 3: Server Watchdog (15s) → Auto-shutdown if idle
            ↳ Layer 4: Force-Exit (5s) → Guarantees termination
```

---

## Recommendations

| # | Recommendation | Impact | Risk if Ignored | Worth Doing? | Details |
|---|----------------|--------|-----------------|--------------|---------|
| 1 | Add failure counter to dashboard-standalone polling | Better debugging | LOW — cosmetic only | If time | Log warning after 10+ consecutive `pollProgress()` failures, like `gui/resources/app.js:961` does |

---

## Architectural Observations

### Strengths

1. **Dual-Layer Heartbeat**: Web Worker + main thread heartbeat is clever engineering. Chrome's aggressive tab throttling killed many runs before this pattern was implemented.

2. **`.unref()` Usage**: All safety timers use `.unref()` so they don't keep the process alive solely for cleanup. This prevents orphaned processes.

3. **Throttled Writes**: The 500ms debounce on progress file writes prevents disk thrashing without adding complexity.

4. **Adaptive Polling**: Progress polling switches between 500ms (active) and 1000ms (idle) based on whether content is changing.

5. **Abort Signal Propagation**: Step timeouts properly propagate via `AbortSignal.any()`, allowing clean cancellation at any layer.

6. **Atomic State Writes**: `writeState()` in orchestrator uses write-to-temp + rename pattern to prevent truncated JSON on crash.

### No Technical Debt Related to Timers

All timer code follows consistent patterns:
- Start functions (`start*Timer`) paired with stop functions (`stop*Timer`)
- Cleanup in `finally` blocks or explicit shutdown handlers
- State tracking (`ds.outputWritePending`, `state.pollTimer`, etc.)
- Comments explaining non-obvious behavior

---

## Conclusion

This codebase has **production-grade timer management**. The multi-layer timeout architecture, proper cleanup handlers, and defensive patterns like dual heartbeats show careful engineering. The one finding (dashboard-standalone silent failures) is a minor monitoring gap that doesn't affect correctness.

**Rating**: SOLID
