# Testing Strategy

## Overview

Testing approach for NightyTidy using Vitest. Focus tests on the critical paths that, if broken, would silently ruin a user's 6-hour overnight run. Don't test obvious things — test the things that would be painful to debug at 3 AM when a user reports their run failed.

## Dependencies

- `01_Project_Setup.md` — Vitest dependency and npm scripts
- All modules — this file describes how to test them

## Vitest Configuration

Zero-config for MVP. Vitest discovers `*.test.js` files in the `test/` directory automatically with ESM support out of the box.

If explicit config is needed later, add `vitest.config.js`:

```javascript
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    testTimeout: 10000,  // 10s per test (git operations can be slow)
  }
});
```

Run tests: `npm test` (runs `vitest run` — single pass, no watch).
During development: `npm run test:watch` (runs `vitest` in watch mode).

## What to Test (By Module)

### `checks.js` — Pre-Run Checks

**Priority: High.** If checks don't catch problems, users start 6-hour runs that fail immediately.

| Test Case | What to Mock | Verify |
|-----------|-------------|--------|
| Git not installed | `spawn('git')` → ENOENT | Throws with "Git is not installed" message |
| Not a git repo | `simpleGit.checkIsRepo()` → false | Throws with "not a git project" message |
| Claude Code not installed | `spawn('claude')` → ENOENT | Throws with "Claude Code not detected" message |
| Claude Code not authenticated | `spawn('claude', ['-p', 'Say OK'])` → timeout | Throws with "not authenticated" message |
| Low disk space (warning) | Disk check → 500 MB | Logs warning, does NOT throw |
| Very low disk space (fail) | Disk check → 50 MB | Throws with "low disk space" message |
| All checks pass | All mocks succeed | Returns without throwing |

**Mocking approach**: Mock `child_process.spawn` to simulate process behavior. Mock `simple-git` methods. For disk space, mock the OS-specific command output.

### `claude.js` — Claude Code Integration

**Priority: Critical.** This is the most complex module and the one most likely to have subtle bugs.

| Test Case | What to Mock | Verify |
|-----------|-------------|--------|
| Successful execution | spawn → exit 0, non-empty stdout | Returns `{ success: true, output: "..." }` |
| Failed execution, retry succeeds | spawn → exit 1 first, exit 0 second | Returns success, `attempts: 2` |
| All retries exhausted | spawn → exit 1 four times | Returns `{ success: false }`, `attempts: 4` |
| Timeout | spawn → never closes (within test timeout) | Returns failure with timeout message |
| Empty stdout with exit 0 | spawn → exit 0, stdout "" | Treated as failure, retries |
| Spawn error (ENOENT) | spawn → 'error' event | Returns failure |
| Long prompt (>8000 chars) | N/A | Verify stdin mode is used instead of `-p` flag |
| Retry backoff timing | Mock timers | 10s delay between retries |

**Mocking approach**: Create a mock spawn factory that returns fake child processes with controllable stdout, stderr, exit codes, and events.

### `git.js` — Git Operations

**Priority: High.** Git state corruption is the worst possible failure mode.

| Test Case | Setup | Verify |
|-----------|-------|--------|
| Create pre-run tag | Temp git repo with commits | Tag exists, points to HEAD |
| Create run branch | Temp git repo | Branch exists, checked out |
| Commit verification — commit made | Make a commit after hash capture | `hasNewCommit()` → true |
| Commit verification — no commit | Don't change anything | `hasNewCommit()` → false |
| Fallback commit — with changes | Create a file | Commit made with correct message |
| Fallback commit — no changes | Clean working tree | No commit, no error |
| Merge — clean | Commits on run branch | Merge succeeds, back on original branch |
| Merge — conflict | Conflicting commits on both branches | Returns conflict indicator, doesn't throw |
| Branch naming | Mock date | Correct format: `nightytidy/run-YYYY-MM-DD-HHmm` |

**Mocking approach**: Use real git operations against a temporary directory. Create temp repos with `fs.mkdtemp` + `git init`. This tests actual git behavior, not mocked abstractions.

```javascript
import { mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

let tempDir;
beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), 'nightytidy-test-'));
  // git init, create initial commit
});
afterEach(async () => {
  // cleanup tempDir
});
```

### `executor.js` — Step Executor

**Priority: Critical.** Bugs here silently skip steps or lose work.

| Test Case | What to Mock | Verify |
|-----------|-------------|--------|
| All steps succeed | `runPrompt` → success | All results `completed`, correct count |
| One step fails | `runPrompt` → fail on step 3 | Step 3 `failed`, others `completed`, notification sent |
| All steps fail | `runPrompt` → all fail | All `failed`, run still completes |
| Doc update fails | Improvement succeeds, doc update fails | Step still `completed`, warning logged |
| Commit verification triggers fallback | `hasNewCommit` → false | `fallbackCommit` called |
| Abort signal mid-run | Abort after step 2 | Only steps 1-2 in results, partial results returned |
| Narrated changelog fails | Changelog `runPrompt` → fail | Results still returned, narration is null |
| Step timing recorded | Mock `Date.now` | Each result has correct duration |

**Mocking approach**: Mock `runPrompt`, all git operations, and `notify`. Verify call sequences and arguments.

### `report.js` — Report Generation

**Priority: Medium.** Bugs here are visible but not destructive.

| Test Case | Verify |
|-----------|--------|
| Full success report | All sections present, no "Failed Steps" section |
| Partial success report | "Failed Steps" section present with details |
| Report without narration | Fallback paragraph used |
| Duration formatting | <1h, >1h, >12h all format correctly |
| CLAUDE.md update — file exists | Section added/replaced |
| CLAUDE.md update — file missing | File created with section |
| Undo instructions | Correct tag name in both plain-English and git command |

### `notifications.js` — Notifications

**Priority: Low.** Notifications are fire-and-forget by design.

| Test Case | Verify |
|-----------|--------|
| notify() calls node-notifier | `notifier.notify` called with title and message |
| notify() doesn't throw on error | Mock notifier to throw → no exception propagated |

## Testing Principles

1. **Mock Claude Code, not git.** Use real git against temp directories. Mock the Claude Code subprocess entirely — never spawn real Claude Code in tests.
2. **Test the failure paths harder than the success paths.** Success is easy. The retry logic, fallback commits, graceful degradation, and error messages are where bugs hide.
3. **Don't test library behavior.** Don't test that Commander parses args or that Inquirer renders a checkbox. Test your code, not theirs.
4. **Keep tests fast.** Mocked tests should run in milliseconds. Git tests against temp repos in low hundreds of milliseconds. Total test suite target: under 10 seconds.

## First Real Run Checklist

After tests pass, validate against a real project before shipping:

1. Pick your smallest, least critical project
2. Run `nightytidy` with all 28 steps selected
3. Watch the log in a second terminal: `tail -f nightytidy-run.log`
4. Verify:
   - [ ] Pre-run checks all pass
   - [ ] Git tag and branch created correctly
   - [ ] "Run started" notification received
   - [ ] Spinner updates at each step transition
   - [ ] Steps execute sequentially (check log timestamps)
   - [ ] Commits appear after each step (check `git log` on the run branch)
   - [ ] At least one step completes successfully
   - [ ] If a step fails, notification is received and run continues
   - [ ] Report generated with narrated changelog
   - [ ] Auto-merge completes
   - [ ] "Run complete" notification received
   - [ ] Terminal shows final summary
5. Review `NIGHTYTIDY-REPORT.md` — does the narrated changelog make sense?
6. Check `CLAUDE.md` — was it updated with the undo instruction?
7. Run `git log --oneline` — do the commits look clean?

Fix issues and repeat until a full run completes cleanly.

## Gaps & Assumptions

- **No integration tests** in MVP. The "first real run checklist" serves as manual integration testing. Automated end-to-end tests (spawning real Claude Code against a test repo) are a post-MVP consideration.
- **No CI pipeline.** Tests run locally only. GitHub Actions or similar can be added when the project is published.
- **Test coverage target**: No numeric target. Cover the critical paths listed above. Don't chase coverage percentages.
