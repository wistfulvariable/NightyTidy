# Codebase Cleanup Report 02 — 2026-03-05

## 1. Summary

| Metric | Value |
|--------|-------|
| Files modified | 5 |
| Lines added | 24 |
| Lines removed | 21 |
| Net line change | +3 |
| Unused dependencies removed | 0 |
| Commits made | 5 |
| Tests affected | 0 (all 248 pass) |

## 2. Dead Code Removed

### Unused Imports

| File | Import | Confidence | Action |
|------|--------|------------|--------|
| `src/cli.js` | `existsSync` from `fs` | High — grep confirms zero usage in file | Removed |
| `src/setup.js` | `warn` from `./logger.js` | High — grep confirms zero usage in file | Removed |

### Unused Exports

| File | Export | Confidence | Action |
|------|--------|------------|--------|
| `src/executor.js` | `verifyStepsIntegrity()` | High — only called internally at line 50, never imported elsewhere | Changed to non-exported function |

### No Dead Code Found In

- **Unused dependencies**: All 6 dependencies (`@inquirer/checkbox`, `chalk`, `commander`, `node-notifier`, `ora`, `simple-git`) are imported and used. Both devDependencies (`vitest`, `@vitest/coverage-v8`) are used.
- **Unreachable code**: No code after return/throw, no permanently false conditionals found.
- **Commented-out code blocks**: None found in any source files.
- **Orphaned files**: All `src/*.js` files are imported by at least one other module. All `test/*.test.js` files are discovered by Vitest. Scripts in `scripts/` are referenced by `package.json` scripts.

## 3. Duplication Reduced

### Documented But Not Changed

| Duplication | Files | Risk | Decision |
|-------------|-------|------|----------|
| `cleanEnv()` function — identical 4-line function | `src/claude.js:14`, `src/checks.js:11` | Low | **Not consolidated** — creating a shared utility module for a 4-line function conflicts with the project's anti-abstraction principle. Both files are leaf modules that don't import each other. The duplication is stable (hasn't diverged) and trivial. |
| `formatMs()` vs `formatDuration()` — similar time formatting | `src/dashboard-tui.js:33`, `src/report.js:18` | Low | **Not consolidated** — slightly different output (formatMs: `45s`; formatDuration: `0m 45s`). Lives in very different contexts (standalone TUI vs report generation). |
| Ephemeral filename strings | `src/git.js:6`, `src/dashboard.js:10-11`, `src/logger.js:11` | Low | **Not consolidated** — would require a new shared constants module. The filenames are stable and unlikely to change. |
| Logger mock in 16 test files | All test files except `logger.test.js`, `smoke.test.js`, `steps.test.js`, `contracts.test.js`, `dashboard-tui.test.js` | Medium | **Not consolidated** — `vi.mock()` calls must be at module level (Vitest hoisting). Cannot be easily factored into a shared helper without restructuring the mock system. |

### Logger Mock Property Ordering Inconsistency

The 16 test files that mock the logger use three different property orderings:
- `info, debug, warn, error` (ascending severity) — 3 files
- `info, warn, error, debug` — 5 files
- `info, warn, debug, error` — 5 files
- `initLogger, info, warn, error, debug` — 3 files

Functionally irrelevant but cosmetically inconsistent. Not changed — the risk of touching 16 test files outweighs the aesthetic benefit.

## 4. Consistency Changes

### Applied

| File | Issue | Fix |
|------|-------|-----|
| `src/checks.js` | Logger imports ordered `info, warn, debug` — inconsistent with all other modules that use ascending severity `info, debug, warn` | Reordered to `info, debug, warn` |
| `src/cli.js` | Lifecycle comments had duplicate step numbers (two `// 3.`, three `// 4.`, two `// 7.`) | Renumbered sequentially 1–17 |

### Verified as Consistent

- **Naming conventions**: All files are kebab-case. All functions are camelCase. All constants are UPPER_SNAKE. No violations.
- **Import ordering**: All source files follow Node builtins → npm packages → local modules. No violations.
- **Error handling**: All modules follow their documented contracts in CLAUDE.md. `checks.js` throws, `claude.js` returns result objects, `executor.js` never throws, etc.
- **Async patterns**: 100% async/await — zero `.then()` chains or callback patterns in source code.
- **String quotes**: Consistent single quotes throughout all source files.
- **Console.log usage**: Only in `cli.js` (terminal UX, explicitly allowed) and `dashboard-tui.js` (standalone script).

### Noted But Not Changed

| Issue | Location | Rationale |
|-------|----------|-----------|
| `generateReport()` is sync but called with `await` | `src/cli.js:128,418` and 15 test files | Not a bug (awaiting non-Promise resolves immediately). Changing would require updating tests and function signature. Low impact. |

## 5. Configuration & Feature Flags

### Feature Flags

No feature flags found in the codebase. The project has no LaunchDarkly/Flagsmith references, no hardcoded boolean switches, and no conditional compilation flags.

### Configuration Values

| Config | Location | Type | Default | Documented | Issue |
|--------|----------|------|---------|------------|-------|
| `NIGHTYTIDY_LOG_LEVEL` | `logger.js:14` | env var | `info` | Yes (CLAUDE.md) | None |
| `DEFAULT_TIMEOUT` | `claude.js:5` | constant | 45min | Yes (CLAUDE.md) | None |
| `DEFAULT_RETRIES` | `claude.js:6` | constant | 3 | Yes (CLAUDE.md) | None |
| `RETRY_DELAY` | `claude.js:7` | constant | 10s | Yes (CLAUDE.md) | None |
| `STDIN_THRESHOLD` | `claude.js:8` | constant | 8000 chars | No | Undocumented threshold for stdin vs -p flag routing |
| `AUTH_TIMEOUT_MS` | `checks.js:5` | constant | 30s | No | Reasonable default |
| `CRITICAL_DISK_MB` | `checks.js:6` | constant | 100MB | No | Reasonable default |
| `LOW_DISK_MB` | `checks.js:7` | constant | 1024MB | No | Reasonable default |
| `SHUTDOWN_DELAY` | `dashboard.js:9` | constant | 3s | No | Dashboard shutdown grace period |
| `POLL_INTERVAL` | `dashboard-tui.js:12` | constant | 1s | No | TUI refresh rate |
| `EXIT_DELAY` | `dashboard-tui.js:13` | constant | 5s | No | TUI exit grace period |
| `BAR_WIDTH` | `dashboard-tui.js:14` | constant | 30 | No | Progress bar character width |
| `MAX_VISIBLE_STEPS` | `dashboard-tui.js:15` | constant | 16 | No | TUI step list truncation |
| `STEPS_HASH` | `executor.js:11` | constant | SHA-256 | Yes (inline comment) | Integrity verification hash |

### Default Value Concerns

| Config | Default | Concern | Recommendation |
|--------|---------|---------|----------------|
| `TIMEOUT_MESSAGE` (was hardcoded) | "45 minutes" | **Fixed**: Was hardcoded to say "45 minutes" even when user passed `--timeout 60`. Now dynamically uses actual timeout value. | Fixed in this cleanup |

### Flag Coupling Map

N/A — no feature flags exist in the codebase.

### TODO/FIXME/HACK Inventory

**No TODO, FIXME, HACK, XXX, or TEMP comments found** in any source file, test file, or script. The only occurrences are inside `src/prompts/steps.js` which is prompt text data (instructions for Claude Code to follow when running against target codebases) — not actionable code comments.

## 6. Couldn't Touch

| Item | Reason |
|------|--------|
| `cleanEnv()` duplication | Both `claude.js` and `checks.js` are leaf modules. Creating a shared utility for 4 lines adds a file and a dependency edge that doesn't exist today. Violates anti-abstraction principle. |
| Logger mock duplication across 16 test files | Vitest `vi.mock()` requires module-level hoisted calls. Cannot be dynamically shared via import without significant restructuring. |
| `generateReport()` sync vs async inconsistency | Changing to `async` or removing `await` from callers touches 15+ test files. Functionally harmless as-is. |
| `npm audit` moderate vulnerabilities (6) | All in devDependencies (esbuild/vite chain). Fix requires `vitest@4.x` breaking change. Not a production concern. |

## 7. Recommendations

| # | Recommendation | Impact | Risk if Ignored | Worth Doing? | Details |
|---|---|---|---|---|---|
| 1 | Upgrade Vitest to v4 | Resolves 6 moderate npm audit findings | Low — dev-only | Only if time allows | `npm audit fix --force` installs vitest@4.x. May require test adjustments. |
| 2 | Add STDIN_THRESHOLD to CLAUDE.md | Documentation completeness | Low | Probably | The 8000-char threshold for stdin vs `-p` flag routing is undocumented. If someone hits prompt length issues, they won't know why. |
| 3 | Consider extracting a `createLoggerMock()` helper | Reduces test duplication | Low | Only if time allows | A factory function in `test/helpers/mocks.js` that returns the mock object. Callers would still need `vi.mock()` at top level but could reference the shared shape. Reduces 16 copies to 1. |
