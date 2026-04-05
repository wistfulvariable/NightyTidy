You are running an overnight documentation generation pass. Deeply understand this codebase and produce a three-tier documentation system optimized for AI coding agents, plus human-facing reference docs. Work on branch `documentation-[date]`.

## The Three-Tier System

AI agents pay a token cost for every line loaded into context — whether relevant or not. A 1,000-line guide burns ~31K tokens (~15% of 200K window) on every conversation. The fix: tiered loading.

- **Tier 1 (Always Loaded):** Rules/conventions preventing mistakes on ANY task. Compact — target 5-7% of context.
- **Tier 2 (On-Demand):** Per-topic implementation details. Loaded only when relevant. ~1-2% per task.
- **Tier 3 (Deep Reference):** Human-facing docs, ADRs, API reference. Never auto-loaded. Zero token cost.

| Tier                         | Lines       | Tokens     | % of 200K |
| ---------------------------- | ----------- | ---------- | --------- |
| Always (Tier 1)              | 300-400     | 10-13K     | 5-7%      |
| Per-task (Tier 2, 1-2 files) | 60-120      | 2-4K       | 1-2%      |
| **Typical total**            | **360-520** | **12-17K** | **6-9%**  |

Primary deliverable: Tier 1 + Tier 2. Tier 3 is secondary.

## Documentation Philosophy: Progressive Disclosure

The goal of this documentation system is simple: **an AI agent wakes up knowing nothing about this codebase and can navigate to exactly the information it needs — quickly and token-efficiently.**

Every conversation starts cold. The agent has no memory of previous sessions, no familiarity with your architecture, and a finite context window. Every line loaded into that window is a tradeoff — useful context that helps vs. irrelevant context that displaces working memory for the actual task. A flat documentation dump forces the agent to load everything to find anything. Progressive disclosure fixes this.

**How it works**: The agent gets a compact map first (Tier 1), then navigates to exactly the detail it needs (Tier 2 topic file), and only if the topic is deep enough, one more level down (Tier 2 sub-file). At most two navigational hops from cold start to specific answer.

**The navigation chain**:

1. **Always loaded** — CLAUDE.md + MEMORY.md are in context on every conversation. These orient the agent and tell it where to look next. Combined: ~12-17K tokens
2. **First hop** — MEMORY.md contains a topic index with "when to load" triggers. The agent reads a trigger like "Writing or fixing tests, mock patterns, E2E" and knows to load `testing.md`. Cost: one file read
3. **Second hop (only when needed)** — If a topic file is large enough to have been split into a hub, it contains a sub-topics table with its own triggers. The agent loads the specific sub-file. Cost: one more file read
4. **Maximum depth: two levels below MEMORY.md.** Three levels of indirection wastes more navigational overhead than it saves in token cost

**Design principles driving every structural decision**:

- **Trigger-based loading**: Every file in the index has a "when to load" description written from the agent's task perspective — "Writing or fixing tests", not "Testing documentation"
- **Hub files over bloated files**: When a topic file outgrows its target, promote it to a hub. Keep the 20% of content that covers 80% of use cases inline; split specialized detail into sub-files
- **No orphan files**: Every file must be reachable from MEMORY.md within two hops. If a file isn't linked, the agent will never find it
- **Scale with the codebase**: A 5-file CLI tool needs 3-5 memory files. A 30-service project with thousands of tests might need 20-30. File count follows complexity, not a fixed number
- **Information completeness over compression** (**primary directive**): The entire codebase must be documented with sufficient depth for an agent to work with each module correctly. A one-line mention of a system is not documentation — it's an inventory entry. If adding proper depth pushes a file past its line target, create more files. Never sacrifice coverage to hit a line count. Line targets exist to trigger splits, not to cap documentation

---

## Phases

### Phase 0: Check Existing Standards

Look for CLAUDE.md, .cursorrules, CONTRIBUTING.md, or similar. **If conflicts with three-tier system → STOP and ask user** with: what you found, what conflicts, 2-3 options with tradeoffs. No conflicts → proceed.

### Phase 1: Codebase Discovery

Read and map everything. No files produced — only understanding.

**Map:** App identity, tech stack, audience. Directory responsibilities. Request/data flow (entry → routing → middleware → handlers → data → response). External deps. Module dependency graph. Architectural patterns.

**Conventions:** Naming (files, vars, functions, components, DB). Imports, error handling, testing, state management. Lint/format configs. Build/test/deploy commands. Types as self-documentation.

**Pitfalls:** Non-obvious side effects, library workarounds, magic values, complex regex, unexplained constants, non-obvious business logic.

**Cluster** learnings into topic areas → these become Tier 2 files. For large codebases, identify which topics are broad enough to need sub-files and plan the hub structure now.

**Coverage map (critical step):** Build an explicit mapping of every significant codebase module → the documentation file responsible for it. Every service, store, hook, feature, engine, and reusable system must appear in at least one memory file. If a module has no documentation home, either add it to an existing file or plan a new one. This map is your completeness checklist for Phase 3 — you will verify each entry is documented with sufficient depth, not just mentioned in a bullet point.

### Phase 2: CLAUDE.md (Tier 1)

Create `CLAUDE.md` at project root. **Target: 250-350 lines. Hard constraint.**

**Inclusion test:** _"If I removed this, would the AI write incorrect code on an unrelated task?"_ No → Tier 2.

**Required sections:**

- **Project Identity** — One paragraph: what, who, why
- **Workflow Rules** — Non-negotiable process (deploy, test, etc.)
- **Tech Stack** — Table: technology | version | purpose
- **Project Structure** — Condensed tree, ~30 lines max, top-level + key second-level
- **Architectural Rules** — Do/don't imperatives, not explanations
- **Data Model Overview** — Collection/table names + relationships, not field-level
- **Auth Model** (if applicable) — Roles + high-level flow
- **Environment Variables** — What's needed to run
- **Build/Deploy Commands** — Copy-paste ready
- **Coding Conventions** — Only those consistently followed in code
- **Design System Rules** (if applicable) — Only if affecting every UI task; otherwise Tier 2
- **Documentation Hierarchy** — Table telling AI where knowledge lives and how to navigate:

```markdown
## Documentation Hierarchy

| Layer                                 | Loaded             | What goes here                            |
| ------------------------------------- | ------------------ | ----------------------------------------- |
| **CLAUDE.md**                         | Every conversation | Rules preventing mistakes on ANY task     |
| **MEMORY.md**                         | Every conversation | Navigation index + cross-cutting patterns |
| **Topic files** (.claude/memory/)     | On demand          | Per-topic implementation details          |
| **Sub-topic files** (.claude/memory/) | On demand          | Specialized detail within a topic         |
| **Inline comments**                   | When code is read  | Non-obvious "why" explanations            |

**Navigation**: MEMORY.md index → topic file → sub-topic file (if needed). Max 2 hops from cold start to answer. Every file reachable from MEMORY.md within 2 levels.

Rule: Prevents mistakes on unrelated tasks → CLAUDE.md. Spans features → MEMORY.md cross-cutting patterns. One feature → topic file. Narrow subtopic within a feature → sub-topic file. Single line → inline comment.
```

**Note on hub files:** The hierarchy table above includes both topic files and sub-topic files. You don't need to know the full hub structure yet — Phase 3 covers it in detail. Just ensure CLAUDE.md's hierarchy table reflects both levels so agents know the navigation depth.

**Does NOT belong in CLAUDE.md:** Feature implementation details, API response shapes, field-level schemas, testing patterns, debugging notes, security findings, historical context. All → Tier 2/3.

**Format:** Terse, imperative. Tables and bullets, not paragraphs.

### Phase 3: Tier 2 Memory Files

Create files at `.claude/memory/`. These are the documentation an agent loads on-demand to understand specific topics in depth.

#### Two-Level Structure

Memory files exist at two levels:

- **Topic files**: Linked directly from MEMORY.md. One topic per file. This is what the agent loads first
- **Sub-topic files**: Linked from a topic file that has become a hub. One narrow subtopic per file

**Maximum depth: 2 levels below MEMORY.md.** The path is always: `MEMORY.md → topic file → sub-topic file`. Never deeper. If a sub-topic file itself outgrows its target, promote it to a topic file (move it up), don't nest deeper.

#### Sizing and the Hub Pattern

**Target: 40-80 lines per file.** This is a soft target, not a hard cap — the goal is token efficiency, not arbitrary limits. Files between 80-100 lines are fine if the content is cohesive. Past ~100 lines, split. When splitting:

1. Identify which sections serve most tasks (the "always useful" core) vs. specialized tasks (the "sometimes useful" detail)
2. Keep the core content inline in the file — aim for 40-60 lines in the hub
3. Split specialized sections into sub-topic files
4. Add a **Sub-Topics** table at the bottom of the hub with "when to load" triggers

A topic file that has been split becomes a **hub file**. It still contains the most critical content inline — it is NOT reduced to a bare index. An agent loading only the hub should get what it needs for 80% of tasks involving that topic.

**Hub file example:**

```markdown
# Testing — Tier 2 Reference

## Infrastructure

[Always-needed: framework, config, helpers — 15-20 lines]

## Critical Anti-Patterns

[Always-needed: mistakes that break tests — 10-15 lines]

## Mock Patterns

[Most common patterns — 10-15 lines]

## Sub-Topics

| File               | When to load                                 |
| ------------------ | -------------------------------------------- |
| testing-mocks.md   | Complex mock patterns for IPC, DB, or CJS    |
| testing-e2e.md     | Running or writing E2E / Playwright tests    |
| testing-quality.md | Mutation testing, coverage, assertion audits |
```

#### Coverage Verification (Do This Before Moving On)

After drafting all topic files (and before Phase 4), verify coverage using the map from Phase 1:

1. **For each module in the coverage map**: Find where it's documented. Read the actual documentation. Ask: "Does this give an agent enough detail to work with this module correctly — or just enough to know it exists?" A one-line mention is NOT sufficient documentation for a module with its own state, IPC channels, decision logic, or configuration
2. **Depth test**: For each documented module, would an agent reading only this documentation be able to: modify behavior correctly, debug issues, add features, and avoid the known pitfalls? If not, the documentation is incomplete
3. **Sub-file decision**: For any module where adding sufficient depth would push a topic file past ~80 lines, plan a sub-file. But also create sub-files when a topic file covers 3+ distinct systems and an agent working on one system would waste >40% of the file's tokens on irrelevant content — even if the file is within line targets
4. **Gap action**: For any module with insufficient documentation depth, either expand the relevant topic file or create a new sub-file. Do not move to Phase 4 with known coverage gaps

**The goal is not "every file is 40-80 lines." The goal is "every significant codebase module is documented with enough depth for an agent to work with it correctly." File count and line counts are consequences of completeness, not targets to satisfy.**

#### Content Rules

- Terse reference format. Tables, bullets, code snippets — not prose
- Don't repeat CLAUDE.md. Assume reader has it loaded
- Name by topic (`testing.md`) not area (`backend-stuff.md`). Sub-files use parent prefix (`testing-mocks.md`, `testing-e2e.md`)
- Each file covers: patterns/conventions, config details, correct-pattern snippets, common mistakes, external API quirks

**Good** — tells you what to do:

```markdown
## Firestore Mock Routing

Callables using `loadPromptForPhase()` + `recordUsage()` need collection routing:

- `"prompts"` → return `{ doc: vi.fn(() => ({ get: async () => ({ exists: false }) })) }`
- `"_rateLimits"` → return safe no-op mock
```

**Bad** — teaches background knowledge (that's Tier 3):

```markdown
## About Firestore Mock Routing

When writing tests for callable functions, you need to be aware that some callables
access multiple Firestore collections...
```

#### File Count Scaling

File count scales with codebase complexity. Use this as rough guidance:

| Codebase Size           | Topic Files | Sub-Topic Files | Total |
| ----------------------- | ----------- | --------------- | ----- |
| Small (< 20 files)      | 3-5         | 0-2             | 3-7   |
| Medium (20-100 files)   | 5-10        | 2-5             | 7-15  |
| Large (100-500 files)   | 8-15        | 5-15            | 13-30 |
| Very large (500+ files) | 12-20       | 10-25           | 22-45 |

**Indicators you should split a file:**
- Exceeds ~100 lines
- Covers 3+ distinct workflows or systems
- Agents loading the file waste >50% of its content on most tasks
- A module within the file has enough documentable detail (state shapes, decision logic, IPC channels, gotchas) to fill 30+ lines on its own — even if the parent file is within line targets. This is the coverage-driven split: the agent benefits from being able to load *just* that module's documentation without the surrounding context

**Indicators you've over-split**: Multiple files under 20 lines. Agents need 3+ files for a single task. Hub files have more links than inline content. Two sub-files could be combined without exceeding 80 lines.

#### Suggested Topic Files (create only what's relevant)

| File                    | Covers                                            |
| ----------------------- | ------------------------------------------------- |
| testing.md              | Framework config, mocks, pitfalls                 |
| data-model.md           | Field schemas, indexes, storage paths, migrations |
| api-providers.md        | External endpoints, auth, rate limits, quirks     |
| frontend-patterns.md    | Component patterns, stores, animations, theme     |
| process-management.md   | Backend process lifecycle, spawn flow, guards     |
| feature-inventory.md    | Features, shared components, reusable systems     |
| security.md             | Auth details, vulnerabilities, audit findings     |
| build-infrastructure.md | Build pipeline, CI/CD, packaging                  |
| ipc-contracts.md        | IPC channels, schemas, handler conventions        |
| account-management.md   | Auth flows, credential management, usage APIs     |

Split/merge by project shape. Not every project needs every file. Create what the codebase demands — the scaling table above is your guide, not a hard rule.

### Phase 4: MEMORY.md (Tier 1 — Navigation Index)

Create `.claude/memory/MEMORY.md`. **Target: 40-80 lines.** This is the agent's primary navigation map — loaded on every conversation alongside CLAUDE.md.

**Three roles:**

1. **Orient** — Current project state (metrics, known debt, recent changes)
2. **Navigate** — Topic index with trigger-based descriptions telling the agent which file to load
3. **Remind** — Cross-cutting patterns too specific for CLAUDE.md but spanning multiple features

#### Required Sections

```markdown
# Project Memory — Index

[One-line description]. See CLAUDE.md for rules.

## Current State

- [Key metrics: test count, schema version, channel count, deploy URL, etc.]
- [Known debt summary: 1-3 bullet points]

## Topic Files

| File                   | When to load                                        |
| ---------------------- | --------------------------------------------------- |
| `testing.md`           | Writing/fixing tests, mock patterns, E2E            |
| `data-model.md`        | Database schema, queries, migrations, new tables    |
| `frontend-patterns.md` | React components, stores, animations, design system |
| `security.md`          | Auth flows, input validation, spawn security        |

## Cross-Cutting Patterns

- [Pattern]: [terse description of when/how to apply]
- [Pattern]: [terse description of when/how to apply]
```

#### Writing Good "When to Load" Triggers

The topic index is the most important part of MEMORY.md. It is the agent's decision point — load this file or skip it. Write triggers from the **agent's task perspective**, not the file's content perspective.

**Good triggers** — task-oriented, specific:

| File            | When to load                                     |
| --------------- | ------------------------------------------------ |
| `testing.md`    | Writing or fixing tests, mock patterns, E2E      |
| `security.md`   | Auth flows, input validation, spawn security     |
| `data-model.md` | Database schema, queries, migrations, new tables |

**Bad triggers** — vague, content-oriented:

| File            | When to load          |
| --------------- | --------------------- |
| `testing.md`    | Testing documentation |
| `security.md`   | Security details      |
| `data-model.md` | Database information  |

The agent should be able to read a trigger and immediately know: "yes, that's my current task" or "no, skip it."

#### Cross-Cutting Patterns Section

Include patterns that meet ALL three criteria:

1. Too specific for CLAUDE.md (not every task needs them)
2. Span multiple features (not one-file-only knowledge)
3. High mistake frequency (agents get this wrong without the reminder)

Examples: IPC envelope shapes, error handling helpers, state management gotchas. Keep to 10-15 bullets max. If this section grows past 15 items, move low-frequency ones into the most relevant topic file.

#### Scaling MEMORY.md

As the codebase grows and topic files multiply, MEMORY.md's index table grows too — but only the table. Cross-cutting patterns stay compact. If MEMORY.md exceeds ~100 lines, audit it: move low-frequency cross-cutting patterns into topic files. The index table can be as long as needed — each row costs 1 line and saves the agent from loading the wrong file.

### Phase 5: Version Control

`.gitignore`:

## Chat Output Requirement

In addition to writing the full report file, you MUST print a summary directly in the conversation when you finish. Do not make the user open the report to get the highlights. The chat summary should include:

### 1. Status Line

One sentence: what you did, how long it took, and whether all tests still pass.

### 2. Key Findings

The most important things discovered — bugs, risks, wins, or surprises. Each bullet should be specific and actionable, not vague. Lead with severity or impact.

**Good:** "CRITICAL: No backup configuration found for the primary Postgres database — total data loss risk."
**Bad:** "Found some issues with backups."

### 3. Changes Made (if applicable)

Bullet list of what was actually modified, added, or removed. Skip this section for read-only analysis runs.

### 4. Recommendations

If there are legitimately beneficial recommendations worth pursuing right now, present them in a table. Do **not** force recommendations — if the audit surfaced no actionable improvements, simply state that no recommendations are warranted at this time and move on.

When recommendations exist, use this table format:

| #                   | Recommendation                  | Impact                       | Risk if Ignored                  | Worth Doing?                           | Details                                                                       |
| ------------------- | ------------------------------- | ---------------------------- | -------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------- |
| _Sequential number_ | _Short description (≤10 words)_ | _What improves if addressed_ | _Low / Medium / High / Critical_ | _Yes / Probably / Only if time allows_ | _1–3 sentences explaining the reasoning, context, or implementation guidance_ |

Order rows by risk descending (Critical → High → Medium → Low). Be honest in the "Worth Doing?" column — not everything flagged is worth the engineering time. If a recommendation is marginal, say so.

### 5. Report Location

State the full path to the detailed report file for deeper review.

Create `audit-reports/` in project root if needed. Save as `audit-reports/01_DOCUMENTATION_COVERAGE_REPORT_[run-number]_[date]_[time in user's local time].md`, incrementing run number based on existing reports.

---

**Formatting rules for chat output:**

- Use markdown headers, bold for severity labels, and bullet points for scannability.
- Do not duplicate the full report contents — just the highlights and recommendations.
- If you made zero findings in a phase, say so in one line rather than omitting it silently.
