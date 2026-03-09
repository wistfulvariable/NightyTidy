# CLI Lifecycle — Tier 2 Reference

Assumes CLAUDE.md loaded. Orchestration in `src/cli.js`.

## Entry Point

`bin/nightytidy.js` → `import { run } from '../src/cli.js'` → `run()`

## CLI Flags

| Flag | Type | Default | Behavior |
|------|------|---------|----------|
| `--all` | boolean | false | Run all 33 steps non-interactively |
| `--steps <n>` | string | — | Comma-separated: `--steps 1,5,12` |
| `--list` | boolean | false | Print step numbers + names, exit(0) |
| `--setup` | boolean | false | Generate CLAUDE.md integration snippet, exit(0) |
| `--timeout <min>` | number | 45 | Per-step timeout in minutes (converted to ms) |
| `--version` | boolean | false | Print version, exit(0) |

**Non-TTY**: Exits with error unless `--all` or `--steps` provided. No interactive selection without TTY.

## Lock File

`acquireLock(projectDir)` creates `nightytidy.lock` (PID + timestamp). Auto-removed via `process.on('exit')`. Stale locks (dead PID via `process.kill(pid, 0)`) cleaned up automatically.

## Lifecycle Steps (in order)

1. **Parse CLI flags** — Commander setup
2. **Logger init**: `initLogger(projectDir)` — MUST be first
3. **Acquire lock** — prevents concurrent runs
4. **Handle --list / --setup** — early exit paths
5. **Welcome screen**: `showWelcome()` — ASCII banner
6. **Git init + exclude**: `initGit()` → `excludeEphemeralFiles()`
7. **Pre-checks**: `runPreChecks(projectDir, git)` — 7 checks, throws on failure
8. **Step selection**: `@inquirer/checkbox` or `--all`/`--steps` parsing
9. **Start dashboard**: HTTP server + TUI window spawn (fire-and-forget)
10. **Git setup**: `getCurrentBranch()` → `createPreRunTag()` → `createRunBranch()`
11. **Start notification**: `notify('NightyTidy Started', ...)`
12. **Spinner + execute**: `ora()` + `executeSteps(selected, projectDir, { signal, callbacks })`
13. **Changelog**: `runPrompt(CHANGELOG_PROMPT, ...)` — separate from executor
14. **Report**: `generateReport()` → commit → `mergeRunBranch()`
15. **Completion summary** — notification + terminal output
16. **Schedule dashboard shutdown** — 3s delay then close

## Abort Handling (SIGINT)

- `AbortController` created upfront, signal passed to executor
- **First SIGINT**: `abortController.abort()`, generate partial report, commit, `stopDashboard()`, exit(0)
- **Second SIGINT**: `process.exit(1)` force quit
- Abort calls `stopDashboard()` directly (not `scheduleShutdown()` — `process.exit` kills timers)

## Error Handling

- `process.on('unhandledRejection')` → log + exit(1)
- Top-level `try/catch` in `run()` catches everything
- Post-start errors: notify user, show safety tag for recovery

## Executor Callbacks

```js
{
  signal: abortController.signal,
  onStepStart(step, idx, total),    // Update spinner + dashboard
  onStepComplete(step, idx, total), // Green checkmark
  onStepFail(step, idx, total),     // Red X + desktop notification
}
```

## Merge Result Handling

- **Success + no failures**: Green "all steps succeeded"
- **Success + some failures**: Yellow warning with counts
- **Merge conflict**: Yellow message + manual merge instructions
