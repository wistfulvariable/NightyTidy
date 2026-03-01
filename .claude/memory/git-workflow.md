# Git Workflow — Tier 2 Reference

Assumes CLAUDE.md loaded. All git ops in `src/git.js` via `simple-git`.

## Module State

- `let git = null` — module-level singleton
- `initGit(projectDir)` creates `simpleGit(projectDir)` instance
- `getGitInstance()` returns the singleton (used by `cli.js` for report commits)

## Timestamp Format

`getTimestamp()` → `YYYY-MM-DD-HHMM` (e.g., `2026-03-01-0230`)
Used for both tag names and branch names.

## Safety Tag

`createPreRunTag()`:
- Creates `nightytidy-before-YYYY-MM-DD-HHMM`
- If tag exists (same minute), appends `-2` suffix
- No further retry — third collision in same minute would throw

## Run Branch

`createRunBranch(sourceBranch)`:
- Creates `nightytidy/run-YYYY-MM-DD-HHMM`
- Uses `git.checkoutLocalBranch()` — creates and checks out in one call
- No collision handling (unlike tags)

## Commit Verification

After each step:
1. `getHeadHash()` captures hash before step
2. Step runs (Claude may or may not commit)
3. `hasNewCommit(preHash)` checks if HEAD moved
4. If not: `fallbackCommit(stepNumber, stepName)` runs `git add -A` + commit

`fallbackCommit` skips commit if working tree is clean (returns `false`).

## Merge Strategy

`mergeRunBranch(originalBranch, runBranch)`:
1. `git.checkout(originalBranch)` — switch back
2. `git.merge([runBranch, '--no-ff'])` — always create merge commit
3. On conflict: `git.merge(['--abort'])`, return `{ success: false, conflict: true }`

## Exported Functions

| Function | Returns | Throws? |
|----------|---------|---------|
| `initGit(dir)` | git instance | No |
| `getCurrentBranch()` | string | If git fails |
| `createPreRunTag()` | tag name string | If both tag attempts fail |
| `createRunBranch(src)` | branch name string | If branch creation fails |
| `getHeadHash()` | hash string | If git fails |
| `hasNewCommit(hash)` | boolean | If git fails |
| `fallbackCommit(num, name)` | boolean | If commit fails |
| `mergeRunBranch(orig, run)` | `{ success }` or `{ success, conflict }` | **Never** |
| `getGitInstance()` | git instance | No |
