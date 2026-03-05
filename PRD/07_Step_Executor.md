# Step Executor

## Overview

The heart of NightyTidy. Orchestrates the sequential execution of selected improvement steps, handling the per-step cycle of: run prompt → run doc update → verify commit → fallback if needed → log → notify on failure. Does not handle pre-run setup or post-run finalization — those are managed by the CLI layer that calls the executor.

## Dependencies

- `02_Logger.md` — logging throughout
- `04_Git_Operations.md` — commit verification, fallback commits
- `05_Claude_Code_Integration.md` — `runPrompt()` for Claude Code invocations
- `06_Prompt_Library.md` — `STEPS`, `DOC_UPDATE_PROMPT`, `CHANGELOG_PROMPT`
- `08_Notifications.md` — desktop notifications on step failure
- `09_Report_Generation.md` — collects step results for final report

## Module: `src/executor.js`

### Exported Interface

```javascript
// Run all selected steps sequentially. Returns collected results for reporting.
// selectedSteps: array of step objects from STEPS (filtered by user selection)
// projectDir: the project directory path
export async function executeSteps(selectedSteps, projectDir)
```

### Return Value

```javascript
{
  results: [
    {
      step: { number: 1, name: "Documentation" },
      status: "completed",     // "completed" | "skipped" | "failed"
      output: "Claude Code's response text",
      duration: 184000,        // milliseconds
      attempts: 1,             // 1-4
      error: null              // error message if failed
    },
    // ... one entry per selected step
  ],
  totalDuration: 28800000,     // total wall-clock time for all steps
  completedCount: 20,
  failedCount: 1,
  skippedCount: 1
}
```

Status definitions:
- **`completed`** — step prompt succeeded, doc update ran, commit verified or fallback made
- **`failed`** — step prompt failed all retry attempts. Step was skipped, run continued.
- **`skipped`** — reserved for future use (e.g., user-deselected steps that need to appear in the report for completeness). In MVP, only `completed` and `failed` are used since deselected steps aren't in `selectedSteps` at all.

### Per-Step Execution Flow

For each step in `selectedSteps`, the executor runs this sequence:

```
┌─────────────────────────────────────────┐
│ 1. Update spinner: "⏳ Step 3/28: ..."  │
│ 2. Log: step starting                   │
│ 3. Record HEAD hash (pre-step)          │
├─────────────────────────────────────────┤
│ 4. Run improvement prompt               │
│    └─ via runPrompt(step.prompt, cwd)   │
│    └─ includes retry logic (up to 3)    │
│                                          │
│    ┌─ SUCCESS ──────────────────────┐    │
│    │                                │    │
│    │ 5. Run doc update prompt       │    │
│    │    └─ runPrompt(DOC_UPDATE)    │    │
│    │                                │    │
│    │ 6. Check if commit was made    │    │
│    │    └─ hasNewCommit(preHash)    │    │
│    │                                │    │
│    │ 7a. If committed: log ✓        │    │
│    │ 7b. If not: fallbackCommit()   │    │
│    │                                │    │
│    │ 8. Record result: completed    │    │
│    └────────────────────────────────┘    │
│                                          │
│    ┌─ FAILURE (all retries) ────────┐    │
│    │                                │    │
│    │ 5. Log error details           │    │
│    │ 6. Send failure notification   │    │
│    │ 7. Record result: failed       │    │
│    │ 8. Continue to next step       │    │
│    └────────────────────────────────┘    │
└─────────────────────────────────────────┘
```

### Detailed Step Walkthrough

#### Step 1-3: Setup

```javascript
spinner.text = `⏳ Step ${step.number}/${totalSteps}: ${step.name}...`;
info(`Step ${step.number}/${totalSteps}: ${step.name} — starting`);
const preStepHash = await getHeadHash();
```

The spinner (ora) is managed by the caller (`cli.js`), passed to the executor, or managed internally. Either approach works — the key is that the spinner text updates before each step.

#### Step 4: Run Improvement Prompt

```javascript
const result = await runPrompt(step.prompt, projectDir);
```

`runPrompt` handles retries internally (see `05_Claude_Code_Integration.md`). The executor receives a final success/failure result.

#### Step 5: Run Doc Update Prompt (on success only)

```javascript
const docResult = await runPrompt(DOC_UPDATE_PROMPT, projectDir);
```

The doc update also gets retries. If the improvement prompt succeeded but the doc update fails all retries, this is logged as a warning but the step is still marked `completed` — the improvement work was done, only the doc update failed.

```
[WARN] Step 3: Doc update failed after retries — improvement changes preserved but docs may be stale
```

#### Step 6-7: Commit Verification

```javascript
const committed = await hasNewCommit(preStepHash);
if (committed) {
  info(`Step ${step.number}: committed by Claude Code ✓`);
} else {
  await fallbackCommit(step.number, step.name);
  info(`Step ${step.number}: fallback commit made ✓`);
}
```

The fallback commit ensures no work is silently lost. See `04_Git_Operations.md` for details on the fallback behavior when there are no actual changes.

#### Failure Path

```javascript
if (!result.success) {
  error(`Step ${step.number}: ${step.name} — failed after ${result.attempts} attempts`);
  notify(`Step ${step.number} (${step.name}) failed`, 
         `Failed after ${result.attempts} attempts. Run continuing with next step.`);
  stepResults.push({ step, status: 'failed', error: result.error, ... });
  continue; // next step
}
```

Failures never halt the run. The executor logs, notifies, records, and moves on.

### Timing

The executor records:
- **Per-step duration**: wall-clock time from step start to step complete (including retries, doc update, and commit)
- **Total duration**: wall-clock time from first step start to last step complete

These are included in the results for the report. Start times are captured with `Date.now()` at the beginning of each step and at the beginning of the full run.

### Terminal Output During Execution

The executor updates the terminal with:
- **ora spinner**: Shows current step name and number. Updated at each step transition.
- **On step completion**: Spinner briefly shows green checkmark, then resets for next step.
- **On step failure**: Spinner briefly shows red X, then resets for next step.

The spinner should be stopped (not just text-updated) before writing log lines to stdout to avoid garbled output. Pattern:

```javascript
spinner.stop();
info(`Step 3 completed`);  // writes to stdout cleanly
spinner.start(`⏳ Step 4/28: ...`);
```

### Abort Handling

If the executor receives an abort signal (from Ctrl+C handling in `cli.js`):
1. Wait for the current `runPrompt` call to complete (or kill it — see `10_CLI_Interface.md`)
2. Do NOT start the next step
3. Perform a fallback commit for any uncommitted work from the current step
4. Return the results collected so far (partial results)
5. The caller handles cleanup (merge what's done, notify user)

The executor should accept an `AbortSignal` or similar mechanism:

```javascript
export async function executeSteps(selectedSteps, projectDir, { signal } = {})
```

Before each step, check: `if (signal?.aborted) break;`

### Narrated Changelog

After all steps complete (or are attempted), the executor runs the narrated changelog prompt:

```javascript
const changelogResult = await runPrompt(CHANGELOG_PROMPT, projectDir);
```

This is a separate phase, not a "step." If it fails, the report is generated without the narrated section and a warning is logged. The run is still considered complete.

The changelog output is passed to the report generator. See `09_Report_Generation.md`.

## Testing Notes

- **Mock `runPrompt`** to return controlled success/failure results without spawning Claude Code.
- **Mock git operations** — `getHeadHash`, `hasNewCommit`, `fallbackCommit`.
- **Mock notifications** — verify `notify` is called on failure and not on success.
- Test cases:
  - All steps succeed
  - One step fails, rest succeed (verify skip-and-continue)
  - All steps fail (verify run completes with all failures)
  - Doc update fails but improvement succeeded (step still `completed`)
  - Abort signal mid-run (verify partial results returned)
  - No changes detected in a step (fallback commit skips gracefully)
  - Narrated changelog fails (report generated without it)

## Gaps & Assumptions

- **Step interdependencies** — Some later steps may assume earlier steps ran (e.g., "Test Hardening" assumes tests were created by "Test Coverage"). If a user deselects earlier steps, later steps may be less effective. No mitigation in MVP — the step selector shows all 28 pre-selected for a reason.
- **Claude Code session isolation** — Each prompt runs in a fresh session, but they all operate on the same filesystem. Changes from step 1 are visible to step 2. This is intentional — steps build on each other.
- **Memory pressure** — 28 sequential Claude Code sessions over 4-12 hours. Each session is a separate process that starts and exits. No memory accumulation concern from NightyTidy's side, but the user's machine needs to handle Claude Code's own memory usage per session.
