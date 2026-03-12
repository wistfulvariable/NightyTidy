# Project Memory — Index

NightyTidy: automated overnight codebase improvement via Claude Code subprocess orchestration. See CLAUDE.md for rules.

## Current State

- **Version**: 0.1.0
- **Test count**: 848 (34 test files, all passing)
- **Coverage**: src/ at 90% stmts, 80% branches, 80% functions (thresholds enforced by test:ci)
- **Last major change**: Single-session report generation; init overlay real-time progress polling

## Recent Changes

- Single-session report generation replaces fragmented 3-step process (`finishRun` combines narration + token summary)
- Init overlay replaced rotating messages with real-time progress polling from orchestrator
- Sync refactor prompts to target repo; `finishRun` output streaming
- Report narration hardening, cost rounding to cents, token summary in reports
- 4 new test files: `cli-sync.test.js`, `executor-extended.test.js`, `lock-extended.test.js`, `dashboard-extended2.test.js`
- GUI FINISHING screen has escape hatch: skip button (10s delay) + 3-min auto-timeout + try/catch
- `gui/server.js` `handleRunCommand` has `responded` guard to prevent double `sendJson` on spawn failure

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
