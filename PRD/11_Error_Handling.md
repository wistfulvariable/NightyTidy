# Error Handling

## Overview

Cross-cutting error handling strategy for NightyTidy. Covers the top-level error wrapper, error classification, the user-facing error message catalog, and the principle that no error should ever leave the repo in a broken state or silently kill the run.

## Dependencies

- `02_Logger.md` — all errors are logged
- `08_Notifications.md` — critical errors trigger notifications
- All other modules follow these patterns

## Core Principles

1. **Never show raw stack traces to the user.** Stack traces go to the log file at debug level. The user sees a plain-English error message.
2. **Never leave the repo in a broken state.** If NightyTidy crashes, the pre-run git tag ensures rollback is always possible. The working tree should be in a valid git state after any error.
3. **Fail fast on detectable preconditions.** Pre-run checks catch problems before the multi-hour run starts. See `03_Pre_Run_Checks.md`.
4. **Degrade gracefully during the run.** Individual step failures are logged and skipped — they never halt the entire run. Only truly fatal errors (git corruption, out of disk space) stop everything.
5. **Every error message tells the user what to do.** Not just "X failed" but "X failed — do Y to fix it."

## Error Classification

### Fatal Errors (halt the run)

These stop the run immediately. The user gets a terminal error message and a notification.

| Error | When | User Message |
|-------|------|-------------|
| Pre-check failure | Before run starts | Specific per check — see `03_Pre_Run_Checks.md` |
| Git branch creation fails | Run setup | `"Couldn't create the NightyTidy branch. Check that git is working in this directory."` |
| Git tag creation fails | Run setup | `"Couldn't create the safety snapshot. Check git permissions in this directory."` |
| Disk full during run | Mid-run | `"Disk space ran out during the run. Free space and try again. Your code is safe — reset to tag {tagName} if needed."` |
| Git corrupted during run | Mid-run | `"Git encountered an error. Your code is safe — reset to tag {tagName} to restore. Check nightytidy-run.log for details."` |

Fatal errors during the run (after setup) should attempt to:
1. Stop the executor
2. Log the error with full context
3. Send a desktop notification
4. Print the user-facing message with the safety tag name
5. Exit with code 1

### Recoverable Errors (step-level)

These are handled by the retry-then-skip pattern. They don't halt the run.

| Error | Handling | User Awareness |
|-------|----------|----------------|
| Claude Code exits non-zero | Retry up to 3 times, then skip | Desktop notification per failure |
| Claude Code timeout | Retry up to 3 times, then skip | Desktop notification per failure |
| Claude Code spawn failure | Retry up to 3 times, then skip | Desktop notification per failure |
| Doc update prompt fails | Log warning, step still marked completed | In log file only |
| Fallback commit fails (nothing to commit) | Log info, continue | In log file only |
| Narrated changelog fails | Generate report without narration | Fallback text in report |

### Ignored Errors (non-critical)

These are logged but never surface to the user or affect the run.

| Error | Handling |
|-------|----------|
| Desktop notification fails to send | Log warning, continue |
| Logger file write fails | Print to stderr, continue without file logging |
| CLAUDE.md update fails | Log warning, report still generated |
| Welcome marker file creation fails | Log debug, show welcome again next time |

## Top-Level Error Wrapper

The `run()` function in `cli.js` wraps the entire pipeline:

```javascript
export async function run() {
  let spinner;
  try {
    // ... full pipeline
  } catch (err) {
    spinner?.stop();
    
    // User-friendly message to terminal
    console.error(chalk.red(`\n❌ ${err.message}`));
    
    // Full details to log
    error(`Fatal: ${err.message}`);
    debug(`Stack: ${err.stack}`);
    
    // Notification for fatal errors during run (not pre-check failures)
    if (runStarted) {
      notify('NightyTidy Error', `Run stopped: ${err.message}. Check nightytidy-run.log.`);
      // Include safety tag info if available
      console.error(chalk.yellow(`\n💡 Your code is safe. Reset to tag ${tagName} to undo any changes.`));
    }
    
    process.exit(1);
  }
}
```

### Unhandled Rejections

As a safety net, catch unhandled promise rejections at the process level:

```javascript
process.on('unhandledRejection', (reason) => {
  error(`Unhandled rejection: ${reason}`);
  console.error(chalk.red(`\n❌ An unexpected error occurred. Check nightytidy-run.log for details.`));
  process.exit(1);
});
```

This should never fire if error handling is implemented correctly, but it prevents silent failures.

## Error Context Pattern

When throwing errors from internal modules, include context that helps both the user and the developer:

```javascript
// In git.js
async function createRunBranch(sourceBranch) {
  try {
    await git.checkoutLocalBranch(branchName);
  } catch (err) {
    throw new Error(
      `Couldn't create branch ${branchName}: ${err.message}`
    );
  }
}
```

The top-level handler displays the outer message to the user. The full chain (including the original git error) goes to the log.

## Error Message Writing Guidelines

For anyone adding new error messages:

1. **No jargon.** Write for someone who types commands in VS Code's terminal but doesn't know what a "process exit code" is.
2. **Be specific.** "Claude Code failed" → "Claude Code stopped responding during Step 7 (File Decomposition)."
3. **Include the fix.** Every error message ends with what the user should do: try again, check a file, install something, free disk space.
4. **Include the safety net.** If the run has started, always mention the pre-run tag: "Your code is safe — reset to tag {tagName} if needed."
5. **Keep it short.** 1-2 sentences max. Details go in the log.

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Run completed (all steps succeeded OR some failed but the run finished) |
| 1 | Fatal error — run could not complete |

Note: a run where some steps failed but others succeeded still exits 0. The report and notifications communicate partial success. Exit code 1 is reserved for errors that prevented the run from executing at all or caused it to abort mid-run.

## Testing Notes

- Test the top-level try/catch by throwing from mocked dependencies
- Verify stack traces are logged but not printed to stdout
- Verify the correct exit code for various scenarios
- Test the unhandled rejection handler
- Verify notification is sent on fatal error during run but not on pre-check failure (pre-check failures happen before "run started" notification)

## Gaps & Assumptions

- **Error telemetry** — No error reporting to Anthropic or any external service. Errors are local only (terminal + log file). Acceptable for an internal tool.
- **Retry exhaustion across multiple steps** — If Claude Code is having an extended outage, many steps will fail sequentially. The user gets a notification per failure. No circuit-breaker pattern in MVP (e.g., "3 steps in a row failed, pausing the run"). Consider for post-MVP.
- **Disk full detection mid-run** — The pre-run check verifies disk space at launch, but disk could fill during a long run. Node.js file write errors will surface this, but there's no proactive monitoring. The error handler catches it reactively.
