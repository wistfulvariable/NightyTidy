# Product Polish & UX Friction Audit — Report 01

**Date**: 2026-03-05
**Scope**: Full static analysis of all user-facing code paths
**Overall Polish Level**: **Good** — the happy path is well-designed with clear feedback, but several edge-case flows have friction and the tool lacks configuration/customization options users would expect.

---

## 1. Executive Summary

NightyTidy is a CLI tool targeting vibe coders at small companies. The primary user journey — launch, select steps, run overnight, review report — is well-executed with good feedback (spinner, dashboard, notifications, colored output). The welcome screen, safety messaging, and abort handling are strong.

**Worst friction**: no `--dry-run`, no way to resume a partial run, lock file requires manual deletion on crash, and zero progress visibility in the main terminal during multi-hour runs beyond the spinner text.

**Journey health**: First use is smooth if prerequisites are met. Core loop is good. Error recovery and edge cases need work.

---

## 2. User Journey Map

| Journey | Health | Notes |
|---------|--------|-------|
| `npx nightytidy` (interactive, happy path) | Smooth | Welcome box, checkbox selection, spinner, completion summary |
| `npx nightytidy --all` (non-interactive) | Smooth | Clean — skips selection, runs everything |
| `npx nightytidy --steps 1,5,12` | Smooth | Validates numbers, good error on invalid |
| `npx nightytidy --list` | Some friction | Plain numbered list, no descriptions of what each step does |
| `npx nightytidy --setup` | Smooth | Clear success message |
| `npx nightytidy --help` | Smooth | Commander auto-generates, all options documented |
| `npx nightytidy --version` | Smooth | Returns version from package.json |
| First-time install (prerequisites missing) | Some friction | Error messages are specific and actionable |
| Abort (Ctrl+C once) | Smooth | Generates partial report, tells user what happened |
| Abort (Ctrl+C twice) | Some friction | Force-exits with no cleanup message — lock file may persist |
| Concurrent run attempt | Some friction | Error is specific but "delete the file" feels unpolished |
| Crash/power loss recovery | Significant friction | Stale lock file, no guidance on what state the repo is in |
| Post-run review | Some friction | User must read NIGHTYTIDY-REPORT.md manually — no `--report` command |
| Post-run rollback | Smooth | Tag-based rollback clearly documented in report and terminal |
| Dashboard (browser) | Smooth | Good real-time UI with SSE, stop button, reconnection indicator |
| Dashboard (TUI window) | Some friction | Window may fail to open silently; on Linux, depends on `x-terminal-emulator` |
| Non-TTY (CI/scripts) | Smooth | Clear error message directing to --all or --steps |

---

## 3. Critical Friction Points

| # | Flow | Location | Issue | Severity | Type |
|---|------|----------|-------|----------|------|
| 1 | Post-crash recovery | `lock.js:35-39` | Lock file persists after crash/power loss. User must manually find and delete `nightytidy.lock`. Error message says "delete nightytidy.lock and try again" but doesn't offer to do it for them. | High | Confusing |
| 2 | Long run, main terminal | `cli.js:319-322` | During 4-8 hour runs, the main terminal shows only a single spinner line. No periodic progress summary (e.g., "3/28 done, ~2h remaining"). User can't tell if it's stuck without opening the dashboard. | High | Missing |
| 3 | `--list` output | `cli.js:255` | `STEPS.forEach(step => console.log(...))` prints only number + name. No description of what each step does. User can't make informed selection decisions. | Medium | Incomplete |
| 4 | Step selection UX | `cli.js:157-165` | All 28 steps pre-checked. Message says "Enter to run all" but Inquirer checkbox's Enter actually submits current selection. If user presses space to toggle one off, they must scroll through all 28. No "select none" or category grouping. | Medium | Confusing |
| 5 | No `--dry-run` | CLI options | No way to preview what would happen without actually running. User can't verify steps, check prerequisites, or estimate time without committing to a run. | Medium | Missing |
| 6 | No resume capability | Executor | After Ctrl+C or failure, user can't resume from where they left off. Must re-run completed steps or manually figure out which failed. | Medium | Missing |
| 7 | Dashboard TUI fails silently | `dashboard.js:120-123` | If terminal emulator spawn fails, user gets a warning in the log file but nothing in the terminal. The "Progress window opened" message at `cli.js:296` still prints even if the TUI spawn threw. | Low | Confusing |
| 8 | Merge conflict guidance | `cli.js:118-128` | Good that it offers both manual and Claude-assisted resolution. However, the user is left on the original branch (after failed merge + abort), but the report is on the run branch. User must checkout the run branch to read it. | Low | Incomplete |
| 9 | No notification preferences | `notifications.js` | Desktop notifications are always on with no opt-out. Sound is hardcoded to `false`. No way to customize. | Low | Missing |
| 10 | Logger output to stdout in non-TTY | `logger.js:39` | Logger writes to stdout even in non-TTY mode. If piped, log lines mix with any structured output. Not a problem today but would be if JSON output mode is added. | Low | Incomplete |
| 11 | Double SIGINT loses lock cleanup | `cli.js:237-238` | Second Ctrl+C calls `process.exit(1)`. The `exit` handler in `lock.js:65` should fire, but any async cleanup (dashboard stop, report generation) is abandoned mid-flight. | Low | Incomplete |
| 12 | `--timeout` validation edge case | `cli.js:213` | `--timeout 0` is rejected ("must be positive"), which is correct, but `--timeout abc` silently becomes `NaN` from `parseInt` and is caught. The error message doesn't tell the user what they passed. | Low | Incomplete |

---

## 4. First-Use & Onboarding

### Installation
- **README** is clear: clone, npm install, run. Good.
- **No npm package published** — users must clone. This is a significant barrier for the "vibe coder" target audience. `npx nightytidy` won't work until published.
- **Prerequisites** (Node 18, Git, Claude Code CLI authenticated) are documented but not linked from the error messages consistently. The checks do link to install pages — good.

### First Run
- **Welcome box** is friendly and informative. Sets expectations (4-8 hours), mentions safety, mentions the log file. Good.
- **Sleep tip** (`cli.js:304-307`) is a nice touch — practical advice for the overnight use case.
- **Pre-checks** give specific, actionable errors for every failure case. Excellent quality.
- **No tutorial or sample output** — user doesn't know what to expect from a step until they run it. The `--list` output doesn't describe steps.

### Empty States
- Not applicable (CLI tool, no persistent UI).

---

## 5. Core Workflow

### Step Selection (interactive)
- All 28 steps default to checked. The message says "Enter to run all" — this is efficient for the common case.
- **Friction**: Toggling individual steps in a 28-item checkbox list with `pageSize: 15` means scrolling. No search, no categories (e.g., "security", "performance", "style").
- **No step descriptions visible** during selection — just number + name.
- **"No steps selected" exits with code 0** — arguably should be non-zero since no work was done, though this is minor.

### Execution
- **Spinner feedback** is good — shows current step name and number.
- **Completion/failure per step** is printed with colored checkmarks — clear.
- **Notifications** on step failure are useful for overnight monitoring.
- **No estimated time remaining** — with 4-8 hour runs, this would be very helpful.
- **No periodic summary** in terminal (e.g., every 30 min: "Progress: 8/28 done, 3 failed, ~3h remaining").

### Report
- Report is well-structured: summary, step table, failed step details, undo instructions.
- **Fallback narration** when changelog generation fails is a nice fallback — tells user why and how to retry.
- **Report location** is printed at completion (`cli.js:112`) — good discoverability.

### Merge
- Auto-merge with `--no-ff` is clean.
- Conflict handling is graceful — prints both manual and AI-assisted resolution options.
- **Merge conflict message doesn't tell user which files conflict** — the merge error details are only in the log file at debug level.

### Dashboard (Browser)
- Clean, dark-themed design. Status badge, progress bar, step list with icons, stop button.
- **SSE reconnection** handled with visible indicator — good.
- **CSRF on stop button** — appropriate security.
- **No link to report** in completed state — dashboard just says "Run Complete" but doesn't link to the report file.
- **No browser auto-open** — URL is printed in terminal, but user must copy-paste. Consider opening automatically (with opt-out).

### Dashboard (TUI)
- Good fallback for users who prefer terminal.
- **Max 16 visible steps** with overflow indicator — appropriate.
- **Window auto-closes** after completion with 5-second delay — good, prevents orphaned windows.

---

## 6. Edge Cases & Errors

### Destructive Actions
- **No destructive CLI actions** — NightyTidy only creates branches/tags, never deletes user data. Good.
- **Rollback is user-initiated** — `git reset --hard` is documented but NightyTidy doesn't offer it as a command. Consider `nightytidy --undo`.
- **No confirmation before starting** a multi-hour run. After step selection, execution begins immediately. A "About to run 28 steps (~4-8 hours). Continue? [Y/n]" prompt would prevent accidental runs.

### Error Quality
- **Pre-check errors**: Excellent. Specific, actionable, include links. Best-in-class.
- **Lock conflict error**: Good — includes PID and start time. Tells user how to fix.
- **Claude Code timeout**: Good — mentions the time and suggests checking status page.
- **Merge conflict**: Good messaging, but could include which files conflict.
- **Missing**: No error summary at the end of a run with failures. User sees individual step failures as they happen, but no final "3 steps failed: X, Y, Z — see report for details."

### Boundaries
- **Very long step names**: Would overflow spinner line — not a real concern since names are controlled.
- **28 steps with `--steps`**: Comma-separated input works fine. No range syntax (e.g., `1-10`). Minor.
- **Large project**: No project size limit or warning. Very large repos might cause Claude Code to time out more. No guidance.

### Concurrency
- **Lock file** handles concurrent runs correctly via atomic O_EXCL.
- **Stale lock detection** checks if PID is alive — good.
- **Race between stale cleanup and new run**: Handled with retry — good.

---

## 7. Settings & Configuration

### What Exists
| Setting | Mechanism | Notes |
|---------|-----------|-------|
| Log level | `NIGHTYTIDY_LOG_LEVEL` env var | Works, documented |
| Per-step timeout | `--timeout` flag | Works, documented, 45 min default |
| Step selection | `--steps` / `--all` / interactive | Works well |

### What's Missing (Users Would Expect)
| Missing Setting | Impact |
|-----------------|--------|
| `--dry-run` | Can't preview without running. Medium impact. |
| `--no-dashboard` / `--no-notifications` | Can't disable noisy features. Low impact. |
| `--output-dir` | Report always goes to project root. Low impact. |
| `.nightytidyrc` config file | No persistent preferences. Already noted as tech debt. |
| `--resume` | Can't continue partial runs. Medium impact. |
| Step timeout per-step (vs global) | Some steps may need more time. Low impact. |
| Branch name customization | Always `nightytidy/run-*`. Low impact. |

### Account Management
- Not applicable — no accounts, no auth (Claude Code handles its own).

---

## 8. Notifications

### Inventory

| Trigger | Channel | Content Quality | User Control |
|---------|---------|----------------|--------------|
| Run started | Desktop | Good — includes step count | None (always on) |
| Step failed | Desktop | Good — includes step number, name, retry count | None |
| Run complete (all pass) | Desktop | Good — includes count | None |
| Run complete (some fail) | Desktop | Good — includes pass/fail counts | None |
| Run complete (merge conflict) | Desktop (2 notifications) | Good but double-notification is noisy | None |
| Run aborted | Desktop | Good — includes completed count | None |
| Run error | Desktop | Good — includes error message | None |

### Missing Notifications
- **No email/webhook option** — for overnight runs, desktop notifications may be missed if the user is on a different device.
- **No notification sound option** — `sound: false` is hardcoded. Some users want an audible alert for completion.

### User Control
- **None**. No opt-out, no frequency control, no channel selection. For a tool that runs overnight, this is a gap — users on shared computers or with notification fatigue would want to disable them.

---

## 9. Accessibility Notes

This is a CLI tool, so standard web accessibility doesn't apply. Quick scan:

- **Dashboard HTML**: Has `lang="en"`, semantic HTML, reasonable color contrast on dark theme. Stop button is a real `<button>`. Good basics.
- **Color-only information**: Terminal output uses color (red/green/yellow) for status, but also includes text symbols (checkmarks, X marks) — good.
- **Screen reader**: Dashboard doesn't have ARIA labels on the progress bar or status badge. Minor since this is a dev tool.
- **Keyboard navigation**: Dashboard stop button is focusable. Step list items are not interactive. Acceptable.
- **Mobile responsiveness**: Dashboard has `viewport` meta tag. Layout would stack naturally. Adequate.

---

## 10. Recommendations

### Quick Fixes (hours)

| # | Recommendation | Effort | Impact |
|---|---------------|--------|--------|
| 1 | Add periodic terminal progress summary (every N steps or every 30 min) | 1-2h | High — main terminal is the primary interface during long runs |
| 2 | Add step descriptions to `--list` output | 1h | Medium — users can't make informed step selections without them |
| 3 | Offer to auto-delete stale lock files with a Y/n prompt instead of telling user to delete manually | 1h | Medium — removes friction on the most common error-recovery scenario |
| 4 | Print error summary at end of run when any steps failed | 30min | Medium — saves user from scrolling terminal output |
| 5 | Fix TUI "Progress window opened" message to only print if spawn succeeded | 30min | Low — prevents confusion when TUI fails |
| 6 | Add `--timeout` error message to include the invalid value passed | 15min | Low — better debugging |

### Medium Effort (days)

| # | Recommendation | Effort | Impact |
|---|---------------|--------|--------|
| 7 | Add `--dry-run` mode (run pre-checks, show selected steps, estimate time, exit) | 1 day | High — lets users verify setup before committing to hours-long run |
| 8 | Add confirmation prompt before execution ("Run N steps ~X-Yh? [Y/n]") | 2h | Medium — prevents accidental runs |
| 9 | Add `--no-dashboard` and `--no-notifications` flags | 2-3h | Low — power users want control |
| 10 | Add step categories/tags for easier selection (security, perf, style, etc.) | 1 day | Medium — 28 steps is a lot to scan |
| 11 | Publish to npm registry | 1 day | High — target audience ("vibe coders") expects `npx nightytidy` to just work |

### Larger Effort (weeks)

| # | Recommendation | Effort | Impact |
|---|---------------|--------|--------|
| 12 | Add `--resume` to continue from last completed step | 3-5 days | Medium — saves hours on partial runs |
| 13 | Add webhook/email notification option for completion | 2-3 days | Medium — overnight runs on remote machines |
| 14 | Add `.nightytidyrc` config file | 2-3 days | Low until user base grows |

---

*Generated by static code analysis. Items marked "verify in running app": dashboard browser rendering, TUI spawn on Linux, notification delivery timing.*
