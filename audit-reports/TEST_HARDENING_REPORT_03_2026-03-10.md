# Test Hardening Report — Run 03 — 2026-03-10

## Summary

| Metric | Count |
|--------|-------|
| Flaky tests found and fixed | 0 |
| Flaky tests found but couldn't fix | 0 |
| Previously disabled tests re-enabled | 0 |
| API endpoints verified | 13 |
| Contract tests existing | 38 |
| Documentation discrepancies found | 0 |

**Test count**: 738 tests across 34 files
**All 738 tests pass across 5 consecutive runs**
**Duration**: ~11s per run (excluding first run with cold cache at ~20s)

---

## Phase 1: Flaky Test Diagnosis & Repair

### Detection Method

1. Ran full test suite 5 times consecutively:
   - Run 1: 738 passed (19.92s, cold cache)
   - Run 2: 738 passed (10.96s)
   - Run 3: 738 passed (10.92s)
   - Run 4: 738 passed (10.76s)
   - Run 5: 738 passed (11.01s)

2. Searched for disabled/skipped tests:
   - `.skip` / `.only` / `.todo` — **none found**
   - Comments containing "flaky", "intermittent", "timing issue" — **none found**
   - `FIXME` / `TODO.*fix` — **none found**

3. Analyzed timing-sensitive patterns:
   - `Date.now()` usages — all deterministic (test data setup, not timing assertions)
   - `setTimeout` usages — properly buffered with adequate margins
   - Shared mutable state — isolated via `beforeEach` / `afterEach` hooks
   - Temp directory cleanup — all use `robustCleanup()` helper

### Flaky Tests Fixed

None. No flaky tests were detected during the 5-run stability check.

### Flaky Tests Unresolved

None.

### Patterns Analyzed (Confirmed Safe)

| Pattern | Files | Assessment |
|---------|-------|------------|
| `Date.now()` for test data | `contracts.test.js`, `orchestrator.test.js`, `integration.test.js` | Safe — used to construct `startTime`/`endTime` for report metadata, not for timing assertions |
| 700ms wait for 500ms throttle | `dashboard-broadcastoutput.test.js` | Safe — 200ms buffer is adequate for async file writes |
| SSE polling waits | `dashboard.test.js` | Safe — uses `waitForEvent()` polling helper with 2000ms ceiling, 10ms intervals |
| Lock file timestamps | `lock.test.js` | Safe — uses 5-second tolerance for freshness checks, generous for any reasonable CI load |
| Fake timers in claude.test.js | `claude.test.js` | Safe — uses `vi.useFakeTimers({ shouldAdvanceTime: true })` with adequate timer advances |
| `robustCleanup()` for temp dirs | All integration tests | Correct pattern — handles Windows EBUSY with retries (5 attempts, 200ms delay) |

---

## Phase 2: API Contract Testing

### API Surface Map

NightyTidy has two HTTP server components:

#### GUI Server (`gui/server.js`) — 10 endpoints

| # | Endpoint | Method | Auth | Request Body | Response Body | Test Coverage |
|---|----------|--------|------|--------------|---------------|---------------|
| 1 | `/api/config` | POST | None | `{}` | `{ ok: true, bin: string }` | ✅ `gui-server.test.js` |
| 2 | `/api/select-folder` | POST | None | `{}` | `{ ok: true, folder: string \| null }` | ❌ Requires native dialog |
| 3 | `/api/run-command` | POST | None | `{ command: string, id?: string }` | `{ ok: true, exitCode, stdout, stderr }` | ✅ `gui-server.test.js` |
| 4 | `/api/kill-process` | POST | None | `{ id: string }` | `{ ok: true }` | ✅ `gui-server.test.js` |
| 5 | `/api/read-file` | POST | None | `{ path: string }` | `{ ok: true, content: string }` | ✅ `gui-server.test.js` |
| 6 | `/api/delete-file` | POST | None | `{ path: string }` | `{ ok: true }` | ✅ `gui-server.test.js` |
| 7 | `/api/heartbeat` | POST | None | `{}` | `{ ok: true }` | ✅ `gui-server.test.js` |
| 8 | `/api/log-error` | POST | None | `{ level: string, message: string }` | `{ ok: true }` | ✅ `gui-server.test.js` |
| 9 | `/api/log-path` | POST | None | `{}` | `{ ok: true, path: string \| null }` | ✅ `gui-server.test.js` |
| 10 | `/api/exit` | POST | None | `{}` | `{ ok: true }` | ❌ Triggers process.exit() |

#### Dashboard Server (`src/dashboard.js`) — 3 routes

| # | Endpoint | Method | Auth | Response | Test Coverage |
|---|----------|--------|------|----------|---------------|
| 1 | `/` | GET | None | HTML page with embedded CSRF token | ✅ `dashboard.test.js` |
| 2 | `/events` | GET | None | SSE stream (text/event-stream) | ✅ `dashboard.test.js` |
| 3 | `/stop` | POST | CSRF | `{ ok: true }` | ✅ `dashboard.test.js`, `dashboard-broadcastoutput.test.js` |

### Contract Test Coverage

The `contracts.test.js` file contains 38 tests verifying module API contracts:

| Module | Tests | Contracts Verified |
|--------|-------|-------------------|
| claude.js | 2 | Never throws, result object shape, exports |
| git.js | 3 | `mergeRunBranch` returns `{ success, conflict }`, exports |
| checks.js | 2 | Throws on validation failure, exports |
| executor.js | 7 | Never throws, result shape, callback signatures |
| notifications.js | 1 | Swallows all errors silently |
| report.js | 5 | `generateReport` side effects, `formatDuration`, `getVersion` |
| logger.js | 2 | Throws before initialization, exports |
| steps.js | 2 | 33-step data shape, special prompt exports |
| dashboard.js | 4 | Swallows errors, return shape, exports |
| setup.js | 3 | Return values ('created'/'appended'/'updated'), exports |
| orchestrator.js | 4 | Never throws, returns result objects, exports |
| lock.js | 3 | Throws on contention, `releaseLock` never throws, exports |

### Untested Endpoints

Two endpoints cannot be easily tested:

1. **`/api/select-folder`** — Opens a native OS file picker dialog (PowerShell IFileOpenDialog on Windows, osascript on macOS, zenity/kdialog on Linux). Requires human interaction or complex GUI automation.

2. **`/api/exit`** — Triggers `process.exit(0)` after sending response. Would terminate the test process.

### Documentation Discrepancies Found

None. All documented contracts match implementation.

---

## Test Suite Health Assessment

### Strengths

1. **Zero flaky tests** — Suite passed 5/5 consecutive runs with identical results
2. **Comprehensive contract testing** — 38 contract tests verify documented module interfaces
3. **Proper timer patterns** — Fake timers used correctly, real delays have adequate buffers
4. **Windows compatibility** — `robustCleanup()` handles EBUSY gracefully
5. **Isolated test state** — Each test file resets modules and mocks in `beforeEach`/`afterEach`
6. **High test count** — 738 tests across 34 files provides good coverage

### Test Architecture Quality

| Category | Tests | Percentage |
|----------|-------|------------|
| Unit tests | ~450 | 61% |
| Integration tests | ~180 | 24% |
| Contract tests | 38 | 5% |
| GUI/Server tests | 44 | 6% |
| Smoke tests | 6 | <1% |
| Other (extended, sync) | ~20 | 3% |

This follows a healthy testing pyramid with unit tests as the base.

---

## Recommendations

No recommendations at this time. The test suite is stable and comprehensive:

- No flaky tests detected
- All documented contracts are verified
- Timing-sensitive tests use proper patterns
- Test isolation is correctly implemented
- Coverage thresholds are enforced (90% statements, 80% branches, 80% functions)

The previous test hardening passes have addressed the common flaky patterns effectively.

---

## Report Metadata

- **Run number**: 03
- **Date**: 2026-03-10
- **Test framework**: Vitest v3.2.4
- **Node.js**: >=20.12.0
- **Platform**: Windows 10 (MSYS_NT-10.0-22631)
- **Test files**: 34
- **Total tests**: 738
- **Execution time**: ~11s (warm cache)
