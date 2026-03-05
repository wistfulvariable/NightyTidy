# File Decomposition Report 02 — 2026-03-05

## 1. Executive Summary

Analyzed 14 source files (excluding auto-generated `steps.js`). Identified 3 files exceeding 300 lines. Executed 1 split (`dashboard.js`), skipped 2 (auto-generated and single-responsibility). All 248 tests passing after changes.

- **Files analyzed**: 14 source files
- **Files over 300 lines**: 3 (including 1 auto-generated)
- **Splits executed**: 1
- **Splits skipped**: 2
- **Tests passing**: 248/248

## 2. File Size Inventory

### All Source Files (sorted by line count)

| File | Lines | Primary Responsibility | Exports | Importers |
|------|-------|----------------------|---------|-----------|
| `src/prompts/steps.js` | 5422 | 28 improvement prompts (auto-generated) | 4 | 3 |
| `src/dashboard.js` | 640 → **229** | HTTP server + SSE + TUI spawn + state | 4 | 4 |
| `src/cli.js` | 472 | Full lifecycle orchestration | 1 | 1 |
| `src/dashboard-html.js` | **411** (new) | HTML template with CSS + JS | 1 | 1 |
| `src/checks.js` | 228 | Pre-run validation (6 checks) | 1 | 3 |
| `src/claude.js` | 198 | Claude Code subprocess wrapper | 1 | 3 |
| `src/dashboard-tui.js` | 182 | Standalone TUI progress display | 0 | 0 |
| `src/report.js` | 162 | Report generation + CLAUDE.md update | 3 | 3 |
| `src/git.js` | 143 | Git operations via simple-git | 7 | 4 |
| `src/executor.js` | 129 | Core step loop | 2 | 3 |
| `src/setup.js` | 100 | --setup command | 1 | 2 |
| `src/logger.js` | 48 | File + stdout logger | 5 | 9 |
| `src/notifications.js` | 16 | Desktop notifications | 1 | 3 |
| `bin/nightytidy.js` | 3 | Entry point | 0 | 0 |

### Files Over 300 Lines (Pre-Split)

| File | Before (lines) | After (lines) | Action | New Files Created |
|------|----------------|---------------|--------|-------------------|
| `src/prompts/steps.js` | 5422 | 5422 | Skipped (auto-generated) | — |
| `src/dashboard.js` | 640 | 229 | **Split** | `src/dashboard-html.js` (411 lines) |
| `src/cli.js` | 472 | 472 | Skipped (single responsibility) | — |

## 3. Splits Executed

### dashboard.js → dashboard.js + dashboard-html.js

- **Original file**: `src/dashboard.js` — 640 lines, 4 exports
- **Responsibilities identified**:
  1. HTTP server logic, SSE, CSRF, TUI spawning, state management (lines 1-229)
  2. HTML template with CSS and client-side JavaScript (lines 230-640, the `getHTML()` function)
- **New files**:
  - `src/dashboard-html.js` (411 lines) — exports `getHTML(csrfToken)` function
  - `src/dashboard.js` (229 lines) — all server logic, imports `getHTML` from new module
- **Change**: `getHTML()` now accepts `csrfToken` as a parameter instead of reading the module-level variable. This is an internal-only change (function was never exported).
- **Import references updated**: 1 (internal import in `dashboard.js`)
- **External importers unchanged**: `cli.js`, `cli.test.js`, `cli-extended.test.js`, `dashboard.test.js`, `dashboard-extended.test.js`, `contracts.test.js` — all import from `dashboard.js` which still exports the same 4 functions
- **Test status**: 248/248 passing
- **Commit**: `0d9fb34` — `refactor: decompose dashboard.js into dashboard.js + dashboard-html.js`

## 4. Splits Attempted but Reverted

None. The single split executed cleanly.

## 5. Files Skipped

### `src/prompts/steps.js` (5422 lines) — Inherently Monolithic

Auto-generated from external `extracted-prompts.json`. CLAUDE.md explicitly states "Never edit `src/prompts/steps.js` manually." Contains 28 prompt objects + 2 additional prompt constants. Splitting would break the generation pipeline and violate project rules.

**Future pass**: Not applicable — this file is managed by an external tool.

### `src/cli.js` (472 lines) — Single Responsibility, Just Long

This file is the full lifecycle orchestrator: CLI parsing, lock management, step selection, git setup, execution, reporting, and completion summary. While it contains identifiable sub-concerns (lock management ~58 lines, welcome screen ~20 lines, step callbacks ~44 lines), they are all tightly coupled to the `run()` function and used nowhere else.

**Assessment**: Splitting would create 3-4 tiny files with single functions that have no reuse value. The file reads linearly as a sequence of lifecycle steps, which is exactly its purpose per CLAUDE.md. At 472 lines it's over the 300-line conservative threshold but well under 500.

**Future pass**: Could extract `acquireLock()`/`isProcessAlive()` to `src/lock.js` (~60 lines) if lock management grows in complexity. Not worth it today.

## 6. Structural Observations (Documentation Only)

### Directory Structure
The flat `src/` directory with 13 files is appropriate for this project size. No subdirectories needed beyond the existing `src/prompts/`.

### Barrel Files
The project does not use barrel files. No change recommended — direct imports are clearer for this module count.

### Dashboard Module Group
With the split, there are now 3 dashboard-related files (`dashboard.js`, `dashboard-html.js`, `dashboard-tui.js`). A `src/dashboard/` subdirectory could group them, but this would change import paths across 6+ files for marginal organizational benefit. Not recommended at current scale.

## 7. File Size Distribution

| Range | Before | After |
|-------|--------|-------|
| 0-100 lines | 5 | 5 |
| 100-200 lines | 5 | 5 |
| 200-300 lines | 1 | 2 |
| 300-500 lines | 1 | 2 |
| 500+ lines | 1 (640) | 0 |
| Auto-generated 500+ | 1 (5422) | 1 (5422) |

**Key improvement**: The only non-generated file over 500 lines (`dashboard.js` at 640) has been eliminated. The largest non-generated file is now `cli.js` at 472 lines.

## 8. Recommendations

| # | Recommendation | Impact | Risk if Ignored | Worth Doing? | Details |
|---|---|---|---|---|---|
| 1 | Extract lock management from cli.js | Reduces cli.js by ~60 lines, cleaner separation | Low | Only if time allows | `acquireLock()`, `isProcessAlive()`, and `LOCK_FILENAME` could move to `src/lock.js`. Only worth doing if lock logic grows (e.g., adding stale lock detection improvements or multi-process coordination). |

No critical or high-risk recommendations. The codebase is well-structured with clear module boundaries.
