# Testing — Tier 2 Reference

Assumes CLAUDE.md loaded. 248 tests, 21 files, Vitest v2.

## Test File → Module Coverage

| Test File | Module | Tests | Type |
|-----------|--------|-------|------|
| `smoke.test.js` | All (structural) | 6 | Smoke — deploy verification |
| `cli.test.js` | `cli.js` | 27 | Unit (mocked lifecycle) |
| `dashboard.test.js` | `dashboard.js` | 14 | Unit + Integration (real HTTP) |
| `logger.test.js` | `logger.js` | 10 | Integration (real file I/O) |
| `checks.test.js` | `checks.js` | 4 | Unit (mocked subprocess) |
| `checks-extended.test.js` | `checks.js` | 12 | Unit (auth, disk, empty repo) |
| `claude.test.js` | `claude.js` | 21 | Unit (fake process, fake timers) |
| `executor.test.js` | `executor.js` | 9 | Unit (mocked claude, git) |
| `git.test.js` | `git.js` | 16 | Integration (real git, temp dirs) |
| `git-extended.test.js` | `git.js` | 7 | Integration (collision, empty repo) |
| `notifications.test.js` | `notifications.js` | 2 | Unit (mock notifier) |
| `report.test.js` | `report.js` | 7 | Unit (mock fs) |
| `report-extended.test.js` | `report.js` | 15 | Unit (CLAUDE.md update, edge cases) |
| `steps.test.js` | `prompts/steps.js` | 6 | Structural integrity |
| `integration.test.js` | Multi-module | 5 | Integration (real git + fs) |
| `setup.test.js` | `setup.js` | 7 | Unit (mock fs) |
| `cli-extended.test.js` | `cli.js` | 20 | Unit (dashboard state, abort paths) |
| `dashboard-extended.test.js` | `dashboard.js` | 3 | Unit (TUI spawn, error paths) |
| `dashboard-tui.test.js` | `dashboard-tui.js` | 18 | Unit (TUI rendering, chalk proxy) |
| `integration-extended.test.js` | Multi-module | 6 | Integration (abort, ephemeral, report) |
| `contracts.test.js` | All modules | 31 | Contract verification vs CLAUDE.md |

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

## Mock Patterns

### Fake ChildProcess (claude.test.js)
- `createFakeChild()` → EventEmitter with `.stdout`, `.stderr`, `.stdin`, `.kill`
- `setupSpawnSequence(...behaviors)` configures multiple spawn calls in order
- Schedule events via `queueMicrotask()` — listeners attach before events fire
- `vi.useFakeTimers({ shouldAdvanceTime: true })` for retry/timeout tests

### Mock subprocess (checks tests)
- `createMockProcess({ code, stdout, stderr })` from `test/helpers/mocks.js`
- Conditional mock: `spawn.mockImplementation((cmd, args) => { if (cmd === 'git') ... })`

### Real git integration (git tests, integration tests)
- Create temp dir: `mkdtemp(path.join(tmpdir(), 'nightytidy-test-'))`
- Init repo: `git init` + config `user.email`/`user.name` + initial commit
- Call `initGit(tempDir)` to set module singleton per test
- Cleanup: `robustCleanup(tempDir)` — NEVER raw `rm()`

### Mock fs (report, setup tests)
- `vi.mock('fs', () => ({ writeFileSync: vi.fn(), readFileSync: vi.fn(), existsSync: vi.fn() }))`

### vi.doMock isolation (contracts.test.js)
- `vi.resetModules()` + `vi.doMock()` in `beforeEach`
- **Must** `vi.doUnmock()` in `afterEach` — registrations persist across `resetModules()`
- Dynamic import AFTER mocks: `const { fn } = await import('../src/module.js')`

## Common Pitfalls

- **Windows EBUSY on temp dirs**: git holds handles. Always `robustCleanup()`, never raw `rm()`
- **Forgetting `vi.clearAllMocks()` in beforeEach** — mock state leaks between tests
- **Not advancing fake timers** — retry/timeout tests hang forever
- **`queueMicrotask` vs `process.nextTick`** — checks tests use nextTick, claude tests use queueMicrotask
- **git tests need `initGit(tempDir)`** — module singleton must reset per test
- **Dashboard state mutability** — `dashState` is shared reference; test shape, not initial values
- **Non-TTY stdin** — `process.stdin.isTTY` falsy in test envs; CLI tests need `--all` or `--steps`
