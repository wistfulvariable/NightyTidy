# Audit #14 — Architectural Complexity Report (Run 02)

**Date**: 2026-03-12 ~17:50 PST
**Auditor**: Claude Opus 4.5 (READ-ONLY analysis)
**Scope**: Full NightyTidy codebase (5,100+ LOC production, 9,700+ LOC tests, 19 modules)
**Duration**: Comprehensive overnight audit

---

## Executive Summary

**Overall Assessment: LEAN — with strategic simplification opportunities**

The NightyTidy codebase demonstrates excellent architectural discipline for its size. The dependency graph is acyclic with only 2 hub modules (both justified). There are no cargo-culted patterns, no premature abstractions, and no unused flexibility. The primary complexity is **essential** — it arises from genuinely distinct execution modes (interactive CLI, orchestrator API, desktop GUI) that share core logic.

**Single Biggest Complexity Tax**: Data flow redundancy — the same cost aggregation is computed 3 times, progress state is rebuilt 6 times per run, and step results pass through 3 nearly-identical transformations (StepResult → StepEntry → ExecutionResults).

**Top 3 Simplification Opportunities**:
1. **Extract SECURITY_HEADERS to shared module** — 3-place duplication across dashboard modules (Trivial, Low Risk)
2. **Cache buildProgressState() result** — called 6 times with same input, rebuilds from scratch each time (Small, Low Risk)
3. **Consolidate cost aggregation** — computed 3 times identically; should compute once and pass through (Small, Medium Risk)

---

## 1. Structural Complexity Map

### 1.1 Dependency Graph Summary

**Hub Modules (5+ incoming edges)**:
| Module | Incoming Edges | Purpose | Verdict |
|--------|---------------|---------|---------|
| `src/logger.js` | 14 | Universal logging | ✓ Legitimate — pure utility |
| `src/prompts/loader.js` | 6 | Prompt data loading | ✓ Legitimate — pure data module |

**No junk drawers detected.** The largest importer is `cli.js` (12 imports), but each import serves a distinct orchestration purpose.

**Deepest Chains**:
```
bin/nightytidy.js (depth 0)
└─ src/cli.js (depth 1)
   └─ src/executor.js (depth 2)
      └─ src/claude.js (depth 3)
         └─ src/env.js (depth 4)
            └─ src/logger.js (depth 5)
```
Maximum depth: 6 layers. Each layer adds meaningful work.

**Circular Dependencies**: None detected. The codebase forms a clean DAG.

**Orphaned Modules**: None. All modules are either entry points (`bin/nightytidy.js`, `gui/server.js`) or legitimately standalone processes (`dashboard-standalone.js`, `dashboard-tui.js`).

### 1.2 Layer Analysis Per Operation

| Operation | Files Touched | Meaningful Layers | Indirection Ratio | Assessment |
|-----------|--------------|-------------------|-------------------|------------|
| CLI Run + Selection | 18 | 11 | 1.64 | Acceptable — orchestration overhead |
| Execute Single Step | 5 | 7 | 0.71 | Excellent — minimal indirection |
| Orchestrator initRun | 10 | 9 | 1.11 | Good — initialization logic |
| Orchestrator runStep | 5 | 8 | 0.62 | Excellent — tight integration |
| Orchestrator finishRun | 9 | 10 | 0.90 | Good — cleanup logic |
| GUI Run Command | 8 | 10 | 0.80 | Good — server + frontend |
| Google Doc Sync | 6 | 11 | 0.55 | Excellent — self-contained |
| **Average** | **9.0** | **9.3** | **0.90** | **Healthy** |

**Indirection Ratio Thresholds**: <1.0 = Excellent, 1.0-1.5 = Good, 1.5-2.0 = Acceptable, >2.0 = Yellow Flag, >3.0 = Red Flag

**Glue Code Analysis**:
| Layer | Glue Lines | Total Lines | % Glue |
|-------|------------|-------------|--------|
| CLI (`cli.js`) | ~200 | 720 | 27% |
| Orchestrator (`orchestrator.js`) | ~150 | 894 | 17% |
| Executor (`executor.js`) | ~80 | 505 | 16% |
| Sync (`sync.js`) | ~40 | 536 | 7% |
| GUI Server (`gui/server.js`) | ~100 | 756 | 13% |

Highest glue ratio is `cli.js` at 27% — expected for an orchestration layer. Lowest is `sync.js` at 7% — a focused, self-contained module.

### 1.3 Abstraction Inventory

| Abstraction | Type | Location | Implementations | Justification | Verdict |
|-------------|------|----------|-----------------|---------------|---------|
| None found | — | — | — | — | ✓ Clean |

**Key Finding**: Zero unnecessary abstractions detected:
- No interfaces with one implementation
- No factories creating one type
- No wrapper classes that don't transform behavior
- No generics instantiated with one concrete type
- No event emissions with one listener (except standard Node.js streams)
- No configuration options that have never varied

### 1.4 Directory Structure Assessment

The directory structure accurately reflects the architecture:
```
bin/           # Single entry point
src/           # All production modules (flat — no nested /services, /utils)
  prompts/     # Prompt data (manifest + markdown files)
gui/           # Desktop GUI (separate concern, correctly isolated)
  resources/   # Frontend assets
test/          # Test files (mirrors src/ structure)
  helpers/     # Shared test utilities
  fixtures/    # Test data
```

**Assessment**: Clean, shallow, maps to actual architecture. No 4-level-deep single-file directories. No bloated `/utils` or `/helpers` catch-alls.

---

## 2. Data Flow Complexity

### 2.1 Transformation Chains Per Core Data Type

#### StepResult (the core output)
```
Creation (executor.js:163)
    ↓ makeStepResult()
Fast-retry merge (executor.js:257)
    ↓ sumCosts() + spread
StepEntry serialization (orchestrator.js:674)
    ↓ field extraction
ExecutionResults aggregation (orchestrator.js:203)
    ↓ array rebuild from state
Report rendering (report.js)
```

**Transformations**: 4 reshapes
**Meaningful work**: 2 (creation + cost merge)
**Redundant copies**: 2 (StepEntry and ExecutionResults are nearly identical structures)

#### CostData (token + cost tracking)
```
claude.js (parsed from JSON)
    ↓
executor.js sumCosts() (combined for improvement + doc-update)
    ↓
StepEntry (stored in state)
    ↓
cli.js:475 (aggregate #1: aborted run)
    ↓
orchestrator.js:763 (aggregate #2: step costs)
    ↓
orchestrator.js:831 (aggregate #3: total with finish cost)
```

**Redundant calculations**: Cost aggregates computed **3 times** from the same source data.

### 2.2 State Management Assessment

**Sources of Truth (Multiple)**:
| Data | Primary Source | Copies | Sync Method |
|------|---------------|--------|-------------|
| Step Results | `ExecutionResults.results` | `OrchestratorState.completedSteps`, `OrchestratorState.failedSteps`, `ProgressState.steps` | Manual array push |
| Dashboard State | `ProgressState` (JSON file) | SSE broadcasts, TUI display | File polling (500ms) |
| Configuration | CLI flags | `OrchestratorState.timeout` | Not synced — separate paths |

**Problem**: 4 independent representations of step status updated independently.

**Global State Used Where Local Would Suffice**: No issues found. Module-level singletons (`git`, `logger`) are appropriate for their purposes.

**Derived Values Stored Instead of Computed**: `ProgressState` is rebuilt 6 times per run in `orchestrator.js` (lines 507, 592, 684, 773, 855, 856). Should be computed once and cached.

### 2.3 Configuration Layer Map

**Layer 1: Environment Variables** (1 var only)
- `NIGHTYTIDY_LOG_LEVEL` — log verbosity

**Layer 2: CLI Flags** (9 flags)
- `--all`, `--steps`, `--timeout`, `--skip-sync`, `--setup`, `--list`, `--dry-run`, orchestrator flags

**Layer 3: Hardcoded Defaults** (10+ constants across files)
- `DEFAULT_TIMEOUT`, `DEFAULT_RETRIES`, `STDIN_THRESHOLD`, `INACTIVITY_TIMEOUT_MS`, `FAST_COMPLETION_THRESHOLD_MS`, etc.

**Assessment**: Configuration is minimal and intentional. No `.nightytidyrc` exists (YAGNI-compliant). The only friction is determining active timeout requires reading 4+ places (CLI args, state file, env var, defaults).

---

## 3. Pattern Complexity

### 3.1 Premature Generalizations

| Pattern | Location | Introduced | Ever Used? | Recommendation |
|---------|----------|-----------|------------|----------------|
| None found | — | — | — | — |

**The codebase exhibits excellent restraint.** No multi-tenant patterns, no plugin systems, no schema versioning, no configurable pipelines with one pipeline.

### 3.2 Unnecessary Indirection

| Pattern | Location | Simpler Alternative | Risk of Change |
|---------|----------|---------------------|----------------|
| File-based polling IPC | dashboard modules | Direct SSE from orchestrator | Medium — requires architectural change |

**File polling assessment**: 500ms polling of `nightytidy-progress.json` between orchestrator and dashboard processes. This is a pragmatic workaround for detached process IPC on Windows. SSE already exists in the dashboard, so the file polling is technically redundant — but the file enables TUI fallback on systems without browsers. **Verdict**: Accept as justified complexity.

### 3.3 Cargo-Culted Patterns

| Pattern | Problem It Solves Here | Simpler Alternative |
|---------|------------------------|---------------------|
| None found | — | — |

**The codebase avoids common cargo-cult patterns:**
- No CQRS without read/write asymmetry
- No DDD ceremony in CRUD contexts
- No Repository pattern over ORM
- No Clean Architecture layers without justification

### 3.4 Organic Growth Tangles

| Location | Issue | Resolution |
|----------|-------|------------|
| Rate-limit handling | Added as cross-cutting concern | ✓ Well-integrated into executor |
| Branch guard | Added reactively to fix branch drift | ✓ Clean recovery mechanism |
| 3-tier step recovery | Added to handle Claude Code session kills | ✓ Justified by real failures |
| Dashboard fragmentation | 4 implementations serving different modes | ⚠️ Technical debt but functional |

**The dashboard fragmentation is the only unresolved organic growth issue.** Four separate dashboard implementations (`dashboard.js`, `dashboard-standalone.js`, `dashboard-tui.js`, GUI) evolved independently. Consolidation would reduce ~800 lines of duplicate logic but requires significant effort.

---

## 4. Complexity Quantification

### 4.1 Indirection Scores Per Operation

| Operation | Files | Meaningful | Ratio | Status |
|-----------|-------|------------|-------|--------|
| CLI Run + Selection | 18 | 11 | 1.64 | 🟡 Acceptable |
| Execute Single Step | 5 | 7 | 0.71 | 🟢 Excellent |
| Orchestrator initRun | 10 | 9 | 1.11 | 🟢 Good |
| Orchestrator runStep | 5 | 8 | 0.62 | 🟢 Excellent |
| Orchestrator finishRun | 9 | 10 | 0.90 | 🟢 Good |
| GUI Run Command | 8 | 10 | 0.80 | 🟢 Good |
| Google Doc Sync | 6 | 11 | 0.55 | 🟢 Excellent |

**No red flags.** CLI orchestration is the only yellow (1.64 ratio) — expected for a module coordinating 12 others.

### 4.2 Abstraction Overhead Inventory

| Category | Count | Estimated Lines | % of Codebase |
|----------|-------|-----------------|---------------|
| Interfaces with 1 impl | 0 | 0 | 0% |
| Factories creating 1 type | 0 | 0 | 0% |
| Wrapper classes | 0 | 0 | 0% |
| Generics with 1 instantiation | 0 | 0 | 0% |
| Events with 1 listener | 0 | 0 | 0% |
| Config never varied | 0 | 0 | 0% |
| **Total Abstraction Tax** | **0** | **0** | **0%** |

**The codebase has zero abstraction overhead.** This is exceptional.

### 4.3 Onboarding Complexity Per Area

| Area | Files to Read | Layers | Patterns | Rating |
|------|--------------|--------|----------|--------|
| CLI Lifecycle | 10 | 5+ | Singleton init, callbacks, fire-and-forget | **Complex** |
| Step Execution | 5 | 6 | Subprocess streaming, retry, rate-limit | **Complex** |
| Orchestrator Mode | 8 | 6 | State file, 3-tier recovery, branch guard | **Labyrinthine** |
| Dashboard System | 4 subsystems | 3-4 each | Platform-specific spawning, polling | **Labyrinthine** |
| Git Operations | 2 | 4 | Branch guard, conflict handling | **Moderate** |
| Report Generation | 3 | 4 | Consolidation optional, CLAUDE.md update | **Moderate** |
| Google Doc Sync | 3 | 5 | HTML parsing, hash integrity | **Complex** |
| GUI System | 5 | 6+ | 5-screen FSM, 18 timers, heartbeat layers | **Labyrinthine** |

**Estimated onboarding time for full productivity**: 2+ weeks

---

## 5. Simplification Roadmap

### 5.1 Full Finding List

| # | Finding | Category | Effort | Risk | Impact | Priority |
|---|---------|----------|--------|------|--------|----------|
| 1 | `SECURITY_HEADERS` defined in 3 places | Remove (DRY) | Trivial | Low | Minor | This Week |
| 2 | `buildProgressState()` called 6 times, rebuilds each time | Collapse | Small | Low | Minor | This Week |
| 3 | Cost aggregation computed 3 times identically | Collapse | Small | Medium | Moderate | This Month |
| 4 | StepResult → StepEntry → ExecutionResults triple transform | Collapse | Medium | Medium | Moderate | This Month |
| 5 | Dashboard 4 implementations with ~800 lines overlap | Restructure | Large | High | Major | This Quarter |
| 6 | Prompt hash manual update friction | Accept | — | — | — | Accept |
| 7 | File-based polling IPC (500ms latency) | Accept | — | — | — | Accept |
| 8 | Callback explosion in executor (6 callbacks) | Accept | — | — | — | Accept |

### 5.2 This Week — Trivial Removals

**1. Extract `SECURITY_HEADERS` to shared module**
- **Current**: Defined identically in `dashboard.js:47-51`, `dashboard-standalone.js:11-15`, `gui/server.js:31-35`
- **Action**: Create `src/security.js` exporting `SECURITY_HEADERS` object
- **Effort**: 15 minutes
- **Risk**: None — pure refactor
- **Files touched**: 4

**2. Cache `buildProgressState()` result**
- **Current**: Called 6 times in `orchestrator.js` (507, 592, 684, 773, 855, 856), rebuilds from scratch each time
- **Action**: Compute once, store in local variable, pass through
- **Effort**: 30 minutes
- **Risk**: Low — single function scope change
- **Files touched**: 1

### 5.3 This Month — Planned Simplifications

**3. Consolidate cost aggregation**
- **Current**:
  - `cli.js:475-476` — aggregate for aborted run
  - `orchestrator.js:763` — aggregate for step costs
  - `orchestrator.js:831` — aggregate for total with finish cost
- **Action**: Add `totalCost` field to ExecutionResults, compute once in `buildExecutionResults()`
- **Effort**: 2-4 hours
- **Risk**: Medium — cost data flows through 5+ modules
- **Files touched**: 3 (executor.js, orchestrator.js, cli.js)

**4. Simplify StepResult → StepEntry → ExecutionResults**
- **Current**: 3 nearly-identical structures with redundant field copying
- **Action**: Use StepResult directly in state file, eliminate StepEntry wrapper
- **Effort**: 4-8 hours
- **Risk**: Medium — state file format change affects orchestrator mode
- **Files touched**: 3 (executor.js, orchestrator.js, report.js)
- **Migration**: Requires STATE_VERSION bump

### 5.4 This Quarter — Larger Restructuring

**5. Dashboard consolidation (Optional)**
- **Current**: 4 implementations (~2200 lines total, ~800 overlap)
  - `dashboard.js` — CLI mode HTTP server + TUI spawner
  - `dashboard-standalone.js` — Orchestrator mode detached server
  - `dashboard-tui.js` — Terminal UI renderer
  - GUI frontend — Browser-based state machine
- **Action**: Extract shared HTTP server logic to `src/dashboard-core.js`, keep mode-specific entry points thin
- **Effort**: 2-3 days
- **Risk**: High — multiple modes share code, edge cases in each
- **Files touched**: 5
- **Benefit**: ~500 lines removed, single place to update security headers
- **Recommendation**: Only pursue if dashboard changes are frequent. Currently stable.

### 5.5 Backlog — Good Ideas, Low Urgency

| Finding | Rationale for Deferral |
|---------|------------------------|
| Lazy prompt hash computation | Current approach works, warns correctly |
| Replace file polling with direct IPC | Works reliably, 500ms latency acceptable |
| Reduce executor callbacks | Used only by CLI, not blocking |

### 5.6 Dependency Graph Between Simplifications

```
1. SECURITY_HEADERS extraction (standalone)
2. Cache buildProgressState() (standalone)
3. Cost aggregation consolidation (standalone)
4. StepResult simplification → requires #3 complete
5. Dashboard consolidation → benefits from #1
```

---

## 6. Accepted Complexity

The following complexity is **justified** and should not be re-litigated:

| Complexity | Justification |
|------------|---------------|
| **3 execution modes** (CLI, orchestrator, GUI) | Genuinely different UX paradigms serving different users |
| **File-based polling IPC** | Pragmatic cross-platform solution for detached process communication |
| **3-tier step recovery** | Each tier solves a real failure mode (normal → session resume → fresh retry) |
| **Branch guard before/after each step** | Claude Code genuinely creates branches unpredictably |
| **Rate-limit exponential backoff with probes** | Required for Claude API rate limits |
| **Module-level singletons** (git, logger) | Appropriate for initialization-ordered resources |
| **4 dashboard implementations** | Each serves a distinct use case (CLI, orchestrator, TUI, GUI) |
| **Prompt integrity hash** | Required for `--dangerously-skip-permissions` safety |
| **18 timers in GUI** | Complex async choreography required for rate-limit pause/resume, heartbeat, watchdog |

---

## 7. Recommendations

### Priority-Ordered Next Steps

1. **Extract SECURITY_HEADERS** — 15 minutes, zero risk, reduces future maintenance
2. **Cache buildProgressState()** — 30 minutes, low risk, minor performance improvement
3. **Consolidate cost aggregation** — 2-4 hours, improves code clarity
4. **Simplify step result transformations** — 4-8 hours, reduces data flow complexity

### Which Overnight Prompts Should Run Next

Based on these findings:

| Prompt | Target | Rationale |
|--------|--------|-----------|
| **Code Elegance (05)** | `orchestrator.js:500-900` | High glue code ratio (17%), `buildProgressState()` caching |
| **Codebase Cleanup (08)** | `dashboard.js`, `dashboard-standalone.js` | Duplicate SECURITY_HEADERS |
| **File Decomposition (12)** | N/A | No oversized files detected |

### Conventions to Prevent New Complexity

1. **Before adding a callback**: Check if it's used by more than CLI mode. If not, consider keeping it CLI-specific.
2. **Before adding a data transformation**: Check if the target structure differs meaningfully from the source. If not, use the source directly.
3. **Before adding a configuration option**: Ask "Has a user requested this?" If not, hardcode.
4. **Before creating a new dashboard variant**: Consider extending an existing one with a mode flag.

### Decision Framework: Should We Add This Abstraction?

Ask in order:
1. **Is there more than one implementation?** If no → don't abstract yet.
2. **Will the abstraction be used by tests?** If yes (for mocking) → consider it.
3. **Does the abstraction reduce cognitive load?** If the concrete code is clearer → don't abstract.
4. **Is the abstraction for "flexibility we might need"?** If yes → YAGNI, don't abstract.
5. **Does git history show this area changes frequently?** If no → stability suggests no abstraction needed.

---

## Appendix: Module-Level Statistics

| Module | LOC | Imports | Exports | Complexity |
|--------|-----|---------|---------|------------|
| cli.js | 720 | 12 | 1 | High (orchestrator) |
| orchestrator.js | 894 | 9 | 4 | High (state machine) |
| executor.js | 505 | 6 | 5 | High (subprocess) |
| claude.js | 655 | 2 | 6 | High (async/retry) |
| git.js | 348 | 1 | 9 | Moderate |
| report.js | 537 | 2 | 7 | Moderate |
| sync.js | 536 | 1 | 3 | Moderate |
| dashboard.js | 328 | 2 | 4 | Moderate |
| gui/server.js | 756 | 0 | 0 | High (standalone) |
| gui/resources/app.js | 1934 | 2 | 0 | Very High (FSM) |

**Total Production LOC**: ~7,200 (including GUI frontend)
**Total Test LOC**: ~9,700
**Test-to-Code Ratio**: 1.35x — excellent coverage

---

*Report generated: 2026-03-12 ~17:50 PST*
*Analysis duration: ~45 minutes*
*Files examined: 39 (19 production + 20 test files)*
