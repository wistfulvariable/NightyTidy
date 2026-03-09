# Executor Loop — Tier 2 Reference

Assumes CLAUDE.md loaded. Core loop in `src/executor.js`.

## Exports

- `executeSteps(selectedSteps, projectDir, options)` — main loop
- `SAFETY_PREAMBLE` — constraint string prepended to every prompt

## Safety Preamble

`SAFETY_PREAMBLE` is prepended to ALL prompts (improvement, doc update, changelog). Prevents Claude subprocess from:
- Deleting files
- Creating/switching/merging branches
- Running destructive git commands (reset, clean, checkout, rm)

These are orchestrator responsibilities, not subprocess responsibilities.

## Step Execution Flow

For each step in `selectedSteps`:

```
1. Check abort signal → break if aborted
2. onStepStart(step, i, total)
3. Capture pre-step HEAD hash via getHeadHash()
4. Run improvement: runPrompt(SAFETY_PREAMBLE + step.prompt, projectDir, { signal, label })
5. If failed → log, notify, push failed result, onStepFail, continue
6. Run doc update: runPrompt(SAFETY_PREAMBLE + DOC_UPDATE_PROMPT, ...)
7. If doc update failed → warn (non-fatal, step still completed)
8. Check commits: hasNewCommit(preStepHash)
9. If no new commit → fallbackCommit(step.number, step.name)
10. Push completed result, onStepComplete
```

## Result Object

```js
{
  results: [{ step: { number, name }, status, output, duration, attempts, error, cost }],
  totalDuration: number,
  completedCount: number,
  failedCount: number,
}
// cost: { costUSD, numTurns, durationApiMs, sessionId } | null
```

Each step's cost = improvement cost + doc-update cost (summed via `sumCosts()`). Failed steps have `cost: null`.

## Key Behaviors

- **Failed improvement → skip doc update** — step marked failed immediately
- **Failed doc update → step still completed** — only logs warning
- **No parallel execution** — strictly sequential, one step at a time
- **Notifications** — sent for failed steps only

## Abort Signal Threading

Signal flows: `cli.js AbortController` → `executeSteps(signal)` → `runPrompt(signal)` → `runOnce()` → `waitForChild()` → `child.kill()`

- Checked at START of each iteration AND threaded into `runPrompt()`
- Running subprocess killed immediately on abort
- Retry sleeps short-circuit on abort
- Dashboard Stop button triggers `abortController.abort()` via `onStop` callback

## Callbacks

| Callback | When | Used By |
|----------|------|---------|
| `onStepStart(step, idx, total)` | Before improvement prompt | cli.js spinner + dashboard |
| `onStepComplete(step, idx, total)` | After commit verification | cli.js green checkmark |
| `onStepFail(step, idx, total)` | After improvement fails | cli.js red X |

## Dependencies

- `runPrompt` from `claude.js`
- `getHeadHash`, `hasNewCommit`, `fallbackCommit` from `git.js`
- `DOC_UPDATE_PROMPT` from `prompts/loader.js`
- `notify` from `notifications.js`
