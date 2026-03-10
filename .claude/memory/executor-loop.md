# Executor Loop — Tier 2 Reference

Assumes CLAUDE.md loaded. Core loop in `src/executor.js`.

## Exports

- `executeSteps(selectedSteps, projectDir, options)` — main loop
- `executeSingleStep(step, projectDir, options)` — single step with fast-completion detection
- `SAFETY_PREAMBLE` — constraint string prepended to every prompt
- `FAST_COMPLETION_THRESHOLD_MS` — 120,000ms (2 min); steps completing faster trigger auto-retry

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
6. **Fast-completion check**: if improvement succeeded in < FAST_COMPLETION_THRESHOLD_MS (2 min):
   - Log warning, run ONE retry with FAST_RETRY_PREFIX + original prompt
   - If retry succeeds → use retry result (costs/attempts summed with original)
   - If retry fails → fall back to original fast result
   - Set `suspiciousFast: true` on result either way
7. Run doc update: runPrompt(SAFETY_PREAMBLE + DOC_UPDATE_PROMPT, ...)
8. If doc update failed → warn (non-fatal, step still completed)
9. Check commits: hasNewCommit(preStepHash)
10. If no new commit → fallbackCommit(step.number, step.name)
11. Push completed result, onStepComplete
```

## Result Object

```js
{
  results: [{ step: { number, name }, status, output, duration, attempts, error, cost, suspiciousFast?, errorType?, retryAfterMs? }],
  totalDuration: number,
  completedCount: number,
  failedCount: number,
}
// cost: { costUSD, inputTokens, outputTokens, numTurns, durationApiMs, sessionId } | null
// errorType: 'rate_limit' | 'unknown' (on failed steps only)
// retryAfterMs: number | null (on rate-limit failures)
```

Each step's cost = improvement cost + doc-update cost (summed via `sumCosts()`). `sumCosts()` adds all numeric fields; token fields are `null` when both inputs lack them. Failed steps have `cost: null`.

## Key Behaviors

- **Failed improvement → skip doc update** — step marked failed immediately
- **Failed doc update → step still completed** — only logs warning
- **No parallel execution** — strictly sequential, one step at a time
- **Notifications** — sent for failed steps only
- **Fast completion → auto-retry once** — if improvement succeeds in < 2 min, retry with augmented prompt. No recursive retry (if retry is also fast, `suspiciousFast: true` flags it for the orchestrator/user). The retry is a separate `runPrompt` call, not consuming the normal retry budget.
- **Rate-limit pause/resume** — when a step fails with `errorType === ERROR_TYPE.RATE_LIMIT`, `executeSteps()` calls `onRateLimitPause?.(retryAfterMs)`, enters `waitForRateLimit()`, and on success calls `onRateLimitResume?.()` then retries the same step (pops failed result, decrements index). If rate limit never clears or signal aborted, breaks the loop for partial results.

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
| `onRateLimitPause(retryAfterMs)` | Rate limit detected | cli.js yellow warning |
| `onRateLimitResume()` | Rate limit cleared | cli.js green confirmation |

## Rate-Limit Wait (`waitForRateLimit`)

Unexported. Called by `executeSteps()` when a step fails with rate-limit error.

- If `retryAfterMs` provided: sleep that + 10s buffer, return `!aborted`
- Otherwise: exponential backoff `BACKOFF_SCHEDULE_MS = [2m, 5m, 15m, 30m, 1h, 2h]`
- After each wait: probe with `runPrompt('Reply with the single word OK.', projectDir, { retries: 0, timeout: 60s })`
- Probe success → return `true` (resume). Non-rate-limit error → return `true` (let main loop handle). Still rate-limited → next backoff tier. All exhausted → return `false` (stop run).

## Dependencies

- `runPrompt`, `ERROR_TYPE`, `sleep` from `claude.js`
- `getHeadHash`, `hasNewCommit`, `fallbackCommit` from `git.js`
- `DOC_UPDATE_PROMPT` from `prompts/loader.js`
- `notify` from `notifications.js`
