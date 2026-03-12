# Testing — Tier 2 Reference

Assumes CLAUDE.md loaded. 913 tests, 40 files, Vitest v3.

## Test File -> Module Coverage

| Test File | Module | Tests |
|-----------|--------|-------|
| `smoke.test.js` | All (structural) | 6 |
| `cli.test.js` | `cli.js` | 33 |
| `cli-extended.test.js` | `cli.js` | 31 |
| `cli-resume.test.js` | `cli.js` (--resume) | 23 |
| `cli-sync.test.js` | `cli.js` (sync paths) | 6 |
| `checks.test.js` | `checks.js` | 4 |
| `checks-extended.test.js` | `checks.js` | 23 |
| `claude.test.js` | `claude.js` | 73 |
| `consolidation.test.js` | `consolidation.js` | 15 |
| `contracts.test.js` | All modules | 40 |
| `dashboard.test.js` | `dashboard.js` | 20 |
| `dashboard-broadcastoutput.test.js` | `dashboard.js` | 5 |
| `dashboard-extended.test.js` | `dashboard.js` | 3 |
| `dashboard-extended2.test.js` | `dashboard.js` | 4 |
| `dashboard-tui.test.js` | `dashboard-tui.js` | 29 |
| `env.test.js` | `env.js` | 15 |
| `executor.test.js` | `executor.js` | 51 |
| `executor-extended.test.js` | `executor.js` | 13 |
| `git.test.js` | `git.js` | 16 |
| `git-extended.test.js` | `git.js` | 11 |
| `gui-logic.test.js` | `gui/resources/logic.js` | 145 |
| `gui-server.test.js` | `gui/server.js` | 47 |
| `integration.test.js` | Multi-module | 5 |
| `integration-extended.test.js` | Multi-module | 6 |
| `lock.test.js` | `lock.js` | 9 |
| `lock-extended.test.js` | `lock.js` | 6 |
| `logger.test.js` | `logger.js` | 10 |
| `notifications.test.js` | `notifications.js` | 2 |
| `orchestrator.test.js` | `orchestrator.js` | 63 |
| `orchestrator-extended.test.js` | `orchestrator.js` | 11 |
| `report.test.js` | `report.js` | 43 |
| `report-extended.test.js` | `report.js` | 19 |
| `setup.test.js` | `setup.js` | 7 |
| `steps.test.js` | `prompts/loader.js` | 12 |
| `sync.test.js` | `sync.js` | 67 |
| `checks-timeout.test.js` | `checks.js` | 1 |
| `dashboard-error-paths.test.js` | `dashboard.js` | 7 |
| `lock-edge-cases.test.js` | `lock.js` | 6 |
| `mutation-testing.test.js` | Multi-module | 16 |
| `report-edge-cases.test.js` | `report.js` | 10 |

## Test Helpers (`test/helpers/`)

| File | Exports | Used By |
|------|---------|---------|
| `cleanup.js` | `robustCleanup(dir, maxAttempts?, delay?)` | All integration tests with temp dirs |
| `mocks.js` | `createLoggerMock()`, `createMockProcess()`, `createErrorProcess()`, `createTimeoutProcess()`, `createMockGit()` | all test files (logger), checks tests, contracts tests |
| `testdata.js` | `makeMetadata(overrides)`, `makeResults({ completedCount, failedCount })` | report tests |

## Universal Logger Mock

```js
import { createLoggerMock } from './helpers/mocks.js';
vi.mock('../src/logger.js', () => createLoggerMock());
```

All 33 test files (except `logger.test.js`) use `createLoggerMock()` from `test/helpers/mocks.js`. The factory returns `{ initLogger, info, warn, error, debug }` as `vi.fn()` mocks. Without this: tests crash writing `nightytidy-run.log`. Exception: `logger.test.js` tests real logger.

## Common Pitfalls

- **Windows EBUSY on temp dirs**: git holds handles. Always `robustCleanup()`, never raw `rm()`
- **Forgetting `vi.clearAllMocks()` in beforeEach** — mock state leaks between tests
- **Not advancing fake timers** — retry/timeout tests hang forever
- **git tests need `initGit(tempDir)`** — module singleton must reset per test
- **Non-TTY stdin** — `process.stdin.isTTY` falsy in test envs; CLI tests need `--all` or `--steps`
- **loader.js + mocked fs** — tests mocking `fs` must also mock `prompts/loader.js` or the loader breaks at import time
- **vi.doMock() leaks** — registrations persist across `vi.resetModules()`. Must `vi.doUnmock()` in `afterEach`
- **claude.js mock must include ERROR_TYPE + sleep** — all 8+ test files that mock `../src/claude.js` must export `ERROR_TYPE: { RATE_LIMIT: 'rate_limit', UNKNOWN: 'unknown' }` and `sleep: vi.fn(() => Promise.resolve())`. This includes `vi.doMock` sites in `contracts.test.js`. Missing → `No "ERROR_TYPE" export is defined on the mock`
- **lock.js needs real filesystem** — uses `openSync('wx')` for atomic create; mock fs loses the semantics. Use real temp dirs with `robustCleanup()`
- **orchestrator.js fs mock must include renameSync** — `writeState()` uses write-to-temp-then-rename; missing `renameSync: vi.fn()` in the fs mock causes silent failures caught by try/catch (audit #21)
- **git.js mock must include ensureOnBranch** — `orchestrator.test.js` and `orchestrator-extended.test.js` mock `git.js` and must include `ensureOnBranch: vi.fn(async () => ({ recovered: false }))`. Default `recovered: false` skips recovery; set `recovered: true` in tests verifying branch guard behavior
- **broadcastOutput throttle** — uses real `setTimeout(500ms)`. Tests must `await` a real delay (700ms+) to verify the throttled write fires
- **gui/resources/logic.js coverage** — loaded via `eval` in tests, so v8 coverage tool reports 0% despite 46 tests. Coverage config should exclude or handle this
- **Coverage scoping** — `vitest.config.js` uses `coverage.include: ['src/**']` and excludes standalone scripts (`dashboard-standalone.js`, `dashboard-tui.js`). Without this, gui/bin/scripts/tmp files drag coverage below 90%. The vendored `marked.umd.js` references a missing `.map` file that crashes the v8 coverage provider if not excluded
- **gui/server.js not importable** — top-level `createServer()` + `listen()` + `launchChrome()` causes side effects on import. Tests must re-implement routing logic. Consider guarding with `if (import.meta.url === ...)` for direct testability

## Flaky Test Audit (2026-03-09)

Suite passed 3/3 consecutive runs, 0 flaky tests. Key timing patterns are safe:
- `dashboard-broadcastoutput`: 700ms wait for 500ms throttle (200ms buffer, sufficient)
- `dashboard.test.js`: polling-based SSE event waits (no fixed delays, proper timeouts)
- `lock.test.js`: 5-second tolerance for timestamp freshness check (generous)

## Test Architecture Audit Findings (2026-03-09)

See `audit-reports/04_TEST_ARCHITECTURE_REPORT.md` for full report (404 tests, 27 files).

**Antipatterns found**:
- `gui-server.test.js`: decorative — re-implements routing (~120 LOC) instead of testing actual `gui/server.js` (side-effect imports block direct testing)
- Duplicated `makeInitialState()` in `dashboard.test.js`, `dashboard-extended.test.js`, `dashboard-broadcastoutput.test.js` — extract to `test/helpers/testdata.js`
- Duplicated `createMockChildProcess()` in `orchestrator.test.js` + `orchestrator-extended.test.js` — extract to `test/helpers/mocks.js`
- Duplicated mock block + `makeExecutionResults()` in `cli.test.js` + `cli-extended.test.js` — shared via extended importing from base
- `gui/resources/app.js` has zero test coverage (state machine, ~580 LOC)
- **ora mock needs `succeed` and `fail`** — `cli.js` uses `checkSpinner.succeed()` and `checkSpinner.fail()` (added audit #26). Both `cli.test.js` and `cli-extended.test.js` ora mocks must include these methods

**Strengths confirmed**: contract tests, real git integration tests, testing pyramid ratio (61% unit, 24% integration, 9% contract, 6% smoke+structural)

## Test Consolidation Audit (2026-03-09)

5 consolidations applied across 5 files, 133 net lines removed, zero coverage loss:
- `checks-extended.test.js`: removed verbatim duplicate auth failure test (13->12 tests)
- `report.test.js`: formatDuration already used `it.each` (no change needed)
- `report-extended.test.js`: formatDuration edge cases already used `it.each` (no change needed)
- `dashboard-tui.test.js`: 3 individual formatMs blocks -> 10-row `it.each` (22->29 tests)
- `gui-logic.test.js`: 6 describe blocks parameterized via `it.each` (39->46 tests)

Pattern: `it.each` rows count as individual tests, so parameterization can increase test count while reducing code lines. This is correct behavior -- each row exercises a distinct input/output pair.

## Contract Test Coverage

`contracts.test.js` verifies documented error handling contracts from CLAUDE.md:
- claude.js: never throws, returns result objects (2 tests)
- git.js: mergeRunBranch returns `{ success, conflict }` (3 tests)
- checks.js: throws Error on failure (2 tests)
- executor.js: never throws, returns result + callbacks (7 tests)
- notifications.js: swallows all errors (1 test)
- report.js: warns but never throws, getVersion, side effects (5 tests)
- logger.js: throws before initialization, exports (2 tests)
- steps.js: data shape (2 tests)
- dashboard.js: swallows errors, startDashboard return shape (4 tests)
- setup.js: returns 'created'/'appended'/'updated' (3 tests)
- orchestrator.js: never throws, returns `{ success: false, error }` (4 tests)
- lock.js: throws on contention, releaseLock never throws (3 tests)
- initialization sequence: logger must init first (1 test)

## Test Quality Audit (2026-03-09)

See `audit-reports/06_TEST_QUALITY_REPORT.md` for full report (6-phase analysis).

**Key quality findings**:
- Error path coverage across critical modules: 90% (71/79 paths tested)
- Assertion density: 24/27 files above 1.5 threshold (healthy)
- Zero tautological assertions found
- 4 execution-only tests identified (incl. gui-server.test.js decorative file)
- 5 test name/assertion mismatches (test names promise more than assertions verify)

**Untested boundaries to watch**:
- `formatDuration(negative)`, `formatDuration(NaN)`, `formatDuration(Infinity)` in report.js -- guard added (returns `'0m 00s'`), but no explicit tests for these edge cases yet
- `executeSteps([])` with empty step array
- `runPrompt('')` with empty prompt string
- `claude.js` STDIN_THRESHOLD boundary (exactly 8000 chars)
- `setup.js` CLAUDE.md with start marker but missing end marker (falls through to append, duplicating)
- `dashboard.js` has 5 untested non-critical catch blocks (progress write, URL write, TUI spawn, buffer overflow, server error)

**Module ratings**: claude.js, executor.js, checks.js, lock.js, orchestrator.js, report.js, notifications.js = Strong. dashboard.js, setup.js = Weak. gui/server.js = Decorative. gui/resources/app.js = None (zero coverage).

## Frontend Quality Audit (2026-03-09)

See `audit-reports/23_FRONTEND_QUALITY_REPORT_1_2026-03-09.md` for full 4-phase report.

**Accessibility fixes applied**: focus-visible styles, ARIA roles (progressbar, alert, status), semantic `<header>` elements, heading hierarchy fix (h3->h2), `aria-labelledby` on sections, `aria-live` regions. Both `gui/resources/index.html` and `src/dashboard-html.js` updated.

**Frontend patterns**:
- GUI and dashboard share CSS custom properties but are separate files (no shared stylesheet)
- `dashboard-html.js` is a template function returning HTML strings — ARIA attributes go inside template literals
- All dynamic content uses `NtLogic.escapeHtml()` (GUI) or `escapeHtml()` (dashboard) before DOM insertion
- Dynamic ARIA updates (progressbar values) must be done in JS, not just in static HTML
- 58 hardcoded user-facing strings across 5 files — no i18n framework warranted
