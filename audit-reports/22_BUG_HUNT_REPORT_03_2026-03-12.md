# Bug Hunt Report — Run #03

**Date**: 2026-03-12
**Duration**: ~15 minutes
**Tests**: All 886 passing

---

## Executive Summary

| Metric | Value |
|--------|-------|
| **Total Bugs Found** | 2 |
| **Critical** | 0 |
| **High Priority** | 1 (fixed) |
| **Medium Priority** | 1 (document-only) |
| **Bugs Fixed** | 1 |
| **Document Only** | 1 |
| **Highest Density Area** | `executor.js` |

---

## Bugs Fixed

### Bug #1: Token count `|| null` operator precedence bug (executor.js:145-146)

**File**: `src/executor.js:145-146`
**Confidence**: 99% — mechanical bug, tests verify fix, operator precedence is unambiguous
**Severity**: High — silent data loss in token accounting

**What was wrong**:
```javascript
// BEFORE (buggy):
inputTokens: (a.inputTokens || 0) + (b.inputTokens || 0) || null,
outputTokens: (a.outputTokens || 0) + (b.outputTokens || 0) || null,
```

Due to operator precedence, `+` binds tighter than `||`. The expression evaluates as:
1. `(0 + 0) || null` → `0 || null` → `null`

When both inputs had valid zero token counts (e.g., cache-only interactions), the sum of `0 + 0 = 0` was incorrectly converted to `null`, losing the "we counted this" semantic.

**The fix**:
```javascript
// AFTER (correct):
const inputSum = (a.inputTokens ?? 0) + (b.inputTokens ?? 0);
const outputSum = (a.outputTokens ?? 0) + (b.outputTokens ?? 0);
const hasInputData = a.inputTokens != null || b.inputTokens != null;
const hasOutputData = a.outputTokens != null || b.outputTokens != null;
return {
  // ...
  inputTokens: hasInputData ? inputSum : null,
  outputTokens: hasOutputData ? outputSum : null,
  // ...
};
```

Now `null` means "no data available" while `0` means "counted as zero tokens".

**Trigger condition**: Two cost objects where token counts sum to exactly zero (rare but possible with cache-only API interactions).

**Impact**: Token accounting in the GUI and reports would silently drop to `null` instead of showing `0`, making it appear no data was collected.

**Commit**: fix: sumCosts operator precedence bug in executor.js

---

## Bugs Found — Needs Human Review

### Bug #2: Resource leak on lock write failure (lock.js:34-36)

**Severity**: Low (Medium confidence)
**File**: `src/lock.js:34-36`

**What's wrong**:
```javascript
function writeLockFile(lockPath, content) {
  const fd = openSync(lockPath, 'wx');
  writeFileSync(fd, content);
  closeSync(fd);
}
```

If `writeFileSync` throws (disk full, permission error), `closeSync(fd)` is skipped, leaving the file descriptor open.

**Trigger**: Disk full or I/O error during lock file write.

**Impact**: Minor — short-lived resource leak. The process typically exits soon after lock failure anyway, which cleans up all file descriptors.

**Suggested fix**:
```javascript
function writeLockFile(lockPath, content) {
  const fd = openSync(lockPath, 'wx');
  try {
    writeFileSync(fd, content);
  } finally {
    closeSync(fd);
  }
}
```

**Why not fixed**: While technically a bug, the impact is negligible. The process exits shortly after any lock failure, and the leak affects only one file descriptor. Would be a fine cleanup PR but doesn't meet the "90% confident + tests verify" bar for this pass.

---

## State Machine Analysis

### Orchestrator Run State

Reviewed `orchestrator.js` state machine:

| State | Transitions | Guards |
|-------|-------------|--------|
| `none` | → `initializing` | via `initRun()` |
| `initializing` | → `running` | via state file creation |
| `running` | → `completed` | via `finishRun()` |
| `running` | → `paused` | via rate-limit detection |
| `paused` | → `running` | via manual resume or timeout |

**Finding**: No stuck states or missing guards detected. The 3-tier step recovery mechanism (`runStep` → prod → fresh retry) properly handles all failure modes.

### GUI Application State

Reviewed `app.js` state machine:

| Screen | Transitions | Guards |
|--------|-------------|--------|
| `SETUP` | → `STEPS` | folder selected + git ready |
| `STEPS` | → `RUNNING` | `--init-run` succeeds |
| `RUNNING` | → `SUMMARY` | all steps + finish complete |
| `RUNNING` | ↔ `paused` overlay | rate limit detected/cleared |

**Finding**: State transitions are guarded by explicit checks. No impossible transitions detected. The `state.stopping` flag properly prevents new work during shutdown.

---

## Data Flow Findings

### Token Flow Analysis

Traced token data from Claude subprocess → executor → orchestrator → GUI:

1. `claude.js:extractCost()` — reads from JSON, uses `?? null` correctly
2. `executor.js:sumCosts()` — **had the bug** (now fixed)
3. `orchestrator.js:finishRun()` — uses `|| 0` for summation, then `|| null` correctly
4. `gui/resources/logic.js:formatTokens()` — handles `null` and `0` differently (correct)

**No other bugs in this flow** after the fix.

### Cost Flow Analysis

Cost data (`costUSD`) uses `|| 0` which is safe because `$0.00` is a valid display value. No bugs detected.

---

## Test Suite Observations

### Coverage Status

- **Statements**: 96.17%
- **Branches**: 89.15%
- **Functions**: 97.05%
- **886 tests** across 39 files

### No Skipped Tests

Zero `.skip()` or `// TODO` markers found in test files. All tests actively run.

### Coverage Gaps (Non-Critical)

| File | Uncovered | Risk |
|------|-----------|------|
| `cli.js` | 8.34% | Non-interactive error paths |
| `sync.js` | 7.09% | Retry logic edge cases |
| `dashboard.js` | 6.56% | SSE shutdown timing |

These are error/cleanup paths that rarely execute. No bugs hiding here based on code inspection.

---

## Bug Density Map

| Module | Findings | Notes |
|--------|----------|-------|
| `executor.js` | 1 bug (fixed) | sumCosts operator precedence |
| `lock.js` | 1 bug (doc-only) | FD leak on write failure |
| `claude.js` | 0 | Clean — defensive coding |
| `orchestrator.js` | 0 | Clean — good error handling |
| `git.js` | 0 | Clean — try/catch everywhere |
| `report.js` | 0 | Clean |
| `gui/*.js` | 0 | Clean — pure functions well-tested |
| `sync.js` | 0 | Clean |

---

## Recommendations

1. **Consider lint rule for `|| null` on numeric sums** — the pattern `sum || null` is dangerous with numbers. A lint rule could catch this.

2. **Add mutation testing to CI** — the `test/mutation-testing.test.js` file has excellent examples. Running mutation tests regularly would catch bugs like #1.

3. **lock.js cleanup** — low priority but a 2-line fix (try/finally) would eliminate the theoretical resource leak.

---

## Patterns & Hot Spots

- **No bug clusters** — only 2 findings across the entire codebase
- **No recurring patterns** — the operator precedence bug is a one-off
- **Defensive coding throughout** — most modules have explicit null checks, try/catch blocks, and clear error contracts

---

*Generated by NightyTidy Bug Hunt v0.1.0*
