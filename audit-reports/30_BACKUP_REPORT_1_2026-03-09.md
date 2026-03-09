# Audit #30 — Backup & Disaster Recovery

**Date**: 2026-03-09
**Auditor**: Claude Opus 4.6
**Scope**: Git safety tag mechanism, crash recovery, undo capability, npm package reproducibility

---

## Context

NightyTidy has no database, no cloud infrastructure, and no persistent user data. Its "backup" story is:
1. **Source code**: GitHub repository is the backup
2. **User's codebase**: Git safety tag + dedicated branch = built-in rollback
3. **No persistent data**: Everything is ephemeral per-run (log, progress JSON, lock file, state file)

This audit evaluates how robustly those mechanisms protect the user's work.

---

## Findings

### FINDING-01: Safety tag mechanism is robust (NO ACTION)

**Severity**: Informational (positive finding)

The `createPreRunTag()` function in `src/git.js` creates a `nightytidy-before-YYYY-MM-DD-HHMM` tag before any changes occur. Key strengths:

- Tag is created **before** the run branch, so it always points to the exact commit the user was on
- Collision handling via `retryWithSuffix()` — if tag exists, appends `-2`, `-3`, etc. up to 10 attempts
- Tag is a lightweight git tag pointing to HEAD — immutable once created
- Both interactive mode (`cli.js:438`) and orchestrator mode (`orchestrator.js:242`) call `createPreRunTag()` before any work begins
- Integration test in `integration.test.js:244-261` explicitly verifies the tag preserves pre-run state even after changes

**Tag creation order (both modes)**:
1. Pre-checks pass
2. `createPreRunTag()` -- safety snapshot
3. `createRunBranch()` -- switches to work branch
4. Steps execute on the work branch

This ordering is correct. The tag is always created before any modifications.

---

### FINDING-02: Crash recovery is well-handled (NO ACTION)

**Severity**: Informational (positive finding)

Multiple crash scenarios are covered:

| Scenario | Protection |
|----------|-----------|
| SIGINT (Ctrl+C) once | `handleAbortedRun()` generates partial report, notifies user of branch name |
| SIGINT twice | Force exit — safety tag still valid |
| Unhandled rejection | `process.on('unhandledRejection')` handler in cli.js — logs and displays safety tag |
| Exception during run | Top-level try/catch in `run()` — displays `"Your code is safe. Reset to tag ${tagName} to undo"` |
| Lock file orphaned | `isLockStale()` detects dead PIDs; 24h max age catches PID recycling |
| Orchestrator crash | State file uses atomic write (temp+rename); `readState()` returns null on corrupt JSON |
| Step failure | Never throws — returns result object, run continues with remaining steps |

The `SAFETY_PREAMBLE` sent to every Claude subprocess explicitly prevents destructive git operations:
- No file deletion
- No branch creation/switching/merging
- No `git reset`, `git clean`, `git checkout`, `git rm`

---

### FINDING-03: Undo instructions are clear and accessible (NO ACTION)

**Severity**: Informational (positive finding)

Undo is documented in three places:

1. **NIGHTYTIDY-REPORT.md** — generated report includes a "How to Undo This Run" section with both a Claude Code prompt and a raw `git reset --hard <tag>` command
2. **CLAUDE.md in target project** — updated with "Last run" section including the tag name
3. **Terminal output** — on error, displays the safety tag; on merge conflict, provides manual merge instructions

The report's `buildUndoSection()` (report.js:89-101) gives two undo paths:
- Non-technical: "Ask Claude Code to reset to tag X"
- Technical: `git reset --hard <tagName>`

Both are correct and tested.

---

### FINDING-04: Dedicated branch protects main branch (NO ACTION)

**Severity**: Informational (positive finding)

All NightyTidy changes happen on a `nightytidy/run-*` branch. The merge back uses `--no-ff` (always creates a merge commit), making it easy to revert the entire run with a single `git revert`. On merge conflict, the tool aborts the merge cleanly and leaves changes on the run branch for manual resolution.

---

### FINDING-05: Ephemeral files are properly excluded from git (NO ACTION)

**Severity**: Informational (positive finding)

`excludeEphemeralFiles()` adds all ephemeral files to `.git/info/exclude` (local-only, not committed). The list includes: `nightytidy-run.log`, `nightytidy-progress.json`, `nightytidy-dashboard.url`, `nightytidy-run-state.json`, `nightytidy-run-state.json.tmp`.

`fallbackCommit()` uses plain `git add -A` which respects `.git/info/exclude`. Tests verify ephemeral files are never staged.

---

### FINDING-06: npm package reproducibility is good (NO ACTION)

**Severity**: Informational (positive finding)

- `package.json` has a `files` field limiting published content to `bin/`, `src/`, `LICENSE`, `README.md` — no test files, no audit reports, no `.claude/` metadata
- No build step — source is the artifact. `npm pack` yields exactly what runs
- `engines` field requires `>=20.12.0`
- `npm ci` in CI (package-lock.json deterministic installs)
- Dependencies are minimal (6 runtime, 2 dev) and all from well-maintained packages

---

### FINDING-07: `gui/` directory not in npm package `files` field (LOW)

**Severity**: Low

The `gui/` directory exists in the repo but is not listed in the `files` field of `package.json`. This means `npm run gui` would fail when installed from npm. However, the GUI is currently a development/local feature and may be intentionally excluded. No action needed for backup/DR purposes — just noting it for completeness.

---

### FINDING-08: No dirty-working-tree check before run (LOW)

**Severity**: Low

NightyTidy does not check for uncommitted changes in the user's working tree before creating the safety tag and switching to the run branch. If a user has uncommitted changes:

1. The safety tag is created (good)
2. `createRunBranch()` calls `git.checkoutLocalBranch()` which carries uncommitted changes to the new branch
3. NightyTidy's changes get mixed with the user's uncommitted work
4. If the user undoes the run via `git reset --hard <tag>`, their uncommitted changes are lost

This is an edge case — users running an overnight tool likely don't have active uncommitted work. The safety tag still protects committed state. A warning would be helpful but is not critical.

---

## Summary

| # | Finding | Severity | Action |
|---|---------|----------|--------|
| 01 | Safety tag mechanism is robust | Info | None |
| 02 | Crash recovery is well-handled | Info | None |
| 03 | Undo instructions are clear | Info | None |
| 04 | Dedicated branch protects main | Info | None |
| 05 | Ephemeral files excluded from git | Info | None |
| 06 | npm package is reproducible | Info | None |
| 07 | `gui/` not in npm files field | Low | Note only |
| 08 | No dirty-working-tree check | Low | Implement warning |

## Verdict

NightyTidy's backup and disaster recovery story is **excellent** for a CLI tool of this nature. The safety tag mechanism is the linchpin — it always gets created before any work, it's tested at the integration level, it's referenced in error messages and reports, and it provides a single command to undo everything. The dedicated branch strategy adds a second layer of protection. Crash recovery is handled in all major scenarios (SIGINT, exceptions, orphaned locks).

The only actionable improvement is FINDING-08: warning users about uncommitted changes before starting a run.

---

*Generated by Claude Opus 4.6 — Audit #30*
