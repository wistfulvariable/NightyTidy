# Audit #09 -- Dependency Health Report

**Date**: 2026-03-09
**Auditor**: Claude Opus 4.6 (automated)

---

## Executive Summary

NightyTidy has a lean dependency footprint: 6 runtime dependencies and 2 dev dependencies. All dependencies are MIT-licensed, actively maintained (except node-notifier), and serve distinct purposes with no redundancy. Two major-version upgrades were successfully applied (commander 12->14, ora 8->9). The vitest upgrade (v2->v4) was deferred due to significant breaking changes and moderate risk.

**Changes Made**:
- Upgraded `commander` from v12.1.0 to v14.0.3
- Upgraded `ora` from v8.2.0 to v9.3.0
- No dependencies removed (all are actively used)
- All 416 tests pass after changes

---

## Phase 1: Dependency Inventory

### Runtime Dependencies

| Package | Version (before) | Version (after) | License | Used In | Import Count | Purpose |
|---------|-----------------|-----------------|---------|---------|-------------|---------|
| @inquirer/checkbox | 5.1.0 | 5.1.0 (latest) | MIT | cli.js | 1 source file | Interactive step selection UI |
| chalk | 5.6.2 | 5.6.2 (latest) | MIT | cli.js, logger.js, dashboard-tui.js | 3 source files | Terminal string coloring |
| commander | 12.1.0 | **14.0.3** | MIT | cli.js | 1 source file | CLI argument parsing |
| node-notifier | 10.0.1 | 10.0.1 (latest) | MIT | notifications.js | 1 source file | Desktop notifications |
| ora | 8.2.0 | **9.3.0** | MIT | cli.js | 1 source file | Terminal spinner animations |
| simple-git | 3.32.3 | 3.32.3 (latest) | MIT | git.js | 1 source file | Git operations wrapper |

### Dev Dependencies

| Package | Version (before) | Version (after) | License | Purpose |
|---------|-----------------|-----------------|---------|---------|
| vitest | 2.1.9 | 2.1.9 (unchanged) | MIT | Test runner |
| @vitest/coverage-v8 | 2.1.9 | 2.1.9 (unchanged) | MIT | Coverage reporting |

### Lock File Status

- `package-lock.json` is committed to git and consistent with `package.json`
- Total installed packages: ~147 (after upgrades)
- Total `node_modules` size: ~48 MB

---

## Phase 2: Health Assessment

### npm audit

6 **moderate** severity vulnerabilities found, all in the `esbuild` transitive dependency chain (dev-only):

```
esbuild <=0.24.2 — enables requests to dev server from any website
  -> vite -> @vitest/mocker -> vitest -> @vitest/coverage-v8
```

**Risk Assessment**: Low. These vulnerabilities affect only the development tool chain (vitest), not the production runtime. The fix requires upgrading vitest to v4 (breaking change). The vulnerability only affects local development servers.

### npm outdated (major versions behind)

| Package | Current | Latest | Gap | Decision |
|---------|---------|--------|-----|----------|
| commander | 12.1.0 | 14.0.3 | 2 major | **Upgraded** -- breaking changes are minimal for our usage |
| ora | 8.2.0 | 9.3.0 | 1 major | **Upgraded** -- only breaking change is Node.js 20 requirement (already met) |
| vitest | 2.1.9 | 4.0.18 | 2 major | **Deferred** -- significant breaking changes in coverage, pools, module runner |
| @vitest/coverage-v8 | 2.1.9 | 4.0.18 | 2 major | **Deferred** -- must match vitest version |

### Dependency Health Status

| Package | Last Release | Weekly Downloads | Maintenance Status |
|---------|-------------|-----------------|-------------------|
| @inquirer/checkbox | Active (v5.1.0) | High | Healthy |
| chalk | 2024 (v5.6.2) | Very High | Sustainable |
| commander | Active (v14.0.3) | Very High | Healthy |
| node-notifier | 2022 (v10.0.1) | High | **Inactive** (4 years, no PRs/issues activity) |
| ora | Active (v9.3.0) | High | Healthy |
| simple-git | Active (v3.32.3) | Very High (11M+/week) | Healthy |
| vitest | Active (v4.0.18) | Very High | Healthy |

### Licenses

All dependencies use **MIT** license. No license concerns.

### Dependency Weight

| Package | Disk Size |
|---------|----------|
| node-notifier | 5.5 MB (heaviest -- bundles platform-specific binaries) |
| vitest | 1.8 MB |
| simple-git | 1.2 MB |
| @inquirer/* | 229 KB |
| commander | 219 KB |
| chalk | 70 KB |
| ora | 40 KB |

---

## Phase 3: Upgrade Results

### Successfully Upgraded

#### commander 12.1.0 -> 14.0.3

**Breaking changes assessed:**
- v13: `allowExcessArguments` defaults to false (does not affect us -- we use only options, no positional arguments)
- v13: Throws for unsupported option flags (does not affect us -- standard flags only)
- v14: Requires Node.js >=20 (already our minimum)

**Result**: All 416 tests pass. Zero code changes required.

#### ora 8.2.0 -> 9.3.0

**Breaking changes assessed:**
- v9: Requires Node.js 20 (already our minimum)

**Result**: All 416 tests pass. Zero code changes required.

### Deferred Upgrades

#### vitest 2.1.9 -> 4.0.18 (and @vitest/coverage-v8)

**Why deferred:**
- Two major versions gap with cumulative breaking changes
- v4 removes `coverage.all` (requires config change)
- v4 rewrites pool architecture (removes Tinypool)
- v4 changes module reset behavior between tests
- The vulnerability is moderate severity, dev-only, and only affects local dev servers
- Risk of test suite breakage outweighs the benefit

**Recommended future action**: Plan a dedicated session for vitest v4 migration when the team has bandwidth for potential test adjustments.

---

## Phase 4: Dependency Reduction

### Unused Dependencies

None found. Every declared dependency is imported and actively used in source code.

### Phantom Dependencies

None found. All npm package imports in source code correspond to declared dependencies in `package.json`. Non-package imports are all Node.js builtins (`fs`, `path`, `child_process`, `crypto`, `http`, `os`, `url`, `readline`).

### Replacement Candidates

| Package | Files Using | Could Replace? | Verdict |
|---------|------------|---------------|---------|
| node-notifier | 1 (notifications.js) | Technically yes, but no Node.js builtin for desktop notifications | **Keep** -- unique capability, fire-and-forget pattern isolates maintenance risk |
| ora | 1 (cli.js) | Could write a basic spinner, but ora handles terminal edge cases well | **Keep** -- low weight (40 KB), widely tested |
| chalk | 3 files | Node.js has no builtin ANSI coloring | **Keep** -- foundational UX dependency |

**Conclusion**: No dependencies can be safely removed or replaced.

---

## Recommendations

### Immediate (Done)
1. ~~Upgrade commander to v14~~ -- completed
2. ~~Upgrade ora to v9~~ -- completed

### Short-term
3. **Plan vitest v4 migration** -- schedule a dedicated session to handle coverage config changes, pool architecture, and module reset behavior
4. **Monitor node-notifier** -- inactive for 4 years. If a vulnerability is discovered, consider forking or replacing with a minimal alternative

### Long-term
5. **Watch for commander v15** -- will require Node.js v22.12.0+ and is ESM-only (may affect users on Node.js 20)
6. **Consider @inquirer/checkbox engine warnings** -- v5.1.0 specifies `>=23.5.0 || ^22.13.0 || ^21.7.0 || ^20.12.0` but current dev environment is v22.12.0 (just below ^22.13.0). Functional but technically unsupported engine.

---

## Test Results

```
Test Files:  27 passed (27)
Tests:       416 passed (416)
Duration:    ~10.5s
```

All tests green after all upgrades applied.
