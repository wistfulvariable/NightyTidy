# Testing — Tier 2 Reference

Assumes CLAUDE.md loaded. 50 tests, 7 files, Vitest v2, no config.

## Test File → Module Coverage

| Test File | Module | Tests | Type |
|-----------|--------|-------|------|
| `checks.test.js` | `checks.js` | 4 | Unit (mocked subprocess + git) |
| `claude.test.js` | `claude.js` | 15 | Unit (fake child process, fake timers) |
| `executor.test.js` | `executor.js` | 5 | Unit (mocks claude, git, notifications) |
| `git.test.js` | `git.js` | 11 | Integration (real git, temp dirs) |
| `notifications.test.js` | `notifications.js` | 2 | Unit (mock node-notifier) |
| `report.test.js` | `report.js` | 7 | Unit (mock fs) |
| `steps.test.js` | `prompts/steps.js` | 6 | Structural integrity |

## Universal Logger Mock (Required in Every Test)

```js
vi.mock('../src/logger.js', () => ({
  info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(),
}));
```

Without this: tests crash trying to write `nightytidy-run.log`.

## Mock Patterns by Module

### claude.test.js — Fake ChildProcess + Fake Timers
- `vi.useFakeTimers({ shouldAdvanceTime: true })` in `beforeEach`
- `vi.useRealTimers()` in `afterEach`
- `createFakeChild()` returns EventEmitter with `.stdout`, `.stderr`, `.stdin`, `.kill`
- `setupSpawnSequence(...behaviors)` configures multiple spawn calls in order
- Schedule events via `queueMicrotask` so listeners attach first
- Use `vi.advanceTimersByTimeAsync()` to test retry delays and timeouts

### checks.test.js — Mock subprocess
- Mock `child_process.spawn` to simulate git/claude command results
- `createMockProcess({ code, stdout, stderr })` — emits on `process.nextTick`
- `createErrorProcess(msg)` — emits error event on next tick
- Mock git object: `{ checkIsRepo: vi.fn(), branch: vi.fn() }`

### executor.test.js — Multi-module mock
- Mocks: `claude.js`, `git.js`, `notifications.js`, `logger.js`, `prompts/steps.js`
- `getHeadHash` and `hasNewCommit` from git need defaults in `beforeEach`
- Test abort: create `AbortController`, abort in `onStepComplete` callback

### git.test.js — Real git integration
- Creates temp dir via `mkdtemp`, initializes real git repo
- Sets `user.email` + `user.name` config (required for commits)
- Calls `initGit(tempDir)` to set the module-level singleton
- Cleans up with `rm(tempDir, { recursive: true, force: true })` in afterEach
- Slowest suite (~13s) due to real git operations

### report.test.js — Mock fs
- Mocks `fs` module: `writeFileSync`, `readFileSync`, `existsSync`
- Inspects `writeFileSync.mock.calls[0][1]` for report content assertions

### steps.test.js — No mocks needed
- Pure structural tests: 28 entries, sequential numbers, non-empty prompts
- Tests `DOC_UPDATE_PROMPT` and `CHANGELOG_PROMPT` are non-empty strings

## Common Pitfalls

- **Forgetting `vi.clearAllMocks()` in beforeEach** — state leaks between tests
- **Not advancing fake timers** — retry/timeout tests hang forever
- **`queueMicrotask` vs `process.nextTick`** — checks.test.js uses `nextTick`, claude.test.js uses `queueMicrotask`
- **git.test.js needs `initGit(tempDir)`** — the module-level singleton must be reset per test
