# Race Condition & Concurrency Audit Report #03

**Date:** 2026-03-12
**Auditor:** Claude Opus 4.5
**Scope:** Full codebase concurrency review

---

## 1. Executive Summary

**Safety Level: ROBUST**

NightyTidy is **architecturally designed to avoid concurrency issues**. It operates as a sequential batch orchestration system with explicit anti-concurrency mechanisms:

- **Single-process enforcement** via atomic lock file (`O_EXCL` file creation)
- **Sequential step execution** — no parallel step processing
- **No database** — file-based JSON state only
- **No distributed cache** — in-memory maps with single-writer patterns
- **Node.js single-threaded event loop** — concurrent HTTP requests are serialized

At 100 concurrent users attempting simultaneous runs:
1. **99 would be rejected** by the lock file mechanism
2. **1 would execute normally** in sequential mode

### Identified Issues by Severity

| Severity | Count | Description |
|----------|-------|-------------|
| Critical | 0 | No critical race conditions |
| High | 0 | No high-severity races |
| Medium | 0 | No medium-severity races (previous audit's output buffer race was fixed) |
| Low | 3 | Benign races with existing mitigations |
| Informational | 4 | Design patterns that could be problematic at scale but are safe for current use |

---

## 2. Shared Mutable State Analysis

### 2.1 Module-Level Mutable State Inventory

| File | Variable | Type | Access Pattern | Risk |
|------|----------|------|----------------|------|
| `src/logger.js` | `logFilePath`, `minLevel`, `logQuiet` | string, string, bool | Write-once at init | **None** — immutable after `initLogger()` |
| `src/git.js` | `git`, `projectRoot` | SimpleGit, string | Write-once at init | **None** — immutable after `initGit()` |
| `src/report.js` | `cachedVersion` | string | Lazy-cached read | **None** — read-once caching |
| `src/prompts/loader.js` | `STEPS`, `DOC_UPDATE_PROMPT`, etc. | arrays, strings | ESM live bindings | **Low** — see Section 2.2 |
| `src/dashboard.js` | `ds` (11 fields) | singleton object | Concurrent SSE access | **Low** — mitigated |
| `src/dashboard-standalone.js` | `sseClients`, `currentState`, etc. | Set, object | Concurrent SSE access | **Low** — mitigated |
| `gui/server.js` | `activeProcesses`, `lastHeartbeat`, `guiLogBuffer` | Map, number, array | Concurrent HTTP handlers | **Low** — mitigated |

### 2.2 Prompt Live Binding Race (FINDING-01)

**Location:** `src/prompts/loader.js:32-55`

**Pattern:**
```javascript
export let STEPS = loadAllSteps();  // ESM live binding

export function reloadSteps() {
  STEPS = loadAllSteps();  // Reassignment during sync
}
```

**Interleaved Timeline (Theoretical):**
```
T1: executor.js reads STEPS[0].prompt → "Version A"
T2: sync.js calls reloadSteps() → STEPS reassigned
T3: executor.js reads STEPS[1].prompt → "Version B" (new version)
```

**Risk:** LOW
**Why Mitigated:**
1. `reloadSteps()` is only called by `autoSyncPrompts()` which runs **before** step execution
2. The init sequence (CLAUDE.md line 213-221) ensures sync completes before execution starts
3. Sequential step execution means no concurrent reads of STEPS during a run

**Recommendation:** None required. Current architecture prevents this race.

### 2.3 SSE Client Set Mutation (FINDING-02)

**Location:** `src/dashboard.js:310-316`, `src/dashboard-standalone.js:61-68`

**Pattern:**
```javascript
for (const client of ds.sseClients) {
  try { client.write(ssePayload); }
  catch { ds.sseClients.delete(client); }  // Mutation during iteration
}
```

**Interleaved Timeline:**
```
T1: Loop iteration starts, client A is yielded
T2: New HTTP request → handleSSE() → sseClients.add(clientB)
T3: Loop continues, clientB may or may not be visited
```

**Risk:** LOW
**Why Mitigated:**
1. Set iteration in JavaScript creates an implicit snapshot of keys
2. New additions during iteration may be skipped (harmless — client gets data on next broadcast)
3. Deletions are in catch blocks which handle the "client already gone" case
4. SSE is fire-and-forget; missing one broadcast is benign

**Recommendation:** For robustness, could snapshot before iteration:
```javascript
for (const client of [...ds.sseClients]) { ... }
```
But this is optional — current code is safe.

### 2.4 GUI Heartbeat Update Race (FINDING-03)

**Location:** `gui/server.js:200, 352-379, 820-830`

**Pattern:**
```javascript
let lastHeartbeat = Date.now();  // Module-level mutable

// Multiple handlers update:
handleHeartbeat(res) { lastHeartbeat = Date.now(); }
handleSelectFolder(res) { ...; lastHeartbeat = Date.now(); }

// Watchdog reads:
if (Date.now() - lastHeartbeat > THRESHOLD) { shutdown(); }
```

**Interleaved Timeline:**
```
T1: Watchdog reads lastHeartbeat = 1000
T2: HTTP handler writes lastHeartbeat = 5000
T3: Watchdog computes gap using stale value (wrong but harmless)
```

**Risk:** NEGLIGIBLE
**Why Mitigated:**
1. Updates are monotonically increasing (always `Date.now()`)
2. Watchdog checks `activeProcesses.size > 0` and skips heartbeat check during runs
3. Worst case: server shuts down a few seconds early when idle
4. This is defensive cleanup, not business logic

**Recommendation:** None required.

---

## 3. Database Race Conditions

**Finding: NOT APPLICABLE**

NightyTidy has **no database**. State is persisted via:

| File | Format | Access Pattern |
|------|--------|----------------|
| `nightytidy-run-state.json` | JSON | Atomic write (temp + rename) |
| `nightytidy-progress.json` | JSON | Single writer per run |
| `nightytidy.lock` | JSON | Atomic create (`O_EXCL`) |
| `nightytidy-run.log` | Text | Append-only, single process |

### 3.1 State File Write Pattern (INFORMATIONAL-01)

**Location:** `src/orchestrator.js:111-118`

```javascript
function writeState(projectDir, state) {
  const tmp = target + '.tmp';
  writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  renameSync(tmp, target);  // Atomic on POSIX/Windows
}
```

**Assessment:** This is the **correct** pattern for atomic file updates. No race condition exists.

### 3.2 Lock File Atomicity (INFORMATIONAL-02)

**Location:** `src/lock.js:33-37`

```javascript
function writeLockFile(lockPath, content) {
  const fd = openSync(lockPath, 'wx');  // O_EXCL — fails if exists
  writeFileSync(fd, content);
  closeSync(fd);
}
```

**Assessment:** This is the **correct** pattern for mutual exclusion via filesystem. `O_EXCL` provides atomicity.

---

## 4. Cache Race Conditions

**Finding: MINIMAL RISK**

NightyTidy has **no distributed cache** (no Redis, Memcached). In-memory caches:

| Cache | Location | Pattern | Risk |
|-------|----------|---------|------|
| `cachedVersion` | `report.js` | Lazy read-once | None |
| `lastRawJson` | `dashboard-standalone.js` | Single-thread polling | None |
| `lastRenderedOutput` | `gui/app.js` (frontend) | Single-thread JS | None |

### 4.1 Frontend State Object (INFORMATIONAL-03)

**Location:** `gui/resources/app.js:101-135`

```javascript
const state = {
  screen: SCREENS.SETUP,
  projectDir: null,
  steps: [],
  // ... 30+ fields
};
```

**Assessment:**
- JavaScript is single-threaded; no race possible between state reads/writes
- Async operations (`await`) yield but don't create true concurrency
- State machine transitions are controlled by `showScreen()` which clears conflicts

---

## 5. Queue & Job Idempotency

**Finding: WELL-DESIGNED**

NightyTidy doesn't use a message queue, but has equivalent "job" semantics in step execution:

### 5.1 Step Execution Idempotency

**Pattern:** Steps are NOT idempotent by design — they're meant to run once per improvement cycle.

**Protection Mechanisms:**
1. **Lock file** prevents concurrent runs
2. **State file** tracks `completedSteps[]` and `failedSteps[]`
3. **`validateStepCanRun()`** (orchestrator.js:179-190) rejects already-completed steps

```javascript
if (state.completedSteps.some(s => s.number === stepNumber)) {
  return `Step ${stepNumber} has already been completed in this run.`;
}
```

### 5.2 Rate-Limit Retry Pattern (INFORMATIONAL-04)

**Location:** `src/executor.js:339-382`

**Pattern:** Exponential backoff with probe attempts

```javascript
for (let attempt = 0; attempt < BACKOFF_SCHEDULE_MS.length; attempt++) {
  await sleep(waitMs, signal);
  const probe = await runPrompt('Reply with the single word OK.', ...);
  if (probe.success) return true;  // Resume execution
}
```

**Assessment:**
- Single-threaded wait loop — no concurrency
- Abort signal support for graceful cancellation
- No idempotency issues — retries are expected behavior

---

## 6. Frontend Concurrency

### 6.1 Double-Submission Prevention

**Location:** `gui/resources/app.js:521-530`

```javascript
async function startRun() {
  const startBtn = document.getElementById('btn-start-run');
  startBtn.disabled = true;  // Immediate visual feedback
  startBtn.textContent = 'Starting...';
  // ... async work
}
```

**Assessment:** ✅ Correctly prevents double-click issues.

**Other buttons with similar protection:**
- `selectFolder()` (lines 420-443)
- `skipStep()` (lines 1334-1347)
- `stopRun()` (lines 1405-1430)
- `initializeGit()` (lines 379-393)
- `createInitialCommit()` (lines 398-412)

### 6.2 Polling Race with State Updates

**Location:** `gui/resources/app.js:916-948, 950-1042`

**Pattern:**
```javascript
async function pollProgress() {
  const result = await api('read-file', { path: progressPath });
  if (result.ok) renderProgressFromFile(JSON.parse(result.content));
}
```

**Potential Issue:** Poll response arrives after step completion, rendering stale data.

**Why Mitigated:**
1. `renderProgressFromFile()` checks `if (progress.currentStepOutput !== lastRenderedOutput)`
2. State transitions (`runNextStep()`) clear `lastRenderedOutput`
3. UI updates are idempotent — re-rendering same state is harmless

---

## 7. Concurrency Test Coverage

### 7.1 Existing Tests

| Test File | Concurrency Coverage |
|-----------|---------------------|
| `lock.test.js` | Atomic lock acquisition, EEXIST handling |
| `lock-extended.test.js` | Concurrent lock attempts, stale lock cleanup |
| `dashboard.test.js` | SSE client management, CSRF |
| `gui-server.test.js` | Singleton guard, process tracking |
| `executor.test.js` | Sequential step execution, abort signal |
| `orchestrator.test.js` | State file reads/writes, step validation |

### 7.2 Test Recommendations

No additional concurrency tests needed. Existing coverage is comprehensive for the architecture.

---

## 8. Risk Map

| # | Location | Issue | Likelihood | Impact | Risk Score | Remediation |
|---|----------|-------|------------|--------|------------|-------------|
| 1 | `prompts/loader.js` | ESM binding race | Very Low | Low | 1/25 | None (mitigated by design) |
| 2 | `dashboard.js` | SSE Set mutation | Low | Very Low | 2/25 | Optional: snapshot before iteration |
| 3 | `gui/server.js` | Heartbeat race | Very Low | Negligible | 1/25 | None (benign) |

**Conclusion:** No actionable race conditions. The codebase follows robust single-writer patterns.

---

## 9. Recommendations

### Immediate Fixes
None required.

### Patterns for New Code

1. **Continue using atomic file operations** (`O_EXCL`, temp+rename) for state files
2. **Continue using lock file** for cross-process mutual exclusion
3. **If adding Redis/caching:** Follow cache-aside pattern with explicit invalidation
4. **If adding parallel step execution:** Introduce proper job queue with idempotency keys

### Infrastructure Considerations
None needed for current single-user batch architecture.

### Monitoring
None needed — current logging captures all execution paths.

---

## 10. Comparison with Previous Audits

### Audit #01 (2026-03-09)
- Identified theoretical ESM binding race — still present but mitigated by design
- Recommended defensive coding patterns — already followed

### Audit #02 (2026-03-10)
- Identified output buffer race in `broadcastOutput()` — **FIXED** (FINDING-07 in previous audit)
- Fix verified: `stopDashboard()` now clears `outputWriteTimer` (dashboard.js:326-331)

### Audit #03 (This Report)
- Confirms all previous findings are addressed
- No new actionable issues discovered
- Codebase rated ROBUST for concurrency safety

---

## Appendix: Module Dependency Graph (Concurrency View)

```
┌─────────────────────────────────────────────────────────────┐
│                    SINGLE PROCESS BOUNDARY                   │
│                    (enforced by lock.js)                     │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐    Sequential    ┌──────────────┐         │
│  │  cli.js      │ ──────────────▶  │ executor.js  │         │
│  │  (entry)     │                  │ (step loop)  │         │
│  └──────────────┘                  └──────────────┘         │
│         │                                 │                  │
│         │                                 ▼                  │
│         │                          ┌──────────────┐         │
│         │                          │  claude.js   │         │
│         │                          │ (subprocess) │         │
│         │                          └──────────────┘         │
│         ▼                                                    │
│  ┌──────────────┐                                            │
│  │ dashboard.js │◀──── SSE ────┐                             │
│  │ (HTTP + SSE) │               │ (concurrent clients)      │
│  └──────────────┘               │ (mitigated)                │
│                                 │                            │
└─────────────────────────────────┴────────────────────────────┘
```

---

**End of Report**
