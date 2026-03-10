# Codebase Cleanup Report — Run 03

**Date:** 2026-03-10
**Duration:** ~45 minutes analysis
**Status:** Analysis complete — no code changes made (codebase is clean)

---

## Summary

| Metric | Value |
|--------|-------|
| Files analyzed | 22 source files (src/*.js, gui/*.js, gui/resources/*.js) |
| Files modified | 0 |
| Lines removed | 0 |
| Unused dependencies removed | 0 |
| Commits made | 0 |
| Tests affected | None — all 738 tests pass |

**Finding:** The NightyTidy codebase is exceptionally well-maintained with no actionable dead code, no stale feature flags, no TODO/FIXME comments, and consistent patterns throughout. The analysis found documentation-worthy observations but no changes that would improve code quality without adding risk.

---

## Phase 1: Dead Code Eliminated

### Unused Exports: None Found

All 63 exported functions and constants across 15 source modules are actively used:

| Module | Exports | Status |
|--------|---------|--------|
| `src/cli.js` | `run()` | Used by `bin/nightytidy.js` |
| `src/executor.js` | 4 exports | Used by `cli.js`, `orchestrator.js`, `consolidation.js` |
| `src/orchestrator.js` | 3 exports | Used by `cli.js` via CLI flags |
| `src/claude.js` | 5 exports | Used by `executor.js`, `consolidation.js`, `orchestrator.js` |
| `src/git.js` | 9 exports | Used throughout workflow modules |
| `src/dashboard.js` | 7 exports | Used by `cli.js` |
| `src/report.js` | 3 exports | Used by `cli.js`, `orchestrator.js`, `consolidation.js` |
| `gui/resources/logic.js` | 14 exports | Used by `app.js` via `window.NtLogic` |

### Unused Imports: None Found

Every import in every file is consumed. No dangling destructured imports.

### Orphaned Files: None Found

All source files have clear callers through the module dependency graph.

### Unused Dependencies: None Found

All 6 production dependencies (`commander`, `ora`, `chalk`, `node-notifier`, `simple-git`, `@inquirer/checkbox`) are actively used.

### Commented-Out Code: None Found

No commented-out code blocks. All `//` comments are explanatory, not dead code.

---

## Phase 2: Duplication Reduced

### Findings (Documented, Not Changed)

#### formatCost() — Different Precision in Different Contexts

| Location | Precision | Purpose |
|----------|-----------|---------|
| `src/report.js:45-48` | 4 decimals | Detailed cost tracking in markdown reports |
| `gui/resources/logic.js:127-130` | 2 decimals | Quick-glance display in desktop GUI |

**Assessment:** The difference appears intentional — reports need precision, GUI needs readability. Not consolidated.

#### formatMs() — 4 Variants

| Location | Output Style |
|----------|-------------|
| `src/report.js:18-28` | `0m 00s`, `Xm YYs`, `Xh YYm` |
| `gui/resources/logic.js:66-76` | `0s`, `Xs`, `Xm Ys`, `Xh Ym Zs` |
| `src/dashboard-tui.js:34-42` | `0s`, `Xs`, `Xm YYs`, `Xh YYm` |
| `src/dashboard-html.js:458-464` | `Xs`, `Xm YYs`, `Xh YYm` |

**Assessment:** Each context has slightly different formatting requirements. Consolidating would require a shared module or template parameter, adding complexity. Left as-is.

#### OUTPUT_BUFFER_SIZE — Duplicated Identically

| Location | Value |
|----------|-------|
| `src/dashboard.js:13` | `100 * 1024` (100 KB) |
| `src/orchestrator.js:124` | `100 * 1024` (100 KB) |

**Assessment:** These modules run in different modes (interactive vs orchestrator) and never import each other. Extracting to a shared constants module would add coupling. Left as-is.

#### POST /stop Handler — Near-Identical in 2 Files

| Location | Lines |
|----------|-------|
| `src/dashboard.js:82-110` | ~25 lines |
| `src/dashboard-standalone.js:88-115` | ~25 lines (same logic) |

**Assessment:** These are standalone HTTP servers that don't share code by design. The dashboard runs in interactive mode; dashboard-standalone runs in orchestrator mode as a detached process. Consolidating would require a shared module and complicate the standalone script's independence. Left as-is.

---

## Phase 3: Consistency Enforced

### Naming Conventions: ✓ Fully Consistent

- **Files:** `kebab-case.js` — 100% adherence
- **Functions:** `camelCase` — 100% adherence
- **Constants:** `UPPER_SNAKE_CASE` — 100% adherence

### Import Ordering: Minor Variation (Not Changed)

| Pattern | Files | Status |
|---------|-------|--------|
| Implicit builtins (`fs`, `path`) | 15 files in `src/` | Dominant |
| Explicit `node:` prefix | 1 file (`gui/server.js`) | Outlier |

**Assessment:** `gui/server.js` uses the modern `node:` prefix for all builtins. The `src/` files use implicit names. Both are valid. Standardizing would require changing 39 imports across 15 files — high risk, low benefit. Left as-is.

### Error Handling: ✓ Strictly Follows Contract

Every module follows the error handling contract documented in CLAUDE.md:

| Module | Contract | Verified |
|--------|----------|----------|
| `checks.js`, `lock.js` | Throws with user-friendly messages | ✓ |
| `claude.js`, `executor.js`, `orchestrator.js` | Never throws — returns result objects | ✓ |
| `notifications.js`, `dashboard.js` | Swallows all errors silently | ✓ |
| `report.js`, `consolidation.js`, `sync.js` | Warns but never throws | ✓ |

### Async Patterns: ✓ Consistent

- **async/await:** 136 occurrences (dominant)
- **Promise constructor:** 5 files (wrapping callback APIs only)
- **.then() chains:** 0 occurrences

### String Quotes: ✓ Consistent

- **Single quotes:** ~85% (dominant)
- **Double quotes:** ~15% (CSP values, shell commands)
- **Template literals:** Only for interpolation

---

## Phase 4: Configuration & Feature Flags

### Feature Flags: None Found

The codebase has no boolean feature flags or toggles. All behavior variation uses numeric thresholds or CLI options.

### TODO/FIXME/HACK Comments: None Found

Searched for `TODO`, `FIXME`, `HACK`, `XXX`, `TEMP`, `BUG`, `ISSUE`, `PERF`, `OPTIMIZE`, `REFACTOR` — no matches in `src/` or `gui/`.

### Configuration Constants: Well-Documented

| Category | Count | Examples |
|----------|-------|----------|
| Timeouts | 12 | `DEFAULT_TIMEOUT` (45 min), `SIGKILL_DELAY` (5s) |
| Size limits | 9 | `MAX_BODY_BYTES`, `OUTPUT_BUFFER_SIZE` |
| Thresholds | 6 | `FAST_COMPLETION_THRESHOLD_MS` (2 min) |
| File names | 6 | `LOCK_FILENAME`, `PROGRESS_FILENAME` |

All documented in CLAUDE.md or commented in source.

### Environment Variables: Properly Scoped

| Variable | Purpose | Documented |
|----------|---------|-----------|
| `NIGHTYTIDY_LOG_LEVEL` | Log verbosity | Yes (CLAUDE.md) |
| `ANTHROPIC_*`, `CLAUDE_*` | API keys, Claude config | Yes (allowlisted in env.js) |
| `CLAUDECODE` | **Blocked** to prevent subprocess conflicts | Yes (env.js) |

### Known Technical Debt

Per CLAUDE.md: "No `.nightytidyrc` config file — only `NIGHTYTIDY_LOG_LEVEL` env var exists." This is acknowledged and intentional.

---

## Phase 5: Quick Wins

### Checked For

| Pattern | Found |
|---------|-------|
| `var` declarations | 0 |
| Deprecated APIs | 0 |
| Deep nesting (> 3 levels) | 2 functions (documented below) |
| Long functions (> 30 lines) | 2 functions (documented below) |
| Magic numbers without constants | 0 (all unit conversions are inline-obvious) |
| Empty files/constructors | 0 |
| Typos in names | 0 |

### Deep Nesting & Long Functions (Documented, Not Changed)

#### `buildStepCallbacks()` in cli.js (lines 33–127)

- **Lines:** 95
- **Nesting:** 5 levels at deepest
- **Assessment:** This is a callback factory that creates step execution callbacks. The nesting is inherent to the callback structure. Breaking it down would scatter related logic across the file.

#### `handleSelectFolder()` in gui/server.js (lines 215–273)

- **Lines:** 58
- **Nesting:** 4 levels (platform conditionals → try/catch)
- **Assessment:** Platform-specific folder dialog handling. Extracting to separate functions would add indirection without improving readability.

### Repeated Heartbeat Refresh Pattern

Lines 228, 239, 248, 255, 269 in `gui/server.js` all have:
```javascript
lastHeartbeat = Date.now(); // Blocking dialog starved the event loop — refresh before watchdog fires
```

**Assessment:** Each occurrence follows a blocking `execSync`. The repetition is contextually clear and extracting to a helper would add indirection. Left as-is.

---

## Couldn't Touch

**Nothing.** No changes were blocked by failing tests or uncertainty. The codebase has no actionable issues.

---

## Recommendations

| # | Recommendation | Impact | Risk if Ignored | Worth Doing? | Details |
|---|----------------|--------|-----------------|--------------|---------|
| 1 | Document `formatCost` precision difference | Clarity | Low | Only if time allows | Report uses 4 decimals, GUI uses 2. Add a comment explaining the intentional difference. |
| 2 | Consider `node:` prefix standardization | Consistency | Low | No | Would require changing 39 imports across 15 files. Modern style but high churn, low benefit. |
| 3 | Extract heartbeat refresh to helper | DRY | Low | No | 5 occurrences in one function. Contextual repetition is clearer than indirection. |

**No critical or high-risk issues found.**

---

## Conclusion

The NightyTidy codebase is production-ready with excellent code quality:

- **Zero dead code** — all exports, imports, and dependencies are used
- **Zero stale flags** — no feature flags exist; behavior controlled via CLI options
- **Zero TODO debt** — no TODO/FIXME comments anywhere
- **Strict consistency** — naming, error handling, and async patterns are uniform
- **Good documentation** — CLAUDE.md accurately reflects code contracts

The analysis surfaced minor observations (formatting function variants, import prefix inconsistency) but no changes that would improve maintainability without adding complexity or risk.

**Net result:** Analysis only. No commits. All 738 tests pass.
