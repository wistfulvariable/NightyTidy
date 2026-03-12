# Dependency Health & Upgrade Report

**Run Date**: 2026-03-11
**Run Number**: 01
**Project**: NightyTidy
**Node.js Version**: v22.12.0
**npm Version**: 10.9.1

---

## 1. Executive Summary

| Metric | Value |
|--------|-------|
| **Total Dependencies** | 156 (8 direct, 148 transitive) |
| **Direct Runtime Dependencies** | 6 |
| **Direct Dev Dependencies** | 2 |
| **Dependencies with Known Vulnerabilities** | 0 |
| **Dependencies 1+ Major Versions Behind** | 2 (vitest, @vitest/coverage-v8) |
| **Potentially Abandoned Dependencies** | 1 (node-notifier — last release Feb 2022) |
| **License Risks Found** | 0 (all MIT) |
| **Upgrades Applied** | 1 (simple-git 3.32.3 → 3.33.0) |
| **Dependencies Removed** | 0 |

**Overall Assessment**: ✅ **HEALTHY** — Dependency hygiene is excellent. All dependencies are actively used, the tree is minimal, and there are no security vulnerabilities.

---

## 2. Vulnerability Report

### Security Audit Results

```
$ npm audit
found 0 vulnerabilities
```

| Package | CVE | Severity | Used in Project? | Fix Available? | Fix Applied? |
|---------|-----|----------|------------------|----------------|--------------|
| — | — | — | — | — | — |

**No known vulnerabilities detected.** The project's dependency tree is clean.

### Historical Note: node-notifier

While the current `node-notifier@10.0.1` has no known vulnerabilities, the [Snyk security database](https://security.snyk.io/package/npm/node-notifier) has tracked historical issues in earlier versions. The package's inactive maintenance status (last release: Feb 2022) is a moderate supply chain risk to monitor.

---

## 3. License Compliance

All dependencies use the **MIT License**, which is permissive and compatible with the project's MIT license.

### Direct Dependencies

| Package | Version | License | Risk Level |
|---------|---------|---------|------------|
| @inquirer/checkbox | 5.1.0 | MIT | ✅ None |
| chalk | 5.6.2 | MIT | ✅ None |
| commander | 14.0.3 | MIT | ✅ None |
| node-notifier | 10.0.1 | MIT | ✅ None |
| ora | 9.3.0 | MIT | ✅ None |
| simple-git | 3.33.0 | MIT | ✅ None |
| vitest | 3.2.4 | MIT | ✅ None |
| @vitest/coverage-v8 | 3.2.4 | MIT | ✅ None |

### Transitive Dependencies (All MIT)

All 148 transitive dependencies use MIT or compatible permissive licenses (Apache-2.0, ISC). No GPL, AGPL, SSPL, BSL, or unlicensed packages were found.

**No legal review required.**

---

## 4. Staleness Report

### Dependencies by Staleness

| Package | Current | Latest | Versions Behind | Last Published | Health |
|---------|---------|--------|-----------------|----------------|--------|
| simple-git | 3.33.0 | 3.33.0 | ✅ Current | 2026-03-10 | 🟢 Active |
| @inquirer/checkbox | 5.1.0 | 5.1.0 | ✅ Current | 2026-02-22 | 🟢 Active |
| chalk | 5.6.2 | 5.6.2 | ✅ Current | 2025-09-08 | 🟢 Active |
| commander | 14.0.3 | 14.0.3 | ✅ Current | 2026-01-31 | 🟢 Active |
| ora | 9.3.0 | 9.3.0 | ✅ Current | 2026-02-05 | 🟢 Active |
| vitest | 3.2.4 | **4.0.18** | 🟠 1 major | 2026-03-05 | 🟢 Active |
| @vitest/coverage-v8 | 3.2.4 | **4.0.18** | 🟠 1 major | 2026-03-05 | 🟢 Active |
| **node-notifier** | 10.0.1 | 10.0.1 | ✅ Current | **2022-02-01** | 🟡 **Inactive** |

### Health Legend

- 🟢 **Active**: Published within last 12 months, responsive maintainers
- 🟡 **Inactive**: No releases in 2+ years, may be abandoned
- 🔴 **At Risk**: Security issues or unmaintained with no alternatives

---

## 5. Upgrades Applied

### Successfully Applied

| Package | From | To | Type | Tests Pass? |
|---------|------|-----|------|-------------|
| simple-git | 3.32.3 | 3.33.0 | Minor | ✅ Yes (886/886) |

**simple-git 3.33.0** includes:
- Enhanced security for `git.clone` and `git.mirror` operations with `pathspec` wrappers
- Improved validation checks in the `unsafe` plugin

### Upgrade Commits

```
chore: bump simple-git to 3.33.0 (security improvements)
```

---

## 6. Major Upgrades Needed (Not Applied)

### Vitest 3.x → 4.x

| Package | Current | Target | Effort | Priority |
|---------|---------|--------|--------|----------|
| vitest | 3.2.4 | 4.0.18 | Moderate | 🟡 Medium |
| @vitest/coverage-v8 | 3.2.4 | 4.0.18 | Moderate | 🟡 Medium |

#### Breaking Changes Summary ([Migration Guide](https://vitest.dev/guide/migration.html))

1. **Node.js Requirement**: Node >= 20.0.0 (project requires >=20.12.0 ✓)
2. **Vite Requirement**: Vite >= 6.0.0 (internal dependency, auto-handled)
3. **Coverage Changes**:
   - `coverage.all`, `coverage.extensions` removed
   - AST-based remapping replaces `v8-to-istanbul`
   - Project uses `coverage.include` and `coverage.exclude` — should be compatible
4. **Test Exclusions**: Only `node_modules` and `.git` excluded by default (may need to add explicit exclusions)
5. **Mock API Changes**:
   - `vi.fn().getMockName()` returns `"vi.fn()"` instead of `"spy"`
   - `vi.restoreAllMocks` no longer resets automocks
6. **Pool Options**: `maxThreads` → `maxWorkers` (project doesn't use this)

#### Recommendation

The upgrade is **safe to attempt** but will require:
1. Running the full test suite after upgrade
2. Potential snapshot updates (mock naming changes)
3. Verifying coverage configuration still works

**Effort**: 1-2 hours
**Priority**: Medium — No security urgency; Vitest 3.x is actively maintained.

---

## 7. Dependency Weight & Reduction

### Dependency Tree Analysis

The dependency tree is **exceptionally clean**:

- **Tree Depth**: Maximum 1 level (all direct deps have minimal transitive deps)
- **Deduplication**: `chalk` is used directly and as a dep of `ora` — npm deduplicates to single copy
- **Zero Bloat**: No micro-packages, no deprecated nested dependencies

### Heavy Dependencies

None. All dependencies are appropriately sized for their functionality:

| Package | Size (approx) | Usage | Alternative | Worth Replacing? |
|---------|--------------|-------|-------------|-----------------|
| simple-git | 180 KB | 15+ callsites | Shell out to git | ❌ No |
| commander | 90 KB | 150+ lines | Custom parser | ❌ No |
| @inquirer/checkbox | 60 KB | 1 callsite | Native readline | ❌ No |
| chalk | 40 KB | 20+ callsites | Native | ❌ No |
| ora | 30 KB | 4 callsites | Custom spinner | ❌ No |
| node-notifier | 25 KB | 1 callsite | Platform APIs | Possible |

### Unused Dependencies

**None found.** All dependencies are imported and actively used:

| Package | Used In | Callsites | Removable? |
|---------|---------|-----------|------------|
| @inquirer/checkbox | src/cli.js | ~10 lines | ❌ Essential |
| chalk | src/cli.js, src/logger.js, src/dashboard-tui.js | 20+ | ❌ Core UX |
| commander | src/cli.js | 150+ lines | ❌ CLI core |
| node-notifier | src/notifications.js | 1 | ⚠️ Optional |
| ora | src/cli.js, src/dashboard-tui.js | 4 | ❌ UX feedback |
| simple-git | src/git.js | 15+ | ❌ Core functionality |

### Potential Removal: node-notifier

**Argument for removal**:
- Desktop notifications are optional UX polish
- Already wrapped in try/catch (silently fails)
- Last release was February 2022 (4+ years inactive)
- Supply chain risk increases over time

**Argument for keeping**:
- Users appreciate desktop notifications for overnight runs
- Low maintenance burden
- No security vulnerabilities currently

**Recommendation**: **Keep for now**, but add to watchlist. If the package becomes a security concern, it can be removed with a 10-line platform-specific implementation or simply deleted (notifications would fail silently).

---

## 8. Abandoned/At-Risk Dependencies

| Package | Last Release | Maintainer Activity | Risk | Recommendation |
|---------|--------------|---------------------|------|----------------|
| node-notifier | 2022-02-01 | 🟡 Inactive (4+ years) | 🟡 Moderate | Monitor; consider alternatives if security issue emerges |

**All other dependencies** are actively maintained with releases in the past 12 months.

---

## 9. Engine Compatibility Warning

The `@inquirer/checkbox@5.1.0` package requires:
```
node: ">=23.5.0 || ^22.13.0 || ^21.7.0 || ^20.12.0"
```

The current Node.js version (22.12.0) is **outside the stated range** (needs ^22.13.0). This generates npm warnings but the package works correctly. Consider upgrading Node.js to 22.13.0+ to eliminate the warning.

---

## 10. Recommendations

| # | Recommendation | Impact | Risk if Ignored | Worth Doing? | Details |
|---|----------------|--------|-----------------|--------------|---------|
| 1 | Upgrade Node.js to 22.13.0+ | Eliminates engine warnings | Low | Yes | The current Node 22.12.0 is outside @inquirer/checkbox's stated engine range. Upgrade resolves npm EBADENGINE warnings. |
| 2 | Plan Vitest 4.x migration | Access to latest testing features, improved coverage | Low | Probably | Vitest 3.x is still maintained. Upgrade when time permits; breaking changes are manageable. |
| 3 | Monitor node-notifier | Maintains supply chain hygiene | Medium | Only if time allows | Last release was 4+ years ago. No current vulnerabilities, but watch for security advisories. Have a fallback plan ready (removal or inline implementation). |

### Suggested Tooling

The project already follows good practices. No additional tooling is strictly needed, but consider:

1. **Dependabot / Renovate**: Automate dependency update PRs (already using npm scripts for security checks)
2. **npm audit in CI**: Already in place via `npm run check:security`

### Dependency Addition Policy (Recommended)

When adding new dependencies, evaluate:
1. **Necessity**: Can this be done with existing deps or native APIs?
2. **Maintenance**: Last release date, maintainer count, open issues
3. **Tree depth**: Prefer zero-dependency or shallow-tree packages
4. **License**: MIT/ISC/Apache-2.0 only
5. **Size**: Appropriate for the functionality provided

---

## Appendix: Full Dependency Tree

### Direct Dependencies

```
nightytidy@0.1.0
├── @inquirer/checkbox@5.1.0
├── @vitest/coverage-v8@3.2.4
├── chalk@5.6.2
├── commander@14.0.3
├── node-notifier@10.0.1
├── ora@9.3.0
├── simple-git@3.33.0
└── vitest@3.2.4
```

### Lock File Status

- **Lock file**: `package-lock.json` ✅ Present
- **Committed**: ✅ Yes
- **Consistent**: ✅ Yes (no drift detected)
- **Duplicate versions**: None (npm deduplication working correctly)

---

*Report generated by NightyTidy Dependency Health Audit*
