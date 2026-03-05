# Pre-Run Checks

## Overview

Validation gates that run before any execution begins. The principle: never start a multi-hour run that will fail 5 minutes in due to a detectable precondition. All checks run sequentially; fail fast on the first failure with a clear, human-readable error message.

## Dependencies

- `02_Logger.md` — logs each check's result
- `04_Git_Operations.md` — uses git module for repo checks

## Module: `src/checks.js`

### Exported Interface

```javascript
// Runs all pre-run checks. Throws with a user-friendly message on failure.
// projectDir: the directory the user ran nightytidy from (process.cwd())
export async function runPreChecks(projectDir)
```

### Check Sequence

Checks run in this order. Each check either passes silently or throws an error that halts the run.

#### 1. Git Installed

**What**: Verify `git` is available on PATH.
**How**: Spawn `git --version` and check for successful exit.
**Fail message**:
```
Git is not installed or not on your PATH.
Install it from https://git-scm.com and try again.
```

#### 2. Git Repository

**What**: Verify the current directory is inside a git repository.
**How**: `simple-git.checkIsRepo()`
**Fail message**:
```
This folder isn't a git project. Navigate to your project folder and try again.
If you need to set one up, run: git init
```

#### 3. Claude Code Installed

**What**: Verify the `claude` CLI is available on PATH.
**How**: Spawn `claude --version` and check for successful exit.
**Fail message**:
```
Claude Code not detected.
Install it from https://docs.anthropic.com/en/docs/claude-code and sign in before running NightyTidy.
```

**Windows note**: The `claude` command may be installed as `claude.cmd` or via an npm global. `child_process.spawn` with `{ shell: true }` on Windows ensures both are found. Use `shell: true` only for these detection checks, not for actual prompt execution (security concern — see `05_Claude_Code_Integration.md`).

#### 4. Claude Code Authenticated

**What**: Verify Claude Code can actually reach the API (not just installed but logged in).
**How**: Send a trivial prompt: `claude -p "Say OK"` and check for successful exit with non-empty stdout.
**Timeout**: 30 seconds. If Claude Code hangs, treat as failure.
**Fail message**:
```
Claude Code is installed but doesn't seem to be authenticated.
Run `claude` in your terminal and follow the sign-in steps, then try NightyTidy again.
```

**Fail message (timeout)**:
```
Claude Code didn't respond within 30 seconds. It may be experiencing an outage.
Check https://status.anthropic.com and try again later.
```

#### 5. Disk Space

**What**: Basic sanity check that there's room for git operations.
**How**: Check available disk space on the volume containing `projectDir`.
- On Windows: `wmic logicaldisk where "DeviceID='C:'" get FreeSpace` (or parse the drive letter from projectDir)
- On macOS/Linux: `df -k {projectDir}` and parse available space
**Threshold**: Warn if < 1 GB free. Fail if < 100 MB free.
**Warn message**:
```
Low disk space (X MB free). NightyTidy may fail if your project generates large diffs.
Continuing anyway...
```
**Fail message**:
```
Very low disk space (X MB free). NightyTidy needs room for git operations.
Free up some space and try again.
```

#### 6. Existing NightyTidy Branch

**What**: Check if a `nightytidy/run-*` branch already exists from a previous run.
**How**: List branches matching `nightytidy/run-*` pattern via simple-git.
**Behavior**: This is NOT a failure. NightyTidy uses timestamped branch names (`nightytidy/run-2026-02-27-2314`), so collisions don't happen. But if old branches exist, log an info message:
```
Note: Found existing NightyTidy branch(es) from previous run(s). These won't affect this run.
```

This is informational only — don't block the run.

### Check Output

Each check logs its result:
```
[INFO]  Pre-check: git installed ✓
[INFO]  Pre-check: git repository ✓
[INFO]  Pre-check: Claude Code installed ✓
[INFO]  Pre-check: Claude Code authenticated ✓
[INFO]  Pre-check: disk space OK (24.3 GB free) ✓
[INFO]  Pre-check: no branch conflicts ✓
[INFO]  All pre-run checks passed
```

On failure, the check that failed is logged at ERROR level with the user-facing message, then the function throws.

### Error Design Principles

- **Every error message is written for a vibe coder.** No git jargon, no stack traces, no exit codes shown to the user.
- **Every error tells the user what to do.** Not just "X is missing" but "install X from [link]" or "run [command]".
- **Fail on the first error.** Don't accumulate multiple failures — the user needs to fix one thing at a time.

## Testing Notes

- Mock `child_process.spawn` to simulate git/claude presence and absence.
- Mock `simple-git` for repo detection.
- For disk space: mock the OS-specific command output. Test both the warn (< 1 GB) and fail (< 100 MB) thresholds.
- Test that the function throws on each individual check failure with the correct message.

## Gaps & Assumptions

- **Claude Code version compatibility** — The PRD mentions checking version compatibility but doesn't specify a minimum version. For MVP, just check that `claude --version` succeeds. Version pinning is deferred.
- **Disk space detection on Windows** — The `wmic` approach works on Windows 10/11 but may be deprecated in favor of PowerShell equivalents. If `wmic` fails, fall back to skipping the disk check with a debug log rather than failing the run.
- **Network connectivity** — Not explicitly checked. The Claude Code auth check (step 4) implicitly verifies network access. If the network is down, that check will timeout and surface the issue.
- **Git working tree state** — The PRD specifies "runs regardless of working tree state (dirty or clean)." No check for uncommitted changes. NightyTidy branches from whatever state the repo is in.
