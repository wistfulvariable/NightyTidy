# NightyTidy Data Integrity & Validation Audit Report

**Run #:** 01
**Date:** 2026-03-10
**Auditor:** Claude Code (NightyTidy automated audit)

---

## 1. Executive Summary

### Overall Health: **GOOD**

NightyTidy demonstrates **solid data integrity practices for a CLI tool without a database**. The codebase uses JSON state files for persistence with atomic write patterns, comprehensive environment variable filtering, and careful process lifecycle management.

### Critical Gaps: 0
### High-Severity Issues: 0
### Medium-Severity Issues: 6
### Low-Severity Issues: 8

| Category | Issues Found |
|----------|-------------|
| Input Validation | 4 gaps (medium severity) |
| State File Constraints | 3 gaps (medium severity) |
| Orphan/Deletion Risks | 4 findings (medium severity) |
| Schema Drift | 1 finding (low severity) |
| Business Invariants | Well-documented; 2 undocumented |

---

## 2. Input Validation Audit

### 2.1 Validated Boundaries (Strong Coverage)

| Input Boundary | Validation | Status |
|---------------|------------|--------|
| CLI `--steps` | Integer range 1-33, parsed and validated | ✅ Good |
| CLI `--timeout` | Positive finite number validation | ✅ Good |
| CLI `--run-step` | Positive finite number validation | ✅ Good |
| Environment Variables | Allowlist + prefix matching (env.js) | ✅ Excellent |
| Lock File | Atomic O_EXCL acquisition, staleness check | ✅ Excellent |
| HTTP Body Size | 1MB limit enforced in gui/server.js | ✅ Good |
| Static File Paths | Traversal protection with boundary check | ✅ Good |
| Delete File API | Allowlist of 3 ephemeral files only | ✅ Excellent |

### 2.2 Unvalidated Boundaries (Gaps)

#### Gap 1: GUI `/api/run-command` — No Command Sanitization
**File:** `gui/server.js:277-318`
**Severity:** Medium (by design, but risky)
**Issue:** Command string passed directly to `spawn(command, [], { shell: true })` with no validation.

```javascript
const proc = spawn(command, [], {
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
  shell: true,  // ← Arbitrary shell command execution
});
```

**Risk:** Any process with access to localhost:PORT can execute arbitrary commands as the current user.

**Mitigation (current):** Server binds to `127.0.0.1` only. No network exposure.

**Recommendation:** Document that GUI server should never be exposed beyond localhost.

---

#### Gap 2: Google Doc Sync URL — No URL Validation
**File:** `src/sync.js:278-300`
**Severity:** Low
**Issue:** URL passed to `fetch()` without validation of scheme, host, or format.

```javascript
const response = await fetch(url, {
  signal: controller.signal,
  headers: { 'User-Agent': 'NightyTidy-Sync/1.0' },
});
```

**Risk:** SSRF if user passes malicious `--sync-url` (e.g., internal network addresses).

**Mitigation (current):** User explicitly provides URL via `--sync-url`. No automatic fetching.

**Recommendation:** Add URL scheme validation (https only) and optional domain allowlist.

---

#### Gap 3: State File Field Validation Missing
**File:** `src/orchestrator.js:92-102`
**Severity:** Medium
**Issue:** `readState()` only validates `version` field. Missing validation for:
- `selectedSteps` is array of integers
- `completedSteps` and `failedSteps` are arrays
- `startTime` is a number
- Required string fields are present

**Example crash scenario:**
```json
{"version": 1, "originalBranch": "main"}  // Missing selectedSteps
```
Results in crash at `state.selectedSteps.includes()`.

**Recommendation:** Add schema validation function:
```javascript
function isValidState(data) {
  return data.version === STATE_VERSION
    && Array.isArray(data.selectedSteps)
    && data.selectedSteps.every(n => Number.isInteger(n))
    && Array.isArray(data.completedSteps)
    && Array.isArray(data.failedSteps)
    && typeof data.startTime === 'number';
}
```

---

#### Gap 4: Log Level Environment Variable — Invalid Values Warned But Accepted
**File:** `src/logger.js`
**Severity:** Low
**Current Behavior:** Warns on invalid `NIGHTYTIDY_LOG_LEVEL` values but continues with default.

**Status:** Acceptable — warning is sufficient.

---

### 2.3 Frontend vs Backend Consistency

NightyTidy is a CLI tool with a local-only GUI. No frontend/backend validation mismatch concerns apply. The GUI server (`gui/server.js`) performs all validation server-side.

---

## 3. State File Constraints (Database Equivalent)

NightyTidy uses 4 JSON state files instead of a database:

### 3.1 State Files Schema Summary

| File | Purpose | Atomic Write? | Version Check? |
|------|---------|--------------|----------------|
| `nightytidy-run-state.json` | Orchestrator run state | ✅ Yes (tmp+rename) | ✅ Yes |
| `nightytidy-progress.json` | Dashboard progress | ❌ No | ❌ No |
| `nightytidy.lock` | Cross-process lock | ✅ Yes (O_EXCL) | N/A |
| `manifest.json` | Prompt index | N/A (shipped) | ❌ No |

### 3.2 Missing Constraints

#### Constraint Gap 1: OrchestratorState — No Field Type Enforcement
**File:** `src/orchestrator.js:33-44` (typedef) vs `readState()` (line 92-102)

**Declared Type:**
```typescript
interface OrchestratorState {
  version: number;
  originalBranch: string;
  runBranch: string;
  tagName: string;
  selectedSteps: number[];
  completedSteps: StepEntry[];
  failedSteps: StepEntry[];
  startTime: number;
  timeout: number | null;
  dashboardPid: number | null;
  dashboardUrl: string | null;
}
```

**Validated on Read:** Only `version` field.

**Impact:** Corrupted or tampered state files can crash the application.

---

#### Constraint Gap 2: ProgressState — No Enum Validation
**File:** `src/orchestrator.js:219-228`

**Declared Status Enum:** `'running' | 'paused' | 'completed' | 'error'`

**Validated on Read:** Never. Readers assume `status` is one of 4 values.

**Impact:** Invalid status values silently pass through; UI may show unexpected states.

---

#### Constraint Gap 3: No State File Version Migration
**File:** `src/orchestrator.js:72`

**Current:** `const STATE_VERSION = 1`

**Problem:** No migration path when version increments. If schema changes:
- Old state file passes version check
- New code crashes on missing fields

**Recommendation:** Implement versioned migration:
```javascript
function migrateState(data) {
  if (data.version === 1 && STATE_VERSION === 2) {
    data.newField = defaultValue;
    data.version = 2;
  }
  return data;
}
```

---

### 3.3 Existing Data Violations

**N/A** — NightyTidy creates fresh state files per run. No persistent database to audit.

---

## 4. Orphaned Data & Referential Integrity

### 4.1 Deletion Patterns

| Artifact | Deletion Point | Child Cleanup | Status |
|----------|---------------|---------------|--------|
| State file | `finishRun()` → `deleteState()` | Dashboard stopped first | ✅ Correct |
| Progress file | `stopDashboard()` / `cleanupDashboard()` | N/A | ✅ Correct |
| Lock file | `releaseLock()` / process exit | N/A | ✅ Correct |
| Dashboard URL file | `stopDashboard()` / `cleanupDashboard()` | N/A | ✅ Correct |
| Git run branch | Never (intentional) | N/A | ⚠️ Documented |
| Git safety tag | Never (intentional) | N/A | ✅ Intentional |

### 4.2 Orphan Risks Identified

#### Risk 1: TUI Window Not Killed on Dashboard Stop
**File:** `src/dashboard.js:236-282`
**Severity:** Medium
**Issue:** `stopDashboard()` sets `ds.tuiProcess = null` but does not kill the process.

**Impact:** Terminal window remains open after run completes.

**Diagnostic Query:** `ps aux | grep dashboard-tui` (Unix) / Task Manager (Windows)

---

#### Risk 2: Dashboard Not Stopped on SIGINT Abort
**File:** `src/cli.js:129-154`
**Severity:** Medium
**Issue:** `handleAbortedRun()` does not call `stopDashboard()`.

**Impact:** Dashboard server and port remain bound; progress file not cleaned up.

**Diagnostic:** Check for `nightytidy-progress.json` after Ctrl+C abort.

---

#### Risk 3: Persistent Lock Not Released on Orchestrator Error
**File:** `src/orchestrator.js:412-489`
**Severity:** Medium
**Issue:** If process crashes after `initRun()`, lock persists for 24 hours.

**Impact:** Subsequent runs fail with "Another run in progress" until lock expires.

**Diagnostic Query:**
```bash
cat nightytidy.lock  # Check PID and timestamp
ps -p <PID>          # Check if process exists
```

---

#### Risk 4: Run Branches Accumulate on Merge Conflict
**File:** `src/git.js:212-228`
**Severity:** Low
**Issue:** Orphaned branches from failed merges are not auto-deleted.

**Impact:** Git history clutter. No operational impact.

**Diagnostic Query:**
```bash
git branch | grep 'nightytidy/run-'
```

---

### 4.3 Diagnostic Queries for Orphan Detection

**Stale lock file:**
```bash
# Run manually after suspected orphan
cat nightytidy.lock 2>/dev/null && echo "Lock exists"
```

**Orphaned processes (Unix):**
```bash
ps aux | grep -E 'dashboard-tui|dashboard-standalone' | grep -v grep
```

**Orphaned ephemeral files:**
```bash
ls -la nightytidy-*.json nightytidy-*.url 2>/dev/null
```

---

## 5. Schema vs Application Drift

### 5.1 JSDoc Types vs Runtime Usage

NightyTidy uses JSDoc `@typedef` for type documentation. The types are comprehensive and well-maintained.

| Module | Types Defined | Runtime Validation | Drift? |
|--------|--------------|-------------------|--------|
| `claude.js` | 8 typedefs | None (returns objects) | No |
| `executor.js` | 5 typedefs | None (constructs objects) | No |
| `orchestrator.js` | 8 typedefs | Version check only | **Yes** |
| `report.js` | 2 typedefs | None (constructs objects) | No |
| `git.js` | 2 typedefs | None | No |

**Finding:** `OrchestratorState` typedef (line 33-44) defines 11 required fields, but `readState()` only validates 1 (`version`).

### 5.2 Manifest vs STEPS Consistency

**File:** `src/prompts/loader.js`

**Invariant:** Manifest has 33 entries mapping to 33 markdown files.

**Validation:** Test-time only (`steps.test.js`). No runtime validation.

**Status:** Acceptable for shipped file. ✅

### 5.3 STEPS_HASH Integrity Check

**File:** `src/executor.js:64-67`

```javascript
const STEPS_HASH = '1578cc610e97618b4eacdbfb79be29b7aa2715b0c4fa32b960eaa21f8ef2ab6a';
```

**Purpose:** Detects unauthorized prompt modifications.

**Validation:** Computed at runtime, compared, warns if mismatch.

**Status:** ✅ Excellent integrity mechanism.

---

## 6. Business Invariants

### 6.1 Documented Invariants (in CLAUDE.md)

| Invariant | Enforced? | Diagnostic Query |
|-----------|-----------|-----------------|
| Logger must be initialized first | Yes (throws) | Code review |
| Lock file prevents concurrent runs | Yes (O_EXCL) | `cat nightytidy.lock` |
| All steps run on dedicated branch | Yes (createRunBranch) | `git branch --show-current` |
| No bare `console.log` in production | No (convention) | `grep console.log src/` |
| 33 prompts in manifest | Yes (test) | `npm test` |
| STEPS_HASH matches prompt content | Yes (runtime warn) | Hash comparison at startup |

### 6.2 Undocumented Invariants (Discovered)

#### Invariant 1: Step Numbers Are 1-Indexed and Contiguous
**Location:** `src/prompts/loader.js:22`
```javascript
export const STEPS = manifest.steps.map((entry, index) => ({
  number: index + 1,  // ← Implicit 1-indexing
  ...
}));
```

**Enforcement:** Implicit in loader. Tests verify 33 steps exist.

**Diagnostic:** `STEPS.map(s => s.number)` should equal `[1, 2, ..., 33]`.

---

#### Invariant 2: State File Must Be Deleted Before Lock Release
**Location:** `src/orchestrator.js:706-708`
```javascript
cleanupDashboard(projectDir);  // First
releaseLock(projectDir);        // Then
deleteState(projectDir);        // Last
```

**Rationale:** If lock released before state deleted, concurrent run could start with stale state.

**Enforcement:** Order in `finishRun()`. No cross-check.

**Recommendation:** Add comment documenting ordering requirement.

---

### 6.3 Business Invariant Table

| # | Invariant | Currently Enforced? | Diagnostic Query | Recommendation |
|---|-----------|--------------------|--------------------|----------------|
| 1 | Step numbers 1-indexed, contiguous | Test-time | `STEPS.map(s=>s.number)` | Document in CLAUDE.md |
| 2 | State deleted before lock released | Order-dependent | Code review | Add assertion comment |
| 3 | Dashboard URL only valid during run | Implicit (file deleted) | File exists? | N/A |
| 4 | One step in_progress at a time | Implicit (serial execution) | State file check | N/A |
| 5 | Cost data present only on success | Conditional | `result.cost` null check | N/A |

---

## 7. Recommendations

### Priority Matrix

| # | Recommendation | Impact | Risk if Ignored | Worth Doing? | Details |
|---|---------------|--------|-----------------|--------------|---------|
| 1 | Add state file field validation | Prevents crashes on corrupted state | Medium | Yes | Validate array types, required strings, and numeric ranges in `readState()`. 10-15 lines of code. |
| 2 | Call `stopDashboard()` in `handleAbortedRun()` | Prevents orphaned server/TUI | Medium | Yes | Single line fix. Dashboard and port cleaned up on Ctrl+C. |
| 3 | Kill TUI process in `stopDashboard()` | Prevents orphaned terminal window | Medium | Yes | Add 2 lines: `if (ds.tuiProcess) try { ds.tuiProcess.kill(); } catch {}`. |
| 4 | Add process exit handler for orchestrator lock | Prevents 24h lock on crash | Medium | Probably | Add exit handler to release lock if state file missing. ~5 lines. |
| 5 | Document state file version migration path | Prepares for schema changes | Low | Only if time allows | No migration needed now; document approach for future. |
| 6 | Add URL scheme validation to `--sync-url` | Prevents SSRF on user error | Low | Only if time allows | Low risk since user explicitly provides URL. |
| 7 | Document run branch cleanup instructions | Reduces git clutter | Low | Only if time allows | Add to CLAUDE.md: "Safe to delete branches after merge." |
| 8 | Add ProgressState enum validation | Prevents silent bad states | Low | Only if time allows | Low impact; readers handle gracefully. |

---

## 8. Report Location

**Full Report:** `audit-reports/DATA_INTEGRITY_REPORT_01_2026-03-10.md`

---

## Appendix A: Files Audited

| File | Lines | Category |
|------|-------|----------|
| `src/cli.js` | 645 | CLI lifecycle |
| `src/orchestrator.js` | 735 | Orchestrator state |
| `src/claude.js` | ~400 | Subprocess handling |
| `src/executor.js` | ~370 | Step execution |
| `src/git.js` | ~230 | Git operations |
| `src/checks.js` | 269 | Pre-run validation |
| `src/env.js` | 74 | Env var filtering |
| `src/lock.js` | ~120 | Lock file handling |
| `src/sync.js` | 536 | Google Doc sync |
| `src/dashboard.js` | ~280 | Progress dashboard |
| `gui/server.js` | 635 | GUI HTTP server |
| `src/prompts/loader.js` | ~30 | Manifest loading |

---

## Appendix B: Test Coverage for Data Integrity

| Test File | Tests | Coverage Area |
|-----------|-------|---------------|
| `orchestrator.test.js` | 40 | State management, costs |
| `orchestrator-extended.test.js` | 11 | Error paths, timeout |
| `lock.test.js` | 9 | Lock acquisition/release |
| `contracts.test.js` | 38 | Module API contracts |
| `gui-server.test.js` | 44 | HTTP endpoints, security |
| `steps.test.js` | 9 | Manifest structure |
| `sync.test.js` | 64 | Doc parsing, sync |

**Total Data Integrity Tests:** ~215

**Missing Coverage:**
- Corrupted JSON file handling (only mocked, no real corruption tests)
- Race condition tests (minimal)
- SIGINT cleanup validation (not explicitly tested)

---

*Report generated by NightyTidy Data Integrity Audit, Run #01*
