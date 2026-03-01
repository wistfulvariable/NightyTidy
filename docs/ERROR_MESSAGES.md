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
| Claude Code not installed | `Claude Code not detected.` | `Install it from https://docs.anthropic.com/en/docs/claude-code and sign in before running NightyTidy.` |
| Claude Code timeout (auth check) | `Claude Code didn't respond within 30 seconds. It may be experiencing an outage.` | `Check https://status.anthropic.com and try again later.` |
| Claude Code not authenticated | `Claude Code is installed but doesn't seem to be authenticated.` | `Run 'claude' in your terminal and follow the sign-in steps, then try NightyTidy again.` |
| Critical disk space (<100 MB) | `Very low disk space ([N] MB free). NightyTidy needs room for git operations.` | `Free up some space and try again.` |

## Claude Code Subprocess (`src/claude.js`)

| Trigger | Message | Context |
|---------|---------|---------|
| 30-minute timeout | `Claude Code timed out after 30 minutes` | Returned in result object, surfaces in logs and notifications |
| Empty output on success exit | `Claude Code returned empty output` | Exit code 0 but no stdout content |
| Non-zero exit code | `Claude Code exited with error code [N]` | Subprocess failed |
| Spawn failure (non-Windows) | `Failed to start Claude Code. Ensure the "claude" command is installed and on your PATH.` | Cannot find/execute claude binary |
| All retries exhausted | `Failed after [N] attempts` | After max retries consumed |

## CLI / Run Lifecycle (`src/cli.js`)

| Trigger | Message | Type |
|---------|---------|------|
| No steps selected | `You need to select at least one step. Exiting.` | Validation (yellow) |
| First SIGINT | `Stopping NightyTidy... finishing current step.` | Feedback (yellow) |
| Second SIGINT | `Force stopping.` | Confirmation (plain) |
| Unexpected error | `An unexpected error occurred. Check nightytidy-run.log for details.` | Error (red) |
| Fatal error (after run started) | `Your code is safe. Reset to tag [tag] to undo any changes.` | Reassurance (yellow) |

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

## Report (`src/report.js`)

| Trigger | Message | Context |
|---------|---------|---------|
| Changelog generation failed | Fallback narration paragraph mentioning Claude Code load and suggesting re-run | Included in NIGHTYTIDY-REPORT.md |
| Step failure in report | `No error details available` | Fallback when error field is empty |
