# NightyTidy

Automated overnight codebase improvement through [Claude Code](https://docs.anthropic.com/en/docs/claude-code). NightyTidy sequences 33 AI-driven improvement prompts against your codebase — handling git branching, retries, rate-limit recovery, notifications, and reporting. Kick it off before bed, review the results in the morning.

Built for vibe coders and small teams who want production-grade code quality without the grind.

## Prerequisites

- **Node.js** >= 20.12.0
- **Git** installed and on your PATH
- **Claude Code CLI** installed and authenticated — [installation guide](https://docs.anthropic.com/en/docs/claude-code)
- **Google Chrome** (for the desktop GUI)

## Installation

```bash
git clone https://github.com/dorianspitz23/NightyTidy.git
cd NightyTidy
npm install
```

No build step — plain JavaScript ESM, runs directly.

## Quick Start

Launch the desktop GUI:

```bash
npm run gui
```

This opens a Chrome app-mode window. From there:

1. **Select your project folder** using the native folder picker
2. **Pick which steps to run** — or Select All for all 33
3. **Set the timeout** per step (default: 45 minutes)
4. **Click Start Run** and walk away

NightyTidy handles everything from there: progress tracking, live Claude output, rate-limit pausing, report generation, and merging changes back to your branch.

## Run Duration and Token Usage

A full 33-step run is a serious workload — expect **6 to 8 hours** with Claude running at full capacity the entire time. Each step gets its own Claude Code session, and many steps involve reading your entire codebase, making changes, running tests, and iterating. This adds up fast.

**You will likely hit usage limits** unless you're on Anthropic's Max plan. To avoid mid-run rate limits:

- **Max plan recommended** — A full run burns through a large number of tokens. The Max plan gives you the headroom to complete all 33 steps without interruption.
- **Run in batches** — If you're not on Max, run a quarter or half of the steps at a time (e.g., `--steps 1-8`, then `--steps 9-16` after your usage resets). The GUI's step picker makes this easy.
- **Use the rate-limit recovery** — If you do hit limits mid-run, NightyTidy pauses automatically and can resume later. Save & Close in the GUI, or use `--resume` in the CLI when your limits reset.

Running fewer steps per session is a perfectly valid workflow — you'll get the same results, just spread over multiple nights.

## One Session at a Time

NightyTidy enforces single-session execution — only one improvement run can be active at a time, whether through the GUI or CLI. This is by design: running multiple concurrent AI sessions against the same codebase would create conflicting changes, broken merges, and unreliable results.

- **GUI**: A singleton guard ensures only one NightyTidy window can be open. Launching again focuses the existing window.
- **CLI**: An atomic lock file (`nightytidy.lock`) prevents concurrent runs. If a previous run was interrupted, you'll be prompted to override or resume.

If you need to run against multiple projects, use separate terminal sessions — the lock is per-project, not global.

## Desktop GUI

The GUI is the primary way to use NightyTidy. It wraps the CLI orchestrator in a five-screen visual workflow.

### Screens

| Screen | What it does |
|--------|-------------|
| **Setup** | Pick a project folder via native file dialog. Validates git repo and Claude CLI. |
| **Step Selection** | Browse all 33 steps with checkboxes, Select All / Deselect All, set timeout. Detects and offers to resume paused runs. |
| **Running** | Live progress bar, per-step status indicators, real-time Claude output panel, elapsed time, cost/token tracking, Skip Step and Stop Run controls. |
| **Finishing** | Generates an AI-narrated report and merges changes back to your original branch. |
| **Summary** | Final results — steps completed/failed, total cost, token usage, duration. Click any step to review its full output. |

### Features

- **Live output viewer** — Watch Claude work in real time. Markdown-rendered output panel with a "Claude is working" indicator during long tool executions.
- **Step output drawer** — Click any completed or failed step to open its full output in a side panel with markdown rendering and a copy button.
- **Rate-limit handling** — If you hit Claude's API usage limit, NightyTidy pauses automatically with a countdown timer. Three options: Resume Now, Finish with Partial Results, or Save & Close to resume later.
- **Pause and resume** — Close the GUI mid-run and come back later. Progress is saved to `nightytidy-run-state.json`. On next launch, the GUI detects the saved state and offers to resume.
- **Page refresh safe** — Accidentally refresh the browser? The GUI reconnects to the still-running backend process and picks up where it left off.
- **Background tab safe** — Alt-tab away without worry. A Web Worker heartbeat keeps the server connection alive even when Chrome throttles background tabs.
- **Skip and stop** — Skip the current step or stop the entire run at any time. A confirmation dialog prevents accidental stops. Completed work is always preserved.
- **Singleton guard** — Only one GUI instance can run at a time. Launching again focuses the existing window.

## CLI Usage

For terminal users, scripting, or CI environments:

```bash
# Interactive — pick steps from a checklist
npx nightytidy

# Run all 33 steps
npx nightytidy --all

# Run specific steps by number
npx nightytidy --steps 1,5,12

# List all available steps with descriptions
npx nightytidy --list

# Preview what would run without actually running
npx nightytidy --dry-run

# Set per-step timeout (default: 45 minutes)
npx nightytidy --timeout 60

# Resume a paused run (after rate limit or restart)
npx nightytidy --resume

# Sync prompts from the Google Doc
npx nightytidy --sync

# Preview what sync would change without writing
npx nightytidy --sync-dry-run

# Skip automatic prompt sync before a run
npx nightytidy --skip-sync

# Add NightyTidy integration to a project's CLAUDE.md
npx nightytidy --setup
```

In environments without a TTY (CI, scripts), you must specify `--all` or `--steps` — interactive step selection is not available.

### Orchestrator Mode

For use within Claude Code (no terminal). Outputs JSON for conversational workflows:

```bash
npx nightytidy --list --json              # List steps as JSON
npx nightytidy --init-run --steps 1,5,12  # Initialize a run
npx nightytidy --run-step 1              # Run one step
npx nightytidy --finish-run              # Generate report + merge
```

Run `npx nightytidy --setup` in your project to add a CLAUDE.md snippet that teaches Claude Code this workflow.

## The 33 Improvement Steps

| # | Step | Focus |
|---|------|-------|
| 1 | Documentation | Coverage, accuracy, API docs |
| 2 | Test Coverage | Missing tests, untested paths |
| 3 | Test Hardening | Flaky tests, edge cases, error paths |
| 4 | Test Architecture | Structure, patterns, organization |
| 5 | Test Consolidation | Remove duplicates, merge related tests |
| 6 | Test Quality | Tautological tests, testing implementation details |
| 7 | API Design | Consistency, naming, contracts |
| 8 | Security Sweep | Auth, injection, OWASP top 10 |
| 9 | Dependency Health | Outdated, unused, vulnerable deps |
| 10 | Codebase Cleanup | Dead code, unused imports, lint |
| 11 | Cross-Cutting Concerns | Logging, error handling, validation patterns |
| 12 | File Decomposition | Large files, single-responsibility splits |
| 13 | Code Elegance | Readability, naming, simplification |
| 14 | Architectural Complexity | Over-engineering, unnecessary abstraction |
| 15 | Type Safety | Type assertions, null safety, contracts |
| 16 | Logging & Error Messages | Quality, consistency, actionability |
| 17 | Data Integrity | Validation, constraints, edge cases |
| 18 | Performance | N+1 queries, memory, algorithmic complexity |
| 19 | Cost & Resource Optimization | API calls, caching, efficiency |
| 20 | Error Recovery | Graceful degradation, retry logic |
| 21 | Race Condition Audit | Concurrency, atomicity, ordering |
| 22 | Bug Hunt | Logic errors, off-by-ones, silent failures |
| 23 | Frontend Quality | Components, rendering, accessibility |
| 24 | UI/UX Audit | Usability, consistency, friction |
| 25 | State Management | State flow, side effects, synchronization |
| 26 | Perceived Performance | Loading states, skeleton screens, responsiveness |
| 27 | DevOps | CI/CD, deployment, environment config |
| 28 | Scheduled Jobs & Cron | Reliability, idempotency, monitoring |
| 29 | Observability | Metrics, tracing, alerting |
| 30 | Backup Check | Data safety, recovery procedures |
| 31 | Product Polish & UX Friction | Edge cases, empty states, error UX |
| 32 | Feature Discovery & Opportunity | Missing features, quick wins |
| 33 | Strategic Opportunities | Architecture direction, scaling, roadmap |

Prompts auto-sync from a published Google Doc before every run. Use `--skip-sync` to skip, or `npx nightytidy --sync` to sync manually.

## How It Works

### Safety First

Every run is protected by git:

1. **Safety tag** — `nightytidy-before-YYYY-MM-DD-HHMM` snapshots your current state before any changes
2. **Dedicated branch** — All work happens on `nightytidy/run-YYYY-MM-DD-HHMM`, never on your working branch
3. **Auto-merge** — On completion, changes merge back to your original branch with `--no-ff`
4. **Conflict handling** — On merge conflict, the run branch is left intact for manual resolution
5. **Undo** — Reset to the safety tag at any time: `git reset --hard nightytidy-before-<timestamp>`

### Step Execution

Each step runs in its own Claude Code session:

1. Claude receives the improvement prompt + your codebase context
2. Claude makes changes, runs tests, iterates
3. Changes are committed to the run branch
4. If Claude doesn't commit, NightyTidy makes a fallback commit
5. Branch guards ensure all commits land on the correct branch (Claude sometimes creates its own branches — NightyTidy catches this and merges them back)

### 3-Tier Step Recovery

If a step fails, NightyTidy retries automatically with three escalating tiers:

- **Tier 1** — Normal retry (up to 4 attempts per tier)
- **Tier 2 (Prod)** — Resume the killed session via `--continue` to recover partial work. Claude Code saves session state to disk, so partial progress isn't lost.
- **Tier 3 (Fresh)** — Clean slate retry with a completely new session

Maximum 12 Claude invocations per step across all tiers.

### Rate-Limit Recovery

If Claude's API usage limit is reached mid-run:

- **GUI** — A pause overlay appears with a countdown timer. Options: Resume Now (if you've added credits or upgraded), Finish with Partial Results, or Save & Close for later.
- **CLI** — Automatic exponential backoff (2 min, 5 min, 15 min, ... up to 2 hours per wait). API probes between waits. Total coverage: ~10 hours.
- **Resume later** — Close everything and run `npx nightytidy --resume`, or relaunch the GUI — it detects saved state and offers to continue.

### Abort Handling

- **CLI**: Press `Ctrl+C` once to finish the current step and generate a partial report. Press again to force-exit.
- **GUI**: Click Stop Run (with confirmation dialog). Completed work is preserved and a report is generated.

Changes are always on the run branch — your original branch is safe.

### Report Generation

After all steps complete, NightyTidy generates:

- **`audit-reports/00_NIGHTYTIDY-REPORT_*.md`** — AI-narrated run summary with per-step results, costs, token usage, duration, and a prioritized action plan (the `00_` prefix ensures reports sort to the top of the audit-reports folder)
- **CLAUDE.md update** — Appends a "Last Run" section with the run date and undo instructions
- **Audit trail** — All 33 step prompts are copied to `audit-reports/refactor-prompts/` so you can see exactly what was asked

If the AI report fails verification (junk detection), NightyTidy falls back to a template-based report so you always get results.

## Files Created in Your Project

| File | Committed? | Purpose |
|------|-----------|---------|
| `audit-reports/00_NIGHTYTIDY-REPORT_NN_YYYY-MM-DD-HHMM.md` | Yes | Run summary with step results + action plan |
| `CLAUDE.md` (appended section) | Yes | "NightyTidy — Last Run" with undo tag |
| `audit-reports/refactor-prompts/*.md` | Yes | All 33 prompts for audit trail |
| `nightytidy-before-*` git tag | Yes (tag) | Safety snapshot for rollback |
| `nightytidy/run-*` git branch | Yes (branch) | All changes from the run |
| `nightytidy-run.log` | No | Detailed timestamped run log |
| `nightytidy-progress.json` | No | Live progress state (read by GUI) |
| `nightytidy-run-state.json` | No | Saved state for pause/resume |
| `nightytidy.lock` | No | Prevents concurrent runs |
| `nightytidy-gui.log` | No | GUI session log (errors, API requests) |

## Rollback

If you don't like the results:

```bash
git reset --hard nightytidy-before-<timestamp>
```

The safety tag created before each run makes rollback a one-liner.

## Configuration

NightyTidy works with zero configuration. The only environment variable:

| Variable | Default | Description |
|----------|---------|-------------|
| `NIGHTYTIDY_LOG_LEVEL` | `info` | Log verbosity: `debug`, `info`, `warn`, `error` |

No API keys needed — Claude Code handles its own authentication.

## Security

- All changes happen on a dedicated git branch with a pre-run safety tag
- Claude Code runs with `--dangerously-skip-permissions` — NightyTidy is the permission layer, controlling what prompts are sent and operating on a safety branch
- GUI server binds to `127.0.0.1` only (not exposed to the network)
- Dashboard endpoints use CSRF tokens and security headers (CSP, X-Frame-Options, X-Content-Type-Options)
- Lock file prevents concurrent runs (atomic via `O_EXCL`)
- Environment variables filtered through an explicit allowlist before passing to Claude Code
- `.npmrc` with `ignore-scripts=true` blocks malicious post-install scripts
- CI includes Gitleaks secret scanning and `npm audit`

Always review the run branch diff before merging to verify the changes.

## Development

```bash
npm test                   # All tests (40 files, ~900 tests)
npm run test:fast          # Skip slow integration/git tests (~6s vs ~10s)
npm run test:watch         # Watch mode
npm run test:ci            # With coverage enforcement (90% stmts, 80% branches/functions)
npm run test:flaky         # Run suite 3x to detect flaky tests
npm run check:docs         # Verify documentation matches code
npm run check:security     # npm audit — fails on high+ severity
```

### CI Pipeline

GitHub Actions on every push/PR to master:
- Test matrix across Ubuntu + Windows, Node.js 20 / 22 / 24
- Coverage threshold enforcement
- Documentation freshness check
- Gitleaks secret scan
- Security audit (`npm audit`)

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js (ESM) >= 20.12.0 |
| CLI | Commander v14, @inquirer/checkbox v5 |
| Terminal UX | ora v9 (spinners), chalk v5 (colors) |
| Git | simple-git v3 |
| AI Engine | Claude Code CLI (subprocess) |
| Notifications | node-notifier v10 |
| GUI | Node.js HTTP server + Chrome `--app` mode |
| GUI Markdown | marked v17 (vendored UMD) |
| Testing | Vitest v3 |

## License

[MIT](LICENSE)
