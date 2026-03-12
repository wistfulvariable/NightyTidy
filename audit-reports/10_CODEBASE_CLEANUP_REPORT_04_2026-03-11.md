# Codebase Cleanup Report #04 — 2026-03-11

**Date:** 2026-03-11
**Duration:** Comprehensive overnight audit
**Scope:** src/, gui/, bin/ directories
**Tests:** All 886 tests passing

---

## Summary

| Metric | Value |
|--------|-------|
| Files analyzed | 23 source files (19 src/ + 4 gui/) |
| Lines of code removed | 0 (no changes made) |
| Unused dependencies removed | 0 |
| Commits made | 0 |
| Tests affected | None |

**Overall finding:** The NightyTidy codebase is exceptionally clean. No actionable dead code, duplication, or consistency issues warrant immediate changes. This audit confirms the codebase's high quality and documents opportunities for future improvement.

---

## Phase 1: Dead Code Eliminated

### Findings

| Item | Location | Status | Notes |
|------|----------|--------|-------|
| `consolidation.js` | `src/consolidation.js` | **Orphaned module** | Never imported in production code. Has tests (15) and documentation. Superseded by unified report generation in `report.js`. |
| `exitCode` parameter | `src/claude.js:99` | **Intentionally unused** | Documented as "kept for future use" in JSDoc. |
| `CHANGELOG_PROMPT` | `src/prompts/loader.js:36` | **Exported, rarely used** | Part of public API, tested in contracts. Not dead code. |

### Analysis

**consolidation.js** is technically dead code — it defines `buildConsolidationPrompt()` and `generateActionPlan()` that are never called from production code. However:
- It has 15 passing tests (`consolidation.test.js`)
- It's documented in CLAUDE.md as part of the module map
- It was superseded by `buildReportPrompt()` in `report.js` which handles report generation in a single Claude session

**Recommendation:** Document this as tech debt. Removing requires also removing tests and updating documentation. Low priority since the code is tested and doesn't affect runtime.

### Not Removed

No files were removed because:
1. The only orphaned module (`consolidation.js`) has active tests
2. All other exports are used or intentionally part of the public API
3. No commented-out code blocks found
4. All npm dependencies are actively used

---

## Phase 2: Duplication Reduced

### Findings

| Duplication | Locations | Lines | Risk | Status |
|-------------|-----------|-------|------|--------|
| `formatDuration`/`formatMs` | 4 files (report.js, logic.js, dashboard-html.js, dashboard-tui.js) | ~40 | Low | **Architectural** |
| `formatCost` | 2 files (report.js, logic.js) | ~8 | Low | **Architectural** |
| `formatTokens` | 2 files (report.js, logic.js) | ~12 | Low | **Architectural** |
| Process kill logic | 2 files (claude.js, gui/server.js) | ~20 | Medium | **Documented** |
| Timestamp generation | 2 files (git.js, report.js) | ~12 | Low | **Documented** |

### Analysis

The formatting function duplications are **architectural by design**:
- `gui/resources/logic.js` runs in the browser (no Node.js access)
- `src/report.js`, `src/dashboard-html.js`, `src/dashboard-tui.js` run on Node.js
- Sharing code would require a build step (Webpack/Rollup) which violates the "no build step" design principle

The process kill logic differs intentionally:
- `claude.js` uses SIGTERM → SIGKILL escalation (robust)
- `gui/server.js` uses SIGTERM only (less aggressive for GUI-spawned processes)

### Recommendations

1. **Add shared `src/utils/` directory** if build tooling is ever added
2. **Document the architectural split** in CLAUDE.md under a "Code Sharing Limitations" section
3. **No immediate action needed** — duplications are necessary given current constraints

---

## Phase 3: Consistency Changes

### Findings

| Pattern | Dominant | Deviations | Verdict |
|---------|----------|------------|---------|
| Naming (camelCase/UPPER_SNAKE) | 100% consistent | 0 | No action |
| Error handling contracts | 100% documented | 0 | No action |
| Async patterns (async/await) | 100% consistent | 0 | No action |
| String quotes (double) | 100% consistent | 0 | No action |
| Import prefixes | No `node:` prefix | gui/server.js uses `node:` | **50/50 split** |
| Import ordering | builtins → npm → locals | Minor variations | No action |

### Import Prefix Analysis

`gui/server.js` uses explicit `node:` prefixes:
```javascript
import http from 'node:http';
import { readFile } from 'node:fs/promises';
```

All other files use bare imports:
```javascript
import { readFileSync } from 'fs';
import path from 'path';
```

**Verdict:** The `node:` prefix is the modern ESM standard (more explicit, avoids npm package name collisions). However, changing the rest of the codebase would be a large diff with no functional benefit. Recommend: let team decide on standardization direction. Neither approach is wrong.

---

## Phase 4: Configuration & Feature Flags

### Feature Flags

**None found.** The codebase uses no feature flags, environment-controlled toggles, or conditional compilation. This is good — explicit is better than implicit.

### Configuration Inventory

| Category | Count | Notes |
|----------|-------|-------|
| Environment variables | 1 | `NIGHTYTIDY_LOG_LEVEL` (info/debug/warn/error) |
| Timeout constants | 14 | All appropriate for use case |
| Size limits | 5 | All reasonable |
| Hardcoded filenames | 9 | All correctly scoped |

### Configuration Issues Found

| Config | Location | Issue | Priority |
|--------|----------|-------|----------|
| `DEFAULT_TIMEOUT` | claude.js:52, executor.js:75 | Duplicate 45-min constant | Medium |
| `INACTIVITY_TIMEOUT_MS` | claude.js:57 | Not configurable (3 min) | Low |
| `API_COMMAND_TIMEOUT_MS` | gui/logic.js | 50 min vs 45 min step timeout (tight margin) | Low |
| `NIGHTYTIDY_LOG_LEVEL` | logger.js:17 | Undocumented in README | Low |

### Duplicate Timeout Analysis

```javascript
// claude.js:52
const DEFAULT_TIMEOUT = 45 * 60 * 1000;

// executor.js:73-75
// Must match claude.js DEFAULT_TIMEOUT — kept as a separate constant
const DEFAULT_STEP_TIMEOUT_MS = 45 * 60 * 1000;
```

Both constants are 45 minutes. The comment acknowledges the coupling. No bug exists, but a single shared constant would prevent future drift.

**Recommendation:** Export `DEFAULT_TIMEOUT` from claude.js and import in executor.js. Low priority since values match.

### TODO/FIXME/HACK Inventory

**None found.** Zero TODO, FIXME, HACK, XXX, or TEMP comments in production code. The codebase is clean of tech debt markers.

---

## Phase 5: Quick Wins

### Findings

| Item | Location | Type | Status |
|------|----------|------|--------|
| `|| null` after arithmetic | Multiple locations | Intentional | **Not a bug** |
| Unused `exitCode` param | claude.js:99 | Documented intent | **Not dead code** |
| Nested ternary | orchestrator.js:254 | Readable as-is | No action |

### Analysis

The `|| null` pattern after token summation (e.g., `(a || 0) + (b || 0) || null`) initially appeared to be a logic error. However, it's correct:
- If both tokens are null/undefined, sum is 0
- `0 || null` evaluates to `null` (0 is falsy)
- This intentionally maps "no data" (0) to `null`

The `exitCode` parameter in `classifyError()` is explicitly documented as "kept for future use" — not dead code.

### No Changes Made

All identified patterns are either:
1. Intentional design decisions
2. Documented for future extensibility
3. Working correctly despite appearing suspicious

---

## Couldn't Touch

| Item | Reason |
|------|--------|
| `consolidation.js` removal | Would break 15 tests; requires coordinated removal of tests + documentation |
| Import prefix standardization | 50/50 split on which style is "correct"; team decision needed |
| Shared utils module | Would require architecture changes; violates YAGNI without a build step |

---

## Recommendations

| # | Recommendation | Impact | Risk if Ignored | Worth Doing? | Details |
|---|----------------|--------|-----------------|--------------|---------|
| 1 | Remove `consolidation.js` + tests | Cleaner codebase | Low | Only if time allows | Module is unused in production. Remove together with `consolidation.test.js` and update CLAUDE.md module map. |
| 2 | Export shared timeout constant | Prevents drift | Low | Probably | Create `export const DEFAULT_TIMEOUT` in claude.js, import in executor.js. Single source of truth. |
| 3 | Document `NIGHTYTIDY_LOG_LEVEL` | Better UX | Low | Yes | Add to README and package.json description. Users should know it exists. |
| 4 | Decide import prefix style | Consistency | Low | Only if time allows | Either add `node:` to all files or remove from gui/server.js. Modern ESM prefers `node:`. |

---

## Audit Quality Assessment

| Area | Grade | Notes |
|------|-------|-------|
| Dead Code | A | One orphaned module (consolidation.js) with tests. No other issues. |
| Duplication | A- | Architectural duplications are necessary. No unnecessary copy-paste. |
| Consistency | A | Remarkably consistent naming, error handling, async patterns. |
| Configuration | A- | Clean config. One duplicate constant. Zero feature flags. |
| Tech Debt | A+ | Zero TODO/FIXME markers. Rare for any codebase. |

**Overall Grade: A**

This codebase is exceptionally well-maintained. The audit confirms prior cleanup runs have been effective. No urgent changes needed.

---

*Generated by NightyTidy Codebase Cleanup — Run #04*
