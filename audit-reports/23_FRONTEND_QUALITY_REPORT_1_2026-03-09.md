# Audit #23 — Frontend Quality Report

**Date**: 2026-03-09
**Auditor**: Claude Code (automated)
**Files Audited**: 5 frontend files (GUI SPA + dashboard template)

---

## Phase 1: Accessibility Audit

### 1.1 Semantic HTML

| File | Issue | Severity | Fix |
|------|-------|----------|-----|
| `index.html` | Uses `<section>` for screens but no `<main>` landmark wrapping content | Low | Wrap visible screen content in `<main>` or add `role="main"` |
| `index.html` | `<div class="header">` should be `<header>` for semantic meaning | Low | Replace with `<header>` element |
| `index.html` | `<div class="actions">` could use `<nav>` or at minimum group buttons semantically | Info | No change needed, buttons are self-describing |
| `dashboard-html.js` | Same pattern: `<div class="header">` instead of `<header>` | Low | Replace with `<header>` |

### 1.2 Heading Hierarchy

| File | Issue | Severity |
|------|-------|----------|
| `index.html` | Every screen has `<h1>NightyTidy</h1>` (5 total h1s). Only one h1 per page is recommended | Medium |
| `index.html` | Screen 3 uses `<h3>Claude Output</h3>` inside output panel (jumps from h1 to h3) | Low |
| `index.html` | Screen 5 uses `<h2>` for summary title — correct relative to screen h1 | OK |
| `dashboard-html.js` | Single h1 + h3 for summary — heading gap but acceptable for simple dashboard | Low |

**Recommendation**: Since screens are mutually exclusive (only one visible at a time), multiple h1s is acceptable in SPA context. However, adding `aria-labelledby` to each section would improve screen reader navigation. The h1-to-h3 jump in screen 3 should be changed to h2.

### 1.3 Images / Alt Text

No `<img>` elements found in any frontend file. No alt text issues.

### 1.4 Forms and Labels

| File | Element | Issue | Severity | Fix |
|------|---------|-------|----------|-----|
| `index.html` | `<input type="number" id="timeout-input">` | Has `<label for="timeout-input">` — **correct** | OK | None |
| `index.html` | Dynamically generated checkboxes in step checklist | Generated as `<label class="step-check-item">` wrapping `<input>` — **correct** | OK | None |
| `dashboard-html.js` | No form elements (display-only) | N/A | OK | None |

### 1.5 Interactive Elements and Keyboard Support

| File | Issue | Severity | Fix |
|------|-------|----------|-----|
| `index.html` | All click handlers are on `<button>` elements — **correct** | OK | None |
| `index.html` | `.step-check-item` has `cursor: pointer` on a `<label>` wrapping a checkbox — **correct** | OK | None |
| `dashboard-html.js` | Stop button uses `onclick` handler — functional but inline | Info | Not worth changing in template string |
| `index.html` | No visible focus styles defined (relies on browser defaults, which `* { margin: 0 }` reset may affect) | Medium | Add explicit `:focus-visible` styles |
| `styles.css` | No `:focus-visible` or `:focus` rules for buttons, links, or inputs | Medium | Add focus-visible outlines |

### 1.6 ARIA Usage

| File | Issue | Severity | Fix |
|------|-------|----------|-----|
| `index.html` | `<html lang="en">` present — **correct** | OK | None |
| `index.html` | Sections lack `aria-labelledby` — screen readers cannot identify screen purpose | Low | Add `aria-labelledby` pointing to each screen's heading |
| `index.html` | Progress bar (`div.progress-bar-track > div.progress-bar-fill`) lacks ARIA roles | Medium | Add `role="progressbar"`, `aria-valuenow`, `aria-valuemin`, `aria-valuemax` |
| `index.html` | Status badge (`#running-status-badge`) lacks `role="status"` or `aria-live` | Low | Add `role="status"` and `aria-live="polite"` |
| `index.html` | Error messages lack `role="alert"` | Medium | Add `role="alert"` to `.error-msg` elements |
| `index.html` | Loading spinner (`#setup-loading`) lacks `role="status"` and `aria-live` | Low | Add `role="status"` |
| `dashboard-html.js` | Same progress bar and error message ARIA gaps | Medium | Same fixes as GUI |
| `dashboard-html.js` | `#reconnecting` banner lacks `role="alert"` | Low | Add `role="alert"` |
| `dashboard-html.js` | `<html lang="en">` present — **correct** | OK | None |

### 1.7 Color Contrast Concerns

| Element | Foreground | Background | Estimated Ratio | Verdict |
|---------|-----------|------------|-----------------|---------|
| Body text `--text` (#e0e0e8) on `--bg` (#0f0f1a) | #e0e0e8 | #0f0f1a | ~14:1 | PASS |
| Dim text `--text-dim` (#8888a0) on `--bg` (#0f0f1a) | #8888a0 | #0f0f1a | ~5.5:1 | PASS (AA) |
| Dim text on `--surface` (#1a1a2e) | #8888a0 | #1a1a2e | ~4.3:1 | PASS (AA for large text), borderline for small |
| `--cyan` (#00d4ff) on `--bg` (#0f0f1a) | #00d4ff | #0f0f1a | ~10:1 | PASS |
| `--red` (#ef4444) on error bg (#450a0a) | #ef4444 | #450a0a | ~4.6:1 | PASS (AA) |
| `--green` (#22c55e) on #000 | #22c55e | #000 | ~8.5:1 | PASS |
| `.btn-primary` — #000 on #00d4ff | #000 | #00d4ff | ~10:1 | PASS |

All color combinations pass WCAG AA for their usage context. The `--text-dim` on `--surface` is the tightest ratio but is used for secondary labels, not primary content.

---

## Phase 2: UX Consistency Audit

### 2.1 Button Styles

| Pattern | Consistent? | Notes |
|---------|------------|-------|
| Primary action | Yes | `.btn-primary` (cyan bg, dark text) used for main CTAs |
| Danger action | Yes | `.btn-danger` (red bg, white text) used for Stop Run |
| Secondary action | Yes | `.btn-secondary` (transparent bg, border) for Select/Deselect All |
| Link-style action | Yes | `.link-btn` (cyan, underlined) for Back and Change |
| Dashboard stop btn | **No** | Uses `.stop-btn` class — separate from GUI's `.btn-danger` |

**Finding**: Dashboard (`dashboard-html.js`) defines its own `.stop-btn` class instead of reusing the `.btn` + `.btn-danger` pattern from the GUI. The visual result is nearly identical (same red, same padding, same border-radius), but the CSS is duplicated. This is acceptable since the dashboard is a standalone HTML template embedded in a different context.

### 2.2 Loading / Error / Empty States

| State | GUI (index.html) | Dashboard | Consistent? |
|-------|------------------|-----------|-------------|
| Loading | `.spinner` animation + "Loading steps..." text | `.spinner` animation | Yes |
| Error | `.error-msg` with red border + red text, shown via `.visible` class | Same `.error-msg` pattern | Yes |
| Empty | Not explicitly handled (step list could be empty) | Step list renders empty div | Acceptable |
| Finishing | Big spinner + "Generating report..." text | N/A (dashboard has no finishing screen) | N/A |
| Reconnecting | N/A (GUI uses polling, not SSE) | Yellow banner with "Reconnecting..." | OK |

**Finding**: The GUI does not handle the case where `state.steps` is empty after load (e.g., a project with no steps). The step checklist screen would show an empty list with "33 steps selected" badge still visible. However, the code checks for this in `loadSteps()` and shows an error, so the empty screen is never reached.

### 2.3 Spacing and Typography

- Font family is consistent: system fonts (`-apple-system`, `BlinkMacSystemFont`, `Segoe UI`) everywhere
- Monospace font consistent for paths and code output (`Cascadia Code`, `Fira Code`, `Consolas`)
- Spacing uses consistent 8px increments (8, 12, 16, 24px)
- Font sizes are consistent within categories (0.8rem for labels, 0.85rem for secondary, 0.9rem for body)
- Both GUI and dashboard use the same CSS custom properties for colors

### 2.4 Color Usage

Colors are used consistently and meaningfully:
- **Cyan** (`--cyan`): brand color, primary buttons, headings, links
- **Green** (`--green`): success/completed states
- **Red** (`--red`): error/failed states, danger buttons
- **Yellow** (`--yellow`): warning/stopped states
- **Blue** (`--blue`): running/in-progress states
- **Dim text** (`--text-dim`): secondary information, labels

No inconsistencies found. Color semantics are stable across both files.

---

## Phase 3: Bundle Size / Script Loading

### 3.1 Script Loading

| File | Method | Issue |
|------|--------|-------|
| `index.html` line 145-146 | `<script src="/logic.js">` and `<script src="/app.js">` at end of `<body>` | No `defer` or `async`, but placement at body end is equivalent to `defer` for render-blocking purposes. **Acceptable.** |
| `dashboard-html.js` | Inline `<script>` block (~180 lines) | Inline is appropriate for template-generated HTML served via SSE dashboard. Cannot use external scripts easily since it's a single-file template. |

### 3.2 Unused CSS Rules

Scanned `styles.css` (462 lines) against `index.html` and `app.js`:

| Selector | Used? | Notes |
|----------|-------|-------|
| `.btn-success` | **No** | Defined (line 69) but never applied in HTML or JS |
| `.folder-display .loading` | **No** | Defined (line 156-158) but no element has both `.folder-display` and `.loading` |
| `.status-starting` | **Potentially** | Defined in both files, used only in dashboard-html.js |
| `.status-finishing` | **Potentially** | Defined, may be applied via JS string concatenation |

**Finding**: `.btn-success` and `.folder-display .loading` appear unused. However, removing them carries minimal risk and minimal benefit (~5 lines). They could be future-proofing for UX additions.

### 3.3 CSS/JS Size

| File | Lines | Approx Size |
|------|-------|-------------|
| `styles.css` | 462 | ~9 KB |
| `logic.js` | 135 | ~3 KB |
| `app.js` | 587 | ~14 KB |
| `dashboard-html.js` (inline CSS) | ~240 | ~5 KB |
| `dashboard-html.js` (inline JS) | ~180 | ~4 KB |
| **Total** | ~1,604 | ~35 KB |

This is extremely lean. No bundler overhead, no framework bloat. For a local-only app running on `127.0.0.1`, this is ideal.

---

## Phase 4: Internationalization Readiness

### Hardcoded User-Facing Strings

| File | Count | Examples |
|------|-------|---------|
| `index.html` | 22 | "NightyTidy", "Automated overnight codebase improvement", "Select Project Folder", "Loading steps...", "Select Steps", "Select All", "Deselect All", "Timeout per step:", "min", "steps selected", "Back", "Start Run", "Running", "Now running:", "Claude Output", "Stop Run", "Finishing", "Generating report and merging changes...", "Summary", "Run Complete", "New Run", "Close" |
| `app.js` | 18 | "Stopping...", "Stop Run", "passed", "failed", "Run Stopped", "Run Complete", "Run Failed", "Run Complete (with failures)", "Passed", "Failed", "Total Steps", "Duration", "Merged", "Merge conflict", "Report:", "Safety tag:", "Run branch:", error messages |
| `dashboard-html.js` | 14 | "NightyTidy", "Live Dashboard", "Starting", "steps", "Running now", "Claude Code Output", "Stop Run", "Stopping...", "Run Complete", "Run Stopped", "Run Failed", "Done", "passed, failed out of ... steps", "All steps succeeded!", "Reconnecting..." |
| `logic.js` | 4 | "No output received from CLI", "Empty output from CLI", "Could not parse JSON from CLI output", time suffixes ("h", "m", "s") |
| **Total** | **~58** | |

**Assessment**: 58 hardcoded strings is a low count for a 5-screen application. No i18n framework is warranted at this stage. If internationalization is ever needed, the strings are concentrated in two files (`app.js` and `index.html`) and would be straightforward to extract to a JSON locale file.

**Recommendation**: Do NOT add i18n framework. The app targets English-speaking developers and runs locally. Document this decision if it ever comes up.

---

## Summary of Findings

### Critical Issues (0)
None.

### Medium Issues (4) — Implementing
1. **No focus-visible styles** — keyboard users lose visual track of focus
2. **Progress bar lacks ARIA roles** — invisible to screen readers
3. **Error messages lack `role="alert"`** — screen readers won't announce errors
4. **Heading hierarchy: h1 to h3 jump** in output panel

### Low Issues (7) — Implementing safe fixes
1. `<div class="header">` should be `<header>` (semantic HTML)
2. Sections lack `aria-labelledby`
3. Status badge lacks `role="status"` / `aria-live`
4. Loading spinner lacks `role="status"`
5. Dashboard reconnecting banner lacks `role="alert"`
6. Dashboard header div should be `<header>`
7. Dashboard progress bar same ARIA gaps

### Info Issues (2) — No action
1. Dashboard `.stop-btn` duplicates GUI `.btn-danger` styling (acceptable for standalone template)
2. Two unused CSS rules (`.btn-success`, `.folder-display .loading`) — negligible

### Positive Findings
- All interactive elements use proper `<button>` elements (no click-on-div antipatterns)
- Form inputs have proper `<label>` associations
- `<html lang="en">` present on both files
- HTML is properly escaped via `escapeHtml()` before DOM insertion
- Color contrast passes WCAG AA across all combinations
- Extremely lean bundle (~35 KB total, no framework overhead)
- Consistent design system (colors, spacing, typography)
- Scripts placed at end of body (no render blocking)
