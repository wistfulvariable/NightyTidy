# CLI Lifecycle — Tier 2 Reference

Assumes CLAUDE.md loaded. Orchestration in `src/cli.js`.

## Entry Point

`bin/nightytidy.js` → `import { run } from '../src/cli.js'` → `run()`

## CLI Flags

| Flag | Type | Default | Behavior |
|------|------|---------|----------|
| `--all` | boolean | false | Run all 33 steps non-interactively |
| `--steps <n>` | string | -- | Comma-separated: `--steps 1,5,12` |
| `--list` | boolean | false | Print step numbers + names, exit(0) |
| `--setup` | boolean | false | Generate CLAUDE.md integration snippet, exit(0) |
| `--timeout <min>` | number | 45 | Per-step timeout in minutes (validated: positive finite) |
| `--dry-run` | boolean | false | Pre-checks + step selection, show plan, no execution |
| `--json` | boolean | false | JSON output (use with `--list`) |
| `--init-run` | boolean | false | Initialize orchestrated run |
| `--run-step <N>` | number | -- | Run single step (validated: positive finite integer) |
| `--finish-run` | boolean | false | Finish orchestrated run |
| `--version` | boolean | false | Print version, exit(0) |

**Input validation**: `--timeout` and `--run-step` both use `parseInt` + `Number.isFinite` + positivity check. Invalid values produce actionable error messages with examples.

**Non-TTY**: Exits with error unless `--all` or `--steps` provided. No interactive selection without TTY.

## Lock File

`acquireLock(projectDir)` creates `nightytidy.lock` (PID + timestamp). Auto-removed via `process.on('exit')`. Stale locks (dead PID via `process.kill(pid, 0)`) cleaned up automatically.

## Internal Structure

`run()` delegates to three internal helpers passing a shared `ctx` object:
- `setupGitAndPreChecks(projectDir)` — git init, exclude files, pre-checks with spinner
- `executeRunFlow(selected, projectDir, ctx)` — dashboard, git branching, step execution, abort handling
- `finalizeRun(executionResults, projectDir, ctx)` — changelog, report, commit, merge, summary, dashboard shutdown

`ctx` fields: `spinner`, `runStarted`, `tagName`, `runBranch`, `originalBranch`, `dashState`, `abortController`, `timeoutMs`

## Lifecycle Steps (in order)

1. **Parse CLI flags** — Commander setup
2. **Logger init**: `initLogger(projectDir)` — MUST be first
3. **Acquire lock** — prevents concurrent runs
4. **Handle --list / --setup** — early exit paths
5. **Welcome screen**: `showWelcome()` — ASCII banner
6. **`setupGitAndPreChecks()`**: `initGit()` → `excludeEphemeralFiles()` → spinner + `runPreChecks()`
7. **Step selection**: `@inquirer/checkbox` or `--all`/`--steps` parsing
8. **`executeRunFlow()`**: dashboard → git branching → notify → spinner + `executeSteps()` → abort handling
9. **`finalizeRun()`**: changelog → report → commit → merge → summary → dashboard shutdown

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
