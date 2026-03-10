# Cross-Cutting Consistency Audit Report

**Date**: 2026-03-10
**Auditor**: NightyTidy Automated Audit
**Branch**: `nightytidy/run-2026-03-10-0005`

---

## Executive Summary

NightyTidy is an **orchestration-layer CLI tool** — not a traditional web application with databases, users, or data models. This fundamentally changes the cross-cutting concerns audit scope:

- **No traditional pagination/sorting** — Not applicable (not a list-based app)
- **No database or soft deletes** — Not applicable (only file I/O and git operations)
- **No multi-tenancy** — Not applicable (single project per run)
- **No currency transactions** — Cost tracking is metadata display only, no financial operations
- **No user authentication** — Local tool only

**Applicable concerns audited**:
1. Numeric precision and formatting (cost USD, durations, tokens)
2. Timestamp and timezone handling
3. Error response shape consistency
4. Rate-limit detection pattern consistency
5. File atomicity patterns
6. Security header consistency

---

## Phase 1: Pagination Consistency

**Status**: ✅ NOT APPLICABLE

NightyTidy has no list/collection endpoints. The 33 improvement steps are loaded statically from `manifest.json` + markdown files at module initialization. No dynamic pagination, filtering, or cursoring exists.

---

## Phase 2: Sorting & Filtering Consistency

**Status**: ✅ NOT APPLICABLE

Step selection is by step number only (`--steps 1,5,12` or `--all`). No sort/filter operations exist.

---

## Phase 3: Soft Delete & Data Lifecycle Consistency

**Status**: ✅ NOT APPLICABLE

NightyTidy has no database. Files created are ephemeral (deleted on run completion) or persistent outputs (reports, CLAUDE.md updates). No soft-delete pattern exists.

Ephemeral files managed by `EPHEMERAL_FILES` constant in `git.js`:
- `nightytidy-run.log`
- `nightytidy-progress.json`
- `nightytidy-dashboard.url`
- `nightytidy-run-state.json`
- `nightytidy-run-state.json.tmp`

These are excluded from git via `.git/info/exclude` by `excludeEphemeralFiles()`.

---

## Phase 4: Audit Logging & Activity Tracking Consistency

**Status**: ✅ CONSISTENT

All modules use the central `logger.js` module. Pattern is uniform:

| Location | Mechanism | Levels Used | Timestamp Format |
|----------|-----------|-------------|------------------|
| `src/logger.js` | Central logger | debug, info, warn, error | ISO-8601 (`new Date().toISOString()`) |
| `gui/server.js` | `guiLog()` | debug, info, warn, error | ISO-8601 (`new Date().toISOString()`) |

**Findings**:
- All timestamped logs use `new Date().toISOString()` — **100% consistent**
- Logger initialization is enforced (throws if not called first)
- `gui/server.js` has its own `guiLog()` function but uses identical format

---

## Phase 5: Timezone & Date/Time Handling Consistency

**Status**: ⚠️ MINOR DRIFT (1 deviation)

### Patterns Found

| Location | Operation | Method | Timezone | Risk |
|----------|-----------|--------|----------|------|
| `src/logger.js:34` | Log timestamps | `new Date().toISOString()` | UTC | None |
| `src/lock.js:81` | Lock file started field | `new Date().toISOString()` | UTC | None |
| `src/report.js:32` | Report date | `new Date(ts).toISOString().split('T')[0]` | UTC | None |
| `src/git.js:13-20` | Branch/tag timestamps | **`new Date()` local methods** | **LOCAL** | **MEDIUM** |
| `gui/server.js:125` | GUI log timestamps | `new Date().toISOString()` | UTC | None |
| `gui/resources/logic.js:223` | Display time | `toLocaleTimeString('en-US')` | User locale | Intentional |

### Drift Identified

**`src/git.js:getTimestamp()`** uses local timezone:

```javascript
function getTimestamp() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');  // LOCAL HOURS
  const min = String(now.getMinutes()).padStart(2, '0'); // LOCAL MINUTES
  return `${yyyy}-${mm}-${dd}-${hh}${min}`;
}
```

This creates branch/tag names like `nightytidy/run-2026-03-10-0005` using **local time**, while all other timestamps use **UTC**.

**Impact**: Low. Branch names are for human readability. The behavior is consistent across runs on the same machine. Cross-machine collaboration with different timezones could cause confusing branch names, but this is a single-user tool.

**Recommendation**: Document this is intentional (local time for branch names) or convert to UTC for consistency. Not blocking.

---

## Phase 6: Currency & Numeric Precision Consistency

**Status**: ⚠️ SIGNIFICANT DRIFT (1 inconsistency)

### Cost Formatting (USD)

| Location | Function | Precision | Example Output |
|----------|----------|-----------|----------------|
| `src/report.js:45-48` | `formatCost()` | **4 decimals** | `$0.1234` |
| `gui/resources/logic.js:127-130` | `formatCost()` | **2 decimals** | `$0.12` |

**This is an inconsistency**:
- CLI reports show `$0.1234` (4 decimal places)
- GUI shows `$0.12` (2 decimal places)

**Impact**: Medium. User sees different precision in different interfaces. No data corruption (internal values are full precision floats), but presentation is inconsistent.

**Recommendation**: Align to one standard. Report typically uses 4 decimals for precision; GUI could match this.

### Duration Formatting

| Location | Function | Format |
|----------|----------|--------|
| `src/report.js:18-28` | `formatDuration()` | `Xh YYm` or `Xm YYs` (padded) |
| `gui/resources/logic.js:66-77` | `formatMs()` | `Xh Ym Zs` or `Xm Zs` or `Zs` (not padded) |
| `src/dashboard-tui.js:34-43` | `formatMs()` | `Xh YYm` or `Xm YYs` or `Xs` (padded) |

**Findings**:
- `report.js` uses 2-digit padding: `1h 05m`, `3m 08s`
- `gui/logic.js` uses no padding: `1h 5m 3s`, `5m 3s`, `3s`
- `dashboard-tui.js` uses 2-digit padding: `1h 05m`, `3m 08s`

**Impact**: Low. Visual inconsistency only. All functions handle edge cases (null, negative, non-finite) correctly.

### Token Formatting

| Location | Function | Thresholds |
|----------|----------|-----------|
| `gui/resources/logic.js:140-151` | `formatTokens()` | >= 1M: 'M' suffix, >= 1k: 'k' suffix |

Only one implementation exists — **consistent by default**.

### Cost Aggregation

All cost aggregation uses floating-point addition in `executor.js:sumCosts()`:

```javascript
costUSD: (a.costUSD || 0) + (b.costUSD || 0)
```

**No decimal precision library used**. At Claude Code API pricing levels ($0.01-$10 per run), floating-point errors are negligible (< 1 cent over millions of operations). Not a concern for this application.

---

## Phase 7: Multi-Tenancy & Data Isolation Consistency

**Status**: ✅ NOT APPLICABLE

NightyTidy is a single-project tool. No multi-tenancy model exists.

### Environment Variable Isolation

`src/env.js` implements an **allowlist-based environment filter** to prevent leaking secrets to Claude Code subprocess:

- **Blocked explicitly**: `CLAUDECODE`
- **Allowed by exact name**: 32 specific vars (PATH, HOME, TEMP, etc.)
- **Allowed by prefix**: `ANTHROPIC_`, `CLAUDE_`, `LC_`, `XDG_`, `GIT_`
- **All others filtered** and logged via `debug()`

**This is secure by design** — blocklist was converted to allowlist (audit #21).

---

## Phase 8: Error Response & Status Code Consistency

**Status**: ✅ CONSISTENT (with documented contracts)

### Error Handling Contract Verification

| Module | Contract | Verified |
|--------|----------|----------|
| `checks.js` | **Throws** with user-friendly messages | ✅ Yes |
| `lock.js` | **Throws** with user-friendly messages | ✅ Yes |
| `claude.js` | **Never throws** → returns `{ success, output, error, ... }` | ✅ Yes |
| `executor.js` | **Never throws** → failed steps recorded | ✅ Yes |
| `orchestrator.js` | **Never throws** → returns `{ success: false, error }` | ✅ Yes |
| `git.js mergeRunBranch` | **Never throws** → returns `{ success: false, conflict: true }` | ✅ Yes |
| `notifications.js` | **Swallows all errors** silently | ✅ Yes |
| `dashboard.js` | **Swallows all errors** silently | ✅ Yes |
| `report.js` | **Warns but never throws** | ✅ Yes |
| `consolidation.js` | **Warns but never throws** → returns `null` on failure | ✅ Yes |
| `sync.js` | **Warns but never throws** → returns `{ success: false, error }` | ✅ Yes |

All 38 contract tests in `contracts.test.js` verify these guarantees.

### HTTP Response Shapes

| Endpoint | Success Shape | Error Shape |
|----------|---------------|-------------|
| Dashboard `/stop` | `{ ok: true }` | `{ error: "Invalid token" }` |
| GUI `/api/*` | `{ ok: true, ...data }` | `{ ok: false, error: "..." }` |
| Orchestrator JSON | `{ success: true, ...data }` | `{ success: false, error: "..." }` |

**Minor inconsistency**: Dashboard uses `ok`, GUI uses `ok`, orchestrator uses `success`. These are different interfaces (browser SSE vs CLI JSON) so this is acceptable.

### HTTP Security Headers

| Location | Headers Applied | On Errors? |
|----------|-----------------|------------|
| `src/dashboard.js:47-51` | CSP, X-Frame-Options, X-Content-Type-Options | ✅ Yes (403, 404) |
| `gui/server.js:30-34` | CSP, X-Frame-Options, X-Content-Type-Options | ✅ Yes (403, 404) |

**100% consistent** — `SECURITY_HEADERS` object used on all responses including error paths.

---

## Rate-Limit Detection Pattern Consistency

**Status**: ⚠️ MINOR DRIFT (pattern subset)

### Patterns Compared

**`src/claude.js` (backend)**:
```javascript
const RATE_LIMIT_PATTERNS = [
  /429/i,
  /rate.?limit/i,
  /quota/i,
  /exceeded/i,
  /overloaded/i,
  /capacity/i,
  /too many requests/i,
  /usage.?limit/i,
  /throttl/i,
  /billing/i,
  /plan.?limit/i,
];
```

**`gui/resources/logic.js` (frontend fallback)**:
```javascript
/rate.?limit|429|quota|exceeded|overloaded|too many requests|usage.?limit|throttl/i
```

**Drift**: GUI is missing `capacity`, `billing`, `plan.?limit` patterns.

**Impact**: Low. The GUI's `detectRateLimit()` is a fallback — the primary path uses `data.errorType === 'rate_limit'` from the backend. The regex fallback only triggers if the backend doesn't classify the error.

**Recommendation**: Sync the patterns or extract to a shared constant. Low priority.

---

## File I/O Atomicity Consistency

**Status**: ⚠️ MINOR DRIFT (2 patterns)

### Atomic Write Pattern (Good)

| Location | Pattern | Atomic? |
|----------|---------|---------|
| `src/orchestrator.js:41-47` | Write to `.tmp`, then `renameSync()` | ✅ Yes |
| `src/lock.js:9-13` | `openSync(path, 'wx')` (O_EXCL) | ✅ Yes |

### Non-Atomic Write Pattern (Risk)

| Location | Pattern | Risk |
|----------|---------|------|
| `src/report.js:150` | `writeFileSync(reportPath, report)` | Truncation on crash |
| `src/consolidation.js` (via writeFileSync) | Direct write | Truncation on crash |
| `src/setup.js` (via writeFileSync) | Direct write | Truncation on crash |
| `src/sync.js` (step files) | Direct write | Truncation on crash |

**Impact**: Low. These files are generated at run end. A crash during report generation is rare and recoverable (re-run).

**Recommendation**: For consistency, could adopt the `.tmp` + rename pattern everywhere. Low priority.

---

## Drift Heat Map

| Concern | Consistency Level | Risk |
|---------|-------------------|------|
| Pagination | ✅ N/A | None |
| Sorting/Filtering | ✅ N/A | None |
| Soft Delete | ✅ N/A | None |
| Audit Logging | ✅ Consistent (100%) | None |
| Timezone Handling | ⚠️ Minor drift (1 deviation) | Low |
| Cost Precision | ⚠️ Significant drift (toFixed mismatch) | Medium |
| Duration Formatting | ⚠️ Minor drift (padding) | Low |
| Multi-Tenancy | ✅ N/A | None |
| Error Contracts | ✅ Consistent (100%) | None |
| HTTP Security Headers | ✅ Consistent (100%) | None |
| Rate-Limit Patterns | ⚠️ Minor drift (subset) | Low |
| File Atomicity | ⚠️ Minor drift (2 patterns) | Low |

---

## Root Cause Analysis

### Cost Precision Drift (toFixed(4) vs toFixed(2))
- **Cause**: Different developers wrote report.js and gui/logic.js with different assumptions
- **When**: Initial implementation
- **Fix Difficulty**: Easy — change one line in gui/logic.js

### Timezone Drift (local vs UTC)
- **Cause**: `git.js:getTimestamp()` was written for human-readable branch names
- **When**: Initial implementation
- **Fix Difficulty**: Easy — use UTC methods, but may change branch naming convention

### Rate-Limit Pattern Drift
- **Cause**: GUI fallback pattern was added later, copied subset of backend patterns
- **When**: Rate-limit handling evolution
- **Fix Difficulty**: Easy — extract to shared constant

---

## Prevention Recommendations

| Concern | Recommendation | Effort |
|---------|----------------|--------|
| Cost precision | Add comment in report.js documenting 4-decimal standard | Low |
| Timestamp consistency | Document intentional local-time usage in git.js or convert to UTC | Low |
| Rate-limit patterns | Extract to shared constant importable by both backend and frontend | Medium |
| File atomicity | Create `atomicWrite(path, content)` utility in a shared module | Medium |

---

## Recommendations Summary

| # | Recommendation | Impact | Risk if Ignored | Worth Doing? | Details |
|---|----------------|--------|-----------------|--------------|---------|
| 1 | Align cost formatting precision (toFixed) | GUI shows different precision than CLI | Low — cosmetic only | Probably | One-line fix in gui/logic.js to use toFixed(4) |
| 2 | Document or fix git.js timestamp timezone | Branch names use local time, logs use UTC | Low — single-user tool | Only if time | Document intentional design or convert to UTC |
| 3 | Sync rate-limit regex patterns | GUI fallback may miss some rate-limit errors | Low — fallback path only | Probably | Extract patterns to shared constant |
| 4 | Adopt atomic write pattern everywhere | Files could be truncated on crash during write | Low — rare failure mode | Only if time | Create shared atomicWrite() utility |

---

## Changes Made

None. This was a read-only audit.

---

## Files Audited

### Core Source Files (13 files)
- `src/executor.js` — cost aggregation, duration calculation
- `src/claude.js` — rate-limit patterns, error classification
- `src/report.js` — cost/duration formatting
- `src/orchestrator.js` — state file atomicity, JSON response shapes
- `src/dashboard.js` — security headers, CSRF
- `src/git.js` — timestamp generation
- `src/lock.js` — atomic lock acquisition
- `src/logger.js` — timestamp format
- `src/env.js` — allowlist filtering
- `src/setup.js` — file writes
- `src/consolidation.js` — file writes
- `src/sync.js` — file writes
- `src/dashboard-tui.js` — duration formatting

### GUI Files (2 files)
- `gui/server.js` — security headers, log format
- `gui/resources/logic.js` — cost/duration formatting, rate-limit detection

### Test Files (1 file)
- `test/contracts.test.js` — error contract verification

---

*Generated by NightyTidy Cross-Cutting Consistency Audit*
