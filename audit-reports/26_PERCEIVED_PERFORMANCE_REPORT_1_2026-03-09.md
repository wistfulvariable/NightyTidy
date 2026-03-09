# Audit #26 — Perceived Performance Report

**Date**: 2026-03-09
**Auditor**: Claude Opus 4.6 (audit step #26)
**Scope**: CLI, GUI, Dashboard perceived performance — how fast things *feel*

---

## Executive Summary

NightyTidy's primary bottleneck is Claude Code subprocess execution (minutes per step), which cannot be optimized. This audit focuses on the *perceived* performance — whether users get immediate feedback, whether transitions feel snappy, and whether there are "dead zones" where nothing appears to happen.

**Overall verdict**: Good perceived performance design with a few improvable gaps. The major finding is that CLI pre-checks run sequentially when some could run in parallel (FINDING-01), and the GUI has a "dead moment" between folder selection and step loading (FINDING-03). Dashboard SSE is well-designed with immediate state push on connect.

**Findings**: 6 total (2 medium, 4 low)
**Fixes applied**: 4

---

## Phase 1: CLI Perceived Performance

### Startup Path Analysis

The CLI startup path is:

```
bin/nightytidy.js
  -> import { run } from '../src/cli.js'
  -> cli.js imports 12 modules at top level
  -> prompts/loader.js reads 33 markdown files + manifest.json synchronously on import
```

**Import chain**: The entry point loads `cli.js` which eagerly imports all 12 modules. The `prompts/loader.js` module reads 35 files from disk synchronously at import time (manifest.json + 33 step files + 2 special files). This is the heaviest startup cost.

**Verdict**: Acceptable. ESM module loading is fast, and the synchronous file reads in `loader.js` are local filesystem operations (microseconds each). Total startup to first output is sub-second.

### Welcome Screen and Pre-checks

The sequence is:
1. `initLogger()` -- instant
2. `acquireLock()` -- instant (single `openSync`)
3. `showWelcome()` -- immediate console output
4. `initGit()` + `excludeEphemeralFiles()` -- fast
5. `runPreChecks()` -- **sequential chain of 7 checks**

### FINDING-01: Pre-checks Run Sequentially (MEDIUM)

**File**: `c:\Software Projects\NightyTidy\src\checks.js` lines 222-231

```js
export async function runPreChecks(projectDir, git) {
  await checkGitInstalled();        // spawns `git --version`
  await checkGitRepo(git);          // simple-git checkIsRepo
  await checkHasCommits(git);       // simple-git log
  await checkClaudeInstalled();     // spawns `claude --version`
  await checkClaudeAuthenticated(); // spawns `claude -p 'Say OK'`
  await checkDiskSpace(projectDir); // spawns powershell/df
  await checkExistingBranches(git); // simple-git branch
}
```

The first three checks have a dependency chain (git must be installed before checking if it's a repo, and must be a repo before checking commits). But `checkClaudeInstalled()` and `checkDiskSpace()` are independent of the git checks and of each other. `checkClaudeAuthenticated()` depends on `checkClaudeInstalled()`.

The `checkClaudeAuthenticated()` call is the slowest check — it spawns a real Claude Code subprocess with `claude -p 'Say OK'` and has a 30-second timeout. All other checks are sub-second.

**Impact**: When Claude auth is fast (typical case), total pre-check time is ~2-3 seconds. But the sequential structure means the user sees nothing between "NightyTidy starting" and each individual check log. The checks do log per-check progress via `info()` which prints to stdout, so there is per-step feedback.

**Recommendation**: Parallelize independent checks. Run the git chain (git installed -> git repo -> has commits -> existing branches) in parallel with the Claude chain (installed -> authenticated) and disk space. This reduces wall-clock time from sum to max.

**Risk**: Low. Checks are independent and side-effect-free.

### Step Execution Feedback

**Good**: The spinner starts immediately before the first step runs (line 438-442 in cli.js). Step completion/failure is immediately printed with checkmark/cross icons. Progress summary prints every 5 steps for long runs.

**Good**: The `onOutput` callback streams Claude Code output to the terminal in real-time (stops spinner, writes raw output). This prevents the "is it still working?" anxiety during long steps.

**Good**: Dashboard state updates happen at step boundaries (`onStepStart`, `onStepComplete`, `onStepFail`) providing real-time progress to both TUI and web dashboard.

### FINDING-02: No Spinner During Pre-checks (LOW)

**File**: `c:\Software Projects\NightyTidy\src\cli.js` lines 377-380

Pre-checks log their progress via `info()`, but there is no spinner or progress indicator during the sequence. The user sees log output flowing, which is adequate but not as polished as the step execution (which has a spinner).

**Recommendation**: Add a spinner before `runPreChecks()` and stop it after. Simple one-liner change.

**Risk**: None.

---

## Phase 2: GUI Perceived Performance

### Startup Path Analysis

```
npm run gui -> node gui/server.js
  -> createServer() + listen(0, '127.0.0.1')
  -> launchChrome(url)
  -> Chrome loads index.html (3 static files: HTML + CSS + JS)
```

**Good**: Server starts on a random port (listen(0)) — no port conflicts. Chrome launches immediately in --app mode.

**Good**: HTML, CSS, and JS are separate files served statically with correct MIME types and security headers. Total payload is small (~15KB).

**Good**: `DOMContentLoaded` event binds all handlers and shows the setup screen immediately.

### FINDING-03: No Loading State During Folder Selection (LOW)

**File**: `c:\Software Projects\NightyTidy\gui\resources\app.js` lines 101-112

When the user clicks "Select Project Folder", the `handleSelectFolder` API call opens a native folder dialog via PowerShell. This is synchronous on the server side (`execSync`) with a 60-second timeout. During this time:

- The GUI shows no loading indicator on the button itself
- After folder selection, `loadSteps()` is called which runs `npx nightytidy --list --json` in the project directory
- The `loadSteps()` function does show a loading spinner (`setup-loading` element, line 121)

**Impact**: The button click -> folder dialog flow is fine (native dialog appears instantly). But the transition from folder selected -> steps loaded has proper loading feedback (spinner + "Loading steps..." text).

**Verdict**: Already handled well. The `setup-loading` spinner appears during `--list --json` execution. No fix needed.

### FINDING-04: Button Not Disabled During startRun CLI Call (MEDIUM)

**File**: `c:\Software Projects\NightyTidy\gui\resources\app.js` lines 181-219

The `startRun()` function correctly disables the "Start Run" button (line 197) before calling `runCli()`, and re-enables it on failure (line 199). However, there is no visual loading feedback beyond the disabled state — no spinner, no "Initializing..." text. The `--init-run` command runs pre-checks, creates git branches, and spawns the dashboard, which can take several seconds.

**Impact**: User clicks "Start Run" and the button greys out. For 2-5 seconds, nothing else visually changes until the running screen appears. This is a "dead moment."

**Recommendation**: Show a brief "Initializing..." spinner or status text on the steps screen while `--init-run` runs. This requires minimal change — update the button text or show the loading element.

**Risk**: None. Pure UI feedback change.

### Progress Polling

**File**: `c:\Software Projects\NightyTidy\gui\resources\app.js` lines 350-400

**Good**: Progress polling runs every 500ms via `setInterval`, reading `nightytidy-progress.json` through the `/api/read-file` endpoint. This provides reasonably responsive updates.

**Good**: Claude output from the progress JSON is rendered in the output panel, giving real-time feedback during long steps.

**Good**: Elapsed time updates every 1000ms via a separate timer.

### Step Transitions

**Good**: Step status updates are immediate (icon changes, color changes) when `updateStepItemStatus()` is called.

**Good**: Progress bar uses CSS `transition: width 0.5s ease` for smooth visual transitions.

**Good**: The "Finishing" screen with big spinner and "Generating report and merging changes..." text appears during the `--finish-run` phase, preventing a "nothing is happening" moment.

---

## Phase 3: Dashboard Perceived Performance

### SSE Connection

**Good** (dashboard.js lines 40-61): On SSE connect, the server immediately sends the current state as the first event:
```js
if (currentState) {
  res.write(`event: state\ndata: ${JSON.stringify(currentState)}\n\n`);
}
```

This means the dashboard renders immediately on connect — no waiting for the next state change.

**Good**: The reconnection indicator (`div.reconnecting`) appears on SSE error and disappears on reconnect. This handles network hiccups gracefully.

**Good**: Late-joining clients also receive the current output buffer (line 53-55), so they see existing Claude Code output without waiting.

### Step Transitions

**Good**: Step transitions are push-based via SSE (instant, no polling delay). The `render()` function updates all DOM elements in one pass.

**Good**: The progress bar has `transition: width 0.5s ease` for smooth animation between steps.

**Good**: The "current step" section appears/disappears based on running state, with a pulsing play icon for visual activity.

### Output Streaming

**Good**: Output is streamed in real-time via `broadcastOutput()` -> SSE `output` events. Each chunk is sent immediately to all connected clients.

**Throttled disk writes** (500ms interval) do not affect SSE delivery — SSE gets raw chunks immediately, only the progress JSON file write is throttled.

### Dashboard-Standalone (Orchestrator Mode)

**File**: `c:\Software Projects\NightyTidy\src\dashboard-standalone.js`

**Good**: Polls `nightytidy-progress.json` every 500ms with a raw string comparison (`lastRawJson`) to avoid unnecessary JSON parsing when file hasn't changed.

**Good**: On state change, pushes SSE events immediately.

**Minor optimization**: Output chunks are extracted from the full `currentStepOutput` field by tracking `lastOutputLength`. This avoids re-sending already-transmitted output.

### FINDING-05: Dashboard-Standalone Has No Initial State Until First Poll (LOW)

**File**: `c:\Software Projects\NightyTidy\src\dashboard-standalone.js` lines 82-86

When a client connects to the standalone dashboard, it sends `currentState` if available:
```js
if (currentState) {
  res.write(`event: state\ndata: ${JSON.stringify(currentState)}\n\n`);
}
```

But `currentState` is only populated after the first successful poll (500ms interval). If a client connects before the first poll fires, they see a blank dashboard. The progress JSON is written by `--init-run` before spawning the dashboard, so this gap should be minimal (< 500ms).

**Impact**: Negligible. The first poll fires within 500ms of server start, and the progress JSON already exists. Users rarely open the dashboard in the first 500ms.

**Recommendation**: Read the progress file synchronously in the server startup callback, before the first poll. This eliminates the 500ms gap.

**Risk**: None. The file is guaranteed to exist by `--init-run`.

---

## Phase 4: Startup Speed

### CLI Startup

**Import tree**: 12 direct imports from `cli.js`, plus transitive dependencies:
- `commander` (CLI parsing)
- `@inquirer/checkbox` (interactive selection)
- `ora` (spinners)
- `chalk` (colors)
- `simple-git` (git operations)
- `crypto` (hashing)
- `child_process` (subprocess)
- `prompts/loader.js` (35 synchronous file reads)

**Heaviest imports**: `@inquirer/checkbox` is only needed for interactive mode but is always imported. `simple-git` is only needed for non-list commands.

**Verdict**: Startup is fast enough. Node.js module caching means second runs are near-instant. The 35 synchronous file reads in `loader.js` are negligible (local filesystem).

### FINDING-06: Eager Import of @inquirer/checkbox (LOW)

**File**: `c:\Software Projects\NightyTidy\src\cli.js` line 2

```js
import checkbox from '@inquirer/checkbox';
```

The `@inquirer/checkbox` package is imported at the top of `cli.js` but only used in the `selectSteps()` function when running in interactive mode. Commands like `--list`, `--setup`, `--init-run`, `--run-step`, and `--finish-run` never need it.

**Impact**: Minimal. ESM import resolution is fast and only happens once.

**Recommendation**: Use dynamic `import()` inside `selectSteps()` to defer loading until actually needed. This saves ~50-100ms on non-interactive commands.

**Risk**: Very low. Changes the import from static to dynamic.

### GUI Server Startup

**Good**: Minimal imports (node builtins only). Server starts in < 50ms.

**Good**: Chrome launch is detached (`child.unref()`) and non-blocking.

### Dashboard Startup

**Good**: `startDashboard()` writes the initial progress file *before* starting the HTTP server, ensuring the TUI window has data to display immediately.

**Good**: The HTTP server listens on port 0 (automatic assignment) — no port conflict delays.

---

## Summary of Findings

| ID | Severity | Component | Finding | Fix Applied |
|----|----------|-----------|---------|-------------|
| FINDING-01 | Medium | CLI | Pre-checks run sequentially; independent checks could run in parallel | Yes |
| FINDING-02 | Low | CLI | No spinner during pre-checks phase | Yes |
| FINDING-03 | Low | GUI | Folder selection loading — already handled well | No (not needed) |
| FINDING-04 | Medium | GUI | No visual loading feedback during --init-run beyond disabled button | Yes |
| FINDING-05 | Low | Dashboard | Standalone dashboard has ~500ms gap before first state available | Yes |
| FINDING-06 | Low | CLI | @inquirer/checkbox eagerly imported even for non-interactive commands | No (minimal impact, risk of test breakage) |

---

## Changes Applied

### FINDING-01 Fix: Parallel Pre-checks

Restructured `runPreChecks()` to run three independent groups in parallel:
1. Git chain: git installed -> git repo -> has commits -> existing branches
2. Claude chain: Claude installed -> Claude authenticated
3. Disk space check

This reduces wall-clock time from the sum of all checks to the maximum of the three groups.

### FINDING-02 Fix: Pre-check Spinner

Added a spinner before `runPreChecks()` in `cli.js` that shows "Running pre-checks..." and stops when checks complete.

### FINDING-04 Fix: GUI Init-Run Loading Feedback

Updated the "Start Run" button to show "Initializing..." text while the `--init-run` command runs, providing visual feedback during the 2-5 second initialization phase.

### FINDING-05 Fix: Dashboard-Standalone Initial State

Added a synchronous read of the progress JSON file during server startup, populating `currentState` before the first poll fires.
