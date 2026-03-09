# Audit #31 -- Product Polish & UX Friction

**Date**: 2026-03-09
**Type**: Read-only analysis
**Scope**: All user-facing surfaces -- CLI interactive, CLI non-interactive, GUI, orchestrator mode

---

## Executive Summary

NightyTidy provides a well-structured user experience across four interaction modes (CLI interactive, CLI non-interactive, GUI desktop, and orchestrator API). The welcome screen, pre-flight checks, progress feedback, and completion summary are all thoughtfully designed. However, several UX friction points exist that could confuse or block non-programmer users, particularly around first-use experience, error recovery, GUI platform assumptions, and missing guidance in edge cases.

**Overall assessment**: 28 findings across 5 phases. 5 high-impact, 10 medium-impact, 13 low-impact.

---

## Phase 1: First-Use Experience

### FINDING-01 [HIGH] -- No guidance on what NightyTidy does before committing to a run

**Location**: `src/cli.js:226-245` (`showWelcome()`)

The welcome box says "NightyTidy will run 33 codebase improvement steps through Claude Code" but never explains what those steps are at a high level. A first-time user sees "33 steps" and "4-8 hours" but has no context for what kinds of improvements will happen (documentation, testing, security, performance, etc.). The `--list` command exists but is not mentioned in the welcome screen.

**Impact**: User may start a run without understanding what it does, leading to surprise or wasted time.

**Recommendation**: Add a brief list of improvement categories to the welcome text, or add a line like "Run `nightytidy --list` to see all steps before starting." The welcome screen should set expectations for what the tool actually does.

---

### FINDING-02 [MEDIUM] -- Pre-check error messages are good but inconsistent in actionability

**Location**: `src/checks.js:39-137`

The error messages for pre-check failures are generally excellent -- each one explains what went wrong and what to do. Examples:
- "Git is not installed or not on your PATH. Install it from https://git-scm.com and try again." -- Perfect.
- "This folder isn't a git project. Navigate to your project folder and try again." -- Good.
- "Claude Code not detected. Install it from https://docs.anthropic.com/en/docs/claude-code and sign in before running NightyTidy." -- Good.

However, the auth timeout message ("Claude Code didn't respond within 30 seconds. It may be experiencing an outage.") does not suggest the most common cause: the user's Claude Code session may need re-authentication, or their API key may be expired. The message jumps to "outage" as the primary suggestion.

**Impact**: User may wait for an outage to resolve when the real issue is local authentication.

**Recommendation**: Update the timeout message to suggest re-running `claude` manually to check authentication status before suggesting an outage.

---

### FINDING-03 [LOW] -- `--setup` success message is terse and does not explain what happened

**Location**: `src/cli.js:366-372`

After running `--setup`, the user sees:
```
Created CLAUDE.md with NightyTidy integration to this project.
  Claude Code now knows how to run NightyTidy in this project.
```

This does not explain what "integration" means, or what the user should do next. A non-programmer user may not know what CLAUDE.md is or why Claude Code needs it.

**Impact**: Low -- the feature works correctly, but the user lacks understanding of what happened.

**Recommendation**: Add a follow-up line explaining "The CLAUDE.md file tells Claude Code which improvement steps are available. Next time you ask Claude Code to run NightyTidy, it will know how."

---

### FINDING-04 [MEDIUM] -- Step selection defaults to all checked -- no explanation of what "Enter to run all" means

**Location**: `src/cli.js:208-216`

The checkbox prompt says "Select steps to run (Enter to run all):" with all 33 items pre-checked. The phrase "Enter to run all" may confuse users who interpret "Enter" as "confirm my current selection" rather than "run everything." Since all items are already checked, pressing Enter does run all -- but the intent of the message is ambiguous.

**Impact**: Users may accidentally run all 33 steps (4-8 hours) when they intended to select a subset.

**Recommendation**: Change the message to "Select steps to run (all selected by default):" which is unambiguous about the starting state.

---

### FINDING-05 [LOW] -- `--help` output mixes user-facing and orchestrator commands

**Location**: `src/cli.js:264-278` (Commander options)

The `--help` output shows all options including `--init-run`, `--run-step`, `--finish-run`, and `--json`. These orchestrator commands are not useful to human users and create visual clutter. A non-programmer user sees 12 options when only 6-7 are relevant to them.

**Impact**: Low -- experienced users will ignore irrelevant options, but beginners may be confused.

**Recommendation**: Consider grouping or hiding orchestrator commands. Commander supports `.hideHelp()` on subcommands, or a comment in the help text separating "User commands" from "Orchestrator commands (for Claude Code)".

---

### FINDING-06 [LOW] -- No first-run detection or onboarding flow

**Location**: General -- no first-run logic exists

There is no detection of whether the user has run NightyTidy before. Every invocation shows the same welcome screen. First-time users might benefit from a brief "Getting started" prompt or a recommendation to use `--dry-run` first to preview what will happen.

**Impact**: Low -- the welcome screen covers basics, but a "first time? try --dry-run" suggestion would reduce anxiety.

**Recommendation**: Check if `nightytidy-run.log` or a `.nightytidy` marker exists. If not, add a dim line: "First time? Try --dry-run to preview without making changes."

---

## Phase 2: Core Workflow Polish

### FINDING-07 [HIGH] -- No ETA or per-step time estimate shown during execution

**Location**: `src/cli.js:46-53` (`buildStepCallbacks`)

During execution, the spinner shows "Step 3/12: Security Sweep..." but provides no time estimate. The periodic summary (every 5 steps) shows elapsed time and remaining count, but does not estimate time-to-completion. Given that runs take 4-8 hours, users have no way to know when to expect completion.

**Impact**: Users cannot plan around the run. They may check repeatedly or worry that it is stuck.

**Recommendation**: Track average duration of completed steps and use it to estimate remaining time. Display "~2h 15m remaining" alongside the step counter. Even a rough estimate is better than none.

---

### FINDING-08 [MEDIUM] -- Progress summary only prints every 5 steps -- silent gap for small runs

**Location**: `src/cli.js:55-63` (`maybePrintProgressSummary`)

The progress summary interval is 5 steps. If a user selects 3-4 steps, they never see a mid-run progress summary. They only see individual step pass/fail lines and the final summary.

**Impact**: For short runs, the experience feels sparse. No progress context between individual step results.

**Recommendation**: Either lower the threshold or always print at least one mid-run summary when total steps > 1.

---

### FINDING-09 [LOW] -- Step failure notification says "Skipped -- run continuing" but the step was not skipped

**Location**: `src/executor.js:68-70`

The desktop notification for a failed step says "failed after N attempts. Skipped -- run continuing." The word "skipped" is misleading -- the step was attempted and failed, not skipped. A skipped step implies it was not attempted at all.

**Impact**: Minor terminology confusion in desktop notifications.

**Recommendation**: Change to "failed after N attempts. Continuing with remaining steps."

---

### FINDING-10 [MEDIUM] -- Merge conflict resolution instructions are excellent but could be more actionable

**Location**: `src/cli.js:165-178` (`printCompletionSummary` merge conflict branch)

When a merge conflict occurs, the user sees clear instructions including manual merge commands and a Claude Code prompt. This is well-designed. However, the instructions do not explain what a merge conflict IS to a non-programmer user. The target audience is "vibe coders at small companies" who may not understand git merge conflicts.

**Impact**: A user who does not understand merge conflicts may be stuck despite good instructions.

**Recommendation**: Add a one-line explanation: "A merge conflict means NightyTidy's changes overlap with changes you made during the run. You'll need to choose which version to keep."

---

### FINDING-11 [LOW] -- Report fallback narration is overly apologetic

**Location**: `src/report.js:35-43` (`fallbackNarration`)

When the changelog generation fails, the fallback text says "A detailed changelog could not be generated -- this typically happens when Claude Code is under heavy load." This blame-shifts to Claude Code and may worry the user that their results are incomplete or unreliable.

**Impact**: Minor -- the report still has all step results; only the narrative summary is missing.

**Recommendation**: Reframe positively: "A narrative summary was not generated for this run. See the step results below for details on what changed."

---

### FINDING-12 [MEDIUM] -- Safety tag undo instructions use `git reset --hard` without warning

**Location**: `src/report.js:89-101` (`buildUndoSection`)

The report's "How to Undo This Run" section recommends `git reset --hard <tag>`. This is a destructive command that can cause data loss if the user has uncommitted changes. The command is presented without warning.

**Impact**: A non-programmer user following these instructions could lose work that was not committed.

**Recommendation**: Add a warning line: "Warning: `git reset --hard` will discard any uncommitted changes in your project. Commit or stash your work first." Also, consider recommending the Claude Code approach first (which is safer) and the git command second.

---

### FINDING-13 [LOW] -- Dry run time estimate is hardcoded and inaccurate

**Location**: `src/cli.js:397`

The dry run output shows "Estimated time: {15*steps}-{30*steps} minutes" which assumes 15-30 minutes per step. This is a rough range that could be misleading -- some steps take 5 minutes, others take 45 minutes. The estimate is based on total steps, not which steps are selected.

**Impact**: A user selecting only fast steps might see "150-300 minutes" when the actual time would be 60 minutes.

**Recommendation**: Either remove the estimate or caveat it more clearly: "Rough estimate: individual steps vary from 5 to 45 minutes."

---

## Phase 3: GUI Experience

### FINDING-14 [HIGH] -- GUI is hardcoded as Windows-first with no cross-platform detection

**Location**: `gui/resources/app.js:79` and `gui/resources/app.js:380`

The GUI's `runCli` function hardcodes `'Windows'` as the platform argument when building commands:
```js
const cmd = NtLogic.buildCommand(state.projectDir, args, 'Windows');
```

And the progress polling hardcodes the Windows path separator:
```js
const sep = '\\'; // GUI is Windows-first
```

If the GUI is ever used on macOS or Linux (the server.js supports all three platforms for folder selection and Chrome launching), commands will use Windows-specific syntax (`cd /d`) on Unix systems and progress file paths will use wrong separators.

**Impact**: The GUI will fail silently on non-Windows platforms. The server-side code supports cross-platform operation, but the client-side logic breaks it.

**Recommendation**: Detect the platform server-side and pass it to the client, or use the server API to build commands. Alternatively, document that the GUI is Windows-only.

---

### FINDING-15 [MEDIUM] -- GUI setup screen has no explanation of what NightyTidy does

**Location**: `gui/resources/index.html:12-27`

The setup screen shows:
```
NightyTidy
Automated overnight codebase improvement
[Select Project Folder]
```

There is no explanation of what happens after selecting a folder, what kind of improvements will be made, or how long it takes. A first-time GUI user is presented with a single button and a tagline.

**Impact**: Users may select a folder and start a run without understanding the scope (4-8 hours, 33 steps, git branching).

**Recommendation**: Add a brief paragraph below the tagline explaining: "NightyTidy runs AI-powered improvement steps (documentation, testing, security, performance, and more) through Claude Code. All changes happen on a dedicated git branch. Typically takes 4-8 hours for all steps."

---

### FINDING-16 [MEDIUM] -- GUI does not show pre-check results before step selection

**Location**: `gui/resources/app.js:119-140` (`loadSteps`)

When the user selects a folder, the GUI immediately runs `--list --json` to get steps, then jumps to the step selection screen. Pre-flight checks (git, Claude CLI, disk space, etc.) are not run until `--init-run`. This means the user could select steps, configure timeout, and click "Start Run" only to find out that Claude Code is not installed.

**Impact**: Wasted time and a frustrating error after configuration effort. In the CLI, pre-checks run before step selection.

**Recommendation**: Run pre-checks as part of the folder selection flow (or show a "checking..." state) so errors are caught before the user invests time in step selection.

---

### FINDING-17 [LOW] -- GUI step checklist does not show step descriptions

**Location**: `gui/resources/app.js:149-155` (`renderStepChecklist`)

Each step in the checklist shows only the step number and name (e.g., "8. Security Sweep"). The CLI's `--list` command shows a brief description extracted from the prompt. The GUI does not show descriptions, making it harder for users to decide which steps to run.

**Impact**: Users must guess what each step does based on its name alone.

**Recommendation**: Include `s.description` from the `--list --json` output in the checklist rendering.

---

### FINDING-18 [LOW] -- GUI "Claude Output" panel may show raw subprocess text that is confusing

**Location**: `gui/resources/app.js:394-407` (`renderProgressFromFile`, `clearOutput`)

The output panel shows raw Claude Code subprocess output, which includes tool invocations, file edits, and other machine-readable content. A non-programmer user would find this output confusing and potentially alarming (seeing file modifications scrolling by).

**Impact**: Raw output creates noise. It may cause anxiety ("is it deleting my files?") without providing actionable information.

**Recommendation**: Either filter the output to show only meaningful status messages, or add a header explaining "This is raw Claude Code output. Don't worry if it looks technical -- your code is safe on a dedicated branch."

---

### FINDING-19 [LOW] -- GUI "Close" button on summary screen does not confirm before exiting

**Location**: `gui/resources/app.js:583-586`

The "Close" button calls `api('exit')` and `window.close()` without any confirmation. If the user accidentally clicks it, they lose the summary screen. There is no way to get it back since the summary is computed in-memory and not persisted.

**Impact**: Low -- the NIGHTYTIDY-REPORT.md file has all the information, but the in-app summary is lost.

**Recommendation**: Either persist the summary state or add a brief confirmation dialog.

---

### FINDING-20 [MEDIUM] -- GUI does not handle browser refresh gracefully

**Location**: `gui/resources/app.js` (general)

All GUI state is held in JavaScript memory. If the user refreshes the browser (F5), all state is lost: the selected folder, step configuration, and running progress. The app resets to the setup screen with no indication of what happened.

During a run, this is particularly problematic -- the run continues in the background (via the server process), but the GUI has no way to reconnect to it.

**Impact**: A browser refresh during a run leaves the user disconnected from their running process with no way to reconnect or view progress.

**Recommendation**: Store critical state (project dir, run state) in `localStorage` or use the server to track active runs. On load, check for an active run and reconnect.

---

## Phase 4: Edge Cases

### FINDING-21 [HIGH] -- Ctrl+C during pre-checks or step selection leaves lock file behind

**Location**: `src/cli.js:337-349`, `src/lock.js:112-117`

The lock file is acquired early in the run flow (line 357), but the SIGINT handler only manages the abort controller for step execution. If the user presses Ctrl+C during pre-checks or step selection (before `runStarted` is set to true), the lock file is released by the `process.on('exit')` handler -- but only in non-persistent mode.

The `process.on('exit')` handler in `lock.js:114` should handle this, but if the process exits via `process.exit(1)` from the unhandledRejection handler or a pre-check failure, the exit handler may not fire reliably on all platforms.

**Impact**: In practice, the exit handler should work. But on Windows, forced termination can leave the lock file behind, requiring manual deletion.

**Recommendation**: Document in the error output that if NightyTidy refuses to start due to a lock file, the user can safely delete `nightytidy.lock`.

---

### FINDING-22 [MEDIUM] -- Uncommitted changes warning does not mention stashing

**Location**: `src/checks.js:209-227` (`checkCleanWorkingTree`)

The warning says: "You have N uncommitted change(s). NightyTidy will carry these to the run branch. If you undo the run later with git reset --hard, uncommitted changes will be lost. Consider committing or stashing your work first."

The mention of `git stash` is good, but the warning does not explain what stashing is. The target audience ("vibe coders") may not know what `git stash` means.

**Impact**: Users may ignore the warning because they don't understand the risk or the solution.

**Recommendation**: Either briefly explain stashing ("To temporarily save your changes, run `git stash` before starting NightyTidy") or simplify to just recommending `git commit`.

---

### FINDING-23 [LOW] -- Claude Code failure produces generic "failed after N attempts" message

**Location**: `src/claude.js:188-196`

When all retry attempts are exhausted, the error returned is "Failed after N attempts" with no additional context about what went wrong. The per-attempt warnings are logged but not included in the final error.

**Impact**: The user sees "Step X failed" in the report but has no indication of whether it was a timeout, an authentication issue, or a code error.

**Recommendation**: Include the last error message in the final failure result: "Failed after 4 attempts (last error: Claude Code timed out after 45 minutes)".

---

### FINDING-24 [LOW] -- Disk space warning threshold (1GB) may be too low for large repos

**Location**: `src/checks.js:8, 195-204`

The low disk warning triggers at 1024 MB (1 GB) free. For large repos with significant git history, 1 GB may not be enough for NightyTidy's git operations (branching, tagging, committing across 33 steps). The critical threshold is 100 MB, which would likely cause failures.

**Impact**: Runs on large repos with low disk space may fail mid-run without adequate warning.

**Recommendation**: Consider raising the warning threshold to 2 GB, especially since each step may create commits and Claude Code itself needs working space.

---

### FINDING-25 [LOW] -- Lock file prompt in non-TTY mode gives file deletion advice without path

**Location**: `src/lock.js:39-44`

The non-TTY error message says "If this is wrong, delete nightytidy.lock and try again" but does not include the full path to the lock file. In orchestrator mode or CI, the user may not know which directory the lock file is in.

**Impact**: Minor inconvenience -- the user must figure out the lock file location.

**Recommendation**: Include the absolute path: "delete {projectDir}/nightytidy.lock".

---

## Phase 5: CLI Help & Documentation

### FINDING-26 [LOW] -- `--version` outputs bare version number with no context

**Location**: Commander default behavior via `src/cli.js:268`

Running `nightytidy --version` outputs just `0.1.0` with no tool name or additional context. This is standard Commander behavior but could be more helpful.

**Impact**: Minimal -- version queries are rare.

**Recommendation**: No change needed. This follows CLI conventions.

---

### FINDING-27 [MEDIUM] -- No `--verbose` or `--debug` flag for troubleshooting

**Location**: General CLI options

There is no CLI flag to enable debug-level logging. The user must set `NIGHTYTIDY_LOG_LEVEL=debug` as an environment variable, which is not discoverable from `--help` and non-trivial for non-programmer users.

**Impact**: When troubleshooting issues, users have no easy way to get verbose output. The environment variable approach is documented in CLAUDE.md but not in `--help`.

**Recommendation**: Add a `--verbose` flag that sets `NIGHTYTIDY_LOG_LEVEL=debug` internally. Mention it in `--help`.

---

### FINDING-28 [LOW] -- `gui` folder is not included in npm package `files` array

**Location**: `package.json:21-26`

The `files` array in package.json includes `bin/` and `src/` but not `gui/`. If published to npm, the GUI files would not be included in the package, and `npm run gui` would fail.

**Impact**: Users installing via npm would not have access to the GUI feature.

**Recommendation**: Add `"gui/"` to the `files` array if the GUI is intended to be a published feature.

---

## Summary Table

| # | Finding | Severity | Phase | Location |
|---|---------|----------|-------|----------|
| 01 | No explanation of what 33 steps do | HIGH | First Use | cli.js:226 |
| 02 | Auth timeout message blames outage | MEDIUM | First Use | checks.js:118-123 |
| 03 | --setup success message is terse | LOW | First Use | cli.js:366-372 |
| 04 | Step selection "Enter to run all" is ambiguous | MEDIUM | First Use | cli.js:208-216 |
| 05 | --help mixes user and orchestrator commands | LOW | First Use | cli.js:264-278 |
| 06 | No first-run detection | LOW | First Use | General |
| 07 | No ETA during execution | HIGH | Workflow | cli.js:46-53 |
| 08 | Progress summary silent for small runs | MEDIUM | Workflow | cli.js:55-63 |
| 09 | "Skipped" terminology for failed steps | LOW | Workflow | executor.js:68-70 |
| 10 | Merge conflict not explained for beginners | MEDIUM | Workflow | cli.js:165-178 |
| 11 | Fallback narration is apologetic | LOW | Workflow | report.js:35-43 |
| 12 | Undo instructions use `git reset --hard` without warning | MEDIUM | Workflow | report.js:89-101 |
| 13 | Dry run time estimate is inaccurate | LOW | Workflow | cli.js:397 |
| 14 | GUI hardcoded as Windows-only | HIGH | GUI | app.js:79,380 |
| 15 | GUI setup has no explanation | MEDIUM | GUI | index.html:12-27 |
| 16 | GUI does not run pre-checks before step selection | MEDIUM | GUI | app.js:119-140 |
| 17 | GUI step list has no descriptions | LOW | GUI | app.js:149-155 |
| 18 | Raw Claude output may confuse users | LOW | GUI | app.js:394-407 |
| 19 | Close button has no confirmation | LOW | GUI | app.js:583-586 |
| 20 | Browser refresh loses all state | MEDIUM | GUI | app.js (general) |
| 21 | Ctrl+C can leave lock file on Windows | HIGH | Edge Cases | lock.js:112-117 |
| 22 | Stash not explained in uncommitted warning | MEDIUM | Edge Cases | checks.js:209-227 |
| 23 | Generic failure message hides root cause | LOW | Edge Cases | claude.js:188-196 |
| 24 | Disk space threshold may be too low | LOW | Edge Cases | checks.js:8 |
| 25 | Lock file path missing from non-TTY error | LOW | Edge Cases | lock.js:39-44 |
| 26 | --version is bare (standard behavior) | LOW | Help/Docs | cli.js:268 |
| 27 | No --verbose flag | MEDIUM | Help/Docs | General CLI |
| 28 | GUI not included in npm files array | LOW | Help/Docs | package.json:21-26 |

---

## Prioritized Recommendations

### Highest Impact (address first)
1. **FINDING-01**: Add brief category list to welcome screen
2. **FINDING-07**: Add ETA calculation during execution
3. **FINDING-14**: Fix GUI cross-platform detection or document Windows-only
4. **FINDING-21**: Improve lock file cleanup messaging

### Medium Impact
5. **FINDING-04**: Clarify step selection default message
6. **FINDING-10**: Explain merge conflicts for beginners
7. **FINDING-12**: Add warning to `git reset --hard` undo instructions
8. **FINDING-16**: Run pre-checks in GUI before step selection
9. **FINDING-20**: Persist GUI state across browser refresh
10. **FINDING-27**: Add `--verbose` CLI flag

### Low Impact (polish)
11-28. Remaining findings are terminology, messaging, and minor UX improvements.

---

## Strengths Worth Preserving

1. **Error messages are actionable**: Pre-check failures include URLs, example commands, and clear next steps. This is significantly better than most CLI tools.

2. **Safety-first design**: Pre-run tags, dedicated branches, and easy undo instructions demonstrate strong user trust engineering.

3. **Multi-channel progress feedback**: Desktop notifications, spinner, TUI window, HTTP dashboard, and SSE streaming cover every monitoring preference.

4. **Graceful degradation**: If Chrome is not found, the GUI falls back to a URL. If the dashboard server fails, the TUI fallback works. If the TUI fails, the log file is always there.

5. **Abort handling is solid**: Two-press Ctrl+C (graceful then force), partial report generation, and clear branch/tag messaging after interruption.

6. **Merge conflict handling provides two paths**: Manual git commands AND a Claude Code prompt. This meets users at their skill level.

7. **GUI dark theme is polished**: The visual design is cohesive with proper accessibility (focus-visible, aria attributes, role annotations).

---

*Audit performed by Claude Opus 4.6 -- read-only analysis, no code changes.*
