# NightyTidy

Automated overnight codebase improvement through [Claude Code](https://docs.anthropic.com/en/docs/claude-code). NightyTidy runs 33 AI-driven improvement prompts against your codebase — handling git branching, retries, timeouts, and reporting. You kick it off before bed and review the results in the morning.

## Prerequisites

- **Node.js** >= 20.12.0
- **Git** installed and on your PATH
- **Claude Code CLI** installed and authenticated — [installation guide](https://docs.anthropic.com/en/docs/claude-code)

## Installation

```bash
git clone https://github.com/dorianspitz23/NightyTidy.git
cd NightyTidy
npm install
```

Then run it from any git project:

```bash
npx nightytidy
```

Or link it globally:

```bash
npm link
nightytidy
```

## Usage

NightyTidy can be run from the terminal (CLI) or through a desktop GUI. Both use the same engine — the GUI wraps the CLI's orchestrator mode in a visual interface.

### CLI

```bash
# Interactive — pick which steps to run
npx nightytidy

# Run all 33 improvement steps
npx nightytidy --all

# Run specific steps by number
npx nightytidy --steps 1,5,12

# List all available steps with descriptions
npx nightytidy --list

# Preview what would run without actually running
npx nightytidy --dry-run
npx nightytidy --all --dry-run

# Set per-step timeout (default: 45 minutes)
npx nightytidy --timeout 60

# Add NightyTidy integration to a project's CLAUDE.md
npx nightytidy --setup
```

#### Non-interactive mode

In environments without a TTY (CI, scripts), you must specify `--all` or `--steps` — interactive step selection is not available.

#### Claude Code orchestrator mode

If you use NightyTidy from within Claude Code (no terminal), use the step-by-step orchestrator commands. These output JSON and let Claude Code drive the workflow conversationally:

```bash
# 1. List steps as JSON
npx nightytidy --list --json

# 2. Initialize a run (pre-checks, git setup, state file)
npx nightytidy --init-run --steps 1,5,12

# 3. Run steps one at a time
npx nightytidy --run-step 1
npx nightytidy --run-step 5
npx nightytidy --run-step 12

# 4. Finish (report, merge, cleanup)
npx nightytidy --finish-run
```

Run `npx nightytidy --setup` in your project to add a CLAUDE.md snippet that teaches Claude Code this workflow automatically.

### Desktop GUI

Launch the GUI from the NightyTidy project directory:

```bash
npm run gui
```

This starts a local HTTP server and opens a Chrome app-mode window with a five-screen workflow:

1. **Setup** — Select the target project folder using a native file dialog
2. **Steps** — Pick which of the 33 improvement steps to run and set the timeout
3. **Running** — Live progress view with step status, elapsed time, and a Stop button
4. **Finishing** — Report generation and merge (automatic)
5. **Summary** — Final stats (passed/failed/duration), report path, and branch info

The GUI calls the same CLI orchestrator commands under the hood (`--init-run`, `--run-step`, `--finish-run`), so behavior is identical to CLI usage.

**Requirements**: Google Chrome must be installed (the GUI uses Chrome's `--app` mode for a frameless window). Windows only for now (the native folder picker uses a Windows COM dialog).

## The 33 improvement steps

| # | Step | Category |
|---|------|----------|
| 1 | Documentation | Docs |
| 2 | Test Coverage | Testing |
| 3 | Test Hardening | Testing |
| 4 | Test Architecture | Testing |
| 5 | Test Consolidation | Testing |
| 6 | Test Quality | Testing |
| 7 | API Design | Architecture |
| 8 | Security Sweep | Security |
| 9 | Dependency Health | Maintenance |
| 10 | Codebase Cleanup | Maintenance |
| 11 | Cross-Cutting Concerns | Architecture |
| 12 | File Decomposition | Architecture |
| 13 | Code Elegance | Quality |
| 14 | Architectural Complexity | Architecture |
| 15 | Type Safety | Quality |
| 16 | Logging & Error Message | Observability |
| 17 | Data Integrity | Reliability |
| 18 | Performance | Performance |
| 19 | Cost & Resource Optimization | Performance |
| 20 | Error Recovery | Reliability |
| 21 | Race Condition Audit | Reliability |
| 22 | Bug Hunt | Quality |
| 23 | Frontend Quality | Frontend |
| 24 | UI/UX Audit | Frontend |
| 25 | State Management | Frontend |
| 26 | Perceived Performance | Frontend |
| 27 | DevOps | Infrastructure |
| 28 | Scheduled Jobs | Infrastructure |
| 29 | Observability | Infrastructure |
| 30 | Backup Check | Infrastructure |
| 31 | Product Polish & UX Friction | Product |
| 32 | Feature Discovery & Opportunity | Product |
| 33 | Strategic Opportunities | Product |

Run `npx nightytidy --list` for full descriptions.

## How it works

1. **Pre-checks** — verifies git, Claude Code CLI, authentication, and disk space.
2. **Safety snapshot** — tags the current state (`nightytidy-before-*`) so you can always get back.
3. **Run branch** — creates `nightytidy/run-*` and runs all steps there. Your main branch is never touched during execution.
4. **Step execution** — each step sends an improvement prompt to Claude Code, then a follow-up doc-update prompt. If Claude doesn't commit its changes, NightyTidy makes a fallback commit.
5. **Action plan** — consolidates recommendations from all steps into a prioritized `NIGHTYTIDY-ACTIONS.md`.
6. **Report** — generates `NIGHTYTIDY-REPORT.md` with results for every step.
7. **Merge** — merges the run branch back into your original branch with `--no-ff`. On conflict, the run branch is left for manual resolution.

### Abort handling

Press `Ctrl+C` once to finish the current step and generate a partial report. Press `Ctrl+C` again to force-exit. Changes are always on the run branch — your original branch is safe.

## What it creates in your project

| Artifact | Committed? | Purpose |
|----------|-----------|---------|
| `NIGHTYTIDY-REPORT.md` | Yes (on run branch) | Summary of what each step did |
| `NIGHTYTIDY-ACTIONS.md` | Yes (on run branch) | Consolidated prioritized action plan |
| `CLAUDE.md` section | Yes (on run branch) | "NightyTidy — Last Run" with undo instructions |
| `nightytidy-before-*` tag | Yes (tag) | Safety snapshot for easy rollback |
| `nightytidy/run-*` branch | Yes (branch) | All changes from the run |
| `nightytidy-run.log` | No | Detailed log (deleted after review) |

## Dashboard

During a run, NightyTidy opens a progress dashboard — either a TUI window or a browser-based view — showing step status in real time. The dashboard includes a Stop button to abort gracefully.

## Security note

NightyTidy runs Claude Code with `--dangerously-skip-permissions` because non-interactive `claude -p` has no TTY to approve tool permissions (Bash, Edit, Write, etc.). NightyTidy is the permission layer — it controls what prompts are sent and operates on a safety branch. The subprocess is also given a safety preamble that prevents destructive git operations.

Review the run branch diff before merging to verify the changes.

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NIGHTYTIDY_LOG_LEVEL` | `info` | Log verbosity: `debug`, `info`, `warn`, `error` |

No API keys needed — Claude Code handles its own authentication.

## Rollback

If you don't like the results:

```bash
git reset --hard nightytidy-before-<timestamp>
```

The safety tag created before each run makes rollback a one-liner.

## Development

```bash
npm test              # Run all tests (28 test files)
npm run test:fast     # Excludes slow integration/git tests
npm run test:watch    # Watch mode
npm run test:ci       # With coverage enforcement (90% stmts, 80% branches, 80% functions)
npm run test:flaky    # Run suite 3x to detect flaky tests
npm run check:docs    # Verify documentation matches code
npm run check:security # npm audit for high+ severity vulnerabilities
```

No build step — plain JavaScript ESM, runs directly.

## License

[MIT](LICENSE)
