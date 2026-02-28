# CLI Interface

## Overview

The user-facing entry point. Wires together Commander (arg parsing), Inquirer (step selector), ora (spinner), chalk (colors), and orchestrates the full run lifecycle: welcome → checks → setup → execute → finalize. This is where the user experience lives — every interaction the user has with NightyTidy flows through this module.

## Dependencies

- `01_Project_Setup.md` — Commander, Inquirer, ora, chalk dependencies
- `02_Logger.md` — `initLogger()`
- `03_Pre_Run_Checks.md` — `runPreChecks()`
- `04_Git_Operations.md` — `initGit()`, branch/tag creation, merge
- `06_Prompt_Library.md` — `STEPS` array for the step selector
- `07_Step_Executor.md` — `executeSteps()`
- `08_Notifications.md` — `notify()` for start/complete notifications
- `09_Report_Generation.md` — `generateReport()`
- `13_Post_Run_Finalization.md` — merge and cleanup logic

## Module: `src/cli.js`

### Exported Interface

```javascript
// Main entry point. Called by bin/nightytidy.js.
export async function run()
```

### Full Execution Flow

```
run()
  ├─ 1.  Parse args (Commander)
  ├─ 2.  Detect project directory (process.cwd())
  ├─ 3.  Initialize logger
  ├─ 4.  Show first-run welcome (if applicable)
  ├─ 5.  Run pre-checks
  ├─ 6.  Show step selector (Inquirer)
  ├─ 7.  Create pre-run tag + run branch
  ├─ 8.  Send "run started" notification
  ├─ 9.  Start spinner
  ├─ 10. Execute steps
  ├─ 11. Generate narrated changelog
  ├─ 12. Generate report
  ├─ 13. Commit report
  ├─ 14. Merge run branch → original branch
  ├─ 15. Send "run complete" notification
  └─ 16. Print final summary to terminal
```

### Commander Setup

Minimal — NightyTidy has one command with no required arguments:

```javascript
import { Command } from 'commander';

const program = new Command();
program
  .name('nightytidy')
  .description('Automated overnight codebase improvement through Claude Code')
  .version('0.1.0')
  .action(async () => {
    // main flow
  });

program.parse();
```

No subcommands in MVP. Future subcommands (`nightytidy status`, `nightytidy undo`) can be added via `program.command(...)` later.

### First-Run Welcome Message

On the very first invocation ever (not per-project — globally), show a welcome message before the step selector:

```
╭──────────────────────────────────────────────────────────────╮
│                                                              │
│  Welcome to NightyTidy! 🌙                                   │
│                                                              │
│  NightyTidy will run 28 codebase improvement steps through   │
│  Claude Code. This typically takes 4-8 hours.                │
│                                                              │
│  All changes happen on a dedicated branch and are            │
│  automatically merged when done. You can check progress      │
│  anytime in nightytidy-run.log.                              │
│                                                              │
│  A safety snapshot is created before starting — you can      │
│  always undo everything if needed.                           │
│                                                              │
╰──────────────────────────────────────────────────────────────╯
```

**Detection**: Check for a marker file at `~/.nightytidy/welcome-shown`. If it doesn't exist, show the welcome and create the file. Subsequent runs skip the welcome.

**On Windows**: `~` resolves to `%USERPROFILE%` (typically `C:\Users\{username}`). Use `os.homedir()` in Node.js.

### Interactive Step Selector

Uses `@inquirer/checkbox` to display all 28 steps with all pre-selected:

```javascript
import checkbox from '@inquirer/checkbox';

const selected = await checkbox({
  message: 'Select steps to run (Enter to run all):',
  choices: STEPS.map(step => ({
    name: `${step.number}. ${step.name}`,
    value: step,
    checked: true   // all pre-selected by default
  })),
  pageSize: 15      // show 15 steps at a time, scroll for the rest
});
```

**UX flow**:
- All 28 steps are checked by default
- User arrows up/down to navigate
- Space toggles individual steps on/off
- Enter confirms and starts the run
- The 90% case: user hits Enter immediately without changing anything → all 28 steps run

**If user deselects all steps**: Show an error message and re-display the selector:
```
You need to select at least one step. Use Space to toggle steps on/off.
```

**Display format**: Each step shows as `☑ 1. Documentation` or `☐ 1. Documentation`. The checkbox styling is handled by Inquirer's default theme.

### Terminal UX During Execution

#### Spinner (ora)

```javascript
import ora from 'ora';

const spinner = ora({
  text: `⏳ Step 1/${selectedSteps.length}: ${selectedSteps[0].name}...`,
  color: 'cyan'
}).start();
```

Updated by the executor at each step transition. The spinner runs continuously while Claude Code is working — it's the visual signal that NightyTidy is alive and not frozen.

#### Color Coding (chalk)

| Element | Color | When |
|---------|-------|------|
| Step in progress | cyan | Spinner text during execution |
| Step completed | green | Brief flash: `✓ Step 3: Test Hardening — done (12m 34s)` |
| Step failed | red | Brief flash: `✗ Step 7: File Decomposition — failed` |
| Warnings | yellow | Pre-check warnings (low disk space), non-critical issues |
| Final summary | green/red | Green if all passed, red if any failed |
| Welcome box border | cyan | First-run welcome message |

#### Final Terminal Summary

After the run completes and the report is written, print a summary to the terminal:

**All success**:
```
✅ NightyTidy complete — 28/28 steps succeeded (6h 42m)
📄 Report: NIGHTYTIDY-REPORT.md
```

**Partial success**:
```
⚠️  NightyTidy complete — 25/28 steps succeeded, 3 failed (7h 13m)
📄 Report: NIGHTYTIDY-REPORT.md
```

Keep it to 2-3 lines. The report has the details — the terminal summary just confirms completion and points to the file.

### Ctrl+C / SIGINT Handling

Graceful interrupt handling is critical — the user may change their mind during a run.

```javascript
let abortController = new AbortController();

process.on('SIGINT', async () => {
  // First Ctrl+C: graceful shutdown
  console.log('\n⚠️  Stopping NightyTidy... finishing current step.');
  abortController.abort();
  
  // The executor checks the signal and stops after current step
  // Cleanup happens in the finally block of the main flow
});
```

**On first Ctrl+C**:
1. Log: `[WARN] User interrupted — stopping after current step`
2. Signal the executor to stop (via AbortController)
3. Wait for the current Claude Code session to finish (don't kill it mid-execution)
4. Executor returns partial results
5. Perform a fallback commit for any uncommitted work
6. Generate a partial report (with whatever steps completed)
7. Leave the repo on the run branch (do NOT merge — the run was incomplete)
8. Print: `"NightyTidy stopped. {X} steps completed. Changes are on branch {branchName}. To merge what was done: git checkout {original} && git merge {branchName}"`

**On second Ctrl+C** (during graceful shutdown): Force exit immediately. The repo may be in a mid-step state, but the pre-run tag ensures safe rollback.

```javascript
let interrupted = false;
process.on('SIGINT', () => {
  if (interrupted) {
    console.log('\nForce stopping.');
    process.exit(1);
  }
  interrupted = true;
  // graceful shutdown logic
});
```

### Sleep/Hibernate Warning

Not enforced in MVP, but display an informational note at launch (after the step selector, before execution begins):

```
💡 Tip: Make sure your computer won't go to sleep during the run.
   This typically takes 4-8 hours. Disable sleep in your power settings.
```

Show this every time (not just first run) since it's a practical reminder. Keep it one line with a tip icon — not alarming, just helpful.

### Error Display

When pre-run checks fail or an unrecoverable error occurs, the terminal shows the user-friendly error message (see `03_Pre_Run_Checks.md` and `11_Error_Handling.md`), NOT a stack trace.

```javascript
try {
  await mainFlow();
} catch (err) {
  spinner?.stop();
  console.error(chalk.red(`\n❌ ${err.message}`));
  info(`Fatal error: ${err.message}`);
  debug(`Stack trace: ${err.stack}`);
  process.exit(1);
}
```

The user sees the red error message. The stack trace goes to the log file at debug level only.

## Testing Notes

- CLI module is hardest to unit test due to interactive prompts and terminal output. Focus integration testing on:
  - Commander arg parsing (if future args are added)
  - The main flow orchestration — mock all dependencies and verify they're called in order
  - Ctrl+C handling — simulate SIGINT and verify graceful shutdown behavior
- For the step selector: mock `@inquirer/checkbox` to return a controlled selection

## Gaps & Assumptions

- **Terminal width** — The welcome box and spinner assume a standard 80+ character terminal width. No responsive handling for very narrow terminals. Acceptable for MVP — VS Code's terminal is always wide enough.
- **Non-interactive mode** — No `--yes` or `--all` flag to skip the step selector. Every run shows the interactive checkbox. This could be a quick post-MVP addition for scripting use cases.
- **Color support detection** — chalk auto-detects color support. In rare cases (piped output, CI environments), colors may be stripped. This is fine — chalk handles it.
- **Windows Terminal vs cmd.exe** — ora spinners and chalk colors work in Windows Terminal and PowerShell. In legacy cmd.exe, spinners may render as static text. No mitigation — Windows Terminal is the expected environment.
