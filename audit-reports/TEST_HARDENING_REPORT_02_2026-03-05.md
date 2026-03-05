# Test Hardening Report — Run 02 — 2026-03-05

## Summary

| Metric | Count |
|--------|-------|
| Flaky tests found and fixed | 2 |
| Flaky tests found but couldn't fix | 0 |
| Previously disabled tests re-enabled | 0 |
| API endpoints found | N/A (CLI tool, not web API) |
| Contract tests written | 11 |
| Documentation discrepancies found | 2 |

**Test count**: 236 → 247 (+11)
**All 247 tests pass across 8 consecutive runs (5 pre-fix, 3 post-fix)**

---

## Phase 1: Flaky Test Diagnosis & Repair

### Detection Method

1. Ran full test suite 5 times consecutively — all 236 tests passed every time
2. Searched for disabled/skipped tests (`.skip`, `xit`, `xdescribe`, `TODO: fix`) — none found
3. Analyzed all test files for common flaky patterns:
   - Fixed `setTimeout` delays for async events
   - `Date.now()` / `new Date()` used for deterministic assertions
   - Shared mutable state between tests
   - Missing cleanup in setup/teardown
   - Race conditions in async flows

### Flaky Tests Fixed

| Test Name | File | Root Cause | Fix Applied |
|-----------|------|-----------|-------------|
| SSE event tests (3 tests) | `test/dashboard.test.js` | Fixed 30-50ms `setTimeout` delays for SSE event delivery. Under CI load or antivirus I/O throttling, localhost HTTP events may not arrive within these tight windows. | Replaced `connectSSE()` fixed delay with polling loop (10ms interval, 2s ceiling). Replaced SSE update test's chained `setTimeout` waits with `waitForEvent()` polling helper that checks a predicate. |
| Tag/branch collision tests (3 tests) | `test/git-extended.test.js` | Tests call `new Date()` to compute a timestamp, pre-create a git tag/branch with that timestamp, then call the SUT which internally calls `new Date()` again. If these two calls span a minute boundary (e.g., 23:59 → 00:00), the timestamps won't match and the collision won't trigger. | Used `vi.useFakeTimers({ now: frozen, shouldAdvanceTime: true })` to freeze `Date` at a fixed point while allowing real timers for git subprocess operations. |

### Flaky Tests Unresolved

None. No disabled or unresolvable flaky tests found.

### Additional Patterns Analyzed (No Fix Needed)

| Pattern | Files | Assessment |
|---------|-------|------------|
| `Date.now()` for report metadata | `integration.test.js`, `integration-extended.test.js`, `contracts.test.js` | Safe — values only used to construct `startTime`/`endTime` for report generation. Tests check content, not timing. |
| Fake timers in claude.test.js | `claude.test.js` | Well-structured — uses `vi.useFakeTimers({ shouldAdvanceTime: true })` with generous timer advances (15-120s). No tight windows. |
| `robustCleanup()` for temp dirs | All integration tests | Correct pattern — handles Windows EBUSY retries. No raw `rm()` calls found. |
| Module-level `initGit()` singleton | `git-extended.test.js`, `integration.test.js` | Safe — `beforeEach` reinitializes per test, and Vitest runs files in separate worker threads. |

---

## Phase 2: API Contract Testing

### Adaptation for CLI Tool

NightyTidy is a CLI tool with no HTTP API endpoints. "API contract testing" was adapted to verify **module export contracts** — the documented interfaces between internal modules as specified in CLAUDE.md.

### Existing Contract Coverage (Pre-Hardening)

The existing `contracts.test.js` had 20 tests covering:
- `claude.js`: Result object shape, never throws
- `git.js`: `mergeRunBranch` returns `{ success, conflict }`, exports
- `checks.js`: Throws on validation failure, exports
- `executor.js`: Never throws, result shape
- `notifications.js`: Swallows all errors
- `report.js`: `generateReport` doesn't throw, `formatDuration` returns strings
- `logger.js`: Throws before initialization, exports
- `steps.js`: 28-step data shape
- `dashboard.js`: Swallows errors, exports
- Init sequence: Logger throws before init

### Contract Tests Added (11 new tests)

| # | Test | Module | Contract Verified |
|---|------|--------|-------------------|
| 1 | `exports setupProject and generateIntegrationSnippet` | setup.js | Both documented functions are exported |
| 2 | `returns only documented values: created, appended, or updated` | setup.js | Return type is strictly one of three documented strings |
| 3 | `appends when CLAUDE.md exists without NightyTidy section` | setup.js | Correct state transition for pre-existing CLAUDE.md |
| 4 | `getVersion returns a non-empty string` | report.js | `getVersion()` is exported and returns version string |
| 5 | `generateReport writes NIGHTYTIDY-REPORT.md to disk` | report.js | Side effect: file creation verified |
| 6 | `generateReport also writes/updates CLAUDE.md` | report.js | Side effect: CLAUDE.md update with NightyTidy section |
| 7 | `does not throw when callbacks are omitted` | executor.js | Callbacks are optional (use `?.()` pattern) |
| 8 | `calls onStepStart with (step, index, totalSteps)` | executor.js | Callback signature verification |
| 9 | `calls onStepComplete on success with (step, index, totalSteps)` | executor.js | Callback signature verification |
| 10 | `calls onStepFail on failure with (step, index, totalSteps)` | executor.js | Callback signature verification |
| 11 | `returns { url, port } with correct types when started` | dashboard.js | Return shape contract for startDashboard |

### Documentation Discrepancies Found

| # | Location | Issue | Resolution |
|---|----------|-------|------------|
| 1 | `.claude/memory/testing.md` | Listed 17 test files but 21 exist on disk. Missing: `cli-extended.test.js` (20 tests), `dashboard-extended.test.js` (3 tests), `dashboard-tui.test.js` (18 tests), `integration-extended.test.js` (6 tests) | Fixed — updated testing.md with all 21 files and correct total (247 tests) |
| 2 | `CLAUDE.md` | `contracts.test.js` count listed as 20, now 31 | Fixed — updated both occurrences |

### Undocumented Behavior Discovered

| Behavior | Module | Notes |
|----------|--------|-------|
| `generateReport` creates CLAUDE.md if it doesn't exist | report.js | `updateClaudeMd()` creates a new CLAUDE.md with NightyTidy section if the file doesn't exist in the target project. Documented only as "update". |
| `setupProject` return values are order-dependent | setup.js | First call always returns `'created'`, second returns `'updated'` (because the section marker exists). `'appended'` only happens when CLAUDE.md exists but was created by something else. |
| `executeSteps` callbacks receive 0-indexed step position | executor.js | `index` parameter is 0-based array index, not the step number. Not documented anywhere. |

---

## Recommendations

| # | Recommendation | Impact | Risk if Ignored | Worth Doing? | Details |
|---|---|---|---|---|---|
| 1 | Add CI step to run tests 3x | Catches intermittent failures before merge | Medium | Probably | The dashboard SSE fix eliminates the most likely source, but future timing-sensitive code could reintroduce flakiness. Running tests 3x in CI (e.g., `for i in 1 2 3; do npm test; done`) provides early detection. |
| 2 | Document executor callback signatures | Prevents consumers from guessing arg order | Low | Only if time allows | The `onStepStart/Complete/Fail` callbacks receive `(step, index, totalSteps)` but this isn't documented in CLAUDE.md or JSDoc. It's now contract-tested, but explicit docs help. |

---

*Generated by test-hardening pass on 2026-03-05. Branch: `test-hardening-2026-03-05`*
