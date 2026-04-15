# CLI Lifecycle — Tier 2 Reference

Assumes CLAUDE.md loaded. Orchestration in `src/cli.js`.

## Entry Point

`bin/nightytidy.js` → `import { run } from '../src/cli.js'` → `run()`

## CLI Flags

| Flag | Type | Default | Behavior |
|------|------|---------|----------|
| `--all` | boolean | false | Run all 44 steps non-interactively |
| `--steps <n>` | string | -- | Comma-separated: `--steps 1,5,12` |
| `--list` | boolean | false | Print step numbers + names, exit(0) |
| `--setup` | boolean | false | Generate CLAUDE.md integration snippet, exit(0) |
| `--timeout <min>` | number | 120 | Per-step timeout in minutes (validated: positive finite) |
| `--dry-run` | boolean | false | Pre-checks + step selection, show plan, no execution |
| `--json` | boolean | false | JSON output (use with `--list`) |
| `--init-run` | boolean | false | Initialize orchestrated run |
| `--run-step <N>` | number | -- | Run single step (validated: positive finite integer) |
| `--finish-run` | boolean | false | Finish orchestrated run |
| `--skip-sync` | boolean | false | Skip automatic prompt sync from Google Doc before running |
| `--resume` | boolean | false | Resume a previously paused run |
| `--mode <preset>` | string | default | Run mode preset: `default`, `audit` (all read), `improve` (write only, skips read-locked) |
| `--step-modes <json>` | string | -- | Per-step mode overrides as JSON (internal, used by GUI) |
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

`ctx` fields: `spinner`, `runStarted`, `tagName`, `runBranch`, `originalBranch`, `dashState`, `abortController`, `timeoutMs`, `stepModes`

## Lifecycle Steps (in order)

1. **Parse CLI flags** — Commander setup
2. **Logger init**: `initLogger(projectDir)` — MUST be first
3. **Acquire lock** — prevents concurrent runs
4. **Handle --list / --setup** — early exit paths
5. **Welcome screen**: `showWelcome()` — ASCII banner
6. **`setupGitAndPreChecks()`**: `initGit()` → `excludeEphemeralFiles()` → spinner + `runPreChecks()`
7. **Auto-sync prompts**: `autoSyncPrompts(opts)` — syncs from Google Doc, calls `reloadSteps()` if changes. Non-blocking on failure. Skipped with `--skip-sync`.
8. **Step selection**: `@inquirer/checkbox` or `--all`/`--steps` parsing → returns `{ steps, stepModes }`
8b. **Mode selection**: `@inquirer/select` preset prompt (Default/Audit/Improve) or `--mode` flag → `buildStepModesFromPreset()` builds stepModes map
9. **`executeRunFlow()`**: dashboard → git branching → `copyPromptsToProject()` + commit → notify → spinner + `executeSteps()` → abort handling
10. **`finalizeRun()`**: changelog → action plan → report (with inline action plan) → commit → merge → summary → dashboard shutdown

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
  onRateLimitPause(retryAfterMs),   // Stop spinner, yellow warning + wait estimate
  onRateLimitResume(),              // Green confirmation, restart spinner
}
```

## Merge Result Handling

- **Success + no failures**: Green "all steps succeeded"
- **Success + some failures**: Yellow warning with counts
- **Merge conflict**: Yellow message + manual merge instructions
