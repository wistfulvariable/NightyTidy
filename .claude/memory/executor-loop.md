# Executor Loop — Tier 2 Reference

Assumes CLAUDE.md loaded. Core loop in `src/executor.js` (94 lines).

## Single Export

`executeSteps(selectedSteps, projectDir, { signal, onStepStart, onStepComplete, onStepFail })`

## Step Execution Flow

For each step in `selectedSteps`:

```
1. Check abort signal → break if aborted
2. onStepStart(step, i, total)
3. Capture pre-step HEAD hash
4. Run improvement prompt: runPrompt(step.prompt, projectDir, { label })
5. If failed → log, notify, push failed result, onStepFail, continue to next step
6. Run doc update: runPrompt(DOC_UPDATE_PROMPT, projectDir, { label })
7. If doc update failed → warn (non-fatal), step still counts as completed
8. Check if Claude committed: hasNewCommit(preStepHash)
9. If not committed → fallbackCommit(step.number, step.name)
10. Push completed result, onStepComplete
```

## Result Object

```js
{
  results: [{
    step: { number, name },
    status: 'completed' | 'failed',
    output: string,
    duration: number,    // ms for this step
    attempts: number,    // from runPrompt
    error: string|null,
  }],
  totalDuration: number,    // ms for entire run
  completedCount: number,
  failedCount: number,
}
```

## Key Behaviors

- **Failed improvement → skip doc update** — the step is marked failed immediately
- **Failed doc update → step still completed** — only logs a warning
- **Abort signal** — checked at the START of each step, not mid-prompt
- **Notifications** — sent for failed steps only (not for success)
- **No parallel execution** — strictly sequential, one step at a time

## Callbacks

| Callback | When | Used By |
|----------|------|---------|
| `onStepStart(step, idx, total)` | Before running improvement prompt | cli.js spinner update |
| `onStepComplete(step, idx, total)` | After successful commit verification | cli.js green checkmark |
| `onStepFail(step, idx, total)` | After improvement prompt fails | cli.js red X |

## Abort Handling

- `signal` is an `AbortSignal` from `AbortController`
- Checked at the top of each iteration, NOT during `runPrompt` execution
- If aborted: breaks out of loop, returns partial results
- A running Claude subprocess continues until it finishes — abort just prevents next step

## Dependencies

- `runPrompt` from `claude.js`
- `getHeadHash`, `hasNewCommit`, `fallbackCommit` from `git.js`
- `DOC_UPDATE_PROMPT` from `prompts/steps.js`
- `notify` from `notifications.js`
