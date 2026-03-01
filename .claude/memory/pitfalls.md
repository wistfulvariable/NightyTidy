# Pitfalls — Tier 2 Reference

Assumes CLAUDE.md loaded. Platform-specific issues, bugs, and gotchas.

## Windows-Specific Issues

### ENOENT on spawn
- `spawn('claude', ...)` throws ENOENT on some Windows setups
- Fallback: re-spawn with `shell: true`
- Affects both `checks.js` (uses own `runCommand`) and `claude.js` (uses `spawnClaude`)
- `checks.js` always passes `shell: platform() === 'win32'` upfront
- `claude.js` tries without shell first, falls back on ENOENT

### Disk Space Check
- Windows: tries PowerShell `Get-PSDrive` first, falls back to `wmic logicaldisk`
- Unix: uses `df -k`
- All methods can fail — check is non-fatal, logs "skipped" and continues

### Path Separators
- `simple-git` handles path normalization internally
- `path.join()` used throughout — no hardcoded separators
- Log file path: `path.join(projectDir, 'nightytidy-run.log')`

## Subprocess Gotchas

### Claude Code stdout can be empty on success
- Exit code 0 with no stdout → treated as failure
- This triggers unnecessary retries — but no harm done
- Whitespace-only stdout also counts as empty

### Timeout race condition
- `runOnce()` has `settled` flag to prevent double-resolve
- Both timeout and close/error handlers check `settled` before resolving
- Without this: Promise would resolve twice on timeout + delayed close

### SIGKILL grace period
- `child.kill()` sends SIGTERM, then 5s timer sends SIGKILL
- The SIGKILL timer is NOT cleared if the process exits gracefully during the 5s window
- Minor issue — `try { child.kill('SIGKILL') } catch {}` handles "already dead"

## Resolved Technical Debt (for reference)

- `formatTerminalDuration` in `cli.js` was consolidated — now imports `formatDuration` from `report.js`
- `findExistingRunBranches()` removed from `git.js` — was dead code (logic inline in `checks.js`)
- `skippedCount` removed from executor return — was hardcoded `0`, phantom feature

## Singleton State Risks

- `logger.js`: `logFilePath` and `minLevel` are module-level. Calling `initLogger()` again mid-run overwrites the log file (clears it).
- `git.js`: `git` is module-level. Calling `initGit()` again changes the working directory for all callers.
- Both are safe in normal usage (init once in `cli.js`), but tests must be careful to re-init per test.

## Edge Cases

- **Tag collision**: `createPreRunTag()` handles same-minute collision with `-2` suffix, but NOT three-in-same-minute
- **Merge conflict abort**: `git.merge(['--abort'])` can itself throw — caught and ignored
- **Welcome marker**: Creates `~/.nightytidy/` directory — failure is silently ignored
- **Empty step selection**: User deselects all → `process.exit(0)` with yellow message
