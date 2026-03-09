# Feature Discovery & Opportunity Report

**Audit #32 -- Feature Discovery & Opportunity**
**Date**: 2026-03-09
**Status**: Read-only analysis. No code changes.

---

## 1. Executive Summary

NightyTidy is a well-architected orchestration layer at **v0.1.0** with a mature core (17 source modules, 24 test files, 90%+ coverage). It sequences 33 AI-driven improvement prompts against target codebases, handling git safety, retries, notifications, dashboards, and reporting. The product targets vibe coders at small companies -- non-technical founders and solo developers who want overnight code improvements without doing the work.

**Maturity assessment**: The core CLI loop is production-ready. The orchestrator mode is complete and well-tested. The desktop GUI is functional but new (committed but not yet in `package.json` `files` array). The product has no persistence layer, no user accounts, no telemetry, and no configuration file -- it is a pure stateless tool.

**Opportunity count by category**:
- Unfinished/partial features: 3
- Data opportunities: 6
- Natural extensions: 8
- Platform opportunities: 5
- Quick wins: 7

**Top 5 highest-value opportunities**:
1. **Run history and trend tracking** -- The report is generated then discarded after merge. Longitudinal tracking would demonstrate ROI.
2. **Step profiles / presets** -- Let users save named step selections ("just tests", "full security", "quick polish") instead of re-selecting each run.
3. **CI/CD integration mode** -- A `--ci` flag that outputs structured results for GitHub Actions / GitLab CI consumption.
4. **Post-run diff summary** -- Show users exactly what changed (files touched, lines added/removed) in the terminal and GUI.
5. **Configuration file (`.nightytidyrc`)** -- Already identified as known tech debt in CLAUDE.md. Would unlock presets, default timeout, excluded steps, and custom prompts.

---

## 2. Unfinished Features

| Feature | Evidence | Completion % | Effort to Finish | Value | Recommendation |
|---------|----------|-------------|------------------|-------|----------------|
| GUI not in package distribution | `gui/` exists with server.js, app.js, logic.js, styles.css, index.html but `package.json` `files` array only includes `bin/`, `src/` | 90% | Hours | High | Add `gui/` to `files` array, add `"gui": "node gui/server.js"` script (already present), consider an `npx nightytidy --gui` flag |
| Config file (`.nightytidyrc`) | Explicitly listed as "Known Technical Debt" in CLAUDE.md. Only env var is `NIGHTYTIDY_LOG_LEVEL` | 0% | Days | High | Would unlock presets, default timeout, excluded steps, notification preferences |
| Edge/Chromium fallback in GUI | `findChrome()` in `gui/server.js` only looks for Google Chrome. Edge (Chromium-based) is not checked | 80% | Hours | Medium | Add Edge paths on Windows/macOS/Linux for users who don't have Chrome installed |

---

## 3. Underutilized Infrastructure

| Infrastructure | Current Usage | Potential Usage | Effort | Value |
|---------------|---------------|-----------------|--------|-------|
| `nightytidy-progress.json` (progress file) | Written during run, read by TUI/dashboard, deleted on finish | Could persist as run history; could feed trend analysis | Days | High |
| `NIGHTYTIDY-REPORT.md` (markdown report) | Written once per run, committed on run branch | Not aggregated across runs. No machine-readable version. No structured export. | Days | High |
| Desktop notifications (`node-notifier`) | Fire-and-forget for start/fail/complete (3 event types) | Could notify per-step completion, estimated time remaining, summary stats | Hours | Medium |
| SSE streaming to dashboard | Streams raw Claude output + state updates | Could stream structured step metadata (files changed, tests affected) for richer dashboard UX | Weeks | Medium |
| Git safety tags (`nightytidy-before-*`) | Created for undo capability, never cleaned up | Could be listed/managed via `--list-tags` or `--cleanup` command | Hours | Low |
| `nightytidy-run.log` (log file) | Written per run, overwritten next run | No log rotation, no archival, no analysis | Days | Low |

---

## 4. Data Opportunities

### 4.1 Data Already Collected (Underutilized)

| Data Available | Feature It Could Enable | Pipeline Support | Effort | Impact |
|---------------|------------------------|-----------------|--------|--------|
| Step results (pass/fail, duration, attempts) per run | **Run history dashboard** -- track improvement velocity over time | `executionResults` object already structured; just needs persistence | Days | High |
| Step durations across runs | **Duration predictions** -- "Step 8 typically takes 12 minutes on this codebase" | Data exists in `stepResult.duration` but discarded after report | Days | High |
| Step failure patterns | **Smart step ordering** -- run frequently-failing steps first (or last), skip consistently-failing steps | Data in `executionResults.results` | Weeks | Medium |
| Claude Code output per step | **Change summaries per step** -- extract what actually changed from Claude's output | `onOutput` callback captures raw stdout; parsing would add value | Weeks | Medium |
| Git diff between safety tag and final merge | **Impact metrics** -- total files changed, lines added/removed, new tests added | `simple-git` can compute this; just not wired up | Days | High |
| Narrated changelog text | **Email/Slack digest** -- send the non-technical summary to stakeholders | `narration` variable in `cli.js` line 486; currently only written to report file | Days | Medium |

### 4.2 Data Not Yet Collected (Would Unlock Value)

| Feature Desired | Data Needed | Collection Effort |
|----------------|------------|-------------------|
| Cost tracking (API token usage per run) | Claude Code CLI does not expose token counts; would need to parse billing or estimate from output length | Medium -- requires Claude Code CLI to expose this, or heuristic estimation |
| Codebase health score over time | Aggregate step results into a composite score (test coverage %, security issues, code quality) | Medium -- need to parse step outputs for structured metrics |
| Step effectiveness ratings | User feedback on whether a step's changes were kept or reverted | Medium -- would need to check git history for reverted commits |
| Target codebase metadata | Language, framework, size (LOC), test count | Low -- could run `cloc` or parse package.json before starting |

---

## 5. Feature Opportunities

### 5.1 Natural Extensions (80%+ Foundation Exists)

| # | Feature | Category | Evidence | Foundation | Effort | Impact | Priority |
|---|---------|----------|----------|-----------|--------|--------|----------|
| 1 | **`--resume` flag to continue interrupted runs** | Natural extension | `nightytidy-run-state.json` already persists completed/failed steps. Orchestrator mode supports continuing from where it left off. Interactive mode does not. | 90% -- state file has everything needed | Days | High | Critical |
| 2 | **Post-run diff stats in terminal/GUI summary** | Natural extension | `simple-git` is already a dependency. `mergeRunBranch()` in `git.js` has access to both branches. Report already has step results table. | 85% -- just needs `git.diffSummary()` call | Hours | High | High |
| 3 | **GUI: platform-aware command building** | Natural extension | `gui/resources/logic.js` `buildCommand()` hardcodes `'Windows'` platform in `app.js` line 79. The function already accepts a platform parameter. | 95% -- just pass `navigator.platform` | Hours | Medium | High |
| 4 | **Step descriptions in `--list` output** | Natural extension | `extractStepDescription()` already exists in `cli.js` (line 22-31) and is used for `--list --json`. The `printStepList()` function (line 247) already shows descriptions. The JSON output includes them. | 95% | Hours | Low | Medium |
| 5 | **Notification preferences** (disable per event type) | Natural extension | `notify()` in `notifications.js` is a simple wrapper. Adding a filter would be trivial. | 80% -- needs config file or flags | Hours | Low | Nice-to-have |

### 5.2 Logical Additions (Users Would Expect)

| # | Feature | Category | Evidence | Foundation | Effort | Impact | Priority |
|---|---------|----------|----------|-----------|--------|--------|----------|
| 6 | **Configuration file (`.nightytidyrc`)** | Logical addition | Explicitly called out as tech debt in CLAUDE.md. Users currently have no way to set defaults (timeout, log level, excluded steps, presets). | 0% -- no config loading exists | Days | High | Critical |
| 7 | **Step presets / profiles** | Logical addition | Users must re-select steps every run. Common groupings: "testing only" (steps 2-6), "security" (step 8), "full cleanup" (steps 10-14). Could be named presets in config file. | 0% -- depends on config file | Days | High | High |
| 8 | **`--ci` mode for CI/CD pipelines** | Logical addition | Orchestrator mode already outputs JSON. But it requires 3 separate invocations (`--init-run`, `--run-step` x N, `--finish-run`). A single `--ci` command that runs everything and outputs structured results would integrate with GitHub Actions. | 70% -- orchestrator logic exists; needs single-command wrapper | Days | High | High |
| 9 | **Run history persistence** | Logical addition | Reports are committed on the run branch and merged. But there is no index or queryable history. Users cannot ask "how did my last 5 runs go?" | 10% -- reports exist but no aggregation | Weeks | High | High |
| 10 | **Webhook/Slack notifications** | Logical addition | `notifications.js` uses `node-notifier` for desktop only. Remote teams need webhook support. | 20% -- notification infrastructure exists but is desktop-only | Days | Medium | Medium |
| 11 | **`--undo` command** | Logical addition | Safety tags exist. Users are told to `git reset --hard <tag>`. An `--undo` command that lists available tags and resets would be friendlier for the target audience (non-developers). | 60% -- tags exist, git module has all needed operations | Hours | Medium | Medium |
| 12 | **Custom prompt injection** | Logical addition | All prompts are in `src/prompts/steps/*.md`. Users cannot add their own prompts or modify existing ones without editing the package. A `--custom-prompt <file>` flag or a `prompts/` directory in the target project would enable customization. | 30% -- loader reads from fixed paths; would need to check project-local paths too | Days | Medium | Medium |
| 13 | **Estimated time remaining** | Logical addition | Step durations are tracked. With even one prior run's data, NightyTidy could estimate remaining time. Currently the dashboard shows only elapsed time. | 40% -- durations exist but no historical baseline | Days | Medium | Medium |

### 5.3 Ambitious Opportunities (Differentiators)

| # | Feature | Category | Evidence | Effort | Impact | Priority |
|---|---------|----------|----------|--------|--------|----------|
| 14 | **Step dependency graph with parallel execution** | Ambitious | Steps 2-6 (all testing) could run in parallel. Steps 23-26 (all frontend) could run in parallel. Currently all 33 steps run sequentially. | Months | High | Nice-to-have |
| 15 | **"Morning brief" email/Slack summary** | Ambitious | The narrated changelog (`changelog.md` prompt) already generates a non-technical summary. Emailing or Slacking it to the user so they wake up to a friendly report would complete the "overnight" story. | Weeks | High | High |
| 16 | **Interactive review mode** | Ambitious | After a run, let users review each step's changes interactively (accept/reject per step, like a code review). Currently it is all-or-nothing via git merge. | Months | Medium | Nice-to-have |

---

## 6. Automation & Intelligence

### 6.1 Manual Processes That Could Be Automated

| Manual Process | Automation | Data/Infra Available | Effort |
|---------------|-----------|---------------------|--------|
| Selecting which steps to run | Smart recommendations based on codebase analysis (e.g., if no tests exist, auto-suggest steps 2-6) | Could parse `package.json` for test framework, check for test directories | Weeks |
| Deciding timeout per step | Adaptive timeout based on codebase size and historical step durations | Codebase size via `cloc` or LOC count; historical durations if persisted | Weeks |
| Cleanup of old NightyTidy branches/tags | `--cleanup` command to remove `nightytidy/run-*` branches and `nightytidy-before-*` tags older than N days | `simple-git` can list and delete branches/tags | Hours |
| Verifying Claude Code authentication before long runs | Pre-check exists but does not warn about API credit limits or rate limits | Would need Claude Code CLI to expose account status | N/A (blocked by Claude Code CLI) |

### 6.2 Smart Defaults

| Context | Current Behavior | Smart Default |
|---------|-----------------|---------------|
| Step selection with `--all` | Runs all 33 steps (~4-8 hours) | Could skip frontend steps (23-26) if no frontend detected, skip scheduled jobs (28) if no cron/scheduler found |
| Timeout | Fixed 45 minutes per step | Could be longer for large codebases, shorter for small ones |
| Retry count | Fixed 3 retries per step | Could reduce retries for steps that consistently fail on this codebase |

### 6.3 AI-Augmentable Features

| Feature | What It Augments | Data Available | Minimal Viable Version |
|---------|-----------------|----------------|----------------------|
| Post-run impact assessment | The narrated changelog is already AI-generated. Could also generate a "risk assessment" of changes made | Full git diff available on run branch | Add a second AI prompt that reviews all changes for risk |
| Smart step recommendations | Currently users pick from a list of 33 steps | Could analyze codebase and recommend relevant steps | Run a quick AI analysis prompt before step selection |
| Codebase health scoring | No scoring exists | Step pass/fail rates, plus parsing step outputs for specific findings | Define a scoring rubric, compute from step results |

---

## 7. Platform Opportunities

### 7.1 API-as-Product

NightyTidy's orchestrator mode (`--init-run`, `--run-step`, `--finish-run`) is already an API. Each command accepts arguments and returns JSON. This is the foundation for a hosted service.

**What exists**: JSON input/output, state persistence via file, progress streaming via SSE, dashboard via HTTP.

**What's missing for a hosted version**: Authentication, multi-tenant state (currently uses filesystem), job queuing, billing/metering, API keys.

**Assessment**: The architecture is clean enough that wrapping the orchestrator in an HTTP API server is feasible. The main barrier is that NightyTidy depends on Claude Code CLI being installed on the machine running it -- this ties it to local execution.

### 7.2 CI/CD Integration

**Current state**: NightyTidy can run in non-TTY environments with `--all` or `--steps`. The orchestrator mode outputs JSON suitable for scripting.

**Opportunity**: A GitHub Action (`nightytidy-action`) that:
1. Installs NightyTidy and Claude Code CLI
2. Runs selected steps on a schedule (e.g., weekly)
3. Creates a PR with the changes (instead of auto-merging)
4. Posts the narrated changelog as the PR description

**Foundation**: All the orchestration logic exists. The gap is packaging (Docker image or composite action), PR creation (instead of merge), and CI-specific output formatting.

**Effort**: Weeks. **Value**: High -- this is how NightyTidy reaches teams, not just individuals.

### 7.3 Team/Org Features

**Current state**: NightyTidy is a single-user tool. No concept of teams, shared configs, or centralized reporting.

**Opportunity**: A lightweight team mode where:
- `.nightytidyrc` is committed to the repo with team-agreed step selections and timeouts
- Run history is committed to a `nightytidy-history/` directory (or branch) for team visibility
- The narrated changelog could be posted to a shared Slack channel

**Assessment**: This does not require a server or SaaS infrastructure. It can be done entirely through git-based conventions and webhook integrations.

### 7.4 VS Code Extension

**Current state**: NightyTidy runs from the terminal or the desktop GUI.

**Opportunity**: A VS Code extension that:
- Shows the step list in a sidebar
- Lets users check/uncheck steps and start a run
- Displays the dashboard (progress, output) in a webview panel
- Shows run history and reports

**Foundation**: The GUI (`gui/resources/`) is already a web app with HTML/CSS/JS. The server API (`gui/server.js`) already handles all the needed operations. A VS Code webview could consume the same API.

**Effort**: Weeks. **Value**: Medium -- reaches users where they already work.

### 7.5 Multi-Model Support

**Current state**: NightyTidy is tightly coupled to Claude Code CLI (`claude` binary). The `claude.js` module spawns `claude` as a subprocess.

**Opportunity**: Support other AI code assistants (e.g., Cursor, Aider, Copilot CLI). This would:
- Broaden the potential user base
- Let users choose based on cost/performance preferences
- Reduce single-vendor risk

**Assessment**: The `claude.js` module would need to become an abstraction layer with pluggable backends. The prompts are model-agnostic (plain markdown). The main coupling is `--dangerously-skip-permissions` and `--continue` flags which are Claude Code-specific.

**Effort**: Weeks per backend. **Value**: Medium-High long term.

---

## 8. Recommended Build Order

### Quick Wins (Hours to Days)

| # | Feature | Effort | Unlocks |
|---|---------|--------|---------|
| 1 | Post-run diff stats in terminal and GUI summary | Hours | Users see tangible impact of each run |
| 2 | GUI: pass actual platform to `buildCommand()` | Hours | Cross-platform GUI correctness |
| 3 | Add Edge/Chromium fallback to `findChrome()` | Hours | GUI works for non-Chrome users |
| 4 | `--cleanup` command for old branches/tags | Hours | Repo hygiene for repeat users |
| 5 | Add `gui/` to `package.json` `files` array | Hours | GUI ships with npm package |

### Medium Investments (Days to Weeks)

| # | Feature | Effort | Unlocks |
|---|---------|--------|---------|
| 6 | Configuration file (`.nightytidyrc`) | Days | Foundation for presets, team config, all customization |
| 7 | Step presets / profiles | Days | Faster repeat usage (depends on #6) |
| 8 | `--ci` single-command mode | Days | CI/CD integration without multi-step orchestration |
| 9 | `--resume` for interactive mode | Days | Recover interrupted overnight runs |
| 10 | `--undo` command | Hours-Days | Friendlier undo for non-developer users |
| 11 | Run history persistence (JSON append file) | Days | Foundation for trends, predictions, smart defaults |
| 12 | Webhook/Slack notifications | Days | Remote team awareness |
| 13 | Custom prompt injection | Days | Power user customization |

### Strategic Investments (Weeks to Months)

| # | Feature | Effort | Unlocks |
|---|---------|--------|---------|
| 14 | GitHub Action (`nightytidy-action`) | Weeks | Team adoption, scheduled runs, PR-based workflow |
| 15 | "Morning brief" email/Slack digest | Weeks | Completes the overnight story |
| 16 | VS Code extension | Weeks | IDE-native experience |
| 17 | Run trend dashboard | Weeks | ROI demonstration, codebase health tracking |
| 18 | Smart step recommendations | Weeks | Reduces decision fatigue for new users |
| 19 | Multi-model support | Weeks-Months | Broader market, reduced vendor lock-in |
| 20 | Interactive review mode | Months | Per-step accept/reject for cautious users |

### Dependency Graph

```
.nightytidyrc (#6)
  |-- Step presets (#7)
  |-- Team config (7.3)
  |-- Custom prompts (#13)

Run history (#11)
  |-- Duration predictions (#13 in section 5.2)
  |-- Smart step ordering (4.1)
  |-- Trend dashboard (#17)
  |-- Codebase health score (6.3)

--ci mode (#8)
  |-- GitHub Action (#14)
  |-- PR-based workflow (7.2)

Webhook notifications (#12)
  |-- Morning brief (#15)
  |-- Slack digest (7.3)
```

---

## 9. What NightyTidy Should NOT Build

Grounding this in the product's design intent (stateless CLI for vibe coders at small companies):

- **User accounts / login** -- NightyTidy is a local tool. Adding auth would contradict its simplicity.
- **Cloud-hosted execution** -- Claude Code CLI requires local installation. A cloud version would need a fundamentally different architecture.
- **Real-time collaborative features** -- This is an overnight batch tool, not a real-time collaboration product.
- **Custom prompt editor UI** -- Power users can edit markdown files directly. A visual prompt editor adds complexity without proportional value.
- **Billing/payment infrastructure** -- At v0.1.0, monetization infrastructure is premature. Focus on adoption first.

---

## 10. Summary of Findings

**Zero TODO/FIXME/HACK comments** in production source code. The codebase is clean.

**Zero dead code paths** found. All exported functions are called. All modules are imported.

**Three partial features**: GUI not in distribution, config file not yet built, Chrome-only GUI launcher.

**Six data opportunities** from data already being collected but discarded after each run.

**Thirteen feature opportunities** grounded in existing code and architecture.

**Five platform opportunities** ranging from CI/CD integration (weeks) to multi-model support (months).

The highest-value, lowest-effort opportunity is adding post-run diff stats (hours of work, high user impact). The highest-value strategic opportunity is the GitHub Action for CI/CD integration (weeks of work, unlocks team adoption).

---

*Generated by NightyTidy Feature Discovery audit, 2026-03-09*
