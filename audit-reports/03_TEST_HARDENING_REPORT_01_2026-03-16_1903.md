# Test Hardening Report

**Run:** 01
**Date:** 2026-03-16 19:03
**Branch:** nightytidy/run-2026-03-16-1828
**Duration:** ~15 minutes

---

## 1. Summary

| Metric | Count |
|--------|-------|
| Flaky tests found and fixed | 4 |
| Flaky tests found but couldn't fix | 0 |
| Previously disabled tests re-enabled | 0 |
| API endpoints found | 3 |
| Contract tests written | 14 |
| Documentation discrepancies found | 2 |

---

## 2. Flaky Tests Fixed

| Test Name | File | Root Cause | Fix Applied |
|-----------|------|-----------|-------------|
| singleton guard — cleans up stale lock file with dead PID | `NightyTidy/test/gui-server.test.js` | Vitest scanned `.worktrees/` directories, running duplicate test files from multiple worktrees simultaneously. All instances competed for the same global lock file at `tmpdir()/nightytidy-gui.lock`, causing race conditions. | Added `.worktrees/**` to vitest exclude config, eliminating 91 duplicate test files. |
| singleton guard — detects existing instance and exits | `NightyTidy/test/gui-server.test.js` | Same root cause — worktree duplication caused multiple server instances to interfere with each other's lock files. | Same fix — vitest.config.js exclude pattern. |
| broadcastOutput throttle tests (3 tests) | `NightyTidy/test/dashboard-broadcastoutput.test.js` | Tests used `setTimeout(r, 700)` to wait for a 500ms throttle to fire. Under load, the 200ms buffer could be exceeded. Additionally, the file could be read before the throttle write if `startDashboard` wrote an initial progress file. | Replaced all 3 `setTimeout` waits with a predicate-based polling function (`waitForProgressFile`) that waits for specific content to appear in the progress file, with a 3-second timeout. |
| webhookIngest — defaults startedAt to Date.now() | `functions/src/__tests__/webhookIngest.test.ts` | Test bracketed the SUT call with `before = Date.now()` / `after = Date.now()` and asserted `startedAt` fell within the window. At minute boundaries or under GC pauses, the window could be zero-width. | Replaced with `vi.useFakeTimers({ now: FIXED_NOW })` for deterministic timestamp, asserting exact equality. |

---

## 3. Flaky Tests Unresolved

None. All identified flaky tests were fixed.

---

## 4. API Endpoint Map

| Method | Path | Auth Required | Rate Limited | Existing Tests | Contract Tests |
|--------|------|:---:|:---:|:---:|:---:|
| POST | `/webhookIngest` | Bearer token | 60/min | 16 | 8 |
| GET | `/runs` | Bearer token | No | 8 | 2 |
| GET | `/status` | None | No | 1 | 1 |
| **Totals** | | | | **25** | **14** |

### webhookIngest Events

| Event | Document Path | Merge Mode |
|-------|--------------|------------|
| `run_started` | `users/{uid}/runs/{runId}` | Full set |
| `step_completed` | `users/{uid}/runs/{runId}` + `users/{uid}/runs/{runId}/steps/{num}` + `stepStats/{num}` | Merge |
| `step_failed` | `users/{uid}/runs/{runId}` + `users/{uid}/runs/{runId}/steps/{num}` | Merge |
| `run_completed` | `users/{uid}/runs/{runId}` | Merge |
| `run_failed` | `users/{uid}/runs/{runId}` | Merge |
| (unknown) | `users/{uid}/runs/{runId}` | Merge (generic fallback) |

---

## 5. Documentation Discrepancies

| Area | What Types Say | What Code Does |
|------|---------------|----------------|
| `Run.status` enum | `'running' \| 'completed' \| 'failed' \| 'cancelled'` | Cloud Functions never set `status: 'cancelled'`. There is no `run_cancelled` event handler in `webhookIngest.ts`. The `cancelled` status value in the TypeScript interface is never produced by the backend. |
| `status` endpoint | No type interface defined | Returns `{ status: 'ok', version: '1.0.0' }` — this response shape has no corresponding TypeScript interface in `src/lib/types.ts`. |

---

## 6. Undocumented Behavior

| Behavior | Details |
|----------|---------|
| Rate limit fail-open | If the Firestore rate limit transaction throws, the webhook silently continues (fail-open). This is intentional but not documented anywhere. |
| Empty body tolerance | `webhookIngest` accepts completely empty POST bodies `{}` and returns 200. If `body.run.id` is missing, no Firestore writes occur but the response is still `{ ok: true }`. |
| `stepStats` aggregation | Step completion triggers writes to a global `stepStats/{paddedNumber}` collection with anonymous aggregate data (sample count, total cost, total duration). This behavior is not documented in any README or types file. |
| `run_started` defaults | Missing `startedAt` defaults to `Date.now()`, missing `selectedSteps` defaults to `[]`, missing `gitBranch`/`gitTag` default to `''`. |
| Non-string projectId ignored | If `projectId` query parameter is an array (e.g., `?projectId=a&projectId=b`), it's silently ignored rather than returning an error. |
| Runs query limit | The `runs` endpoint hard-limits to 100 most recent runs, ordered by `startedAt desc`. This limit is not configurable and not documented. |

---

## 7. Recommendations

| # | Recommendation | Impact | Risk if Ignored | Worth Doing? | Details |
|---|---|---|---|---|---|
| 1 | Keep `.worktrees/` exclusion in vitest config permanently | Eliminates the most impactful source of test flakiness — 91 duplicate test files were running in parallel with shared global state | **Critical** | Yes | This was causing 1-3 random test failures on every run. The fix is one line in `vitest.config.js`. |
| 2 | Add `run_cancelled` event to webhookIngest | Eliminates type/behavior drift — frontend expects `cancelled` as a valid status but backend never produces it | **Medium** | Probably | Either add the event handler or remove `cancelled` from the `Run.status` union type. Current state is a contract mismatch. |
| 3 | Replace remaining `setTimeout` waits in other test files | `dashboard.test.js` and `dashboard-error-paths.test.js` still use fixed-delay setTimeout patterns | **Medium** | Only if time allows | The broadcastOutput tests were the worst offenders and are now fixed. The remaining setTimeout waits have shorter delays and haven't been observed to flake, but they follow the same anti-pattern. |
| 4 | Document rate limit fail-open behavior | Operational visibility — on-call should know the webhook will accept requests if Firestore is degraded | **Low** | Only if time allows | A one-line comment in the function and a note in the API docs would suffice. |

---

## 8. Test Results After Hardening

### NightyTidy CLI
- **Before:** 131 test files (91 duplicates from worktrees), 2857 tests, 1-3 random failures per run
- **After:** 40 test files, 913 tests, 5/5 consecutive passes

### NightyTidy Web App
- 4 test files, 62 tests, all passing

### NightyTidy Functions
- **Before:** 3 test files, 25 tests
- **After:** 4 test files, 39 tests (14 new contract tests)

### Total Test Count
- **Before:** 2944 tests (including duplicates), intermittent failures
- **After:** 1014 tests (deduplicated), 0 failures across 5 consecutive runs

---

## 9. Files Modified

| File | Change |
|------|--------|
| `NightyTidy/vitest.config.js` | Added `.worktrees/**` to test exclude patterns |
| `NightyTidy/test/dashboard-broadcastoutput.test.js` | Replaced 3 `setTimeout` waits with predicate-based polling |
| `nightytidy-web/functions/src/__tests__/webhookIngest.test.ts` | Replaced `Date.now()` boundary checks with `vi.useFakeTimers` for deterministic timestamps |
| `nightytidy-web/functions/src/__tests__/apiContracts.test.ts` | **New file** — 14 API contract tests |
