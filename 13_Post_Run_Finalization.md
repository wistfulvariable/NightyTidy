# Post-Run Finalization

## Overview

Everything that happens after the last step executes: narrated changelog generation, report writing, report commit, auto-merge back to the user's original branch, branch preservation, and completion notification. This is the sequence that determines what the user wakes up to.

## Dependencies

- `04_Git_Operations.md` — merge, commit operations
- `05_Claude_Code_Integration.md` — `runPrompt()` for narrated changelog
- `06_Prompt_Library.md` — `CHANGELOG_PROMPT`
- `08_Notifications.md` — completion and conflict notifications
- `09_Report_Generation.md` — `generateReport()`

## Finalization Sequence

After the executor returns results, the CLI module runs this sequence:

```
Executor returns results
  │
  ├─ 1. Generate narrated changelog (Claude Code)
  ├─ 2. Generate NIGHTYTIDY-REPORT.md
  ├─ 3. Update CLAUDE.md with undo instructions
  ├─ 4. Commit report + CLAUDE.md update (on run branch)
  ├─ 5. Merge run branch → original branch
  │     ├─ Success → continue
  │     └─ Conflict → notify, skip merge, leave branches as-is
  ├─ 6. Send completion notification
  └─ 7. Print terminal summary
```

### Step 1: Narrated Changelog

```javascript
const changelogResult = await runPrompt(CHANGELOG_PROMPT, projectDir);
const narration = changelogResult.success ? changelogResult.output : null;
```

If the changelog prompt fails (Claude Code error, timeout, empty response), set `narration` to null. The report generator handles the fallback text. Log a warning but don't fail the finalization.

This prompt runs in a fresh Claude Code session. It examines the git log and diffs on the run branch to generate specific, numbers-driven prose. The quality of this output depends on how much work the steps actually did — a run with many changes produces a richer changelog.

### Step 2-3: Report and CLAUDE.md

```javascript
await generateReport(results, narration, {
  projectDir,
  branchName: runBranch,
  tagName: preRunTag,
  originalBranch,
  startTime,
  endTime: Date.now()
});
```

This writes both `NIGHTYTIDY-REPORT.md` and updates `CLAUDE.md`. See `09_Report_Generation.md` for details.

### Step 4: Commit Report

The report and CLAUDE.md update need to be committed on the run branch before merging:

```javascript
await git.add(['NIGHTYTIDY-REPORT.md', 'CLAUDE.md']);
await git.commit('NightyTidy: Add run report and update CLAUDE.md');
```

This is a direct git operation by NightyTidy (not via Claude Code). It's the last commit on the run branch.

### Step 5: Auto-Merge

The most delicate operation. Merge the run branch back into the user's original branch.

```javascript
const mergeResult = await mergeRunBranch(originalBranch, runBranch);
```

#### Success Path

The merge completes cleanly. The user is now on their original branch with all NightyTidy improvements applied.

```
[INFO] Merged nightytidy/run-2026-02-27-2314 into main
[INFO] Run branch preserved: nightytidy/run-2026-02-27-2314
```

The run branch is NOT deleted. It's preserved as:
- An audit trail (every step's commits are visible)
- A rollback reference (the user can cherry-pick or diff against it)
- Peace of mind (nothing is lost)

#### Conflict Path

If the merge has conflicts (the user or another process committed to the original branch during the run):

1. **Abort the merge** — leave the repo clean on the original branch
2. **Log the conflict details**
3. **Send a merge conflict notification**:
   ```
   Title: "NightyTidy: Merge Conflict"
   Message: "Changes are on branch nightytidy/run-2026-02-27-2314. 
             See NIGHTYTIDY-REPORT.md for resolution steps."
   ```
4. **Print conflict instructions to terminal**:
   ```
   ⚠️  Merge conflict — your branch changed while NightyTidy was running.
   
   Your improvements are safe on: nightytidy/run-2026-02-27-2314
   
   To merge manually:
     git merge nightytidy/run-2026-02-27-2314
     (resolve conflicts)
     git commit
   
   Or ask Claude Code:
     "Merge the branch nightytidy/run-2026-02-27-2314 into my current branch
      and resolve any conflicts."
   
   To discard the NightyTidy changes:
     git branch -D nightytidy/run-2026-02-27-2314
   ```
5. **Include conflict instructions in the report** — the report was already committed to the run branch, but the user can find it there or check the notification.

The conflict path prioritizes safety over convenience. No automatic conflict resolution — that's a post-MVP feature.

#### Merge Strategy: `--no-ff`

Always use `--no-ff` (no fast-forward) to create an explicit merge commit. This makes the NightyTidy run visible as a distinct event in `git log`:

```
*   abc1234 Merge branch 'nightytidy/run-2026-02-27-2314'
|\
| * def5678 NightyTidy: Add run report and update CLAUDE.md
| * ghi9012 NightyTidy: Step 28 — Final Cleanup complete
| * ...
| * jkl3456 NightyTidy: Step 1 — Documentation complete
|/
* mno7890 (previous commit on main)
```

### Step 6: Completion Notification

Sent after the merge (or merge attempt):

```javascript
if (mergeSucceeded) {
  if (results.failedCount === 0) {
    notify('NightyTidy Complete ✓', 
           `All ${results.completedCount} steps succeeded. See NIGHTYTIDY-REPORT.md`);
  } else {
    notify('NightyTidy Complete', 
           `${results.completedCount}/${totalSteps} succeeded, ${results.failedCount} failed. See NIGHTYTIDY-REPORT.md`);
  }
} else {
  // Merge conflict notification sent separately (see conflict path above)
  notify('NightyTidy Complete', 
         `${results.completedCount}/${totalSteps} steps done. Merge needs attention — see terminal.`);
}
```

### Step 7: Terminal Summary

The last output the user sees (either that night or the next morning when they scroll up):

```
✅ NightyTidy complete — 28/28 steps succeeded (6h 42m)
📄 Report: NIGHTYTIDY-REPORT.md
🏷️  Safety tag: nightytidy-before-2026-02-27-2314
```

Or with failures:
```
⚠️  NightyTidy complete — 25/28 steps succeeded, 3 failed (7h 13m)
📄 Report: NIGHTYTIDY-REPORT.md
🏷️  Safety tag: nightytidy-before-2026-02-27-2314
```

Or with merge conflict:
```
⚠️  NightyTidy complete — 25/28 steps succeeded, but merge needs attention.
📄 Changes on branch: nightytidy/run-2026-02-27-2314
🏷️  Safety tag: nightytidy-before-2026-02-27-2314
```

### Partial Run (Ctrl+C Interrupted)

If the run was interrupted (see `10_CLI_Interface.md`), the finalization is abbreviated:

1. Skip narrated changelog (incomplete data)
2. Generate a partial report noting the interruption
3. Commit the partial report on the run branch
4. Do NOT merge (run was incomplete)
5. Notify: `"NightyTidy stopped: {X}/{Y} steps completed. Changes on branch {branchName}."`
6. Terminal: instructions for manual merge or re-run

## Error Handling During Finalization

Each finalization step has its own fallback:

| Step | If It Fails | Fallback |
|------|-------------|----------|
| Narrated changelog | Claude Code error | Report generated without narration (fallback text) |
| Report generation | File write error | Log error, still attempt merge. Report content printed to terminal as last resort |
| CLAUDE.md update | File write/parse error | Log warning, continue. Not critical. |
| Report commit | Git error | Log warning, still attempt merge. Report is in the working tree even if not committed. |
| Merge | Conflict or error | Conflict path (see above). Never force. |
| Notification | node-notifier error | Logged, ignored. Terminal summary is the backup. |

The principle: get as far as possible. Each step is independent enough that a failure in one doesn't prevent the others.

## Testing Notes

- Test the full finalization sequence with mocked dependencies
- Test merge success and conflict paths
- Test partial run (interrupted) finalization
- Test each fallback: changelog fails, report write fails, commit fails, merge conflicts
- Verify the correct notification content for each scenario
- Verify terminal output for each scenario (success, partial, conflict, interrupted)

## Gaps & Assumptions

- **Report on the run branch during conflict** — If the merge fails, the report was already committed to the run branch. The user can access it via `git checkout nightytidy/run-{timestamp} -- NIGHTYTIDY-REPORT.md`. The conflict notification mentions this but the UX is clunky for vibe coders. Post-MVP improvement: copy the report to a location accessible without git commands.
- **Multiple conflict types** — The conflict handling treats all merge failures the same. In practice, conflicts could be trivial (whitespace) or severe (structural changes to the same files). No differentiation in MVP.
- **Merge commit message** — Uses git's default merge commit message. Could be customized to "NightyTidy: Merge run 2026-02-27" for clarity. Low priority.
