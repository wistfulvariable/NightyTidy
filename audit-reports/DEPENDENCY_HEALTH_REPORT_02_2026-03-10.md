# Dependency Health Report — NightyTidy

**Run Date**: 2026-03-10
**Run Number**: 02

---

## Executive Summary

| Metric | Value |
|--------|-------|
| Total Dependencies | 149 (6 direct prod, 162 dev, 53 optional transitive) |
| Known Vulnerabilities | **0** |
| Dependencies 1+ Major Versions Behind | **1** (vitest 3→4) |
| Potentially Abandoned Dependencies | **1** (node-notifier — last release 2022-02-01) |
| License Risks | **0** |
| Upgrades Applied | **0** (all already at latest within major) |
| Dependencies Removed | **1** (marked — unused npm package) |

---

## Vulnerability Report

**npm audit result: 0 vulnerabilities**

| Package | CVE | Severity | Used in Project? | Fix Available? | Fix Applied? |
|---------|-----|----------|------------------|----------------|--------------|
| — | — | — | — | — | — |

No security vulnerabilities were detected in any production or development dependencies.

---

## License Compliance

### Production Dependencies (44 packages)

| License | Count |
|---------|-------|
| MIT | 38 |
| ISC | 6 |

### All Dependencies (149 packages)

| License | Count |
|---------|-------|
| MIT | 123 |
| ISC | 14 |
| BSD-3-Clause | 5 |
| BlueOak-1.0.0 | 5 |
| Apache-2.0 | 2 |

**Risk Assessment**: All licenses are permissive and compatible with the project's MIT license. No GPL, AGPL, SSPL, or unlicensed dependencies found.

---

## Staleness Report

### Direct Production Dependencies

| Package | Current | Latest | Behind | Last Published | Health |
|---------|---------|--------|--------|----------------|--------|
| @inquirer/checkbox | 5.1.0 | 5.1.0 | 0 | 2026-02-22 | Excellent |
| chalk | 5.6.2 | 5.6.2 | 0 | 2025-09-08 | Excellent |
| commander | 14.0.3 | 14.0.3 | 0 | 2026-01-31 | Excellent |
| node-notifier | 10.0.1 | 10.0.1 | 0 | 2022-02-01 | **At Risk** |
| ora | 9.3.0 | 9.3.0 | 0 | 2026-02-05 | Excellent |
| simple-git | 3.32.3 | 3.32.3 | 0 | 2026-02-26 | Excellent |

### Direct Development Dependencies

| Package | Current | Latest | Behind | Last Published | Health |
|---------|---------|--------|--------|----------------|--------|
| vitest | 3.2.4 | 4.0.18 | **1 major** | 2026-01-22 | Good |
| @vitest/coverage-v8 | 3.2.4 | 4.0.18 | **1 major** | 2026-01-22 | Good |

---

## Upgrades Applied

No patch or minor upgrades were available. All dependencies were already at the latest version within their current major version.

---

## Major Upgrades Needed (Not Applied)

| Package | Current | Target | Breaking Changes | Effort | Priority |
|---------|---------|--------|------------------|--------|----------|
| vitest | 3.2.4 | 4.0.18 | Coverage config changes, pool architecture rewrite, mock API changes | Moderate | Low |
| @vitest/coverage-v8 | 3.2.4 | 4.0.18 | Must upgrade together with vitest | Moderate | Low |

### Vitest 3 → 4 Migration Notes

Key breaking changes that may affect this project:

1. **Coverage Configuration**
   - `coverage.all`, `coverage.extensions`, `coverage.ignoreEmptyLines` removed
   - Need to verify `coverage.include` patterns are explicit

2. **Pool Architecture**
   - `maxThreads`/`maxForks` → `maxWorkers`
   - `poolOptions` removed; options now top-level

3. **Mock API Changes**
   - `vi.fn().getMockName()` returns `vi.fn()` instead of `spy`
   - `vi.restoreAllMocks` no longer resets spy state
   - `invocationCallOrder` now starts at 1 (like Jest)

4. **Removed APIs**
   - `deps.external`, `deps.inline`, `deps.fallbackCJS` removed

**Recommendation**: This is a dev-only dependency upgrade. Test suite must be audited for mock usage patterns before upgrading. Not urgent — vitest 3.x still receives updates. Schedule for a dedicated upgrade session.

---

## Dependency Weight & Reduction

### Unused Dependencies Removed

| Package | Reason | Size Impact |
|---------|--------|-------------|
| marked | npm package not imported anywhere; GUI uses vendored UMD file | -1 package |

### Dependencies Removed This Run

```
removed 1 package (marked)
```

Tests verified: 738/738 passing after removal.

### Potential Future Removals

No other unused dependencies detected. All imports verified:

| Package | Used In |
|---------|---------|
| @inquirer/checkbox | src/cli.js (dynamic import for step selection) |
| chalk | src/logger.js, src/cli.js, src/dashboard-tui.js |
| commander | src/cli.js |
| node-notifier | src/notifications.js |
| ora | src/cli.js |
| simple-git | src/git.js |

---

## Abandoned/At-Risk Dependencies

| Package | Last Release | Maintainer Activity | Risk | Recommendation |
|---------|--------------|---------------------|------|----------------|
| node-notifier | 2022-02-01 | Low — last commit 4+ years ago | **Medium** | Monitor; consider alternatives if issues arise |

### node-notifier Analysis

- **Purpose**: Cross-platform desktop notifications (Windows toast, macOS Notification Center, Linux notify-send)
- **Usage**: Fire-and-forget notifications in `src/notifications.js`
- **Risk factors**:
  - No releases in 4+ years
  - GitHub shows limited maintainer activity
  - Still works on current platforms
- **Mitigation**: Errors are swallowed per design (`notifications.js` catches all errors)
- **Alternatives**:
  - `notifier` (actively maintained)
  - `electron-native-notify` (if ever migrating to Electron)
  - Native platform CLIs via spawn (more work, no additional dependency)
- **Action**: No immediate action required. If notification failures increase on newer OS versions, evaluate alternatives.

---

## Node.js Engine Compatibility Warning

Several `@inquirer/*` packages declare engine requirements that the current environment doesn't meet:

```
npm warn EBADENGINE @inquirer/checkbox@5.1.0
  required: { node: '>=23.5.0 || ^22.13.0 || ^21.7.0 || ^20.12.0' }
  current:  { node: 'v22.12.0' }
```

The project's `package.json` requires `node: ">=20.12.0"`. The @inquirer packages have stricter requirements (^22.13.0 for Node 22.x).

**Risk**: Low — these are soft warnings and the package works fine. The engine check is overly strict.

**Action**: When upgrading Node.js to 22.13.0+, these warnings will resolve.

---

## Recommendations

### Priority 1 — Immediate

None. No security vulnerabilities or critical issues found.

### Priority 2 — Soon

1. **Update Node.js to 22.13.0+** to resolve @inquirer engine warnings

### Priority 3 — Scheduled

1. **Vitest 4 upgrade** — Schedule a dedicated session to:
   - Review mock usage patterns in test files
   - Update `vitest.config.js` for new coverage API
   - Run full test suite with verbose output
   - Update any `vi.fn()` snapshot assertions if needed

### Priority 4 — Monitor

1. **node-notifier** — Watch for platform compatibility issues on newer Windows/macOS versions. If issues arise, evaluate `notifier` package as replacement.

### Suggested Tooling

The project already has good dependency hygiene practices:

- `npm audit` in CI (via `npm run check:security`)
- Lock file committed (`package-lock.json`)
- No duplicate package versions in tree

**Optional additions**:
- Dependabot for automated minor/patch updates
- `npx npm-check` for manual periodic reviews

---

## Test Verification

| Check | Result |
|-------|--------|
| Baseline test run (pre-changes) | 738 tests passing |
| Post `marked` removal | 738 tests passing |
| npm audit | 0 vulnerabilities |
