# Future Features (Post-MVP)

## Overview

All features explicitly deferred from MVP, organized by priority tier. These come from `possible-features.md` and `roadmap-operations-nightytidy.md`. Nothing here should be built until the MVP is stable and in regular use.

## Dependencies

- `00_README.md` — references this file for deferred scope

## P1 — Immediately After MVP

Small, high-value additions. Each is a few hours of work and addresses a real friction point discovered during early usage.

### Lock File

**What**: Prevent concurrent NightyTidy runs in the same directory.
**Why**: Two simultaneous runs would create conflicting branches and commits.
**How**: Create `nightytidy.lock` in the project directory at run start. Remove on completion (or crash — check for stale locks on next run).
**Error**: `"NightyTidy is already running in this directory (started at 11:42 PM). Check progress in nightytidy-run.log."`
**Effort**: ~2 hours.

### `nightytidy status` Command

**What**: Quick check of current run progress without opening the log file.
**How**: During a run, write a `nightytidy-status.txt` file updated at each step transition. The `status` command reads and displays it.
**Content**: `"Step 14/28: Security Audit (running since 3:47 AM) — 13 completed, 0 failed"`
**Effort**: ~3 hours (Commander subcommand + status file writer).

### Step-Level Timing in Report

**What**: Record how long each step took and include it in `NIGHTYTIDY-REPORT.md`.
**Why**: Helps users understand which steps are heaviest for their codebase.
**How**: Already captured in MVP results — just needs to be surfaced in the report table. The MVP report includes duration; this is about making it more prominent and adding a "longest steps" callout.
**Effort**: ~2 hours.

### Automatic Test Validation

**What**: After each step, run the project's test suite to verify nothing was broken.
**Why**: A step could introduce a bug that tests catch. Better to know immediately than after all 28 steps.
**How**: Detect test command (`npm test`, `yarn test`, `pytest`, etc.) from package.json scripts or common conventions. Run after each step. If tests fail, treat as step failure (retry, then skip).
**Complexity**: Medium — test command detection across ecosystems.
**Effort**: ~1 day.

## P2 — After First Few Weeks

Address real pain points that emerge from regular usage. Each is 3 hours to 2 days.

### Before/After Diff Stats

**What**: Lines changed, files modified, tests added — in the report header.
**Why**: Makes the value tangible and shareable. "NightyTidy changed 847 lines across 42 files" hits harder than a narrative alone.
**How**: `git diff --stat` between pre-run tag and final commit. Parse output for summary numbers.
**Effort**: ~4 hours.

### Resume from Interruption

**What**: If a run was interrupted (power outage, crash), detect the incomplete run and offer to resume from the last completed step.
**Why**: A 6-hour run dying at step 20 means losing all progress. Resumption saves hours.
**How**: Write a state file (`.nightytidy/current-run.json`) tracking completed steps. On next invocation, detect it and offer: `"Incomplete run detected (20/28 steps done). Resume? [Y/n]"`
**Complexity**: Medium — state management, resume logic, handling the case where code changed between interruption and resume.
**Effort**: ~1-2 days.

### `nightytidy undo` Command

**What**: One-command rollback: `nightytidy undo` resets the original branch to the pre-run git tag.
**Why**: Vibe coders don't know `git reset --hard`. A named command is safer and more discoverable.
**How**: Read the tag name from `.nightytidy/last-run.json` or parse git tags. Confirm with the user: `"This will undo all changes from the last NightyTidy run. Continue? [y/N]"`. Then `git reset --hard {tag}`.
**Safety**: Require explicit confirmation. Show what will be lost (number of commits to be undone).
**Effort**: ~3 hours.

### Sleep/Hibernate Detection

**What**: Warn the user at launch if their power settings allow the computer to sleep.
**Why**: Sleep kills the run. Users who don't know to disable it lose hours of progress.
**How**:
- Windows: Check power plan via `powercfg /query` — look for sleep timeout values
- macOS: Check `pmset -g` for sleep settings
**Output**: `"⚠️ Your computer is set to sleep after 30 minutes. NightyTidy runs take 4-8 hours. Disable sleep? [link to settings]"`
**Effort**: ~4 hours (cross-platform).

## P3 — When Someone Asks For It

Nice-to-haves that polish the experience. Build when requested or when there's downtime.

### Run Time Estimation

**What**: Before starting, estimate total run time based on project size.
**Why**: User knows whether to kick it off Friday afternoon or Friday night.
**How**: Count files and lines in the project. Use historical timing data from past runs if available. Display: `"Estimated run time: 5-7 hours (based on 342 files, 28,000 lines)"`
**Prerequisite**: Needs timing data from several real runs to calibrate estimates.
**Effort**: ~4 hours.

### Framework Detection

**What**: Detect the project's primary language/framework and include context in prompts.
**Why**: "This is a Next.js project using Prisma" gives Claude Code better context for targeted improvements.
**How**: Check for `package.json` (Node.js), `requirements.txt` (Python), `Cargo.toml` (Rust), etc. Detect framework from dependencies. Prepend context line to each prompt.
**Risk**: Prompt modification could change behavior of the proven 28-step system. Test carefully.
**Effort**: ~1 day.

### HTML Visual Report

**What**: A styled HTML version of `NIGHTYTIDY-REPORT.md` with collapsible sections and color-coded pass/fail.
**Why**: Looks professional, easier to scan than markdown.
**How**: Single self-contained HTML file with inline CSS. No external dependencies. Generated alongside the markdown report.
**Effort**: ~1-2 days.

### Codebase Health Score

**What**: A 1-100 score after each run based on step results. Tracked over time.
**Why**: Gamifies the improvement process. Users want to see their score go up.
**How**: Weighted scoring based on step pass/fail. Store in `.nightytidy/history.json`. Display trend in report.
**Effort**: ~1 day.

### Slack/Discord Webhook

**What**: Optional `NIGHTYTIDY_WEBHOOK_URL` environment variable for team notifications.
**Why**: Teams want shared visibility when someone runs NightyTidy.
**How**: POST a JSON payload (step counts, duration, branch name) to the webhook URL on completion.
**Effort**: ~4 hours.

## Stretch — If There's Appetite

Features that would be cool but require significant investment.

### Smart Step Ordering

**What**: Analyze the codebase before running and reorder steps for maximum impact.
**Why**: A project with zero tests benefits more from running Test Coverage first. A project with no docs benefits more from Documentation first.
**How**: Pre-analysis step that scores the codebase on each dimension, then reorders accordingly.
**Risk**: Changes the proven step order. Needs extensive testing.
**Effort**: ~2-3 days.

### Visual "Good Morning" Terminal Summary

**What**: When the user opens a new terminal after a completed run, show a brief one-liner.
**Why**: Delightful — the user sees it before they even think about NightyTidy.
**How**: Add a line to `.bashrc`/`.zshrc` (or equivalent) that checks for a completion marker and prints a summary. Fragile and intrusive — needs careful implementation.
**Effort**: ~4 hours (but high risk of breaking user shell configs).

### Trend Tracking Across Runs

**What**: Track metrics over time (steps passed, health score, run duration) and show improvement.
**Why**: Compound improvement is a key value prop. Showing the trend makes it tangible.
**How**: Append metrics to `.nightytidy/history.json` after each run. Generate a simple text-based trend in the report.
**Effort**: ~1 day.

### Team Leaderboard

**What**: For teams using NightyTidy, track whose projects have the best health scores.
**Why**: Gamification encourages regular usage across a team.
**How**: Would need a shared backend or shared file. Significant architectural departure from the local-only model.
**Effort**: ~1 week. Probably not worth it for a company of a few dozen people.

### CI/CD Integration

**What**: Documentation and example config for running NightyTidy in GitHub Actions.
**Why**: Teams that want automated weekly runs without relying on someone's laptop.
**How**: GitHub Action workflow YAML that installs NightyTidy, authenticates Claude Code, and runs. Needs a headless Claude Code auth mechanism.
**Blocker**: Claude Code auth in CI is unclear. May not be supported.
**Effort**: ~1 day (docs) + unknown (auth issues).

### Rollback Individual Steps

**What**: Revert a single step's changes via its git commit.
**Why**: If Step 7 specifically caused issues, undo just that step instead of the whole run.
**How**: `nightytidy undo --step 7` — identify the commit(s) for that step and `git revert` them.
**Complexity**: High — step commits may depend on each other.
**Effort**: ~1-2 days.

## Implementation Notes

- **Build P1 features within the first week of real usage.** They're cheap and address obvious gaps (lock file, status command).
- **P2 features should be driven by actual user pain.** Don't build "resume from interruption" until someone actually loses a run to a power outage.
- **P3 and stretch features are investment decisions.** Build them when there's clear demand and time.
- **Every post-MVP feature should be a separate branch and PR** — don't bundle unrelated features.
