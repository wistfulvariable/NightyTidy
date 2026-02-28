# Git Operations

## Overview

Wrapper around `simple-git` handling all git operations NightyTidy performs: branch creation, pre-run tagging, commit verification, fallback commits, and the final merge. NightyTidy's git responsibilities are limited to setup and finalization — per-step commits are handled by Claude Code via the doc update prompt. NightyTidy only touches git directly when Claude Code doesn't.

## Dependencies

- `02_Logger.md` — logs all git operations
- `01_Project_Setup.md` — simple-git dependency

## Module: `src/git.js`

### Exported Interface

```javascript
import simpleGit from 'simple-git';

// Initialize simple-git for the given project directory. Call once at startup.
export function initGit(projectDir)

// Get the current branch name
export async function getCurrentBranch()

// Create the pre-run safety tag. Returns the tag name.
export async function createPreRunTag()

// Create and checkout the NightyTidy working branch. Returns the branch name.
export async function createRunBranch(sourceBranch)

// Check if a new commit was made since the given commit hash
export async function hasNewCommit(sinceHash)

// Get the current HEAD commit hash
export async function getHeadHash()

// Perform a fallback commit (git add -A + commit) if Claude Code didn't commit
export async function fallbackCommit(stepNumber, stepName)

// Merge the run branch back into the original branch
export async function mergeRunBranch(originalBranch, runBranch)

// Check if NightyTidy branches already exist (informational)
export async function findExistingRunBranches()
```

### Naming Conventions

**Branch name format**: `nightytidy/run-YYYY-MM-DD-HHmm`
- Example: `nightytidy/run-2026-02-27-2314`
- Uses local time for readability (the user sees this in git log)
- Minutes included to avoid collisions if the user runs twice in one day

**Tag name format**: `nightytidy-before-YYYY-MM-DD-HHmm`
- Example: `nightytidy-before-2026-02-27-2314`
- Same timestamp as the corresponding branch for easy correlation

**Fallback commit message format**: `NightyTidy: Step {N} — {Name} complete`
- Example: `NightyTidy: Step 7 — File Decomposition complete`
- Only used when Claude Code didn't commit after the doc update prompt

### Operation Details

#### Pre-Run Tag (`createPreRunTag`)

Creates a lightweight git tag on the current HEAD before any work begins. This is the user's safety net — if the entire run needs to be undone, they reset to this tag.

```
git tag nightytidy-before-2026-02-27-2314
```

Log: `[INFO] Created pre-run safety tag: nightytidy-before-2026-02-27-2314`

If the tag already exists (extremely unlikely given timestamp), append a counter: `nightytidy-before-2026-02-27-2314-2`.

#### Run Branch (`createRunBranch`)

Creates a new branch from the user's current branch and checks it out. All NightyTidy work happens on this branch.

```
git checkout -b nightytidy/run-2026-02-27-2314
```

Log: `[INFO] Created run branch: nightytidy/run-2026-02-27-2314 (from main)`

#### Commit Verification (`hasNewCommit`)

After each doc update prompt completes, the executor calls `hasNewCommit(hashBeforeDocUpdate)` to check if Claude Code actually committed.

Implementation: compare `getHeadHash()` against the provided hash. If different, Claude Code committed. If same, no commit was made.

#### Fallback Commit (`fallbackCommit`)

Called when commit verification shows Claude Code didn't commit. This ensures no step's work is silently lost.

```
git add -A
git commit -m "NightyTidy: Step 7 — File Decomposition complete"
```

**Edge case**: If `git add -A` results in nothing staged (no changes at all), skip the commit and log:
```
[INFO] Step 7: No changes detected — skipping fallback commit
```

This can happen legitimately if a step determined the codebase already met its criteria.

#### Merge (`mergeRunBranch`)

Called after all steps complete. Merges the run branch back into the user's original branch.

```
git checkout main
git merge nightytidy/run-2026-02-27-2314 --no-ff
```

Uses `--no-ff` to preserve the branch history as a merge commit, making the NightyTidy run visible as a distinct unit in git log.

**On success**:
- Log: `[INFO] Merged nightytidy/run-2026-02-27-2314 into main`
- Do NOT delete the run branch — preserve it as an audit trail

**On conflict**:
- Do NOT attempt automatic resolution
- Leave the repo in the conflict state on the original branch
- Log: `[ERROR] Merge conflict merging nightytidy/run-2026-02-27-2314 into main`
- Return a conflict indicator so the executor can trigger a notification (see `13_Post_Run_Finalization.md`)

### How Merge Conflicts Happen

Conflicts are rare but possible if:
1. The user committed to their original branch while NightyTidy was running (e.g., from another terminal or machine)
2. Two NightyTidy runs overlap on the same branch (prevented by the lock file in post-MVP, but not in MVP)

In MVP, the notification tells the user what happened and suggests either `nightytidy undo` (post-MVP) or manual resolution. See `13_Post_Run_Finalization.md` for the notification text.

### Git State Safety

Critical invariant: **NightyTidy must never leave the repo in a broken state.**

- If any git operation fails, log the error and throw. The top-level error handler (see `11_Error_Handling.md`) catches it.
- Never force-push, force-merge, or reset without user consent.
- The pre-run tag is the ultimate safety net. Even if everything else goes wrong, the user can `git reset --hard nightytidy-before-{timestamp}` to get back to exactly where they started.

### Working Tree State

Per PRD: NightyTidy runs regardless of whether the working tree is clean or dirty. It does NOT stash or commit uncommitted changes before starting. The user's uncommitted work will be included in the first step's context.

This is a deliberate choice — vibe coders may not understand stashing, and forcing a clean tree adds friction. The pre-run tag captures the state including uncommitted changes (as a tag on the current commit — uncommitted changes aren't in the tag, but the branch point is preserved).

## Testing Notes

- Use a temporary git repo (`mkdtemp` + `git init`) for all tests.
- Test branch creation, tag creation, commit verification (both cases: commit made and not made).
- Test fallback commit with changes, and fallback commit with no changes (should skip).
- Test merge — both clean merge and conflict scenarios.
- Test the timestamp-based naming doesn't collide (mock Date if needed).

## Gaps & Assumptions

- **Uncommitted changes and the pre-run tag** — The tag marks a commit, not the working tree state. If the user had uncommitted changes, those are NOT captured in the tag. The PRD doesn't address this. Acceptable for MVP — the tag still provides the branch point for reset.
- **Branch naming collision** — The minute-resolution timestamp makes collision extremely unlikely. The counter suffix handles the edge case.
- **Large repos** — `git add -A` on a very large repo could be slow. No mitigation in MVP; this is expected to be negligible for the target audience's project sizes.
- **Submodules** — Not addressed. NightyTidy operates on the root repo only. Submodule behavior is undefined.
