# Audit #29 — Observability & Monitoring Readiness (Run #2)

**Date**: 2026-03-10
**Run Number**: 2
**Scope**: Health checks, metrics, distributed tracing, failure modes, alerting — comprehensive 5-phase audit
**Previous Audit**: 29_OBSERVABILITY_REPORT_1_2026-03-09.md

## Executive Summary

**Maturity Level**: Good (for a CLI tool)

NightyTidy is a local overnight CLI tool, not a deployed web service. Traditional observability concepts (health endpoints, APM metrics, distributed tracing) do not apply. The audit assesses whether logging, progress reporting, error handling, and failure mode documentation provide sufficient diagnostics for users.

**Detection Speed**: Immediate (pre-run checks) to real-time (progress dashboard)
**Diagnostic Capability**: Strong — comprehensive logging with 90+ log calls across 13 modules

**Top 5 Strengths**:
1. **Environment context logging** — Version, Node.js version, OS platform logged at startup (fixed since audit #1)
2. **Comprehensive pre-run checks** — 8 checks with actionable error messages and install URLs
3. **Error classification** — Rate-limit vs unknown errors with exponential backoff
4. **Troubleshooting runbook** — 296 lines of symptom-based troubleshooting (created since audit #1)
5. **Cost/token tracking** — Per-step and total cost reported in NIGHTYTIDY-REPORT.md

**Findings from Audit #1 — All Addressed**:
| Finding | Status | Resolution |
|---------|--------|------------|
| FINDING-01 (Low): No environment context at startup | ✅ FIXED | `cli.js:627`, `orchestrator.js:415` now log version, Node, OS |
| FINDING-02 (Medium): No mid-run disk detection | ✅ DOCUMENTED | Added to `docs/RUNBOOKS.md` with recovery steps |
| FINDING-03 (Low): No troubleshooting runbook | ✅ FIXED | `docs/RUNBOOKS.md` created with 13 failure scenarios |

**Current Findings**: 0 new findings. The observability posture is appropriate for the tool's architecture.

---

## Phase 1: Health Checks

### Assessment

NightyTidy is a CLI tool, not a web service. Traditional `/health` endpoints are not applicable. The equivalent is the pre-run check system.

### Pre-Run Health Checks (`src/checks.js`)

| Check | Detection | Failure Behavior | Verdict |
|-------|-----------|-----------------|---------|
| Git installed | `git --version` | Throws with install URL | ✅ |
| Git repository | `.git` folder | Throws with `git init` suggestion | ✅ |
| Has commits | `git.log()` | Throws with commit command | ✅ |
| Clean working tree | `git.status()` | Warns (non-blocking) | ✅ |
| Existing branches | `git.branch()` | Info (non-blocking) | ✅ |
| Claude Code installed | `claude --version` | Throws with install URL | ✅ |
| Claude Code authenticated | `claude -p 'Say OK'` (30s timeout) | Falls through to interactive sign-in | ✅ |
| Disk space | Platform-specific commands | Throws at <100 MB, warns at <1 GB | ✅ |

**Architecture**:
- Phase 1 runs `checkGitInstalled()` alone (must pass before any git operations)
- Phase 2 runs git chain, Claude chain, and disk check in parallel for faster startup
- All checks produce log entries on success/failure
- Error messages include actionable URLs and exact commands

**Verdict**: Pre-run health checks are comprehensive and well-designed.

### GUI Server Health (`gui/server.js`)

| Mechanism | Purpose | Configuration |
|-----------|---------|---------------|
| Heartbeat | Frontend pings `/api/heartbeat` every 5s | Server watchdog checks staleness |
| Watchdog | Detects orphaned servers when browser crashes | 15s idle threshold (ONLY checked when no processes running) |
| Safety timeout | Kills hung processes | 48 min (exceeds 45 min step timeout) |

**Critical Safeguard**: Watchdog NEVER triggers during active work (`activeProcesses.size > 0`). This prevents killing the server mid-step.

**Verdict**: GUI health monitoring is robust with appropriate safety margins.

---

## Phase 2: Metrics & Instrumentation

### Existing Instrumentation

| Category | Present | Implementation |
|----------|---------|---------------|
| Request metrics | N/A | CLI tool — no HTTP request metrics applicable |
| Business metrics | ✅ | Step completion, failure, cost, token counts |
| Dependency metrics | ✅ | Claude Code subprocess duration, exit codes |
| System/runtime metrics | Partial | Disk space checked; no memory/GC monitoring |

### Cost & Token Tracking

**Modules**: `src/claude.js`, `src/executor.js`, `src/report.js`

```javascript
// CostData structure
{
  costUSD: number,       // Total cost in USD
  inputTokens: number,   // Input tokens (including cache)
  outputTokens: number,  // Output tokens
  numTurns: number,      // Conversation turns
  durationApiMs: number, // API call duration
  sessionId: string,     // For --continue
}
```

**Aggregation**:
- `sumCosts()` in `executor.js` combines costs from improvement + doc-update calls
- Per-step costs shown in NIGHTYTIDY-REPORT.md table
- Total cost shown in run summary

**Format**: `formatCost()` renders as `$0.1234`

**Verdict**: Cost/token tracking is well-implemented for the use case. Traditional APM metrics are not applicable.

---

## Phase 3: Distributed Tracing & Correlation

### Assessment

**Not applicable**. NightyTidy is a single-instance local CLI tool. There are no distributed services, no multi-hop requests, no need for correlation IDs or trace propagation.

### Existing Logging Correlation

Each log entry includes:
- ISO 8601 timestamp
- Log level (DEBUG/INFO/WARN/ERROR)
- Message with context (step number, attempt count, duration)

Example:
```
[2026-03-10T14:48:00.000Z] [INFO ] Running Claude Code: Step 1 — Documentation (attempt 1/4)
[2026-03-10T14:48:05.000Z] [DEBUG] Spawn mode: -p flag, prompt length: 2847 chars
[2026-03-10T14:53:42.000Z] [INFO ] Claude Code completed: Step 1 — Documentation — 342s
```

**Verdict**: Log format provides sufficient correlation for single-instance CLI debugging.

---

## Phase 4: Failure Mode Analysis & Runbooks

### Dependency Matrix

| Dependency | Down Impact | Slow Impact | Timeout? | Retry? | Circuit Breaker? | Graceful Degradation? |
|------------|-------------|-------------|----------|--------|-----------------|----------------------|
| Git | Blocks run (pre-check) | N/A (local) | No | No | N/A | N/A |
| Claude Code CLI | Blocks run (pre-check) | Step timeout | 45 min | 3× + 10s delay | No | No |
| Anthropic API | Step fails | Step timeout | 45 min | 3× (skips for rate limits) | No | Run continues with failed step |
| Disk space | Blocks run (<100MB) | N/A | No | No | N/A | Warning at <1GB |
| Dashboard server | Non-critical | Non-critical | 30s request | No | No | TUI fallback |
| Notifications | Non-critical | N/A | N/A | No | N/A | Silent failure |

### Runbook Coverage (`docs/RUNBOOKS.md`)

**296 lines** covering 13 failure scenarios:

| Category | Scenarios Covered |
|----------|------------------|
| Pre-run | Git not found, not a repo, Claude not installed, auth timeout, disk space |
| Step execution | Step fails repeatedly, step timeout |
| Mid-run | Disk fills, lock conflict, interrupted run |
| Post-run | Merge conflict |
| UI | Notifications not working, dashboard issues |
| Orchestrator | State file issues |

Each runbook includes:
- **Symptom**: Exact error message or behavior
- **Diagnosis**: Root cause explanation
- **Fix**: Step-by-step resolution (CLI commands + Claude Code prompts)

**Debug Tips Section**:
- Enable debug logging: `NIGHTYTIDY_LOG_LEVEL=debug`
- Log file format and quick searches (`[ERROR]`, `[WARN ]`, `completed`)
- Complete undo instructions with safety tag

**Verdict**: Runbook coverage is comprehensive and actionable.

### Error Classification (`src/claude.js`)

```javascript
// Rate-limit detection patterns
const RATE_LIMIT_PATTERNS = [
  /429/i, /rate.?limit/i, /quota/i, /exceeded/i, /overloaded/i,
  /capacity/i, /too many requests/i, /usage.?limit/i, /throttl/i,
  /billing/i, /plan.?limit/i,
];
```

**Error Types**:
- `rate_limit` — Skips internal retries, triggers exponential backoff (2min → 2hr cap)
- `unknown` — Uses standard retry logic (3× with 10s delays)

**Recovery Tiers** (orchestrator mode):
1. Normal execution (4 internal retries)
2. PROD: `--continue` to resume killed session
3. Fresh retry with new session

**Verdict**: Error classification and recovery are sophisticated and well-designed.

---

## Phase 5: Alerting Surface Area

### Existing Alerts

**Not applicable for traditional alerting** (Prometheus, PagerDuty, etc.). NightyTidy is a local CLI tool — failures are surfaced immediately to the user.

### Notification System (`src/notifications.js`)

| Event | Notification |
|-------|-------------|
| Run started | "Running N steps. Check nightytidy-run.log for progress." |
| Step failed | "Step N (Name) failed after N attempts. Skipped — run continuing." |
| Run complete | "All N steps succeeded" or "N/M succeeded, N failed" |
| Merge conflict | "Changes are on branch X. See NIGHTYTIDY-REPORT.md for resolution steps." |

**Design**: Fire-and-forget. Notification failures are swallowed silently (try/catch in `notify()`).

### Progress Monitoring

| Mechanism | Update Frequency | Data |
|-----------|-----------------|------|
| Progress JSON | 500ms throttled | Step status, duration, output (100KB rolling buffer) |
| SSE events | Real-time | State changes, output chunks |
| Log file | Every event | Full detail with timestamps |

**Verdict**: Alerting is appropriate for the tool's architecture. Desktop notifications + real-time dashboard provide adequate visibility.

---

## Findings Summary

**No new findings**. All findings from audit #1 have been addressed:

| ID | Severity | Description | Status |
|----|----------|-------------|--------|
| FINDING-01 | Low | No environment context at startup | ✅ FIXED |
| FINDING-02 | Medium | No mid-run disk detection | ✅ DOCUMENTED |
| FINDING-03 | Low | No troubleshooting runbook | ✅ FIXED |

---

## Recommendations

The observability posture is appropriate for NightyTidy's architecture as a local CLI tool. No additional changes are recommended at this time.

**Potential future enhancements** (not currently recommended — YAGNI):
- Memory/GC monitoring for very large codebases (would add complexity for marginal benefit)
- Structured JSON logging mode (would require logger refactoring; current format is sufficient)
- Metrics export for external dashboards (no use case — tool runs locally)

---

## Overall Assessment

NightyTidy's observability posture is **appropriate and well-designed for its architecture**:

1. **Pre-run checks** verify all dependencies with actionable error messages
2. **Logging** covers 90+ events across 13 modules with appropriate severity levels
3. **Error classification** distinguishes rate limits from other failures
4. **Recovery mechanisms** include exponential backoff, session continuation, and fresh retries
5. **Runbook documentation** covers 13 failure scenarios with step-by-step resolution
6. **Cost tracking** provides transparency on API usage

The tool meets the observability needs of its target users (vibe coders at small companies running overnight improvements).

---

*Audit performed by Claude Opus 4.5 on 2026-03-10*
