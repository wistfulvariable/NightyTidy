# Audit #16 — Logging & Error Message Quality

**Date**: 2026-03-09 | **Auditor**: Claude Opus 4.6

---

## 1. Executive Summary

| Metric | Count |
|--------|-------|
| User-facing error messages audited | 32 |
| User-facing messages improved | 5 |
| Developer-facing log statements audited | 62 |
| Developer-facing messages improved | 4 |
| Sensitive data exposures found | 0 |
| Error handlers audited | 14 |
| Error handlers with issues | 2 |
| Log level corrections | 2 |
| GUI error messages audited | 12 |
| GUI messages improved | 3 |

**Overall assessment**: The codebase's messaging quality remains strong. Previous audits addressed most critical issues. This audit found: (1) two GUI error messages that leak raw JS error objects, (2) missing context in two orchestrator log messages, (3) two log level mismatches in dashboard code, (4) the ERROR_MESSAGES.md is missing GUI and orchestrator sections, and (5) the `--timeout` validation message uses `"Invalid"` phrasing, violating the style guide.

---

## 2. Phase 1: User-Facing Error Messages

### Leaked Internals

| File | Line | Issue | Severity |
|------|------|-------|----------|
| `gui/resources/app.js` | 87 | `result.error || 'Command failed'` — `result.error` is raw `err.message` from Node spawn which can include `ENOENT`, stack traces | Medium |
| `gui/resources/app.js` | 93 | `(parsed.error || 'CLI failed') + detail` where `detail` is raw stderr — may include subprocess internals | Medium |
| `gui/resources/app.js` | 110 | `err.message || err` — raw JS error, could show `TypeError: Cannot read properties...` to GUI user | Medium |

### Critical-Path Messages

All pre-check error messages in `checks.js` continue to follow the `[What happened] + [Why] + [What to do]` pattern. No changes needed.

### Blame-Attributing Messages

| File | Line | Was | Should Be | Reason |
|------|------|-----|-----------|--------|
| `src/cli.js` | 286 | `--timeout must be a positive number of minutes (got "${opts.timeout}")` | `--timeout expects a positive number of minutes. Got: "${opts.timeout}". Example: --timeout 60` | Uses implicit "you gave wrong input" tone; style guide says "Expected format: ..." |

### Generic/Unhelpful Messages

| File | Line | Message | Issue |
|------|------|---------|-------|
| `gui/resources/app.js` | 207 | `'Failed to initialize run'` | Reasonable fallback for JSON-parsed error |

### Messages Verified As Good

- All `checks.js` messages: specific, actionable, blame-free, include URLs
- All `lock.js` messages: specific about PID/timestamp, include recovery steps
- All `claude.js` result messages: describe what happened without internals
- All `orchestrator.js` error returns: specific about what command to run
- `dashboard-html.js` error fallback: `'No error details available'` (improved in previous audit)

---

## 3. Phase 2: Developer-Facing Log Messages

### Log Level Assessment

All 62 log statements across `src/` modules were audited:

| Level | Count | Assessment |
|-------|-------|------------|
| `debug()` | 12 | All appropriate — diagnostics, spawn modes, lock PIDs |
| `info()` | 28 | All appropriate — operations, completions, pre-check results |
| `warn()` | 16 | 14 appropriate; 2 should be `debug()` (see below) |
| `error()` / `logError()` | 6 | All appropriate — unexpected failures, exhausted retries |

### Log Level Corrections Needed

| File | Line | Current | Should Be | Reason |
|------|------|---------|-----------|--------|
| `src/dashboard.js` | 161 | `warn('Dashboard server could not start: ...')` | `info()` | Dashboard failure is expected/graceful (TUI fallback works); CLAUDE.md documents dashboard as "swallows all errors silently". A warn implies degradation but the system continues perfectly fine via TUI. However, the user should know — `info` is appropriate. |
| `src/orchestrator.js` | 163 | `warn('Dashboard server did not respond in time...')` | `info()` | Same rationale — dashboard is non-critical, orchestrator continues fine. |

### Missing Context in Log Messages

| File | Line | Current | Improvement | Reason |
|------|------|---------|-------------|--------|
| `src/orchestrator.js` | 369 | `info('Generating narrated changelog...')` | `info('Orchestrator: generating narrated changelog...')` | Inconsistent with other orchestrator log messages which all use `Orchestrator:` prefix |
| `src/orchestrator.js` | 375 | `warn('Narrated changelog generation failed — using fallback text')` | `warn('Orchestrator: narrated changelog generation failed — using fallback text')` | Same prefix consistency issue |

### Sensitive Data Check

**No sensitive data in logs.** Same assessment as previous audits:
- No API keys, tokens, passwords, or PII logged anywhere
- `claude.js` stderr forwarding (`warn("Claude Code warning output: ...")`) is the only vector; appropriately logged at `warn`
- Lock file logs PID (public info, not sensitive)
- Dashboard logs URL with localhost port (non-sensitive)

---

## 4. Phase 3: Error Handler Audit

### Contract Verification

All 14 error handlers verified against CLAUDE.md documented contracts:

| Handler | Location | Contract | Compliant? | Notes |
|---------|----------|----------|------------|-------|
| Top-level try/catch | `cli.js:513` | Catches everything | Yes | Logs ERROR + DEBUG stack |
| Unhandled rejection | `cli.js:327` | Safety net | Yes | Logs ERROR |
| SIGINT handler | `cli.js:337` | 1st = graceful, 2nd = force | Yes | |
| Abort path commit | `cli.js:122` | Non-critical | Yes | Logs DEBUG |
| Child timeout | `claude.js:76-82` | Returns result | Yes | |
| Child error event | `claude.js:109-115` | Returns result | Yes | |
| Spawn failure | `claude.js:141-145` | Returns result | Yes | |
| Retry exhaustion | `claude.js:195` | Returns result | Yes | Logs ERROR |
| Merge conflict | `git.js:123-139` | Returns `{ success, conflict }` | Yes | Logs WARN + DEBUG |
| Notification failure | `notifications.js:13-15` | Swallows errors | Yes | Logs WARN |
| Report write | `report.js:161-163` | Warns, never throws | Yes | Logs WARN |
| Dashboard failures | `dashboard.js` (multiple) | Swallows errors | Yes | Logs WARN |
| Orchestrator | `orchestrator.js:267-269` | Returns `{ success: false, error }` | Yes | |
| Lock contention | `lock.js:86-108` | Throws with user-friendly message | Yes | |

### Error Handler Issues

| File | Location | Issue | Severity |
|------|----------|-------|----------|
| `gui/server.js:121-124` | `handleSelectFolder` catch | Silently returns `{ ok: true, folder: null }` even on non-cancellation errors — user gets no feedback if dialog fails vs. was cancelled | Low |
| `gui/server.js:77-80` | `serveStatic` catch | Returns generic `'Not found'` for any file read error (permissions, etc.) | Low |

Both are low severity because the GUI server is a local-only process and these error paths are non-critical.

---

## 5. Phase 4: Consistency

### Log Format

Consistent across all `src/` modules:
- Single logger (`logger.js`), format: `[ISO-timestamp] [LEVEL] message`
- chalk coloring: dim for debug, white for info, yellow for warn, red for error
- All modules import named exports: `{ info, debug, warn, error as logError }`

### Log Message Prefixes

| Module | Prefix Pattern | Consistent? |
|--------|---------------|-------------|
| `checks.js` | `Pre-check: ...` | Yes |
| `claude.js` | `Claude Code ...` / `Running Claude Code: ...` | Yes |
| `executor.js` | `Step N: StepName — ...` | Yes |
| `orchestrator.js` | `Orchestrator: ...` / `NightyTidy orchestrator: ...` | **No** — two prefix styles |
| `git.js` | `Created ...` / `Merged ...` / `Step N: ...` | Yes |
| `lock.js` | No prefix | OK (module context is clear) |
| `dashboard.js` | `Dashboard ...` | Yes |

**Issue**: `orchestrator.js` uses both `NightyTidy orchestrator:` (line 203) and `Orchestrator:` (lines 258, 301, 360, 417). Should standardize to `Orchestrator:` (shorter, consistent with other modules' brevity).

### Console Output Consistency (CLI terminal)

- Success: `chalk.green` with checkmark
- Warning/partial: `chalk.yellow` with warning emoji
- Error: `chalk.red` with cross emoji
- Info/dim: `chalk.dim` for secondary info
- Consistent across `cli.js` — no issues found.

### GUI Error Message Consistency

The GUI uses `showError(screenPrefix, message)` consistently across all 5 screens. Error messages are displayed in red error boxes. The pattern is consistent but some messages could be more user-friendly (see Phase 1 findings).

---

## 6. Recommended Actions

### Must Fix (message quality)

1. **`cli.js:286`**: Rephrase `--timeout` validation to follow style guide
2. **`orchestrator.js:203`**: Standardize prefix from `NightyTidy orchestrator:` to `Orchestrator:`
3. **`orchestrator.js:369,375`**: Add `Orchestrator:` prefix for consistency

### Should Fix (log levels)

4. **`dashboard.js:161`**: Change `warn` to `info` for dashboard server startup failure
5. **`orchestrator.js:163`**: Change `warn` to `info` for dashboard timeout

### Nice to Have (GUI polish)

6. **`gui/resources/app.js:87,93`**: Wrap raw error messages with user-friendly prefix
7. **`gui/resources/app.js:110`**: Catch folder selection errors more gracefully

### Documentation

8. **`docs/ERROR_MESSAGES.md`**: Add GUI and Orchestrator sections
9. **`docs/ERROR_MESSAGES.md`**: Update step count reference from 28 to 33

---

## 7. Bugs Discovered

No bugs found. All error handlers behave as documented. The findings are purely about message quality and consistency.

---

## 8. Changes Applied

See git commit for all changes applied during this audit.
