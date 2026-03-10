# Performance Audit Report — Run 01

**Date**: 2026-03-10
**Codebase**: NightyTidy
**Audit Focus**: Database/Query, Application, Memory/Resources, Frontend

---

## Executive Summary

NightyTidy is a well-architected CLI/GUI orchestration tool. This performance audit found **no critical bottlenecks** — the codebase is already well-optimized for its intended use case (4-8 hour overnight runs executing 33 AI-driven improvement steps).

### Top 5 Findings

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| 1 | String concatenation in `claude.js` subprocess output | Low | **FIXED** |
| 2 | Rolling buffer string slicing in `dashboard.js` | Low | Documented |
| 3 | Synchronous file I/O in dashboard updates | Medium | Documented |
| 4 | No database layer needed | N/A | ✓ Clean |
| 5 | Event listener/timer cleanup is thorough | N/A | ✓ Clean |

**Quick Wins Implemented**: 1 optimization applied
**Larger Efforts Documented**: 2 minor improvements (not blocking)

---

## Phase 1: Database Performance

**Finding**: **No database layer exists**. NightyTidy is a pure CLI/GUI orchestration tool.

- All state is file-based (JSON) or in-memory
- Run state: `nightytidy-run-state.json` (atomic write via temp file + rename)
- Progress: `nightytidy-progress.json` (polled by dashboard TUI)
- No queries, indexing, or persistence layers to optimize

**Conclusion**: This phase is not applicable. The file-based approach is appropriate for the use case.

---

## Phase 2: Application-Level Performance

### 2.1 Expensive Operations

#### **String Concatenation in Subprocess Output** — FIXED

**File**: `src/claude.js` lines 347-403
**Severity**: Low
**Impact**: Scales better for large Claude responses

**Before** (O(n²) memory work for large outputs):
```javascript
let stdout = '';
child.stdout.on('data', (chunk) => {
  stdout += chunk.toString();  // Creates new string each time
```

**After** (O(n) — single allocation at end):
```javascript
const stdoutChunks = [];
child.stdout.on('data', (chunk) => {
  stdoutChunks.push(chunk.toString());
// ...
const stdout = stdoutChunks.join('');
```

**Why this matters**: For a 50KB response with 100 chunks:
- Before: ~2.5MB total allocations (sum of 1+2+3+...+50 KB)
- After: ~100KB total allocations (100 × 500B + one 50KB join)

**Tests**: All 738 tests pass after change.

---

#### Other Application-Level Observations

| Location | Pattern | Assessment |
|----------|---------|------------|
| `executor.js` line 91 | SHA-256 hash of 33 prompts | One-time at startup, ~10ms — acceptable |
| `executor.js` line 244 | `sumCosts()` per step | O(1) operation, called 33 times max — acceptable |
| `prompts/loader.js` | `readFileSync` at module load | One-time, ~100KB total — acceptable |
| `gui/resources/app.js` | 500ms polling interval | Appropriate for long-running tasks |

### 2.2 Caching Opportunities

| Data | Strategy | Recommendation |
|------|----------|----------------|
| Prompt files | Already cached (loaded once at module init) | ✓ No action needed |
| Progress state | In-memory with throttled disk writes | ✓ Already optimized |
| SSE client responses | Real-time, no caching appropriate | ✓ Correct design |

### 2.3 Async/Concurrency

| Location | Finding | Assessment |
|----------|---------|------------|
| Step execution | Sequential by design | Correct — steps depend on previous state |
| Claude subprocess | Uses `--continue` for session reuse | ✓ Already optimized |
| Dashboard SSE | Non-blocking broadcast loop | ✓ Correct |

---

## Phase 3: Memory & Resources

### 3.1 Memory Leak Patterns — None Found

The codebase demonstrates consistent cleanup practices:

| Pattern | Location | Status |
|---------|----------|--------|
| Event listeners | `claude.js:356` — `removeEventListener` on abort | ✓ Clean |
| SSE clients | `dashboard.js:77-79` — `delete` on close | ✓ Clean |
| Timers | `dashboard.js:240-244` — `clearTimeout` on stop | ✓ Clean |
| Child processes | `claude.js:114-120` — SIGKILL fallback with `.unref()` | ✓ Clean |

### 3.2 Resource Management — Well Designed

| Resource | Pattern | Status |
|----------|---------|--------|
| Output buffer | Rolling 100KB cap (`dashboard.js:287-289`) | ✓ Bounded |
| SSE client set | Explicit cleanup on disconnect + shutdown | ✓ Bounded |
| Progress file writes | Throttled to 500ms intervals | ✓ Controlled |
| Lock file | Atomic via `O_EXCL` flag | ✓ Safe |

### 3.3 Potential Improvements (Not Blocking)

#### Rolling Buffer String Slicing

**File**: `src/dashboard.js` lines 287-289
**Severity**: Low
**Current Pattern**:
```javascript
if (ds.outputBuffer.length > OUTPUT_BUFFER_SIZE) {
  ds.outputBuffer = ds.outputBuffer.slice(ds.outputBuffer.length - OUTPUT_BUFFER_SIZE);
}
```

**Impact**: Creates a new 100KB string and discards the old one each time buffer overflows. For verbose output, this happens every ~500ms.

**Recommendation**: Consider a ring buffer or line-based queue if profiling shows GC pressure. Current impact is minimal (orchestration runs are 4-8 hours; a few extra GC cycles don't matter).

---

## Phase 4: Frontend Performance

The GUI is a single-page app served via Node.js HTTP server.

### 4.1 Render Performance

| Pattern | Finding | Status |
|---------|---------|--------|
| State management | Closure-based single `state` object | ✓ Simple, no overhead |
| DOM updates | Only on data change (`lastRenderedOutput` check) | ✓ Efficient |
| Markdown rendering | Vendored `marked.umd.js` (mature, fast) | ✓ Appropriate |

### 4.2 Loading Performance

| Item | Status | Notes |
|------|--------|-------|
| No external dependencies | ✓ | All resources served locally |
| Single CSS file | ✓ | Inline styles in `styles.css` |
| Vendored marked.js | ✓ | No network fetch required |
| No images | ✓ | Pure HTML/CSS/JS app |

### 4.3 Event Handlers

| Pattern | Finding | Status |
|---------|---------|--------|
| Polling | 500ms for progress, 1000ms for elapsed | ✓ Reasonable for long tasks |
| Heartbeat | 5000ms to server | ✓ Appropriate for crash detection |
| No scroll/resize handlers | ✓ | No throttling needed |

### 4.4 Animation Performance

No complex animations. The spinner is a CSS animation on `transform` (compositor-friendly).

---

## Optimizations Implemented

| # | File | Change | Impact |
|---|------|--------|--------|
| 1 | `src/claude.js` | Replaced string concatenation with array accumulation for stdout/stderr | Eliminates O(n²) memory work on large subprocess outputs |

**All tests passing**: Yes (738/738)

---

## Optimization Roadmap

| Priority | Item | Effort | Impact | Recommendation |
|----------|------|--------|--------|----------------|
| Low | Rolling buffer refactor in dashboard.js | 2 hours | Minor GC reduction | Only if profiling shows need |
| Low | Async file I/O in dashboard updates | 1 hour | Slightly better responsiveness | Not blocking; current is fine |

---

## Monitoring Recommendations

### Key Metrics to Track (if instrumented)

| Metric | Source | Alert Threshold |
|--------|--------|-----------------|
| Step duration variance | `executor.js` results | > 3x median (potential rate-limit) |
| Total run duration | CLI output | > 10 hours (possible hang) |
| Memory heap size | Node.js `process.memoryUsage()` | > 500MB (investigate leak) |

### Frontend Vitals (if measured)

| Metric | Expected | Notes |
|--------|----------|-------|
| LCP | < 1s | App is local, no network |
| INP | < 100ms | Minimal interactivity during run |
| CLS | 0 | No layout shifts |

### Suggested Performance Testing

1. **Stress test**: Run 33 steps with verbose output (~100KB/step) and monitor memory
2. **Concurrent clients**: Open 10+ dashboard browser tabs and verify SSE broadcasts don't queue
3. **Long-running stability**: Let a full 8-hour run complete and check for memory growth

---

## What's Working Well

1. ✓ **No database layer** — unnecessary for orchestration
2. ✓ **Event listeners properly cleaned up** — no memory leaks
3. ✓ **Timers properly managed** — cleared on shutdown
4. ✓ **SSE client set bounded** with explicit cleanup
5. ✓ **Rolling output buffer** prevents unbounded growth
6. ✓ **Atomic state file writes** (temp + rename pattern)
7. ✓ **Session continuation** via `--continue` flag reduces subprocess overhead
8. ✓ **Rate-limit detection** with smart exponential backoff
9. ✓ **Error handling contracts** clearly defined per module

---

## Conclusion

NightyTidy is well-engineered with no critical performance issues. The sequential step execution model is intentional (not a bottleneck). One minor optimization was implemented to improve memory efficiency in the Claude subprocess handler. The codebase scales appropriately for its 4-8 hour overnight run use case.

**Recommendation**: No further performance work needed at this time. The optimizations documented in the roadmap are "nice to have" but not worth the engineering time unless profiling reveals actual problems.
