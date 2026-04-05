# NightyTidy Troubleshooting Runbook

Symptom-based troubleshooting for common NightyTidy failures. Find your symptom, follow the diagnosis.

---

## Quick Reference

| Symptom | Jump To |
|---------|---------|
| "Git is not installed" | [Git Not Found](#git-not-found) |
| "This folder isn't a git project" | [Not a Git Repo](#not-a-git-repo) |
| "Claude Code not detected" | [Claude Code Not Installed](#claude-code-not-installed) |
| "Claude Code didn't respond within 30 seconds" | [Claude Code Timeout](#claude-code-timeout-at-startup) |
| Step keeps failing after retries | [Step Fails Repeatedly](#step-fails-repeatedly) |
| "Claude Code timed out after 45 minutes" | [Step Timeout](#step-timeout) |
| "Very low disk space" | [Disk Space Issues](#disk-space-issues) |
| Git errors mid-run (e.g., "no space left on device") | [Disk Fills During Run](#disk-fills-during-run) |
| "Another NightyTidy run is already in progress" | [Lock File Conflict](#lock-file-conflict) |
| Merge conflict after run | [Merge Conflict](#merge-conflict) |
| Run was interrupted / partially completed | [Interrupted Run Recovery](#interrupted-run-recovery) |
| No desktop notification received | [Notifications Not Working](#notifications-not-working) |
| Dashboard not opening | [Dashboard Issues](#dashboard-issues) |
| "Logger not initialized" error | [Internal Errors](#logger-not-initialized) |
| Orchestrator: "No active orchestrator run" | [Orchestrator State Issues](#orchestrator-state-issues) |

---

## Pre-Run Failures

### Git Not Found

**Symptom**: `Git is not installed or not on your PATH.`

**Diagnosis**: NightyTidy runs `git --version` and it failed.

**Fix**:
1. Install Git from https://git-scm.com
2. Verify: run `git --version` in your terminal
3. If installed but not found, add Git to your system PATH
4. On Windows, restart your terminal after installing

### Not a Git Repo

**Symptom**: `This folder isn't a git project.`

**Diagnosis**: The current directory has no `.git` folder.

**Fix**:
1. Navigate to your project root: `cd /path/to/your/project`
2. If the project has no git history: `git init && git add -A && git commit -m "Initial commit"`
3. Re-run NightyTidy

### Claude Code Not Installed

**Symptom**: `Claude Code not detected.`

**Diagnosis**: NightyTidy runs `claude --version` and it failed.

**Fix**:
1. Install Claude Code from https://docs.anthropic.com/en/docs/claude-code
2. Sign in: run `claude` in your terminal and follow the prompts
3. Verify: `claude --version` should print a version number
4. On Windows, ensure `claude.cmd` is on your PATH (usually added automatically by the installer)

### Claude Code Timeout at Startup

**Symptom**: `Claude Code didn't respond within 30 seconds. It may be experiencing an outage.`

**Diagnosis**: The authentication check (`claude -p 'Say OK'`) did not complete in 30 seconds. This usually means the Anthropic API is down or unreachable.

**Fix**:
1. Check https://status.anthropic.com for outages
2. Check your internet connection
3. If behind a corporate proxy, ensure `claude` can reach `api.anthropic.com`
4. Try again later

### Disk Space Issues

**Symptom**: `Very low disk space (N MB free).`

**Diagnosis**: Less than 100 MB free on the drive containing your project. NightyTidy needs space for git operations (branches, commits, tags).

**Fix**:
1. Free up disk space (empty trash, clear temp files, remove unused dependencies)
2. NightyTidy warns at <1 GB and blocks at <100 MB
3. A full 43-step run on a large project can generate significant git data

---

## Step Execution Failures

### Step Fails Repeatedly

**Symptom**: A step fails after all retry attempts (logged as `Claude Code failed: Step N — all 4 attempts exhausted`).

**Diagnosis**: Claude Code could not complete the step's prompt. Common causes:
- The prompt asks for changes that are impossible in the project's current state
- The codebase is too large for Claude Code's context window
- Anthropic API errors or rate limiting
- The step's changes conflict with the project's tooling (linter, type checker)

**Fix**:
1. Check `nightytidy-run.log` for the specific error on each attempt
2. Set `NIGHTYTIDY_LOG_LEVEL=debug` and re-run the single step to see full Claude Code output
3. If the error is API-related (timeouts, rate limits), wait and retry
4. If the error is project-specific, the step may not be applicable to your project — skip it
5. Run just the failed step: `npx nightytidy --steps N`

### Step Timeout

**Symptom**: `Claude Code timed out after 45 minutes` (or custom timeout value).

**Diagnosis**: Claude Code ran for the full timeout period without completing. This happens with:
- Very large codebases where Claude needs more time
- Complex refactoring steps
- API slowness

**Fix**:
1. Increase the timeout: `npx nightytidy --timeout 90` (90 minutes per step)
2. If a specific step consistently times out, it may not be suitable for your project size
3. The timed-out step is retried 3 times by default — check the log to see if any retry succeeded

---

## Mid-Run Failures

### Disk Fills During Run

**Symptom**: Git errors like `error: unable to write file`, `no space left on device`, or unexpected step failures with git-related errors in the log.

**Diagnosis**: The disk filled up during the run. NightyTidy checks disk space at startup but not during execution. A 4-8 hour run generating many git commits can consume significant space.

**Fix**:
1. Your changes are safe on the run branch (e.g., `nightytidy/run-2026-03-09-0215`)
2. Free up disk space
3. Check which branch you are on: `git branch --show-current`
4. If on the run branch, your completed steps are preserved as git commits
5. You can finish manually: merge the run branch into your original branch
6. To start fresh: reset to the safety tag (e.g., `git reset --hard nightytidy-before-2026-03-09-0215`)

### Lock File Conflict

**Symptom**: `Another NightyTidy run is already in progress (PID N, started TIME).`

**Diagnosis**: A lock file (`nightytidy.lock`) exists in your project directory. This happens when:
- Another NightyTidy run is genuinely running
- A previous run crashed without cleaning up

**Fix**:
1. If another run IS active: wait for it to finish
2. If no other run is active: delete the lock file: `rm nightytidy.lock` (or `del nightytidy.lock` on Windows)
3. In a TTY terminal, NightyTidy will prompt you to override the lock
4. Stale locks (dead PID or >24 hours old) are automatically removed

### Interrupted Run Recovery

**Symptom**: Run was stopped (Ctrl+C, power loss, terminal closed).

**Diagnosis**: A partial run exists on a `nightytidy/run-*` branch.

**Fix**:
1. Check for the run branch: `git branch | grep nightytidy/run`
2. Check for the safety tag: `git tag | grep nightytidy-before`
3. **To keep partial changes**: `git checkout main && git merge nightytidy/run-TIMESTAMP`
4. **To discard all changes**: `git reset --hard nightytidy-before-TIMESTAMP`
5. A partial `NIGHTYTIDY-REPORT.md` may exist on the run branch
6. Clean up: delete the lock file if it exists (`rm nightytidy.lock`)

---

## Post-Run Issues

### Merge Conflict

**Symptom**: NightyTidy reports "merge needs attention" and prints manual merge instructions.

**Diagnosis**: The run branch could not be automatically merged into your original branch. This happens when:
- Someone else pushed changes to the branch while NightyTidy was running
- NightyTidy's changes conflict with uncommitted work that was stashed/committed elsewhere

**Fix** (option A — manual merge):
```bash
git merge nightytidy/run-TIMESTAMP
# Resolve conflicts in your editor
git commit
```

**Fix** (option B — ask Claude Code):
> "Merge the branch nightytidy/run-TIMESTAMP into my current branch and resolve any conflicts."

**Fix** (option C — discard and redo):
```bash
git reset --hard nightytidy-before-TIMESTAMP
# Re-run NightyTidy
```

---

## Dashboard & UI Issues

### Notifications Not Working

**Symptom**: No desktop notifications appear during or after the run.

**Diagnosis**: `node-notifier` failed silently (by design — notifications are fire-and-forget).

**Fix**:
1. On macOS: check System Settings > Notifications for your terminal app
2. On Windows: check Windows notification settings
3. On Linux: ensure `notify-send` or a notification daemon is installed
4. Notifications are supplementary — all information is in the log file and report

### Dashboard Issues

**Symptom**: Dashboard window does not open, or web dashboard URL is not accessible.

**Diagnosis**: The TUI window or HTTP server failed to start.

**Fix**:
1. Check the log for `Dashboard server could not start` or `Could not open dashboard window`
2. The dashboard is non-critical — the run continues without it
3. Monitor progress via the log file: `tail -f nightytidy-run.log` (macOS/Linux) or open it in a text editor (Windows)
4. If the web dashboard URL shows but the page does not load, the server process may have died — check the run log

---

## Orchestrator Mode Issues

### Orchestrator State Issues

**Symptom**: `No active orchestrator run. Call --init-run first.` or `A run is already in progress.`

**Diagnosis**: The state file (`nightytidy-run-state.json`) is missing or already exists.

**Fix**:
1. If starting fresh: delete stale state files:
   ```bash
   rm nightytidy-run-state.json nightytidy-run-state.json.tmp nightytidy.lock
   ```
2. If resuming a run: the state file tracks which steps have been completed. Re-run `--run-step N` for remaining steps, then `--finish-run`
3. If the state file is corrupt: delete it and start over with `--init-run`

---

## Debugging Tips

### Enable Debug Logging

Set `NIGHTYTIDY_LOG_LEVEL=debug` to see full Claude Code subprocess output:

```bash
# macOS/Linux
NIGHTYTIDY_LOG_LEVEL=debug npx nightytidy --steps 1

# Windows (CMD)
set NIGHTYTIDY_LOG_LEVEL=debug && npx nightytidy --steps 1

# Windows (PowerShell)
$env:NIGHTYTIDY_LOG_LEVEL="debug"; npx nightytidy --steps 1
```

### Reading the Log File

The log file (`nightytidy-run.log`) uses this format:
```
[2026-03-09T02:15:00.000Z] [INFO ] Message here
[2026-03-09T02:15:01.000Z] [WARN ] Warning message
[2026-03-09T02:15:02.000Z] [ERROR] Error message
```

**Quick searches**:
- Find all errors: search for `[ERROR]`
- Find all warnings: search for `[WARN ]`
- Find step results: search for `completed` or `failed`
- Find timing: search for `completed (` to see step durations

### Undoing Everything

Every NightyTidy run creates a safety tag before making any changes. To completely undo a run:

```bash
# Find the tag
git tag | grep nightytidy-before

# Reset to it
git reset --hard nightytidy-before-TIMESTAMP

# Clean up the run branch
git branch -D nightytidy/run-TIMESTAMP
```

---

*Generated for NightyTidy. See `docs/ERROR_MESSAGES.md` for the complete error message reference.*
