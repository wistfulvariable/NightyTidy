# NightyTidy Observability & Monitoring Readiness Audit — Run #03

**Date**: 2026-03-12
**Auditor**: Claude Code
**Scope**: Full observability assessment of the NightyTidy CLI tool

---

## 1. Executive Summary

### Maturity Level: **GOOD to EXCELLENT**

NightyTidy is a **CLI orchestration tool** (not a web service), so traditional web observability patterns (HTTP health endpoints, Prometheus metrics, distributed tracing) are **not applicable**. The tool's observability posture is well-suited to its architecture and target users (vibe coders at small companies).

| Dimension | Rating | Notes |
|-----------|--------|-------|
| Health Checks | ✅ Excellent | 8 pre-run validations + heartbeat mechanism |
| Metrics & Instrumentation | ✅ Good | Cost/token/duration tracking with no gaps for CLI scope |
| Logging | ✅ Excellent | 90+ log calls, ISO timestamps, 4 levels, file + stdout |
| Error Classification | ✅ Excellent | Rate-limit detection (11 patterns) + retry extraction |
| Progress Monitoring | ✅ Excellent | Multi-layer (JSON file + HTTP/SSE + TUI fallback) |
| Runbooks | ✅ Excellent | 296-line symptom-indexed troubleshooting guide |
| Failure Recovery | ✅ Excellent | 3-tier step recovery, session continuation, branch guards |
| Alerting | ⚠️ Appropriate | Desktop notifications only (no external integrations) |

### Detection Speed
- **Pre-run failures**: Immediate (< 30s validation)
- **Step failures**: Real-time via progress JSON + SSE
- **Rate limits**: Immediate detection with exponential backoff

### Diagnostic Capability
- **Root cause identification**: Good (error classification + detailed logs)
- **Investigation path**: Clear (log file + progress JSON + git history)

### Top 5 Observations (not gaps)

1. **Appropriate scope**: No HTTP health endpoints because this is not a web service
2. **Comprehensive logging**: 90+ log calls across 13 modules with consistent formatting
3. **Strong error handling**: Every module has a documented error contract
4. **Mature runbooks**: 13 failure scenarios with symptom-based diagnosis
5. **Robust progress monitoring**: Real-time updates via SSE with TUI fallback

---

## 2. Health Checks

### Before/After State

**This is a CLI tool — HTTP health endpoints are not applicable.**

### Equivalent: Pre-Run Validation (`src/checks.js`)

| Check | What It Validates | Blocking? |
|-------|------------------|-----------|
| Git installed | `git --version` succeeds | Yes |
| Git repository | `.git` folder exists | Yes |
| Has commits | At least one commit exists | Yes |
| Clean working tree | No uncommitted changes | No (warns) |
| Existing branches | NightyTidy branches from previous runs | No (info) |
| Claude Code installed | `claude --version` succeeds | Yes |
| Claude Code authenticated | `claude -p 'Say OK'` returns output | Yes |
| Disk space | > 100 MB free (warns at < 1 GB) | Yes (< 100 MB) |

### GUI Server Heartbeat (`gui/server.js`)

| Mechanism | Implementation | Purpose |
|-----------|---------------|---------|
| Frontend ping | `/api/heartbeat` every 5s | Detect orphaned servers |
| Watchdog timer | 15s idle threshold | Auto-shutdown when browser crashes |
| Process safety | Watchdog skipped when `activeProcesses.size > 0` | Never kill during active work |
| Process timeout | 48 minutes (exceeds 45-min step timeout) | Force-kill hung processes |

### Assessment

The health check system is **comprehensive for a CLI tool**:
- Pre-run checks validate all critical dependencies before any work starts
- Failures provide actionable error messages (see `docs/ERROR_MESSAGES.md`)
- GUI server has defense-in-depth against stale state

**No improvements needed.**

---

## 3. Metrics & Instrumentation

### Coverage Matrix

| Category | Present? | Implementation |
|----------|----------|----------------|
| **Request metrics** | N/A | CLI tool — no HTTP request metrics |
| **Business metrics** | ✅ | Step completion/failure counts, cost tracking |
| **Dependency metrics** | ✅ | Claude Code subprocess duration, exit codes, error classification |
| **System metrics** | Partial | Disk space at startup; no continuous monitoring |
| **Cost tracking** | ✅ | Per-step and total cost in USD |
| **Token tracking** | ✅ | Input/output tokens per step |
| **Duration tracking** | ✅ | Per-attempt, per-step, total run duration |

### Cost & Token Data Structure (`src/claude.js`)

```javascript
{
  costUSD: number,           // Total cost in USD
  inputTokens: number,       // Input tokens (including cache)
  outputTokens: number,      // Output tokens
  numTurns: number,          // Conversation turns
  durationApiMs: number,     // API call duration in ms
  sessionId: string,         // For --continue session recovery
}
```

### Metrics in Reports

The `NIGHTYTIDY-REPORT.md` includes:
- Per-step: status, duration, attempts, cost
- Total: duration, completed/failed counts, total cost, total tokens
- All metrics are human-readable (formatted with K/M suffixes)

### What Was Added

**Nothing** — the existing instrumentation is comprehensive for a CLI tool.

### What Would Require Infrastructure Changes

| Potential Addition | Infra Required | Worth It? |
|-------------------|----------------|-----------|
| Prometheus metrics export | Prometheus server | No — CLI runs overnight, no scraping target |
| StatsD/DataDog integration | StatsD daemon | No — overkill for local CLI tool |
| Memory/GC monitoring | Node.js `--inspect` | No — overnight runs, marginal benefit |

---

## 4. Distributed Tracing & Correlation

### Assessment

**Distributed tracing is not applicable to NightyTidy.**

NightyTidy is a single-instance CLI tool that:
- Runs in one process (spawns Claude Code as a subprocess)
- Has no microservices architecture
- Has no downstream service calls (Claude Code handles API calls internally)
- Does not process concurrent requests

### Correlation Mechanisms Present

| Mechanism | Implementation |
|-----------|----------------|
| Timestamp correlation | ISO 8601 timestamps on every log line |
| Step identification | Step number + name in all log messages |
| Git correlation | Branch name, tag, commit hashes tracked |
| Session correlation | Claude Code `sessionId` tracked for `--continue` |

### Example Log Correlation

```
[2026-03-12T02:15:00.000Z] [INFO ] Running Claude Code: Step 1 — Documentation (attempt 1/4)
[2026-03-12T02:15:05.000Z] [DEBUG] Spawn mode: -p flag, prompt length: 2847 chars
[2026-03-12T02:20:42.000Z] [INFO ] Claude Code completed: Step 1 — Documentation — 342s
```

All log entries for a step share the same step name/number, making grep-based correlation trivial.

### Remaining Gaps

**None** — a correlation ID is unnecessary for a single-instance tool with sequential execution.

---

## 5. Failure Mode Analysis

### Dependency Matrix

| Dependency | Down Impact | Slow Impact | Timeout? | Retry? | Circuit Breaker? | Graceful Degradation? |
|------------|-------------|-------------|----------|--------|------------------|----------------------|
| Git | Blocks run | N/A | 30s | No | N/A | N/A |
| Claude Code CLI | Blocks run | Step timeout | 45 min | 4 attempts | No | Yes (skip step) |
| Anthropic API | Step fails | Step timeout | Via CLI | Via CLI | Rate-limit pause | Yes (continue with failures) |
| Disk space | Blocks run (<100MB) | N/A | No | No | N/A | Warns at <1GB |
| Dashboard | Non-critical | Non-critical | 30s | No | N/A | TUI fallback |
| Notifications | Non-critical | N/A | N/A | No | N/A | Silent fail |

### Critical Code Paths

| Path | Failure Points | Detection | Recovery |
|------|---------------|-----------|----------|
| Pre-run validation | Any check fails | Immediate throw | Clear error message + fix instructions |
| Step execution | Claude Code timeout/error | Exit code + stderr | 4 retries + 3-tier recovery |
| Rate limiting | API 429 response | Pattern match on stderr | Exponential backoff (2min → 2hr) |
| Git operations | Disk full, permission denied | Git error message | Branch preserved, safety tag available |
| Report generation | Claude Code failure | Output validation | Fallback narration |
| Merge | Conflict | Git merge exit code | Manual merge instructions |

### Runbooks

Existing runbook coverage in `docs/RUNBOOKS.md`:

| Category | Scenarios Covered |
|----------|-------------------|
| Pre-Run | Git not found, not a repo, Claude not installed, auth timeout, disk space, lock conflict |
| Execution | Step fails repeatedly, timeout, inactivity timeout |
| Mid-Run | Disk fills, lock conflict, interrupted run recovery |
| Post-Run | Merge conflict, recovery options |
| UI | Notifications, dashboard failures |
| Orchestrator | State file issues |

**Each runbook includes**: Symptom → Diagnosis → Fix → Escalation

### Assessment

The runbook is **comprehensive** (296 lines, 13 failure scenarios). No additions needed.

---

## 6. Alerting Surface Area

### Existing Alerts

| Alert Type | Implementation | Trigger |
|------------|---------------|---------|
| Desktop notification — start | `node-notifier` | Run begins |
| Desktop notification — failure | `node-notifier` | Any step fails |
| Desktop notification — completion | `node-notifier` | Run finishes |
| Dashboard visual | SSE + HTML | Real-time status changes |
| Log file | File + stdout | All events |

### Recommended Alert Definitions (If External Integration Added)

**Note**: These are informational only — no external alerting infrastructure exists or is needed for a local CLI tool.

| Alert Name | Condition | Threshold | Severity |
|------------|-----------|-----------|----------|
| Run timeout exceeded | Total run duration > expected | > 8 hours for 33 steps | Warning |
| High failure rate | Failed steps / total > threshold | > 30% | Warning |
| Rate limit spiral | Consecutive rate limits | > 3 consecutive | Critical |
| Disk space critical | Free space during run | < 100 MB | Critical |
| Cost anomaly | Total cost > budget | > $50/run | Warning |
| Inactivity death spiral | Consecutive inactivity kills | > 2 per step | Critical |

### Current Gaps

**None that matter** — external alerting integration (PagerDuty, OpsGenie, etc.) would be over-engineering for a local overnight tool. Desktop notifications are the appropriate alerting mechanism.

---

## 7. Recommendations

### Priority-Ordered Improvements

| # | Recommendation | Infra Required | Effort | Worth Doing? |
|---|----------------|---------------|--------|--------------|
| 1 | None | N/A | N/A | N/A |

**The observability posture is already well-suited to the tool's architecture.**

### Quick Wins Already Present

- ✅ Comprehensive pre-run validation
- ✅ Error classification with rate-limit detection
- ✅ Multi-layer progress monitoring (JSON + HTTP + TUI)
- ✅ Detailed runbook documentation
- ✅ Session continuation for recovery
- ✅ Branch guards for drift detection
- ✅ Cost/token tracking per step

### Infrastructure/Tooling Recommendations

**None** — adding Prometheus, distributed tracing, or external alerting would be over-engineering for a CLI tool that:
- Runs overnight, unattended
- Has a single user (the developer)
- Operates on localhost only
- Already has comprehensive logging

### On-Call Practices

Not applicable — NightyTidy is a local CLI tool, not a production service. The existing runbook provides self-service troubleshooting.

---

## 8. Conclusion

NightyTidy has **excellent observability for a CLI tool**. The key insight is that web-service observability patterns (health endpoints, Prometheus metrics, distributed tracing) are **not applicable** here.

The tool excels at:
1. **Pre-flight validation**: 8 checks catch problems before work starts
2. **Error recovery**: 3-tier recovery, rate-limit detection, session continuation
3. **Progress visibility**: Real-time JSON + SSE + TUI with 100KB rolling buffer
4. **Troubleshooting**: 296-line symptom-indexed runbook
5. **Audit trail**: Detailed logs with ISO timestamps, git history preserved

**No code changes recommended.** The current implementation follows the architecture principle "right-size observability to the deployment model."

---

*Generated by NightyTidy Observability Audit — Run #03*
