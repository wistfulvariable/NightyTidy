# Bug Hunt Report 01 — 2026-03-05

## Executive Summary

Scanned all 13 source files (~1,800 LOC) and 21 test files. Found **7 bugs** total:
- **3 fixed** (High confidence, mechanical fixes, tests pass)
- **4 documented** (need human review or architectural decisions)

No critical/security bugs found. The codebase is well-structured with strong error contracts. Bug density is low — most findings are edge-case cleanup issues.

**Highest-density area**: `dashboard.js` / `cli.js` lifecycle cleanup (3 findings).

---

## Bugs Fixed

| # | File | Bug | Fix | Confidence | Commit |
|---|------|-----|-----|------------|--------|
| 1 | `src/dashboard.js:229` | `scheduleShutdown()` returned early when `server` is null, skipping ephemeral file cleanup in TUI-only mode | Removed `if (!server) return;` guard — `stopDashboard()` already handles null server gracefully | 99% — `stopDashboard` checks each resource independently | `89bff22` |
| 2 | `src/cli.js:411` | Error path called `scheduleShutdown()` then `process.exit(1)` — exit kills pending timers, so `stopDashboard()` never runs and ephemeral files leak | Changed `scheduleShutdown()` to `stopDashboard()` on error path, matching the abort path pattern | 99% — `process.exit()` does not run pending `setTimeout` callbacks | `89bff22` |
| 3 | `src/executor.js:50` | `verifyStepsIntegrity(selectedSteps)` computed hash over user-selected subset instead of full STEPS array — always warned on partial runs (`--steps 1,5,12`) | Changed to `verifyStepsIntegrity(STEPS)` using the full array; added `STEPS` import | 99% — the hash constant is documented as "SHA-256 of all STEPS[].prompt content" | `89bff22` |

---

## Bugs Found — Needs Human Review

### 1. MEDIUM (Medium confidence) — Misleading step label in executor.js log output

- **File**: `src/executor.js:65`
- **What's wrong**: `stepLabel` uses `step.number` (the original step number, e.g. 5) divided by `totalSteps` (count of selected steps, e.g. 3), producing "Step 5/3" in the log when running a subset.
- **Trigger**: Run with `--steps 5,10,15` — log messages show "Step 5/3", "Step 10/3", "Step 15/3".
- **Impact**: Confusing log output. No functional impact — terminal UX in `cli.js` uses `idx + 1` correctly.
- **Suggested fix**: Change to `Step ${i + 1}/${totalSteps}: ${step.name}` or `Step ${step.number}: ${step.name}` (without the `/totalSteps`).
- **Why not fixed**: UX decision — the label may intentionally show the original step number for traceability. Needs product decision.

### 2. MEDIUM (Low confidence) — `--continue` retries may continue wrong session

- **File**: `src/executor.js:94-99` / `src/claude.js:51`
- **What's wrong**: When the doc update call (`continueSession: true`) fails and retries, the retry also uses `--continue`. But after a failed first attempt, `--continue` continues the failed doc-update session rather than the original improvement session.
- **Trigger**: Doc update fails on first attempt (timeout, API error), then retries.
- **Impact**: Retry may lack context of the original improvement changes. Since doc update failure is handled gracefully (warn + continue), impact is limited to potentially stale docs.
- **Suggested fix**: Only use `--continue` on the first attempt; fall back to non-continue mode on retries. Or pass the session ID explicitly.
- **Why not fixed**: Requires understanding Claude CLI session semantics. May be working as intended if `--continue` always picks up the last session regardless.

### 3. LOW (Low confidence) — `runPrompt` returns empty output on exhausted retries

- **File**: `src/claude.js:193-194`
- **What's wrong**: When all retry attempts are exhausted, the returned `output` is `''` rather than the output from the last failed attempt.
- **Trigger**: A step fails all 4 attempts but produces partial output on the last attempt.
- **Impact**: Partial output from failing steps is lost in the report. Minor — failed step output is rarely useful.
- **Suggested fix**: Track `lastResult` and return `lastResult.output` instead of `''`.
- **Why not fixed**: Unclear if preserving partial output from failed attempts is desirable — it could be misleading.

### 4. LOW (Low confidence) — UNC paths bypass disk space check on Windows

- **File**: `src/checks.js:152`
- **What's wrong**: `projectDir.charAt(0).toUpperCase()` assumes a drive letter (e.g., `C:\`). UNC paths (`\\server\share\...`) would extract `\`, causing the PowerShell/wmic commands to fail.
- **Trigger**: Running NightyTidy from a network share (UNC path) on Windows.
- **Impact**: Disk space check silently skips (caught by try/catch, logged as "skipped"). No crash.
- **Suggested fix**: Parse drive letter from `path.parse(projectDir).root` or handle UNC paths separately.
- **Why not fixed**: Edge case — NightyTidy running from a network share is unusual. The graceful skip behavior is acceptable.

---

## State Machine Analysis

### Dashboard lifecycle states: `starting → running → finishing → completed|stopped|error`

| Transition | Code Location | Guard |
|------------|---------------|-------|
| starting → running | `cli.js:41` (onStepStart callback) | First step begins |
| running → finishing | `cli.js:345` | All steps done, generating changelog |
| finishing → completed | `cli.js:392` | Report generated, merge done |
| running → stopped | `cli.js:336` | Abort signal detected |
| any → error | `cli.js:407` | Uncaught exception in try block |

**No issues found.** All transitions are guarded. No stuck states. Abort and error paths both reach terminal states.

---

## Data Flow Findings

- **Dashboard state is mutated by reference** across cli.js callbacks and dashboard.js. Parallel tracking of `completedCount`/`failedCount` in both `dashState` (cli.js) and `executionResults` (executor.js) could theoretically diverge, but callbacks fire synchronously from the same loop iteration. No issue found.
- **CSRF token** is hex-only (from `randomBytes(16).toString('hex')`), safe for embedding in single-quoted JS strings. No injection risk.

---

## Test Suite Observations

- **No skipped tests or `// FIXME` markers** found in any test file.
- **All 248 tests pass deterministically** — no flaky tests detected.
- **Mock coverage gap**: `executor.test.js` and `contracts.test.js` mocked `steps.js` without `STEPS` export, which only surfaced after the bug fix added `STEPS` to executor.js imports. This means the mock was technically incomplete before but didn't matter because executor.js didn't import `STEPS`.
- **Test-mock coupling**: Tests that mock `steps.js` must now include `STEPS: []` to match the updated import. Three test files were updated.

---

## Bug Density Map

| File | Findings |
|------|----------|
| `src/dashboard.js` | 1 (scheduleShutdown guard) |
| `src/cli.js` | 1 (error path cleanup) |
| `src/executor.js` | 2 (integrity check, step label) |
| `src/claude.js` | 2 (retry session, empty output) |
| `src/checks.js` | 1 (UNC path) |

---

## Recommendations

1. **Add `process.on('exit')` cleanup for dashboard files** — similar to lock.js pattern. Would prevent ephemeral file leaks from any unexpected exit path.
2. **Consider a lint rule for `scheduleShutdown()` usage** — callers must ensure the process stays alive long enough for the timer. Document this contract.
3. **Track last-attempt output in `runPrompt`** — small change that preserves potentially useful diagnostic info from failing steps.
