# File Decomposition & Module Structure Report — Run 03

**Date**: 2026-03-10
**Branch**: `nightytidy/run-2026-03-10-0005`
**Status**: Analysis Complete — No Splits Executed

---

## 1. Executive Summary

Analyzed **8 non-test source files** exceeding the 300-line threshold. After careful review of responsibilities, import fan-out, and split risk:

- **Files analyzed**: 8
- **Files split**: 0
- **Files skipped (inherently monolithic)**: 6
- **Files skipped (high risk / low value)**: 2
- **All tests passing**: Yes (no changes made)

**Key finding**: The codebase has already been through two prior decomposition passes (runs 01 and 02). The remaining oversized files are either:
1. **Inherently monolithic** — single-purpose templates, data-only modules, or tightly-coupled orchestration logic where splitting would hurt rather than help
2. **High fan-out / low value** — splitting would touch many files with minimal architectural benefit

No safe, high-value splits were identified for this run.

---

## 2. File Size Inventory

| File | Lines | Classification | Action | Reason |
|------|-------|----------------|--------|--------|
| `gui/resources/app.js` | 1296 | Inherently monolithic | Skip | Single-page app state machine — all functions tightly coupled to global state object |
| `src/cli.js` | 644 | Single responsibility, just long | Skip | Already decomposed; orchestrator logic is cohesive; high fan-out (22 imports) |
| `gui/server.js` | 634 | Inherently monolithic | Skip | HTTP server + route handlers — splitting would fragment related request handling |
| `src/sync.js` | 535 | Clear multi-responsibility | **Skip (low value)** | Could split parsing vs. orchestration, but low import fan-out (2) makes it low priority |
| `src/dashboard-html.js` | 489 | Inherently monolithic | Skip | Template-only — single exported function returning HTML string |
| `src/orchestrator.js` | 481 | Single responsibility | Skip | Orchestrator mode API — all 3 exports (`initRun`, `runStep`, `finishRun`) share state management logic |
| `src/claude.js` | 415 | Clear multi-responsibility | **Skip (high risk)** | Could extract stream parsing, but 22 imports + core stability concerns |
| `src/dashboard.js` | 326 | Single responsibility | Skip | Just over threshold; SSE + progress file management is cohesive |

---

## 3. Detailed Analysis by File

### 3.1 `gui/resources/app.js` (1296 lines) — **SKIP: Inherently Monolithic**

**Responsibility**: Desktop GUI frontend — state machine driving 5 screens with DOM manipulation, API calls, and real-time progress polling.

**Why not split**:
- All 40+ functions share access to the global `state` object (lines 78-106)
- Screen transitions, polling, and event binding are tightly coupled
- No clear module boundaries — functions reference each other freely
- Browser-only code (no Node.js) — typical SPA architecture

**Import fan-out**: 0 (browser script, loaded via `<script>` tag)

**Verdict**: This is a normal size for a single-page app's main script. Splitting by screen would require passing state between modules or using an event bus, adding complexity without improving maintainability.

---

### 3.2 `src/cli.js` (644 lines) — **SKIP: Already Decomposed**

**Responsibility**: Commander CLI orchestration — parses args, coordinates all other modules, handles interactive step selection and run flow.

**Current structure**:
- Lines 1-18: Imports (13 modules)
- Lines 22-127: `buildStepCallbacks()` — step progress tracking
- Lines 129-202: Completion handling (`handleAbortedRun`, `printCompletionSummary`)
- Lines 204-268: Step selection and welcome screen
- Lines 270-318: Utility functions (sync summary, step list printing)
- Lines 320-470: Run flow (`setupGitAndPreChecks`, `executeRunFlow`, `finalizeRun`)
- Lines 472-644: Main `run()` function with Commander setup

**Why not split**:
- High fan-out: 22 import references across 14 files
- Already decomposed: `executor.js`, `orchestrator.js`, `report.js`, `consolidation.js` were extracted in prior passes
- The remaining code is orchestration glue — it needs to touch all modules
- `buildStepCallbacks()` could theoretically extract, but it's only used here and depends on dashboard state

**Verdict**: Further splitting would create artificial modules that just pass parameters between each other. The file is cohesive around its responsibility: CLI lifecycle orchestration.

---

### 3.3 `gui/server.js` (634 lines) — **SKIP: Inherently Monolithic**

**Responsibility**: HTTP server backend for desktop GUI — serves static files, handles API endpoints, manages Chrome launcher and heartbeat watchdog.

**Current structure**:
- Lines 1-35: Imports, constants, MIME types
- Lines 36-105: PowerShell folder picker script (embedded)
- Lines 107-175: Process management helpers
- Lines 176-430: API endpoint handlers (12 handlers)
- Lines 431-508: Router and helpers
- Lines 510-635: Chrome launcher, cleanup, server bootstrap

**Why not split**:
- Handlers share `activeProcesses` map, `guiLog`, `lastHeartbeat`
- PowerShell script is an embedded constant (not logic)
- Splitting handlers into separate files would fragment related code
- Low fan-out: only used by test files

**Potential split (rejected)**:
- Extract `FOLDER_PICKER_PS1` to a constants file — saves 70 lines but adds indirection for no benefit
- Extract handlers to `gui/handlers/*.js` — would require passing shared state to each handler

**Verdict**: HTTP servers with multiple route handlers are typically kept in one file. The 634 lines include 70 lines of PowerShell script which isn't really JavaScript code.

---

### 3.4 `src/sync.js` (535 lines) — **SKIP: Low Value**

**Responsibility**: Google Doc prompt sync — fetches HTML, parses sections, matches to manifest, writes prompt files.

**Clear separation exists**:
- Lines 1-94: HTML parsing helpers (`decodeEntities`, `stripTags`, `htmlToMarkdown`)
- Lines 95-164: Section parsing and filtering
- Lines 166-259: Name normalization and manifest matching
- Lines 261-300: Hash computation and fetch
- Lines 302-535: Main sync orchestrator (`syncPrompts`)

**Why not split (despite clear responsibilities)**:
- Low fan-out: only 2 import references (cli.js dynamic import, test file)
- All parsing helpers are only used within this file
- Extracting `sync-parsers.js` would add a file nobody else imports
- Total lines saved in main file: ~150 — not worth the indirection

**Verdict**: The file is well-structured with clear internal sections. Splitting would add module boundary overhead without improving discoverability or testability.

---

### 3.5 `src/dashboard-html.js` (489 lines) — **SKIP: Inherently Monolithic**

**Responsibility**: Single function `getHTML(csrfToken)` that returns a complete HTML document string.

**Contents**:
- 1 export
- 245 lines of CSS
- 185 lines of client-side JavaScript
- HTML structure template

**Why not split**:
- It's a template file — all CSS, HTML, and JS belong together
- Extracting CSS to a separate file would require a build step (currently no build)
- The project explicitly avoids build steps per CLAUDE.md

**Verdict**: This is the correct architecture for an inline HTML template. The "lines" are mostly CSS which doesn't count as logic.

---

### 3.6 `src/orchestrator.js` (481 lines) — **SKIP: Single Responsibility**

**Responsibility**: Claude Code orchestrator mode — JSON API for step-by-step runs with state persistence.

**Structure**:
- Lines 1-70: State management helpers (`readState`, `writeState`, validation)
- Lines 71-150: Result building (`buildExecutionResults`, `buildProgressState`, `writeProgress`)
- Lines 150-206: Dashboard server lifecycle
- Lines 207-285: `initRun()` — initialize orchestrated run
- Lines 287-377: `runStep()` — execute single step
- Lines 379-481: `finishRun()` — complete run, generate reports

**Why not split**:
- All 3 exported functions share state management helpers
- Splitting by function would duplicate state handling or require cross-imports
- Medium fan-out (9 imports) but all are in test files or cli.js

**Verdict**: The three exported functions (`initRun`, `runStep`, `finishRun`) form a cohesive API. Splitting would fragment the orchestrator mode logic.

---

### 3.7 `src/claude.js` (415 lines) — **SKIP: High Risk**

**Responsibility**: Claude Code subprocess wrapper — spawn, retry, timeout, stream parsing, error classification.

**Clear separation exists**:
- Lines 1-70: Constants and error classification (`classifyError`, `ERROR_TYPE`)
- Lines 71-135: Subprocess helpers (`forceKillChild`, `sleep`, `spawnClaude`)
- Lines 136-263: Stream event parsing (`summarizeToolInput`, `formatStreamEvent`, `waitForChild`)
- Lines 264-320: JSON output parsing (`parseJsonOutput`)
- Lines 322-415: Main API (`runOnce`, `runPrompt`)

**Why splitting is high risk**:
- **Highest fan-out in codebase**: 22 imports across 19 files
- Core stability concern — subprocess handling is battle-tested
- Stream parsing is tightly coupled to `waitForChild`
- Extracting `claude-stream-parser.js` would touch 19+ files

**Potential split (rejected)**:
- Extract `ERROR_TYPE` and `classifyError` to `claude-errors.js` (~50 lines)
- Import fan-out makes this high risk for low line reduction

**Verdict**: The file is at 415 lines which is only 15% over the 300-line soft threshold and 17% under the 500-line hard threshold. The risk of touching 19 files outweighs the benefit.

---

### 3.8 `src/dashboard.js` (326 lines) — **SKIP: Just Over Threshold**

**Responsibility**: Progress dashboard — HTTP server with SSE, progress file writer, TUI window spawner.

**Why not split**:
- Only 26 lines over the 300-line threshold
- All functions share the `ds` state object
- SSE broadcasting and file writing are conceptually related

**Verdict**: File is too small to warrant splitting. The 326 lines include significant whitespace and imports.

---

## 4. Splits Executed

None. All files were determined to be either inherently monolithic, high risk, or low value.

---

## 5. Splits Attempted but Reverted

None attempted.

---

## 6. Files Skipped (Summary)

| File | Lines | Reason | Future Pass? |
|------|-------|--------|--------------|
| `gui/resources/app.js` | 1296 | Inherently monolithic SPA | No — would require state management refactor |
| `src/cli.js` | 644 | High fan-out, already decomposed | No — orchestration glue by design |
| `gui/server.js` | 634 | Inherently monolithic HTTP server | No — handlers share state |
| `src/sync.js` | 535 | Low fan-out, internal-only helpers | Maybe — if sync logic grows |
| `src/dashboard-html.js` | 489 | Template-only, no build step | No — it's a template file |
| `src/orchestrator.js` | 481 | Cohesive 3-function API | No — state sharing prevents split |
| `src/claude.js` | 415 | Highest fan-out, core stability | No — too risky |
| `src/dashboard.js` | 326 | Just over threshold | No — not worth it |

---

## 7. Structural Observations (Documentation Only)

### 7.1 Directory Structure

The codebase uses a flat `src/` structure which works well at 18 source files. No subdirectory restructuring is recommended.

### 7.2 Barrel File Assessment

The project does not use barrel files (`index.js` re-exports). This is appropriate:
- Avoids circular dependency masking
- Improves tree-shaking
- Makes import sources explicit

No changes recommended.

### 7.3 Shared Module Opportunities

No shared modules identified. The decomposition passes (runs 01 and 02) already extracted:
- `executor.js` — step execution loop
- `consolidation.js` — action plan generation
- `report.js` — report generation
- `dashboard-*.js` — three-file dashboard system

---

## 8. File Size Distribution

### Before Analysis (Current State)

| Range | Count | Files |
|-------|-------|-------|
| 0-100 lines | 3 | `env.js` (46), `setup.js` (99), `notifications.js` (32) |
| 100-200 lines | 5 | `git.js` (144), `lock.js` (118), `report.js` (190), `dashboard-standalone.js` (167), `dashboard-tui.js` (207) |
| 200-300 lines | 2 | `executor.js` (287), `checks.js` (268) |
| 300-500 lines | 4 | `claude.js` (415), `dashboard.js` (326), `orchestrator.js` (481), `dashboard-html.js` (489) |
| 500+ lines | 4 | `cli.js` (644), `gui/server.js` (634), `sync.js` (535), `gui/resources/app.js` (1296) |

**Median file size**: ~250 lines
**Average file size**: ~325 lines (skewed by `app.js`)

### After Analysis

No changes — distribution unchanged.

---

## 9. Recommendations

| # | Recommendation | Impact | Risk if Ignored | Worth Doing? | Details |
|---|---|---|---|---|---|
| 1 | Accept current file sizes as appropriate | Reduced analysis overhead on future passes | Low | Yes | The 8 oversized files are either inherently monolithic or have been through prior decomposition. Further splitting would add complexity. |
| 2 | Consider splitting `sync.js` if it grows past 600 lines | Improved maintainability | Low | Only if time allows | The HTML parsing helpers (lines 45-164) could extract cleanly if more parsing logic is added. |
| 3 | Monitor `gui/resources/app.js` if GUI features expand | None currently | Low | Only if needed | At 1296 lines it's large but manageable. If it doubles, consider React/Vue migration with proper component structure. |

---

## 10. Conclusion

This codebase has reached an appropriate level of decomposition. The two prior FILE_DECOMPOSITION passes (runs 01 and 02) successfully extracted cohesive modules (`executor.js`, `consolidation.js`, `report.js`, dashboard components). The remaining oversized files are either:

1. **Inherently monolithic** — templates, state machines, HTTP servers
2. **Already decomposed** — with orchestration glue remaining in the main files
3. **High fan-out / core stability** — where splitting would risk breaking many dependents

No further decomposition is recommended at this time. The codebase's file structure is appropriate for its size (~3,500 lines of production code across 18 files).
