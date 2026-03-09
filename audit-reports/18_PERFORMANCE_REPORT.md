# Audit #18 — Performance Analysis Report

**Date**: 2026-03-09
**Auditor**: Claude Opus 4.6
**Scope**: Application-level performance, memory/resource management, frontend performance, quick wins

---

## Phase 1: Database — SKIPPED

NightyTidy has no database. State persists via JSON files (`nightytidy-run-state.json`, `nightytidy-progress.json`) and git operations. No database-related performance analysis is applicable.

---

## Phase 2: Application-Level Performance

### 2.1 Subprocess Spawning Patterns (claude.js, checks.js)

**Finding: `cleanEnv()` duplicated across modules** (LOW)
- `cleanEnv()` is defined identically in both `claude.js` (line 26) and `checks.js` (line 11)
- Each call creates a shallow copy of `process.env` via spread operator
- This is called on every Claude subprocess spawn and every pre-check command
- **Impact**: Minimal — `process.env` spread is O(n) where n is ~50-100 env vars. Called infrequently (once per step). Not a hot path.
- **Action**: Extract to shared utility for DRY, but no performance gain.

**Finding: Shell mode correctly gated by platform** (OK)
- `claude.js` line 138: `platform() === 'win32'` checked once per `runOnce()` call
- `os.platform()` returns a cached value — no syscall overhead
- Shell mode is required on Windows (claude is a .cmd script)

**Finding: Subprocess stdout accumulation via string concatenation** (LOW)
- `claude.js` line 97: `stdout += text` in hot data handler
- String concatenation in a loop is O(n^2) in theory, but:
  - Claude Code outputs are typically < 100KB
  - V8 optimizes string concatenation via ropes/concat strings
  - No realistic scenario where this becomes a bottleneck
- **Action**: No change needed. Buffer/array join would add complexity for negligible gain.

### 2.2 File I/O Patterns

**Finding: Synchronous file I/O on hot paths** (MEDIUM)
- `logger.js` line 39: `appendFileSync()` on every log call — this blocks the event loop
- `dashboard.js` line 193: `writeFileSync()` for progress JSON on every state update
- `dashboard.js` line 264: `writeFileSync()` for output buffer (throttled to 500ms)
- `orchestrator.js` line 113: `writeFileSync()` for progress JSON
- **Impact**: `appendFileSync` in the logger is called dozens of times per step. Each call blocks the event loop for disk I/O. However, NightyTidy's bottleneck is waiting for Claude Code subprocess (minutes per step), so logger sync writes (~1ms each) are negligible compared to total runtime.
- **Action**: Not worth converting to async — the risk of losing log lines on crash outweighs the microsecond gains, and the subprocess wait time dwarfs I/O time.

**Finding: Dashboard progress writes are already throttled** (OK)
- `broadcastOutput()` in `dashboard.js` throttles disk writes to every 500ms via `outputWritePending` flag
- `dashboard-standalone.js` polls at 500ms intervals
- These are appropriate throttle rates for a progress display

**Finding: `readFileSync` in `prompts/loader.js` at import time** (OK)
- 33 markdown files + manifest.json loaded synchronously at module import
- This happens once during startup, before any interactive work
- Cold startup cost: ~5-10ms (small files, local disk)
- **Action**: No change needed — startup-only, not a hot path

**Finding: `readFileSync` in `dashboard-standalone.js` polling loop** (LOW)
- Line 40: `readFileSync` called every 500ms in polling loop
- Combined with `existsSync` check (line 39) = 2 syscalls per tick
- **Impact**: Polling a single small JSON file every 500ms is negligible on modern SSDs
- **Action**: Could combine into try-read pattern (skip `existsSync`), but savings are trivial

### 2.3 Sequential Operations That Could Be Parallel

**Finding: Pre-checks run sequentially but could partially parallelize** (LOW)
- `checks.js` `runPreChecks()` runs 7 checks in sequence: git installed, git repo, has commits, claude installed, claude authenticated, disk space, existing branches
- Some are dependent (can't check repo before git is installed), but `checkDiskSpace` and `checkExistingBranches` are independent of Claude checks
- **Impact**: Pre-checks take ~2-5s total. Claude auth check dominates (~1-2s). Parallelizing independent checks would save ~0.5s at most.
- **Action**: Not worth the complexity — these run once per invocation, and the time savings are imperceptible compared to the multi-hour run.

**Finding: `initRun()` git operations are inherently sequential** (OK)
- `getCurrentBranch()` → `createPreRunTag()` → `createRunBranch()` must execute in order
- No parallelization opportunity here

### 2.4 JSON.parse/stringify Frequency

**Finding: Triple JSON.stringify in `dashboard-standalone.js` poll** (LOW)
- Line 44: `JSON.stringify(state)` to create `stateJson`
- Line 45: `JSON.stringify(currentState)` to compare with previous state
- Line 65: Same `stateJson` reused for SSE payload (good)
- Each poll cycle does 2 JSON.stringify operations on the progress state
- **Impact**: State object is small (< 2KB typically). 2 stringify operations at 500ms intervals is negligible.
- **Optimization applied**: Store the previous raw JSON string instead of the parsed object for comparison, avoiding one `JSON.stringify` per poll cycle.

**Finding: `updateDashboard()` serializes state for both file and SSE** (OK)
- Line 189: Single `JSON.stringify(state)` reused for both file write and SSE broadcast
- This is already optimal

### 2.5 O(n^2) Patterns

**Finding: `buildProgressState()` in `orchestrator.js` uses nested `.find()` calls** (LOW)
- Lines 93-101: For each selected step, calls `.find()` on `completedSteps` and `failedSteps` arrays
- This is O(n*m) where n = selected steps (max 33) and m = completed/failed (max 33)
- **Impact**: With max 33 steps, this is ~1089 operations — completely negligible
- **Action**: No change needed. Using Sets would be premature optimization for 33 items.

**Finding: `validateStepNumbers()` uses `.includes()` in a loop** (OK)
- Lines 57-59: Filters invalid numbers from the input array
- Both arrays are small (max 33 items) — O(n*m) is fine here

**Finding: `escapeHtml()` in dashboard-html.js creates a DOM element** (LOW)
- Lines 461-465: Creates a `div` element, sets `textContent`, reads `innerHTML`
- Called once per step per render (max 33 times per render)
- **Impact**: DOM element creation is cheap for 33 items. The real rendering cost is `innerHTML` on the step list (line 397)

---

## Phase 3: Memory & Resources

### 3.1 Event Listeners

**Finding: SSE client tracking with proper cleanup** (OK)
- `dashboard.js`: SSE clients tracked in `Set`, removed on `close` event (line 58-60)
- `dashboard-standalone.js`: Same pattern (line 86)
- No listener leaks detected

**Finding: Process event listeners accumulate across lock acquisitions** (LOW)
- `lock.js` line 114: `process.on('exit', ...)` adds a new listener every time `acquireLock()` is called
- In normal operation, `acquireLock()` is called once per process. But if called multiple times (e.g., in tests), listeners accumulate.
- **Impact**: In production, this is called once. No memory concern.
- **Action**: No change needed — single-call-per-process pattern

**Finding: `unhandledRejection` listener in cli.js** (OK)
- Added once per process, does not accumulate
- Properly exits the process, preventing orphaned state

**Finding: Abort signal listener cleanup** (OK)
- `claude.js` properly removes abort signal listeners in all exit paths (lines 79, 93, 113, 120)
- Uses `{ once: true }` where appropriate (line 93)

### 3.2 Child Processes

**Finding: All child processes properly tracked and cleaned** (OK)
- `claude.js`: Child processes killed on timeout (line 80) and abort (line 89)
- `dashboard.js`: TUI process spawned with `unref()` — correctly detached
- `orchestrator.js`: Dashboard server PID stored in state for cleanup by `finishRun()`
- `gui/server.js`: Active processes tracked in `Map`, all killed on shutdown

**Finding: `forceKillChild()` leaves orphaned timeout** (MINOR)
- `claude.js` line 13: `setTimeout(() => child.kill('SIGKILL'), 5000)` is never cleared
- If the child dies before 5s, the timer fires on a dead process (caught by try/catch, no harm)
- **Impact**: A 5-second timer object stays in memory. Completely negligible.
- **Action**: Could clear the timeout when child exits, but the complexity isn't justified

### 3.3 Timers

**Finding: `setInterval` in `dashboard-standalone.js` never cleared on normal exit** (LOW)
- Line 132: `setInterval(pollProgress, POLL_INTERVAL)` — the interval ID is not stored
- Line 142: SIGTERM handler calls `clearInterval(pollProgress)` — but this passes the function, not the interval ID. **This is a bug**: `clearInterval` expects the ID returned by `setInterval`.
- **Impact**: On SIGTERM, the interval is not actually cleared. The `server.close()` callback calls `process.exit(0)` which terminates the process anyway, so no practical impact.
- **Action**: Fix by storing the interval ID. This is a correctness fix, not strictly performance, but relates to resource cleanup.

**Finding: `scheduleShutdown()` timer properly cleared** (OK)
- `dashboard.js` line 290: Timer stored in `shutdownTimer`, cleared in `stopDashboard()`

**Finding: `elapsedInterval` in dashboard-html.js client-side** (OK)
- Created in `render()`, cleared when run finishes (lines 433-436)
- Only one interval created (guarded by `!elapsedInterval` check on line 371)

### 3.4 File Handles

**Finding: Lock file handle properly closed** (OK)
- `lock.js` line 10-12: `openSync` → `writeFileSync` → `closeSync` — correct pattern

**Finding: No file handle leaks in error paths** (OK)
- All `writeFileSync`/`readFileSync` calls are atomic (open, write/read, close in one call)
- No manual file handle management elsewhere

### 3.5 Growing Collections Without Bounds

**Finding: Output buffer has proper size limit** (OK)
- `dashboard.js` line 252-254: `outputBuffer` capped at `OUTPUT_BUFFER_SIZE` (100KB)
- Client-side mirror: `dashboard-html.js` line 330-332: Same 100KB limit
- `gui/resources/app.js`: No output buffer limit in `pollProgress()`, but it reads from the file which is already bounded

**Finding: `sseClients` Set unbounded** (MINOR)
- `dashboard.js`: No limit on SSE client connections
- **Impact**: Dashboard is localhost-only (bound to 127.0.0.1). Realistic client count is 1-3 browser tabs. No concern.

**Finding: `stepResults` array in GUI app.js** (OK)
- Grows linearly with step count (max 33 items). No concern.

---

## Phase 4: Frontend Performance

### 4.1 Dashboard HTML/CSS/JS (dashboard-html.js)

**Finding: Full step list re-rendered on every state update via innerHTML** (MEDIUM)
- Line 397-409: `listEl.innerHTML = s.steps.map(...)` rebuilds the entire step list DOM on every state update
- State updates arrive via SSE on every progress change
- **Impact**: With max 33 steps, this is a string concatenation + innerHTML parse of ~33 small HTML fragments. Modern browsers handle this in < 1ms. Not a real bottleneck.
- **Action**: Not worth switching to incremental DOM updates. The step count is fixed and small.

**Finding: `escapeHtml()` creates a temporary DOM element** (LOW)
- Line 461-465: `document.createElement('div')` + textContent/innerHTML pattern
- Called max 33 times per render
- **Impact**: Negligible for this element count

**Finding: No CSS `will-change` or GPU acceleration hints** (OK)
- Progress bar uses `transition: width 0.5s ease` — browser handles this efficiently
- Spinner animation is CSS-only (`@keyframes spin`) — GPU-accelerated by default
- No janky animations detected

### 4.2 GUI App (app.js)

**Finding: Progress polling at 500ms is appropriate** (OK)
- `startProgressPolling()` uses 500ms interval — good balance between responsiveness and resource use
- Elapsed timer at 1000ms — appropriate for second-level granularity

**Finding: `pollProgress()` reads and parses file on every tick** (LOW)
- Makes an HTTP POST to `/api/read-file` every 500ms
- Server reads the file and returns its content
- JSON.parse on every successful response
- **Impact**: The file is small (< 10KB), and this is the only way to get progress in orchestrator mode. The overhead is minimal.

**Finding: `renderRunningStepList()` rebuilds full list via innerHTML** (OK)
- Called once when transitioning to the Running screen
- Not called on updates — individual items are updated via `updateStepItemStatus()` which does targeted DOM manipulation
- **This is better than the dashboard-html.js pattern** — GUI uses incremental updates

**Finding: `renderSummary()` sets innerHTML with `escapeHtml()`** (OK)
- Called once when transitioning to Summary screen
- Uses `NtLogic.escapeHtml()` which is string-based (not DOM-based like dashboard-html.js)
- The string-based approach is faster than creating DOM elements

### 4.3 SSE Connection Management

**Finding: SSE reconnection handled by EventSource defaults** (OK)
- `dashboard-html.js` line 302: `new EventSource('/events')` — browser auto-reconnects on disconnection
- Reconnecting indicator shown/hidden properly (lines 343-349)
- No custom reconnection logic needed

**Finding: No SSE heartbeat/keepalive** (MINOR)
- Long-running SSE connections may be closed by firewalls/proxies
- **Impact**: Dashboard is localhost-only — no proxies involved. Not an issue.

### 4.4 Image/Font Loading

**Finding: No external fonts or images loaded** (OK)
- Dashboard uses system font stack (`-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif`)
- GUI HTML uses `<link rel="stylesheet" href="/styles.css">` — local file
- No external resources = no loading performance concerns

---

## Phase 5: Quick Wins — Implemented

### QW-1: Fix `clearInterval` bug in `dashboard-standalone.js` (CORRECTNESS)

The SIGTERM handler passes the function reference `pollProgress` to `clearInterval()` instead of the interval ID. Fixed by storing the interval ID.

### QW-2: Optimize `dashboard-standalone.js` change detection (MICRO)

Replace double `JSON.stringify` comparison with string comparison against the raw file content. Instead of:
1. `JSON.stringify(state)` (new state)
2. `JSON.stringify(currentState)` (old state)

Store the previous raw JSON string and compare directly:
1. Compare raw strings
2. Only parse if changed

### QW-3: Remove redundant `existsSync` before `readFileSync` in `dashboard-standalone.js` (MICRO)

The `readFileSync` is already inside a try/catch. The `existsSync` check is redundant — if the file doesn't exist, the `readFileSync` will throw and be caught. Removing it saves one syscall per poll cycle (every 500ms).

---

## Summary Table

| Finding | Severity | Hot Path? | Action |
|---------|----------|-----------|--------|
| `cleanEnv()` duplicated | LOW | No | Not fixed (DRY concern, not perf) |
| Sync file I/O in logger | MEDIUM | Marginal | Not fixed (crash safety > perf here) |
| Dashboard full re-render via innerHTML | MEDIUM | No | Not fixed (33 items, < 1ms) |
| Sequential pre-checks | LOW | No | Not fixed (saves < 0.5s on 4-8hr run) |
| Triple JSON.stringify in standalone poll | LOW | Yes (500ms) | **Fixed** (QW-2) |
| `clearInterval(pollProgress)` bug | MINOR | No | **Fixed** (QW-1) |
| Redundant `existsSync` in standalone poll | LOW | Yes (500ms) | **Fixed** (QW-3) |
| forceKillChild orphaned timeout | MINOR | No | Not fixed (negligible) |
| Output string concatenation | LOW | Marginal | Not fixed (V8 handles well) |
| `escapeHtml` DOM element creation | LOW | No | Not fixed (33 calls, negligible) |

## Overall Assessment

NightyTidy has a healthy performance profile for a CLI orchestration tool. The dominant cost is waiting for Claude Code subprocesses (5-30 minutes per step), making most application-level optimizations irrelevant to total runtime. The three quick wins implemented are correctness/micro-optimization fixes in the dashboard polling loop — the only code that runs on a tight interval (500ms).

No O(n^2) bottlenecks, no unbounded memory growth, no event listener leaks, and no blocking I/O on true hot paths. The codebase is well-optimized for its use case.
