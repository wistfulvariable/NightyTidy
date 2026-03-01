# Project Memory — Index

NightyTidy: automated overnight codebase improvement via Claude Code subprocess orchestration. See CLAUDE.md for full rules and conventions.

## Current State

- **Version**: 0.1.0
- **Test count**: 50 (7 test files, all passing)
- **Source files**: 9 modules in `src/`, 1 entry point in `bin/`
- **Prompt count**: 28 improvement steps + DOC_UPDATE_PROMPT + CHANGELOG_PROMPT
- **Last major change**: Initial implementation (commit `36e47ee`)
- **Technical debt**: Minimal — no config file, prompts source not committed

## Topic Files

| File | When to load |
|------|-------------|
| `testing.md` | Writing or fixing tests |
| `prompts.md` | Modifying or adding improvement prompts |
| `git-workflow.md` | Changing branching, tagging, or merge logic |
| `cli-lifecycle.md` | Modifying the CLI run() orchestration |
| `claude-integration.md` | Changing Claude Code subprocess handling |
| `executor-loop.md` | Modifying step execution or doc-update flow |
| `report-generation.md` | Changing report format or CLAUDE.md auto-update |
| `pitfalls.md` | Debugging platform-specific or subprocess issues |

## Cross-Cutting Patterns

- **Every module imports logger** — `import { info, warn, error, debug } from './logger.js'`
- **Error contracts are per-module** — see CLAUDE.md error handling table; never change without updating callers
- **Singleton init pattern** — `logger.js` and `git.js` have module-level state; init once in `cli.js`
- **Tests always mock logger** — prevents file I/O; omitting this crashes the test

## Memory File Rules

- One topic per file, 40-80 lines each
- Terse reference format: tables, bullets, code snippets — no prose
- Name files by topic (`testing.md`), not area (`backend-stuff.md`)
- Split any file that exceeds 80 lines
- Update this index when creating or removing files
