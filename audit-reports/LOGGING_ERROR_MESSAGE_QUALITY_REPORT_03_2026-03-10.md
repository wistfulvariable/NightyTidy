# Logging & Error Message Quality Report

**Run**: 03 | **Date**: 2026-03-10 | **Branch**: `nightytidy/run-2026-03-10-0005`

---

## 1. Executive Summary

| Metric | Count |
|--------|-------|
| User-facing error messages audited | 28 |
| User-facing messages improved | 3 |
| Developer-facing log statements audited | 52 |
| Developer-facing messages improved | 11 |
| Sensitive data exposures found | 0 |
| Error handlers audited | 14 |
| Error handlers improved | 9 |
| Log level corrections | 0 |
| Tests passing | 738/738 |

**Overall assessment**: The codebase's messaging quality was already strong from Run 02 (2026-03-05). This follow-up audit found 9 error handlers that were swallowing errors silently without logging useful diagnostic information, 3 user-facing messages that could be clearer, and 11 developer-facing log messages with insufficient context. All have been fixed. No sensitive data exposure, no misleveled logs.

---

## 2. User-Facing Error Messages

### Leaked Internals Fixed

None found. Previous runs addressed all instances.

### Critical-Path Improvements

| File | Line | Was | Now | Reason |
|------|------|-----|-----|--------|
| `src/orchestrator.js` | 419 | `...Call --finish-run first, or delete nightytidy-run-state.json to reset.` | `...Call --finish-run to complete it, or delete nightytidy-run-state.json to force-reset.` | Clearer guidance on action severity |
| `src/orchestrator.js` | 439 | `...Use --list to see available steps.` | `...Use --list --json to see available steps.` | More specific command for JSON API mode |
| `src/lock.js` | 41-49 | Assumed `lockData.pid` and `lockData.started` always defined | Now uses `lockData.pid || 'unknown'` | Graceful handling when lock file JSON is corrupted |

### Generic Messages Replaced

None remaining. All user-facing messages follow the `[What happened] + [Why] + [What to do]` pattern.

### Messages Still Needing Work

None identified.

### Reference

Full message catalog: [docs/ERROR_MESSAGES.md](../docs/ERROR_MESSAGES.md) — updated with orchestrator, consolidation, executor, and git operation messages.

---

## 3. Sensitive Data in Logs (CRITICAL)

**No sensitive data exposure found.**

Same assessment as Run 01 and Run 02: the codebase handles no secrets, API keys, passwords, or PII. Claude Code manages its own authentication. The `claude.js` stderr forwarding (`warn("Claude Code warning output: ...")`) is the only theoretical vector and is appropriately logged at `warn` level.

---

## 4. Log Level Corrections

No misleveled logs found. All log levels remain correctly assigned per the assessment from previous runs.

---

## 5. Log Message Quality Improvements

### Silent Error Handlers Given Logging

| File | Line | Was | Now | Reason |
|------|------|-----|-----|--------|
| `src/checks.js` | 180 | `catch { debug('Disk space check failed — skipping'); }` | `catch (err) { debug(\`Disk space check failed (${err.code \|\| err.message}) — skipping\`); }` | Now includes actual error details |
| `src/checks.js` | 223 | `catch { debug('Working tree check failed — skipping'); }` | `catch (err) { debug(\`Working tree check failed (${err.message}) — skipping\`); }` | Now includes actual error details |
| `src/checks.js` | 236 | `catch { /* Non-critical — ignore */ }` | `catch (err) { debug(\`Branch check failed (${err.message}) — skipping\`); }` | Was completely silent; now logged at debug |
| `src/orchestrator.js` | 128 | `catch { /* already gone */ }` | `catch (err) { if (err.code !== 'ENOENT') warn(...); }` | Now logs unexpected errors (not just "file not found") |
| `src/orchestrator.js` | 344 | `info('Dashboard server did not respond in time...')` | `info('Dashboard server startup timed out — continuing without live progress display')` | Clearer about consequence |
| `src/orchestrator.js` | 357 | `catch { resolve(null); }` | `catch (parseErr) { info(\`Dashboard startup response was not valid JSON: ${parseErr.message}\`); resolve(null); }` | Now logs parse errors |
| `src/orchestrator.js` | 363 | `child.on('error', () => { ... resolve(null); })` | `child.on('error', (err) => { info(\`Dashboard server spawn failed: ${err.message}\`); resolve(null); })` | Now logs spawn errors |
| `src/dashboard.js` | 197 | `catch { /* non-critical */ }` | `catch (urlErr) { debug(\`Could not write dashboard URL file: ${urlErr.message}\`); }` | Now includes error details |
| `src/git.js` | 81 | `warn(\`Could not add ephemeral file exclusions: ${err.message}\`)` | `warn(\`Could not add ephemeral file exclusions (${err.code \|\| 'unknown'}): ${err.message}\`)` | Includes error code for diagnosis |

### Clarified Error Context

| File | Line | Was | Now | Reason |
|------|------|-----|-----|--------|
| `src/executor.js` | 254 | `warn(\`${stepLabel}: fallback commit failed — ${err.message}\`)` | `warn(\`${stepLabel}: automatic commit failed (${err.message}) — changes remain staged\`)` | "fallback commit" is internal jargon; "changes remain staged" tells user what happened |
| `src/consolidation.js` | 52 | `warn('Action plan generation failed — skipping NIGHTYTIDY-ACTIONS.md')` | `warn('...NIGHTYTIDY-ACTIONS.md will not be created. NIGHTYTIDY-REPORT.md is still available.')` | Clarifies non-critical nature and alternative |

### Log Noise

No log noise found. No hot-path logging, no redundant messages, no large object dumps.

---

## 6. Error Handler Assessment

All 14 error handlers verified against the documented contracts in CLAUDE.md.

| Handler | Location | Differentiates? | Logs Properly? | Sanitizes? |
|---------|----------|-----------------|----------------|------------|
| Top-level try/catch | `cli.js:621` | Yes | Yes (ERROR + DEBUG stack) | Yes |
| Unhandled rejection | `cli.js:563` | No (all) | Yes (ERROR) | Yes |
| SIGINT handler | `cli.js:571` | Yes (1st vs 2nd) | Implicit | Yes |
| Abort path commit | `cli.js:144` | No | Yes (DEBUG) | N/A |
| Disk space check | `checks.js:180` | No | Yes (DEBUG) **improved** | N/A |
| Working tree check | `checks.js:223` | No | Yes (DEBUG) **improved** | N/A |
| Branch check | `checks.js:236` | No | Yes (DEBUG) **improved** | N/A |
| Child timeout | `claude.js:204` | Yes | Via result | Yes |
| Child error event | `claude.js:390` | No | Via result | Yes |
| Merge conflict | `git.js:218` | Yes | WARN + DEBUG | Yes |
| Notification failure | `notifications.js:14` | No | WARN | N/A |
| Report write failure | `report.js:298` | No | WARN | N/A |
| State file delete | `orchestrator.js:128` | Yes | WARN (non-ENOENT) **improved** | N/A |
| Dashboard spawn/parse | `orchestrator.js:354,363` | No | INFO **improved** | N/A |

---

## 7. Consistency Findings

### Error Code Coverage

Not applicable — CLI tool. Same assessment as previous runs.

### Log Format

Consistent. Single logger, `[ISO-timestamp] [LEVEL] message` format, chalk coloring.

### Import Updates

- `src/dashboard.js`: Added `debug` import alongside `info` and `warn` for URL file write logging

### Documentation Updates

- `docs/ERROR_MESSAGES.md`:
  - Updated orchestrator error messages to reflect improved wording
  - Added Action Plan (`consolidation.js`) section
  - Added Executor (`executor.js`) section
  - Added Git Operations (`git.js`) section

---

## 8. Logging Infrastructure Recommendations

No changes from previous runs. The logging infrastructure remains appropriate for a CLI tool:
- Structured logging (JSON): YAGNI
- Log rotation: Not needed (file overwritten per run)
- Request IDs: Not needed (single sequential flow)
- Centralized redaction: Not needed (no PII)

---

## 9. Bugs Discovered

No bugs found. All changes were improvements to logging and error message quality, not bug fixes. The silent `catch` blocks in checks.js, orchestrator.js, and dashboard.js were logging gaps rather than bugs — the skipped operations are genuinely non-critical.

---

## 10. Files Modified

| File | Changes |
|------|---------|
| `src/checks.js` | 3 error handlers now log error details |
| `src/consolidation.js` | 2 warning messages clarified |
| `src/dashboard.js` | 1 error handler logs error details, added debug import |
| `src/executor.js` | 1 warning message reworded for clarity |
| `src/git.js` | 1 warning message includes error code |
| `src/lock.js` | 2 locations handle undefined PID/timestamp gracefully |
| `src/orchestrator.js` | 5 error handlers and messages improved |
| `docs/ERROR_MESSAGES.md` | Added 3 new sections, updated orchestrator section |
| `test/executor-extended.test.js` | Updated 2 assertions to match new message wording |

---

*Generated by NightyTidy v0.1.0*
