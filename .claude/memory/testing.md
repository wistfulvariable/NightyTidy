# Testing — Tier 2 Reference

Assumes CLAUDE.md loaded. 404 tests, 27 files, Vitest v2.

## Test File -> Module Coverage

| Test File | Module | Tests |
|-----------|--------|-------|
| `smoke.test.js` | All (structural) | 6 |
| `cli.test.js` | `cli.js` | 27 |
| `dashboard.test.js` | `dashboard.js` | 20 |
| `logger.test.js` | `logger.js` | 10 |
| `checks.test.js` | `checks.js` | 4 |
| `checks-extended.test.js` | `checks.js` | 13 |
| `claude.test.js` | `claude.js` | 25 |
| `executor.test.js` | `executor.js` | 11 |
| `git.test.js` | `git.js` | 16 |
| `git-extended.test.js` | `git.js` | 7 |
| `notifications.test.js` | `notifications.js` | 2 |
| `report.test.js` | `report.js` | 7 |
| `report-extended.test.js` | `report.js` | 15 |
| `steps.test.js` | `prompts/loader.js` | 8 |
| `integration.test.js` | Multi-module | 5 |
| `setup.test.js` | `setup.js` | 7 |
| `cli-extended.test.js` | `cli.js` | 31 |
| `dashboard-extended.test.js` | `dashboard.js` | 3 |
| `dashboard-tui.test.js` | `dashboard-tui.js` | 22 |
| `integration-extended.test.js` | Multi-module | 6 |
| `orchestrator.test.js` | `orchestrator.js` | 31 |
| `contracts.test.js` | All modules | 38 |
| `gui-logic.test.js` | `gui/resources/logic.js` | 39 |
| `gui-server.test.js` | `gui/server.js` | 26 |
| `lock.test.js` | `lock.js` | 9 |
| `orchestrator-extended.test.js` | `orchestrator.js` | 11 |
| `dashboard-broadcastoutput.test.js` | `dashboard.js` | 5 |

## Test Helpers (`test/helpers/`)

| File | Exports | Used By |
|------|---------|---------|
| `cleanup.js` | `robustCleanup(dir, maxAttempts?, delay?)` | All integration tests with temp dirs |
| `mocks.js` | `createMockProcess()`, `createErrorProcess()`, `createTimeoutProcess()`, `createMockGit()` | checks tests, contracts tests |
| `testdata.js` | `makeMetadata(overrides)`, `makeResults({ completedCount, failedCount })` | report tests |

## Universal Logger Mock

```js
vi.mock('../src/logger.js', () => ({
  initLogger: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(),
}));
```

Without this: tests crash writing `nightytidy-run.log`. Exception: `logger.test.js` tests real logger.

## Common Pitfalls

- **Windows EBUSY on temp dirs**: git holds handles. Always `robustCleanup()`, never raw `rm()`
- **Forgetting `vi.clearAllMocks()` in beforeEach** — mock state leaks between tests
- **Not advancing fake timers** — retry/timeout tests hang forever
- **git tests need `initGit(tempDir)`** — module singleton must reset per test
- **Non-TTY stdin** — `process.stdin.isTTY` falsy in test envs; CLI tests need `--all` or `--steps`
- **loader.js + mocked fs** — tests mocking `fs` must also mock `prompts/loader.js` or the loader breaks at import time
- **vi.doMock() leaks** — registrations persist across `vi.resetModules()`. Must `vi.doUnmock()` in `afterEach`
- **lock.js needs real filesystem** — uses `openSync('wx')` for atomic create; mock fs loses the semantics. Use real temp dirs with `robustCleanup()`
- **broadcastOutput throttle** — uses real `setTimeout(500ms)`. Tests must `await` a real delay (700ms+) to verify the throttled write fires
- **gui/resources/logic.js coverage** — loaded via `eval` in tests, so v8 coverage tool reports 0% despite 39 tests. Coverage config should exclude or handle this
- **Coverage threshold gap** — `vitest.config.js` has no `include`/`exclude` for coverage. `gui/`, `bin/`, `scripts/` drag overall coverage below 90% even when `src/` is at ~90%. Consider adding `coverage.include: ['src/**']`
- **gui/server.js not importable** — top-level `createServer()` + `listen()` + `launchChrome()` causes side effects on import. Tests must re-implement routing logic. Consider guarding with `if (import.meta.url === ...)` for direct testability

## Flaky Test Audit (2026-03-09)

Suite passed 3/3 consecutive runs, 0 flaky tests. Key timing patterns are safe:
- `dashboard-broadcastoutput`: 700ms wait for 500ms throttle (200ms buffer, sufficient)
- `dashboard.test.js`: polling-based SSE event waits (no fixed delays, proper timeouts)
- `lock.test.js`: 5-second tolerance for timestamp freshness check (generous)

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
