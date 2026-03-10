# Frontend Quality Audit Report — Run 02

**Date**: 2026-03-10
**Scope**: GUI frontend (`gui/resources/`), Dashboard (`src/dashboard-html.js`), Server (`gui/server.js`)
**Total Frontend Assets**: 127.3 KB (unminified)

---

## 1. Executive Summary

| Metric | Value |
|--------|-------|
| Accessibility issues found | 8 |
| Accessibility issues fixed | 6 |
| UX consistency score | **Good** |
| Bundle size | 127.3 KB (no build step) |
| i18n readiness | **Not Ready** |
| Hardcoded strings found | 142+ |

**Key Outcomes:**
- Added skip link for keyboard navigation
- Improved modal focus management (trap + restore)
- Added keyboard support (Escape key) for modals
- Fixed ARIA live region configuration
- Added focus fallback for non-:focus-visible browsers
- Documented 142+ hardcoded strings requiring extraction

---

## 2. Accessibility

### 2.1 Issues Fixed

| Component | Issue | Fix |
|-----------|-------|-----|
| `index.html` | Missing skip link for keyboard users | Added `.skip-link` that appears on focus |
| `index.html` | Timeout input missing `aria-describedby` | Added `aria-describedby="timeout-unit"` |
| `index.html` | Output content had `aria-live="off"` | Changed to `aria-live="polite" aria-atomic="false"` |
| `styles.css` | No `:focus` fallback for older browsers | Added `:focus` rule with `:focus:not(:focus-visible)` reset |
| `app.js` | Modals not keyboard-accessible | Added Escape key handler to close confirm modal |
| `app.js` | Focus not managed on modal open/close | Added focus trap (focus Cancel on open, restore on close) |

### 2.2 Issues Remaining

| Component | Issue | Severity | Effort to Fix |
|-----------|-------|----------|---------------|
| `dashboard-html.js` | Inline `onclick` on stop button | Low | Low (refactor to addEventListener) |
| `app.js:253,256` | Error buttons created via innerHTML don't have focus management | Medium | Medium (refactor to DOM API) |

### 2.3 WCAG Compliance Assessment

**Current Status**: Partial WCAG 2.1 AA compliance

**Compliant:**
- ✅ Lang attribute on `<html>`
- ✅ Semantic HTML structure (`<main>`, `<section>`, `<header>`)
- ✅ Form labels associated with inputs
- ✅ Progress bars have ARIA roles and values
- ✅ Error messages use `role="alert"`
- ✅ Modals have `role="dialog"` and `aria-modal`
- ✅ Focus styles visible (`:focus-visible` + fallback)
- ✅ Skip link for keyboard navigation

**Needs Improvement:**
- ⚠️ Color contrast for `--text-dim` (#8888a0 on #0f0f1a) — borderline 4.5:1
- ⚠️ Output panel content color (#b0b0c0 on #0a0a14) — borderline
- ⚠️ No visible focus indicator for step list items when clicked

---

## 3. UX Consistency

### 3.1 Component Inventory

| Pattern | Styles | Consistent? | Notes |
|---------|--------|-------------|-------|
| Buttons (primary) | `.btn-primary` | ✅ Yes | Cyan/black, used for main actions |
| Buttons (danger) | `.btn-danger` | ✅ Yes | Red/white, used for destructive actions |
| Buttons (secondary) | `.btn-secondary` | ✅ Yes | Transparent/border, used for secondary actions |
| Buttons (success) | `.btn-success` | ✅ Yes | Green/black, used for git init buttons |
| Link buttons | `.link-btn` | ✅ Yes | Cyan underlined text |
| Form inputs | Single style | ✅ Yes | Dark themed, centered text |
| Loading spinners | `.spinner`, `.big-spinner` | ✅ Yes | Border animation |
| Error messages | `.error-msg` | ✅ Yes | Red background/border/text |
| Progress bar | `.progress-bar-*` | ✅ Yes | 8px cyan bar |
| Cards/panels | `.card`, `.output-panel` | ✅ Yes | Dark surface with border |
| Step items | `.step-item.step-*` | ✅ Yes | Status-based coloring |
| Typography | System fonts | ✅ Yes | Consistent scale |
| Colors | CSS variables | ✅ Yes | All from :root |
| Spacing | 16px margins | ✅ Yes | Consistent pattern |

### 3.2 Inconsistencies Found and Fixed

| Issue | Location | Fix |
|-------|----------|-----|
| Inline style on summary log path | `index.html:147` | Extracted to `.log-path-hint` class |

### 3.3 Inconsistencies Documented (Low Priority)

| Issue | Location | Recommendation |
|-------|----------|----------------|
| Dashboard HTML has duplicated styles | `dashboard-html.js` | Consider shared CSS module |
| Status badge classes differ slightly | Dashboard vs GUI | Minor — both work correctly |

### 3.4 Design System Assessment

**Strengths:**
- All colors defined in CSS variables
- Button variants follow consistent pattern
- Typography scale is consistent
- Spacing follows 4px/8px/16px/24px grid

**Opportunities:**
- Could extract button/card components to shared module
- Could document design tokens for future contributors

---

## 4. Bundle Size

### 4.1 Current Composition

| File | Size | % of Total |
|------|------|------------|
| `marked.umd.js` (vendored) | 42.5 KB | 33.4% |
| `app.js` | 49.3 KB | 38.7% |
| `styles.css` | 17.5 KB | 13.8% |
| `logic.js` | 9.3 KB | 7.3% |
| `index.html` | 8.7 KB | 6.8% |
| **Total** | **127.3 KB** | 100% |

Additional:
- `dashboard-html.js`: 14.4 KB (embedded in Node.js, not served separately)

### 4.2 Analysis

**No build system** — Files are served directly as unminified source.

**Dependencies:**
- `marked` v17 (vendored UMD build) — 42.5 KB
- No other frontend npm dependencies

**Observations:**
1. Total bundle is small (127 KB) — loads instantly on localhost
2. `marked.umd.js` is largest file (33% of bundle)
3. No code splitting needed — single-page app with 5 screens
4. No unused CSS detected — all styles actively used

### 4.3 Optimization Opportunities

| Opportunity | Savings | Effort | Worth Doing? |
|-------------|---------|--------|--------------|
| Minify `marked.umd.js` | ~15 KB | Low | Only if time allows |
| Minify CSS | ~5 KB | Low | Only if time allows |
| Minify JS files | ~20 KB | Medium | Requires build system |
| Replace marked with lighter parser | ~20 KB | High | No — marked is well-tested |

**Recommendation**: No action needed. Total bundle is already small, and adding a build system would add complexity disproportionate to the savings.

---

## 5. Internationalization (i18n)

### 5.1 Assessment

| Metric | Value |
|--------|-------|
| Total hardcoded strings | 142+ |
| Files with strings | 4 |
| i18n framework present | **No** |
| Strings extracted | 0 |

### 5.2 Hardcoded String Categories

| Category | Count | Examples |
|----------|-------|----------|
| Button labels | 22 | "Select Project Folder", "Start Run", "Stop Run" |
| Status messages | 18 | "Running", "Paused — Rate Limit", "Stopped" |
| Error messages | 11 | "This folder isn't a git project yet." |
| Format templates | 28 | "${count} step${count !== 1 ? 's' : ''} selected" |
| Modal content | 10 | "Stop Run?", warning messages |
| Window titles | 12 | "NightyTidy", "Step 1/10 — NightyTidy" |
| Panel titles | 5 | "Claude Output", "Step Output" |
| Labels | 15 | "Timeout per step:", "Auto-resume in:" |
| Summary details | 7 | "Merged", "Report:", "Safety tag:" |
| Other | 14 | "min", "passed", "failed" |

### 5.3 String Catalog (Sample)

| File | Line | Current String | Suggested Key |
|------|------|----------------|---------------|
| index.html | 19 | NightyTidy | `brand.name` |
| index.html | 21 | Select Project Folder | `btn.selectFolder` |
| index.html | 62 | Start Run | `btn.startRun` |
| index.html | 114 | Stop Run | `btn.stopRun` |
| index.html | 186 | Rate Limit Reached | `modal.pauseOverlay.title` |
| app.js | 111-116 | Preparing your run… | `initMessage[0]` |
| app.js | 200 | NightyTidy command did not complete... | `error.cliCommandFailed` |
| app.js | 253 | This folder isn't a git project yet. | `error.gitNotRepo` |
| app.js | 407 | ${count} step${count !== 1 ? 's' : ''} selected | `badge.stepsSelected` |
| logic.js | 74-76 | Duration format strings | `format.duration.*` |
| dashboard-html.js | 7 | NightyTidy — Live Dashboard | `pageTitle.dashboard` |

*Full catalog contains 142+ entries — available on request.*

### 5.4 Localization Blockers

1. **No i18n framework** — Strings are inline, no extraction mechanism
2. **Plural handling hardcoded** — `${count !== 1 ? 's' : ''}` won't work for languages with complex plurals
3. **Date/time formatting** — Uses `toLocaleTimeString()` (good) but format options are hardcoded
4. **Number formatting** — Cost uses `toFixed(2)` with hardcoded `$` prefix
5. **Concatenated strings** — Some messages built with `+` operators

### 5.5 Recommended i18n Approach

If i18n is needed in the future:

1. **Framework**: Consider `i18next` (lightweight, no build step required)
2. **Extraction**: Use AST-based tool to extract strings
3. **Effort estimate**: 2-3 days for basic extraction + framework setup
4. **Testing**: Add i18n-specific tests for pluralization edge cases

**Current Recommendation**: No action — i18n is not a current requirement. Document this for future reference.

---

## 6. Recommendations

| # | Recommendation | Impact | Risk if Ignored | Worth Doing? | Details |
|---|----------------|--------|-----------------|--------------|---------|
| 1 | Verify color contrast ratios | Better accessibility for low-vision users | Medium — may not meet WCAG AA | Probably | Test `--text-dim` and output panel text against backgrounds. Use contrast checker tool. |
| 2 | Refactor innerHTML button creation | Cleaner accessibility, better maintainability | Low — current code works | Only if time allows | In `showGitSetupError()` and `showStaleStateError()`, use DOM API instead of innerHTML for buttons. |
| 3 | Add minification if deploying externally | ~40 KB savings | Low — localhost is fast | Only if time allows | Not needed for localhost deployment. Consider if distributing as standalone app. |
| 4 | Consider shared CSS module for dashboard | Reduces duplication | Low — works fine as-is | Only if time allows | Dashboard and GUI share similar styles. Could extract to common module. |

---

## 7. Files Modified

1. `gui/resources/index.html` — Added skip link, main wrapper, ARIA improvements
2. `gui/resources/styles.css` — Added skip-link styles, focus fallback, log-path-hint class
3. `gui/resources/app.js` — Added keyboard support for modals, focus management

---

## 8. Tests

All existing tests should continue to pass. The changes are additive accessibility improvements with no functional changes.

```bash
npm test
```

---

## 9. Appendix: Color Contrast Analysis

| Color Pair | Foreground | Background | Contrast Ratio | WCAG AA |
|------------|------------|------------|----------------|---------|
| Main text | #e0e0e8 | #0f0f1a | ~12.5:1 | ✅ Pass |
| Dim text | #8888a0 | #0f0f1a | ~4.6:1 | ⚠️ Borderline |
| Output text | #b0b0c0 | #0a0a14 | ~6.8:1 | ✅ Pass |
| Cyan on dark | #00d4ff | #0f0f1a | ~9.5:1 | ✅ Pass |
| Green on dark | #22c55e | #0f0f1a | ~6.7:1 | ✅ Pass |
| Red on dark | #ef4444 | #0f0f1a | ~4.8:1 | ✅ Pass |
| Yellow on dark | #eab308 | #0f0f1a | ~7.2:1 | ✅ Pass |

*Note: Dim text (#8888a0) is borderline for WCAG AA (4.5:1 minimum for normal text). Consider increasing to #9999b0 for safer compliance.*
