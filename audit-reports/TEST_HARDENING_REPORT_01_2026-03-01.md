# Test Hardening Report — Run 01 — 2026-03-01

## Summary

| Metric | Count |
|--------|-------|
| Flaky tests found and fixed | 1 |
| Flaky tests found but couldn't fix | 0 |
| Previously disabled tests re-enabled | 0 |
| API endpoints found | N/A (CLI tool, no HTTP API) |
| Contract tests written | 17 |
| Documentation discrepancies found | 1 |

## Phase 1: Flaky Test Diagnosis & Repair

### Detection Methodology

- Ran the full test suite 5 times consecutively
- Run 4 produced a failure: `EBUSY: resource busy or locked` in `integration.test.js`
- Scanned all 14 test files for common flaky patterns
- Searched git history for "flaky", "intermittent", "timing" — none found
- No skipped or disabled tests exist in the suite

### Flaky Tests Fixed

| Test Name | File | Root Cause | Fix Applied |
|-----------|------|-----------|-------------|
| `executes steps on a run branch and produces a commit per step` | `test/integration.test.js` | Windows EBUSY: `rm()` in `afterEach` races against git process file handles that are still open. `simple-git` spawns child processes that hold `.git/` file locks briefly after operations complete. | Created `test/helpers/cleanup.js` with `robustCleanup()` — retries `rm()` up to 5 times with 200ms delay between attempts, catching EBUSY/EPERM/ENOTEMPTY. Applied to all 5 test files using temp directories. |

### Flaky Tests Unresolved

None.

### Preventive Fixes Applied

The same EBUSY vulnerability existed in 4 other test files that use real git temp directories. Even though the failure was only observed in `integration.test.js`, the fix was applied to all files to prevent future flakiness:

| File | Previous Cleanup | New Cleanup |
|------|-----------------|-------------|
| `test/integration.test.js` | `rm(tempDir, { recursive: true, force: true })` | `robustCleanup(tempDir)` |
| `test/git.test.js` | `rm(tempDir, { recursive: true, force: true })` | `robustCleanup(tempDir)` |
| `test/git-extended.test.js` | `rm(tempDir, { recursive: true, force: true })` | `robustCleanup(tempDir)` |
| `test/logger.test.js` | `rm(tempDir, { recursive: true, force: true })` + inline `rm()` | `robustCleanup(tempDir)` |
| `test/smoke.test.js` | `rm(tempDir, { recursive: true, force: true })` in `finally` blocks | `robustCleanup(tempDir)` |

### Flaky Pattern Audit (Currently Stable)

These patterns were reviewed and found to be safe, but are worth monitoring:

| Pattern | Files | Risk | Assessment |
|---------|-------|------|------------|
| `queueMicrotask()` + fake timers | `claude.test.js` | Low | `shouldAdvanceTime: true` ensures microtasks process. Timer advancement values are generous. Stable across 5+ runs. |
| `Date.now()` in test metadata | `integration.test.js` | Very Low | Used only to populate metadata objects for report generation, not for timing assertions. |
| `process.nextTick()` for event emission | `checks.test.js`, `checks-extended.test.js` | Low | Correctly defers events until listeners attach. Standard Node.js pattern. |
| `process.env` mutation | `logger.test.js` | Low | Cleaned up in `finally` blocks within each test. `vi.resetModules()` in `beforeEach` ensures fresh module state. |
| `process.exit` spy | `cli.test.js` | Low | Restored in `afterEach`. If `afterEach` fails, worst case is spy leaking to next test (non-fatal). |

## Phase 2: API Contract Testing

### Context

NightyTidy is a CLI orchestration tool, not a web service. It has no HTTP API endpoints. Phase 2 was adapted to test the **module interface contracts** documented in CLAUDE.md's "Architectural Rules > Error Handling Strategy" table.

### Module Interface Map

| Module | Exported Functions | Error Contract | Contract Tests |
|--------|--------------------|----------------|----------------|
| `src/claude.js` | `runPrompt()` | Never throws; returns `{ success, output, error, exitCode, duration, attempts }` | 2 tests |
| `src/git.js` | `initGit`, `getCurrentBranch`, `createPreRunTag`, `createRunBranch`, `getHeadHash`, `hasNewCommit`, `fallbackCommit`, `mergeRunBranch`, `getGitInstance` | `mergeRunBranch` never throws, returns `{ success, conflict }`. Others may throw. | 3 tests |
| `src/checks.js` | `runPreChecks()` | Throws Error with user-friendly messages | 2 tests |
| `src/executor.js` | `executeSteps()` | Never throws; returns `{ results, completedCount, failedCount, totalDuration }` | 2 tests |
| `src/notifications.js` | `notify()` | Swallows all errors silently | 1 test |
| `src/report.js` | `generateReport()`, `formatDuration()` | Warns but never throws | 2 tests |
| `src/logger.js` | `initLogger`, `debug`, `info`, `warn`, `error` | Throws if not initialized | 2 tests |
| `src/prompts/steps.js` | `STEPS`, `DOC_UPDATE_PROMPT`, `CHANGELOG_PROMPT` | Data only (no functions) | 2 tests |
| `src/cli.js` | `run()` | Top-level try/catch | (Covered by cli.test.js) |

### Contract Tests Written

17 tests in `test/contracts.test.js`, organized into 9 describe blocks:

1. **claude.js**: Result object has all required fields on failure; `runPrompt` is the only export
2. **git.js**: `mergeRunBranch` returns success object on clean merge; returns conflict object on conflict (does not throw); all 9 documented functions are exported
3. **checks.js**: Throws an `Error` instance (not a result object); exports `runPreChecks`
4. **executor.js**: Returns result with required fields even when steps fail; each result entry has documented shape
5. **notifications.js**: Does not throw even when node-notifier throws
6. **report.js**: `generateReport` does not throw with valid inputs; `formatDuration` returns strings
7. **logger.js**: Throws "Logger not initialized" before init; exports all documented functions
8. **steps.js**: 28 steps with sequential numbering and required fields; special prompts are non-empty strings
9. **Init sequence**: Logger must be initialized before log functions work

### Documentation Discrepancies

| # | Location | What Docs Say | What Code Does | Severity |
|---|----------|--------------|----------------|----------|
| 1 | CLAUDE.md "Key Constants" table | Lists `DEFAULT_TIMEOUT`, `DEFAULT_RETRIES`, `RETRY_DELAY`, `STDIN_THRESHOLD` as named constants with specific values | Constants exist but are **not exported** from `claude.js` — they are module-private `const` declarations | Low — documentation is informational, not an API contract. Values are correct. |

### Undocumented Behavior

| Behavior | Module | Notes |
|----------|--------|-------|
| `robustCleanup()` helper | `test/helpers/cleanup.js` | New test utility added by this hardening pass. Retries temp directory cleanup with configurable attempts/delay. |
| git.js `getGitInstance()` returns `null` before `initGit()` | `src/git.js` | CLAUDE.md mentions "Calling git operations before `initGit()` gives null reference errors" but doesn't document `getGitInstance()` can return `null`. |
| Executor continues after failed steps | `src/executor.js` | Documented but worth emphasizing: a failed improvement prompt does NOT stop the run. Only `AbortSignal` or loop completion stops it. |

## Recommendations

| # | Recommendation | Impact | Risk if Ignored | Worth Doing? | Details |
|---|---|---|---|---|---|
| 1 | Use `robustCleanup()` for all future test files | Prevents flaky test regressions on Windows | Medium | Yes | Any new test file that creates temp directories should import from `test/helpers/cleanup.js` instead of using raw `rm()`. Add to CLAUDE.md testing conventions. |
| 2 | Document module-private constants as "internal" | Prevents confusion when reading CLAUDE.md | Low | Only if time allows | The "Key Constants" table in CLAUDE.md implies these are exported. A "(internal)" note would clarify. |

## Test Suite Stats

| Metric | Before | After |
|--------|--------|-------|
| Test files | 14 | 15 |
| Total tests | 119 | 136 |
| Coverage (stmts) | 98.84% | 98.84% |
| Coverage (branches) | 92.17% | 92.17% |
| Coverage (functions) | 91.11% | 91.11% |
| Flaky failure rate (5 runs) | 20% (1 of 5 failed) | 0% (5 of 5 passed) |

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `test/helpers/cleanup.js` | Created | Shared temp directory cleanup utility with EBUSY retry logic |
| `test/integration.test.js` | Modified | Replaced `rm()` with `robustCleanup()` |
| `test/git.test.js` | Modified | Replaced `rm()` with `robustCleanup()` |
| `test/git-extended.test.js` | Modified | Replaced `rm()` with `robustCleanup()` |
| `test/logger.test.js` | Modified | Replaced `rm()` with `robustCleanup()` |
| `test/smoke.test.js` | Modified | Replaced `rm()` with `robustCleanup()` |
| `test/contracts.test.js` | Created | 17 module contract tests |
