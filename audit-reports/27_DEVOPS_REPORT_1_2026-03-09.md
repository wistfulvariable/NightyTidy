# DevOps Audit Report #27

**Project**: NightyTidy v0.1.0
**Date**: 2026-03-09
**Scope**: CI/CD Pipeline, Environment Configuration, Log Quality
**Previous audit**: `DEVOPS_AUDIT_REPORT_01_2026-03-05.md` (created the CI pipeline from scratch)

---

## Executive Summary

The CI pipeline created in audit #1 is solid and functional. This follow-up audit found **3 actionable improvements** and confirmed that the previous audit's work holds up well. The codebase has clean logging discipline, minimal env var surface, and proper secret hygiene. No critical issues found.

**Findings by severity**:
- Critical: 0
- Medium: 1 (CI Node.js matrix outdated)
- Low: 3 (no `.node-version` file, `gui/server.js` env var undocumented in CLAUDE.md, CI coverage job redundantly re-installs)
- Info: 5 (architecture observations, no action needed)

---

## Phase 1: CI/CD Pipeline

### Current Pipeline Architecture

```
.github/workflows/ci.yml
  Jobs:
    test       - matrix: [ubuntu, windows] x [Node 20, 22] = 4 combos
    coverage   - ubuntu, Node 22, depends on test
    security   - ubuntu, Node 22, independent
```

### FINDING-01 (Medium): Node.js matrix should include Node 24

The CI matrix tests Node 20 and 22. Node.js 24 entered LTS status. Since `package.json` requires `>=20.12.0`, testing against the newest LTS catches forward-compatibility issues early.

**Previous state**: Node 18 was dropped (commit `2c42670`) because `@inquirer/checkbox` v5 requires `>=20.12.0`. Matrix is [20, 22].

**Recommendation**: Add Node 24 to the matrix. This is a safe addition -- it only adds 2 more CI jobs (ubuntu + windows).

**Status**: Implemented.

### FINDING-02 (Info): npm cache already configured

`actions/setup-node@v4` with `cache: npm` is used in all 3 jobs. This caches the npm download cache (not `node_modules/`), which is the recommended approach. No improvement needed.

### FINDING-03 (Info): Path filters are comprehensive

```yaml
paths-ignore:
  - '**.md'
  - 'PRD/**'
  - 'LICENSE'
  - '.claude/**'
```

Docs-only changes correctly skip the full test suite. This was set up in audit #1.

**Note**: `audit-reports/` changes are also skipped by `'**.md'` since all reports are markdown. Correct behavior.

### FINDING-04 (Info): Job parallelization is optimal

- `test` and `security` run in parallel (no dependency)
- `coverage` depends on `test` (correct -- no point running coverage if tests fail)
- No improvement possible without splitting the test matrix, which would add complexity for marginal gain

### FINDING-05 (Low): Coverage job reinstalls dependencies

The `coverage` job runs `npm ci` again after the `test` job already validated the install. Since `coverage` depends on `test`, a successful `test` run proves `npm ci` works. However, GitHub Actions jobs run on separate runners, so reinstallation is unavoidable. No action needed.

### FINDING-06 (Info): Runner types appropriate

All jobs use `ubuntu-latest` and `windows-latest` (default free-tier runners). Appropriate for a CLI tool with no GPU/ARM requirements.

---

## Phase 2: Environment Configuration

### Variable Inventory (Updated)

| Variable | Used In | Default | Required | Description |
|----------|---------|---------|----------|-------------|
| `NIGHTYTIDY_LOG_LEVEL` | `logger.js` | `info` | No | Log verbosity: debug, info, warn, error. Warns on invalid values. |
| `CLAUDECODE` | `env.js` (deleted from subprocess env) | Set by Claude Code | No | Stripped so Claude subprocess doesn't refuse to start |
| `LOCALAPPDATA` | `gui/server.js` | Set by Windows OS | No | Used to find Chrome installation path |

### FINDING-07 (Info): `env.js` already in CLAUDE.md module map

`src/env.js` exports `cleanEnv()` and is imported by `claude.js` and `checks.js`. Verified it is correctly listed in the CLAUDE.md module map, project structure, and dependency graph. No action needed.

### FINDING-08 (Low): `LOCALAPPDATA` env var not documented

`gui/server.js:289` uses `process.env.LOCALAPPDATA` to find Chrome on Windows. This is a standard Windows environment variable (always set by the OS), not a NightyTidy config variable. No action needed beyond this report noting it.

### Configuration Validation

- `NIGHTYTIDY_LOG_LEVEL`: Validated in `initLogger()` with warning on invalid values (implemented in audit #1)
- No `.env.example` file needed: only one optional env var with a sensible default
- No startup validation needed: the single env var is checked lazily at logger init time
- Kill switches: `--timeout`, `--steps`, `--dry-run`, `NIGHTYTIDY_LOG_LEVEL` -- all documented

### FINDING-09 (Low): No `.node-version` or `.nvmrc` file

There is no `.node-version` or `.nvmrc` file in the repo. While `package.json` has `"engines": { "node": ">=20.12.0" }`, a `.node-version` file helps developers auto-switch to the correct Node version with tools like `nvm` or `fnm`.

**Status**: Implemented -- added `.node-version` file with `20`.

---

## Phase 3: Log Quality

### Logger Architecture

```
logger.js
  - Dual output: file (timestamped) + stdout (chalk-colored)
  - Levels: debug(0) < info(1) < warn(2) < error(3)
  - File: nightytidy-run.log (per-run, truncated on init)
  - Quiet mode: file-only (no stdout) for orchestrator JSON output
  - Throws if used before initLogger()
```

### Log Level Consistency Audit

| Module | info | warn | error | debug | Assessment |
|--------|------|------|-------|-------|------------|
| `cli.js` | console.log for UX (documented exception) | via logger | via logger | via logger | Correct |
| `claude.js` | 2 | 2 | 1 | 2 | Correct |
| `checks.js` | 8 | 1 | 0 | 2 | Correct |
| `executor.js` | 4 | 2 | 1 | 0 | Correct |
| `git.js` | 5 | 2 | 0 | 1 | Correct |
| `dashboard.js` | 2 | 3 | 0 | 0 | Correct |
| `lock.js` | 0 | 2 | 0 | 1 | Correct |
| `notifications.js` | 0 | 1 | 0 | 1 | Correct |
| `report.js` | 3 | 1 | 0 | 0 | Correct |
| `setup.js` | 3 | 0 | 0 | 0 | Correct |
| `orchestrator.js` | 6 | 3 | 0 | 0 | Correct |
| `env.js` | 0 | 0 | 0 | 0 | N/A (pure function, no logging needed) |

**Assessment**: Log levels are used consistently and correctly across all modules. No misuse found.

### Sensitive Data Assessment

- **No credentials logged**: Claude Code subprocess output is logged at `debug` level only (`claude.js:90`)
- **No PII**: Lock file logs PID and timestamps only
- **Subprocess stderr**: Logged with `warn()` -- could contain warnings from Claude Code, but appropriate for diagnostics
- **`cleanEnv()`**: Properly strips `CLAUDECODE` env var before passing to subprocess. No env vars leaked to logs.

### Empty Catch Blocks Audit

Found 42 `catch {}` blocks across `src/`. All are intentional:

| Category | Count | Justification |
|----------|-------|---------------|
| Fire-and-forget cleanup (unlinkSync, kill, client.end) | 18 | Resource already gone or process already dead |
| Non-critical file writes (progress JSON, URL file) | 8 | Dashboard failure must not crash a run |
| CSRF/JSON parse validation | 4 | Returns error response (not truly empty) |
| Process/retry error handling | 6 | Falls through to retry or returns error object |
| Callback safety (onOutput, onStop) | 3 | Callback failure must not crash subprocess |
| Standalone scripts (dashboard-tui, dashboard-standalone) | 3 | Resilient polling -- retry on next tick |

**Assessment**: All empty catch blocks are documented or self-evident. No hidden swallowed errors.

### Console.log Usage in Source

`cli.js` uses `console.log` (38 calls) for terminal UX output -- documented exception in CLAUDE.md. `dashboard-tui.js` uses `console.error` (1 call) for usage message -- standalone script, acceptable.

`gui/server.js` uses `console.log` (2 calls) for server startup message and Chrome-not-found message. This is a standalone GUI server script, not part of the CLI pipeline, so the logger convention does not apply.

No other source files use raw `console.log`.

### Missing Logging in Critical Operations

All critical operations have adequate logging:
- Subprocess spawn/complete/fail: logged in `claude.js`
- Git branch/tag/merge: logged in `git.js`
- Pre-checks pass/fail: logged in `checks.js`
- Step start/complete/fail: logged in `executor.js`
- Lock acquire/release: logged in `lock.js`
- Dashboard start/stop: logged in `dashboard.js`
- Orchestrator init/step/finish: logged in `orchestrator.js`

No gaps found.

---

## Phase 4: Migrations

Not applicable. NightyTidy has no database.

---

## Summary of Changes Made

| # | Finding | Severity | Action |
|---|---------|----------|--------|
| 01 | Node.js matrix missing Node 24 | Medium | Added Node 24 to CI matrix |
| 09 | No `.node-version` file | Low | Created `.node-version` with `20` |

---

## Recommendations Not Implemented (Out of Scope)

| Recommendation | Reason |
|----------------|--------|
| Add `npm publish` workflow on tag push | Not requested, changes deploy behavior |
| Add branch protection rules | GitHub repo settings, not code change |
| Add CONTRIBUTING.md | Documentation creation not requested |
