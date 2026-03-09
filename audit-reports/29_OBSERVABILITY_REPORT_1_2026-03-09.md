# Audit #29 — Observability & Monitoring Readiness

**Date**: 2026-03-09
**Scope**: Logging completeness, run diagnostics, failure mode analysis, troubleshooting readiness

## Executive Summary

NightyTidy is a local CLI tool, not a web service. Traditional observability concepts (health endpoints, request metrics, distributed tracing, APM) do not apply. The audit focuses on whether the logging, progress reporting, and error messaging provide enough information for users to diagnose failures without external help.

**Result**: 3 findings (1 medium, 2 low). Logging is comprehensive across all modules with 90 log calls across 13 source files. Start/completion/failure events are logged for every step. Timing data is captured. Claude Code subprocess output is streamed and captured. The main gap is the absence of a troubleshooting runbook for common failure scenarios. Two minor gaps exist in environment context logging (no Node.js version, OS platform, or NightyTidy version logged at startup) and in the report not including per-step error details from Claude Code stderr.

## Phase 1: Logging Assessment

### Logger Architecture

The logger (`src/logger.js`, 55 LOC) is a simple but effective dual-output system:

| Feature | Implementation | Verdict |
|---------|---------------|---------|
| File output | `appendFileSync` to `nightytidy-run.log` | OK — synchronous prevents interleaving |
| Console output | `process.stdout.write` with chalk coloring | OK — colored by level |
| Levels | debug/info/warn/error with `NIGHTYTIDY_LOG_LEVEL` env var | OK — configurable |
| Timestamps | ISO 8601 format (`new Date().toISOString()`) | OK — precise, sortable |
| Initialization guard | Throws if `logFilePath` is null | OK — prevents silent log loss |
| File write failure | Falls back to stderr | OK — graceful degradation |
| Quiet mode | `logQuiet` flag for orchestrator JSON output | OK |
| Invalid log level | Warning to stderr with valid values listed | OK |

### Step Lifecycle Logging

Every step goes through a documented log trail:

```
[INFO ] Running Claude Code: Step 1 — Documentation (attempt 1/4)
[DEBUG] Spawn mode: -p flag, prompt length: 2847 chars
[DEBUG] <Claude Code stdout output...>
[INFO ] Claude Code completed: Step 1 — Documentation — 342s
[INFO ] Step 1: Documentation: committed by Claude Code
[INFO ] Step 1: Documentation — completed (345s)
```

On failure:
```
[WARN ] Claude Code failed: Step 1 — Documentation — Claude Code timed out after 45 minutes (attempt 1/4)
[WARN ] Retrying Step 1 — Documentation in 10s (attempt 2/4)
...
[ERROR] Claude Code failed: Step 1 — Documentation — all 4 attempts exhausted
[ERROR] Step 1: Documentation — failed after 4 attempts
```

| Event | Logged? | Module | Level |
|-------|---------|--------|-------|
| Step start | Yes | executor.js | info |
| Claude spawn mode (stdin vs -p flag) | Yes | claude.js | debug |
| Claude stdout (streaming) | Yes | claude.js | debug |
| Claude stderr | Yes | claude.js | warn |
| Claude completion + duration | Yes | claude.js | info |
| Claude failure + attempt count | Yes | claude.js | warn |
| All retries exhausted | Yes | claude.js | error |
| Retry delay | Yes | claude.js | warn |
| Abort signal | Yes | claude.js (implicit via result) | info |
| Step commit verification | Yes | executor.js | info |
| Fallback commit | Yes | git.js | info |
| No changes detected | Yes | git.js | info |
| Doc update failure | Yes | executor.js | warn |
| Step completion + duration | Yes | executor.js | info |
| Step failure + attempts | Yes | executor.js | error |

**Verdict**: Step lifecycle logging is comprehensive. Every meaningful event is logged with the right severity level.

### Pre-Check Logging

All 6 pre-checks log success/failure with specific, actionable messages:

| Check | Success Log | Failure Behavior |
|-------|------------|-----------------|
| Git installed | `Pre-check: git installed` | Throws with install URL |
| Git repository | `Pre-check: git repository` | Throws with `git init` suggestion |
| Has commits | `Pre-check: has commits` | Throws with commit command |
| Claude installed | `Pre-check: Claude Code installed` | Throws with install URL |
| Claude authenticated | `Pre-check: Claude Code authenticated` | Throws with status URL or triggers interactive sign-in |
| Disk space | `Pre-check: disk space OK (X.X GB free)` | Throws (<100MB) or warns (<1GB) |

**Verdict**: Pre-check logging is excellent. Every check produces a log entry, and failures include URLs and exact commands.

### Cross-Module Logging Coverage

| Module | Log Calls | Coverage Assessment |
|--------|-----------|-------------------|
| cli.js | 15 | Full lifecycle: start, pre-checks, step selection, git setup, completion, errors |
| claude.js | 8 | Spawn mode, attempt tracking, completion, failure, retry, abort |
| checks.js | 16 | Every check logged on success and failure |
| executor.js | 9 | Step start, completion, failure, doc update, commit verification |
| git.js | 9 | Branch/tag creation, merge, fallback commit, ephemeral file exclusion |
| orchestrator.js | 12 | init/step/finish lifecycle, dashboard startup, changelog, state management |
| dashboard.js | 5 | Server start, window open, errors |
| lock.js | 3 | Lock acquired, stale lock removed, override |
| notifications.js | 2 | Send success (debug), send failure (warn) |
| report.js | 3 | Report written, CLAUDE.md updated, update failure |
| setup.js | 3 | Created/appended/updated CLAUDE.md |

**Verdict**: 90 log calls across 13 files. Coverage is thorough.

### FINDING-01 (Low): No environment context logged at startup

**Location**: `src/cli.js:354`, `src/orchestrator.js:208`

The first log line is `NightyTidy starting` (or `Orchestrator: init-run starting`), but no environment context follows. When debugging a user's log file, knowing the Node.js version, OS platform, NightyTidy version, and disk space would immediately narrow the problem space.

**Current**:
```
[2026-03-09T02:15:00.000Z] [INFO ] NightyTidy starting
```

**Recommended**:
```
[2026-03-09T02:15:00.000Z] [INFO ] NightyTidy v0.8.0 starting (Node 22.5.0, win32 x64)
```

**Impact**: Low. Environment info is available via other means (user can report it), but having it in the log file eliminates a round-trip when troubleshooting.

**Fix**: Add a single `info()` call after `initLogger()` that logs version, `process.version`, and `process.platform`.

## Phase 2: Run Diagnostics

### Can a user diagnose failures from the log file alone?

**Yes, in almost all cases.** The log file contains:

1. Timestamped entries for every operation
2. Claude Code subprocess output (at debug level)
3. Attempt counts and retry delays
4. Duration for each step
5. Git operation results
6. Pre-check results with actionable error messages

**Gap**: When `NIGHTYTIDY_LOG_LEVEL` is at the default `info`, Claude Code subprocess output is not visible in the log file (it is logged at `debug` level). A user would need to re-run with `NIGHTYTIDY_LOG_LEVEL=debug` to see what Claude Code actually did. This is an intentional design choice (debug output is very verbose), but could be improved with a targeted note in the log.

### Progress JSON Usefulness

The progress JSON (`nightytidy-progress.json`) provides real-time state for the dashboard/TUI:

```json
{
  "status": "running",
  "totalSteps": 5,
  "currentStepIndex": 2,
  "currentStepName": "Code Structure",
  "steps": [
    { "number": 1, "name": "Documentation", "status": "completed", "duration": 345000 },
    { "number": 2, "name": "Test Coverage", "status": "failed", "duration": 120000 },
    { "number": 3, "name": "Code Structure", "status": "running", "duration": null }
  ],
  "completedCount": 1,
  "failedCount": 1,
  "startTime": 1741489200000,
  "currentStepOutput": "..."
}
```

**Verdict**: The progress JSON is well-structured for real-time monitoring. It includes step-level status, durations, output streaming (100KB rolling buffer), and overall counts. The TUI and web dashboard both consume it effectively.

### Report Detail

The `NIGHTYTIDY-REPORT.md` includes:

| Section | Content | Sufficient? |
|---------|---------|------------|
| Run Summary | Date, duration, pass/fail counts, branch, tag | Yes |
| Step Results Table | Step number, name, status, duration, attempts | Yes |
| Failed Steps | Error message, attempt count, retry suggestion | Yes |
| Undo Instructions | Git tag name, exact reset command, Claude Code prompt | Yes |
| Narrated Changelog | AI-generated description of changes (or fallback text) | Yes |

**Verdict**: Report captures enough detail for post-run analysis. The undo section is particularly well-done — it gives both CLI and Claude Code instructions.

## Phase 3: Failure Mode Analysis

### Claude Code Unavailable

| Scenario | Detection | User Feedback | Recovery |
|----------|-----------|--------------|----------|
| Not installed | `checkClaudeInstalled()` — runs `claude --version` | Throws: "Claude Code not detected." + install URL | User installs and retries |
| Not authenticated | `checkClaudeAuthenticated()` — runs `claude -p 'Say OK'` | Falls through to interactive sign-in, then throws if that fails | User signs in |
| API outage (timeout) | 30s timeout on auth check, 45min per step | Auth: "didn't respond within 30 seconds" + status URL. Step: "timed out after 45 minutes" | Retried 3 times, then marked failed, run continues |
| Empty output | Exit code 0 but empty stdout | "Claude Code returned empty output" | Retried 3 times |
| Non-zero exit | Exit code check | "Claude Code exited with error code N" | Retried 3 times |

**Verdict**: Thorough. Every Claude Code failure mode is detected, logged, and has a clear recovery path. The 3-retry mechanism with 10s delays handles transient failures well.

### Disk Full

| Scenario | Detection | User Feedback | Recovery |
|----------|-----------|--------------|----------|
| <100 MB free (pre-check) | `checkDiskSpace()` | Throws: "Very low disk space (N MB free)" + action | User frees space |
| <1 GB free (pre-check) | `checkDiskSpace()` | Warns but continues | User is aware |
| Disk fills during run | No proactive detection | Log file write falls back to stderr. Git operations may fail with git error messages. Progress JSON write silently fails. | User sees git errors in log, can undo via safety tag |

**FINDING-02 (Medium): No mid-run disk space detection**

**Location**: `src/executor.js` step loop

If disk fills during a multi-hour run, the user gets cryptic git errors rather than a clear "disk full" message. The log file itself may fail to write (handled via stderr fallback), but the user gets no proactive warning.

**Impact**: Medium. A 4-8 hour run failing at step 30/33 due to disk space, with only a cryptic git error visible, would be frustrating.

**Fix**: Not recommended to add mid-run disk checks (YAGNI — this is a local CLI tool and disk filling during a run is rare). Instead, add a note in the troubleshooting runbook explaining this scenario and how to recover.

### Git Operations Fail

| Scenario | Detection | User Feedback | Recovery |
|----------|-----------|--------------|----------|
| Not a git repo | `checkGitRepo()` pre-check | Clear error + `git init` suggestion | User runs git init |
| No commits | `checkHasCommits()` pre-check | Clear error + commit command | User commits |
| Branch creation fails | `retryWithSuffix()` tries 10 names | "Could not create run branch" | User waits a minute |
| Tag creation fails | `retryWithSuffix()` tries 10 names | "Could not create safety tag" | User waits a minute |
| Fallback commit fails | try/catch in executor | Warning logged, step continues | Non-critical |
| Merge conflict | `mergeRunBranch()` returns `{ success: false, conflict: true }` | Detailed instructions: manual merge command + Claude Code prompt | User merges manually |

**Verdict**: Git failure modes are well-handled. The merge conflict recovery is particularly helpful with both CLI and Claude Code instructions.

### Lock File Contention

| Scenario | Detection | User Feedback | Recovery |
|----------|-----------|--------------|----------|
| Stale lock (dead PID) | `isProcessAlive()` + 24h age check | Auto-removed with warning | Automatic |
| Active lock | PID alive check | TTY: interactive override prompt. Non-TTY: error with delete instruction | User overrides or waits |
| Corrupt lock file | JSON parse failure | Treated as stale, auto-removed | Automatic |
| Race on lock cleanup | O_EXCL atomic create | Clear error message | User retries |

**Verdict**: Lock file handling is robust with multiple fallback paths.

### Notification System Failure

| Scenario | Detection | User Feedback |
|----------|-----------|--------------|
| node-notifier fails | try/catch in `notify()` | Warning logged, run continues |
| Notification daemon unavailable | Swallowed silently | No impact — fire-and-forget by design |

**Verdict**: Correctly designed as non-blocking, non-critical.

### Dashboard Failure

| Scenario | Detection | User Feedback |
|----------|-----------|--------------|
| HTTP server port conflict | `server.on('error')` handler | Info logged, falls back to TUI-only mode |
| TUI window spawn fails | try/catch | Warning logged, run continues |
| Progress file write fails | try/catch | Silently ignored (non-critical) |
| Dashboard standalone spawn fails | try/catch with timeout | Info logged, run continues without dashboard |

**Verdict**: Dashboard is correctly fire-and-forget. No dashboard failure can crash a run.

## Phase 4: Recommendations

### FINDING-01 (Low): Log environment context at startup

Add NightyTidy version, Node.js version, and OS platform to the first log line after initialization. This eliminates a troubleshooting round-trip when users share log files.

### FINDING-02 (Medium): No mid-run disk space awareness

Do NOT add mid-run disk checks (YAGNI for a local CLI tool). Instead, document this failure mode in the troubleshooting runbook so users know what cryptic git errors mean and how to recover.

### FINDING-03 (Low): No troubleshooting runbook exists

NightyTidy has excellent error messages (`docs/ERROR_MESSAGES.md`) but no runbook that maps symptoms to diagnoses. A user who sees "Claude Code exited with error code 1" may not know whether to check their API key, network, or Claude Code installation.

**Fix**: Create `docs/RUNBOOKS.md` with symptom-based troubleshooting guides.

## Findings Summary

| ID | Severity | Description | Fix |
|----|----------|-------------|-----|
| FINDING-01 | Low | No environment context (version, Node, OS) logged at startup | Add startup info line |
| FINDING-02 | Medium | Mid-run disk full produces cryptic git errors | Document in runbook (YAGNI for code fix) |
| FINDING-03 | Low | No troubleshooting runbook for common failures | Create `docs/RUNBOOKS.md` |

## Overall Assessment

NightyTidy's observability posture is **strong for a CLI tool**. The logging system covers every meaningful event with appropriate severity levels. Error messages are specific, actionable, and follow a consistent style guide. The progress JSON and dashboard provide good real-time visibility. The generated report includes all necessary post-run diagnostic information.

The main gap is the absence of a troubleshooting runbook — the error messages are good but scattered across modules. A centralized symptom-to-fix guide would significantly improve the user experience when things go wrong.

---
*Audit performed by Claude Opus 4.6 on 2026-03-09*
