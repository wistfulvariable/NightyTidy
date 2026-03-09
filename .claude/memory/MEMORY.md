# Project Memory — Index

NightyTidy: automated overnight codebase improvement via Claude Code subprocess orchestration. See CLAUDE.md for rules.

## Current State

- **Version**: 0.1.0
- **Test count**: 414 (27 test files, all passing)
- **Coverage**: src/ at 90% stmts, 90% branches, 95% functions. Overall 65% due to untested gui/bin/scripts dirs.
- **Last major change**: Desktop GUI + orchestrator mode + markdown prompt refactor

## Recent Changes

- Desktop GUI: `gui/server.js` + `gui/resources/` (Chrome app-mode launcher, folder dialog, process management)
- Orchestrator mode: `--init-run`, `--run-step`, `--finish-run` for Claude Code-driven workflows
- Prompt refactor: monolithic `steps.js` replaced with `manifest.json` + individual markdown files in `src/prompts/`
- Dashboard standalone server for orchestrator mode (`dashboard-standalone.js`)
- GUI test coverage: `gui-logic.test.js` (43 tests), `gui-server.test.js` (26 tests)
- Test consolidation audit: 5 files cleaned, 133 net LOC removed, zero coverage loss

## Topic Files

| File | When to load |
|------|-------------|
| `testing.md` | Writing or fixing tests |
| `claude-integration.md` | Changing Claude Code subprocess handling |
| `cli-lifecycle.md` | Modifying the CLI run() orchestration |
| `executor-loop.md` | Modifying step execution or doc-update flow |
| `git-workflow.md` | Changing branching, tagging, or merge logic |
| `dashboard.md` | Changing progress display (HTTP, TUI, SSE) |
| `report-generation.md` | Changing report format or CLAUDE.md auto-update |
| `prompts.md` | Modifying or adding improvement prompts |
| `pitfalls.md` | Debugging platform-specific or subprocess issues |

## Memory File Rules

- One topic per file, 40-80 lines each
- Terse reference format: tables, bullets, code snippets — no prose
- Name files by topic (`testing.md`), not area (`backend-stuff.md`)
- Split any file that exceeds 80 lines
- Update this index when creating or removing files
