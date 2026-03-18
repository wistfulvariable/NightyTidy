# NightyTidy — AI Codebase Guide

Automated overnight codebase improvement through Claude Code. NightyTidy is an orchestration layer — it sequences 33 AI-driven improvement prompts against a target codebase, handling git branching, retries, notifications, and reporting. Claude Code (spawned as a subprocess) does the actual code changes. Targets vibe coders at small companies.

## Workflow Rules

- **Google Doc is the source of truth for prompts** — prompts auto-sync from the published Google Doc before every run (CLI and orchestrator). Use `--skip-sync` to skip. Manual `npx nightytidy --sync` also available. Manual edits to `src/prompts/steps/*.md` will be overwritten on next sync. `STEPS_HASH` in `executor.js` is auto-updated by sync.
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
| Runtime | Node.js (ESM) | >=20.12.0 |
| CLI Framework | Commander | v14 |
| Interactive UI | @inquirer/checkbox | v5 |
| Terminal UX | ora (spinners), chalk (colors) | v9, v5 |
| Git | simple-git | v3 |
| AI Engine | Claude Code CLI (subprocess) | latest |
| Notifications | node-notifier | v10 |
| GUI Markdown | marked (vendored UMD) | v17 |
| Testing | Vitest | v3 |
| WebSocket | ws | v8 |
| Scheduling | node-cron | v4 |

## Project Structure

```
bin/
  nightytidy.js            # Entry point — imports and calls run()
src/
  cli.js                   # Full lifecycle orchestration (welcome → checks → select → execute → report → merge)
  executor.js              # Core step loop — runs prompts sequentially, handles failures + executeSingleStep
  orchestrator.js          # Claude Code orchestrator mode — initRun, runStep, finishRun + dashboard
  claude.js                # Claude Code subprocess wrapper (spawn, retry, timeout, session continue)
  env.js                   # Shared environment helpers (cleanEnv for CLAUDECODE stripping)
  git.js                   # Git operations — branches, tags, commits, merges
  checks.js                # Pre-run validation (git, Claude CLI, disk space)
  notifications.js         # Desktop notifications (silent on failure)
  dashboard.js             # Progress file writer + TUI window spawner + HTTP server
  dashboard-html.js        # Dashboard HTML template with CSS + JS (used by dashboard.js)
  dashboard-standalone.js  # Standalone dashboard HTTP server for orchestrator mode (detached process)
  dashboard-tui.js         # Standalone TUI progress display (spawned in separate terminal window)
  lock.js                  # Atomic lock file to prevent concurrent runs (async with TTY prompt)
  logger.js                # File + stdout logger with chalk coloring
  report.js                # NIGHTYTIDY-REPORT.md generation + CLAUDE.md update
  consolidation.js         # Post-run action plan — consolidates step recommendations for inline report embedding
  setup.js                 # --setup command: generates CLAUDE.md integration snippet for target projects
  sync.js                  # Google Doc prompt sync — fetches, parses, diffs, updates local prompt files
  agent/
    index.js               # Agent orchestrator — WebSocket command handler, run queue processor, step loop, interrupted run recovery, heartbeat, webhook dispatch
    config.js              # Agent config — reads/writes ~/.nightytidy/config.json (port, token, machine name)
    project-manager.js     # Project registry — add/remove/list projects, track lastRunAt, schedules, webhooks
    run-queue.js           # Persistent run queue — enqueue/dequeue/reorder, mark interrupted, resume tracking
    scheduler.js           # Cron-based run scheduling via node-cron
    cli-bridge.js          # Spawns nightytidy CLI subprocess — --init-run, --run-step, --finish-run, --list --json
    git-integration.js     # Git operations for web app — diff, diffstat, merge, rollback, PR creation, report retrieval
    websocket-server.js    # WebSocket + HTTP server at 127.0.0.1:48372 — auth token handshake, rate limiting, broadcast
    webhook-dispatcher.js  # Sends webhooks to user endpoints + Firebase Cloud Function (Slack/Discord formatting, 3x retry)
    firebase-auth.js       # Firebase JWT token management — parses exp claim, refresh retry with backoff, webhook queue for replay
  prompts/
    manifest.json          # Step ordering + display names + sourceUrl (33 entries)
    loader.js              # Reads manifest + markdown files, exports STEPS/DOC_UPDATE_PROMPT/CHANGELOG_PROMPT
    steps/                 # 33 individual markdown prompt files (01-documentation.md .. 33-strategic-opportunities.md)
    specials/              # Non-step prompts (doc-update.md, changelog.md)
test/
  smoke.test.js            # 6 tests — structural integrity, module imports, deploy verification
  cli.test.js              # 33 tests — full lifecycle orchestration, SIGINT handling, --setup, dashboard, auto-sync
  dashboard.test.js        # 20 tests — HTTP server start/stop, SSE events, CSRF, stop callback
  logger.test.js           # 10 tests — real file I/O, level filtering, stderr fallback
  checks.test.js           # 4 tests — mock subprocess, mock git
  checks-extended.test.js  # 23 tests — auth paths, disk space characterization, branch warnings, empty repo, dirty working tree
  claude.test.js           # 73 tests — fake child process, fake timers, abort signal, Windows shell mode, stream-json NDJSON parsing, classifyError, rate-limit retry skip, stderr capture, inactivity timeout
  executor.test.js         # 51 tests — mocks claude, git, notifications, signal propagation, cost tracking, fast-completion detection, continueSession/promptOverride, rate-limit pause/resume, copyPromptsToProject
  executor-extended.test.js # 13 tests — fallbackCommit error path, waitForRateLimit probe errors, empty steps, hash mismatch
  git.test.js              # 16 tests — real git against temp dirs (integration)
  git-extended.test.js     # 11 tests — getGitInstance, getHeadHash, tag/branch collision, ensureOnBranch recovery
  notifications.test.js    # 2 tests — mock node-notifier
  report.test.js           # 43 tests — mock fs, verify report format, inline actionPlanText, cost column, cleanNarration, junk detection, token summary
  report-extended.test.js  # 19 tests — updateClaudeMd, formatDuration edge cases, cost rendering
  consolidation.test.js    # 15 tests — buildConsolidationPrompt, generateActionPlan, heading downgrade, error handling
  steps.test.js            # 12 tests — structural integrity of prompt data + manifest validation + reloadSteps
  integration.test.js      # 5 tests — multi-module integration with real git repos
  setup.test.js            # 7 tests — integration snippet generation, idempotent setup
  dashboard-tui.test.js    # 29 tests — formatMs, progressBar, render with chalk proxy mock
  cli-extended.test.js     # 31 tests — --list, --steps, --setup, --dry-run, locks, callbacks, progress summary
  cli-resume.test.js       # 23 tests — --resume flag, state save/restore, validation, SIGINT
  cli-sync.test.js         # 6 tests — --sync and --sync-dry-run command flow
  dashboard-extended.test.js # 3 tests — scheduleShutdown timer behavior
  dashboard-extended2.test.js # 4 tests — platform-specific TUI spawn, server failure handling
  integration-extended.test.js # 6 tests — setup + executor + git cross-module integration
  orchestrator.test.js     # 63 tests — initRun, runStep, finishRun (changelog + action plan + token passthrough), dashboard integration with mocked modules, cost tracking, suspiciousFast passthrough, rate-limit errorType propagation, auto-sync, 3-tier step recovery, inter-tier branch guard, init phase progress, failed-step retry + dedup
  contracts.test.js        # 40 tests — module API contract verification against CLAUDE.md
  gui-logic.test.js        # 145 tests — pure logic functions (buildCommand, parseCliOutput, formatMs, formatCost, formatTokens, formatTime, detectGitError, detectStaleState, detectRateLimit, formatCountdown, preprocessClaudeOutput, INIT_PHASES, getInitPhaseIndex, etc.)
  gui-server.test.js       # 47 tests — HTTP server, static files, config, run-command, kill-process, delete-file, heartbeat, log-error, log-path, security headers, traversal, singleton guard
  lock.test.js             # 9 tests — acquireLock, releaseLock, stale lock removal, persistent mode
  lock-extended.test.js    # 6 tests — EEXIST retry, missing started field, invalid date in lock file
  orchestrator-extended.test.js # 11 tests — finishRun error paths, timeout propagation, state version checks
  dashboard-broadcastoutput.test.js # 5 tests — buffer overflow, throttled writes, clearOutputBuffer with state
  env.test.js              # 15 tests — allowlist filtering, prefix matching, CLAUDECODE blocking, debug logging
  sync.test.js             # 67 tests — Google Doc fetch, HTML parsing, section filtering, manifest matching, hash computation, sync orchestration
  checks-timeout.test.js   # 1 test — checks.js timeout handling
  dashboard-error-paths.test.js # 7 tests — dashboard error recovery paths
  lock-edge-cases.test.js  # 6 tests — lock file edge cases (EEXIST, stale, invalid)
  mutation-testing.test.js  # 16 tests — mutation testing across multiple modules
  report-edge-cases.test.js # 10 tests — report generation edge cases
  agent-index.test.js        # 2 tests — startAgent exports and return value
  agent-config.test.js       # 4 tests — config persistence, version migration
  agent-project-manager.test.js # 9 tests — project CRUD, pruning stale entries
  agent-run-queue.test.js    # 9 tests — queue operations, interrupted state, resume
  agent-scheduler.test.js    # 5 tests — cron scheduling, trigger callbacks
  agent-cli-bridge.test.js   # 7 tests — CLI subprocess spawning, output parsing
  agent-websocket-server.test.js # 5 tests — WebSocket auth, rate limiting, broadcast
  agent-webhook-dispatcher.test.js # 6 tests — webhook formatting (Slack/Discord), retry logic
  agent-firebase-auth.test.js # 24 tests — JWT parsing, token expiry, refresh backoff, webhook queue/replay
  fixtures/
    google-doc-sample.html # Representative Google Doc HTML for deterministic sync testing
  helpers/
    cleanup.js             # Shared temp directory cleanup with EBUSY retry for Windows
    mocks.js               # Shared mock factories: createLoggerMock, createMockProcess, createErrorProcess, createMockGit
    testdata.js            # Shared test data factories: makeMetadata, makeResults
gui/
  server.js                  # Node.js HTTP server + Chrome app-mode launcher
  resources/
    index.html               # Single-page app with 5 screen sections
    styles.css               # Dark theme CSS (extracted from dashboard-html.js)
    logic.js                 # Pure functions (buildCommand, parseCliOutput, formatMs, etc.)
    app.js                   # State machine + fetch API calls to server.js endpoints
    marked.umd.js            # Vendored marked v17 UMD build — markdown→HTML for output panels
scripts/
  check-docs-freshness.js  # CI check: verifies doc counts match code reality
  run-flaky-check.js       # Runs test suite N times (default 3) to detect flaky tests
vitest.config.js           # Coverage thresholds + strip-shebang Vite plugin (Windows CRLF fix)
00_README.md .. 14_*.md    # PRD decomposition docs (reference only — not loaded by AI)
.github/
  workflows/
    ci.yml                   # GitHub Actions: test matrix, coverage, docs check, Gitleaks secrets scan, security audit
```

## Module Map

| File | Responsibility | Dependencies |
|------|---------------|-------------|
| `bin/nightytidy.js` | Entry point — calls `run()` | cli |
| `src/cli.js` | Commander + Inquirer + full lifecycle | all modules |
| `src/executor.js` | Core step loop + single-step execution, prompt integrity check, fast-completion detection, rate-limit pause/resume with exponential backoff, `copyPromptsToProject()` syncs all prompts to target repo | crypto, fs, claude, git, notifications, prompts |
| `src/orchestrator.js` | Claude Code orchestrator mode (JSON API for step-by-step runs) + dashboard; exports `readState`/`writeState`/`deleteState`/`STATE_VERSION` for resume support | logger, checks, git, claude, executor, lock, report, notifications, prompts, dashboard-standalone |
| `src/claude.js` | Claude Code subprocess (spawn, retry, timeout, session continue, error classification via `classifyError`/`ERROR_TYPE`, exported `sleep`) | logger, env |
| `src/git.js` | Git operations via simple-git + `ensureOnBranch()` branch guard | logger |
| `src/checks.js` | Pre-run validation (8 checks) | logger, env |
| `src/env.js` | Shared environment helpers (cleanEnv with allowlist filtering) | logger |
| `src/notifications.js` | Desktop notifications | logger |
| `src/dashboard.js` | Progress file + TUI window spawner + HTTP server (CSRF, security headers) | crypto, logger, dashboard-html |
| `src/dashboard-html.js` | Dashboard HTML template (CSS + client-side JS) | none (data only) |
| `src/dashboard-standalone.js` | Standalone dashboard server for orchestrator mode (polls progress JSON, serves HTML+SSE) | dashboard-html (standalone script) |
| `src/dashboard-tui.js` | Standalone TUI progress display (reads progress JSON, renders with chalk) | chalk (standalone script) |
| `src/lock.js` | Atomic lock file — prevents concurrent runs (async, TTY override prompt) | readline, logger |
| `src/logger.js` | File + stdout logger (universal dep) | none |
| `src/report.js` | Report generation + prompt builder + verification + CLAUDE.md update + `getVersion()` | logger |
| `src/consolidation.js` | Post-run action plan — consolidates step outputs into tiered recommendations (returns text for inline embedding) | claude, logger, executor, prompts/loader |
| `src/setup.js` | `--setup` command: CLAUDE.md integration for target projects | logger, prompts/loader |
| `src/sync.js` | Google Doc prompt sync — fetches published doc, parses HTML, updates prompt files + manifest + STEPS_HASH | crypto, logger |
| `src/prompts/loader.js` | Loads 33 prompts + special prompts; `reloadSteps()` for live-reload after sync | fs (data loader) |
| `gui/server.js` | Desktop GUI backend — HTTP server + native folder dialog + Chrome launcher + session logging | node:http, node:fs, node:child_process |
| `gui/resources/logic.js` | GUI pure logic — command building, JSON parsing, formatting, rate-limit detection | none (browser + Node.js dual) |
| `gui/resources/app.js` | GUI state machine — screen transitions, process spawning, progress polling, rate-limit pause/resume overlay | logic.js, marked, server.js (via fetch) |
| `src/agent/index.js` | Agent orchestrator — command handler (30+ commands), run queue processing, step execution loop, interrupted run recovery, heartbeat, `dispatchWithQueue()` Firebase webhook helper. Reads version from package.json. | fs, path, url, logger, config, project-manager, run-queue, scheduler, websocket-server, webhook-dispatcher, cli-bridge, git-integration, firebase-auth |
| `src/agent/config.js` | Agent config persistence — `getConfigDir()` → `~/.nightytidy/`, `readConfig()`/`writeConfig()`, auto-generates port (48372) + auth token on first run, `CONFIG_VERSION` for migrations | fs, path, os, crypto |
| `src/agent/project-manager.js` | Project registry — CRUD for projects stored in `~/.nightytidy/projects.json`, each project has `{ id, path, name, addedAt, lastRunAt, schedule, webhooks }`, `pruneStaleProjects()` removes entries whose paths no longer exist | fs, path, crypto |
| `src/agent/run-queue.js` | Persistent run queue — `~/.nightytidy/queue.json`, `enqueue()`/`dequeue()`/`reorder()`/`cancel()`, `markInterrupted(progress)` saves step state on crash, `getInterrupted()` returns interrupted run for resume/finish/discard, `completeCurrent()`/`clearInterrupted()` | fs, path, crypto |
| `src/agent/scheduler.js` | Cron scheduler — wraps `node-cron`, `addSchedule(projectId, cronExpr)` triggers callback, `removeSchedule()`, `stopAll()`, `isValidCron()` static helper | node-cron |
| `src/agent/cli-bridge.js` | CLI bridge — spawns `npx nightytidy` as subprocess with `--init-run`, `--run-step N`, `--finish-run`, `--list --json`. Streams stdout for live output. `kill()` sends SIGTERM. Parses JSON from stdout/stderr. | child_process, path |
| `src/agent/git-integration.js` | Git integration — `getDiff(base, branch)`, `getDiffStat(base, branch)`, `countFilesChanged(tag, branch)`, `merge(runBranch, targetBranch)`, `rollback(tag)`, `createPr(branch, title, body)` via `gh`, `getReport(branch)` reads NIGHTYTIDY-REPORT from git | child_process |
| `src/agent/websocket-server.js` | WebSocket + HTTP server — binds `127.0.0.1:48372`, token-based auth handshake, `broadcast()` to all clients, rate limit (10 msg/sec per client), HTTP endpoints: `GET /auth-info` (localhost only), `POST /auth-callback` (receives Firebase tokens from web app). CORS headers for nightytidy.com. | http, ws, os, logger |
| `src/agent/webhook-dispatcher.js` | Webhook dispatch — sends events to multiple endpoints via `Promise.allSettled()`, 3 retries with delays [1s, 5s, 15s], auto-formats for Slack (blocks), Discord (embeds), or generic JSON. Fire-and-forget — failures logged but never block runs. | logger |
| `src/agent/firebase-auth.js` | Firebase auth — `parseJwtExpiry()` decodes real token expiry from JWT `exp` claim (no crypto needed), `setToken(token)` auto-parses expiry, `needsRefresh()` with 15-min buffer, `markRefreshRequested()` with exponential backoff retry (30s→60s→120s→4min cap), webhook queue (`queueWebhook()`/`onTokenRefresh()`) replays missed webhooks when fresh token arrives, capped at 200 entries | logger |

## Build & Run Commands

```bash
npm install               # Install dependencies
npx nightytidy            # Run (interactive step selection)
npx nightytidy --all      # Run all 33 steps (non-interactive)
npx nightytidy --steps 1,5,12  # Run specific steps by number
npx nightytidy --list     # List all available steps with descriptions
npx nightytidy --timeout 60  # Set per-step timeout to 60 minutes (default: 45)
npx nightytidy --dry-run  # Run pre-checks + step selection, show plan, exit without running
npx nightytidy --skip-sync  # Skip automatic prompt sync from Google Doc before running
npx nightytidy --skip-dashboard  # Skip standalone dashboard server (GUI passes this automatically)
npx nightytidy --setup    # Add Claude Code integration to target project's CLAUDE.md
npx nightytidy --list --json    # List steps as JSON (for Claude Code orchestrator)
npx nightytidy --init-run --steps 1,5,12  # Initialize orchestrated run (pre-checks, git, state file)
npx nightytidy --run-step 1     # Run a single step in orchestrated mode
npx nightytidy --finish-run     # Finish orchestrated run (report, merge, cleanup)
npx nightytidy --resume      # Resume a previously paused run (usage limit / manual restart)
npx nightytidy --sync           # Sync prompts from the published Google Doc
npx nightytidy --sync-dry-run   # Preview what --sync would change without writing files
npx nightytidy --sync --sync-url <url>  # Sync from a custom Google Doc URL
npx nightytidy agent      # Start the agent (WebSocket server for nightytidy.com web app)
npm run gui               # Launch desktop GUI (Node.js server + Chrome app mode)
npm test                  # Vitest — single pass (all 30 files)
npm run test:fast         # Vitest — excludes slow integration/git tests (~6s vs ~10s)
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
| `NIGHTYTIDY_LOG_LEVEL` | `info` | Log verbosity: `debug`, `info`, `warn`, `error`. Warns on invalid values. |

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
2. await acquireLock(projectDir)  ← Prevents concurrent runs (async — may prompt for override)
3. initGit(projectDir)           ← Returns git instance + stores projectRoot
4. excludeEphemeralFiles()       ← Adds log/progress/url files to .git/info/exclude
5. runPreChecks(projectDir, git) ← Validates environment before any work
6. autoSyncPrompts(opts)        ← Sync prompts from Google Doc + reloadSteps() (non-blocking)
7. Interactive step selection    ← After checks pass (uses fresh STEPS data)
8. Git setup (tag + branch)     ← After user confirms steps
9. copyPromptsToProject()      ← Sync all prompts to audit-reports/refactor-prompts/ + commit
10. executeSteps(...)            ← Main work
11. generateReport(...)          ← After execution completes
```

Calling any module before `initLogger()` throws. Calling git operations before `initGit()` gives null reference errors.

## Generated Files (in target project)

NightyTidy creates these files/artifacts in the project it runs against:

| Artifact | Purpose | Committed? |
|----------|---------|------------|
| `nightytidy-run.log` | Full run log (timestamped) | No |
| `nightytidy-progress.json` | Live progress state (read by TUI window) | No (deleted on stop) |
| `nightytidy-dashboard.url` | Dashboard URL — Claude reads this and shares with user | No (deleted on stop) |
| `NIGHTYTIDY-REPORT_NN_YYYY-MM-DD-HHMM.md` | Run summary with step results + inline action plan (numbered + timestamped) | Yes (on run branch) |
| `CLAUDE.md` (appended section) | "NightyTidy — Last Run" with undo tag | Yes (on run branch) |
| `nightytidy.lock` | Prevents concurrent runs (PID + timestamp) | No (auto-removed on exit; persistent in orchestrator mode) |
| `nightytidy-gui.log` | GUI session log (startup, API requests, errors, shutdown) | No |
| `nightytidy-run-state.json` | Orchestrator run state (steps, results, branch info); also created during rate-limit pause in interactive mode for `--resume` | No (deleted by --finish-run / --resume completion) |
| `nightytidy-before-*` git tag | Safety snapshot before run | Yes (tag) |
| `nightytidy/run-*` git branch | All changes from this run | Yes (branch) |
| `audit-reports/refactor-prompts/*.md` | All 33 step prompts synced for audit trail — stale files from renames auto-removed | Yes (on run branch) |

## What NOT to Do

- **Don't add `require()`** — ESM only, no CommonJS
- **Don't throw from `claude.js`, `executor.js`, `orchestrator.js`, `consolidation.js`, or `sync.js`** — they must return result objects (consolidation returns `null` on failure)
- **Don't change loader.js export shape** — 33 steps with `{ number, name, prompt }` validated by tests. Edit prompt content in `src/prompts/steps/*.md`, not in loader.js
- **Don't remove the logger mock** from any test — it will crash trying to write log files
- **Don't make notifications blocking** — they must be fire-and-forget
- **Don't make the dashboard blocking** — it must be fire-and-forget like notifications
- **Don't use raw `child_process.exec`** — use `spawn` for streaming stdout and timeout control
- **Don't commit `nightytidy-run.log`** — it's per-run ephemeral output
- **Don't use raw `rm()` in tests** — use `robustCleanup()` from `test/helpers/cleanup.js` for temp directory cleanup (prevents EBUSY flakiness on Windows)
- **Don't hardcode version strings** in agent modules — read from `package.json` via `AGENT_VERSION` constant in `index.js`
- **Don't import core modules from agent** — agent uses `CliBridge` to spawn CLI as subprocess, not direct imports
- **Don't hardcode the Firebase webhook URL** — use `FIREBASE_WEBHOOK_URL` constant in `index.js`
- **Don't assume Firebase tokens last 1 hour** — tokens expire based on the JWT `exp` claim, which reflects when Firebase *minted* the token, not when the agent received it
- **Don't skip the `dispatchWithQueue()` helper** — all Firestore webhook dispatches must go through it to ensure queuing when unauthenticated

## Security

- **Dashboard CSRF**: POST `/stop` requires a CSRF token (generated per session via `crypto.randomBytes`). Token is embedded in served HTML and verified server-side. Tests in `dashboard.test.js`.
- **Dashboard security headers**: All responses (200 and 4xx) include CSP, X-Frame-Options, X-Content-Type-Options. CSP allows `'unsafe-inline'` for inline scripts/styles.
- **Dashboard body limits**: POST `/stop` enforces 1 KB body size limit to prevent memory exhaustion.
- **GUI server security**: Binds to `127.0.0.1` only. No CORS headers. Body limit 1 MB. Path traversal protection with trailing separator boundary check. Security headers on all responses (HTML, JSON, and error responses). CSP uses `'self'` + `worker-src blob:` (no inline scripts). Frontend heartbeat uses two layers: Web Worker with absolute URL (immune to Chrome tab throttling) + main-thread `setInterval` backup (both run simultaneously). Server watchdog skips heartbeat checks entirely when `activeProcesses.size > 0` — the server will NEVER self-terminate while steps are running. The 48-min process safety timeout handles truly stuck processes. When idle, watchdog uses 15s threshold to detect browser gone. **Singleton guard**: lock file in `os.tmpdir()/nightytidy-gui.lock` (PID + URL + port). On startup, checks if existing PID is alive + HTTP-probes the server; if responsive, prints "already running", calls `launchChrome()` to focus the existing window, and exits. Stale locks (dead PID or unresponsive server) are removed automatically. Lock is removed in `cleanup()`. `NIGHTYTIDY_NO_CHROME=1` env var suppresses Chrome launch (used in tests).
- **GUI timeout layering**: Three timeout layers prevent hung GUI runs: (1) `api()` in `app.js` uses `AbortController` — 30s for short calls, 50 min for `run-command`; (2) `handleRunCommand()` in `server.js` has a 48-min process safety timeout that force-kills stuck subprocesses; (3) `server.requestTimeout = 0` (disabled — the per-process timeout handles this instead; a 30s requestTimeout previously caused silent HTTP response drops mid-step). All layers log diagnostics to `nightytidy-gui.log`.
- **Security headers on error responses**: All HTTP servers must include `SECURITY_HEADERS` on error responses (403, 404), not just 200 responses. This prevents header-based fingerprinting of error vs success paths.
- **Lock file is atomic**: `acquireLock()` uses `fs.openSync(path, 'wx')` (O_EXCL) to prevent TOCTOU races between concurrent processes.
- **Inactivity timeout**: `waitForChild()` in `claude.js` kills the subprocess after 3 minutes of no stdout/stderr activity (`INACTIVITY_TIMEOUT_MS`). Prevents hung Claude Code processes from blocking runs. Configurable via `inactivityTimeout` option (0 disables). The retry loop in `runPrompt()` automatically retries after an inactivity kill.
- **3-tier step recovery**: `runStep()` in `orchestrator.js` uses 3 recovery tiers for failed steps. Tier 1: normal `executeSingleStep` (fresh session, up to 4 retries). Tier 2 (prod): `executeSingleStep` with `continueSession: true` + `PROD_PREAMBLE` — resumes the killed session via `--continue` to recover partial work. Tier 3 (fresh retry): `executeSingleStep` with a clean slate. Rate-limit failures skip all recovery (handled by GUI pause/resume). Progress JSON gets `prodding: true` or `retrying: true` flags for GUI banners. Each step can use up to 12 Claude invocations before being marked failed.
- **Usage-limit resume**: When a rate limit is detected during an interactive CLI run, state is saved to `nightytidy-run-state.json` (same format as orchestrator mode). The user can close the terminal and resume later with `--resume`. The backoff schedule covers ~9.9 hours total (2min → 5min → 15min → 30min → 1hr → 2hr × 4). GUI's pause overlay includes a "Save & Close" button that exits cleanly for later resume.
- **Prompt integrity check**: `executor.js` computes SHA-256 of all step prompts and compares against `STEPS_HASH`. After editing any markdown file in `src/prompts/steps/` or `src/prompts/specials/`, recompute and update the hash in `executor.js`. Warns but does not block (user may have legitimate prompt changes).
- **`--dangerously-skip-permissions`**: Required for non-interactive Claude Code subprocess calls. NightyTidy is the permission layer — it controls what prompts are sent and operates on a safety branch.
- **Prompt delivery threshold**: Prompts longer than 8000 chars (`STDIN_THRESHOLD` in `claude.js`) are piped via stdin instead of passed as a `-p` argument. This avoids OS command-line length limits. If prompts fail with argument-too-long errors, check this threshold.
- **Env var allowlist**: `cleanEnv()` in `env.js` uses an explicit allowlist (system paths, locale, Anthropic/Claude/Git prefixes) instead of a blocklist. Unknown env vars are filtered out and logged via `debug()`. `CLAUDECODE` is explicitly blocked. Tests in `env.test.js`.
- **Branch guard**: `ensureOnBranch()` in `git.js` is called before and after every step execution in `runStep()`. If Claude Code switched to a different branch during a step, it commits any uncommitted work, checks out the run branch, and merges the stray branch back. On merge conflict, the merge is aborted (step work preserved on the stray branch). This prevents the "branch drift" problem where Claude Code creates its own branches, scattering commits across multiple branches.
- **Gitleaks CI scan**: `.github/workflows/ci.yml` runs `gitleaks/gitleaks-action@v2` on every push/PR to detect committed secrets.
- **`.npmrc` with `ignore-scripts=true`**: Blocks malicious post-install scripts from dependencies. Do not remove.
- **`npm run check:security`**: Runs `npm audit --audit-level=high`. Use before releases.

## Architectural Rules

### Error Handling Strategy

**Critical — do not change a module's error contract without updating all callers.**

| Module | Contract |
|--------|----------|
| `checks.js` | **Throws** with user-friendly messages → caught by cli.js |
| `lock.js` | **Async, throws** with user-friendly messages → awaited + caught by cli.js. Prompts for override in TTY when lock appears active. |
| `claude.js` | **Never throws** → returns `{ success, output, error, exitCode, duration, attempts, cost, errorType, retryAfterMs }`. `errorType` is `'rate_limit'` or `'unknown'`. Rate-limit errors skip retries. |
| `executor.js` | **Never throws** → failed steps recorded. Rate-limit failures trigger pause/auto-resume (exponential backoff with API probes). |
| `git.js` `mergeRunBranch` | **Never throws** → returns `{ success: false, conflict: true }` on conflict |
| `notifications.js` | **Swallows all errors** silently (try/catch in `notify()`) |
| `dashboard.js` | **Swallows all errors** silently — dashboard failure must not crash a run |
| `report.js` | **Warns but never throws** (report failure must not crash a run) |
| `consolidation.js` | **Warns but never throws** → returns `null` on failure (action plan is optional) |
| `orchestrator.js` | **Never throws** → returns `{ success: false, error }` on failure |
| `setup.js` | **Writes to filesystem** → returns `'created'`/`'appended'`/`'updated'` |
| `sync.js` | **Warns but never throws** → returns `{ success: false, error }` on failure |
| `cli.js` `run()` | **Top-level try/catch** catches everything |

### Module Dependency Graph

```
bin/nightytidy.js
  └── src/cli.js
        ├── src/logger.js            (no deps — universal dependency)
        ├── src/env.js               → logger (allowlist env filtering)
        ├── src/checks.js            → logger, env
        ├── src/git.js               → logger
        ├── src/claude.js            → logger, env
        ├── src/executor.js          → crypto, claude, git, notifications, logger, prompts/loader
        ├── src/prompts/loader.js    → fs (reads manifest.json + markdown files at load time)
        ├── src/lock.js              → readline, logger
        ├── src/notifications.js     → logger
        ├── src/dashboard.js         → crypto, logger, child_process, dashboard-html
        │     └── src/dashboard-html.js  (no deps — HTML template only)
        ├── src/dashboard-tui.js     (standalone — chalk only, spawned by dashboard.js)
        ├── src/consolidation.js     → claude, logger, executor, prompts/loader
        ├── src/setup.js             → logger, prompts/loader
        ├── src/sync.js              → crypto, logger (dynamic import from cli.js)
        ├── src/orchestrator.js      → logger, checks, git, claude, executor, lock, report, notifications, prompts, dashboard-standalone
        │     └── src/dashboard-standalone.js → dashboard-html (standalone detached process)
        └── src/report.js            → logger  (cli.js imports formatDuration + getVersion)
```

`logger.js` is the single universal dependency — every module imports it.

## Core Workflow

### Interactive Mode (terminal)

1. **Init**: Logger initialized, welcome screen shown
2. **Pre-checks**: git installed → git repo → has commits → clean working tree (warns) → Claude CLI installed → Claude authenticated → disk space
3. **Step selection**: `--all` runs everything; `--steps 1,5,12` picks by number; non-TTY requires `--all` or `--steps` (exits with error otherwise); interactive checkbox otherwise
4. **Git setup**: Save branch → safety tag → run branch
5. **Execution**: Run each step (improvement + doc update in same session via `--continue`), with fallback commits
6. **Rate-limit handling**: If a step hits a rate limit, the run pauses with exponential backoff (2min → 2hr cap). API is probed periodically; on success the failed step is retried. SIGINT during pause stops the run and gets partial results. GUI mode shows a pause overlay with countdown, "Resume Now", and "Finish with Partial Results" buttons.
7. **Abort handling**: SIGINT generates partial report; second SIGINT force-exits
8. **Reporting**: Changelog → action plan → NIGHTYTIDY-REPORT.md (with inline action plan) → commit → merge back to original branch
9. **Notifications**: Desktop notifications at start, on step failure, and on completion

### Orchestrator Mode (Claude Code)

For non-TTY environments where Claude Code drives the workflow conversationally:

1. `--list --json` → Claude Code presents steps, user picks
2. `--init-run --steps 1,5,12` → pre-checks, git setup, state file created, dashboard server spawned
3. `--run-step N` (repeated) → one step at a time, progress JSON updated, Claude Code reports between steps
4. `--finish-run` → narrated changelog + action plan (AI calls) → report, merge, dashboard shutdown, cleanup

Each command is a separate process invocation. State persists via `nightytidy-run-state.json`. Lock file persists across invocations (persistent mode). Logger runs in quiet mode (no stdout, JSON output only).

**Dashboard in orchestrator mode**: `--init-run` spawns a detached `dashboard-standalone.js` process (HTTP server polling `nightytidy-progress.json`). The `dashboardUrl` is returned in the JSON output so the outer Claude Code can share it with the user. `--run-step` writes progress JSON before/after each step. `--finish-run` sends SIGTERM to the dashboard PID and cleans up ephemeral files. Dashboard PID and URL are stored in the state file.

## Testing

- **Framework**: Vitest v3, `vitest.config.js` for coverage thresholds + strip-shebang plugin
- **Tests** across 50 files (987 tests) — `npm test` to run, `npm run test:ci` for coverage enforcement
- **Coverage thresholds**: 90% statements, 80% branches, 80% functions — enforced by `test:ci`
- **Philosophy**: Mock Claude Code subprocess, use real git against temp directories. Test failure paths harder than success paths
- **Universal mock**: All test files mock `../src/logger.js` to prevent file I/O during tests (exception: `logger.test.js` tests the real logger)
- **Integration tests**: `git.test.js`, `git-extended.test.js`, `integration.test.js` use real temp git repos — run slower but catch real issues
- **Smoke tests**: `smoke.test.js` — 6 fast structural checks for deploy verification (< 3s)
- **Contract tests**: `contracts.test.js` — 40 tests verifying each module's error handling contract matches this document
- **Temp dir cleanup**: Always use `robustCleanup()` from `test/helpers/cleanup.js` instead of raw `rm()` — Windows EBUSY from git file handles causes flaky failures otherwise
- **Shared test factories**: Use `test/helpers/mocks.js` for mock process/git factories and `test/helpers/testdata.js` for report test data — don't duplicate these in individual test files
- See `.claude/memory/testing.md` for detailed mock patterns and pitfalls

## Known Technical Debt

- No `.nightytidyrc` config file — only `NIGHTYTIDY_LOG_LEVEL` env var exists

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

## Agent Mode (Web App Backend)

The agent is a persistent local process that serves as the backend for nightytidy.com. It runs as a WebSocket server on `127.0.0.1:48372`, receiving commands from the web app and executing NightyTidy runs against local git repositories.

### Three Execution Modes

NightyTidy has three ways to run, all in the same npm package:

| Mode | Entry | UI | State |
|------|-------|-----|-------|
| **CLI** | `npx nightytidy [--all\|--steps]` | Terminal (interactive or headless) | Per-run only |
| **Desktop GUI** | `npm run gui` | Chrome app-mode window | Per-session (server.js) |
| **Agent** | `npx nightytidy agent` | nightytidy.com web app | Persistent (`~/.nightytidy/`) |

The agent mode is the newest and most feature-rich. It uses the CLI bridge to spawn `npx nightytidy --init-run` / `--run-step` / `--finish-run` as subprocesses, giving it all CLI capabilities while adding persistent state, scheduling, and web-based monitoring.

### Agent Architecture

```
nightytidy.com (web app)
    │
    │  WebSocket (ws://127.0.0.1:48372)
    │  + HTTP POST /auth-callback (Firebase token)
    │
    ▼
┌─────────────────────────────────────────────────┐
│  AgentWebSocketServer (websocket-server.js)      │
│  - Token-based auth handshake                    │
│  - Rate limiting (10 msg/sec per client)         │
│  - Broadcast events to all connected clients     │
│  - HTTP /auth-callback receives Firebase tokens  │
└──────────────┬──────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────┐
│  Command Handler (index.js — 30+ commands)       │
│  - Project CRUD (add/remove/list)                │
│  - Queue operations (enqueue/reorder/cancel)     │
│  - Run control (start/stop/pause/resume/skip)    │
│  - Git operations (diff/merge/rollback/PR)       │
│  - Scheduling (set/remove/list)                  │
│  - Interrupted run recovery (resume/finish)      │
│  - Auth refresh (token management)               │
└──────────────┬──────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────┐
│  Run Queue Processor (index.js processQueue)     │
│  - Dequeues runs sequentially                    │
│  - Spawns CliBridge for each run                 │
│  - Streams stdout to web app via WebSocket       │
│  - Tracks per-step progress (stepList)           │
│  - Handles rate limits, pause/resume, skip       │
│  - Saves state on crash for interrupted recovery │
└──────────────┬──────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────┐
│  CliBridge (cli-bridge.js)                       │
│  - npx nightytidy --init-run --steps 1,5,...     │
│  - npx nightytidy --run-step N  (per step)       │
│  - npx nightytidy --finish-run                   │
│  - npx nightytidy --list --json                  │
│  Output streamed via callback for live display   │
└─────────────────────────────────────────────────┘
```

### Agent State Files

All agent state persists in `~/.nightytidy/` (cross-session):

| File | Structure | Purpose |
|------|-----------|---------|
| `config.json` | `{ version, port, token, machine }` | Server config. Port defaults to 48372. Token is a random 32-byte hex string generated on first run. Machine is `os.hostname()`. `CONFIG_VERSION` tracks schema migrations. |
| `projects.json` | `[{ id, path, name, addedAt, lastRunAt, schedule, webhooks }]` | Project registry. `id` is a SHA-256 hash of the path. `schedule` has `{ cron, enabled, steps }`. `webhooks` is an array of `{ url, label, headers }`. `pruneStaleProjects()` removes entries whose paths no longer exist on disk. |
| `queue.json` | `{ queue: [...], current: {...}, interrupted: {...} }` | Run queue. `queue` holds pending runs. `current` is the active run (or null). `interrupted` holds crash-recovered state with `lastProgress` containing `{ stepList, completedCount, failedCount, totalCost }`. |

### WebSocket Protocol

**Authentication**: Client sends `{ type: 'auth', token: '<token>' }` → server replies `{ type: 'connected', machine, version, startedAt }`. Unauthenticated messages are rejected.

**Command/Reply**: Client sends `{ type: '<command>', ...params }` → server calls `handleCommand()` → reply sent back to the requesting client only.

**Broadcasts**: Server sends to ALL connected clients. Used for live state updates:

| Broadcast Event | When | Data |
|----------------|------|------|
| `run-started` | Run begins | `{ runId, projectId, projectName, branch }` |
| `run-init` | After --init-run | `{ runId, projectName, totalSteps, startedAt, steps[] }` |
| `step-started` | Step begins | `{ runId, step: { number } }` |
| `step-output` | Live stdout | `{ runId, text, mode: 'raw' }` |
| `step-completed` | Step passes | `{ runId, step: { number, name, status, duration, cost, ... }, cost }` |
| `step-failed` | Step fails | `{ runId, step: { number, name }, error, duration, cost }` |
| `step-skipped` | User skips step | `{ runId, step: { number } }` |
| `run-completed` | All steps done | `{ runId, results }` |
| `run-failed` | Run stopped/error | `{ runId, error }` |
| `run-paused` | User pauses | `{ runId }` |
| `run-resumed` | User resumes | `{ runId }` |
| `run-interrupted` | Agent crash/shutdown | `{ runId, completedSteps, failedSteps, totalCost }` |
| `rate-limit` | API rate limited | `{ runId, retryAfterMs, step: { number } }` |
| `rate-limit-resumed` | Rate limit cleared | `{ runId }` |
| `queue-updated` | Queue changes | `{ queue: [...] }` |
| `token-refresh-needed` | Token expiring | `{}` — web app should respond with `auth-refresh` command |

### WebSocket Command API

| Command | Parameters | Reply | Description |
|---------|-----------|-------|-------------|
| `list-projects` | — | `{ type: 'projects', projects[] }` | List all registered projects |
| `add-project` | `{ path }` | `{ type: 'projects', projects[] }` | Register a git repo |
| `remove-project` | `{ projectId }` | `{ type: 'projects', projects[] }` | Remove a project |
| `start-run` | `{ projectId, steps[], timeout? }` | `{ type: 'run-started', runId, projectId }` | Enqueue a run |
| `stop-run` | `{ runId }` | `{ type: 'run-failed', runId }` | Kill active run |
| `pause-run` | `{ runId }` | `{ type: 'run-paused', runId }` | Pause step loop |
| `resume-run` | `{ runId }` | `{ type: 'run-resumed', runId }` | Resume step loop |
| `skip-step` | `{ runId, step }` | `{ type: 'step-skipped', runId, step }` | Skip current step |
| `get-run` | `{ runId? }` | `{ type: 'run-state', ... }` | Fetch current run state (supports page refresh recovery) |
| `get-queue` | — | `{ type: 'queue-updated', queue[], current }` | Fetch queue state |
| `get-diff` | `{ projectId, baseBranch, runBranch }` | `{ type: 'diff', diff, stat }` | Git diff for a run |
| `get-report` | `{ projectId, runBranch }` | `{ type: 'report', filename, content }` | Read NIGHTYTIDY-REPORT from branch |
| `merge` | `{ projectId, runBranch, targetBranch }` | `{ type: 'merge-result', ... }` | Merge run branch |
| `rollback` | `{ projectId, tag }` | `{ type: 'rollback-result', success }` | Reset to safety tag |
| `create-pr` | `{ projectId, branch, title, body }` | `{ type: 'pr-result', ... }` | Create GitHub PR |
| `retry-step` | `{ projectId, step, timeout? }` | `{ type: 'retry-queued', runId }` | Re-run a single step |
| `reorder-queue` | `{ order[] }` | `{ type: 'queue-updated', queue[] }` | Reorder pending runs |
| `resume-interrupted` | — | `{ type: 'resume-started', runId }` | Resume crash-recovered run |
| `finish-interrupted` | — | `{ type: 'finish-started', runId }` | Finish with partial results |
| `discard-interrupted` | — | `{ type: 'interrupted-discarded', runId }` | Discard interrupted run |
| `get-schedules` | — | `{ type: 'schedules', schedules[] }` | List cron schedules |
| `set-schedule` | `{ projectId, cron, steps? }` | `{ type: 'schedule-updated' }` | Set cron schedule |
| `remove-schedule` | `{ projectId }` | `{ type: 'schedule-removed' }` | Remove schedule |
| `auth-refresh` | `{ token }` | `{ type: 'auth-refresh-ack' }` | Update Firebase token |
| `select-folder` | `{ path }` | `{ type: 'folder-selected', path }` | Passthrough for native dialog |

### Firebase Integration

The agent communicates with Firestore via webhooks to a Cloud Function at `https://webhookingest-24h6taciuq-uc.a.run.app`. The web app provides Firebase ID tokens so the Cloud Function can verify the user.

**Token lifecycle**:
1. User opens nightytidy.com → web app's `AgentAuthSync` component sends Firebase ID token via `POST /auth-callback` on the agent's HTTP server
2. Agent calls `firebaseAuth.setToken(token)` which parses the JWT `exp` claim to set the real expiry (not a hardcoded 1 hour)
3. Before each step, `requestTokenRefreshIfNeeded()` checks if token is within 15 minutes of expiry
4. If refresh needed, broadcasts `{ type: 'token-refresh-needed' }` via WebSocket
5. Web app's `AgentProvider` receives event, calls `user.getIdToken(true)` (force refresh), sends back via `auth-refresh` command
6. If web app doesn't respond, the refresh request retries with exponential backoff (30s → 60s → 120s → 4min cap)

**Webhook events sent to Firestore**:
- `run_started` — creates run document with status, selectedSteps, gitBranch, gitTag
- `step_completed` — increments completedSteps, writes step subdocument
- `step_failed` — increments failedSteps, writes step subdocument
- `run_completed` — sets status='completed', finishedAt
- `run_failed` — sets status='failed', finishedAt
- `run_interrupted` — sets status='interrupted', interruptedAt
- `run_resumed` — sets status='running' (preserves counters)
- `heartbeat` — updates lastHeartbeat field (every 60 seconds during a run)

**Webhook queue**: When `isAuthenticated()` returns false (token expired), webhook payloads are queued (up to 200 entries). When `setToken()` receives a fresh token, queued webhooks are replayed via the `onTokenRefresh` callback. This prevents data loss during extended token gaps. Heartbeats are NOT queued (they're liveness pings, only useful in real-time).

**`dispatchWithQueue()` helper** (in index.js): Replaces all inline webhook dispatch patterns. Always sends to user webhooks (Slack/Discord) immediately. Sends to Firestore endpoint if authenticated, otherwise queues for replay.

### Agent Error Contracts

| Module | Contract |
|--------|----------|
| `agent/index.js` | **Never throws** — errors sent as `{ type: 'error', message, code }` replies. Run failures broadcast as `run-failed`. |
| `agent/config.js` | **Throws** on filesystem errors (first-run config creation). Caught by `startAgent()`. |
| `agent/project-manager.js` | **Throws** on invalid path. Caught by command handler. |
| `agent/run-queue.js` | **Swallows errors** — queue operations always succeed (dequeue returns null if empty). |
| `agent/scheduler.js` | **Throws** on invalid cron. Validated before calling via `Scheduler.isValidCron()`. |
| `agent/cli-bridge.js` | **Never throws** — returns `{ success, parsed, stderr }`. Non-zero exit codes are failures, not exceptions. |
| `agent/git-integration.js` | **Throws** on git errors. Caught by command handler with error code classification. |
| `agent/websocket-server.js` | **Swallows errors** — WebSocket errors logged, never crash the server. |
| `agent/webhook-dispatcher.js` | **Swallows errors** — webhook failures logged as warnings, never block runs. Uses `Promise.allSettled()`. |
| `agent/firebase-auth.js` | **Never throws** — token operations always succeed (return null/false/empty on failure). |

### Agent Dependency Graph

```
npx nightytidy agent
  └── src/agent/index.js
        ├── src/logger.js              (universal dependency)
        ├── src/agent/config.js        → fs, path, os, crypto
        ├── src/agent/project-manager.js → fs, path, crypto
        ├── src/agent/run-queue.js     → fs, path, crypto
        ├── src/agent/scheduler.js     → node-cron
        ├── src/agent/websocket-server.js → http, ws, os, logger
        ├── src/agent/webhook-dispatcher.js → logger
        ├── src/agent/cli-bridge.js    → child_process, path
        ├── src/agent/git-integration.js → child_process
        └── src/agent/firebase-auth.js → logger
```

The agent imports ONLY its own modules + logger. It does NOT import cli.js, executor.js, orchestrator.js, or any other core module directly — it uses CliBridge to spawn those as subprocesses.

### Agent Lifecycle

```
1. Read/create config (~/.nightytidy/config.json)
2. Initialize components (ProjectManager, RunQueue, Scheduler, FirebaseAuth, WebhookDispatcher)
3. Wire up Firebase onTokenRefresh callback (webhook queue replay)
4. Start WebSocket server on 127.0.0.1:{port}
5. Register scheduler callbacks for all enabled project schedules
6. Check for interrupted runs from previous crashes
   - If found: log it, notify Firestore, wait for user action via web app
   - Also detect orphaned "running" entries (crash without graceful shutdown)
7. Print startup banner with version, WebSocket URL, and token preview
8. Wait for WebSocket commands from web app
```

**Graceful shutdown** (SIGINT/SIGTERM):
1. Save interrupted state if a run is active (`markInterrupted(runProgress)`)
2. Best-effort notify Firestore (`run_interrupted` webhook via `dispatchWithQueue`)
3. Broadcast `run-interrupted` to connected web app clients
4. Stop heartbeat
5. Stop all cron schedulers
6. Close WebSocket server
7. Exit

**Crash recovery** (uncaughtException/unhandledRejection):
1. Same as graceful shutdown (save state, notify, exit with code 1)
2. On next startup, `getInterrupted()` returns the saved state
3. Web app can choose: Resume (re-run remaining steps), Finish (generate partial report), or Discard

### Interrupted Run Recovery

When the agent crashes or is killed mid-run, state is saved to `queue.json` with `lastProgress`:

```json
{
  "interrupted": {
    "id": "run-1773800339596-78266b69",
    "projectId": "8da06f19b3751553",
    "steps": [1, 2, 3, ...],
    "startedAt": 1773800339596,
    "interruptedAt": 1773804030000,
    "lastProgress": {
      "stepList": [{ "number": 1, "name": "Documentation", "status": "completed" }, ...],
      "completedCount": 5,
      "failedCount": 0,
      "totalCost": 12.50,
      "currentStepNum": 6
    }
  }
}
```

**Resume flow** (`resume-interrupted` command):
1. Read CLI state file (`nightytidy-run-state.json`) for completed steps
2. Calculate remaining steps
3. Transition queue entry back to "running"
4. Send `run_resumed` webhook to Firestore (NOT `run_started` — preserves counters)
5. Re-enter step loop for remaining steps only
6. Finish normally (report + merge)

**Finish flow** (`finish-interrupted` command):
1. Call `--finish-run` to generate partial report from completed steps
2. Send `run_completed` webhook

### Versioning & Publishing

The agent is bundled in the `nightytidy` npm package (not a separate package). Version is read from `package.json` at startup and displayed in:
- Console startup banner: `NightyTidy Agent v{version}`
- WebSocket `connected` reply: `{ version }`
- Webhook payloads: `{ agent: { version } }`

**Publishing workflow**:
1. Make changes on `feature/agent-module` branch
2. Bump version in `package.json`
3. `npm test` to verify
4. `git commit` and `git push origin feature/agent-module`
5. `npm publish` (requires `npm login` first)
6. Restart agent to pick up new version

**Version convention**: `0.x.y` — major bump reserved for stable release. Patch bumps for bug fixes, minor bumps for features.

### Agent Security

- **WebSocket auth**: Token-based handshake required before any commands. Token stored in `~/.nightytidy/config.json`.
- **Localhost only**: WebSocket and HTTP server bind to `127.0.0.1` — not accessible from network.
- **Rate limiting**: 10 messages per second per WebSocket client.
- **CORS**: HTTP endpoints include `Access-Control-Allow-Origin` for nightytidy.com.
- **Firebase token handling**: JWT `exp` claim parsed from token payload (base64url decode, no crypto). Never stored on disk — in-memory only.
- **Webhook auth**: Firebase bearer token included in webhook headers. Expired tokens detected via `isAuthenticated()` check against parsed JWT expiry.

## NightyTidy — Last Run

Last run: 2026-03-12. To undo, reset to git tag `nightytidy-before-2026-03-11-2240`.
