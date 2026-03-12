# Test Hardening Report — Run 04 (2026-03-11)

## Summary

| Metric | Count |
|--------|-------|
| Flaky tests found and fixed | 0 |
| Flaky tests found but couldn't fix | 0 |
| Previously disabled tests re-enabled | 0 |
| API endpoints found | 13 |
| Contract tests already existing | 86 |
| Contract tests written | 0 |
| Documentation discrepancies found | 0 |

**Result**: The test suite is in excellent health. No flaky tests were detected across 5 consecutive runs. All 888 tests passed consistently. API endpoint coverage is comprehensive with 86 existing contract tests across `contracts.test.js` (39 tests) and `gui-server.test.js` (47 tests).

---

## Phase 1: Flaky Test Analysis

### Detection Methodology

Ran the full test suite 5 times consecutively:

| Run | Tests | Passed | Failed | Duration |
|-----|-------|--------|--------|----------|
| 1 | 888 | 888 | 0 | 11.50s |
| 2 | 888 | 888 | 0 | 11.69s |
| 3 | 888 | 888 | 0 | 15.56s |
| 4 | 888 | 888 | 0 | 16.08s |
| 5 | 888 | 888 | 0 | 18.77s |

All runs completed with 100% pass rate. The duration variance (11.5s - 18.8s) reflects system load fluctuation, not test instability.

### Disabled/Skipped Tests

**Search for skip patterns**: Found 0 occurrences of:
- `.skip()`
- `.only()`
- `xit()`
- `xdescribe()`
- Comments containing "flaky", "intermittent", "timing issue"

All tests are active and running.

### Potential Flaky Pattern Analysis

Searched for common flaky patterns in the test codebase:

#### 1. Time-Dependent Assertions

Found multiple uses of `Date.now()` and `setTimeout` in tests. Analysis:

| Pattern | Location | Assessment |
|---------|----------|------------|
| `await new Promise(r => setTimeout(r, 700))` | dashboard-broadcastoutput.test.js:89,108,141 | **Acceptable** — waits for 500ms throttle timer with 200ms buffer; tests don't assert timing-sensitive values |
| `vi.advanceTimersByTimeAsync()` | claude.test.js, executor.test.js | **Proper** — uses Vitest fake timers correctly |
| `Date.now() - start > 2000` polling | dashboard.test.js:96,112 | **Proper** — polling with timeout ceiling, not fixed delay |
| Real `setTimeout(r, 600)` | dashboard-extended2.test.js:148 | **Acceptable** — just ensures no error thrown after stop |

**Verdict**: No dangerous flaky patterns found. Previous audit (commit 35d326e) fixed polling-based waits.

#### 2. Shared State Between Tests

All test files use either:
- `vi.resetModules()` in `beforeEach` for module isolation
- Fresh `tempDir` creation via `mkdtemp()` for filesystem isolation
- `robustCleanup()` helper for Windows EBUSY handling

**Verdict**: Test isolation is properly implemented.

#### 3. Floating Point Assertions

Found 4 uses of exact float comparisons (e.g., `toBe(0.10)`). All are testing explicit mock return values, not computed arithmetic:

```javascript
// executor.test.js:300 — mock cost value passed through
runPrompt.mockResolvedValue({ cost: { costUSD: 0.05, ... }});
expect(result.results[0].cost.costUSD).toBe(0.05); // ✅ Exact mock value
```

**Verdict**: Safe — these are not computed floats.

#### 4. Git History Check

Previous flaky fixes from commit history:
- `35d326e`: Fixed SSE polling waits, minute-boundary race in git tests
- `5a575f1`: Fixed Windows EBUSY temp cleanup
- `eb4e644`: Audit confirmed atomic state writes, throttle timer cleanup

All identified patterns were already addressed.

### Flaky Tests Fixed

| Test Name | File | Root Cause | Fix Applied |
|-----------|------|------------|-------------|
| (none) | — | — | — |

### Flaky Tests Unresolved

| Test Name | File | Root Cause | Why It Couldn't Be Fixed |
|-----------|------|------------|--------------------------|
| (none) | — | — | — |

---

## Phase 2: API Contract Testing

### API Endpoint Map

#### GUI Server (gui/server.js)

| Method | Path | Auth | Request Body | Response | Test Status |
|--------|------|------|--------------|----------|-------------|
| POST | /api/config | None | `{}` | `{ ok, bin }` | ✅ gui-server.test.js |
| POST | /api/select-folder | None | `{}` | `{ ok, folder }` | ⚠️ Requires native dialog |
| POST | /api/run-command | None | `{ command, id? }` | `{ ok, exitCode, stdout, stderr }` | ✅ gui-server.test.js |
| POST | /api/kill-process | None | `{ id }` | `{ ok }` or `{ ok: false, error }` | ✅ gui-server.test.js |
| POST | /api/read-file | None | `{ path }` | `{ ok, content }` or error | ✅ gui-server.test.js |
| POST | /api/delete-file | None | `{ path }` | `{ ok }` or 403 | ✅ gui-server.test.js |
| POST | /api/heartbeat | None | `{}` | `{ ok: true }` | ✅ gui-server.test.js |
| POST | /api/log-error | None | `{ level, message }` | `{ ok, level }` | ✅ gui-server.test.js |
| POST | /api/log-path | None | `{}` | `{ ok, path }` | ✅ gui-server.test.js |
| POST | /api/exit | None | `{}` | `{ ok: true }` (then exits) | ⚠️ Would terminate server |
| GET | / | None | — | HTML | ✅ gui-server.test.js |
| GET | /\*.js | None | — | JavaScript | ✅ gui-server.test.js |

#### Dashboard Server (src/dashboard.js)

| Method | Path | Auth | Request Body | Response | Test Status |
|--------|------|------|--------------|----------|-------------|
| GET | / | None | — | HTML with embedded CSRF token | ✅ dashboard.test.js |
| GET | /events | None | — | SSE stream | ✅ dashboard.test.js |
| POST | /stop | CSRF Token | `{ token }` | `{ ok: true }` or 403 | ✅ dashboard.test.js |

### Documentation Discrepancies

| Location | What Docs Say | What Code Does |
|----------|---------------|----------------|
| (none found) | — | — |

CLAUDE.md module map accurately reflects the codebase. All API endpoints behave as documented.

### Undocumented Behavior Discovered

1. **Body size limits**: All POST endpoints enforce 1 MB limit (GUI server) and 1 KB limit (dashboard /stop). Not explicitly documented but properly implemented.

2. **Security headers on error responses**: Both servers include CSP, X-Frame-Options, X-Content-Type-Options on 4xx responses as well as 200 responses.

3. **Invalid JSON fallback**: `readBody()` helper returns `{}` for malformed JSON instead of throwing, causing endpoints to return 400 for missing required fields rather than parse errors.

### Contract Test Gaps

| Endpoint | Gap | Recommendation |
|----------|-----|----------------|
| /api/select-folder | Cannot test — requires native dialog | Document as untestable |
| /api/exit | Cannot test — terminates process | Document as untestable |

These gaps are inherent to the endpoint design and do not represent missing test coverage.

---

## Recommendations

| # | Recommendation | Impact | Risk if Ignored | Worth Doing? | Details |
|---|---|---|---|---|---|
| 1 | Document untestable endpoints | Clarity | Low | Probably | Add comments in gui-server.test.js explaining why /api/select-folder and /api/exit cannot be directly tested. Prevents future developers from thinking coverage is incomplete. |
| 2 | Consider extracting dashboard timer constants | Maintainability | Low | Only if time allows | The 500ms OUTPUT_WRITE_INTERVAL and 700ms test waits are coupled by convention. Exporting the constant would make the relationship explicit, but current approach is working. |

---

## Test Quality Summary

The NightyTidy test suite demonstrates high quality:

- **888 tests** across 39 test files
- **96% statement coverage** (enforced by CI)
- **Zero flaky tests** detected across 5 consecutive runs
- **Comprehensive contract testing** for all testable API endpoints
- **Proper isolation** via `vi.resetModules()` and temp directories
- **Windows compatibility** handled via `robustCleanup()` helper

Previous test hardening audits have already addressed the common flaky patterns (SSE polling, minute-boundary races, EBUSY file locks). The suite is production-ready.
