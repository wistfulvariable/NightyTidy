# NightyTidy

Automated overnight codebase improvement through [Claude Code](https://docs.anthropic.com/en/docs/claude-code). NightyTidy runs 28 AI-driven improvement prompts against your codebase — handling git branching, retries, timeouts, and reporting. You kick it off before bed and review the results in the morning.

## Prerequisites

- **Node.js** >= 18
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

```bash
# Interactive — pick which steps to run
npx nightytidy

# Run all 28 improvement steps
npx nightytidy --all

# Run specific steps by number
npx nightytidy --steps 1,5,12

# List all available steps
npx nightytidy --list

# Set per-step timeout (default: 45 minutes)
npx nightytidy --timeout 60

# Add NightyTidy integration to a project's CLAUDE.md
npx nightytidy --setup
```

### Non-interactive mode

In environments without a TTY (CI, scripts), you must specify `--all` or `--steps` — interactive step selection is not available.

## How it works

1. **Pre-checks** — verifies git, Claude Code CLI, authentication, and disk space.
2. **Safety snapshot** — tags the current state (`nightytidy-before-*`) so you can always get back.
3. **Run branch** — creates `nightytidy/run-*` and runs all steps there. Your main branch is never touched during execution.
4. **Step execution** — each step sends an improvement prompt to Claude Code, then a follow-up doc-update prompt. If Claude doesn't commit its changes, NightyTidy makes a fallback commit.
5. **Report** — generates `NIGHTYTIDY-REPORT.md` with results for every step.
6. **Merge** — merges the run branch back into your original branch with `--no-ff`. On conflict, the run branch is left for manual resolution.

### Abort handling

Press `Ctrl+C` once to finish the current step and generate a partial report. Press `Ctrl+C` again to force-exit. Changes are always on the run branch — your original branch is safe.

## What it creates in your project

| Artifact | Committed? | Purpose |
|----------|-----------|---------|
| `NIGHTYTIDY-REPORT.md` | Yes (on run branch) | Summary of what each step did |
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
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:ci       # With coverage enforcement (90% stmts, 80% branches, 80% functions)
```

## License

[MIT](LICENSE)
