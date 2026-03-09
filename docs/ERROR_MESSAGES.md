# Error Messages Reference

All user-facing error messages in NightyTidy, grouped by feature. Use this as a reference when adding new messages or modifying existing ones.

---

## Message Style Guide

### Structure Template

Every error message should follow this pattern:

```
[What happened] + [Why (if known)] + [What to do next]
```

### Voice & Tone

- **Blame-free**: Never blame the user. Say "Please enter..." not "You entered an invalid..."
- **Specific**: Name the thing that failed and why. Avoid "something went wrong."
- **Actionable**: Every error gives a next step — fix it, retry, or get help.
- **Consistent formality**: Friendly but professional. No slang, no excessive apology.
- **Technical level**: Target audience is developers ("vibe coders"), so basic dev terms (git, branch, PATH) are fine. Avoid OS-level jargon (ENOENT, exit codes, stderr).

### Words to Avoid

| Avoid | Use Instead |
|-------|------------|
| "Invalid" (when blaming user) | "Please use..." / "Expected format: ..." |
| "Error" as standalone message | Describe what specifically failed |
| "Something went wrong" | Name the specific failure |
| "ENOENT" / "exit code N" | "not found" / "exited with an error" |
| "stderr" | "warning output" |
| "spawn" / "fork" | "start" / "run" |

### Standard Phrases

| Situation | Pattern |
|-----------|---------|
| External tool missing | `"[Tool] not detected.\nInstall it from [URL] and try again."` |
| Authentication failure | `"[Tool] is installed but doesn't seem to be authenticated.\nRun [command] to sign in."` |
| Timeout | `"[Tool] didn't respond within [duration]. It may be experiencing an outage.\nCheck [status URL] and try again later."` |
| Resource limit | `"[Resource] is low/full ([amount]). [Tool] needs [what] to work.\n[How to fix]."` |
| Recovery / undo | `"Your code is safe. Reset to tag [tag] to undo any changes."` |
| Partial completion | `"[N] steps completed. Changes are on branch: [branch]\nTo merge: [exact command]"` |

---

## Pre-Run Checks (`src/checks.js`)

| Trigger | Message | Next Step |
|---------|---------|-----------|
| Git not installed | `Git is not installed or not on your PATH.` | `Install it from https://git-scm.com and try again.` |
| Not a git repo | `This folder isn't a git project. Navigate to your project folder and try again.` | `If you need to set one up, run: git init` |
| No commits yet | `Your project has no commits yet. NightyTidy needs at least one commit to create a safety tag.` | `Make an initial commit and try again: git add -A && git commit -m "Initial commit"` |
| Claude Code not installed | `Claude Code not detected.` | `Install it from https://docs.anthropic.com/en/docs/claude-code and sign in before running NightyTidy.` |
| Claude Code timeout (auth check) | `Claude Code didn't respond within 30 seconds. It may be experiencing an outage.` | `Check https://status.anthropic.com and try again later.` |
| Claude Code sign-in failed | `Claude Code sign-in did not complete successfully.` | `If this keeps happening, check https://status.anthropic.com for outages.` |
| Critical disk space (<100 MB) | `Very low disk space ([N] MB free). NightyTidy needs room for git operations.` | `Free up some space and try again.` |

## Claude Code Subprocess (`src/claude.js`)

| Trigger | Message | Context |
|---------|---------|---------|
| 45-minute timeout (or custom via `--timeout`) | `Claude Code timed out after 45 minutes` | Returned in result object, surfaces in logs and notifications |
| Empty output on success exit | `Claude Code returned empty output` | Exit code 0 but no stdout content |
| Non-zero exit code | `Claude Code exited with error code [N]` | Subprocess failed |
| Spawn failure (non-Windows) | `Failed to start Claude Code. Ensure the "claude" command is installed and on your PATH.` | Cannot find/execute claude binary |
| All retries exhausted | `Failed after [N] attempts` | After max retries consumed |

## CLI / Run Lifecycle (`src/cli.js`)

| Trigger | Message | Type |
|---------|---------|------|
| No steps selected | `No steps selected. Select at least one step to continue.` | Validation (yellow) |
| Invalid --steps numbers | `Invalid step number(s): [N, ...]. Valid range: 1-33.` | Validation (red) |
| Invalid --timeout | `--timeout expects a positive number of minutes (got "[value]"). Example: --timeout 60` | Validation (red) |
| First SIGINT | `Stopping NightyTidy... finishing current step.` | Feedback (yellow) |
| Second SIGINT | `Force stopping.` | Confirmation (plain) |
| Unexpected error | `An unexpected error occurred. Check nightytidy-run.log for details.` | Error (red) |
| Fatal error (after run started) | `Your code is safe. Reset to tag [tag] to undo any changes.` | Reassurance (yellow) |

## Lock File (`src/lock.js`)

| Trigger | Message | Next Step |
|---------|---------|-----------|
| Another run active | `Another NightyTidy run is already in progress (PID [N], started [time]).` | `If this is wrong, delete nightytidy.lock and try again.` |
| Race condition on stale lock | `Another NightyTidy run acquired the lock while cleaning up a stale lock file.` | `If this is wrong, delete nightytidy.lock and try again.` |

## Notifications (`src/notifications.js` via callers)

| Event | Title | Body |
|-------|-------|------|
| Run started | `NightyTidy Started` | `Running [N] steps. Check nightytidy-run.log for progress.` |
| Step failed | `NightyTidy: Step [N] Failed` | `Step [N] ([name]) failed after [N] attempts. Skipped - run continuing.` |
| All succeeded | `NightyTidy Complete` | `All [N] steps succeeded. See NIGHTYTIDY-REPORT.md` |
| Partial success | `NightyTidy Complete` | `[N]/[total] succeeded, [N] failed. See NIGHTYTIDY-REPORT.md` |
| Merge conflict | `NightyTidy: Merge Conflict` | `Changes are on branch [branch]. See NIGHTYTIDY-REPORT.md for resolution steps.` |
| Run aborted | `NightyTidy Stopped` | `[N] steps completed. Changes on branch [branch].` |
| Fatal error | `NightyTidy Error` | `Run stopped: [message]. Check nightytidy-run.log.` |

## Orchestrator Mode (`src/orchestrator.js`)

| Trigger | Message | Context |
|---------|---------|---------|
| State file already exists | `A run is already in progress. Call --finish-run first, or delete nightytidy-run-state.json to reset.` | Returned in JSON `{ success: false, error }` |
| No active run (--run-step) | `No active orchestrator run. Call --init-run first.` | Returned in JSON |
| Step not in selection | `Step [N] is not in the selected steps for this run. Selected: [list]` | Returned in JSON |
| Step already completed | `Step [N] has already been completed in this run.` | Returned in JSON |
| Step already failed | `Step [N] has already been attempted and failed in this run.` | Returned in JSON |
| Step not found | `Step [N] not found in available steps.` | Returned in JSON |
| No active run (--finish-run) | `No active orchestrator run. Nothing to finish.` | Returned in JSON |
| Invalid step numbers | `Invalid step number(s): [N, ...]. Valid range: 1-33.` | Returned in JSON |

## GUI (`gui/resources/app.js`)

| Trigger | Message | Context |
|---------|---------|---------|
| CLI command did not complete | `NightyTidy command did not complete. Check that the project folder is valid and try again.` | Shown in error box on current screen |
| CLI output not parseable | `Could not read NightyTidy output. The command may have failed — check nightytidy-run.log for details.` | Shown in error box |
| Folder selection error | `Folder selection did not complete. Please try again or type the path manually.` | Shown on setup screen |
| No steps from CLI | `No steps returned from NightyTidy CLI` | Shown on setup screen |
| Init-run failed | `Failed to initialize run` | Fallback if JSON error field is empty |
| Non-interactive mode | `Non-interactive mode requires --all or --steps <numbers>.` | With examples shown below |

## Dashboard (`src/dashboard-html.js`)

| Trigger | Message | Context |
|---------|---------|---------|
| Run ended with error | `Error: [error message]` or `No error details available` | Shown in summary section |
| SSE disconnected | Reconnecting indicator shown | Visual cue, no text message |

## Report (`src/report.js`)

| Trigger | Message | Context |
|---------|---------|---------|
| Changelog generation failed | Fallback narration paragraph mentioning Claude Code load and suggesting re-run | Included in NIGHTYTIDY-REPORT.md |
| Step failure in report | `No error details available` | Fallback when error field is empty |
