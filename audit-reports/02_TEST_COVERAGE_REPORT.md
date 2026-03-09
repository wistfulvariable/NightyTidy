# Audit #02 -- Test Coverage Analysis and Improvements

**Date**: 2026-03-09
**Auditor**: Claude Opus 4.6
**Codebase**: NightyTidy v0.1.0

---

## Executive Summary

Test coverage audit identified critical gaps in `lock.js` (58% statements), `dashboard.js` broadcastOutput throttle paths, and `orchestrator.js` error handling. Added 25 new tests across 3 new test files, improving src/ statement coverage from 88.79% to 89.93% and branch coverage from 88.64% to 90.03%.

The overall global coverage metric (65.29%) is below the 90% threshold due to newly added `gui/`, `bin/`, and `scripts/` directories not having v8-instrumented test coverage. The `src/` directory (the actual production code) meets or nearly meets all thresholds.

---

## Phase 1: Smoke Test Assessment

Existing smoke tests (`test/smoke.test.js`) are adequate:
- 6 tests covering module imports, logger init, git init, steps data, entry point, and formatDuration
- Executes in under 1 second
- Properly covers "is it on fire?" checks
- No changes needed

---

## Phase 2: Coverage Gap Analysis

### Before This Audit (src/ only)

| Module | % Stmts | % Branch | % Funcs | Priority |
|--------|---------|----------|---------|----------|
| `lock.js` | 58.47 | 66.66 | 71.42 | **Critical** |
| `dashboard-tui.js` | 75.74 | 97.14 | 80 | Medium |
| `dashboard.js` | 86.21 | 77.14 | 100 | High |
| `checks.js` | 93.85 | 95.83 | 100 | Medium |
| `orchestrator.js` | 92.65 | 88.67 | 93.75 | High |
| `cli.js` | 93.65 | 90.17 | 87.5 | Medium |
| `git.js` | 95.83 | 84.37 | 100 | Medium |
| `executor.js` | 98.60 | 96.55 | 100 | Low |
| `claude.js` | 99.01 | 80.95 | 100 | Low |
| All others | 100 | 97-100 | 100 | None |

### After This Audit (src/ only)

| Module | % Stmts | % Branch | % Funcs | Change |
|--------|---------|----------|---------|--------|
| `lock.js` | 77.11 | 88.46 | 100 | **+18.64 stmts, +21.80 branch, +28.58 funcs** |
| `dashboard.js` | 89.39 | 78.94 | 100 | **+3.18 stmts, +1.80 branch** |
| `orchestrator.js` | 94.07 | 93.27 | 93.75 | **+1.42 stmts, +4.60 branch** |

### Modules Not Covered by v8 Instrumentation (0%)

| Module | Lines | Reason | Recommendation |
|--------|-------|--------|----------------|
| `gui/server.js` | 359 | Standalone HTTP server + Chrome launcher | Add coverage.include config |
| `gui/resources/app.js` | 586 | Browser DOM code (no JSDOM) | Exclude from coverage or add JSDOM tests |
| `gui/resources/logic.js` | 134 | Tested via eval (39 tests!) but v8 can't track | Exclude from coverage or restructure exports |
| `bin/nightytidy.js` | 3 | 3-line entry point | Exclude from coverage |
| `scripts/check-docs-freshness.js` | 129 | CI helper script | Exclude from coverage |
| `scripts/run-flaky-check.js` | 24 | CI helper script | Exclude from coverage |
| `src/dashboard-standalone.js` | 136 | Detached process (spawned by orchestrator) | Exclude or add dedicated test |

---

## Phase 3: Tests Written

### New Test File: `test/lock.test.js` (9 tests)

Tests the critical lock file management module that prevents concurrent runs.

| Test | What It Verifies |
|------|-----------------|
| Creates lock file with PID and timestamp | Happy path -- atomic lock creation with correct content |
| Removes stale lock from dead process | Dead PID detection via `process.kill(pid, 0)` |
| Removes stale lock with corrupt JSON | Corrupt lock file treated as stale |
| Removes stale lock older than 24 hours | Age-based staleness regardless of PID |
| Throws in non-TTY with active lock | Non-interactive environment rejects override |
| Rethrows non-EEXIST errors | Error propagation for unexpected filesystem errors |
| Does not register exit handler in persistent mode | Orchestrator mode skips auto-cleanup |
| releaseLock removes existing file | Normal lock release |
| releaseLock tolerates missing file | Idempotent release |

### New Test File: `test/orchestrator-extended.test.js` (11 tests)

Tests error handling edge cases in the orchestrator module.

| Test | What It Verifies |
|------|-----------------|
| Warns on git commit failure in finishRun | Report commit failure is non-fatal |
| Returns fail on unexpected merge error | Catch block at line 420 works |
| Returns fail on generateReport throw | Report generation error is caught |
| State version mismatch returns null | Wrong version treated as missing state |
| Sorts results by selected order | Report order matches user selection, not completion order |
| Passes timeout from state to executor | State-stored timeout propagates correctly |
| Per-call timeout overrides state timeout | CLI timeout takes precedence |
| Corrupt JSON returns no active run | readState handles parse errors gracefully |
| Stores timeout in state file | Timeout persistence across process invocations |
| Stores null timeout when omitted | Default behavior is correct |
| Handles lock acquisition failure | Lock error propagates as fail() result |

### New Test File: `test/dashboard-broadcastoutput.test.js` (5 tests)

Tests the broadcastOutput throttle mechanism and buffer management.

| Test | What It Verifies |
|------|-----------------|
| Buffer overflow trims from front at 100KB | Rolling buffer stays within bounds |
| Throttled write updates progress file | setTimeout callback fires and writes |
| Double broadcast uses single throttled write | Throttle deduplication works |
| clearOutputBuffer removes from state | State cleanup after step transitions |
| Wrong CSRF token rejected | Security: stop endpoint rejects bad tokens |

---

## Phase 4: Test Quality Assessment

### Strengths
- Tests verify real behavior, not just mock interactions
- Lock tests use real filesystem operations (temp dirs, real `openSync('wx')`)
- Dashboard tests verify actual HTTP responses and SSE events
- Orchestrator tests verify complete result objects, not just success/failure
- All tests use `robustCleanup()` for Windows compatibility

### Remaining Gaps (Ranked by Risk)

1. **Coverage config gap** (Configuration, not code): `vitest.config.js` lacks `coverage.include` directive. The `gui/`, `bin/`, and `scripts/` directories report 0% and drag overall coverage below the 90% threshold. Fix: add `coverage: { include: ['src/**'] }` or exclude standalone scripts.

2. **lock.js lines 100-107**: The `promptOverride` TTY interaction path (readline question/answer) cannot be tested without mocking `process.stdin.isTTY` and `readline`. The non-TTY path is tested (throws). Low risk since TTY prompt is simple yes/no.

3. **dashboard-tui.js lines 156-186**: `startPolling` uses `setInterval` + file reads + `process.exit`. Would require process-level testing or refactoring to extract testable units. Low risk since it's a display-only TUI.

4. **dashboard-standalone.js**: Entire standalone server at 0%. It's a detached process spawned by orchestrator. Testing requires spawning it as a subprocess. Medium effort, low risk.

5. **checks.js lines 126-130**: Interactive auth path (`runInteractiveAuth`) with `stdio: 'inherit'`. The recovery path (silent fails, interactive succeeds) is tested in checks-extended.test.js, but the exact `stdio: 'inherit'` variant may not be hit depending on mock routing.

---

## Recommendations

### Immediate (Before Next Release)
1. **Add `coverage.include` to vitest.config.js** to scope coverage thresholds to `src/` directory only. This unblocks CI and reflects the actual meaningful coverage.

### Short-Term
2. **Consider restructuring `gui/resources/logic.js`** to use proper ESM exports so v8 can instrument it. Currently tested via `eval` (39 tests pass) but coverage reports 0%.
3. **Add lock.js TTY prompt test** using `vi.spyOn(process.stdin, 'isTTY')` to cover the override flow.

### Long-Term
4. **Consider JSDOM tests for `gui/resources/app.js`** if the GUI grows in complexity.
5. **Add subprocess test for `dashboard-standalone.js`** if dashboard reliability becomes critical.

---

## Metrics Summary

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| Total tests | 359 | 384 | +25 |
| Test files | 24 | 27 | +3 |
| src/ statements | 88.79% | 89.93% | +1.14% |
| src/ branches | 88.64% | 90.03% | +1.39% |
| src/ functions | 93.27% | 94.95% | +1.68% |
| lock.js statements | 58.47% | 77.11% | +18.64% |
| dashboard.js statements | 86.21% | 89.39% | +3.18% |
| orchestrator.js statements | 92.65% | 94.07% | +1.42% |
| Overall statements (global) | 64.47% | 65.29% | +0.82% |

The global coverage metric is misleading due to the `gui/`, `bin/`, and `scripts/` directories. The `src/` directory -- which contains all production code -- is now at 90%+ for branches and nearly 90% for statements.
