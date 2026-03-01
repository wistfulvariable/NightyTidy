# Codebase Cleanup Report — 2026-03-01

## 1. Summary

| Metric | Value |
|--------|-------|
| Total files modified | 13 |
| Lines removed (net) | 66 |
| Unused dependencies removed | 0 |
| Commits made | 5 |
| Tests affected | 0 (all 136 pass before and after) |

Branch: `codebase-cleanup-2026-03-01`

---

## 2. Dead Code Removed

### Unused Imports (3 files)

| File | Import Removed | Confidence |
|------|----------------|------------|
| `src/executor.js` | `debug` from logger.js | 100% — grep confirmed zero usages |
| `src/checks.js` | `error as logError` from logger.js | 100% — grep confirmed zero usages |
| `src/report.js` | `debug` from logger.js | 100% — grep confirmed zero usages |

### Dead Code Block (1 file)

| File | Line | Code Removed | Impact |
|------|------|-------------|--------|
| `src/claude.js` | 94–96 | `const retry = runOnce(prompt, cwd, timeoutMs)` + 2 comment lines | **Bug fix**: This recursive call created a dangling Promise that spawned an orphaned Claude Code subprocess on Windows ENOENT errors. The actual retry was handled by the manual `spawnClaude()` call below it. |

### Items NOT Removed

- **No unused exports** — every exported function is imported by at least one other module
- **No unused dependencies** — all 6 production deps and 2 devDeps are actively imported
- **No orphaned files** — every file is imported or referenced in package.json `bin`
- **No commented-out code** — zero instances found in source or test files

---

## 3. Duplication Reduced

### Implemented (Low-Risk)

| Duplication | Files | Lines Saved | New Shared Module |
|-------------|-------|-------------|-------------------|
| `createMockProcess()`, `createErrorProcess()`, `createTimeoutProcess()`, `createMockGit()` | checks.test.js, checks-extended.test.js | ~50 lines | `test/helpers/mocks.js` |
| `makeMetadata()`, `makeResults()` | report.test.js, report-extended.test.js | ~42 lines | `test/helpers/testdata.js` |

### Documented but Not Implemented (Higher-Risk)

| Duplication | Files | Proposed Approach | Risk |
|-------------|-------|-------------------|------|
| Logger `vi.mock()` boilerplate | 12 test files | Could extract to shared mock factory, but adds indirection for 5-line blocks | Low value, medium churn — not worth it |
| Spawn event listener patterns | checks.js, claude.js | Similar `stdout/stderr` data accumulation, but claude.js has significantly more complexity (timeout, stdin, retry) | Modules serve different purposes; consolidation would couple them |
| Git repo `beforeEach` setup | git.test.js, git-extended.test.js, integration.test.js | Similar `mkdtemp` + `init` + `addConfig` patterns, but each has slightly different needs | Could extract, but setup differences make a shared helper less clean than it appears |

---

## 4. Consistency Changes

### No Changes Required

The codebase is highly consistent across all dimensions checked:

| Dimension | Status | Details |
|-----------|--------|---------|
| **Import ordering** | Consistent | All 8 source files follow: Node builtins → npm packages → local modules |
| **Naming conventions** | Consistent | Files: kebab-case, functions: camelCase, constants: UPPER_SNAKE |
| **Error handling contracts** | Consistent | All 8 modules match their documented contracts in CLAUDE.md |
| **Async patterns** | Consistent | async/await everywhere; Promise constructor only in `runOnce()` for timeout control (intentional) |
| **String quotes** | Minor variance | 3 error messages in checks.js use double quotes to avoid escaping apostrophes ("isn't", "didn't", "doesn't"). Dominant pattern is single quotes. Both patterns are intentional. |

---

## 5. Configuration & Feature Flags

### Feature Flags

**None.** Zero feature flags, toggle switches, or conditional feature enablement in the codebase.

### Configuration Values

| Config | Location | Type | Default | Status |
|--------|----------|------|---------|--------|
| `NIGHTYTIDY_LOG_LEVEL` | `logger.js:14` | Environment variable | `info` | Only config — appropriate, documented |
| `DEFAULT_TIMEOUT` | `claude.js:5` | Private constant | 30 min | Appropriate for Claude subprocess |
| `DEFAULT_RETRIES` | `claude.js:6` | Private constant | 3 | Reasonable retry count |
| `RETRY_DELAY` | `claude.js:7` | Private constant | 10s | Reasonable delay |
| `STDIN_THRESHOLD` | `claude.js:8` | Private constant | 8000 chars | Documented threshold |
| `LEVELS` | `logger.js:5` | Private constant | `{debug:0, info:1, warn:2, error:3}` | Standard log levels |

- **No duplicated config** — each value exists in exactly one location
- **No unused config** — all values are actively used
- **No dangerous defaults** — all defaults are production-appropriate
- **No undocumented config** — all values documented in CLAUDE.md

### TODO/FIXME/HACK Inventory

**None.** Zero TODO, FIXME, HACK, XXX, or TEMP comments in source or test code. The only matches are inside prompt text in `steps.js` (instructions for other codebases, not this one).

---

## 6. Quick Wins Applied

| Fix | File | Details |
|-----|------|---------|
| Welcome box corner typo | `src/cli.js:40` | Bottom-left corner used `╮` (U+256E, top-right) instead of `╰` (U+2570, bottom-left) |
| Missing `.gitignore` entry | `.gitignore` | Added `coverage/` — generated by `npm run test:ci`, was showing as untracked |
| Documentation update | `CLAUDE.md` | Added `test/helpers/mocks.js` and `test/helpers/testdata.js` to project structure |

---

## 7. Couldn't Touch

Nothing. All planned changes were implemented successfully and all 136 tests pass.

---

## 8. Recommendations

| # | Recommendation | Impact | Risk if Ignored | Worth Doing? | Details |
|---|---|---|---|---|---|
| 1 | Remove dangling `runOnce()` call was already done | N/A | N/A | Done | Fixed in this cleanup — was spawning orphaned subprocesses on Windows ENOENT |
| 2 | Consider adding a linter (ESLint) | Catches unused imports automatically, enforces quote style | Low | Only if time allows | The codebase is clean enough that manual discipline has worked. A linter would prevent the 3 unused imports from recurring, but adds maintenance overhead for a small project. |
| 3 | Consider `.env.example` file | Documents `NIGHTYTIDY_LOG_LEVEL` for new contributors | Low | Only if time allows | Only one env var exists. CLAUDE.md already documents it. An `.env.example` is standard practice but marginal value here. |
