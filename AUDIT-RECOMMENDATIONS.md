# NightyTidy — Audit Recommendations Backlog

Generated 2026-03-09 from 52 audit reports spanning documentation, testing, security, performance, code quality, architecture, DevOps, frontend, and strategic analysis. 45 of ~68 unique recommendations were already implemented. This document contains the remaining actionable items.

---

## How to Use This Document

Each recommendation includes enough context to implement without reading the original audit report. Work through tiers in order. Mark items done by changing `[ ]` to `[x]` and noting the commit hash.

---

## Tier 1: High Codebase Impact

These directly improve code quality, reliability, or correctness. All are worth the effort regardless of size.

### 1. Track last-attempt output in `runPrompt()` on retry exhaustion

- **File**: `src/claude.js`
- **Problem**: When all retry attempts are exhausted, `runPrompt()` returns `output: ''` (empty string) instead of the last attempt's actual output. This loses diagnostic information — the NIGHTYTIDY-REPORT.md for a failed step shows nothing useful.
- **Fix**: Before the final return after the retry loop, preserve `lastResult.output` instead of returning empty string. The result object already has the `output` field — just stop overwriting it with `''`.
- **Impact**: Failed steps become debuggable from the report instead of requiring log diving.
- **Tests**: Update `claude.test.js` — the "all retries exhausted" test should assert that output contains the last attempt's stdout, not empty string.

### 2. Upgrade Vitest to v3 or v4

- **File**: `package.json`, `vitest.config.js`, potentially test files
- **Problem**: Vitest v2 depends on `vite` which depends on `esbuild <=0.24.2` (GHSA-67mh-4wv8-2f99). This produces 6 moderate npm audit findings. Every audit report and every `npm audit` run flags it. Dev-only but noisy.
- **Fix**: `npm install vitest@latest` and fix any breaking changes. The custom `strip-shebang` plugin in `vitest.config.js` may need adjustment. Run the full test suite and `npm run test:ci` to verify coverage thresholds still pass.
- **Impact**: Clean `npm audit`. Removes recurring noise from every security review.
- **Tests**: All existing tests must pass. Coverage thresholds (90% statements, 80% branches, 80% functions) must hold.

### 3. Continue decomposing `cli.js` `run()`

- **File**: `src/cli.js`
- **Problem**: `run()` is ~450 lines and the single largest function in the codebase. It handles the full lifecycle: argument parsing, pre-checks, step selection, git setup, execution, abort handling, reporting, and merging. Shared mutable state (`spinner`, `runStarted`, `tagName`, `runBranch`, `originalBranch`) makes it hard to test individual phases.
- **Fix**: Extract three phase functions:
  - `setupGitAndPreChecks(projectDir, git, options)` — lock acquisition through pre-check completion
  - `executeRunFlow(steps, git, options, callbacks)` — step execution loop with spinner management
  - `finalizeRun(results, git, metadata)` — report generation, merge, cleanup

  Pass shared state as a context object rather than relying on closure variables. The `handleAbortedRun` function already exists as a partial extraction — continue this pattern.
- **Impact**: Each phase becomes independently testable. The main `run()` becomes a readable pipeline of 5-6 function calls.
- **Tests**: Existing `cli.test.js` and `cli-extended.test.js` tests (58 total) must continue passing. Add unit tests for each extracted function.
- **Constraint**: Do NOT change the error contract — `run()` must remain the top-level try/catch that catches everything.

### 4. Encapsulate `dashboard.js` module state

- **File**: `src/dashboard.js`
- **Problem**: 8 module-level `let` variables (`server`, `sseClients`, `currentState`, `tuiProcess`, `csrfToken`, `progressFilePath`, `urlFilePath`, `outputBuffer`) are scattered throughout the file and mutated by 4+ functions. This makes state transitions hard to reason about and debug.
- **Fix**: Consolidate into a single `dashboardState` object:
  ```js
  let dashboardState = {
    server: null,
    sseClients: [],
    currentState: null,
    tuiProcess: null,
    csrfToken: null,
    progressFilePath: null,
    urlFilePath: null,
    outputBuffer: '',
  };
  ```
  Update all reads/writes to use `dashboardState.server`, etc. Add a `resetDashboardState()` function for test cleanup.
- **Impact**: Single place to inspect/log all dashboard state. Easier mocking in tests. State transitions become explicit.
- **Tests**: Update `dashboard.test.js` and `dashboard-extended.test.js` mock patterns to work with the state object.

### 5. Extract `createLoggerMock()` helper for tests

- **File**: `test/helpers/mocks.js` (add to existing file)
- **Problem**: The identical logger mock shape (`{ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), initLogger: vi.fn() }`) is copy-pasted across 16+ test files. When the logger API changes (e.g., adding a new level), every test file needs updating.
- **Fix**: Add to `test/helpers/mocks.js`:
  ```js
  export function createLoggerMock() {
    return {
      initLogger: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
  }
  ```
  Each test file still needs its own `vi.mock('../src/logger.js', ...)` call at the top level (Vitest requirement — cannot be shared), but the factory ensures the shape is consistent. Update test files to use `createLoggerMock()` inside their `vi.mock` factory functions.
- **Impact**: DRY. Single source of truth for mock logger shape. Less breakage surface when logger API evolves.
- **Tests**: All existing tests must pass unchanged in behavior.

### 6. Read progress JSON synchronously on `dashboard-standalone` startup

- **File**: `src/dashboard-standalone.js`
- **Problem**: When a client connects to the standalone dashboard before the first poll interval fires (within ~500ms of server start), `currentState` is `null` and the client sees a blank dashboard. The progress JSON file already exists (written by `--init-run` before spawning the dashboard process).
- **Fix**: In the `server.listen()` callback, add a synchronous read of the progress file before the first `setInterval` poll:
  ```js
  server.listen(port, '127.0.0.1', () => {
    // Populate state immediately so early-connecting clients get data
    try {
      const raw = readFileSync(progressFile, 'utf8');
      currentState = JSON.parse(raw);
      lastRawJson = raw;
    } catch { /* file may not exist yet in edge cases */ }
    // ... existing setInterval poll
  });
  ```
- **Impact**: Eliminates the blank-dashboard flash on connect. Zero-risk change.
- **Tests**: Add a test in `dashboard-extended.test.js` or similar verifying that an SSE client connecting immediately after server start receives state data.

### 7. Add Gitleaks to CI

- **File**: `.github/workflows/ci.yml`
- **Problem**: No automated secret detection in git history. If someone accidentally commits an API key or credential, nothing catches it until a human reviews.
- **Fix**: Add a job to `ci.yml`:
  ```yaml
  secret-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  ```
- **Impact**: Automated safety net. Catches credential leaks on every push/PR.
- **Tests**: No code tests needed. Verify the CI job runs green on a clean repo.

### 8. Add characterization tests for `checkDiskSpace()`

- **File**: `test/checks-extended.test.js` (or new `test/checks-diskspace.test.js`)
- **Problem**: `checkDiskSpace()` in `src/checks.js` is the deepest-nested function in the codebase (4-5 levels: Windows PowerShell path, wmic fallback path, Unix df path). It has no direct unit tests — only the integration-level `runPreChecks` tests cover it indirectly. Refactoring this function without characterization tests is risky.
- **Fix**: Write tests that mock `child_process.execSync` to return known stdout for each platform path:
  - PowerShell `Get-PSDrive` happy path (sufficient space)
  - PowerShell `Get-PSDrive` low space (triggers warning)
  - PowerShell `Get-PSDrive` critical space (throws)
  - PowerShell failure → wmic fallback path
  - Unix `df` happy path
  - Non-numeric output handling (graceful skip)
- **Impact**: Enables safe refactoring of the deepest-nested, most platform-specific code. Tests document the actual behavior.
- **Tests**: These ARE the tests. Aim for 6-8 test cases covering all branches.

### 9. Split integration tests into `test:fast`

- **File**: `package.json`
- **Problem**: `git.test.js`, `git-extended.test.js`, and `integration.test.js` create real git repos in temp directories, adding ~30 seconds to every test run. During development, this slows the feedback loop.
- **Fix**: Add to `package.json` scripts:
  ```json
  "test:fast": "vitest run --exclude='**/git.test.js' --exclude='**/git-extended.test.js' --exclude='**/integration.test.js' --exclude='**/integration-extended.test.js'"
  ```
  Keep `npm test` running everything. `test:fast` is for rapid iteration.
- **Impact**: Sub-5-second unit test feedback loop during development. Full suite still runs in CI and before commits.
- **Tests**: Verify `test:fast` excludes the right files and all remaining tests pass.

---

## Tier 2: Medium Codebase Impact

Real improvements that won't cause problems if deferred.

### 10. Validate `id` parameter in `handleKillProcess`

- **File**: `gui/server.js`
- **Problem**: `handleKillProcess` reads `id` from the request body but doesn't validate its presence. If `id` is undefined, `processes.get(undefined)` returns `undefined`, and the function returns `{ ok: true }` (the "already dead" path). Silent success on bad input.
- **Fix**: Add `if (!id) return sendJson(res, 400, { ok: false, error: 'No process id provided' });` before the `processes.get(id)` call.
- **Impact**: Correct HTTP semantics. Prevents silent bugs in GUI client code.
- **Tests**: Add a test case in `gui-server.test.js` for POST `/api/kill-process` with empty body.

### 11. Allowlist environment variables for Claude subprocess

- **File**: `src/env.js`, `src/claude.js`
- **Problem**: `cleanEnv()` uses a blocklist approach — it copies all environment variables and deletes specific ones (`CLAUDECODE`, `CLAUDE_CODE_*`). This forwards potentially sensitive env vars to the Claude Code subprocess. An allowlist is more defensible.
- **Fix**: Change `cleanEnv()` to build a new env object from a whitelist:
  ```js
  const ALLOWED_ENV_KEYS = ['PATH', 'HOME', 'USERPROFILE', 'TEMP', 'TMP', 'NIGHTYTIDY_LOG_LEVEL', 'SHELL', 'TERM', 'LANG', 'SystemRoot', 'APPDATA', 'LOCALAPPDATA'];
  export function cleanEnv() {
    const env = {};
    for (const key of ALLOWED_ENV_KEYS) {
      if (process.env[key] !== undefined) env[key] = process.env[key];
    }
    return env;
  }
  ```
- **Impact**: Defense-in-depth. Prevents accidental leakage of `AWS_SECRET_ACCESS_KEY`, database URLs, etc. to AI subprocess.
- **Risk**: May break Claude Code if it needs specific env vars not in the allowlist. Test thoroughly. Consider a hybrid approach: allowlist + log any unknown vars that were excluded.
- **Tests**: Update `claude.test.js` env-related tests. Add tests verifying sensitive vars are excluded.

### 12. Complete remaining accessibility fixes

- **Files**: `gui/resources/index.html`, `src/dashboard-html.js`
- **Problem**: Some ARIA attributes were added (progressbar role, heading fixes) but several remain:
  - Error message elements (`.error-msg`) lack `role="alert"`
  - Loading spinner (`#setup-loading`) lacks `role="status"`
  - Status badge (`#running-status-badge`) lacks `role="status"` and `aria-live="polite"`
  - Screen sections lack `aria-labelledby` pointing to their headings
  - Dashboard reconnecting banner lacks `role="alert"`
- **Fix**: Add the missing ARIA attributes to each element. All are simple attribute additions.
- **Impact**: Screen reader users get proper announcements for errors, loading states, and status changes.
- **Tests**: No functional tests needed. Consider a snapshot test or manual screen reader verification.

### 13. Lazy `import()` for `@inquirer/checkbox`

- **File**: `src/cli.js`
- **Problem**: `@inquirer/checkbox` is statically imported at the top of `cli.js` but only used in `selectSteps()` (interactive mode). Non-interactive commands (`--list`, `--setup`, `--init-run`, `--run-step`, `--finish-run`) pay the import cost unnecessarily.
- **Fix**: Change the static import to a dynamic import inside `selectSteps()`:
  ```js
  // Remove: import checkbox from '@inquirer/checkbox';
  // In selectSteps():
  const { default: checkbox } = await import('@inquirer/checkbox');
  ```
- **Impact**: ~50-100ms faster startup for non-interactive commands.
- **Risk**: Low. `selectSteps()` is already async. Test that interactive mode still works.
- **Tests**: Existing `cli-extended.test.js` tests for `--list`, `--steps`, etc. should pass. Manual test of interactive selection.

### 14. Add `:active` state to buttons CSS

- **File**: `gui/resources/styles.css`
- **Problem**: No visual press feedback on any button in the GUI. Buttons have hover states but no active states.
- **Fix**: Add:
  ```css
  .btn:active, .btn-secondary:active, .link-btn:active {
    transform: scale(0.98);
    opacity: 0.85;
  }
  .stop-btn:active {
    transform: scale(0.98);
    opacity: 0.85;
  }
  ```
- **Impact**: Tactile feedback. Users feel the click registered.
- **Tests**: Visual verification only.

### 15. Decompose `runOnce()` in `claude.js`

- **File**: `src/claude.js`
- **Problem**: `runOnce()` contains duplicated spawn-and-watch logic for the child process (normal path and potential fallback). Extracting a `watchChild(child, timeoutMs, signal)` helper would reduce the function size and clarify intent.
- **Fix**: Extract the stdout/stderr collection, timeout handling, close event listener, and error event listener into a helper that returns a Promise resolving to `{ code, stdout, stderr, timedOut }`. Call it from `runOnce()`.
- **Impact**: Smaller, more readable function. Easier to add future spawn options.
- **Constraint**: Do NOT change the error contract — `runPrompt()` must still never throw and must return `{ success, output, error, exitCode, duration, attempts }`.
- **Tests**: All `claude.test.js` tests (25) must pass.

---

## Feature Additions

These are product roadmap items, not code quality fixes. They add new functionality for end users. Sorted by product impact.

### F1. Publish to npm registry + publish workflow

- **Impact**: **Critical** for distribution. Cannot acquire users without `npm install -g nightytidy`. The package.json is already configured with `bin`, `name`, and `description`. Needs a `release.yml` GitHub Actions workflow triggered on `v*` tags that runs `npm publish`.
- **Prerequisite**: None. Ready to do now.

### F2. Quick Sweep presets

- **Impact**: **High**. A 4-8 hour run is too big a commitment for first-time users. Define named presets: "Quick Clean" (8 high-impact steps, ~1h), "Deep Dive" (all 33, ~8h), "Security Focus" (steps 8,9,21,22), "Test Hardening" (steps 2-6). Add `--preset quick` flag.
- **Prerequisite**: None. Can use existing `--steps` mechanism internally.

### F3. `.nightytidyrc` configuration file

- **Impact**: **Medium**. Standard expectation for CLI tools. Support per-project defaults: preferred steps, timeout, preset, log level. Load from project root.
- **Prerequisite**: None. Documented as known tech debt in CLAUDE.md.

### F4. Step categories/tags in manifest

- **Impact**: **Medium**. Add a `category` field to `manifest.json` entries (e.g., "testing", "security", "performance", "architecture", "documentation", "devops", "ux"). Enable `--category security` flag and grouped display in interactive selection and `--list` output.
- **Prerequisite**: None. `manifest.json` and `loader.js` are straightforward to extend.

### F5. `--resume` for interrupted runs

- **Impact**: **Medium**. When a run is Ctrl+C'd or a step fails, users must re-run all completed steps. A `--resume` flag that reads `nightytidy-run-state.json` and skips already-completed steps saves hours. The orchestrator mode already has this data structure — interactive mode just needs to leverage it.
- **Prerequisite**: Orchestrator state file infrastructure (already exists).

### F6. Run history + trend tracking

- **Impact**: **Medium**. Persist run results to `nightytidy-history.json` (step pass/fail, duration, date). Enable a `--history` command showing trend data. Powers future features: health scoring, step recommendations, time estimation.
- **Prerequisite**: None.

### F7. GitHub Actions workflow template

- **Impact**: **Medium**. A reusable workflow or action that runs NightyTidy on a schedule (weekly cron) or on PR merge. Opens team adoption. The orchestrator mode's JSON API makes this straightforward.
- **Prerequisite**: npm publish (F1).

### F8. Custom prompt packs

- **Impact**: **Medium**. Allow loading prompts from a user-specified directory (e.g., `.nightytidy/prompts/`) in addition to the built-in 33. Enables domain-specific improvements (React, Django, Rust) and community contribution.
- **Prerequisite**: Configuration file (F3) for specifying custom prompt directory.

### F9. Cost estimation before run

- **Impact**: **Medium**. Show estimated Claude Code API cost before a run starts. Use historical per-step durations from run history, multiply by approximate token rate. "Estimated cost: $15-25 for 12 steps (~2h)."
- **Prerequisite**: Run history (F6).

### F10. Per-step diffs in report

- **Impact**: **Medium**. Capture `git diff` after each step and include in NIGHTYTIDY-REPORT.md. Shows exactly what each step changed. Makes the report 10x more useful for review.
- **Prerequisite**: None.

### F11. Slack/Discord webhook notifications

- **Impact**: **Low**. Extend notifications beyond desktop (which may be missed for overnight runs). Add a `--webhook-url` flag or config option that POSTs run results to a webhook endpoint.
- **Prerequisite**: Configuration file (F3).

### F12. MCP server

- **Impact**: **Low** (future platform play). Expose NightyTidy's step library and run capabilities as MCP tools. Any AI assistant (Claude, Codex, Cline) could discover and invoke NightyTidy.
- **Prerequisite**: npm publish (F1), stable API.
