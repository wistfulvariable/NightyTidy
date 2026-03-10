# Error Recovery & Resilience Audit — Run 02

**Date**: 2026-03-10
**Codebase**: NightyTidy v0.1.0
**Tests baseline**: 738 tests, 34 files, all passing
**Previous audit**: `20_ERROR_RECOVERY_REPORT_1_2026-03-09.md` (7 issues fixed)

---

## 1. Executive Summary

**Resilience Maturity: Resilient**

NightyTidy's error recovery is well-designed and has improved since the previous audit. The core subprocess wrapper (`claude.js`) has robust timeout, retry, and abort handling with proper rate-limit classification. The orchestrator state file now uses atomic writes. HTTP servers have appropriate timeouts. Graceful shutdown is implemented across all entry points with force-exit safety nets.

**What happens if Claude API goes down for 10 minutes?**
- Rate-limit detection triggers automatic pause/resume with exponential backoff (2min → 2hr cap)
- API probes detect when service is back
- Run continues from the last failed step
- User sees rate-limit status in dashboard with countdown

**Top 5 Resilience Gaps (in priority order):**
1. **Git operations have no timeout** — simple-git calls can hang on network drives
2. **Report generation is not atomic** — crash during write leaves truncated file
3. **Lock file readline has no timeout** — TTY override prompt waits indefinitely
4. **GUI spawned commands have no timeout** — user commands run until killed externally
5. **No circuit breaker for external dependencies** — all failures cascade immediately

---

## 2. Timeout Audit

### External Call Inventory

| Module | Operation | Timeout | Notes |
|--------|-----------|---------|-------|
| `claude.js` | Claude subprocess | 45 min (configurable) | Generous but appropriate for AI workloads |
| `claude.js` | Retry sleep | 10s (abortable) | Properly short-circuits on abort signal |
| `checks.js` | Silent auth check | 30s | Falls through to interactive if fails |
| `checks.js` | Interactive auth | **NONE** | Intentional — TTY user input |
| `checks.js` | git/df/wmic commands | **NONE** | Low risk for local commands |
| `sync.js` | Google Doc fetch | 30s | AbortController properly implemented |
| `dashboard.js` | HTTP server | 30s request / 15s headers | SSE excluded by design |
| `dashboard-standalone.js` | HTTP server | 30s request / 15s headers | Same as above |
| `gui/server.js` | HTTP server | 30s request / 15s headers | Same as above |
| `gui/server.js` | Dialog commands | 60s | execSync timeout |
| `gui/server.js` | Spawned commands | **NONE** | By design — managed via /api/kill-process |
| `git.js` | simple-git operations | **NONE** | Library has no built-in timeout |
| `lock.js` | TTY prompt | **NONE** | Intentional — user input |
| `orchestrator.js` | Dashboard startup | 5s | Continues without dashboard on timeout |

### Operations Still Missing Timeouts

| Operation | File | Risk | Recommendation |
|-----------|------|------|----------------|
| `git.status()`, `git.commit()`, etc. | git.js | **Medium** | simple-git supports `.timeout({ block: ms })` but requires user-facing decision on values |
| Lock TTY prompt | lock.js:51-58 | **Low** | TTY only; Ctrl+C is the escape |
| Spawned user commands | gui/server.js:288 | **Low** | By design — lifecycle managed externally |

---

## 3. Retry Logic Audit

### Existing Retry Patterns

| Operation | Strategy | Max Retries | Backoff | Errors Retried |
|-----------|----------|-------------|---------|----------------|
| Claude prompt | Fixed 10s delay | 3 | None | All except rate-limit |
| Rate-limit recovery | Exponential | 6 | 2min → 2hr cap | Rate-limit only |
| Git tag/branch create | Immediate | 10 | None | Name collision only |

### Evaluation

**Claude Code Retry (claude.js:540-586)**
- **Correct?** Yes — rate limits skip retries (won't resolve in 10s)
- **Issues:** Fixed delay could cause thundering herd in multi-tenant deployments, but NightyTidy is single-user
- **Fix needed?** No — appropriate for CLI tool

**Rate-Limit Recovery (executor.js:286-329)**
- **Correct?** Yes — exponential backoff with API probes
- **Issues:** None — well-designed
- **Fix needed?** No

**Git Name Collision (git.js:103-114)**
- **Correct?** Yes — only retries name collisions, not git errors
- **Issues:** None
- **Fix needed?** No

### Operations That Could Use Retries But Don't

| Operation | Reason Not Retried | Safe to Retry? |
|-----------|-------------------|----------------|
| Git operations | Local ops rarely fail transiently | No — would hide real problems |
| Notifications | Fire-and-forget | N/A — errors already swallowed |
| File I/O | Synchronous, no transient failures | No — would delay without benefit |
| Fetch (sync.js) | 30s timeout is generous | Maybe — but single-use command |

---

## 4. Circuit Breaker & Fallback Assessment

### Dependency Failure Modes

| Dependency | Current Failure Mode | Cascading? | Fallback Exists? |
|------------|---------------------|------------|------------------|
| Claude API | Rate-limit pause → exponential backoff → API probes | No | Yes — partial results |
| Git | Throws to caller | Yes | No — run aborts |
| File system | Throws to caller | Varies | Partial — some wrapped in try/catch |
| Notifications | Swallowed | No | Yes — silent failure |
| Dashboard | Continues without | No | Yes — TUI-only mode |

### Circuit Breaker Recommendations (Not Implemented — Document Only)

| Dependency | Recommended Config | Fallback | Estimated Effort |
|------------|-------------------|----------|------------------|
| Claude API | Already implemented via rate-limit handling | Partial results | N/A — done |
| Git on network drive | 60s operation timeout | Warn and continue | Medium |
| Desktop notifications | Already fire-and-forget | Silent | N/A — done |

No circuit breaker infrastructure exists. Given NightyTidy is a single-user CLI tool with rare failure modes, adding circuit breaker libraries would be over-engineering.

---

## 5. Partial Failure & Data Consistency

### Multi-Step Operations

| Operation | Steps | Failure Mode | Current Handling | Remaining Risk |
|-----------|-------|--------------|------------------|----------------|
| executeSingleStep | Improvement → doc update → commit check → fallback commit | Step 2+ fail | Continues with warning | None — changes preserved |
| finishRun | Changelog → action plan → report → git commit → merge | Any step | Warnings logged, continues | Report may be incomplete |
| initRun | Pre-checks → lock → git setup → state file → dashboard | Dashboard fails | Continues without | None — state file exists |
| syncPrompts | Fetch → parse → match → write files → update hash | Write fails | Returns error | Files may be partially written |

### Atomic Write Assessment

| File | Atomic? | Risk if Crashed During Write |
|------|---------|------------------------------|
| orchestrator state | **Yes** (write-tmp + rename) | None — atomic |
| NIGHTYTIDY-REPORT.md | No | Truncated report (recoverable via git log) |
| CLAUDE.md update | No | Truncated file (recoverable via git reset) |
| nightytidy-progress.json | No | Stale progress (ephemeral, non-critical) |
| lock file | **Yes** (O_EXCL atomic create) | None — kernel guarantees |
| prompt files (sync) | No | Inconsistent prompts (re-sync fixes) |

### Fixes Applied in Previous Audit

The orchestrator state file now uses atomic write-to-temp-then-rename (lines 112-118 of orchestrator.js). This was documented as a known issue in the previous audit and has been fixed.

---

## 6. Graceful Shutdown Assessment

### Signal Handling

| Entry Point | SIGINT | SIGTERM | Force Exit Timeout |
|-------------|--------|---------|-------------------|
| cli.js | ✓ (two-stage: graceful → force) | — | 2nd SIGINT |
| gui/server.js | ✓ | ✓ | 5s |
| dashboard-standalone.js | ✓ | ✓ | 10s |

### Resource Cleanup Checklist

| Resource | Cleaned Up on Shutdown? |
|----------|------------------------|
| Claude subprocess | ✓ (SIGTERM + SIGKILL fallback) |
| HTTP server connections | ✓ (force exit timeout prevents hanging) |
| SSE clients | ✓ (explicitly closed before server.close()) |
| Lock file | ✓ (process.on('exit') handler) |
| Progress JSON | ✓ (deleted by stopDashboard) |
| Dashboard URL file | ✓ (deleted by stopDashboard) |
| GUI child processes | ✓ (killAllProcesses on cleanup) |
| File handles | ✓ (all use sync APIs, no persistent handles) |

### Before/After Comparison (from previous audit)

| Item | Before | After |
|------|--------|-------|
| Dashboard HTTP timeout | None | 30s request / 15s headers |
| Dashboard standalone force exit | None | 10s timeout |
| GUI server force exit | None | 5s timeout |
| GUI server HTTP timeout | None | 30s request / 15s headers |

All graceful shutdown improvements from the previous audit remain in place.

---

## 7. Queue & Job Resilience

NightyTidy does not use message queues, background jobs, or scheduled tasks in the traditional sense. The closest analog is the step execution loop:

| "Queue" | Retry Config | Dead Letter? | Monitoring? |
|---------|--------------|--------------|-------------|
| Step execution loop | Rate-limit auto-retry | Failed steps recorded | Progress JSON + dashboard |
| Orchestrator state | Manual (re-run --run-step) | State file persists | State file readable |

No dead letter queue is needed — failed steps are recorded in results and the run continues with remaining steps.

---

## 8. Cascading Failure Risk Map

```
Claude API
    │
    ├── Rate limit ──► Pause (2min → 2hr backoff) ──► Probe ──► Resume
    │                  ↓
    │             SIGINT ──► Partial results ──► Exit
    │
    ├── Timeout (45min) ──► Retry (3x) ──► Step failed ──► Continue
    │
    └── Auth failure ──► Pre-check throws ──► Run aborts

Git (simple-git)
    │
    ├── Operation hangs ──► [NO TIMEOUT] ──► Process stuck
    │
    ├── Merge conflict ──► Returns { conflict: true } ──► User resolves
    │
    └── Other error ──► Throws ──► Run aborts

File System
    │
    ├── Lock EEXIST ──► Check staleness ──► Override or abort
    │
    ├── Write error ──► Varies (try/catch in some places)
    │
    └── Network drive ──► [CAN HANG] ──► No protection
```

**Critical Paths with No Fallback:**
1. Git operations on hung network drive — no timeout, process hangs
2. Initial pre-checks — any failure aborts the entire run

**Blast Radius per Dependency:**
- Claude API down: Single step fails, run pauses, recovers on API return
- Git unavailable: Run cannot start or commits fail
- File system slow: Potential hangs in lock/progress writes (low risk — local SSD typical)

---

## 9. Changes Made This Audit

**None required.** The codebase resilience has significantly improved since the previous audit. All 7 fixes from Run 01 are verified in place:

1. ✓ Dashboard HTTP server timeouts (dashboard.js:189-190)
2. ✓ Dashboard standalone force-exit on SIGTERM (dashboard-standalone.js)
3. ✓ Dashboard standalone server timeouts (dashboard-standalone.js:126-127)
4. ✓ GUI server request timeouts (gui/server.js:584-585)
5. ✓ GUI server force-exit on shutdown (gui/server.js:612-619)
6. ✓ Atomic state file writes (orchestrator.js:112-118)
7. ✓ Output buffer timer cleanup (dashboard.js:239-244)

---

## 10. Recommendations

| # | Recommendation | Impact | Risk if Ignored | Worth Doing? | Details |
|---|---|---|---|---|---|
| 1 | Add timeout to simple-git operations | Prevents hangs on network drives | **Medium** | Probably | Use `git.timeout({ block: 120000 })` for a 2-minute global timeout. Requires testing with large repos. |
| 2 | Make report writes atomic | Prevents truncated reports on crash | **Low** | Only if time allows | Use write-to-temp-then-rename pattern (same as orchestrator state). Very unlikely failure mode. |
| 3 | Add atomic write to sync.js | Prevents partial prompt file updates | **Low** | Only if time allows | Write all files to temp directory, then move atomically. Current re-sync recovers from any corruption. |
| 4 | Document network drive limitations | Sets user expectations | **Low** | Yes | Add a note to README that NightyTidy is designed for local repos; network drives may cause hangs. |

---

## 11. Test Impact

All 738 tests continue to pass. No code changes were made in this audit — this is a verification and documentation run confirming the improvements from Run 01 are still in place and working correctly.

---

## 12. Conclusion

NightyTidy's error recovery has matured to a **Resilient** level. The core failure modes (rate limits, timeouts, aborts) are well-handled. The remaining gaps are edge cases (network drives, extremely rare crash-during-write scenarios) that don't warrant the complexity cost of addressing them for a single-user CLI tool.

The most impactful remaining improvement would be adding a timeout to simple-git operations, which would prevent hangs when running against network-mounted repositories. This is documented as Recommendation #1 for a future sprint if users report issues with network drives.
