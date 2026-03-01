# CLI Lifecycle — Tier 2 Reference

Assumes CLAUDE.md loaded. Orchestration lives in `src/cli.js` (~282 lines).

## Entry Point

`bin/nightytidy.js` → `import { run } from '../src/cli.js'` → `run()`

## Commander Setup

```js
program.name('nightytidy').description('...').version('0.1.0');
program.parse();
```

No subcommands, no options beyond `--version` and `--help`. `projectDir = process.cwd()`.

## Lifecycle Steps (in order)

1. **Logger init**: `initLogger(projectDir)` — writes to `nightytidy-run.log`
2. **Welcome screen**: `showWelcome()` — one-time only, marker at `~/.nightytidy/welcome-shown`
3. **Git init + pre-checks**: `initGit(projectDir)` → `runPreChecks(projectDir, git)`
4. **Step selection**: `@inquirer/checkbox` — all 28 steps checked by default, `pageSize: 15`
5. **Sleep tip**: Console message about disabling sleep (4-8 hours typical)
6. **Git setup**: `getCurrentBranch()` → `createPreRunTag()` → `createRunBranch()`
7. **Start notification**: `notify('NightyTidy Started', ...)`
8. **Spinner**: `ora` spinner with step progress
9. **Execute steps**: `executeSteps(selected, projectDir, { signal, callbacks })`
10. **Changelog**: `runPrompt(CHANGELOG_PROMPT, ...)` — separate from executor
11. **Report**: `generateReport(results, narration, metadata)`
12. **Commit report**: `git.add(['NIGHTYTIDY-REPORT.md', 'CLAUDE.md'])` + commit
13. **Merge**: `mergeRunBranch(originalBranch, runBranch)`
14. **Completion notification + terminal summary**

## Abort Handling (SIGINT/Ctrl+C)

- `AbortController` + `abortController.signal` passed to executor
- First SIGINT: sets `interrupted = true`, calls `abort()`, prints warning
- Second SIGINT: `process.exit(1)` — force quit
- On interrupted run: generates partial report, commits it, notifies user

## Error Handling

- `process.on('unhandledRejection')` — logs and exits with code 1
- Top-level `try/catch` in `run()` — catches everything
- If error after `runStarted = true`: notifies user, shows safety tag

## Executor Callbacks

```js
{
  signal: abortController.signal,
  onStepStart: (step, idx, total) => { /* update spinner */ },
  onStepComplete: (step, idx, total) => { /* green checkmark, restart spinner */ },
  onStepFail: (step, idx, total) => { /* red X, restart spinner */ },
}
```

## Terminal Summary

Uses `formatDuration(ms)` imported from `report.js`:
- `>= 1h`: `"Xh YYm"` (e.g., `"1h 02m"`)
- `< 1h`: `"Xm YYs"` (e.g., `"5m 03s"`)

## Merge Result Handling

- **Success + no failures**: Green "all steps succeeded" message
- **Success + some failures**: Yellow warning with counts
- **Merge conflict**: Yellow message with manual merge instructions + Claude Code suggestion
