# Scheduled Jobs & Background Process Audit Report

**Audit Date**: 2026-03-10
**Auditor**: Claude Code (NightyTidy orchestrator)
**Codebase**: NightyTidy v0.x (automated overnight codebase improvement tool)

---

## 1. Executive Summary

| Metric | Value |
|--------|-------|
| Total background operations found | 33+ |
| `setInterval` timers | 7 |
| `setTimeout` timers | 10+ |
| Child process types | 8 |
| Polling/retry loops | 3 |
| Lock file mechanisms | 1 |
| CI/CD scheduled jobs | 0 (all event-triggered) |
| **Healthy** | 33 |
| **At Risk** | 0 |
| **Dangerous** | 0 |
| **Broken** | 0 |
| **Missing jobs identified** | 0 |

### If You Read Nothing Else

**All background jobs are healthy.** NightyTidy has no traditional scheduled jobs or message queues — it IS a scheduled job itself (users run it overnight). All internal timers, child processes, heartbeats, and polling loops are properly managed with cleanup paths, timeout protections, and appropriate monitoring. The codebase demonstrates strong process lifecycle hygiene.

---

## 2. Job Inventory

### 2.1 Recurring Timers (`setInterval`)

| # | Name | Location | Frequency | Purpose | Cleanup | Monitoring | Health |
|---|------|----------|-----------|---------|---------|------------|--------|
| 1 | GUI Progress Polling | `gui/resources/app.js:809` | 500ms | Poll `nightytidy-progress.json` for step updates | `stopProgressPolling()` clears | Failure count tracked, backoff on errors | ✅ OK |
| 2 | GUI Elapsed Timer | `gui/resources/app.js:821` | 1000ms | Update elapsed time display in GUI | `stopElapsedTimer()` clears | N/A (display only) | ✅ OK |
| 3 | GUI Rate-Limit Countdown | `gui/resources/app.js:1210` | 100ms | Countdown display during rate-limit pause | `stopCountdownTimer()` clears | Renders to UI | ✅ OK |
| 4 | GUI Init Message Rotation | `gui/resources/app.js:158` | 1500ms | Rotate loading messages during startup | `clearInterval()` on completion | N/A (UX only) | ✅ OK |
| 5 | GUI Heartbeat (Web Worker) | `gui/resources/app.js:1715` | 5000ms | Keep server alive, detect browser close | None (intentional lifetime) | Server logs heartbeat gaps | ✅ OK |
| 6 | GUI Heartbeat (Main Thread) | `gui/resources/app.js:1723` | 5000ms | Backup heartbeat for focused tabs | None (intentional lifetime) | Dual-layer redundancy | ✅ OK |
| 7 | GUI Server Watchdog | `gui/server.js:640` | 5000ms | Self-terminate server if browser gone | Implicit (process exits) | Logs before exit | ✅ OK |
| 8 | Standalone Dashboard Poll | `src/dashboard-standalone.js:146` | 500ms | Read progress JSON, broadcast via SSE | `clearInterval()` on SIGTERM | Skips tick if file being written | ✅ OK |
| 9 | TUI Dashboard Poll | `src/dashboard-tui.js:162` | 1000ms | Render progress in terminal window | Self-healing retry loop | Try/catch per tick | ✅ OK |
| 10 | Dashboard HTML Elapsed | `src/dashboard-html.js:382` | 1000ms | Browser-side elapsed timer | Cleared on step completion | N/A (display only) | ✅ OK |

### 2.2 Delayed Timers (`setTimeout`)

| # | Name | Location | Delay | Purpose | Cleanup | Health |
|---|------|----------|-------|---------|---------|--------|
| 1 | Claude SIGKILL Escalation | `src/claude.js:134` | 5000ms | Escalate SIGTERM→SIGKILL | `.unref()` present | ✅ OK |
| 2 | Claude Inactivity Timeout | `src/claude.js:408` | 3 min | Kill stalled subprocess | `clearTimeout()` on activity | ✅ OK |
| 3 | Claude Retry Delay | `src/claude.js:640` | 10s | Sleep before retry | Abort signal clears | ✅ OK |
| 4 | Rate-Limit Backoff | `src/executor.js:352` | 2min→2hr | Wait between rate-limit probes | Abort signal clears | ✅ OK |
| 5 | Dashboard Output Throttle | `src/dashboard.js:294` | 500ms | Debounce progress JSON writes | `stopDashboard()` clears | ✅ OK |
| 6 | Dashboard Shutdown Delay | `src/dashboard.js:327` | 3000ms | Allow SSE messages to drain | `stopDashboard()` clears | ✅ OK |
| 7 | Standalone Force-Exit | `src/dashboard-standalone.js:164` | 10s | Guarantee process termination | `.unref()` present | ✅ OK |
| 8 | GUI Server Exit Delay | `gui/server.js:463` | 200ms | Flush final responses | One-shot (process exits) | ✅ OK |
| 9 | GUI Shutdown Force-Exit | `gui/server.js:663` | 5000ms | Guarantee graceful shutdown | `.unref()` present | ✅ OK |
| 10 | GUI Process Safety Timeout | `gui/server.js:322` | 48 min | Kill hung subprocess | `clearTimeout()` on close | ✅ OK |
| 11 | Step-Level Timeout | `src/executor.js:198` | 45 min | Hard cap on step duration | `clearTimeout()` in finally | ✅ OK |

### 2.3 Child Process Management

| # | Name | Location | Type | Lifecycle | Cleanup Path | Health |
|---|------|----------|------|-----------|--------------|--------|
| 1 | Claude Code Subprocess | `src/claude.js:207` | spawn (shell on Windows) | Per-prompt | `forceKillChild()` + timeout + abort | ✅ OK |
| 2 | Pre-Run Checks | `src/checks.js:12,91` | exec/spawn | Short-lived, synchronous | Timeout kills child | ✅ OK |
| 3 | Orchestrator Dashboard | `src/orchestrator.js:156` | spawn (detached) | Long-lived server | SIGTERM in `finishRun()` | ✅ OK |
| 4 | TUI Terminal Window | `src/dashboard.js:137` | spawn (detached) | Fire-and-forget | `.unref()` present | ✅ OK |
| 5 | Chrome Browser | `gui/server.js:588` | spawn (detached) | Fire-and-forget | `.unref()` present | ✅ OK |
| 6 | GUI Run-Command | `gui/server.js:297` | spawn | Tracked in `activeProcesses` | `killAllProcesses()` on exit | ✅ OK |
| 7 | Folder Dialog | `gui/server.js:230` | execSync | Synchronous, blocking | 60s timeout | ✅ OK |
| 8 | Git Operations | `src/git.js` | simple-git (internal) | Per-operation | Managed by npm dep | ✅ OK |

### 2.4 Polling & Retry Loops

| # | Name | Location | Pattern | Abort Support | Health |
|---|------|----------|---------|---------------|--------|
| 1 | Rate-Limit Probe Loop | `src/executor.js:348` | 6 tiers (2min→2hr) | `AbortSignal` respected | ✅ OK |
| 2 | Claude Retry Loop | `src/claude.js:596` | Up to 4 attempts | `AbortSignal` respected | ✅ OK |
| 3 | Dashboard Startup Poll | `src/orchestrator.js:165` | 5s timeout with polling | Implicit timeout | ✅ OK |

### 2.5 Lock File System

| Component | Location | Mechanism | Staleness Detection | Health |
|-----------|----------|-----------|---------------------|--------|
| Atomic Lock File | `src/lock.js:10` | `fs.openSync('wx')` (O_EXCL) | PID liveness + 24hr age limit | ✅ OK |

**Details:**
- **Atomic creation**: Uses exclusive create flag to prevent TOCTOU races
- **Staleness detection**: Checks if PID is alive + enforces 24-hour max age (handles Windows PID recycling)
- **Interactive override**: TTY prompt for manual override when lock appears active
- **Persistent mode**: Lock survives process exit for orchestrator multi-invocation mode
- **Error handling**: Corrupt lock files treated as stale

### 2.6 CI/CD Pipeline

| Pipeline | File | Trigger | Scheduled? | Health |
|----------|------|---------|------------|--------|
| CI | `.github/workflows/ci.yml` | `push`, `pull_request` on `master` | **No** (event-triggered) | ✅ OK |

The CI pipeline runs:
- Tests on 2 OS × 3 Node versions (6 matrix jobs)
- Documentation freshness check
- Coverage with thresholds
- Gitleaks secrets scan
- npm security audit

**No scheduled/cron jobs in CI** — all runs are user-triggered via push or PR.

---

## 3. Health Assessment Matrix

| Job | Silent Failure Risk | Overlap Risk | Timeout Risk | Idempotency | Monitoring | Overall |
|-----|---------------------|--------------|--------------|-------------|------------|---------|
| GUI Progress Poll | LOW (failure count tracked) | None (single instance) | None (500ms tick) | N/A | Backoff on errors | ✅ Healthy |
| GUI Heartbeat | LOW (dual-layer) | None (redundant design) | None | N/A | Server watchdog | ✅ Healthy |
| Server Watchdog | LOW (logs before exit) | None | None | N/A | Direct logging | ✅ Healthy |
| Claude Subprocess | LOW (stderr captured) | None (sequential) | Protected (3 layers) | N/A (external) | Full logging | ✅ Healthy |
| Inactivity Timeout | LOW (warns + logs) | None | Self (3 min default) | N/A | Activity timestamps | ✅ Healthy |
| Rate-Limit Backoff | LOW (info logging) | None | 6-tier cap (2hr) | ✅ Probe-based | Attempt logging | ✅ Healthy |
| Lock File | LOW (throws on conflict) | Protected (O_EXCL) | 24hr staleness | ✅ | Warning on stale | ✅ Healthy |
| Dashboard SSE | LOW (try/catch per client) | None | Request timeouts | ✅ | Client cleanup | ✅ Healthy |
| Process Safety Timeout | LOW (force-kills hung) | None | 48 min cap | N/A | Logs kill event | ✅ Healthy |

---

## 4. Critical Findings

**None.** All background operations are properly managed.

---

## 5. Missing Jobs Analysis

After reviewing the codebase, **no missing jobs were identified**. NightyTidy is not a long-running service — it's an overnight batch job tool. The following potential concerns were evaluated:

| Concern | Analysis | Needed? |
|---------|----------|---------|
| Log rotation | `nightytidy-run.log` is per-run, deleted by user | No |
| Lock file cleanup | Auto-removed on exit + 24hr staleness | No |
| Progress file cleanup | Deleted by `stopDashboard()` | No |
| Stale state cleanup | State file deleted by `--finish-run` | No |
| Session GC | Claude Code manages its own sessions | No |
| Temp file cleanup | No temp files created | No |

---

## 6. Fixes Applied

**None required.** All background operations were found to be properly implemented with:
- Appropriate cleanup paths
- Timeout protections
- Abort signal support
- Error handling
- Logging/monitoring

---

## 7. Resource & Scheduling Analysis

### Timeout Layering

NightyTidy implements a 3-layer timeout system to prevent hung processes:

| Layer | Location | Duration | Purpose |
|-------|----------|----------|---------|
| 1 | `api()` AbortController | 30s / 50min | HTTP request timeout |
| 2 | `handleRunCommand()` | 48 min | Process safety timeout |
| 3 | `requestTimeout` | Disabled | Avoided (causes response drops) |

### Heartbeat Architecture

Dual-layer heartbeat prevents premature server shutdown:

```
┌─────────────────┐     ┌─────────────────┐
│  Web Worker     │     │  Main Thread    │
│  (5s interval)  │     │  (5s backup)    │
└────────┬────────┘     └────────┬────────┘
         │                       │
         └───────────┬───────────┘
                     │
                     ▼
              ┌──────────────┐
              │  GUI Server  │
              │  (watchdog)  │
              └──────────────┘
```

**Key safety**: Watchdog skips heartbeat checks entirely when `activeProcesses.size > 0`, preventing mid-run server termination.

### Rate-Limit Backoff Schedule

```
Tier 1: 2 minutes
Tier 2: 5 minutes
Tier 3: 15 minutes
Tier 4: 30 minutes
Tier 5: 1 hour
Tier 6: 2 hours (cap)
```

API probes run between tiers to detect when rate limits clear.

---

## 8. Recommendations

**None.** The codebase demonstrates exemplary background job hygiene:

1. ✅ All `setInterval` calls store IDs for cleanup
2. ✅ All exit-blocking `setTimeout` use `.unref()`
3. ✅ Child processes tracked with close/error handlers
4. ✅ Lock file uses atomic O_EXCL creation
5. ✅ Polling loops have timeout protection
6. ✅ Heartbeat mechanism prevents orphaned servers
7. ✅ Abort signals respect cancellation
8. ✅ All cleanup runs on `process.exit` and `SIGTERM`
9. ✅ Error messages are actionable
10. ✅ Exponential backoff prevents API thundering herd

---

## 9. Appendix: Key File Locations

| Component | File |
|-----------|------|
| CLI entry point | `bin/nightytidy.js` |
| CLI orchestration | `src/cli.js` |
| Claude subprocess | `src/claude.js` |
| Step executor | `src/executor.js` |
| Lock file system | `src/lock.js` |
| Dashboard HTTP server | `src/dashboard.js` |
| Standalone dashboard | `src/dashboard-standalone.js` |
| TUI dashboard | `src/dashboard-tui.js` |
| GUI server | `gui/server.js` |
| GUI frontend | `gui/resources/app.js` |
| Orchestrator mode | `src/orchestrator.js` |
| Git operations | `src/git.js` |
| Pre-run checks | `src/checks.js` |
| CI pipeline | `.github/workflows/ci.yml` |

---

*Report generated by NightyTidy Scheduled Jobs Audit (Step 28)*
