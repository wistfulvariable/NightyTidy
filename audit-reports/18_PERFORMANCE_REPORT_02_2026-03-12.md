# Performance Analysis Report — NightyTidy

**Run #02** | March 12, 2026 | Automated overnight performance analysis

---

## Executive Summary

NightyTidy is a well-architected orchestration tool with no traditional database layer. Performance analysis focused on subprocess management, file I/O patterns, and frontend rendering.

### Top 5 Findings

| # | Issue | Severity | Category |
|---|-------|----------|----------|
| 1 | Synchronous logger blocking event loop | Medium | Application |
| 2 | Git subprocess spawns per operation (no batching) | Low | Application |
| 3 | Hash integrity check runs every executeSteps() | Low | Application |
| 4 | Windows PowerShell folder dialog is blocking | Low | GUI |
| 5 | Frontend polling interval could adapt dynamically | Low | Frontend |

### Quick Wins Implemented

None implemented — no safe optimizations identified that wouldn't require behavior changes or significant risk.

### Larger Efforts Needed

None critical. The codebase is lean and well-optimized for its use case (long-running subprocess orchestration). The identified issues are minor and the existing architecture handles them appropriately.

---

## Phase 1: Database Performance

**Not applicable.** NightyTidy has no database layer. All persistence is via:
- JSON state files (`nightytidy-run-state.json`, `nightytidy-progress.json`)
- Log files (`nightytidy-run.log`, `nightytidy-gui.log`)
- Git repository (via `simple-git` wrapper)

The state files are small (<100KB typically) and written infrequently.

---

## Phase 2: Application-Level Performance

### 2.1 Expensive Operations Analysis

#### Logger Synchronous File I/O (`src/logger.js:74`)

**Current behavior:**
```javascript
appendFileSync(logFilePath, line, 'utf8');
```

**Analysis:** Every log call blocks the event loop with synchronous I/O. During a step execution, this is called hundreds of times.

**Impact:** Low-medium. Each call is ~0.1-1ms. During heavy logging (debug mode), cumulative impact could be 50-200ms per step.

**Recommendation:** Document as known behavior. Switching to async would require buffering + flush guarantees, adding complexity. The current design prioritizes log completeness over performance — if Claude Code crashes, all logs are on disk.

**Worth doing?** Only if time allows. The synchronous design is intentional for crash safety.

---

#### Prompt Integrity Hash Check (`src/executor.js:107-119`)

**Current behavior:**
```javascript
const content = steps.map(s => s.prompt).join('');
const hash = createHash('sha256').update(content).digest('hex');
```

**Analysis:** Concatenates all 33 prompts (~50-100KB total) and computes SHA-256 on every `executeSteps()` call.

**Impact:** Negligible. SHA-256 of 100KB takes <1ms on modern hardware.

**Recommendation:** No change needed. The security benefit outweighs the trivial cost.

---

#### Git Operations Per Step (`src/git.js`, `src/executor.js`)

**Current behavior:** Each git operation spawns a subprocess:
- `getCurrentBranch()` — `git status`
- `getHeadHash()` — `git log`
- `ensureOnBranch()` — potentially multiple git calls
- `fallbackCommit()` — `git add`, `git status`, `git commit`

**Analysis:** A typical step makes 4-8 git subprocess calls. Each subprocess spawn is ~50-100ms.

**Impact:** Low. Steps run for 5-45 minutes; 400-800ms of git overhead is negligible.

**Recommendation:** No change. Batching would require significant refactoring and the overhead is <1% of step runtime.

---

### 2.2 Caching Opportunities

| Data | Current Strategy | Recommendation |
|------|------------------|----------------|
| Prompts | Loaded once at startup via `loader.js` | ✓ Already optimized |
| Git instance | Module singleton | ✓ Already optimized |
| Dashboard state | Module singleton | ✓ Already optimized |
| Progress file reads | Polled every 500ms | ✓ Appropriate for use case |
| Chrome executable path | Searched once per server start | ✓ Already optimized |

No additional caching opportunities identified.

---

### 2.3 Async/Concurrency Analysis

#### Current Parallelization

- **Steps run sequentially** — Intentional design. Each step builds on previous work.
- **Git operations sequential** — Required by git locking semantics.
- **SSE broadcasting** — Linear iteration over clients (O(n) where n < 5 typical).

#### Opportunities for Parallelization

None identified. The workflow is inherently sequential:
1. Pre-checks must complete before git setup
2. Git branch must exist before step execution
3. Steps must complete before merge

---

## Phase 3: Memory & Resource Performance

### 3.1 Memory Leak Analysis

**Patterns checked:**

| Pattern | Files Checked | Finding |
|---------|---------------|---------|
| Event listeners not removed | `claude.js`, `dashboard.js`, `gui/server.js` | ✓ All properly removed |
| Growing unbounded collections | `dashboard.js`, `executor.js` | ✓ All bounded (100KB buffer, 500 log entries) |
| Closures capturing large objects | All modules | ✓ No issues found |
| Unclosed streams/connections | `claude.js`, `dashboard.js` | ✓ Properly closed via `settle()` pattern |
| Uncleared intervals/timers | `dashboard.js`, `gui/server.js`, `gui/app.js` | ✓ All cleared in cleanup |
| Orphaned temp files | `gui/server.js` (PowerShell script) | ✓ Deleted in finally block |

**No memory leaks identified.**

---

### 3.2 Resource Management Review

#### Subprocess Tree Cleanup (`src/claude.js:120-139`)

**Current behavior:**
```javascript
if (platform() === 'win32') {
  execFileSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { ... });
}
```

**Analysis:** Windows `taskkill /F /T` is the correct approach for killing process trees. It's synchronous but has a 5s timeout.

**Impact:** Acceptable. Process termination is a rare operation.

---

#### Inactivity Timer (`src/claude.js:405-414`)

**Current behavior:**
```javascript
inactivityTimer = setTimeout(() => { ... }, inactivityMs);
inactivityTimer.unref();
```

**Analysis:** Timer is `.unref()`'d so it doesn't keep Node.js alive. Reset on every stdout/stderr data event.

**Impact:** None — properly implemented.

---

#### GUI Watchdog (`gui/server.js:820-831`)

**Current behavior:**
```javascript
const watchdog = setInterval(() => {
  if (activeProcesses.size > 0) return; // Never self-terminate during active work
  // ... heartbeat check ...
}, HEARTBEAT_CHECK_MS);
watchdog.unref();
```

**Analysis:** Critical safety — watchdog skips heartbeat checks when processes are running. Properly `.unref()`'d.

**Impact:** None — well-designed.

---

## Phase 4: Frontend Performance

### 4.1 Render Performance

#### Markdown Rendering (`gui/resources/app.js:72-75`)

**Current behavior:**
```javascript
function renderMarkdown(text) {
  if (!text) return '';
  return markedInstance.parse(NtLogic.preprocessClaudeOutput(text));
}
```

**Analysis:** Uses vendored `marked.js` (v17). Preprocessing adds paragraph breaks for tool indicators.

**Optimization in place:**
```javascript
if (progress.currentStepOutput !== lastRenderedOutput) {
  // Only re-render when content actually changes
  requestAnimationFrame(() => { ... });
}
```

**Impact:** ✓ Already optimized with change detection and `requestAnimationFrame`.

---

#### Working Indicator (`gui/resources/app.js:1044-1075`)

**Analysis:** Shows "Claude is working" after 8s of no output change. Escalates to "Claude may be stuck" after 2 minutes. Updates on every elapsed timer tick (1s) when visible.

**Impact:** None — simple DOM updates.

---

### 4.2 Loading Performance

#### Critical Rendering Path

**Analysis:** Single-page app with inline styles and scripts served from local Node.js server. No network latency concerns.

- Static files served from disk (< 1ms)
- No bundling or minification (acceptable — total assets < 100KB)
- `marked.umd.js` is vendored (17KB)

**Impact:** Instant startup. No improvements needed.

---

#### Font Loading

**Not applicable.** Uses system fonts only:
```css
font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, ...
```

---

### 4.3 Runtime Event Handlers

#### Progress Polling (`gui/resources/app.js:916-948`)

**Current behavior:**
```javascript
const POLL_INTERVAL_FAST = 500;   // Normal polling interval (ms)
const POLL_INTERVAL_SLOW = 1000;  // Slower polling when no changes detected
```

**Analysis:** Polls progress JSON every 500ms. Has adaptive slowdown logic for failures but not for idle periods.

**Potential optimization:** Could slow polling to 1000ms after extended periods of no change. However, this would delay status updates.

**Worth doing?** Only if time allows. Current 500ms polling is acceptable for local file reads.

---

#### Heartbeat (`gui/resources/app.js:1905-1926`)

**Current behavior:**
```javascript
// Web Worker (immune to Chrome throttling)
const workerCode = `setInterval(() => { fetch('${origin}/api/heartbeat', ...); }, 5000);`;
// Main thread backup
setInterval(() => { fetch('/api/heartbeat', ...); }, 5000);
```

**Analysis:** Two-layer heartbeat design handles Chrome's aggressive tab throttling. Both run simultaneously.

**Impact:** ✓ Excellent design. No changes needed.

---

### 4.4 Third-Party Scripts

| Script | Purpose | Size | Async? | Deferrable? |
|--------|---------|------|--------|-------------|
| `marked.umd.js` | Markdown rendering | 17KB | N/A (vendored) | N/A (synchronous load) |

**Only one third-party dependency.** The vendored approach avoids CDN latency and offline failures.

---

## Phase 5: Quick Performance Wins

### Implemented Changes

None. All identified opportunities would require:
1. Behavior changes (switching sync logger to async)
2. Significant refactoring (git operation batching)
3. Risk without clear benefit (polling interval changes)

The codebase is already well-optimized for its purpose.

---

## Optimizations Implemented

| Change | Location | Before | After |
|--------|----------|--------|-------|
| — | — | — | — |

**All tests passing:** N/A (no changes made)

---

## Optimization Roadmap

### Priority 1: No Action Required

The codebase is lean and purpose-built. The main "performance" characteristics are:
- Steps run for 5-45 minutes each (Claude Code time, not NightyTidy overhead)
- Subprocess orchestration overhead is negligible (<1% of step time)
- File I/O is minimal and appropriately throttled

### Priority 2: Future Considerations (Not Currently Needed)

| Opportunity | Impact | Effort | Notes |
|-------------|--------|--------|-------|
| Async logger with buffering | Low | Medium | Would complicate crash recovery |
| Git operation batching | Low | High | Would require simple-git API changes |
| Progress file change detection | Minimal | Low | Current polling is fine for local files |

---

## Monitoring Recommendations

### Key Metrics to Track

1. **Step duration histogram** — Already tracked in progress JSON
2. **Claude Code invocations per step** — Already tracked (attempts field)
3. **Rate limit frequency** — Logged but not aggregated
4. **Memory usage during long runs** — Not currently tracked

### Alert-Worthy Conditions

1. Step completing in < 2 minutes (already flagged as `suspiciousFast`)
2. Inactivity timeout triggers (already logged)
3. Rate limit backoff reaching 2hr cap (already logged)

### Frontend Vitals

Not applicable — this is a local desktop app, not a web application served to users.

---

## Conclusion

**NightyTidy is well-optimized for its use case.** The architecture reflects thoughtful design decisions:

1. **Synchronous logging** prioritizes crash safety over throughput
2. **Sequential step execution** is required by the workflow
3. **Bounded buffers** prevent memory growth
4. **Proper cleanup** (timers, listeners, processes) prevents resource leaks
5. **Two-layer heartbeat** handles Chrome throttling

No performance changes are recommended at this time.

---

*Report generated by NightyTidy Performance Analysis Step (Run #02)*
