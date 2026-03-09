# Git Workflow — Tier 2 Reference

Assumes CLAUDE.md loaded. All git ops in `src/git.js` via `simple-git`.

## Module State

- `let git = null` — module-level singleton, set by `initGit(projectDir)`
- `let projectRoot = null` — stored for `excludeEphemeralFiles()`
- `getGitInstance()` returns the singleton (used by cli.js for report commits)

## Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `EPHEMERAL_FILES` | `['nightytidy-run.log', 'nightytidy-progress.json', 'nightytidy-dashboard.url', 'nightytidy-run-state.json']` | Excluded from git tracking |
| `MAX_NAME_RETRIES` | 10 | Max collision retry attempts for tags/branches |

## Ephemeral File Exclusion

`excludeEphemeralFiles()` writes to `.git/info/exclude` (local, not committed).
`fallbackCommit()` relies on `.git/info/exclude` — uses plain `git add -A` (no `:!` pathspec).
Prevents log/progress/state files from being tracked by `git add -A`.

## Timestamp Format

`getTimestamp()` → `YYYY-MM-DD-HHMM` (e.g., `2026-03-01-0230`). Used for both tags and branches.

## Tag + Branch Creation (with collision retry)

`createPreRunTag()` → `nightytidy-before-YYYY-MM-DD-HHMM`
`createRunBranch(sourceBranch)` → `nightytidy/run-YYYY-MM-DD-HHMM`

Both use counter loop: if name exists, retry with `-2`, `-3`, ..., up to 10 attempts. Throws if all fail.

## Commit Verification

After each step:
1. `getHeadHash()` captures hash before step (returns `null` on empty repos)
2. Step runs (Claude may or may not commit)
3. `hasNewCommit(preHash)` checks if HEAD moved
4. If no new commit: `fallbackCommit(stepNumber, stepName)` → `git add -A` + commit
5. `fallbackCommit` returns `false` if working tree is clean

## Merge Strategy

`mergeRunBranch(originalBranch, runBranch)`:
1. `git.checkout(originalBranch)` — switch back
2. `git.merge([runBranch, '--no-ff'])` — always create merge commit
3. On conflict: `git.merge(['--abort'])`, return `{ success: false, conflict: true }`

## Exported Functions

| Function | Returns | Throws? |
|----------|---------|---------|
| `initGit(dir)` | git instance | No |
| `excludeEphemeralFiles()` | void | No (swallows) |
| `getCurrentBranch()` | string | If git fails |
| `createPreRunTag()` | tag name | If all 10 attempts fail |
| `createRunBranch(src)` | branch name | If all 10 attempts fail |
| `getHeadHash()` | hash \| null | No (null on empty repo) |
| `hasNewCommit(hash)` | boolean | If git fails |
| `fallbackCommit(num, name)` | boolean | No (swallows) |
| `mergeRunBranch(orig, run)` | `{ success, conflict? }` | **Never** |
| `getGitInstance()` | git instance | No |
