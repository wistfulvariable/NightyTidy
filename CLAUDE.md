# NightyTidy

Automated overnight codebase improvement through Claude Code.

## Tech Stack

- Node.js >=18 LTS, JavaScript ESM (no TypeScript, no build step)
- `"type": "module"` — all code uses `import`/`export`

## Module Map

| File | Responsibility |
|------|---------------|
| `bin/nightytidy.js` | Entry point — imports and calls `run()` |
| `src/cli.js` | Commander + Inquirer + full lifecycle orchestration |
| `src/executor.js` | Core step loop — runs prompts sequentially |
| `src/claude.js` | Claude Code subprocess wrapper (spawn, retry, timeout) |
| `src/git.js` | Git operations via simple-git |
| `src/checks.js` | Pre-run validation (git, Claude Code, disk space) |
| `src/notifications.js` | Desktop notifications via node-notifier |
| `src/logger.js` | File + stdout logger (~50 LOC) |
| `src/report.js` | NIGHTYTIDY-REPORT.md generation |
| `src/prompts/steps.js` | 28 improvement prompts + doc update + changelog prompts |

## Conventions

- All code is ESM (`import`/`export`, never `require`)
- Logger used everywhere — no bare `console.log` in production code
- All async operations use async/await
- Error handling: every public function either handles errors or explicitly throws

## Testing

- Vitest: `npm test` (single pass), `npm run test:watch` (watch mode)
- Mock Claude Code, use real git against temp directories
- Test failure paths harder than success paths

## Architecture

NightyTidy orchestrates but doesn't do the work — Claude Code does. NightyTidy's job is sequencing, git management, retries, notifications, and reporting.
