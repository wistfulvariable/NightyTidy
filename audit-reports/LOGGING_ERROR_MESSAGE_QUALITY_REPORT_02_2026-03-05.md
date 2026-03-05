# Logging & Error Message Quality Report

**Run**: 02 | **Date**: 2026-03-05 | **Branch**: `message-quality-2026-03-05`

---

## 1. Executive Summary

| Metric | Count |
|--------|-------|
| User-facing error messages audited | 24 |
| User-facing messages improved | 2 |
| Developer-facing log statements audited | 48 |
| Developer-facing messages improved | 2 |
| Sensitive data exposures found | 0 |
| Error handlers audited | 12 |
| Error handlers improved | 1 |
| Log level corrections | 0 |
| Tests passing | 248/248 |

**Overall assessment**: The codebase's messaging quality was already strong from Run 01. This follow-up audit found 4 remaining issues: one blame-attributing user message, one vague dashboard error fallback, one silently swallowed error in the abort path, and a missing debug log for lock acquisition. All fixed. No sensitive data exposure, no misleveled logs.

---

## 2. User-Facing Error Messages

### Leaked Internals Fixed

None found. Run 01 addressed all instances.

### Critical-Path Improvements

| File | Line | Was | Now | Reason |
|------|------|-----|-----|--------|
| `src/cli.js` | 168 | `You need to select at least one step. Exiting.` | `No steps selected. Select at least one step to continue.` | "You need to" violates blame-free guideline |
| `src/dashboard-html.js` | 358 | `'Error: ' + (s.error \|\| 'Unknown')` | `'Error: ' + (s.error \|\| 'No error details available')` | "Unknown" is vague; aligns with `report.js` fallback wording |

### Generic Messages Replaced

None remaining. All user-facing messages now follow `[What happened] + [Why] + [What to do]` pattern.

### Messages Still Needing Work

None identified.

### Reference

Full message catalog: [docs/ERROR_MESSAGES.md](../docs/ERROR_MESSAGES.md) — updated with `checkHasCommits` pre-check and `lock.js` messages.

---

## 3. Sensitive Data in Logs (CRITICAL)

**No sensitive data exposure found.**

Same assessment as Run 01: the codebase handles no secrets, API keys, passwords, or PII. Claude Code manages its own authentication. The `claude.js` stderr forwarding (`warn("Claude Code warning output: ...")`) is the only theoretical vector and is appropriately logged at `warn` level.

---

## 4. Log Level Corrections

No misleveled logs found. All log levels remain correctly assigned per the same assessment as Run 01.

---

## 5. Log Message Quality Improvements

### Silent Error Handlers Given Logging

| File | Line | Was | Now | Reason |
|------|------|-----|-----|--------|
| `src/cli.js` | 79 | `catch { /* ignore */ }` | `catch (err) { debug(\`Could not commit partial report: ${err.message}\`) }` | Abort path commit failure was silently swallowed; debug log aids post-mortem analysis |

### Missing Diagnostic Logging Added

| File | Line | Change | Reason |
|------|------|--------|--------|
| `src/lock.js` | 62 | Added `debug(\`Lock acquired (PID ${process.pid})\`)` | Lock acquisition had no trace in logs; helps debug concurrent-run issues |

### Log Noise

No log noise found. No hot-path logging, no redundant messages, no large object dumps.

---

## 6. Error Handler Assessment

All 12 error handlers re-verified against the documented contracts in CLAUDE.md. No changes from Run 01 assessment.

| Handler | Location | Differentiates? | Logs Properly? | Sanitizes? |
|---------|----------|-----------------|----------------|------------|
| Top-level try/catch | `cli.js:397` | Yes | Yes (ERROR + DEBUG stack) | Yes |
| Unhandled rejection | `cli.js:225` | No (all) | Yes (ERROR) | Yes |
| SIGINT handler | `cli.js:235` | Yes (1st vs 2nd) | Implicit | Yes |
| Abort path commit | `cli.js:79` | No | Yes (DEBUG) **improved** | N/A |
| Child timeout | `claude.js:76` | Yes | Via result | Yes |
| Child error event | `claude.js:105` | No | Via result | Yes |
| Spawn failure | `claude.js:139` | Yes | Via result | Yes |
| Merge conflict | `git.js:129` | Yes | WARN + DEBUG | Yes |
| Notification failure | `notifications.js:13` | No | WARN | N/A |
| Report write failure | `report.js:159` | No | WARN | N/A |
| Report commit failure | `cli.js:380` | No | WARN | N/A |
| Dashboard failures | `dashboard.js` (multiple) | No | WARN | N/A |

---

## 7. Consistency Findings

### Error Code Coverage

Not applicable — CLI tool. Same assessment as Run 01.

### Log Format

Consistent. Single logger, `[ISO-timestamp] [LEVEL] message` format, chalk coloring. `lock.js` now imports `debug` alongside `warn` for the new log line.

### Documentation Updates

- `docs/ERROR_MESSAGES.md`: Added `checkHasCommits` pre-check entry, `lock.js` section with both lock error messages, and updated "No steps selected" message text.

---

## 8. Logging Infrastructure Recommendations

No changes from Run 01. The logging infrastructure remains appropriate for a CLI tool:
- Structured logging (JSON): YAGNI
- Log rotation: Not needed (file overwritten per run)
- Request IDs: Not needed (single sequential flow)
- Centralized redaction: Not needed (no PII)

---

## 9. Bugs Discovered

No bugs found. The silent `catch` in the abort path (`cli.js:79`) was a logging gap, not a bug — the commit failure is genuinely non-critical since the partial report is a best-effort artifact.
