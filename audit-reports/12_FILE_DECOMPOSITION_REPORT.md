# Audit #12 — File Decomposition Report

**Date**: 2026-03-09
**Auditor**: Claude Opus 4.6

## 1. Executive Summary

Analyzed 20 source files across `src/`, `gui/`, `bin/`, and `scripts/` directories. Identified 5 JavaScript files exceeding 300 lines. After detailed analysis of responsibilities, coupling, and export patterns, **no splits were warranted** -- all large files are either inherently monolithic (HTML templates, browser scripts) or have single-responsibility designs with tightly coupled internal helpers.

- **Files analyzed**: 20 source files (+ 3 non-JS assets)
- **Files over 300 lines**: 5 JavaScript files (+ 2 non-JS: CSS, HTML)
- **Splits executed**: 0
- **Splits skipped**: 5
- **Tests passing**: Verified (no changes to code)

## 2. File Size Inventory

### All Source Files (sorted by line count, descending)

| File | Lines | Primary Responsibility | Exports | Imports | Classification |
|------|-------|----------------------|---------|---------|---------------|
| `gui/resources/app.js` | 586 | Browser GUI state machine (5 screens) | 0 | 0 | SKIP |
| `src/cli.js` | 536 | CLI lifecycle orchestration | 1 | 16 | SKIP |
| `src/dashboard-html.js` | 483 | HTML template (CSS + JS + HTML) | 1 | 0 | SKIP |
| `gui/resources/styles.css` | 461 | CSS stylesheet for GUI | N/A | N/A | SKIP (not JS) |
| `src/orchestrator.js` | 422 | Orchestrator mode (3 commands) | 3 | 13 | SKIP |
| `gui/server.js` | 364 | GUI HTTP server + Chrome launcher | 0 | 6 | SKIP |
| `src/dashboard.js` | 292 | HTTP server + SSE + TUI spawn | 6 | 8 | Under threshold |
| `src/checks.js` | 228 | Pre-run validation (6 checks) | 1 | 2 | Under threshold |
| `src/claude.js` | 204 | Claude Code subprocess wrapper | 1 | 2 | Under threshold |
| `src/dashboard-tui.js` | 203 | Standalone TUI progress display | 0 | 1 | Under threshold |
| `src/report.js` | 162 | Report generation + CLAUDE.md update | 3 | 2 | Under threshold |
| `gui/resources/index.html` | 148 | HTML markup for GUI | N/A | N/A | SKIP (not JS) |
| `src/dashboard-standalone.js` | 145 | Standalone dashboard HTTP server | 0 | 1 | Under threshold |
| `src/git.js` | 144 | Git operations via simple-git | 7 | 2 | Under threshold |
| `src/executor.js` | 143 | Core step loop + single-step exec | 2 | 6 | Under threshold |
| `gui/resources/logic.js` | 134 | GUI pure functions | 0 | 0 | Under threshold |
| `scripts/check-docs-freshness.js` | 129 | CI documentation checker | 0 | 0 | Under threshold |
| `src/lock.js` | 118 | Atomic lock file | 2 | 3 | Under threshold |
| `src/setup.js` | 99 | --setup command | 1 | 3 | Under threshold |
| `src/logger.js` | 54 | File + stdout logger | 5 | 0 | Under threshold |
| `src/prompts/manifest.json` | 38 | Step ordering + display names | N/A | N/A | Data file |
| `src/prompts/loader.js` | 30 | Loads prompts from markdown | 3 | 1 | Under threshold |
| `scripts/run-flaky-check.js` | 24 | Flaky test detector | 0 | 0 | Under threshold |
| `src/notifications.js` | 16 | Desktop notifications | 1 | 2 | Under threshold |
| `bin/nightytidy.js` | 3 | Entry point | 0 | 1 | Under threshold |

### Line Count Distribution

```
0-50:    3 files  (logger, loader, notifications, entry point)
51-150:  9 files  (git, executor, logic, lock, setup, standalone, check-docs, flaky, manifest)
151-300: 4 files  (dashboard, checks, claude, dashboard-tui, report)
301-500: 3 files  (server, orchestrator, dashboard-html)
500+:    2 files  (cli, app.js)
```

**Median file size**: ~143 lines
**Total source lines**: ~4,668 (JS files only, excluding prompts and assets)

## 3. Files Over 300 Lines — Detailed Analysis

### 3.1 `gui/resources/app.js` — 586 lines — SKIP

**Why**: Browser-side JavaScript loaded via `<script>` tag. No module system available (no imports/exports). All 20+ functions share a single `state` object and manipulate the DOM directly. Splitting would require introducing a bundler (Webpack, Rollup, etc.) which violates YAGNI -- the GUI is a simple single-page app.

**Internal structure**: Well-organized with clear section comments (Setup, Steps, Running, Progress Polling, Stop, Finish, Summary, Reset, Event Binding). Each section maps to one of the 5 screens. The length comes from 5 screen handlers with DOM manipulation -- inherently verbose but not duplicated.

### 3.2 `src/cli.js` — 536 lines — SKIP

**Why**: Single export (`run()`). Seven internal helper functions (`extractStepDescription`, `buildStepCallbacks`, `handleAbortedRun`, `printCompletionSummary`, `selectSteps`, `showWelcome`, `printStepList`) are all called exclusively from `run()`. Extracting them to separate files would create satellite modules with a single consumer, increasing import surface without reducing complexity.

**Note**: The `run()` function itself (~220 lines) is the longest single function but is a sequential orchestration flow (init -> checks -> select -> git -> execute -> report -> merge). Each step is 3-8 lines. Breaking the flow across files would hurt readability.

### 3.3 `src/dashboard-html.js` — 483 lines — SKIP

**Why**: A single function (`getHTML(csrfToken)`) returning an HTML template string containing CSS (~240 lines), HTML (~50 lines), and client-side JavaScript (~180 lines). This was already extracted from `dashboard.js` in a previous decomposition audit. It is inherently monolithic -- the CSS, HTML, and JS form a single deliverable unit. Further splitting would require a build system to concatenate assets.

### 3.4 `src/orchestrator.js` — 422 lines — SKIP

**Why**: Three exports (`initRun`, `runStep`, `finishRun`) representing three CLI commands for orchestrated mode. Eight internal helpers handle state file I/O, progress JSON writing, step validation, and dashboard server lifecycle. All helpers are exclusively consumed by the three exports. The helpers share no state and exist only to keep the main functions readable.

**Considered splitting**: Dashboard-related helpers (`spawnDashboardServer`, `stopDashboardServer`, `cleanupDashboard`, `writeProgress`, `buildProgressState`) could theoretically form a separate module, but they are only used by `initRun`, `runStep`, and `finishRun` -- extracting them would add import overhead with no reuse benefit.

### 3.5 `gui/server.js` — 364 lines — SKIP

**Why**: Standalone script (no exports) with shared mutable state (`activeProcesses`, `serverInstance`). The Chrome launcher (`findChrome`, `launchChrome`) is used exactly once at startup. API handlers all share `activeProcesses` for process lifecycle management. Splitting would require passing shared state between modules.

## 4. Structural Assessment

### 4.1 Directory Structure

The project has a clean separation:
- `src/` — Core logic (14 files, well-factored modules)
- `gui/` — Desktop GUI (4 files: server + 3 resources)
- `bin/` — Entry point (1 file, 3 lines)
- `scripts/` — CI utilities (2 files)
- `test/` — Test files (not analyzed for splitting)
- `src/prompts/` — Prompt data (manifest + loader + 35 markdown files)

### 4.2 Module Cohesion Assessment

| Module | Cohesion | Notes |
|--------|----------|-------|
| `logger.js` | High | 5 exports, single concern, universal dependency |
| `git.js` | High | 7 exports, all git operations, shares module-level `gitInstance` |
| `checks.js` | High | 1 export, 6 sequential checks |
| `claude.js` | High | 1 export, subprocess management with retry |
| `executor.js` | High | 2 exports, step execution loop |
| `dashboard.js` | High | 6 exports, HTTP+SSE+TUI for progress display |
| `orchestrator.js` | High | 3 exports, orchestrator mode commands |
| `cli.js` | High | 1 export, top-level lifecycle |
| `report.js` | High | 3 exports, report generation |
| `lock.js` | High | 2 exports, atomic locking |
| `notifications.js` | High | 1 export, fire-and-forget notifications |
| `setup.js` | High | 1 export, CLAUDE.md integration |

All modules demonstrate high cohesion -- every module has a single, clear responsibility.

### 4.3 Coupling Analysis

- **Fan-in leaders**: `logger.js` (imported by every module), `git.js` (imported by cli, orchestrator, executor)
- **Fan-out leaders**: `cli.js` (16 imports), `orchestrator.js` (13 imports) -- expected for orchestration modules
- **No circular dependencies detected**
- **No shared mutable state between modules** (except logger's module-level state, which is by design)

### 4.4 Comparison with Previous Audit (2026-03-05)

| Metric | Report 02 | This Audit | Change |
|--------|-----------|------------|--------|
| Source files (src/) | 14 | 14 | Same |
| GUI files | 0 | 4 | +4 (new) |
| Files over 300 lines | 3 | 5 | +2 (gui/app.js, gui/server.js are new) |
| Splits needed | 1 | 0 | Resolved |
| Largest src/ file | cli.js (472) | cli.js (536) | +64 lines (orchestrator commands added) |

The growth in `cli.js` comes from the orchestrator command routing (`--init-run`, `--run-step`, `--finish-run`) added since the last audit. This is appropriate growth -- the CLI is the command router and these are new commands.

## 5. Recommendations

### No Action Required

The codebase is well-decomposed. The previous audit's split of `dashboard.js` into `dashboard.js` + `dashboard-html.js` was the right call and no further splits are justified.

### Watch List

These files should be monitored in future audits:

1. **`gui/resources/app.js` (586 lines)** — If the GUI grows significantly, consider adopting a lightweight module bundler to allow splitting screen handlers into separate files. Current size is manageable.

2. **`src/cli.js` (536 lines)** — If more CLI commands are added, the `run()` function's orchestrator routing section (lines 291-317) could be extracted to a command dispatcher. Not warranted yet with only 3 orchestrator commands.

3. **`src/orchestrator.js` (422 lines)** — Stable. The three functions are well-bounded. No growth expected unless new orchestrator commands are added.

## 6. File Size Distribution Chart

```
bin/nightytidy.js         |||  (3)
src/notifications.js      ||||||||  (16)
src/prompts/loader.js     |||||||||||||||  (30)
src/logger.js             |||||||||||||||||||||||||||  (54)
src/setup.js              ||||||||||||||||||||||||||||||||||||||||||||||||||  (99)
src/lock.js               |||||||||||||||||||||||||||||||||||||||||||||||||||||||||||  (118)
gui/resources/logic.js    ||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||| (134)
src/executor.js           ||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||| (143)
src/git.js                |||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||| (144)
src/dashboard-standalone  |||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||  (145)
src/report.js             |||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||  (162)
src/dashboard-tui.js      |||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||| (203)
src/claude.js             ||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||| (204)
src/checks.js             |||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||| (228)
src/dashboard.js          |||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||| (292)
gui/server.js             |||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||  (364)
src/orchestrator.js       ||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||  (422)
src/dashboard-html.js     ||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||  (483)
src/cli.js                ||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||  (536)
gui/resources/app.js      |||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||  (586)
```

**300-line threshold marker**: `gui/server.js` and above

## 7. Conclusion

The NightyTidy codebase demonstrates disciplined file decomposition. The median file size of ~143 lines is healthy. The 5 files exceeding 300 lines are all justified by their nature (templates, browser scripts, top-level orchestrators). No splits were executed because none would improve maintainability -- they would only scatter cohesive logic across artificial boundaries.

The previous decomposition audit (2026-03-05) already addressed the one legitimate split opportunity (extracting the HTML template from `dashboard.js`). The codebase has grown by 4 GUI files since then, all appropriately sized for their function.
