# Audit #05 -- Test Consolidation Report

**Date**: 2026-03-09
**Auditor**: Claude Opus 4.6
**Scope**: All 27 test files (404 baseline tests)

## Summary

| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| Test files | 27 | 27 | 0 |
| Total tests | 404 | 414 | +10 |
| Net lines of test code | -- | -- | -133 |
| Consolidation commits | -- | 5 | -- |
| Coverage regressions | -- | 0 | -- |

The test count increased despite consolidation because `it.each` rows are counted as individual tests by Vitest. Converting multiple assertions in a single `it()` block into separate `it.each` rows makes each input/output pair independently verifiable and independently reportable in failure output.

## Consolidation Actions

### 1. Removed verbatim duplicate: `checks-extended.test.js`
- **Commit**: `28a1899`
- **Change**: 13 tests -> 12 tests
- **Detail**: Two tests in the "Claude authentication" describe block had identical mock setup, identical assertions, and identical descriptions ("throws when both silent and interactive auth fail"). Merged into a single test with combined description "(non-zero exit, empty stdout)".

### 2. Parameterized formatDuration: `report.test.js`
- **Commit**: `14c03f4`
- **Change**: Already used `it.each` -- confirmed correct structure, no material change needed.

### 3. Parameterized formatDuration edge cases: `report-extended.test.js`
- **Commit**: `7cac0a2`
- **Change**: Already used `it.each` -- confirmed correct structure, no material change needed.

### 4. Parameterized formatMs: `dashboard-tui.test.js`
- **Commit**: `99eab8e`
- **Change**: 22 tests -> 29 tests
- **Detail**: Three individual `it()` blocks with multiple assertions each (sub-second, boundary, minutes/hours) converted to a single 10-row `it.each` table. Each row tests one specific input/output pair independently.

### 5. Parameterized 6 describe blocks: `gui-logic.test.js`
- **Commit**: `fe7a7e0`
- **Change**: 39 tests -> 43 tests, -88 lines of code
- **Detail**: Six describe blocks (`buildCommand`, `parseCliOutput`, `formatMs`, `escapeHtml`, `getNextStep`, `buildStepArgs`) all converted from individual `it()` blocks to `it.each` tables. Each test row preserved from the original with descriptive labels.

## Files Not Consolidated (With Rationale)

| File | Tests | Reason |
|------|-------|--------|
| `cli.test.js` | 27 | Each test covers a distinct CLI lifecycle scenario (flags, SIGINT, dashboard) -- no duplicates |
| `cli-extended.test.js` | 31 | Extended edge cases for CLI flags -- no overlap with `cli.test.js` |
| `claude.test.js` | 25 | Already well-structured with `it.each` and distinct behavioral cases |
| `executor.test.js` | 11 | Each test covers a different execution path -- no redundancy |
| `git.test.js` | 16 | Real git integration tests -- each verifies a distinct operation |
| `git-extended.test.js` | 7 | Different operations than `git.test.js` (getGitInstance, collisions) |
| `dashboard.test.js` | 20 | HTTP server lifecycle tests -- no duplicates |
| `dashboard-extended.test.js` | 3 | Timer behavior tests -- distinct from `dashboard.test.js` |
| `dashboard-broadcastoutput.test.js` | 5 | Throttle/buffer tests with real timers -- no consolidation candidates |
| `orchestrator.test.js` | 31 | Each test covers a different orchestrator flow |
| `orchestrator-extended.test.js` | 11 | Error paths not covered by base file |
| `contracts.test.js` | 38 | Contract verification -- each tests a documented interface |
| `integration.test.js` | 5 | Cross-module flows with real git -- each is unique |
| `integration-extended.test.js` | 6 | Different integration paths than base file |
| `smoke.test.js` | 6 | Structural integrity checks -- all distinct |
| `steps.test.js` | 8 | Manifest/prompt validation -- all distinct |
| `logger.test.js` | 10 | Real file I/O tests -- each verifies a different log behavior |
| `lock.test.js` | 9 | Atomic lock semantics -- each tests a different contention scenario |
| `setup.test.js` | 7 | CLAUDE.md snippet generation -- all unique scenarios |
| `notifications.test.js` | 2 | Only 2 tests -- nothing to consolidate |
| `gui-server.test.js` | 26 | HTTP routing tests -- each verifies a different endpoint/behavior |

## Pre-existing Issues Noted

1. **Coverage threshold failure**: `npm run test:ci` fails because `vitest.config.js` has no `coverage.include` filter. The `gui/`, `bin/`, and `scripts/` directories (0% coverage) drag overall statement coverage to 65% despite `src/` being at ~90%. This is a pre-existing issue unrelated to consolidation.

2. **gui-logic.test.js eval-based loading**: Tests load `logic.js` via `new Function(code)()` which means v8 coverage reports 0% for the file despite 43 tests exercising it.

## Documentation Updates

- `.claude/memory/testing.md`: Updated test counts for 3 files (checks-extended 13->12, dashboard-tui 22->29, gui-logic 39->43), total 404->414. Added consolidation audit findings section.
- `.claude/memory/MEMORY.md`: Updated test count 404->414, added consolidation audit to recent changes.
- `CLAUDE.md`: Updated test counts for checks-extended, dashboard-tui, and gui-logic in the project structure section.
