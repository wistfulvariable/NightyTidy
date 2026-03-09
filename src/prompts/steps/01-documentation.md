You are running an overnight documentation generation pass. Deeply understand this codebase and produce a three-tier documentation system optimized for AI coding agents, plus human-facing reference docs. Work on branch `documentation-[date]`.

## The Three-Tier System

AI agents pay a token cost for every line loaded into context — whether relevant or not. A 1,000-line guide burns ~31K tokens (~15% of 200K window) on every conversation. The fix: tiered loading.

- **Tier 1 (Always Loaded):** Rules/conventions preventing mistakes on ANY task. Compact — target 5-7% of context.
- **Tier 2 (On-Demand):** Per-topic implementation details. Loaded only when relevant. ~1-2% per task.
- **Tier 3 (Deep Reference):** Human-facing docs, ADRs, API reference. Never auto-loaded. Zero token cost.

| Tier | Lines | Tokens | % of 200K |
|------|-------|--------|-----------|
| Always (Tier 1) | 300-400 | 10-13K | 5-7% |
| Per-task (Tier 2, 1-2 files) | 60-120 | 2-4K | 1-2% |
| **Typical total** | **360-520** | **12-17K** | **6-9%** |

Primary deliverable: Tier 1 + Tier 2. Tier 3 is secondary.

---

## Phases

### Phase 0: Check Existing Standards

Look for CLAUDE.md, .cursorrules, CONTRIBUTING.md, or similar. **If conflicts with three-tier system → STOP and ask user** with: what you found, what conflicts, 2-3 options with tradeoffs. No conflicts → proceed.

### Phase 1: Codebase Discovery

Read and map everything. No files produced — only understanding.

**Map:** App identity, tech stack, audience. Directory responsibilities. Request/data flow (entry → routing → middleware → handlers → data → response). External deps. Module dependency graph. Architectural patterns.

**Conventions:** Naming (files, vars, functions, components, DB). Imports, error handling, testing, state management. Lint/format configs. Build/test/deploy commands. Types as self-documentation.

**Pitfalls:** Non-obvious side effects, library workarounds, magic values, complex regex, unexplained constants, non-obvious business logic.

**Cluster** learnings into topic areas → these become Tier 2 files.

### Phase 2: CLAUDE.md (Tier 1)

Create `CLAUDE.md` at project root. **Target: 250-350 lines. Hard constraint.**

**Inclusion test:** *"If I removed this, would the AI write incorrect code on an unrelated task?"* No → Tier 2.

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
- **Documentation Hierarchy** — Table telling AI where knowledge lives:
```markdown
## Documentation Hierarchy

| Layer | Loaded | What goes here |
|-------|--------|---------------|
| **CLAUDE.md** | Every conversation | Rules preventing mistakes on ANY task |
| **MEMORY.md** | Every conversation | Cross-cutting patterns/pitfalls |
| **Sub-memory** (.claude/memory/) | On demand | Feature-specific deep dives |
| **Inline comments** | When code is read | Non-obvious "why" explanations |

Rule: Prevents mistakes on unrelated tasks → CLAUDE.md. Spans features → MEMORY.md. One feature only → sub-memory. Single line → inline comment.
```

**Does NOT belong in CLAUDE.md:** Feature implementation details, API response shapes, field-level schemas, testing patterns, debugging notes, security findings, historical context. All → Tier 2/3.

**Format:** Terse, imperative. Tables and bullets, not paragraphs.

### Phase 3: Tier 2 Memory Files

Create files at `.claude/memory/`.

**Rules:** One topic per file, 40-80 lines. Terse reference format. Don't repeat CLAUDE.md. Name by topic (`testing.md`) not area (`backend-stuff.md`). Assume reader has CLAUDE.md loaded.

**Each file covers:** Patterns/conventions, config details, correct-pattern snippets, common mistakes, external API quirks.

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

**Suggested files** (create only what's relevant):

| File | Covers |
|------|--------|
| testing.md | Framework config, mocks, pitfalls |
| data-model.md | Field schemas, indexes, storage paths, migrations |
| api-providers.md | External endpoints, auth, rate limits, quirks |
| pitfalls-frontend.md | Framework gotchas, state traps, build issues |
| pitfalls-backend.md | Server gotchas, auth helpers, error patterns |
| feature-inventory.md | Features, shared components, reusable systems |
| security.md | Auth details, vulnerabilities, audit findings |
| deployment.md | Deploy process, env configs, infrastructure |

Split/merge by project shape. **Target 8-15 files.** <5 = too broad. >20 = too granular.

### Phase 4: MEMORY.md (Tier 1 — Index)

Create `.claude/memory/MEMORY.md`. **Target: 30-60 lines.** Index and state tracker only.
```markdown
# Project Memory — Index
[One-line description]. See CLAUDE.md for rules.

## Current State
- [Key metrics: test count, endpoints, deploy URL, etc.]
- [Recent major changes from git]

## Topic Files
| File | When to load |
|------|-------------|
| testing.md | Writing or fixing tests |
| data-model.md | Database schema or queries |
```

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

| # | Recommendation | Impact | Risk if Ignored | Worth Doing? | Details |
|---|---|---|---|---|---|
| *Sequential number* | *Short description (≤10 words)* | *What improves if addressed* | *Low / Medium / High / Critical* | *Yes / Probably / Only if time allows* | *1–3 sentences explaining the reasoning, context, or implementation guidance* |

Order rows by risk descending (Critical → High → Medium → Low). Be honest in the "Worth Doing?" column — not everything flagged is worth the engineering time. If a recommendation is marginal, say so.

### 5. Report Location
State the full path to the detailed report file for deeper review.

Create `audit-reports/` in project root if needed. Save as `audit-reports/DOCUMENTATION_COVERAGE_REPORT_[run-number]_[date].md`, incrementing run number based on existing reports.

---

**Formatting rules for chat output:**
- Use markdown headers, bold for severity labels, and bullet points for scannability.
- Do not duplicate the full report contents — just the highlights and recommendations.
- If you made zero findings in a phase, say so in one line rather than omitting it silently.
