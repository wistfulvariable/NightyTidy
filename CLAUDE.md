# NightyTidy — AI Codebase Guide

Automated overnight codebase improvement through Claude Code. NightyTidy is an orchestration layer — it sequences 28 AI-driven improvement prompts against a target codebase, handling git branching, retries, notifications, and reporting. Claude Code (spawned as a subprocess) does the actual code changes. Targets vibe coders at small companies.

## Workflow Rules

- **Never edit `src/prompts/steps.js` manually** — auto-generated from external `extracted-prompts.json`
- **Logger must be initialized first** — `initLogger(projectDir)` before any other module
- **All steps run on a dedicated branch** — `nightytidy/run-*` branches with pre-run safety tag
- **No bare `console.log`** in production code — use logger (exception: `cli.js` terminal UX output)
- **No TypeScript, no build step** — plain JavaScript ESM, runs directly
- **Tests must pass before merging** — `npm test` (all must be green)
- **Coverage thresholds enforced** — `npm run test:ci` fails if statements < 90%, branches < 80%, functions < 80%
- **Documentation freshness enforced** — `npm run check:docs` verifies test counts, module map, and memory file index match code

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | Node.js (ESM) | >=18 LTS |
| CLI Framework | Commander | v12 |
| Interactive UI | @inquirer/checkbox | v5 |
| Terminal UX | ora (spinners), chalk (colors) | v8, v5 |
| Git | simple-git | v3 |
| AI Engine | Claude Code CLI (subprocess) | latest |
| Notifications | node-notifier | v10 |
| Testing | Vitest | v2 |

## Project Structure

```
bin/
  nightytidy.js            # Entry point — imports and calls run()
src/
  cli.js                   # Full lifecycle orchestration (welcome → checks → select → execute → report → merge)
  executor.js              # Core step loop — runs prompts sequentially, handles failures
  claude.js                # Claude Code subprocess wrapper (spawn, retry, timeout, session continue)
  git.js                   # Git operations — branches, tags, commits, merges
  checks.js                # Pre-run validation (git, Claude CLI, disk space)
  notifications.js         # Desktop notifications (silent on failure)
  dashboard.js             # Progress file writer + TUI window spawner + HTTP server (~230 LOC)
  dashboard-html.js        # Dashboard HTML template with CSS + JS (~410 LOC, used by dashboard.js)
  dashboard-tui.js         # Standalone TUI progress display (spawned in separate terminal window)
  lock.js                  # Atomic lock file to prevent concurrent runs (~65 LOC)
  logger.js                # File + stdout logger with chalk coloring (~50 LOC)
  report.js                # NIGHTYTIDY-REPORT.md generation + CLAUDE.md update
  setup.js                 # --setup command: generates CLAUDE.md integration snippet for target projects
  prompts/
    steps.js               # 28 improvement prompts + DOC_UPDATE_PROMPT + CHANGELOG_PROMPT (5400+ lines, auto-generated)
test/
  smoke.test.js            # 6 tests — structural integrity, module imports, deploy verification
  cli.test.js              # 27 tests — full lifecycle orchestration, SIGINT handling, --setup, dashboard
  dashboard.test.js        # 15 tests — HTTP server start/stop, SSE events, CSRF, stop callback
  logger.test.js           # 10 tests — real file I/O, level filtering, stderr fallback
  checks.test.js           # 4 tests — mock subprocess, mock git
  checks-extended.test.js  # 13 tests — auth paths, disk space, branch warnings, empty repo
  claude.test.js           # 21 tests — fake child process, fake timers, abort signal, Windows shell mode
  executor.test.js         # 9 tests — mocks claude, git, notifications, signal propagation
  git.test.js              # 16 tests — real git against temp dirs (integration)
  git-extended.test.js     # 7 tests — getGitInstance, getHeadHash, tag/branch collision
  notifications.test.js    # 2 tests — mock node-notifier
  report.test.js           # 7 tests — mock fs, verify report format
  report-extended.test.js  # 15 tests — updateClaudeMd, formatDuration edge cases
  steps.test.js            # 6 tests — structural integrity of prompt data
  integration.test.js      # 5 tests — multi-module integration with real git repos
  setup.test.js            # 7 tests — integration snippet generation, idempotent setup
  dashboard-tui.test.js    # 18 tests — formatMs, progressBar, render with chalk proxy mock
  cli-extended.test.js     # 20 tests — --list, --steps, --setup, locks, callbacks, dashboard state
  dashboard-extended.test.js # 3 tests — scheduleShutdown timer behavior
  integration-extended.test.js # 6 tests — setup + executor + git cross-module integration
  contracts.test.js        # 31 tests — module API contract verification against CLAUDE.md
  helpers/
    cleanup.js             # Shared temp directory cleanup with EBUSY retry for Windows
    mocks.js               # Shared mock factories: createMockProcess, createErrorProcess, createMockGit
    testdata.js            # Shared test data factories: makeMetadata, makeResults
scripts/
  check-docs-freshness.js  # CI check: verifies doc counts match code reality
  run-flaky-check.js       # Runs test suite N times (default 3) to detect flaky tests
vitest.config.js           # Coverage thresholds + strip-shebang Vite plugin (Windows CRLF fix)
00_README.md .. 14_*.md    # PRD decomposition docs (reference only — not loaded by AI)
```

## Module Map

| File | Responsibility | Dependencies |
|------|---------------|-------------|
| `bin/nightytidy.js` | Entry point — calls `run()` | cli |
| `src/cli.js` | Commander + Inquirer + full lifecycle | all modules |
| `src/executor.js` | Core step loop — sequential execution, prompt integrity check | crypto, claude, git, notifications, prompts |
| `src/claude.js` | Claude Code subprocess (spawn, retry, timeout, session continue) | logger |
| `src/git.js` | Git operations via simple-git | logger |
| `src/checks.js` | Pre-run validation (6 checks) | logger |
| `src/notifications.js` | Desktop notifications | logger |
| `src/dashboard.js` | Progress file + TUI window spawner + HTTP server (CSRF, security headers) | crypto, logger, dashboard-html |
| `src/dashboard-html.js` | Dashboard HTML template (CSS + client-side JS) | none (data only) |
| `src/dashboard-tui.js` | Standalone TUI progress display (reads progress JSON, renders with chalk) | chalk (standalone script) |
| `src/lock.js` | Atomic lock file — prevents concurrent runs | logger |
| `src/logger.js` | File + stdout logger (universal dep) | none |
| `src/report.js` | Report generation + CLAUDE.md update + `getVersion()` | logger |
| `src/setup.js` | `--setup` command: CLAUDE.md integration for target projects | logger, prompts/steps |
| `src/prompts/steps.js` | 28 prompts + doc update + changelog | none (data only) |

## Build & Run Commands

```bash
npm install               # Install dependencies
npx nightytidy            # Run (interactive step selection)
npx nightytidy --all      # Run all 28 steps (non-interactive)
npx nightytidy --steps 1,5,12  # Run specific steps by number
npx nightytidy --list     # List all available steps
npx nightytidy --timeout 60  # Set per-step timeout to 60 minutes (default: 45)
npx nightytidy --setup    # Add Claude Code integration to target project's CLAUDE.md
npm test                  # Vitest — single pass
npm run test:watch        # Vitest — watch mode
npm run test:ci           # Vitest with coverage + threshold enforcement
npm run test:flaky        # Run suite 3x to detect flaky tests (use before merge)
npm run check:docs        # Documentation freshness checker (catches doc drift)
npm run check:security    # npm audit — fails on high+ severity vulnerabilities
# No build step — plain JavaScript ESM
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NIGHTYTIDY_LOG_LEVEL` | `info` | Log verbosity: `debug`, `info`, `warn`, `error` |

No secrets or API keys — Claude Code handles its own authentication.

## Conventions

- **ESM only** — `import`/`export`, never `require`. `"type": "module"` in package.json
- **async/await everywhere** — no raw `.then()` chains or callback patterns
- **Logger for all output** — `info()`, `warn()`, `error()`, `debug()` from `./logger.js`
- **Error handling per module** — see strategy table below; never change a module's error contract
- **Singleton state** — `logger.js` and `git.js` use module-level mutable state, initialized once per run
- **Naming**: files are `kebab-case.js`, functions are `camelCase`, constants are `UPPER_SNAKE`
- **Minimal config** — `vitest.config.js` has coverage thresholds + strip-shebang plugin; no `.eslintrc`, no `.prettierrc`
- **Imports**: Node builtins first, then npm packages, then local modules
- **Functions**: export only public API; keep helpers as unexported module-level functions
- **Git commit messages**: prefixed with `NightyTidy:` for all automated commits
- **Error message style**: specific, actionable, blame-free. Follow patterns in `docs/ERROR_MESSAGES.md`

## Init Sequence (Order Matters)

```
1. initLogger(projectDir)        ← MUST be first — everything logs
2. acquireLock(projectDir)       ← Prevents concurrent runs (atomic O_EXCL lock file)
3. initGit(projectDir)           ← Returns git instance + stores projectRoot
4. excludeEphemeralFiles()       ← Adds log/progress/url files to .git/info/exclude
5. runPreChecks(projectDir, git) ← Validates environment before any work
6. Interactive step selection    ← After checks pass
7. Git setup (tag + branch)     ← After user confirms steps
8. executeSteps(...)            ← Main work
9. generateReport(...)          ← After execution completes
```

Calling any module before `initLogger()` throws. Calling git operations before `initGit()` gives null reference errors.

## Generated Files (in target project)

NightyTidy creates these files/artifacts in the project it runs against:

| Artifact | Purpose | Committed? |
|----------|---------|------------|
| `nightytidy-run.log` | Full run log (timestamped) | No |
| `nightytidy-progress.json` | Live progress state (read by TUI window) | No (deleted on stop) |
| `nightytidy-dashboard.url` | Dashboard URL — Claude reads this and shares with user | No (deleted on stop) |
| `NIGHTYTIDY-REPORT.md` | Run summary with step results | Yes (on run branch) |
| `CLAUDE.md` (appended section) | "NightyTidy — Last Run" with undo tag | Yes (on run branch) |
| `nightytidy.lock` | Prevents concurrent runs (PID + timestamp) | No (auto-removed on exit) |
| `nightytidy-before-*` git tag | Safety snapshot before run | Yes (tag) |
| `nightytidy/run-*` git branch | All changes from this run | Yes (branch) |

## What NOT to Do

- **Don't add `require()`** — ESM only, no CommonJS
- **Don't throw from `claude.js` or `executor.js`** — they must return result objects
- **Don't change `steps.js` shape** — 28 steps with `{ number, name, prompt }` validated by tests
- **Don't remove the logger mock** from any test — it will crash trying to write log files
- **Don't make notifications blocking** — they must be fire-and-forget
- **Don't make the dashboard blocking** — it must be fire-and-forget like notifications
- **Don't use raw `child_process.exec`** — use `spawn` for streaming stdout and timeout control
- **Don't commit `nightytidy-run.log`** — it's per-run ephemeral output
- **Don't use raw `rm()` in tests** — use `robustCleanup()` from `test/helpers/cleanup.js` for temp directory cleanup (prevents EBUSY flakiness on Windows)

## Security

- **Dashboard CSRF**: POST `/stop` requires a CSRF token (generated per session via `crypto.randomBytes`). Token is embedded in served HTML and verified server-side. Tests in `dashboard.test.js`.
- **Dashboard security headers**: HTML responses include CSP, X-Frame-Options, X-Content-Type-Options.
- **Lock file is atomic**: `acquireLock()` uses `fs.openSync(path, 'wx')` (O_EXCL) to prevent TOCTOU races between concurrent processes.
- **Prompt integrity check**: `executor.js` computes SHA-256 of all step prompts and compares against `STEPS_HASH`. If prompts are regenerated from `extracted-prompts.json`, update the hash in `executor.js`. Warns but does not block (user may have legitimate prompt changes).
- **`--dangerously-skip-permissions`**: Required for non-interactive Claude Code subprocess calls. NightyTidy is the permission layer — it controls what prompts are sent and operates on a safety branch.
- **Prompt delivery threshold**: Prompts longer than 8000 chars (`STDIN_THRESHOLD` in `claude.js`) are piped via stdin instead of passed as a `-p` argument. This avoids OS command-line length limits. If prompts fail with argument-too-long errors, check this threshold.
- **`npm run check:security`**: Runs `npm audit --audit-level=high`. Use before releases.

## Architectural Rules

### Error Handling Strategy

**Critical — do not change a module's error contract without updating all callers.**

| Module | Contract |
|--------|----------|
| `checks.js` | **Throws** with user-friendly messages → caught by cli.js |
| `lock.js` | **Throws** with user-friendly messages → caught by cli.js |
| `claude.js` | **Never throws** → returns `{ success, output, error, exitCode, duration, attempts }` |
| `executor.js` | **Never throws** → failed steps recorded, run continues |
| `git.js` `mergeRunBranch` | **Never throws** → returns `{ success: false, conflict: true }` on conflict |
| `notifications.js` | **Swallows all errors** silently (try/catch in `notify()`) |
| `dashboard.js` | **Swallows all errors** silently — dashboard failure must not crash a run |
| `report.js` | **Warns but never throws** (report failure must not crash a run) |
| `setup.js` | **Writes to filesystem** → returns `'created'`/`'appended'`/`'updated'` |
| `cli.js` `run()` | **Top-level try/catch** catches everything |

### Module Dependency Graph

```
bin/nightytidy.js
  └── src/cli.js
        ├── src/logger.js            (no deps — universal dependency)
        ├── src/checks.js            → logger
        ├── src/git.js               → logger
        ├── src/claude.js            → logger
        ├── src/executor.js          → crypto, claude, git, notifications, logger, prompts/steps
        ├── src/prompts/steps.js     (no deps — data only)
        ├── src/lock.js              → logger
        ├── src/notifications.js     → logger
        ├── src/dashboard.js         → crypto, logger, child_process, dashboard-html
        │     └── src/dashboard-html.js  (no deps — HTML template only)
        ├── src/dashboard-tui.js     (standalone — chalk only, spawned by dashboard.js)
        ├── src/setup.js             → logger, prompts/steps
        └── src/report.js            → logger  (cli.js imports formatDuration + getVersion)
```

`logger.js` is the single universal dependency — every module imports it.

## Core Workflow

1. **Init**: Logger initialized, welcome screen shown
2. **Pre-checks**: git installed → git repo → has commits → Claude CLI installed → Claude authenticated → disk space
3. **Step selection**: `--all` runs everything; `--steps 1,5,12` picks by number; non-TTY requires `--all` or `--steps` (exits with error otherwise); interactive checkbox otherwise
4. **Git setup**: Save branch → safety tag → run branch
5. **Execution**: Run each step (improvement + doc update in same session via `--continue`), with fallback commits
6. **Abort handling**: SIGINT generates partial report; second SIGINT force-exits
7. **Reporting**: Changelog → NIGHTYTIDY-REPORT.md → commit → merge back to original branch
8. **Notifications**: Desktop notifications at start, on step failure, and on completion

## Testing

- **Framework**: Vitest v2, `vitest.config.js` for coverage thresholds + strip-shebang plugin
- **Tests** across 21 files — `npm test` to run, `npm run test:ci` for coverage enforcement
- **Coverage thresholds**: 90% statements, 80% branches, 80% functions — enforced by `test:ci`
- **Philosophy**: Mock Claude Code subprocess, use real git against temp directories. Test failure paths harder than success paths
- **Universal mock**: All test files mock `../src/logger.js` to prevent file I/O during tests (exception: `logger.test.js` tests the real logger)
- **Integration tests**: `git.test.js`, `git-extended.test.js`, `integration.test.js` use real temp git repos — run slower but catch real issues
- **Smoke tests**: `smoke.test.js` — 6 fast structural checks for deploy verification (< 3s)
- **Contract tests**: `contracts.test.js` — 31 tests verifying each module's error handling contract matches this document
- **Temp dir cleanup**: Always use `robustCleanup()` from `test/helpers/cleanup.js` instead of raw `rm()` — Windows EBUSY from git file handles causes flaky failures otherwise
- **Shared test factories**: Use `test/helpers/mocks.js` for mock process/git factories and `test/helpers/testdata.js` for report test data — don't duplicate these in individual test files
- See `.claude/memory/testing.md` for detailed mock patterns and pitfalls

## Known Technical Debt

- No `.nightytidyrc` config file — only `NIGHTYTIDY_LOG_LEVEL` env var exists
- `extracted-prompts.json` not committed — `steps.js` was generated externally

## Documentation Hierarchy

When you learn something worth preserving, put it in the right place:

| Layer | Loaded | What goes here |
|-------|--------|---------------|
| **CLAUDE.md** (this file) | Every conversation | Rules/constraints preventing mistakes on ANY task |
| **MEMORY.md** | Every conversation | Cross-cutting patterns and pitfalls learned across sessions |
| **Sub-memory files** (`.claude/memory/`) | On demand, by topic | Feature-specific deep dives — see table below |
| **PRD docs** (`00_README.md`..`14_*.md`) | Never auto-loaded | Human-facing reference, design rationale |
| **Inline code comments** | When code is read | Non-obvious "why" explanations |

**Rule**: Prevents mistakes on unrelated tasks → CLAUDE.md. Spans features → MEMORY.md. One feature only → sub-memory. Single line → inline comment.

**Updating docs**: When you change code that affects a CLAUDE.md rule, update it. When you change a feature covered by a sub-memory file, update that file.

### Sub-Memory Files — Load When Working On

| File | When to load |
|------|-------------|
| `testing.md` | Writing or fixing tests |
| `prompts.md` | Modifying or adding improvement prompts |
| `git-workflow.md` | Changing branching, tagging, or merge logic |
| `cli-lifecycle.md` | Modifying the CLI run() orchestration |
| `claude-integration.md` | Changing Claude Code subprocess handling |
| `executor-loop.md` | Modifying step execution or doc-update flow |
| `dashboard.md` | Changing progress display (HTTP, TUI, SSE) |
| `report-generation.md` | Changing report format or CLAUDE.md auto-update |
| `pitfalls.md` | Debugging platform-specific or subprocess issues |
