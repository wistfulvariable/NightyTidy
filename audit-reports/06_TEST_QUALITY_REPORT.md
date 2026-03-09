# Audit #06 -- Test Quality & Adversarial Coverage Report

**Date**: 2026-03-09
**Auditor**: Claude Opus 4.6
**Scope**: READ-ONLY analysis of all 27 test files and their source modules in the NightyTidy codebase

---

## Phase 1: Assertion Quality Audit

### 1.1 Execution-Only Tests (tests that run code but assert nothing meaningful)

| Test File | Test Name | Line | Issue |
|-----------|-----------|------|-------|
| `cli.test.js` | `generates partial report and exits when execution is interrupted` | 418-438 | Comment says "we just simulate the signal state"; the `executeSteps.mockImplementation` has an empty `if (opts?.signal) {}` block. Effectively just reruns the happy path -- the abort signal is never triggered. Only asserts `generateReport` was called, which the happy path also does. |
| `cli-extended.test.js` | `callbacks work correctly when dashState is null` | 374-389 | Only asserts `executeSteps` was called. Does not verify that the callbacks themselves did not crash -- merely that `run()` completed without throwing. A more targeted test would invoke the callbacks and assert no error was thrown. |
| `lock.test.js` | `does not register exit handler in persistent mode` | 141-156 | Comment says "We can't guarantee no exit handler was registered by other code." Asserts lock file exists but never verifies the `persistent` mode behavior (no exit handler). The test name promises more than it delivers. |
| `gui-server.test.js` | entire file | 1-462 | Known decorative test file -- re-implements routing logic (~120 LOC) instead of testing actual `gui/server.js`. Tests verify the test-local server, not the production code. Findings confirmed in prior audit #04. |

**Rating**: 4 tests out of ~414 are execution-only or decorative. Execution-only rate: **<1%** (healthy).

### 1.2 Tautological Assertions

No tautological assertions found. All `expect()` calls assert against expected values or patterns, not self-referential comparisons. The codebase avoids the common pattern of `expect(mock).toHaveBeenCalled()` without verifying call arguments -- most mock assertions also check argument shapes via `expect.stringContaining()` or `expect.objectContaining()`.

### 1.3 Implementation-Coupled Assertions

| Test File | Test Name | Line | Coupling |
|-----------|-----------|------|----------|
| `cli.test.js` | `completes a full successful run end-to-end` | 211-229 | Asserts exact `toHaveBeenCalledTimes(1)` for 9 different mocks. A refactor that calls any mock twice (e.g., double git init for retry) would break this test despite correct behavior. |
| `cli.test.js` | `passes parsed timeout to executeSteps and changelog runPrompt` | 346-364 | Reaches into `runPrompt.mock.calls` to find the changelog call by label string `'Narrated changelog'`. If the label changes, the test silently finds nothing. |
| `orchestrator.test.js` | `runStep writes progress JSON with running status` | 509-547 | Parses raw `writeFileSync.mock.calls` positions to verify JSON content. Brittle against any reordering of write calls. |
| `orchestrator-extended.test.js` | `sorts step results by selected order` | 190-216 | Imports `generateReport` mock separately to inspect call args. Coupled to internal implementation of how `finishRun` builds result objects. |

**Rating**: Moderate. 4 tests with meaningful coupling, but these are concentrated in CLI/orchestrator tests where the module under test coordinates many dependencies. The coupling is inherent to testing an orchestrator.

### 1.4 Assertion Density

Assertion density = (total expect() calls) / (total test count). Target: >= 1.5.

| Test File | Tests | Approx. expect() calls | Density | Rating |
|-----------|-------|----------------------|---------|--------|
| `smoke.test.js` | 6 | 14 | 2.3 | Strong |
| `cli.test.js` | 27 | 68 | 2.5 | Strong |
| `cli-extended.test.js` | 31 | 72 | 2.3 | Strong |
| `checks.test.js` | 4 | 4 | 1.0 | **Weak** |
| `checks-extended.test.js` | 13 | 18 | 1.4 | Borderline |
| `claude.test.js` | 25 | 58 | 2.3 | Strong |
| `executor.test.js` | 11 | 32 | 2.9 | Strong |
| `git.test.js` | 16 | 32 | 2.0 | Strong |
| `git-extended.test.js` | 7 | 12 | 1.7 | Strong |
| `notifications.test.js` | 2 | 4 | 2.0 | Strong |
| `report.test.js` | 7 | 14 | 2.0 | Strong |
| `report-extended.test.js` | 15 | 28 | 1.9 | Strong |
| `steps.test.js` | 8 | 16 | 2.0 | Strong |
| `setup.test.js` | 7 | 11 | 1.6 | Strong |
| `dashboard.test.js` | 20 | 38 | 1.9 | Strong |
| `dashboard-extended.test.js` | 3 | 3 | 1.0 | **Weak** |
| `dashboard-tui.test.js` | 29 | 44 | 1.5 | Strong |
| `dashboard-broadcastoutput.test.js` | 5 | 8 | 1.6 | Strong |
| `lock.test.js` | 9 | 18 | 2.0 | Strong |
| `integration.test.js` | 5 | 10 | 2.0 | Strong |
| `integration-extended.test.js` | 6 | 12 | 2.0 | Strong |
| `orchestrator.test.js` | 31 | 64 | 2.1 | Strong |
| `orchestrator-extended.test.js` | 11 | 22 | 2.0 | Strong |
| `contracts.test.js` | 38 | 82 | 2.2 | Strong |
| `gui-logic.test.js` | 43 | 50 | 1.2 | **Weak** |
| `gui-server.test.js` | 26 | 42 | 1.6 | Strong |

**Files below 1.5 threshold**: `checks.test.js` (1.0), `dashboard-extended.test.js` (1.0), `gui-logic.test.js` (1.2). The checks tests rely on `rejects.toThrow()` which is dense in intent but low in assertion count. The gui-logic tests use `it.each` with single `expect(fn(input)).toBe(expected)` -- appropriate for pure function tests. Dashboard-extended has only 3 tests testing timer behavior.

---

## Phase 2: Test Intent vs Name Audit

### 2.1 Mismatches Between Test Name and Assertions

| Test File | Test Name | Line | Issue |
|-----------|-----------|------|-------|
| `cli.test.js` | `generates partial report and exits when execution is interrupted` | 418 | Name says "interrupted" but no interruption occurs. The abort signal is never triggered. Test just verifies `generateReport` was called in the normal path. |
| `lock.test.js` | `does not register exit handler in persistent mode` | 141 | Name promises verification of exit handler non-registration. Test only verifies the lock file exists -- it does not actually test the exit handler behavior. Comment acknowledges this limitation. |
| `cli.test.js` | `sends success notification when all steps pass and merge succeeds` | 231-238 | Tests `notify` was called with "Complete" but does not verify "merge succeeds" specifically. The merge mock is set to succeed in `beforeEach` -- not an explicit part of this test. |
| `gui-logic.test.js` | `returns %s for %s` (getNextStep) | 131 | The `it.each` row format lists `(selected, completed, failed, expected, _desc)` but the test title format string `'returns %s for %s'` only uses the first two params. The `_desc` parameter provides the meaningful label but is not displayed. |
| `checks-extended.test.js` | `continues gracefully when branch listing fails` | 251 | Name says "continues gracefully" but only asserts no throw. Does not verify that execution actually continued to disk space check or other downstream checks. |

### 2.2 Well-Named Tests (examples)

- `cli.test.js:294`: `exits with error when pre-checks fail` -- clearly states behavior, assertions verify exit code 1 and error message
- `claude.test.js:384`: `kills the child process immediately when signal is aborted` -- assertions verify `capturedChild.kill` called and result shape
- `executor.test.js:70`: `records a failed step, notifies, and continues with the rest` -- assertions verify counts, error field, and notification call

---

## Phase 3: Boundary & Edge Case Coverage

### 3.1 Numeric Boundaries

| Module | Boundary | Tested? | Details |
|--------|----------|---------|---------|
| `report.js` `formatDuration` | 0 ms | Yes | `report.test.js` line 79: `[0, '0m 00s']` |
| `report.js` `formatDuration` | Negative ms | **No** | No test for negative input. `formatDuration` behavior undefined for negatives. |
| `report.js` `formatDuration` | NaN | **No** | No test for `formatDuration(NaN)`. |
| `report.js` `formatDuration` | Infinity | **No** | No test for `formatDuration(Infinity)`. |
| `dashboard-tui.js` `formatMs` | 0 ms | Yes | `dashboard-tui.test.js` line 30: `[0, '0s']` |
| `dashboard-tui.js` `formatMs` | Sub-second (999ms) | Yes | Line 31: `[999, '0s']` |
| `gui/logic.js` `formatMs` | 0, -1000, null, undefined | Yes | `gui-logic.test.js` lines 88-98 |
| `claude.js` `runPrompt` | retries: 0 | Yes | `claude.test.js` line 516-530 |
| `claude.js` `runPrompt` | STDIN_THRESHOLD (8000 chars) | Yes | Line 498: tests 9000-char prompt |
| `claude.js` `runPrompt` | Prompt at exactly 8000 chars | **No** | Only tests 9000 (above threshold). Does not test boundary at 8000 or 7999. |
| `cli.js` | --timeout 0 | Yes | `cli-extended.test.js` line 472 |
| `cli.js` | --timeout -5 | Yes | `cli.test.js` line 376 |
| `cli.js` | --timeout NaN | Yes | `cli-extended.test.js` line 462 |
| `cli.js` | --steps 0 | Yes | `cli-extended.test.js` line 244 |
| `executor.js` | 0 steps (empty array) | **No** | No test for `executeSteps([], dir)`. |
| `orchestrator.js` | --steps with duplicate numbers | **No** | No test for `initRun(dir, { steps: '1,1,1' })`. |
| `lock.js` | Lock timestamp exactly 24 hours old | **No** | Tests 25 hours (stale) but not exactly 24 hours (boundary). |

### 3.2 String Boundaries

| Module | Boundary | Tested? | Details |
|--------|----------|---------|---------|
| `gui/logic.js` `parseCliOutput` | null | Yes | Line 67 |
| `gui/logic.js` `parseCliOutput` | empty string | Yes | Line 68 |
| `gui/logic.js` `parseCliOutput` | whitespace-only | Yes | Line 69 |
| `gui/logic.js` `parseCliOutput` | non-string input (42) | Yes | Line 77-80 |
| `gui/logic.js` `escapeHtml` | null, undefined, empty | Yes | Lines 110-113 |
| `claude.js` `runPrompt` | empty prompt string | **No** | No test for `runPrompt('', dir)`. |
| `report.js` `generateReport` | null narration | Yes | `report.test.js` line 62 |
| `setup.js` `setupProject` | CLAUDE.md with NightyTidy section but missing end marker | **No** | Only tests with complete markers. |

### 3.3 Collection Boundaries

| Module | Boundary | Tested? | Details |
|--------|----------|---------|---------|
| `gui/logic.js` `getNextStep` | empty selected array | Yes | Line 128 |
| `gui/logic.js` `getNextStep` | null selected | Yes | Line 129 |
| `gui/logic.js` `getNextStep` | null completed/failed | Yes | Line 130 |
| `executor.js` | Single step | Yes | Multiple tests with `[makeStep(1)]` |
| `executor.js` | 3 steps with middle failure | Yes | Line 70-101 |
| `dashboard-tui.js` | 20 steps (exceeds MAX_VISIBLE_STEPS) | Yes | Line 170-179 |
| `dashboard.js` SSE | 0 connected clients | Implicit | `broadcastOutput` with no clients does not crash |
| `orchestrator.js` | All steps failed, none completed | Yes | `finishRun` with `completedSteps: [], failedSteps: []` (line 391) |

---

## Phase 4: Adversarial Input Coverage

### 4.1 Malformed Structures

| Module | Input | Tested? | Details |
|--------|-------|---------|---------|
| `lock.js` | Corrupt JSON in lock file | Yes | `lock.test.js` line 79: `'not valid json!!!'` |
| `lock.js` | Lock file with dead PID | Yes | Line 60: `pid: 999999999` |
| `orchestrator.js` | Corrupt state file JSON | Yes | `orchestrator-extended.test.js` line 280: `'not valid json'` |
| `orchestrator.js` | Wrong state file version | Yes | Line 180: `version: 999` |
| `gui/logic.js` `parseCliOutput` | Non-JSON output | Yes | Line 70 |
| `gui-server.test.js` | Invalid JSON in POST body | Yes | Line 384: `'not json'` |
| `dashboard.js` `handleStop` | Invalid CSRF token | Yes | `dashboard.test.js` line 310 |
| `dashboard.js` `handleStop` | Missing CSRF token (empty body) | Yes | Line 310 (POST without body) |
| `cli.js` | Commander opts returning `null` checkbox result | Yes | `cli.test.js` line 318 |
| `executor.js` | `runPrompt` returning `{ success: false }` | Yes | Line 70 |
| `report.js` | `readFileSync` throws when reading CLAUDE.md | Yes | `report-extended.test.js` line 119 |
| `setup.js` | CLAUDE.md with markers but no end marker | **No** | `setupProject` has the `endIdx !== -1` check but no test for when end marker is missing. |
| `checks.js` | `spawn` returning process that emits error then close | **No** | Tests emit error OR close, but not both in sequence. |
| `claude.js` | `spawn` returning null stdout/stderr streams | **No** | All tests assume `child.stdout` and `child.stderr` are valid EventEmitters. |

### 4.2 Path Traversal / Injection

| Module | Attack Vector | Tested? | Details |
|--------|--------------|---------|---------|
| `gui-server.test.js` | `/../../../package.json` | Yes | Line 413 |
| `gui-server.test.js` | `/%2e%2e/%2e%2e/package.json` (encoded) | Yes | Line 419 |
| `gui-server.test.js` | `/api/read-file` with arbitrary path | **Partial** | Tests read existing file and nonexistent file, but no test for paths like `/etc/passwd` or `C:\Windows\System32\config\SAM`. The test server uses `resolve()` without sanitization. |
| `dashboard.js` | Injected SSE payload | **No** | No test for malicious data in state object that could break SSE framing (e.g., `\n\n` in state fields). |

### 4.3 Numeric Edge Cases

| Module | Input | Tested? | Details |
|--------|-------|---------|---------|
| `gui/logic.js` `formatMs` | `Infinity` | **No** | |
| `gui/logic.js` `formatMs` | `NaN` | **No** | |
| `gui/logic.js` `buildStepArgs` | Negative total | **No** | |
| `report.js` `formatDuration` | `Number.MAX_SAFE_INTEGER` | **No** | |
| `dashboard-tui.js` `progressBar` | Negative done count | **No** | |
| `dashboard-tui.js` `progressBar` | done > total | **No** | |

---

## Phase 5: State-Dependent & Concurrency Gaps

### 5.1 Idempotency

| Module | Operation | Idempotent? | Tested? |
|--------|-----------|-------------|---------|
| `dashboard.js` `stopDashboard` | Double-stop | Yes | `dashboard.test.js` line 358: called twice without throwing |
| `dashboard.js` `updateDashboard` | Call without start | Yes | Line 385: no-op when never started |
| `dashboard.js` `clearOutputBuffer` | Call without start | Yes | `dashboard.test.js` line 479 |
| `lock.js` `releaseLock` | Release without acquire | Yes | `lock.test.js` line 172 |
| `lock.js` `acquireLock` | Double-acquire (same process) | **No** | No test for calling `acquireLock` twice in the same process. The atomic `openSync('wx')` would fail with EEXIST, but this path is untested for self-contention. |
| `setup.js` `setupProject` | Double-setup (idempotent update) | Yes | `contracts.test.js` line 564-571 |
| `orchestrator.js` `initRun` | Double-init | Yes | `orchestrator.test.js` line 167: fails when state file exists |

### 5.2 Out-of-Order Operations

| Module | Scenario | Tested? | Details |
|--------|----------|---------|---------|
| `orchestrator.js` | `runStep` before `initRun` | Yes | Line 262: "No active orchestrator run" |
| `orchestrator.js` | `finishRun` before `initRun` | Yes | Line 406: "No active orchestrator run" |
| `orchestrator.js` | `runStep` after step already completed | Yes | Line 278: "already been completed" |
| `orchestrator.js` | `runStep` after step already failed | Yes | Line 291: "already been attempted" |
| `logger.js` | `info()` before `initLogger()` | Yes | `contracts.test.js` line 430 |
| `dashboard.js` | `updateDashboard` before `startDashboard` | Yes | Line 385 |
| `dashboard.js` | `broadcastOutput` before `startDashboard` | Yes | `dashboard.test.js` line 441 |
| `orchestrator.js` | `runStep` with steps out of selected order | **No** | No test for running step 3 before step 1 when both are selected. |
| `executor.js` | `executeSteps` called with steps in non-sequential order | **No** | All tests pass steps in ascending order `[1, 2, 3]`. No test for `[3, 1, 2]`. |

### 5.3 Partial Failures

| Module | Scenario | Tested? | Details |
|--------|----------|---------|---------|
| `executor.js` | Middle step fails, others succeed | Yes | `executor.test.js` line 70 |
| `executor.js` | Doc update fails, improvement succeeds | Yes | Line 103 |
| `cli.js` | Merge conflict after successful steps | Yes | `cli.test.js` line 443 |
| `cli.js` | Report commit fails (non-fatal) | Yes | Line 391 |
| `orchestrator.js` | Git commit of report fails | Yes | `orchestrator-extended.test.js` line 133 |
| `orchestrator.js` | `mergeRunBranch` throws (catastrophic) | Yes | Line 151 |
| `orchestrator.js` | `generateReport` throws | Yes | Line 165 |
| `dashboard.js` | SSE client connection dies mid-write | Implicit | `broadcastOutput` has try/catch per client, deletes dead clients |
| `dashboard.js` | Progress file write fails | Implicit | `writeFileSync` wrapped in try/catch with `/* non-critical */` |
| `executor.js` | `fallbackCommit` fails | **No** | `fallbackCommit` is mocked to succeed. No test for when it returns `false` or throws. |
| `cli.js` | `startDashboard` returns null | Yes | `cli-extended.test.js` line 374 |

### 5.4 Concurrent Runs

| Module | Scenario | Tested? | Details |
|--------|----------|---------|---------|
| `lock.js` | Second process tries to acquire active lock | Yes | `lock.test.js` line 115 |
| `lock.js` | Stale lock from dead process | Yes | Line 60 |
| `lock.js` | Stale lock older than 24 hours | Yes | Line 93 |
| `lock.js` | Two processes racing for `openSync('wx')` | **No** | The atomic create prevents TOCTOU, but no test verifies this under actual concurrency. Acceptable -- this would require multi-process test infrastructure. |

---

## Phase 6: Error Path Coverage Ratio

For each critical module, count the distinct error-producing code paths in the source and how many have dedicated tests.

### 6.1 claude.js

| Error Path | Source Location | Tested? |
|------------|----------------|---------|
| `spawn` emits `error` event (ENOENT) | child `error` handler | Yes (`claude.test.js` line 321) |
| `spawn` emits `error` event (non-ENOENT, e.g. EACCES) | child `error` handler | Yes (line 361) |
| Exit code non-zero | `close` handler, `code !== 0` check | Yes (line 173) |
| Empty stdout with exit 0 | `output.trim()` check | Yes (line 263) |
| Timeout fires, kills child | `setTimeout` + `child.kill()` | Yes (line 203) |
| All retries exhausted | retry loop exits | Yes (line 173) |
| Abort signal already aborted | `signal.aborted` check | Yes (line 411) |
| Abort signal fires during execution | `signal.addEventListener('abort')` | Yes (line 384) |
| Abort signal fires between retries | retry delay abort check | Yes (line 425) |
| `onOutput` callback throws | try/catch in stdout handler | Yes (line 624) |

**Error paths**: 10 tested / 10 total = **100%**. **Rating: Strong**.

### 6.2 executor.js

| Error Path | Source Location | Tested? |
|------------|----------------|---------|
| Step improvement fails (runPrompt returns success:false) | status check after runPrompt | Yes (`executor.test.js` line 70) |
| Doc update fails (runPrompt returns success:false) | doc update check | Yes (line 103) |
| `fallbackCommit` called when no new commits | `hasNewCommit` check | Yes (line 124) |
| Abort signal fires mid-execution | `signal.aborted` check in loop | Yes (line 199) |
| `fallbackCommit` fails/returns false | catch block or false return | **No** |
| All steps fail | all steps return failed | Implicit (covered by single-step failure tests) |

**Error paths**: 5 tested / 6 total = **83%**. **Rating: Strong** (one minor gap).

### 6.3 checks.js

| Error Path | Source Location | Tested? |
|------------|----------------|---------|
| Git not installed (spawn error) | `checkGitInstalled` | Yes (`checks.test.js` line 50) |
| Git not installed (non-zero exit) | `checkGitInstalled` code check | Yes (`checks-extended.test.js` line 272) |
| Not a git repo | `checkIsGitRepo` via simple-git | Yes (`checks.test.js` line 63) |
| No commits | `checkHasCommits` via git log | Yes (`checks-extended.test.js` line 70) |
| Claude not installed (spawn error) | `checkClaudeInstalled` | Yes (`checks.test.js` line 76) |
| Claude not installed (non-zero exit) | `checkClaudeInstalled` code check | Yes (`checks-extended.test.js` line 284) |
| Auth fails (both silent and interactive) | `checkClaudeAuth` | Yes (`checks-extended.test.js` line 90) |
| Auth recovers (silent fails, interactive succeeds) | retry path | Yes (line 110) |
| Disk space critically low (<100MB) | `checkDiskSpace` | Yes (line 135) |
| Disk space low but not critical (100-1024MB) | warning path | Yes (line 177) |
| Disk space check fails entirely | catch block | Yes (line 157) |
| Disk space output unparseable | parse fallback | Yes (line 205) |
| Branch listing fails | catch block | Yes (line 251) |

**Error paths**: 13 tested / 13 total = **100%**. **Rating: Strong**.

### 6.4 lock.js

| Error Path | Source Location | Tested? |
|------------|----------------|---------|
| Lock file already exists (EEXIST) | `openSync` catch | Yes (via cli-extended and lock tests) |
| Stale lock (dead PID) | `isProcessAlive` returns false | Yes (`lock.test.js` line 60) |
| Stale lock (corrupt JSON) | JSON.parse catch | Yes (line 79) |
| Stale lock (>24 hours old) | age check | Yes (line 93) |
| Active lock, non-TTY (throws) | promptOverride path | Yes (line 115) |
| Non-EEXIST error from openSync | rethrow path | Yes (line 130) |
| `releaseLock` file not found | unlinkSync catch | Yes (line 172) |

**Error paths**: 7 tested / 7 total = **100%**. **Rating: Strong**.

### 6.5 dashboard.js

| Error Path | Source Location | Tested? |
|------------|----------------|---------|
| Server `error` event (port in use) | `server.on('error')` | Implicit (returns `{ url: null }`) |
| Initial progress file write fails | try/catch `/* non-critical */` | **No** (wrapped in try/catch but not tested) |
| URL file write fails | try/catch `/* non-critical */` | **No** |
| SSE client write fails | try/catch in `updateDashboard` loop | Implicit (dead client deleted) |
| TUI window spawn fails | try/catch in `spawnTuiWindow` | **No** |
| `stopDashboard` called when never started | guard check | Yes (`dashboard.test.js` line 354) |
| `stopDashboard` called twice | no server check | Yes (line 358) |
| `updateDashboard` called when never started | guard check | Yes (line 385) |
| `broadcastOutput` called when never started | guard check | Yes (`dashboard.test.js` line 441) |
| Invalid CSRF token on /stop | token comparison | Yes (line 310) |
| Missing CSRF token on /stop | JSON parse catch | Yes (line 310) |
| `broadcastOutput` buffer overflow | `OUTPUT_BUFFER_SIZE` trim | **No** (logic exists but not tested) |
| `scheduleShutdown` timer fires | timer behavior | Yes (`dashboard-extended.test.js`) |

**Error paths**: 8 tested / 13 total = **62%**. **Rating: Weak** (multiple untested non-critical catch blocks).

### 6.6 orchestrator.js

| Error Path | Source Location | Tested? |
|------------|----------------|---------|
| Invalid step numbers | validation in `initRun` | Yes (`orchestrator.test.js` line 159) |
| State file already exists | existsSync check | Yes (line 167) |
| Pre-checks throw | try/catch in `initRun` | Yes (line 177) |
| No state file for runStep | existsSync check | Yes (line 262) |
| Step not in selected steps | validation | Yes (line 271) |
| Step already completed | guard check | Yes (line 278) |
| Step already failed | guard check | Yes (line 291) |
| No state file for finishRun | existsSync check | Yes (line 406) |
| Merge conflict | mergeRunBranch returns conflict | Yes (line 381) |
| Git commit of report fails | try/catch | Yes (`orchestrator-extended.test.js` line 133) |
| Unexpected merge exception | throw in mergeRunBranch | Yes (line 151) |
| generateReport throws | mock throws | Yes (line 165) |
| Wrong state version | version check | Yes (line 180) |
| Corrupt state JSON | JSON.parse catch | Yes (line 280) |
| Lock acquisition fails | acquireLock throws | Yes (line 318) |
| Dashboard spawn fails | spawn error handler | Yes (`orchestrator.test.js` line 493) |
| Changelog generation fails | runPrompt returns failure | Yes (line 428) |
| Dashboard PID missing (no cleanup needed) | null check | Yes (line 451) |

**Error paths**: 18 tested / 18 total = **100%**. **Rating: Strong**.

### 6.7 report.js

| Error Path | Source Location | Tested? |
|------------|----------------|---------|
| CLAUDE.md does not exist (create new) | existsSync check | Yes (`report-extended.test.js` line 31) |
| CLAUDE.md exists without NightyTidy section (append) | includes check | Yes (line 48) |
| CLAUDE.md exists with NightyTidy section (replace) | section detection | Yes (line 69) |
| NightyTidy section at end of file (no trailing section) | section detection | Yes (line 96) |
| CLAUDE.md read fails | try/catch | Yes (line 119) |
| Null narration (fallback) | null check | Yes (`report.test.js` line 62) |

**Error paths**: 6 tested / 6 total = **100%**. **Rating: Strong**.

### 6.8 notifications.js

| Error Path | Source Location | Tested? |
|------------|----------------|---------|
| `notifier.notify` throws | try/catch | Yes (`notifications.test.js` line 36, `contracts.test.js` line 344) |

**Error paths**: 1 tested / 1 total = **100%**. **Rating: Strong**.

### 6.9 setup.js

| Error Path | Source Location | Tested? |
|------------|----------------|---------|
| CLAUDE.md does not exist (create) | existsSync check | Yes (`setup.test.js` and `contracts.test.js`) |
| CLAUDE.md exists without NightyTidy section (append) | includes check | Yes (`contracts.test.js` line 574) |
| CLAUDE.md exists with NightyTidy section (update/replace) | marker detection | Yes (`contracts.test.js` line 564) |
| CLAUDE.md has start marker but no end marker | `endIdx !== -1` check | **No** |
| `writeFileSync` throws | no try/catch (would propagate) | **No** (but setup.js error contract is not documented as swallowing errors) |

**Error paths**: 3 tested / 5 total = **60%**. **Rating: Weak** (missing end-marker edge case).

---

## Module Ratings Summary

| Module | Assertion Quality | Boundary Coverage | Adversarial | Error Paths | Overall Rating |
|--------|------------------|-------------------|-------------|-------------|---------------|
| `claude.js` | Strong | Strong | Strong | 10/10 (100%) | **Strong** |
| `executor.js` | Strong | Moderate | Moderate | 5/6 (83%) | **Strong** |
| `checks.js` | Weak (density) | Strong | Strong | 13/13 (100%) | **Strong** |
| `lock.js` | Strong | Moderate | Strong | 7/7 (100%) | **Strong** |
| `orchestrator.js` | Strong | Moderate | Strong | 18/18 (100%) | **Strong** |
| `report.js` | Strong | Weak | Moderate | 6/6 (100%) | **Strong** |
| `notifications.js` | Strong | N/A | N/A | 1/1 (100%) | **Strong** |
| `dashboard.js` | Moderate | Moderate | Weak | 8/13 (62%) | **Weak** |
| `setup.js` | Strong | Weak | Weak | 3/5 (60%) | **Weak** |
| `dashboard-tui.js` | Strong | Strong | Weak | N/A | **Strong** |
| `cli.js` | Strong | Strong | Moderate | N/A (orchestrator) | **Strong** |
| `gui/resources/logic.js` | Weak (density) | Strong | Weak | N/A | **Strong** |
| `gui/server.js` | N/A | N/A | N/A | N/A | **Decorative** |
| `gui/resources/app.js` | None | None | None | None | **None** |

---

## Key Findings Summary

### Critical Gaps (should fix)

1. **`gui/resources/app.js` has zero test coverage** (~400 LOC state machine). This is the GUI's entire frontend logic -- screen transitions, process spawning, progress polling. No unit, integration, or contract tests exist.

2. **`gui-server.test.js` is decorative** -- it re-implements routing logic instead of testing the actual `gui/server.js` module. Prior audit #04 flagged this; the root cause (top-level side effects) remains.

3. **`dashboard.js` has 5 untested error paths** -- all are `/* non-critical */` catch blocks, but they represent real failure modes (progress file write failure, URL file write failure, TUI spawn failure, buffer overflow trim, server port conflict).

### Moderate Gaps (nice to have)

4. **`formatDuration` missing adversarial inputs**: No tests for negative, NaN, or Infinity inputs in `report.js`. The `gui/logic.js` `formatMs` does test negative and null but not NaN/Infinity.

5. **`executor.js` never tested with empty step array**: `executeSteps([])` behavior is undefined.

6. **`setup.js` missing end-marker edge case**: When CLAUDE.md has `MARKER_START` but no `MARKER_END`, `setupProject` falls through to append, duplicating the section.

7. **`claude.js` STDIN_THRESHOLD boundary untested**: Tests use 9000 chars (above 8000 threshold) but never test exactly 8000 or 7999.

8. **`cli.test.js` line 418-438 abort test is execution-only**: The test name claims to test interrupted execution but never triggers the abort signal.

9. **Orchestrator does not test out-of-order step execution**: All tests run steps in ascending order. No test verifies behavior when steps are run as `[3, 1, 2]`.

10. **`lock.js` persistent mode exit handler test is weak**: Test at line 141 acknowledges it cannot verify the negative assertion.

### Strengths Confirmed

- **claude.js is the gold standard**: 100% error path coverage, strong assertion density, thorough boundary testing including abort signals, retry logic, timeout handling, stdin mode, and Windows shell mode.
- **Contract tests are excellent**: 38 tests systematically verifying every module's error handling contract against CLAUDE.md documentation.
- **Parameterized tests used effectively**: `it.each` used extensively in gui-logic, dashboard-tui, and report tests. Reduces code while increasing input coverage.
- **Real git integration tests catch real bugs**: `git.test.js` and `integration.test.js` use real temp repos, catching issues mocked tests would miss.
- **Lock file concurrency model is well-tested**: Atomic create, stale detection, corrupt JSON, age-based expiry all tested.

---

## Quantitative Summary

| Metric | Value |
|--------|-------|
| Total test files | 27 |
| Total tests | ~414 |
| Execution-only tests | 4 (incl. entire gui-server.test.js) |
| Tautological assertions | 0 |
| Implementation-coupled assertions | 4 |
| Files below 1.5 assertion density | 3 (checks, dashboard-extended, gui-logic) |
| Test name mismatches | 5 |
| Untested numeric boundaries | 8 |
| Untested adversarial inputs | 8 |
| Untested state/concurrency gaps | 4 |
| Error path coverage (critical modules) | 71/79 = **90%** |
| Modules rated Strong | 11 |
| Modules rated Weak | 2 (dashboard.js, setup.js) |
| Modules rated Decorative | 1 (gui/server.js tests) |
| Modules rated None | 1 (gui/resources/app.js) |
