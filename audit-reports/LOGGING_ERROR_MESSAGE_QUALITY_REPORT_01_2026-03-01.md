# Logging & Error Message Quality Report

**Run**: 01 | **Date**: 2026-03-01 | **Branch**: `message-quality-2026-03-01`

---

## 1. Executive Summary

| Metric | Count |
|--------|-------|
| User-facing error messages audited | 22 |
| User-facing messages improved | 3 |
| Developer-facing log statements audited | 42 |
| Developer-facing messages improved | 4 |
| Sensitive data exposures found | 0 |
| Error handlers audited | 12 |
| Error handlers improved | 1 |
| Log level corrections | 0 |
| Tests updated | 1 |
| All tests passing | Yes (136/136) |

**Overall assessment**: The codebase has strong messaging quality — the best messages (checks.js errors, CLI abort/conflict guidance) follow a clear `[What happened] + [Why] + [What to do]` pattern with copy-paste-ready commands. Six messages in `claude.js` and `report.js` leaked developer jargon or lacked actionable recovery guidance. All six were improved.

---

## 2. User-Facing Error Messages

### Leaked Internals Fixed

| File | Line | Was | Now | Risk |
|------|------|-----|-----|------|
| `src/claude.js` | 80 | `Exit code ${code}` | `Claude Code exited with error code ${code}` | Dev jargon surfacing in reports and logs |
| `src/claude.js` | 80 | `Empty output` | `Claude Code returned empty output` | Ambiguous bare phrase |
| `src/claude.js` | 104 | `Failed to spawn claude process` | `Failed to start Claude Code. Ensure the "claude" command is installed and on your PATH.` | No recovery guidance |

### Critical-Path Improvements

All critical-path messages (pre-run checks in `checks.js`) were already well-written with specific problems and actionable recovery. No changes needed.

### Generic Messages Replaced

| File | Line | Was | Now |
|------|------|-----|-----|
| `src/report.js` | 33-34 | `...couldn't be generated this time - check nightytidy-run.log for more information.` | `...could not be generated - this typically happens when Claude Code is under heavy load. Try re-running the changelog step individually if needed.` |
| `src/report.js` | 74 | `Unknown error` | `No error details available` |

### Messages Still Needing Work

None identified. All user-facing messages now meet the audit criteria.

### Reference

Full message catalog: [docs/ERROR_MESSAGES.md](../docs/ERROR_MESSAGES.md)

---

## 3. Sensitive Data in Logs (CRITICAL)

**No sensitive data exposure found.**

The codebase does not handle secrets, API keys, passwords, PII, or payment data. Claude Code manages its own authentication. Log messages contain only operational data (step names, branch names, durations, file paths within the target project).

The one potential vector — `warn(`Claude Code warning output: ${text}`)` forwarding Claude's stderr — could theoretically contain sensitive data from Claude Code's internal output, but this is at `warn` level (appropriate for debugging) and is not under NightyTidy's control.

---

## 4. Log Level Corrections

No misleveled logs found. The log level usage is consistent and appropriate:

| Level | Usage | Assessment |
|-------|-------|------------|
| ERROR | Unhandled rejection, fatal errors, step failures after all retries | Correct — only true failures needing attention |
| WARN | Recoverable issues (disk space, Windows fallback, doc update skip, Claude stderr) | Correct — degraded but continuing |
| INFO | Pre-check passes, step start/complete, branch/tag creation, report written | Correct — lifecycle events |
| DEBUG | Spawn mode details, merge error details, welcome marker failure | Correct — diagnostic only |

---

## 5. Log Message Quality Improvements

### Context-Poor Messages Improved

| File | Line | Was | Now | Reason |
|------|------|-----|-----|--------|
| `src/claude.js` | 62 | `Claude stderr: ${text}` | `Claude Code warning output: ${text}` | "stderr" is OS-level jargon; target audience is vibe coders |
| `src/claude.js` | 99 | `Claude Code spawned with shell: true (Windows fallback)` | `Claude Code started using shell mode (Windows compatibility)` | "spawned with shell: true" is Node.js API jargon |
| `src/claude.js` | 112 | `Claude Code ENOENT - retrying with shell: true (Windows fallback)` | `Claude Code command not found - retrying with shell mode (Windows)` | ENOENT is POSIX jargon |
| `src/claude.js` | 138 | `Claude Code completed: ${label} - exit code ${result.exitCode}, ${duration}s` | `Claude Code completed: ${label} - ${duration}s` | Exit code 0 in success path is noise |

### Unhandled Rejection Logging

| File | Line | Was | Now | Reason |
|------|------|-----|-----|--------|
| `src/cli.js` | 158 | `Unhandled rejection: ${reason}` | `Unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}` | Raw Error objects log as `Error: msg` (redundant prefix); plain objects log as `[object Object]` |

### Log Noise Removed

Exit code removed from success-path info log (`claude.js:138`). On success, exit code is always 0 — logging it adds noise without information. Non-zero exit codes are still visible in the error message on failure paths.

---

## 6. Error Handler Assessment

| Handler | Location | Differentiates Types? | Logs Properly? | Reference ID? | Sanitizes Response? |
|---------|----------|----------------------|----------------|--------------|-------------------|
| Top-level try/catch | `cli.js:277` | Yes (thrown errors vs runtime) | Yes (ERROR + DEBUG stack) | N/A (CLI) | Yes (shows err.message only) |
| Unhandled rejection | `cli.js:157` | No (catches all) | Yes (ERROR) | N/A | Yes (generic user message) |
| SIGINT handler | `cli.js:167` | Yes (first vs second) | Implicit (abort signal) | N/A | Yes (user-friendly messages) |
| Child timeout | `claude.js:42` | Yes (timeout-specific) | Via result object | N/A | Yes |
| Child error event | `claude.js:65` | No (wraps err.message) | Via result object | N/A | Yes |
| Spawn failure | `claude.js:91` | Yes (Windows vs other) | Via result object | N/A | Yes (improved) |
| Windows ENOENT fallback | `claude.js:111` | Yes (ENOENT-specific) | WARN | N/A | Yes (improved) |
| Merge conflict | `git.js:82` | Yes (conflict-specific) | WARN + DEBUG | N/A | Yes (returns indicator) |
| Notification failure | `notifications.js:13` | No (swallows all) | WARN | N/A | N/A (silent) |
| Report write failure | `report.js:154` | No (wraps err.message) | WARN | N/A | N/A (non-blocking) |
| Welcome marker failure | `cli.js:135` | No (swallows all) | DEBUG | N/A | N/A (non-critical) |
| Report commit failure | `cli.js:267` | No (wraps err.message) | WARN | N/A | N/A (non-blocking) |

**Assessment**: Error handlers are well-designed. Each module follows its documented error contract (CLAUDE.md). The architecture correctly differentiates between:
- **Fatal errors** (checks.js throws) vs **recoverable failures** (claude.js returns result objects)
- **User-visible errors** (console.error with chalk) vs **log-only details** (logger functions)
- **Blocking failures** (pre-checks) vs **non-blocking failures** (notifications, doc updates)

**Reference IDs**: Not applicable — this is a CLI tool, not a server. Users have direct access to `nightytidy-run.log` for full context.

---

## 7. Consistency Findings

### Error Codes

The project does not use machine-readable error codes (`CARD_DECLINED`, etc.). This is appropriate for a CLI tool — error messages are the primary interface, and the result objects in `claude.js`/`executor.js` serve as structured error data internally.

### Log Format

Consistent across the codebase:
- Single logging library (`src/logger.js`) used by all modules
- Format: `[ISO-timestamp] [LEVEL] message`
- Chalk coloring for stdout: dim=debug, white=info, yellow=warn, red=error
- No raw `console.log` in production code except `cli.js` terminal UX (per project convention)

### Field Naming

Consistent in result objects:
- `{ success, output, error, exitCode, duration, attempts }` — claude.js
- `{ step: { number, name }, status, output, duration, attempts, error }` — executor.js
- `{ success, conflict }` — git.js mergeRunBranch

### Standardization Changes Made

- Replaced 3 instances of developer jargon (`ENOENT`, `stderr`, `shell: true`) with user-friendly equivalents
- No raw `console.*` replacement needed — project already uses logger consistently
- No error code system recommended — not appropriate for CLI tool scope

---

## 8. Logging Infrastructure Recommendations

### Current State

NightyTidy's logging infrastructure is minimal but appropriate for its scope:
- File + stdout dual output via `src/logger.js` (~50 LOC)
- Level filtering via `NIGHTYTIDY_LOG_LEVEL` env var
- No structured logging (plain text)
- No log correlation/request IDs (single-threaded CLI — not needed)
- No centralized redaction framework (no sensitive data handled)

### Gaps Documented (Not Implemented)

| Gap | Impact | Recommended? |
|-----|--------|-------------|
| Structured logging (JSON) | Would enable log aggregation if NightyTidy becomes a service | No — YAGNI for CLI tool |
| Log rotation | Log file grows unbounded across runs | Low priority — file is overwritten each run (`writeFileSync` in initLogger) |
| Request/correlation IDs | Would help trace multi-step failures | No — single sequential flow makes this unnecessary |
| Centralized redaction | Would prevent accidental PII logging | No — tool doesn't handle PII |
| Hot-path sampling | Would reduce log volume | No — no hot paths (each step runs once) |

---

## 9. Bugs Discovered

No bugs found during this audit. The investigation of error handling paths confirmed:

- All error contracts are correctly implemented per CLAUDE.md documentation
- No swallowed errors that should surface (notifications.js swallowing is intentional and documented)
- No incorrect status codes (CLI exits with 0 for success/user-abort, 1 for errors — correct)
- No hidden failures — failed steps are correctly recorded and reported

One **minor code quality note**: The `unhandledRejection` handler at `cli.js:157` used raw template literal coercion for the `reason` parameter, which could produce unhelpful output (`[object Object]`) for non-Error rejections. This was improved to use `instanceof Error` check for better formatting.
