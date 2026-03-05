# NightyTidy — PRD Decomposition

## Overview

NightyTidy is a Node.js CLI tool that automates a 28-step codebase improvement cycle through Claude Code. The user runs one command, walks away, and returns to a professionally maintained codebase — documented, tested, secured, and cleaned up. Targets vibe coders at a company of a few dozen people.

The tool is an orchestration layer, not an AI tool itself. Claude Code does all the heavy lifting; NightyTidy handles sequencing, git management, retries, notifications, and reporting.

## Tech Stack

| Component | Technology | Notes |
|-----------|-----------|-------|
| Runtime | Node.js ≥18 LTS | Already required for Claude Code |
| Language | JavaScript (ESM, ES2022) | No TypeScript, no build step |
| CLI framework | Commander.js ^12.x | Command parsing |
| Interactive prompts | @inquirer/checkbox ^9.x | Step selector |
| Terminal spinner | ora ^8.x | Progress indicator |
| Terminal colors | chalk ^5.x | Color-coded output |
| Git operations | simple-git ^3.x | Async git CLI wrapper |
| Notifications | node-notifier ^10.x | Cross-platform native notifications |
| Testing | Vitest ^2.x | Native ESM support |
| Claude Code | child_process.spawn | Subprocess via `claude -p` |
| Logging | Custom (~50 LOC) | File + stdout, timestamped |
| Report generation | Plain string templates | No templating engine |

## Project Structure

```
nightytidy/
├── bin/
│   └── nightytidy.js          # Entry point (#!/usr/bin/env node)
├── src/
│   ├── cli.js                 # Commander setup & Inquirer step selector
│   ├── executor.js            # Core loop — runs steps sequentially
│   ├── claude.js              # Claude Code subprocess wrapper
│   ├── git.js                 # Git operations (simple-git wrapper)
│   ├── checks.js              # Pre-run validation checks
│   ├── notifications.js       # Desktop notification wrapper
│   ├── logger.js              # Custom file + stdout logger
│   ├── report.js              # Report generation & narrated changelog
│   └── prompts/
│       └── steps.js           # Array of 28 prompt objects
├── test/
│   ├── executor.test.js
│   ├── claude.test.js
│   ├── git.test.js
│   └── checks.test.js
├── package.json
├── README.md
├── CLAUDE.md
└── .gitignore
```

## File Map — Build Sequence

| File | Module(s) | Description |
|------|-----------|-------------|
| `00_README.md` | — | This file. Project overview and file map |
| `01_Project_Setup.md` | package.json, bin/, .gitignore, CLAUDE.md | Project initialization and configuration |
| `02_Logger.md` | `src/logger.js` | Logging utility — build first, everything depends on it |
| `03_Pre_Run_Checks.md` | `src/checks.js` | Validation gates before execution starts |
| `04_Git_Operations.md` | `src/git.js` | Git wrapper: branches, tags, commits, merges |
| `05_Claude_Code_Integration.md` | `src/claude.js` | Subprocess wrapper for `claude -p` |
| `06_Prompt_Library.md` | `src/prompts/steps.js` | 28 prompts + doc update + changelog prompts |
| `07_Step_Executor.md` | `src/executor.js` | Core orchestration loop |
| `08_Notifications.md` | `src/notifications.js` | Desktop notification wrapper |
| `09_Report_Generation.md` | `src/report.js` | NIGHTYTIDY-REPORT.md and narrated changelog |
| `10_CLI_Interface.md` | `src/cli.js` | Commander, Inquirer, terminal UX, Ctrl+C |
| `11_Error_Handling.md` | Cross-cutting | Error strategy, message catalog, graceful degradation |
| `12_Testing_Strategy.md` | `test/` | What to test, mocking approach, first run checklist |
| `13_Post_Run_Finalization.md` | `src/executor.js` (tail end) | Auto-merge, branch preservation, conflict handling |
| `14_Future_Features.md` | — | All post-MVP items with priority tiers |

## Key Gaps in Source PRD

1. **28 prompts not included** — Live in a Google Doc. Claude Code should pull them during development of `steps.js`. See `06_Prompt_Library.md`.
2. **Error message catalog** — Described narratively across docs but never consolidated. See `11_Error_Handling.md`.
3. **Merge conflict instructions** — "Clear instructions" promised but never defined. Default text provided in `13_Post_Run_Finalization.md`.
4. **Sleep/hibernate handling** — Flagged as a risk but explicitly deferred post-MVP. Warning text provided in `10_CLI_Interface.md`.
5. **Windows-specific edge cases** — Path separators, notification behavior, spawn quirks called out where relevant.
6. **Claude Code rate limiting behavior** — Retry logic defined, but what specific errors/exit codes Claude Code returns for rate limits is unknown. See `05_Claude_Code_Integration.md`.

## Architecture at a Glance

```
User runs `nightytidy`
  → Commander parses args
  → Inquirer shows step selector
  → Pre-run checks (Claude Code, git, disk space)
  → Safety setup (git tag + branch)
  → Step loop (28x):
      1. Send improvement prompt via `claude -p`
      2. Send doc update prompt via `claude -p`
      3. Verify commit (fallback if none made)
      4. Log progress, notify on failure
  → Narrated changelog via `claude -p`
  → Write NIGHTYTIDY-REPORT.md
  → Auto-merge branch back to original
  → Completion notification
```
