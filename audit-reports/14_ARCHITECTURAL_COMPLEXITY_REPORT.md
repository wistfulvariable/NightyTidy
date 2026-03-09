# Audit #14 — Architectural Complexity Report

**Date**: 2026-03-09
**Auditor**: Claude Opus 4.6 (READ-ONLY analysis)
**Scope**: Full NightyTidy codebase (4,355 LOC production, 8,348 LOC tests)

---

## Executive Summary

NightyTidy has a **well-structured architecture with low accidental complexity**. The codebase follows its stated principles consistently: flat module hierarchy, clear separation of concerns, minimal abstraction layers. The primary complexity is **essential** — it arises from genuinely distinct execution modes (interactive CLI, orchestrator API, desktop GUI) that share core logic.

**Verdict**: 3 items worth simplifying, 0 critical architectural problems.

---

## Phase 1: Structural Complexity Mapping

### 1.1 Complete Dependency Graph

```
bin/nightytidy.js (3 LOC)
  └── src/cli.js (536 LOC) — hub module, highest fan-out
        ├── src/logger.js (54 LOC) — universal dependency (leaf)
        ├── src/checks.js (238 LOC) → logger
        ├── src/git.js (144 LOC) → logger
        ├── src/claude.js (204 LOC) → logger
        ├── src/executor.js (143 LOC) → claude, git, prompts/loader, notifications, logger
        ├── src/prompts/loader.js (31 LOC) → fs (leaf, data-only)
        ├── src/lock.js (118 LOC) → logger
        ├── src/notifications.js (16 LOC) → logger (leaf-like)
        ├── src/dashboard.js (292 LOC) → logger, dashboard-html
        │     └── src/dashboard-html.js (483 LOC) — (leaf, template data)
        ├── src/report.js (162 LOC) → logger
        ├── src/setup.js (99 LOC) → prompts/loader, logger
        └── src/orchestrator.js (431 LOC) → logger, checks, git, claude, executor,
              │                              lock, report, notifications, prompts/loader,
              │                              dashboard-standalone (via spawn)
              └── src/dashboard-standalone.js (145 LOC) → dashboard-html (standalone process)

gui/server.js (364 LOC) — independent, no src/ imports
gui/resources/logic.js (134 LOC) — pure functions, no imports
gui/resources/app.js (586 LOC) → logic.js (via globalThis.NtLogic)

src/dashboard-tui.js (203 LOC) — standalone process, chalk only
```

### 1.2 Hub Module Analysis

| Module | Fan-out (imports) | Fan-in (imported by) | Role |
|--------|:-:|:-:|------|
| `cli.js` | 13 | 1 (bin) | Top-level orchestrator — expected high fan-out |
| `orchestrator.js` | 11 | 1 (cli) | Parallel orchestrator — expected high fan-out |
| `executor.js` | 5 | 2 (cli, orchestrator) | Core execution loop |
| `logger.js` | 0 | 12 | Universal leaf — expected high fan-in |
| `dashboard-html.js` | 0 | 2 | Template data |

**Assessment**: Hub modules (`cli.js`, `orchestrator.js`) are the top-level entry points for their respective modes. Their high fan-out is essential, not accidental — they are the composition roots. No intermediate "manager" or "coordinator" layers exist to add unnecessary indirection.

### 1.3 Circular Dependencies

**None found.** The dependency graph is a strict DAG. Every module depends downward; no cycles exist.

### 1.4 Dependency Depth Analysis

Maximum dependency chain depth:

```
Level 0: bin/nightytidy.js
Level 1: cli.js, orchestrator.js
Level 2: executor.js, dashboard.js, checks.js, git.js, lock.js, setup.js
Level 3: claude.js, notifications.js, report.js, prompts/loader.js
Level 4: logger.js, dashboard-html.js (leaves)
```

**Maximum depth: 4 levels** — well within healthy range for a project of this size. No deep chains.

### 1.5 Core Operation Call Paths

**Interactive CLI run (`npx nightytidy --all`)**:
```
bin/nightytidy.js
  → cli.run()
    → initLogger() → acquireLock() → initGit() → excludeEphemeralFiles()
    → runPreChecks() → selectSteps() → startDashboard()
    → createPreRunTag() → createRunBranch()
    → executeSteps() — loops:
      → executeSingleStep()
        → runPrompt() → spawnClaude() → waitForChild()
        → runPrompt() (doc update, --continue)
        → hasNewCommit() / fallbackCommit()
    → runPrompt() (changelog)
    → generateReport() → mergeRunBranch()
```

Layers: **3** (cli → executor → claude). No unnecessary forwarding.

**Orchestrator mode (`--init-run` / `--run-step` / `--finish-run`)**:
```
bin/nightytidy.js
  → cli.run() → opts.initRun
    → orchestrator.initRun()
      → initLogger() → acquireLock() → initGit() → runPreChecks()
      → createPreRunTag() → createRunBranch()
      → writeState() → spawnDashboardServer()

  → cli.run() → opts.runStep
    → orchestrator.runStep()
      → readState() → initGit() → executeSingleStep()
      → writeState() → writeProgress()

  → cli.run() → opts.finishRun
    → orchestrator.finishRun()
      → readState() → runPrompt() (changelog)
      → generateReport() → mergeRunBranch()
      → stopDashboardServer() → releaseLock() → deleteState()
```

Layers: **3** (cli → orchestrator → executor/claude). Same depth as interactive mode.

**GUI launch (`npm run gui`)**:
```
gui/server.js (standalone HTTP server)
  → createServer(handleRequest)
  → launchChrome(url)
  Client:
    gui/resources/app.js → gui/resources/logic.js
    → fetch('/api/run-command') → server.js → spawn('npx nightytidy ...')
```

Layers: **2** (app.js → server.js → nightytidy subprocess). The GUI delegates entirely to CLI subprocesses.

### 1.6 Abstraction Catalog

| Abstraction | Implementations | Justified? |
|-------------|:-:|---|
| Logger interface (`debug/info/warn/error`) | 1 (logger.js) | Yes — singleton by design, not an abstraction layer |
| Git wrapper (git.js) | 1 (simple-git) | Yes — encapsulates initialization + shared state |
| Claude subprocess (claude.js) | 1 | Yes — encapsulates retry, timeout, stdin/flag switching |
| Dashboard server | 2 (dashboard.js, dashboard-standalone.js) | Somewhat — see Finding #1 |
| Progress display | 2 (dashboard-html.js for browser, dashboard-tui.js for terminal) | Yes — genuinely different output modes |

**No unnecessary abstractions found.** No abstract base classes, no factories with a single type, no interfaces with a single implementation being used polymorphically.

---

## Phase 2: Data Flow Complexity

### 2.1 Core Data Type Transformations

**Step result flow**:
```
STEPS (static, from loader.js) → { number, name, prompt }
  ↓ executeSingleStep()
makeStepResult() → { step: {number, name}, status, output, duration, attempts, error }
  ↓ executeSteps()
executionResults → { results[], totalDuration, completedCount, failedCount }
  ↓ generateReport() or buildExecutionResults()
report sections / JSON output
```

Transformations: **3 stages** (raw prompt data → step result → aggregated results → report/JSON). Each transformation adds information (status, duration, counts). No lossy or redundant transformations.

**Progress state flow** (interactive mode):
```
dashState (cli.js) → updateDashboard() → progress JSON file → SSE push to browser
                                        → TUI reads file → renders
```

**Progress state flow** (orchestrator mode):
```
state (orchestrator.js) → buildProgressState() → writeProgress() → JSON file
                                                                  ↓
                                          dashboard-standalone.js polls → SSE push
```

### 2.2 State Management

Module-level singletons:

| Module | Mutable State | Initialization | Risk |
|--------|---------------|----------------|------|
| `logger.js` | `logFilePath`, `minLevel`, `logQuiet` | `initLogger()` | Low — set once, read-only after |
| `git.js` | `git`, `projectRoot` | `initGit()` | Low — set once per run |
| `dashboard.js` | `server`, `sseClients`, `currentState`, `urlFilePath`, etc. | `startDashboard()` | Medium — mutable during run, but all writes go through exported functions |
| `report.js` | `cachedVersion` | `getVersion()` | Negligible — lazy cache |

**Assessment**: The singleton pattern is appropriate here. NightyTidy processes one run at a time. Module-level state avoids threading a context object through every function, which would add parameter-passing noise without benefit in a single-run CLI tool.

### 2.3 Configuration Layers

```
Environment:
  NIGHTYTIDY_LOG_LEVEL → logger.js (minLevel)

Constants (module-level):
  DEFAULT_TIMEOUT (45 min) → claude.js
  DEFAULT_RETRIES (3) → claude.js
  STDIN_THRESHOLD (8000) → claude.js
  PROGRESS_SUMMARY_INTERVAL (5) → cli.js
  SHUTDOWN_DELAY (3000) → dashboard.js
  MAX_LOCK_AGE_MS (24h) → lock.js
  DASHBOARD_STARTUP_TIMEOUT (5s) → orchestrator.js
  SSE_FLUSH_DELAY (500ms) → orchestrator.js

CLI flags:
  --all, --steps, --list, --setup, --timeout, --dry-run, --json
  --init-run, --run-step, --finish-run
```

**Assessment**: Configuration is minimal and appropriate. Only one env var. Constants are co-located with the code that uses them. No configuration framework, no `.rc` files, no config-merging logic. This is correctly simple for a v0.1.0 tool.

---

## Phase 3: Pattern Complexity

### 3.1 Premature Generalization

**None found.** Each module serves exactly one purpose. The `retryWithSuffix()` helper in `git.js` is the closest to a generalized utility, but it is used twice (tag creation, branch creation) — justified.

### 3.2 Unnecessary Indirection

**Finding #1 — Dashboard duplication between `dashboard.js` and `dashboard-standalone.js`**

Both modules implement HTTP servers serving the same dashboard HTML with SSE push. The difference:
- `dashboard.js`: runs in-process during interactive CLI mode, receives state updates via function calls
- `dashboard-standalone.js`: runs as a detached process during orchestrator mode, polls a JSON file for state

The HTTP handler code is ~60% duplicated: same route structure (`/`, `/events`, `/stop`), same CSRF verification, same SSE client management, same security headers. The `SECURITY_HEADERS` constant and CSRF stop-endpoint logic are independently defined in both files.

**Why this exists**: Essential mode difference. Interactive mode pushes state in-process; orchestrator mode spans separate process invocations, requiring a detached server that polls. This is genuine essential complexity, not accidental.

**Duplication impact**: ~80 lines of duplicated HTTP handler code. Low risk since both implementations are simple and stable, but a shared HTTP handler factory could reduce this.

### 3.3 Cargo-Culted Patterns

**None found.** The codebase does not use:
- Design patterns for their own sake (no Strategy, Observer, Factory, etc.)
- Dependency injection frameworks
- Abstract base classes
- Configuration-driven behavior switching

Every pattern in use serves a specific, observable purpose.

### 3.4 Organic Growth Tangles

**Finding #2 — `cli.js` dual responsibility**

`cli.js` (536 LOC) serves as both:
1. **Commander program definition** (argument parsing, option registration)
2. **Interactive mode orchestration** (the entire run lifecycle: welcome → checks → select → execute → report → merge)

The orchestrator mode commands (`--init-run`, `--run-step`, `--finish-run`) are dispatched from `cli.js` but implemented in `orchestrator.js`. The interactive mode has no such delegation — its entire lifecycle lives in `cli.run()`.

This is not broken, but `cli.js` is the largest single file and the hardest to read due to mixing argument parsing with execution logic. The `buildStepCallbacks()`, `handleAbortedRun()`, and `printCompletionSummary()` functions are specific to interactive mode and could live in a dedicated module.

**Risk**: Low. The file is well-organized with clear function boundaries. This is a readability concern, not a correctness concern.

**Finding #3 — `cleanEnv()` defined in two files**

`checks.js` and `claude.js` both define an identical `cleanEnv()` function that removes the `CLAUDECODE` environment variable:

```js
function cleanEnv() {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  return env;
}
```

This is a minor DRY violation. Both modules spawn Claude Code subprocesses and need the clean environment. Since the function is 4 lines, the duplication is low-risk.

---

## Phase 4: Complexity Quantification

### 4.1 Indirection Ratio per Core Operation

| Operation | Call depth | Forwarding layers | Indirection ratio |
|-----------|:-:|:-:|:-:|
| Interactive run | 3 (cli→executor→claude) | 0 | 0% |
| Orchestrator init | 3 (cli→orchestrator→checks/git) | 1 (cli dispatches) | 33% |
| Orchestrator step | 3 (cli→orchestrator→executor→claude) | 1 (cli dispatches) | 25% |
| GUI step run | 4 (app.js→server.js→subprocess→orchestrator) | 1 (server.js relays) | 25% |
| Dashboard update | 1-2 (cli→dashboard or orchestrator→file→standalone) | 0 | 0% |

**Assessment**: Indirection ratios are all under 35%. No unnecessary wrapper layers. The cli.js dispatch for orchestrator commands is a simple `if/else` that delegates to `orchestrator.js` — this is the Commander pattern, not unnecessary indirection.

### 4.2 Abstraction Overhead

| Category | Count | Assessment |
|----------|:-:|---|
| Source modules | 16 | Appropriate for scope |
| Standalone processes | 2 (dashboard-standalone, dashboard-tui) | Justified — mode-specific |
| GUI modules | 3 (server, logic, app) | Minimal for a desktop GUI |
| Configuration files | 2 (manifest.json, vitest.config.js) | Minimal |
| Abstract layers with 1 impl | 0 | Excellent |
| Factories | 0 | Excellent |
| Interface-only modules | 0 | Excellent |

### 4.3 Module Size Distribution

```
> 500 LOC: cli.js (536), app.js (586), dashboard-html.js (483) — 3 files
200-500:   orchestrator.js (431), gui/server.js (364), dashboard.js (292),
           checks.js (238), claude.js (204), dashboard-tui.js (203) — 6 files
100-200:   executor.js (143), git.js (144), report.js (162),
           logic.js (134), dashboard-standalone.js (145), lock.js (118) — 6 files
< 100:     setup.js (99), logger.js (54), loader.js (31),
           notifications.js (16), nightytidy.js (3) — 5 files
```

Distribution is healthy. The three largest files:
- `app.js` (586 LOC): state machine for 5 GUI screens — hard to split meaningfully
- `cli.js` (536 LOC): interactive mode lifecycle — see Finding #2
- `dashboard-html.js` (483 LOC): HTML/CSS/JS template — inherently a single output

### 4.4 Onboarding Complexity by Area

| Area | Concepts to learn | Time estimate | Difficulty |
|------|:-:|:-:|:-:|
| Core execution (executor + claude) | 4 (steps, retry, timeout, session continue) | 30 min | Low |
| CLI interactive mode | 6 (Commander, Inquirer, ora, git workflow, dashboard, abort handling) | 1 hour | Medium |
| Orchestrator mode | 5 (state file, init/step/finish, progress JSON, dashboard spawn) | 45 min | Medium |
| Dashboard system | 5 (HTTP server, SSE, TUI, progress file, CSRF) | 1 hour | Medium |
| GUI | 4 (server.js HTTP, Chrome launcher, app.js state machine, logic.js) | 45 min | Low |
| Git workflow | 3 (safety tag, run branch, merge) | 20 min | Low |
| Prompts | 2 (manifest, markdown files) | 10 min | Low |

**Total onboarding**: ~4-5 hours for full codebase understanding. Reasonable for 4,355 LOC.

---

## Phase 5: Simplification Roadmap

### Summary of Findings

| # | Finding | Category | Impact | Confidence | Effort | Risk |
|:-:|---------|----------|:-:|:-:|:-:|:-:|
| 1 | Dashboard HTTP handler duplication (dashboard.js / dashboard-standalone.js) | Collapse | Low | High | Medium | Medium |
| 2 | cli.js dual responsibility (parsing + interactive orchestration) | Restructure | Low | Medium | Medium | Medium |
| 3 | cleanEnv() duplicated in checks.js and claude.js | Collapse | Negligible | High | Low | Low |

### Prioritization: (Impact x Confidence) / (Effort x Risk)

| # | Score | Recommendation |
|:-:|:-:|---|
| 3 | (1 x 5) / (1 x 1) = **5.0** | Extract `cleanEnv()` to a shared utility. Trivial, no risk. |
| 1 | (2 x 4) / (3 x 3) = **0.9** | Accept for now. The duplication is stable and the two servers have genuinely different I/O models (push vs. poll). A shared HTTP handler factory would add indirection without clear payoff at this scale. |
| 2 | (2 x 3) / (3 x 3) = **0.7** | Accept for now. Splitting cli.js would create more files and import wiring without meaningfully reducing cognitive load — the file is already well-organized with clear function boundaries. |

### Recommended Actions

1. **Extract `cleanEnv()`** (trivial): Move to a shared utility module. Both `checks.js` and `claude.js` define the same 4-line function. However, this is so small that it could also just stay duplicated — the fix is optional.

2. **Accept dashboard duplication**: The interactive and standalone dashboard servers serve different operational models. The 80 lines of shared HTTP handler code could be extracted, but the resulting shared module would add a dependency without meaningfully reducing maintenance burden. Revisit if a third dashboard variant appears.

3. **Accept cli.js size**: At 536 LOC with clear function boundaries, this is readable. Splitting would create a `cli-interactive.js` module that is only imported by `cli.js`, adding a file without reducing complexity.

---

## Architectural Strengths

1. **Flat module hierarchy**: Maximum depth of 4 levels. No deep chains or wrapper-on-wrapper patterns.

2. **No circular dependencies**: The dependency graph is a clean DAG.

3. **Zero unnecessary abstractions**: No factories, no abstract base classes, no interfaces with single implementations, no DI frameworks.

4. **Clean separation between modes**: Interactive CLI, orchestrator API, and desktop GUI are cleanly separated. The GUI is entirely independent of `src/` modules — it communicates only via CLI subprocess invocation.

5. **Appropriate use of singletons**: Logger and git module-level state is initialized once per run, avoiding parameter-threading noise in a single-run CLI tool.

6. **Consistent error contracts**: Each module has a documented error handling strategy (throws, returns result objects, or swallows), and the contracts are verified by `contracts.test.js`.

7. **Data flows linearly**: Step data flows from prompts → execution → results → report with no backtracking, no circular state updates, and no hidden side channels.

8. **Configuration is minimal**: One env var, co-located constants, CLI flags via Commander. No configuration framework or merge logic.

---

## Complexity Comparison

For context, here are typical complexity indicators for projects of similar size:

| Indicator | NightyTidy | Typical ~4K LOC project |
|-----------|:-:|:-:|
| Circular dependencies | 0 | 1-3 |
| Max dependency depth | 4 | 5-7 |
| Abstract layers with 1 impl | 0 | 2-5 |
| Forwarding-only modules | 0 | 1-2 |
| Configuration layers | 2 | 3-5 |
| Module count | 16 | 10-20 |
| LOC per module (median) | 144 | 150-250 |

NightyTidy is **below average complexity** on every metric.

---

## Conclusion

NightyTidy's architecture is deliberately simple and well-maintained. The complexity that exists is overwhelmingly **essential** — arising from genuinely distinct execution modes and legitimate operational requirements. The three findings identified are all minor (one trivial DRY fix, two "accept as-is" items).

No structural changes are recommended for the current codebase size and scope.

---

*Generated by Claude Opus 4.6 — Audit #14 (Architectural Complexity)*
