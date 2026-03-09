# Audit #04 -- Test Architecture Report

**Date**: 2026-03-09
**Auditor**: Claude Opus 4.6
**Scope**: READ-ONLY analysis of all 27 test files (404 tests) in the NightyTidy codebase

---

## Phase 1: Test Inventory & Classification

### Test File Catalog

| # | Test File | Tests | Type | Module Covered | Speed |
|---|-----------|-------|------|---------------|-------|
| 1 | `smoke.test.js` | 6 | Smoke | All (structural) | Fast (~0.8s) |
| 2 | `cli.test.js` | 27 | Unit | `cli.js` | Fast (~61ms) |
| 3 | `cli-extended.test.js` | 31 | Unit | `cli.js` | Fast (~72ms) |
| 4 | `checks.test.js` | 4 | Unit | `checks.js` | Fast (~10ms) |
| 5 | `checks-extended.test.js` | 13 | Unit | `checks.js` | Fast (~44ms) |
| 6 | `claude.test.js` | 25 | Unit | `claude.js` | Fast (~50ms) |
| 7 | `executor.test.js` | 11 | Unit | `executor.js` | Fast (~10ms) |
| 8 | `git.test.js` | 16 | Integration | `git.js` | Slow (~10.6s) |
| 9 | `git-extended.test.js` | 7 | Integration | `git.js` | Slow (~4.1s) |
| 10 | `logger.test.js` | 10 | Integration | `logger.js` | Medium (~219ms) |
| 11 | `notifications.test.js` | 2 | Unit | `notifications.js` | Fast (~6ms) |
| 12 | `report.test.js` | 7 | Unit | `report.js` | Fast (~7ms) |
| 13 | `report-extended.test.js` | 15 | Unit | `report.js` | Fast (~13ms) |
| 14 | `steps.test.js` | 8 | Structural | `prompts/loader.js` | Fast (~18ms) |
| 15 | `setup.test.js` | 7 | Unit | `setup.js` | Fast (~7ms) |
| 16 | `dashboard.test.js` | 20 | Integration | `dashboard.js` | Medium (~670ms) |
| 17 | `dashboard-extended.test.js` | 3 | Unit | `dashboard.js` | Medium (~105ms) |
| 18 | `dashboard-tui.test.js` | 22 | Unit | `dashboard-tui.js` | Fast (~8ms) |
| 19 | `dashboard-broadcastoutput.test.js` | 5 | Integration | `dashboard.js` | Slow (~2.3s) |
| 20 | `lock.test.js` | 9 | Integration | `lock.js` | Medium (~103ms) |
| 21 | `integration.test.js` | 5 | Integration | Multi-module | Slow (~4.4s) |
| 22 | `integration-extended.test.js` | 6 | Integration | Multi-module | Slow (~3.3s) |
| 23 | `orchestrator.test.js` | 31 | Unit | `orchestrator.js` | Slow (~5.1s) |
| 24 | `orchestrator-extended.test.js` | 11 | Unit | `orchestrator.js` | Medium (~527ms) |
| 25 | `contracts.test.js` | 38 | Contract | All modules | Slow (~3.1s) |
| 26 | `gui-logic.test.js` | 39 | Unit | `gui/resources/logic.js` | Fast (~12ms) |
| 27 | `gui-server.test.js` | 26 | Integration | `gui/server.js` | Medium (~285ms) |

**Total**: 404 tests across 27 files

### Testing Pyramid Analysis

| Type | Files | Tests | Percentage |
|------|-------|-------|------------|
| Unit | 16 | 246 | 60.9% |
| Integration | 8 | 95 | 23.5% |
| Contract | 1 | 38 | 9.4% |
| Smoke | 1 | 6 | 1.5% |
| Structural | 1 | 8 | 2.0% |
| E2E | 0 | 0 | 0% |

**Verdict**: Healthy testing pyramid. Unit tests dominate (61%), integration tests provide good cross-module coverage (24%), and the contract test layer is a noteworthy strength. No E2E tests exist, which is appropriate per project policy (user-requested only).

### Module Coverage Map

| Source Module | Has Tests | Test Files | Test Count |
|--------------|-----------|------------|------------|
| `cli.js` | Yes | 2 | 58 |
| `executor.js` | Yes | 1 | 11 |
| `claude.js` | Yes | 1 | 25 |
| `git.js` | Yes | 2 | 23 |
| `checks.js` | Yes | 2 | 17 |
| `logger.js` | Yes | 1 | 10 |
| `notifications.js` | Yes | 1 | 2 |
| `report.js` | Yes | 2 | 22 |
| `setup.js` | Yes | 1 | 7 |
| `dashboard.js` | Yes | 3 | 28 |
| `dashboard-tui.js` | Yes | 1 | 22 |
| `dashboard-html.js` | No (data only) | -- | -- |
| `dashboard-standalone.js` | No | -- | -- |
| `lock.js` | Yes | 1 | 9 |
| `orchestrator.js` | Yes | 2 | 42 |
| `prompts/loader.js` | Yes | 1 | 8 |
| `gui/resources/logic.js` | Yes | 1 | 39 |
| `gui/server.js` | Partial | 1 | 26 |
| `gui/resources/app.js` | No | -- | -- |

**Modules with NO tests**:
- `dashboard-html.js` -- Acceptable: pure data/template module, no logic
- `dashboard-standalone.js` -- Minor gap: ~100 LOC standalone HTTP server. Indirectly tested via orchestrator tests
- `gui/resources/app.js` -- Gap: browser state machine, would require DOM/browser testing environment

---

## Phase 2: Antipattern Detection

### 2.1 Implementation Coupling

**Severity: LOW** -- Generally well-managed.

1. **`cli.test.js` / `cli-extended.test.js` -- Heavy mock surface**: These files mock 12+ modules (commander, inquirer, ora, chalk, logger, checks, git, claude, prompts, executor, notifications, report, setup, dashboard). This creates coupling to the module interface -- any export rename breaks tests. However, this is inherent to testing an orchestration module and the mocks are correctly structured.

2. **`cli.test.js` line 418-438 -- Dead test path**: The test `'generates partial report and exits when execution is interrupted'` has a comment admitting "We need to test the abort path... we can't easily trigger SIGINT in tests, let's verify the non-abort path... at least." This test does NOT actually test the abort path it claims to test. The mock implementation has an empty `if (opts?.signal) {}` block that does nothing.

### 2.2 Misleading Tests

**Severity: LOW** -- One notable case found.

1. **`cli.test.js:418` -- Name/behavior mismatch**: Test named `'generates partial report and exits when execution is interrupted'` but it does not actually interrupt execution. The SIGINT is never triggered. The later test at line 537 (`'generates partial report and exits gracefully on first SIGINT'`) does properly test this scenario, making the earlier test redundant and misleading.

### 2.3 Mock Overuse

**Severity: MODERATE** -- Two structural patterns worth noting.

1. **`gui-server.test.js` -- Re-implemented routing**: Because `gui/server.js` has top-level side effects (creates and starts a server on import), the test file re-implements the entire routing logic from scratch (~120 lines of routing code). This means the test file tests its own re-implementation, NOT the actual server code. If the server's routing logic diverges from the test's copy, tests will still pass while real behavior breaks. The test file acknowledges this in its header comment.

2. **`cli.test.js` + `cli-extended.test.js` -- Duplicated mock blocks**: Both files contain nearly identical 100-line mock setup blocks. While this is a common pattern in Vitest (mocks must be declared before imports), the duplication means any mock needs updating in both files.

3. **`orchestrator.test.js` + `orchestrator-extended.test.js`**: Same duplication pattern -- ~90 lines of identical mocks in both files. The `createMockChildProcess` helper is also duplicated between these two files rather than extracted to `test/helpers/mocks.js`.

### 2.4 Wrong Test Level

**Severity: LOW** -- Generally well-classified.

1. **`gui-server.test.js` labeled as "Integration"**: This spins up a real HTTP server and makes fetch requests, which is correct integration testing. No concerns here.

2. **`dashboard.test.js`**: Spins up real HTTP servers per test via `vi.resetModules()` + fresh import. This is correctly classified as integration but generates 20 server start/stops per suite. No issues observed, just something to note.

### 2.5 Shared/Leaking State

**Severity: LOW** -- Well-managed.

1. **`logger.test.js`**: Correctly uses `vi.resetModules()` per test to reset logger singleton state. Good pattern.

2. **`dashboard.test.js`**: Each `describe` block does `vi.resetModules()` + fresh import in `beforeEach`, with `stopDashboard()` in `afterEach`. Proper isolation.

3. **`git.test.js` + `git-extended.test.js`**: Uses real temp directories with `robustCleanup` in `afterEach`. Proper isolation.

4. **`process.stdin.isTTY` mutation in `cli.test.js`**: Set in `beforeEach`, deleted in `afterEach`. Minor concern: if a test throws before `afterEach`, this could leak. Using `try/finally` would be safer, but Vitest's `afterEach` runs even on failure, so this is fine in practice.

### 2.6 Duplication/Bloat

**Severity: MODERATE** -- Several patterns observed.

1. **`makeExecutionResults` helper**: Duplicated identically in both `cli.test.js` (line 136-159) and `cli-extended.test.js` (line 136-151). Should live in `test/helpers/testdata.js`.

2. **`makeInitialState` helper**: Duplicated across `dashboard.test.js` (line 21-38), `dashboard-extended.test.js` (line 20-37), and `dashboard-broadcastoutput.test.js` (line 30-46). Three copies with identical structure.

3. **`createMockChildProcess` helper**: Duplicated in `orchestrator.test.js` (line 91-101) and `orchestrator-extended.test.js` (line 99-108). Should be in `test/helpers/mocks.js`.

4. **`httpGet`/`httpPost`/`extractCsrfToken`/`connectSSE`/`waitForEvent` helpers**: Defined in `dashboard.test.js` (lines 41-122) but not shared. `dashboard-broadcastoutput.test.js` independently implements its own HTTP request logic (line 179-195).

5. **Mock blocks across cli.test.js / cli-extended.test.js**: ~100 lines nearly identical in both files. While Vitest requires mocks before imports, a shared setup file or factory would reduce duplication.

### 2.7 Test Helper Analysis

**Severity: NONE** -- Helpers are well-implemented.

1. **`test/helpers/cleanup.js`**: `robustCleanup()` correctly handles Windows EBUSY with retry logic. Well-documented.

2. **`test/helpers/mocks.js`**: Four factories (`createMockProcess`, `createErrorProcess`, `createTimeoutProcess`, `createMockGit`) with correct defaults. Used consistently by checks tests and contracts tests.

3. **`test/helpers/testdata.js`**: Two factories (`makeMetadata`, `makeResults`) used by report tests. Correct defaults, no bugs found.

---

## Phase 3: Regression Effectiveness

For each module: "If a developer introduced a subtle bug, would these tests catch it?"

| Module | Rating | Justification |
|--------|--------|---------------|
| `cli.js` | **Strong** | 58 tests covering happy path, error paths, all CLI flags, SIGINT handling, dashboard integration, step callbacks, non-TTY mode. Mock-heavy but comprehensive. |
| `executor.js` | **Strong** | 11 tests covering success, failure, doc-update failure, fallback commits, abort signal, callbacks, timeout passthrough. Good failure-path coverage. |
| `claude.js` | **Strong** | 25 tests covering success, retry logic, timeout, empty stdout, ENOENT, abort signal, stdin mode, Windows shell, onOutput callback. Excellent edge case coverage. |
| `git.js` | **Strong** | 23 tests using real git repos. Covers tags, branches, merges, conflicts, ephemeral file exclusion, collision handling. Integration tests with real I/O. |
| `checks.js` | **Strong** | 17 tests covering all 6 pre-checks (git installed, git repo, has commits, Claude installed, Claude auth, disk space). Error paths and fallbacks well-covered. |
| `logger.js` | **Strong** | 10 tests with real file I/O against temp dirs. Covers initialization, all log levels, level filtering, env var, stderr fallback, timestamp format. |
| `notifications.js` | **Weak** | Only 2 tests: verify call shape and error swallowing. No test for async notification, multiple calls, or edge cases. However, the module is simple (~10 LOC), so 2 focused tests may suffice. |
| `report.js` | **Strong** | 22 tests covering report generation, CLAUDE.md create/append/replace, format duration edge cases, content structure, report commit failure. |
| `setup.js` | **Strong** | 7 unit tests + 3 integration tests. Covers create/append/update flows, idempotency, content preservation. |
| `dashboard.js` | **Strong** | 28 tests across 3 files covering HTTP server, SSE events, CSRF, file management, broadcast, throttle, buffer overflow, scheduled shutdown. |
| `dashboard-tui.js` | **Strong** | 22 tests covering formatMs, progressBar, render with various states. Good edge case coverage (many steps, null startTime, output truncation). |
| `lock.js` | **Strong** | 9 tests covering acquire, stale lock removal, contention, corrupt JSON, persistent mode, release. Real filesystem operations. |
| `orchestrator.js` | **Strong** | 42 tests across 2 files covering initRun, runStep, finishRun, dashboard integration, edge cases (corrupt state, version mismatch, timeout passthrough, merge failure). |
| `prompts/loader.js` | **Strong** | 8 structural tests verifying 33 steps, manifest integrity, markdown file existence. Catches data corruption. |
| `gui/resources/logic.js` | **Strong** | 39 tests covering all 6 pure functions with edge cases (null, empty, Windows/Linux, CRLF). |
| `gui/server.js` | **Decorative** | 26 tests but they test a re-implemented routing mock, not the actual server code. Would NOT catch bugs in the real server.js. |
| `gui/resources/app.js` | **None** | No tests. Browser state machine with DOM dependencies. |
| `dashboard-html.js` | **N/A** | Data-only module, no logic to test. |
| `dashboard-standalone.js` | **Weak** | No direct tests. Indirectly exercised through orchestrator tests that mock its spawn behavior. |

### Summary Ratings

| Rating | Count | Modules |
|--------|-------|---------|
| Strong | 14 | cli, executor, claude, git, checks, logger, report, setup, dashboard, dashboard-tui, lock, orchestrator, loader, gui/logic |
| Weak | 2 | notifications, dashboard-standalone |
| Decorative | 1 | gui/server (tests test a mock, not the real code) |
| None | 1 | gui/resources/app.js |
| N/A | 1 | dashboard-html.js (data only) |

---

## Phase 4: Structural Assessment

### 4.1 Test Organization

**Rating: GOOD**

- All tests in a flat `test/` directory -- simple, predictable
- Shared helpers properly extracted to `test/helpers/` (cleanup, mocks, testdata)
- Extended tests use `-extended` suffix for secondary test files covering the same module
- Naming convention: `{module}.test.js` or `{module}-{variant}.test.js`
- No test files in source directories (good separation)

**Minor issues**:
- The `gui-logic.test.js` and `gui-server.test.js` files break the pattern of testing `src/` modules -- they test `gui/` modules. This is fine but could cause confusion.
- The split between `*.test.js` and `*-extended.test.js` is driven by mock strategies (different mock setups) rather than logical grouping. This is a pragmatic Vitest pattern, not an antipattern.

### 4.2 Naming Conventions

**Rating: EXCELLENT**

- Descriptive test names using natural language: `'returns failure with timeout message when spawn never closes'`
- Consistent `describe` grouping by feature area
- Test names follow "expected behavior when condition" pattern
- Section comments in larger files (e.g., `// ---- Happy path ----`) aid readability
- No cryptic abbreviations

### 4.3 Setup/Teardown Patterns

**Rating: GOOD**

- Consistent `vi.clearAllMocks()` in `beforeEach` across all files
- `robustCleanup()` used consistently for temp directories (Windows-safe)
- `vi.resetModules()` used correctly for singleton-state modules (logger, dashboard)
- `mockRestore()` properly called in `afterEach` for process spies
- `vi.useRealTimers()` properly reset in `afterEach` when fake timers are used

**One concern**:
- `logger.test.js` mutates `process.env.NIGHTYTIDY_LOG_LEVEL` in some tests with `try/finally` cleanup. This is correct but fragile -- if Vitest runs tests in parallel within the file, env var mutations could conflict. Current config runs tests sequentially within files, so this is safe.

### 4.4 Test Configuration

**Rating: GOOD with one gap**

`vitest.config.js`:
- Coverage thresholds enforced: 90% statements, 80% branches, 80% functions
- Strip-shebang plugin handles Windows CRLF for dashboard-tui.js
- Missing: `coverage.include` -- this means coverage calculations include `gui/`, `bin/`, and `scripts/` which drags overall metrics below 90% even when `src/` is well-covered
- No explicit test timeout configuration (Vitest defaults apply)
- No test file include/exclude patterns (convention-based `*.test.js` glob works)

---

## Key Findings Summary

### Strengths

1. **Healthy testing pyramid**: 61% unit, 24% integration, 9% contract, 2% structural, 1% smoke. No over-reliance on any single level.

2. **Contract tests are an outstanding practice**: `contracts.test.js` with 38 tests verifying documented error-handling contracts is a rare and valuable layer. This catches doc-vs-code drift automatically.

3. **Real git integration tests**: `git.test.js` and `git-extended.test.js` use real temp git repos, catching issues that mocks would miss (e.g., Windows file handle locking).

4. **Comprehensive edge case coverage**: Tests for abort signals, empty stdout, timeout, ENOENT, corrupt JSON, stale locks, merge conflicts -- failure paths are tested more thoroughly than happy paths in many modules.

5. **Well-designed test helpers**: `robustCleanup()` for Windows, `createMockProcess()` family, `makeMetadata()`/`makeResults()` factories are correct and shared.

6. **Deterministic test suite**: 0 flaky tests across 3 consecutive runs (per `testing.md`). Proper use of polling-based waits instead of fixed delays for SSE tests.

### Issues Found

1. **gui/server.js tests are decorative** (MODERATE): The tests re-implement the server routing and test that copy instead of the real code. This is documented but represents a real regression gap.

2. **Duplicated helpers across test files** (LOW): `makeExecutionResults`, `makeInitialState`, `createMockChildProcess`, and HTTP helpers are duplicated across 2-3 files each. Not a bug, but increases maintenance cost.

3. **One misleading test** (LOW): `cli.test.js:418` claims to test interruption but does not. The actual interruption tests exist elsewhere in the file.

4. **Coverage config gap** (LOW): `vitest.config.js` has no `coverage.include`, causing gui/bin/scripts to dilute src coverage metrics.

5. **gui/resources/app.js has no tests** (LOW): Browser state machine. Would require a DOM testing environment (jsdom, happy-dom) to test.

### What Does NOT Need Fixing

- Mock surface area in CLI tests is large but necessary for orchestration testing
- Extended test file pattern (`-extended.test.js`) is a pragmatic Vitest pattern
- Notification tests being only 2 is proportionate to the module's ~10 LOC size
- No E2E tests is correct per project policy

---

## Recommendations

### Priority 1: Fix misleading test
- Remove or rename `cli.test.js:418` test (`'generates partial report and exits when execution is interrupted'`) -- it does not test what it claims. The real abort test exists at line 537.

### Priority 2: Extract duplicated helpers
- Move `makeExecutionResults` to `test/helpers/testdata.js`
- Move `makeInitialState` to `test/helpers/testdata.js`
- Move `createMockChildProcess` (orchestrator version) to `test/helpers/mocks.js`
- Move HTTP helpers (httpGet, httpPost, connectSSE, etc.) to a `test/helpers/http.js`

### Priority 3: Coverage config
- Add `coverage.include: ['src/**']` to `vitest.config.js` so gui/bin/scripts code doesn't dilute src coverage metrics

### Priority 4: gui/server.js testability
- Add `if (import.meta.url === ...)` guard to prevent side effects on import
- Then test the actual routing code instead of a re-implemented copy

### Not recommended
- Do NOT add DOM testing infrastructure for `gui/resources/app.js` -- YAGNI until GUI is stabilized
- Do NOT refactor mock blocks into shared setup files -- Vitest's hoisting requirements make this fragile
