// Auto-generated from extracted-prompts.json — do not edit manually

export const STEPS = [
  {
    number: 1,
    name: "Documentation",
    prompt: `You are running an overnight documentation generation pass. Deeply understand this codebase and produce a three-tier documentation system optimized for AI coding agents, plus human-facing reference docs. Work on branch \`documentation-[date]\`.

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

Create \`CLAUDE.md\` at project root. **Target: 250-350 lines. Hard constraint.**

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
\`\`\`markdown
## Documentation Hierarchy

| Layer | Loaded | What goes here |
|-------|--------|---------------|
| **CLAUDE.md** | Every conversation | Rules preventing mistakes on ANY task |
| **MEMORY.md** | Every conversation | Cross-cutting patterns/pitfalls |
| **Sub-memory** (.claude/memory/) | On demand | Feature-specific deep dives |
| **Inline comments** | When code is read | Non-obvious "why" explanations |

Rule: Prevents mistakes on unrelated tasks → CLAUDE.md. Spans features → MEMORY.md. One feature only → sub-memory. Single line → inline comment.
\`\`\`

**Does NOT belong in CLAUDE.md:** Feature implementation details, API response shapes, field-level schemas, testing patterns, debugging notes, security findings, historical context. All → Tier 2/3.

**Format:** Terse, imperative. Tables and bullets, not paragraphs.

### Phase 3: Tier 2 Memory Files

Create files at \`.claude/memory/\`.

**Rules:** One topic per file, 40-80 lines. Terse reference format. Don't repeat CLAUDE.md. Name by topic (\`testing.md\`) not area (\`backend-stuff.md\`). Assume reader has CLAUDE.md loaded.

**Each file covers:** Patterns/conventions, config details, correct-pattern snippets, common mistakes, external API quirks.

**Good** — tells you what to do:
\`\`\`markdown
## Firestore Mock Routing
Callables using \`loadPromptForPhase()\` + \`recordUsage()\` need collection routing:
- \`"prompts"\` → return \`{ doc: vi.fn(() => ({ get: async () => ({ exists: false }) })) }\`
- \`"_rateLimits"\` → return safe no-op mock
\`\`\`

**Bad** — teaches background knowledge (that's Tier 3):
\`\`\`markdown
## About Firestore Mock Routing
When writing tests for callable functions, you need to be aware that some callables
access multiple Firestore collections...
\`\`\`

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

Create \`.claude/memory/MEMORY.md\`. **Target: 30-60 lines.** Index and state tracker only.
\`\`\`markdown
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
\`\`\`

### Phase 5: Version Control

\`.gitignore\`:

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

Create \`audit-reports/\` in project root if needed. Save as \`audit-reports/DOCUMENTATION_COVERAGE_REPORT_[run-number]_[date].md\`, incrementing run number based on existing reports.

---

**Formatting rules for chat output:**
- Use markdown headers, bold for severity labels, and bullet points for scannability.
- Do not duplicate the full report contents — just the highlights and recommendations.
- If you made zero findings in a phase, say so in one line rather than omitting it silently.`,
  },
  {
    number: 2,
    name: "Test Coverage",
    prompt: `You are running an overnight test coverage expansion. Be thorough and methodical. Your job is to dramatically improve test coverage by writing high-quality tests that catch bugs, not just inflate coverage numbers.

## Mission

Expand coverage across six phases in order: smoke tests → coverage gap analysis → unit tests → E2E tests → mutation testing → quality assessment. Work on branch \`test-coverage-[date]\`.

### Phase 1: Smoke Tests
Before doing anything else, verify the app is alive and the critical path isn't broken. Smoke tests are the bouncer at the door — if the app can't get past them, nothing else matters.

**Write and run smoke tests that verify:**
1. **The app loads** — hitting the main URL (or running the entry point) doesn't crash or return an error
2. **Auth works** — the login page renders or a test user can authenticate
3. **The main page/view renders** — the primary dashboard or home screen shows up with data
4. **The API responds** — key backend endpoints return 200, not 500
5. **The database connects** — a basic read operation succeeds

**Standards:**
- Target 3–7 tests total. These are intentionally shallow and fast (under 30 seconds for the full smoke suite).
- Smoke tests check "is it on fire?" — not "is every feature correct." Don't test edge cases here.
- If ANY smoke test fails, stop and document the failure in the report as a **CRITICAL** finding before proceeding. Do not write deeper tests against a fundamentally broken app.
- Place smoke tests in a clearly labeled file/suite (e.g., \`smoke.test.ts\` or \`__tests__/smoke/\`) so they can be run independently after deploys.
- Match existing test conventions.

**After smoke tests pass**, proceed to deeper analysis.

### Phase 2: Coverage Gap Analysis
Before writing tests, understand what's missing.
- Run the existing suite and generate a coverage report if tooling is available
- If not, manually identify: modules with zero tests, uncovered functions, unexercised code paths
- Categorize uncovered code by risk:
  - **Critical**: Public APIs, auth, payment/billing, data mutation, user-facing
  - **High**: Business logic, data transforms, validation, error handling
  - **Medium**: Internal utilities, helpers, config
  - **Low**: Logging, formatting, UI presentation
- Produce a prioritized list. Work top-down from Critical.

### Phase 3: Unit Test Generation
For each uncovered function/module, starting with Critical:

**Before writing tests:** Read the function and its callees. Understand inputs, outputs, side effects, and the implicit contract. Match existing test style/conventions.

**Cover these categories:**
1. **Happy path** — normal usage with valid inputs
2. **Edge cases** — null/undefined/empty, boundary values (0, -1, MAX_INT), single-element collections, unicode/special chars, long strings, concurrency if applicable
3. **Error paths** — invalid types, missing fields, network/DB failures, permission denied
4. **State transitions** — for stateful code, test transitions not just end states

**Quality standards:**
- Descriptive test names: \`should return empty array when user has no orders\` not \`test1\`
- One assertion per test where practical; tests must be independent
- Descriptive variable names; mock external dependencies (DB, APIs, filesystem)
- Match existing file structure and conventions

**After writing tests for each module:**
- Run them — they must pass
- If a test reveals an actual bug, DO NOT fix it. Mark as skipped with \`// BUG: [description]\` and document in the report

### Phase 4: End-to-End Tests

**If browser automation (Playwright MCP, etc.) is available:**
- Test critical user journeys: sign up/login/logout, core product workflow, payment/checkout, settings, any CRUD flow
- For each: happy path, validation errors, navigation, state persistence

**If not available:**
- Write API-level integration tests for critical endpoints
- Include auth in setup; test sequences representing real user workflows

**E2E standards:** Independent tests, self-managed test data with cleanup, deterministic data (not random), proper async waits (no \`sleep()\`), test user experience not implementation.

### Phase 5: Mutation Testing on Critical Business Logic

Coverage tells you lines were executed, not that tests would catch bugs on those lines. Manual mutation testing answers: "If I introduced a bug, would any test catch it?"

**Step 1: Select targets (10-20 functions)**
Focus on functions where a silent bug causes: financial impact (pricing, billing, tax), data corruption (DB writes, import/export, migrations), security bypass (auth, permissions, input validation), or incorrect business decisions (analytics, threshold checks, eligibility, scoring).

Skip: presentation/UI logic, logging, test utilities, config/bootstrap, code already covered by strong contract/E2E tests.

**Step 2: Apply mutations one at a time**
For each target, apply mutations from these categories (prioritize comparison/boundary first, then arithmetic, logical, null/empty):

- **Arithmetic**: \`+↔-\`, \`*↔/\`, \`%→*\`, \`+1→-1\`, remove operation (\`a+b→a\`)
- **Comparison**: \`>↔>=\`, \`<↔<=\`, \`==↔!=\`, \`>↔<\`
- **Boundary**: constants ±1, array index bounds ±1, string slice ±1
- **Logical**: \`&&↔||\`, remove negation, remove conditional branch, \`true↔false\`, remove early return
- **Null/empty**: return \`null\`, \`[]\`, \`{}\`, \`0\`, or \`""\` instead of computed value

**For each mutation:**
1. Make the single change
2. Run relevant test file(s) only (not full suite)
3. Record: **KILLED** (test failed ✓), **SURVIVED** (tests pass — gap found), **TIMED OUT** (inconclusive), or **COMPILE ERROR** (type safety win)
4. REVERT immediately. Verify original tests pass before next mutation.

**Step 3: Write tests for surviving mutants**
For every surviving mutation, write a test that fails with the mutation and passes without it. Verify the kill by re-applying the mutation. Revert and commit: \`test: add mutation-killing test for [function] — [mutation type]\`

**Step 4: Assess type system kills**
Note which mutation categories types catch automatically vs. which need tests. Document functions where stronger types would improve coverage (feeds into Type Safety prompt).

**Step 5: Calculate mutation scores**
Per function: mutation score = (killed by tests + killed by types) / total × 100%. Below 80% on critical logic is a red flag.

### Phase 6: Test Quality Assessment
For all tests (existing and new):
- Are assertions meaningful? (Calling functions without asserting results is useless)
- Are tests testing the unit or just testing mocks?
- Cross-reference Phase 5: functions with low mutation scores despite high line coverage are top priority
- For critical logic not covered by Phase 5: try flipping a comparison or removing a conditional — would any test catch it?

## Report

Create \`audit-reports/\` in project root if needed. Save as \`audit-reports/TEST_COVERAGE_REPORT_[run-number]_[date].md\`, incrementing run number based on existing reports.

### Sections:
1. **Summary** — Starting/ending coverage %, test files created, test cases written, pass/fail/skip counts, mutation score on critical logic, smoke test results (pass/fail)
2. **Smoke Test Results** — Pass/fail status for each smoke test. If any failed, document what was broken and whether it was resolved before deeper testing proceeded.
3. **Coverage Gap Analysis** — Uncovered modules by priority; covered vs. remaining
4. **Bugs Discovered** — File, line, description, severity, and the skipped test that reveals it
5. **Mutation Testing Results**
   - Per-function table: Function | File | Risk | Mutations | Killed (tests) | Killed (types) | Survived | Score
   - Overall mutation score for critical logic
   - Surviving mutants addressed (new tests): Function | Mutation | New Test | Confirms Kill?
   - Surviving mutants NOT addressed: Function | Mutation | Why Survived | Risk
   - Type system effectiveness analysis; functions needing stronger types
6. **Tests Written** — Organized by module with brief descriptions
7. **Remaining Gaps** — What needs coverage and why (time, complexity, infra); functions with low mutation scores
8. **Testing Infrastructure Recommendations** — Missing utilities, suggested patterns, infra improvements, whether a mutation framework (Stryker, mutmut, etc.) is worth adopting

## Rules
- Branch: \`test-coverage-[date]\`
- Every test must pass (or be explicitly skipped with a bug comment)
- Match existing conventions — don't introduce new frameworks
- Don't modify source code — test what exists
- Document genuinely untestable functions in the report
- Prioritize CRITICAL/HIGH. Don't spend time on LOW if CRITICAL gaps remain.
- Quality over quantity. 50 meaningful tests > 200 trivial ones.
- NEVER commit a mutation. Always revert and verify before proceeding.
- Focus mutation testing on 10-20 critical functions, not the entire codebase.
- If mutation testing a single function exceeds 20 minutes, move on and note it.
- When a mutation survives, write a killing test before moving to the next function.
- Skip mutations a linter/formatter would catch — focus on plausible real-world bugs.
- If any smoke test fails, document the failure as CRITICAL before proceeding to deeper phases.
- You have all night. Be thorough.

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

---

**Formatting rules for chat output:**
- Use markdown headers, bold for severity labels, and bullet points for scannability.
- Do not duplicate the full report contents — just the highlights and recommendations.
- If you made zero findings in a phase, say so in one line rather than omitting it silently.`,
  },
  {
    number: 3,
    name: "Test Hardening",
    prompt: `# Test Hardening

## Prompt

\`\`\`
You are running an overnight test hardening pass. You have several hours. Your job is to make the existing test suite more reliable and more complete in two specific areas: flaky test diagnosis/repair and API contract testing.

Work on a branch called \`test-hardening-[date]\`.

## Your Mission

### Phase 1: Flaky Test Diagnosis & Repair

Flaky tests are tests that sometimes pass and sometimes fail without code changes. They erode trust in the test suite and train developers to ignore failures. Your job is to find and fix them.

**Detection:**
- Run the full test suite 3-5 times in sequence
- Note any tests that produce different results across runs
- Look for tests that have been skipped/disabled with comments like "flaky", "intermittent", "timing issue", "TODO: fix"
- Search git history for tests that have been re-run in CI (if CI config is visible)
- Look for common flaky patterns even in currently-passing tests:
  - Tests that depend on wall clock time or \`Date.now()\`
  - Tests that depend on execution order (shared mutable state between tests)
  - Tests that use \`setTimeout\` or arbitrary delays instead of proper async waiting
  - Tests that depend on database auto-increment IDs or insertion order
  - Tests that depend on file system state, network availability, or external services without mocking
  - Tests that use random/non-deterministic data without seeding
  - Tests with race conditions in async setup/teardown
  - Tests that assert on floating point equality without tolerance
  - Tests that depend on object key ordering or array sort stability

**For each flaky or potentially flaky test found:**
1. Diagnose the root cause — explain WHY it's flaky
2. Fix it:
   - Replace time-dependent assertions with deterministic alternatives (mock clocks, inject time)
   - Isolate shared state — each test gets its own setup
   - Replace arbitrary delays with proper async waiting (waitFor, polling, event-based)
   - Mock external dependencies that introduce non-determinism
   - Use deterministic test data with explicit seeds if randomness is needed
   - Fix setup/teardown ordering issues
3. Run the test 5 times to verify the fix holds
4. Commit: \`fix: resolve flaky test in [module] — [root cause]\`

**For currently-disabled flaky tests:**
- Attempt to fix and re-enable them
- If you can fix them, commit with: \`fix: re-enable previously flaky test [name]\`
- If you can't fix them, document why in the report

### Phase 2: API Contract Testing

Verify that the actual API behavior matches what consumers expect. This catches drift between documentation, types, and reality.

**Step 1: Map all API endpoints**
- Crawl the routing layer to find every endpoint
- For each endpoint, document:
  - Method (GET/POST/PUT/DELETE/PATCH)
  - Path (including URL parameters)
  - Expected request body schema
  - Expected response body schema for each status code
  - Required headers / authentication
  - Query parameters

**Step 2: Compare against documentation**
- If OpenAPI/Swagger docs exist, compare the actual code against the spec
- If TypeScript types/interfaces exist for request/response, compare against actual behavior
- Flag any discrepancies:
  - Endpoints that exist in code but not in docs (undocumented)
  - Endpoints in docs but not in code (stale docs)
  - Response fields that exist in code but not in types
  - Required fields in types that are actually optional in practice
  - Status codes returned that aren't documented

**Step 3: Write contract tests**
For each endpoint, write tests that verify:
- Correct response status code for valid requests
- Correct response body structure (all expected fields present, correct types)
- Correct error response format for invalid requests (400, 401, 403, 404, 422)
- Required fields are actually required (omitting them returns appropriate error)
- Optional fields work when omitted
- Pagination behavior if applicable (correct page size, next/prev links, total count)
- Content-Type headers are correct
- CORS headers are present if expected

**Contract test quality standards:**
- Tests should validate STRUCTURE and TYPES, not specific values (unless values are constants)
- Use schema validation where possible (JSON Schema, Zod, Joi — match what the project uses)
- Test against a running instance of the app with a test database — not mocked responses
- Each endpoint gets its own test file or describe block
- Include authentication setup in test fixtures

**Step 4: Identify undocumented behavior**
As you write contract tests, you'll discover behavior that isn't documented anywhere:
- Default values for optional parameters
- Implicit filtering or sorting
- Hidden query parameters that work but aren't documented
- Rate limiting behavior
- Error message formats and codes

Document all of this. It's valuable even if you don't write tests for all of it.

## Output Requirements

Create the \`audit-reports/\` directory in the project root if it doesn't already exist. Save the report as \`audit-reports/TEST_HARDENING_REPORT_[run-number]_[date].md\` (e.g., \`TEST_HARDENING_REPORT_01_2026-02-16.md\`). Increment the run number based on any existing reports with the same name prefix in that folder.

### Report Structure

1. **Summary**
   - Flaky tests found and fixed: X
   - Flaky tests found but couldn't fix: X
   - Previously disabled tests re-enabled: X
   - API endpoints found: X
   - Contract tests written: X
   - Documentation discrepancies found: X

2. **Flaky Tests Fixed**
   - Table: | Test Name | File | Root Cause | Fix Applied |

3. **Flaky Tests Unresolved**
   - Table: | Test Name | File | Root Cause | Why It Couldn't Be Fixed |

4. **API Endpoint Map**
   - Complete table of all endpoints with method, path, auth requirement, and test status

5. **Documentation Discrepancies**
   - Every mismatch between docs/types and actual behavior
   - Include what the docs say vs. what the code does

6. **Undocumented Behavior**
   - Behavior you discovered that isn't documented anywhere

7. **Recommendations**
   - Patterns that are causing flakiness that the team should stop using
   - Suggestions for preventing future documentation drift

## Rules
- Branch: \`test-hardening-[date]\`
- When fixing flaky tests, DO NOT change the test's intent — only fix the non-determinism
- If a flaky test reveals that the underlying code has a race condition, document it as a bug — don't hide it by making the test more tolerant
- For contract tests, test against the actual running app, not mocks
- Don't generate contract tests for endpoints you can't actually call (missing auth setup, etc.) — document them as gaps instead
- Match existing test framework and conventions
- You have all night. Be thorough.
\`\`\`

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

---

**Formatting rules for chat output:**
- Use markdown headers, bold for severity labels, and bullet points for scannability.
- Do not duplicate the full report contents — just the highlights and recommendations.
- If you made zero findings in a phase, say so in one line rather than omitting it silently.`,
  },
  {
    number: 4,
    name: "API Consistency",
    prompt: `You are running an overnight API design and consistency audit. Evaluate the API surface for design consistency, correctness, and HTTP convention adherence — fix safe issues and document the rest.

Work on branch \`api-consistency-[date]\`.

## Phase 1: API Surface Discovery

**Step 1: Inventory every endpoint.** For each, document:
- HTTP method, path (including URL params), controller/handler
- Middleware applied (auth, validation, rate limiting, etc.)
- Request body schema, query parameters accepted
- Response body schema per status code
- Whether it's documented (OpenAPI, README, inline) and whether it has tests

**Step 2: Identify endpoint groupings**
- Organized by resource, feature, or ad hoc?
- Versioned and unversioned endpoints mixed?
- Same-resource endpoints scattered across files?

## Phase 2: Naming & URL Consistency

**Guiding principle:** For each dimension below, either convention is acceptable — but mixing is not. Identify the dominant convention and flag all deviations.

**URL paths — check for consistency in:**
- Pluralization (\`/users/:id\` vs \`/user/:id\`)
- Casing (lowercase-hyphenated, camelCase, snake_case)
- Nesting depth and patterns for related resources
- Action endpoints (\`POST /users/:id/activate\` vs \`PATCH /users/:id { active: true }\`)
- ID parameter naming (\`:id\` vs \`:userId\` vs \`:user_id\`)

**Request/response fields — check for consistency in:**
- Field casing (camelCase vs snake_case)
- Naming patterns for equivalent concepts (\`created_at\` vs \`createdAt\` vs \`dateCreated\`; \`id\` vs \`_id\`)
- Boolean naming (\`is_active\` vs \`active\` vs \`isActive\`)
- Collection naming (\`items\` vs \`data\` vs \`results\`)

Document the dominant convention for each category — this becomes the target for alignment.

## Phase 3: HTTP Method & Status Code Correctness

**Method audit** — verify semantic correctness:
- **GET**: Read-only, no side effects. Flag any GET that modifies data or triggers actions.
- **POST**: Creates a resource or triggers an action. Flag POSTs that are reads or updates.
- **PUT**: Full replacement. Flag PUTs doing partial updates (should be PATCH).
- **PATCH**: Partial update. Flag PATCHes requiring all fields (should be PUT).
- **DELETE**: Removes a resource. Should be idempotent (second call returns 204 or 404).
- **Idempotency**: PUT and DELETE should be idempotent. Verify.

**Status code audit** — check every returned code:
- 200 vs 201: Resource-creating POSTs should return 201.
- 204 vs 200: Bodyless DELETE/PUT/PATCH responses should use 204.
- 400 vs 422: Pick one convention for validation errors; use it everywhere.
- 401 vs 403: 401 = not authenticated, 403 = not authorized. Flag misuse.
- 404 vs 403: For inaccessible resources — either convention is fine, but be consistent within a resource type.
- Flag: internal errors returned as 4xx, user errors returned as 5xx.
- Empty list results should be 200 with empty array, not 404.

## Phase 4: Error Response Consistency

1. **Catalog every error response shape** across all endpoints.
2. **Identify the dominant pattern** — this is the target format.
3. **Flag deviations** — for each, note: current format, target format, and whether changing it would break consumers.
4. **Evaluate error quality:**
   - Are messages helpful and specific? (Not just "Validation failed")
   - Are all field errors returned at once, or fail-on-first?
   - Are machine-readable error codes included?
   - Is sensitive info leaked? (SQL errors, stack traces, internal paths)
5. **Fix safe inconsistencies** — align error format where it won't break consumers. Improve unhelpful messages.

## Phase 5: Pagination Consistency

1. **Find all list endpoints.**
2. **Audit each:**
   - Paginated at all? (Unbounded lists = performance/security risk)
   - Strategy: offset/limit, page/perPage, cursor-based?
   - Parameter names consistent? (\`page\` vs \`p\`, \`limit\` vs \`per_page\` vs \`pageSize\`)
   - Default and maximum page size enforced?
   - Response includes pagination metadata? (total count, current page, next/prev links) Format consistent?
3. **Fix safe issues** — add defaults/maximums where missing, standardize param and metadata formats.

## Phase 6: Request Validation Consistency

1. **Audit validation patterns:**
   - Does every input-accepting endpoint have validation?
   - What library/approach? Consistent or mixed?
   - Where does validation happen? (Middleware, handler, service layer, mixed?)
2. **Audit validation behavior:**
   - Consistent failure status code? Consistent error format (matching Phase 4)?
   - All errors returned at once or one at a time?
   - Same fields validated the same way across endpoints?
3. **Fix safe issues** — add missing validation using existing patterns, standardize error format.

## Phase 7: Miscellaneous API Quality

- **Rate limiting**: Coverage, consistent headers (\`X-RateLimit-*\`), missing on public/auth/expensive endpoints?
- **Versioning**: Strategy, consistency, deprecated endpoints marked?
- **Content types**: JSON endpoints verify \`Content-Type\` header? Responses include \`Content-Type: application/json\`?
- **Idempotency**: Write endpoints (especially payments/orders) support idempotency keys? Mechanism consistent?
- **Discoverability** (informational only): Links to related resources? API index endpoint?

## Output

Create \`audit-reports/\` in project root if needed. Save as \`audit-reports/API_DESIGN_REPORT_[run-number]_[date].md\`, incrementing run number based on existing reports.

### Report Structure

1. **Executive Summary** — Consistency score (poor/fair/good/excellent), total endpoints, endpoints with issues, issues fixed, issues documented for review.
2. **API Surface Map** — Endpoint inventory table: Method | Path | Auth | Validated? | Paginated? | Tested? | Documented? — Plus grouping assessment.
3. **Naming Conventions** — Dominant conventions table, URL and field inconsistencies with current vs expected, fixes applied.
4. **HTTP Correctness** — Method misuse and status code issues with recommendations, fixes applied.
5. **Error Response Consistency** — Dominant format, deviations table, error quality assessment.
6. **Pagination** — List endpoints table with strategy/params/metadata/max size, inconsistencies and fixes.
7. **Validation** — Coverage table, unprotected endpoints sorted by risk, fixes applied.
8. **Miscellaneous** — Rate limiting, versioning, content types, idempotency.
9. **API Style Guide** — Generate \`docs/API_DESIGN_GUIDE.md\` codifying dominant patterns for: URL naming, field naming, pagination, error format, status codes, validation. This is the reference for new endpoints.
10. **Recommendations** — Priority-ordered fixes, breaking changes needing versioning/migration, tooling recommendations.

## Rules

- Branch: \`api-consistency-[date]\`
- Run tests after every change. Commit with descriptive messages per module.
- **DO NOT** change endpoint URLs or HTTP methods — these are breaking changes. Document as recommendations.
- **DO NOT** change response structure on endpoints with known external consumers — document as recommendations.
- **Safe to fix**: error message wording, missing validation, pagination defaults, rate limit headers, internal/undocumented endpoint standardization.
- Confirm deviations are unintentional before flagging — some may be deliberate exceptions.
- If no dominant convention exists (true 50/50 split), document both and recommend the team decide.
- Generate the API Style Guide regardless of how much you fix.
- Be thorough. Check every endpoint.

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

---

**Formatting rules for chat output:**
- Use markdown headers, bold for severity labels, and bullet points for scannability.
- Do not duplicate the full report contents — just the highlights and recommendations.
- If you made zero findings in a phase, say so in one line rather than omitting it silently.`,
  },
  {
    number: 5,
    name: "Security Audit",
    prompt: `You are running an overnight security audit of this codebase. Be thorough, not fast. Systematically find security vulnerabilities, fix the ones that are safe to fix, and document everything else.

Work on a branch called \`security-audit-[date]\`.

## General Principles (apply to all phases)
- Each phase builds on findings from previous phases. Don't re-run tools or re-investigate issues already covered.
- Run automated tools BEFORE starting manual analysis. Their output informs where to focus.
- DO NOT install new security tools unless trivial (pip install into existing venv, npx one-off). Document missing tools as recommendations instead.
- When automated tools disagree on severity, use the higher rating and verify manually.
- Track false positives explicitly — they're useful for future runs and tool configuration.

## Phase 0: Automated Security Tooling Scan

Run every available SAST tool, dependency scanner, and secret detector first so manual analysis in Phases 1-4 can focus on what tools miss.

**Step 1: Discover available security tooling**
Search for SAST tools, dependency scanners, secret detectors, container scanners, IaC scanners, and pre-commit hooks — whether installed, configured in CI/CD, referenced in docs, or standard for the project's language/framework. Check pipeline configs, IDE configs, \`.pre-commit-config.yaml\`, \`.husky/\`, etc. Document everything found.

**Step 2: Run every available tool**
For each installed/configured tool, run it against the entire codebase. Capture: tool name, version, number of findings, severity breakdown.

For built-in tools that require no installation (\`npm audit\`, \`yarn audit\`, \`pnpm audit\`, \`pip audit\` if available), always run them. For tools requiring installation, note the gap and recommend them.

If Gitleaks or TruffleHog is installed, run against full git history. If Dockerfiles exist, run Hadolint if available.

**Step 3: Triage automated findings**
For each finding:
- **Verify it's real**: Check for false positives in context (e.g., SQL injection warning on already-parameterized queries)
- **Classify severity**: Adjust based on reachability from user input, production vs test code, and compensating controls
- **Deduplicate** across tools
- **Map** each finding to the relevant manual audit phase (1-4)

**Step 4: Document tool coverage gaps**
Identify what's NOT covered (no secret scanning, no SAST, no dependency scanning, no IaC scanning, no container scanning). These gaps dictate where to focus manual effort.

**Step 5: Assess security tooling posture**
Document: Is there security scanning in CI/CD? Are results blocking merges or just informational? Are there documented exception allowlists? When was tooling config last reviewed?

### Phase 1: Secrets & Sensitive Data Scan
Search the entire codebase (config files, scripts, test fixtures, git history) for:
- Hardcoded API keys, tokens, passwords, credentials, AWS access keys, database connection strings
- Private keys or certificates committed to the repo
- PII patterns in test data that look like real data
- \`.env\` files or similar that shouldn't be committed
- Check \`.gitignore\` for proper exclusion of sensitive file patterns

### Phase 2: Auth & Permissions Audit
Map every route/endpoint and verify for each:
- Is authentication required? Should it be?
- Is authorization/role checking applied at the right level?
- Any IDOR vulnerabilities (accepting user/resource IDs without access verification)?

Check for: inconsistent auth middleware application, underprotected admin endpoints, JWT/session config issues (expiration, signing algorithm, secret strength), password hashing (bcrypt/argon2 vs MD5/SHA).

### Phase 3: Common Vulnerability Scan
Search the codebase systematically for each pattern:

- **Injection**: SQL (string concatenation in queries), NoSQL, command (exec/spawn with user input), LDAP
- **XSS**: dangerouslySetInnerHTML, unescaped template outputs, innerHTML assignments
- **CSRF**: Missing tokens on state-changing endpoints, SameSite cookie config
- **Insecure Deserialization**: Unvalidated JSON.parse on user input, YAML.load with untrusted data, pickle/eval
- **SSRF**: User-controlled URLs fetched server-side without validation
- **Path Traversal**: File operations with user-supplied paths unsanitized
- **CORS**: Wildcard origins with credentials
- **Rate Limiting**: Auth endpoints without rate limiting
- **Security Headers**: Missing CSP, X-Frame-Options, HSTS, etc.
- **File Upload**: Missing type validation, size limits, executable uploads
- **Error Handling**: Stack traces or internal details in error responses

### Phase 4A: Dependency Vulnerabilities
- Review dependency manifests (package.json, requirements.txt, Cargo.toml, go.mod, etc.)
- Run audit tools if not already run in Phase 0
- For each CVE: note severity, check if vulnerable code path is actually used, attempt upgrade on a branch, run tests, document results

### Phase 4B: Supply Chain Attack Pattern Scan

Look for attack patterns that won't show up in \`npm audit\` — the things supply chain compromises actually use.

**Step 1: Post-install script audit**
Check every direct dependency for lifecycle scripts (preinstall, install, postinstall, prepare). For each: read the script, flag any that make network requests, read env vars, access filesystem broadly, or execute dynamic code. Check if install script restrictions are configured (e.g., \`.npmrc\` with \`ignore-scripts=true\`).

**Step 2: Typosquatting risk assessment**
Check each dependency name for typosquatting risk against well-known packages (character substitutions, misspellings, hyphen/underscore/scope variations). Verify legitimacy via web search and download counts.

**Step 3: Scope and namespace risks**
Check for: unscoped internal packages published publicly, references to scopes the team doesn't own, internal monorepo package names not registered on the public registry (dependency confusion risk), \`.npmrc\` or registry config mixing public and private registries.

**Step 4: Lock file integrity**
Verify: lock file is committed and current, all resolved URLs point to expected registries, no packages resolving to unexpected URLs/IPs, no missing integrity hashes. If git history available, check for lock file modifications without manifest changes.

**Step 5: Maintainer transfer and takeover signals**
For critical dependencies: check for recent ownership transfers, sudden releases after long inactivity, security advisories about compromised maintainer accounts. Use web search.

**Step 6: Transitive dependency risk**
Identify full dependency tree depth. Flag transitive deps with: extremely low download counts, single unmaintained maintainer, 3+ years stale, permissions beyond stated purpose.

### Phase 5: Safe Fixes

Fix issues that are mechanical, well-understood, and verifiable. After EVERY fix, run the test suite. If tests break, revert immediately and move to "document only."

**Fix these (mechanical, low-risk):**
- **Hardcoded secrets** → environment variable references (add to \`.env.example\` with placeholders, don't rotate actual credentials)
- **SQL/NoSQL injection** → parameterized queries using existing DB library
- **XSS** → safe alternatives to dangerouslySetInnerHTML, output encoding/escaping
- **Missing CSRF tokens** → add via existing CSRF library/middleware (if none exists, document only)
- **CORS misconfiguration** → explicit allowed origins if determinable from codebase (otherwise document only)
- **Missing security headers** → CSP, X-Frame-Options, X-Content-Type-Options, HSTS, Referrer-Policy via existing middleware
- **Rate limiting on auth endpoints** → add if rate limiting library already exists (otherwise document only)
- **Error information leakage** → generic error messages in production, keep detailed logging server-side
- **Missing \`.gitignore\` entries** → add patterns for .env, private keys, credentials files
- **Insecure deserialization** → safe alternatives (JSON.parse, YAML.safeLoad, schema-validated)
- **Path traversal** → sanitize paths (strip \`..\`, resolve to allowed directory)
- **Install script restrictions** → add \`.npmrc\` config, document which packages need scripts and why
- **Lock file hygiene** → regenerate from clean state if integrity issues found
- **Dependency confusion prevention** → add scoping rules for private registry resolution
- **Security tool misconfigurations** → fix outdated rulesets, re-enable disabled rules, add to CI/CD

Commit each category separately: \`security: fix [vulnerability type] in [module/scope]\`

**Document only — do NOT fix:**
Auth flow changes, permission model changes, session/JWT configuration, password policy changes, encryption changes, architecture-level security changes, dependency replacements for supply chain risk, or anything where you're not confident in the correct behavior. **When in doubt, document rather than fix.** A documented vulnerability is inconvenient; a broken auth system at 3am is a disaster.

### Phase 6: Report

Save as \`audit-reports/SECURITY_AUDIT_REPORT_[run-number]_[date].md\` (create directory if needed, increment run number based on existing reports).

### Report Structure
1. **Executive Summary** — 3-5 sentences on overall security posture, including what was found AND fixed

2. **Automated Security Scan Results**
   - Tools discovered and run: | Tool | Version | Findings | Critical | High | Medium | Low | False Positives |
   - Tools recommended but unavailable: | Tool | What It Catches | Effort to Add | Priority |
   - Key verified findings: | Finding | Tool | Severity | File | Verified? | Addressed In Phase |
   - Notable false positives (for future runs)
   - Security CI/CD assessment: what runs automatically vs. what should

3. **Fixes Applied** — everything fixed in Phase 5
   - | Issue | Severity | Location | Fix Applied | Tests Pass? | Detected By |

4. **Critical Findings (Unfixed)**
5. **High Findings (Unfixed)**
6. **Medium Findings (Unfixed)**
7. **Low Findings (Unfixed)**
8. **Informational**

9. **Supply Chain Risk Assessment**
   - Post-install scripts: | Package | Script Type | Behavior | Risk Level | Recommendation |
   - Typosquatting risks: | Package | Similar To | Confidence | Evidence |
   - Namespace/scope risks: | Package | Risk Type | Detail | Recommendation |
   - Lock file integrity: pass/fail with anomaly details
   - Maintainer risk: | Package | Concern | Evidence | Risk Level |
   - Transitive dependency stats: total count, max depth, flagged packages

### Finding Template (all findings, fixed and unfixed)
- **Title**, **Severity** (Critical/High/Medium/Low/Info), **Location** (file + line), **Description**, **Impact**, **Proof** (code snippet), **Recommendation** (with code example), **Detected By** (manual / [tool name] / both)

Additional fields for **unfixed** findings: **Why It Wasn't Fixed**, **Effort** (Quick fix / Moderate / Significant refactor)
Additional fields for **fixed** findings: **What was changed**, **Tests passing** (confirmation)

## Rules
- Work on branch \`security-audit-[date]\`. DO NOT push to main.
- Run full test suite after EVERY fix. If tests fail, revert IMMEDIATELY.
- If you find compromised credentials, flag as CRITICAL at the top regardless of everything else.
- Phase 5 fixes must be mechanical and verifiable. Judgment calls belong in the report.
- Security header defaults should be noted for team review (especially CSP).
- Don't pad the report — quality over quantity.
- When in doubt about severity, err higher. When in doubt about a fix, document instead.
- For supply chain findings: use web search to verify package legitimacy, check download counts, review maintainer history.
- Be thorough. Check every file. You have all night.

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

---

**Formatting rules for chat output:**
- Use markdown headers, bold for severity labels, and bullet points for scannability.
- Do not duplicate the full report contents — just the highlights and recommendations.
- If you made zero findings in a phase, say so in one line rather than omitting it silently.`,
  },
  {
    number: 6,
    name: "Dependency Health",
    prompt: `# Dependency Health & Upgrade Pass

## Prompt

\`\`\`
You are running an overnight dependency health audit and upgrade pass. You have several hours. Your job is to assess the health, risk, and maintainability of every external dependency in the project — then upgrade what's safe and document the rest.

Work on a branch called \`dependency-health-[date]\`.

## Your Mission

### Phase 1: Dependency Inventory

**Step 1: Catalog every dependency**
Read all dependency manifests (package.json, requirements.txt, Cargo.toml, go.mod, Gemfile, pom.xml, etc.) and create a complete inventory:

For each dependency:
- Name and current version
- Latest available version
- How far behind the project is (patch / minor / major versions behind)
- What it's used for in this project (read the code, don't guess)
- How widely it's imported (used in 1 file or 50?)
- Whether it's a direct dependency or transitive
- Whether it's a runtime dependency or dev-only

**Step 2: Catalog lock file status**
- Is there a lock file (package-lock.json, yarn.lock, poetry.lock, Cargo.lock, etc.)?
- Is it committed to the repo?
- Is it consistent with the manifest? (Run install and check for drift)
- Are there duplicate packages at different versions in the dependency tree?

### Phase 2: Health Assessment

**Step 1: Identify abandoned or risky dependencies**
For each dependency, assess its health:

- **Last published**: When was the last release? Dependencies with no release in 2+ years are a risk.
- **Maintenance signals**: Open issue count, unmerged PRs, maintainer activity (use web search to check npm/PyPI/crates.io pages and GitHub repos)
- **Known vulnerabilities**: Run \`npm audit\` / \`pip audit\` / \`cargo audit\` / equivalent. For each CVE:
  - Severity (critical/high/medium/low)
  - Is the vulnerable code path actually used in this project?
  - Is there a patched version available?
  - Is the fix a simple version bump or a breaking change?
- **Bus factor**: Is this maintained by one person? Is it a critical dependency maintained by an unfunded individual? (This is a real supply chain risk)

**Step 2: License compliance scan**
For every dependency (including transitive dependencies):
- What license does it use?
- Flag any that are:
  - **GPL/AGPL** in a proprietary or non-GPL project (potential copyleft risk)
  - **SSPL** or **BSL** (may restrict commercial use)
  - **No license specified** (legally risky — no license means no permission to use)
  - **Custom or unusual licenses** that need legal review
- Generate a complete license inventory table
- If the project has a declared license, flag any dependency license that's incompatible with it

**Step 3: Dependency weight analysis**
Identify dependencies that are disproportionately heavy:
- Packages that pull in massive transitive dependency trees for minimal functionality
- Packages where only a small fraction of the library is actually used (e.g., importing all of lodash for \`_.get\`)
- Multiple packages that do similar things (two date libraries, two HTTP clients, two validation libraries)
- Packages that could be replaced with native language features (e.g., \`is-odd\`, \`left-pad\` style micro-packages, or libraries superseded by modern language features)

For each heavy/redundant dependency:
- What is it and what's it used for?
- How much of it is actually used?
- What's the lighter alternative? (native feature, smaller package, or inline implementation)
- Estimated effort to replace it

### Phase 3: Safe Upgrades

**Step 1: Upgrade patch versions**
- Bump all dependencies to their latest patch version (X.Y.Z → X.Y.latest)
- Run the full test suite after each batch of upgrades
- These should be safe — patch versions are supposed to be backward compatible
- If any tests fail, revert that specific upgrade and document the failure
- Commit: \`chore: bump patch versions for [scope]\`

**Step 2: Upgrade minor versions**
- Bump dependencies to their latest minor version one at a time (X.Y → X.latest.latest)
- Run tests after each upgrade
- Minor versions may introduce new features but should be backward compatible
- If tests fail, revert and document
- Commit: \`chore: bump [package] to [version]\`

**Step 3: Document major version upgrades**
Major version upgrades are too risky for an overnight pass. For each dependency that's one or more major versions behind:
- What breaking changes were introduced? (Read the changelog/migration guide)
- What code in this project would need to change?
- Estimated effort: trivial / moderate / significant
- Priority: how important is this upgrade? (Security fix? Performance improvement? Just new features?)
- Dependencies on other upgrades (does upgrading X require also upgrading Y?)

**Step 4: Attempt low-risk major upgrades**
If any major upgrades look trivial (changelog says "renamed one function" or "dropped Node 12 support"):
- Attempt the upgrade
- Run tests
- If they pass, commit: \`chore: upgrade [package] from [old] to [new]\`
- If they fail, revert and add to the documentation with notes on what broke

### Phase 4: Dependency Reduction Opportunities

**Step 1: Find removable dependencies**
- Scan for dependencies that are imported in the manifest but never actually used in the source code
- Scan for dependencies that are only used in commented-out or dead code
- Check for dependencies that duplicate built-in functionality (e.g., a polyfill for something the minimum supported runtime already supports)

**Step 2: Find replaceable dependencies**
- Identify packages that can be replaced with a few lines of utility code (especially micro-packages)
- Identify packages where only one function/feature is used and that function could be inlined
- Identify packages with lighter, actively maintained alternatives

**Step 3: Implement safe removals**
- Remove clearly unused dependencies
- Run tests
- Commit: \`chore: remove unused dependency [package]\`

DO NOT replace or inline dependencies in this pass unless it's trivially simple. Document replacement opportunities for the team.

## Output Requirements

Create the \`audit-reports/\` directory in the project root if it doesn't already exist. Save the report as \`audit-reports/DEPENDENCY_HEALTH_REPORT_[run-number]_[date].md\` (e.g., \`DEPENDENCY_HEALTH_REPORT_01_2026-02-16.md\`). Increment the run number based on any existing reports with the same name prefix in that folder.

### Report Structure

1. **Executive Summary**
   - Total dependencies: X (Y direct, Z transitive)
   - Dependencies with known vulnerabilities: X
   - Dependencies 1+ major versions behind: X
   - Potentially abandoned dependencies: X
   - License risks found: X
   - Upgrades applied: X
   - Dependencies removed: X

2. **Vulnerability Report**
   - Table: | Package | CVE | Severity | Used in Project? | Fix Available? | Fix Applied? |
   - Vulnerabilities that couldn't be fixed and why

3. **License Compliance**
   - Complete license inventory: table with | Package | License | Risk Level | Notes |
   - Flagged licenses that need legal review
   - Recommendation for ongoing license monitoring

4. **Staleness Report**
   - Table: | Package | Current | Latest | Versions Behind | Last Published | Health |
   - Sorted by risk (most behind + least maintained first)

5. **Upgrades Applied**
   - Table: | Package | From | To | Tests Pass? |
   - Any issues encountered during upgrades

6. **Major Upgrades Needed (Not Applied)**
   - Table: | Package | Current | Target | Breaking Changes | Effort | Priority |
   - Suggested upgrade order (accounting for dependencies between upgrades)

7. **Dependency Weight & Reduction**
   - Heavy dependencies: table with | Package | Size/Impact | Usage | Alternative | Effort |
   - Unused dependencies removed
   - Replacement opportunities for team review

8. **Abandoned/At-Risk Dependencies**
   - Table: | Package | Last Release | Maintainer Activity | Risk | Recommendation |

9. **Recommendations**
   - Priority-ordered action items
   - Suggested tooling for ongoing dependency health (Dependabot, Renovate, Snyk, etc.)
   - Suggested policy for dependency additions (criteria for adopting new dependencies)

## Rules
- Branch: \`dependency-health-[date]\`
- Run full test suite after every upgrade attempt
- If tests fail after an upgrade, revert IMMEDIATELY — don't debug the upgrade, just document it
- DO NOT attempt major version upgrades unless the changelog clearly indicates the change is trivial for this project
- DO NOT replace or rewrite dependencies overnight — only remove unused ones
- For license assessment: flag risks, don't make legal determinations. The team needs to decide acceptable license policy.
- Use web search to check dependency health (npm page, GitHub repo, last release date, open issues)
- Be conservative. A working codebase with old dependencies is better than a broken codebase with new ones.
- You have all night. Be thorough. Check every dependency.
\`\`\`

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

---

**Formatting rules for chat output:**
- Use markdown headers, bold for severity labels, and bullet points for scannability.
- Do not duplicate the full report contents — just the highlights and recommendations.
- If you made zero findings in a phase, say so in one line rather than omitting it silently.`,
  },
  {
    number: 7,
    name: "Codebase Cleanup",
    prompt: `# The Codebase Cleanup (Updated)

## Prompt

\`\`\`
You are running an overnight codebase cleanup. You have several hours — be thorough and methodical. Unlike a security audit, you will actually be making changes to the code. Every change must keep tests passing.

## Your Mission

Conduct a comprehensive codebase cleanup covering five areas. Work on a branch called \`codebase-cleanup-[date]\`. After EVERY meaningful change, run the test suite. If tests break, revert and document the issue instead of shipping the broken change.

### Phase 1: Dead Code Elimination
Systematically identify and remove:
- **Unused exports**: Functions, classes, constants, and types that are exported but never imported anywhere
- **Unused imports**: Imports that exist but aren't referenced in the file
- **Unreachable code**: Code after return/throw statements, permanently false conditionals, disabled feature flags that will never be re-enabled
- **Orphaned files**: Files that are never imported or referenced by any other file (be careful — check for dynamic imports, config references, and script entries)
- **Unused dependencies**: Packages in package.json (or equivalent) that are never imported in the source code
- **Commented-out code blocks**: Large blocks of commented-out code (not explanatory comments — actual dead code that's been commented out). If it's in version control, it doesn't need to be preserved as comments.

**Process for each removal:**
1. Identify the dead code
2. Verify it's truly unused (search for dynamic references, string-based imports, reflection, etc.)
3. Remove it
4. Run tests
5. If tests pass, commit with a clear message: \`chore: remove unused [description]\`
6. If tests fail, revert and note it in the report as "appears unused but tests depend on it — investigate"

### Phase 2: Code Duplication Reduction
- Scan for duplicated or near-duplicated logic (functions that do roughly the same thing with minor variations)
- Focus on:
  - Copy-pasted utility functions that exist in multiple files
  - Similar data transformation logic repeated across modules
  - Repeated validation patterns that could be a shared validator
  - Similar API call patterns that could be a shared client method
- For each instance of significant duplication:
  - If the fix is low-risk (extracting a shared utility, creating a helper function): implement it, run tests, commit
  - If the fix is higher-risk (refactoring core patterns): document it in the report with a proposed approach, but don't implement

### Phase 3: Consistency Enforcement
Scan for and fix inconsistencies in:
- **Naming conventions**: Mixed camelCase/snake_case in the same language, inconsistent file naming patterns, inconsistent component naming
- **Import ordering**: Standardize to a consistent pattern (external deps → internal modules → relative imports → types)
- **Error handling patterns**: Some functions throw, some return null, some return Result types — document the dominant pattern and flag deviations
- **Async patterns**: Mixed callbacks/promises/async-await for the same kind of operation — modernize to the dominant (usually best) pattern
- **String quotes**: Mixed single/double quotes (respect existing linter config if present)

**Important**: Only fix inconsistencies where there's a clear "right way" already dominant in the codebase. Don't impose a new convention — reinforce the existing one. If it's genuinely 50/50, document it in the report and let the team decide.

### Phase 4: Configuration & Feature Flag Hygiene

This phase combines stale feature flag cleanup, TODO inventory, and comprehensive configuration hygiene.

**Step 1: Feature flag inventory and cleanup**
- Find every feature flag in the codebase (environment variables, config files, LaunchDarkly/Flagsmith/etc. references, hardcoded boolean switches)
- For each flag, document:
  - Name and location
  - Current value (always true, always false, dynamic, or unknown)
  -  **Owner**: Who likely owns this flag? (Infer from git blame, module ownership, or comments)
  -  **Age**: When was it introduced? (Check git history)
  -  **Type**: Is this a temporary rollout flag, a permanent operational toggle, or a kill switch?
- For always-true flags: remove the flag and keep the code
- For always-false flags: remove the flag AND the dead code it guards
-  For rollout flags older than 6 months that are always-on: these are almost certainly safe to remove. Remove the flag, keep the code.
- Run tests after each removal. Commit: \`chore: remove stale feature flag [name]\`

 **Step 2: Flag coupling analysis**
- Identify flags that depend on other flags (nested conditionals, compound flag checks)
- Document the combinatorial complexity: how many distinct code paths do the current flags create?
- Flag any combinations that are likely untested (e.g., if Flag A and Flag B are both "sometimes on," is the (A=true, B=false) path ever tested?)
- Document these in the report — don't try to fix flag coupling overnight

 **Step 3: Configuration sprawl audit**
- Find every configuration value in the codebase (constants, config files, environment variable reads, settings objects)
- Identify configuration that is:
  - **Set but never varied**: Config values that have only ever been set to one value across all environments. These might be candidates for becoming constants.
  - **Undocumented**: Config values that have no comment, no README entry, and no \`.env.example\` entry explaining what they do or what valid values are
  - **Duplicated**: The same conceptual setting defined in multiple places (a timeout defined in both a config file and a hardcoded fallback, with different values)
  - **Unused**: Config values defined but never read by application code
- For clearly unused config: remove it. Run tests. Commit: \`chore: remove unused config [name]\`
- For undocumented config: add clear comments explaining what it controls, valid values, and default behavior
- For duplicated config: consolidate to a single source of truth where safe

 **Step 4: Default value audit**
- For every configuration value with a default, evaluate whether the default is appropriate:
  - Are there defaults appropriate for development that would be dangerous in production? (Debug mode on by default, permissive CORS by default, short token expiry in dev but what about prod?)
  - Are there defaults that silently degrade behavior? (A cache TTL defaulting to 0, effectively disabling caching)
  - Are there missing defaults that cause crashes if the config isn't explicitly set?
- Document concerns in the report. Fix defaults that are clearly wrong and safe to change.

**Step 5: TODO/FIXME/HACK inventory** (unchanged from original)
- Find every TODO, FIXME, HACK, XXX, and TEMP comment in the codebase. For each one:
  - Categorize: bug, tech debt, feature request, optimization, or obsolete
  - If it's clearly obsolete (references old code that no longer exists, mentions completed work): remove it
  - For the rest: include in the report with file, line, category, and your assessment of priority

### Phase 5: Quick Wins
As you work through the phases above, you'll notice small improvements that don't fit neatly into a category. Fix them as you go:
- Simplifying overly complex conditionals
- Replacing deprecated API usage with modern equivalents
- Removing unnecessary type assertions (TypeScript)
- Converting var to const/let where applicable
- Removing empty files, empty constructors, or no-op overrides
- Fixing obvious typos in variable names or comments

Commit these as \`chore: misc cleanup in [module/file]\`

## Output Requirements

Create the \`audit-reports/\` directory in the project root if it doesn't already exist. Save the report as \`audit-reports/CODEBASE_CLEANUP_REPORT_[run-number]_[date].md\` (e.g., \`CODEBASE_CLEANUP_REPORT_01_2026-02-16.md\`). Increment the run number based on any existing reports with the same name prefix in that folder.

### Report Structure

1. **Summary**
   - Total files modified
   - Lines of code removed (net)
   - Unused dependencies removed
   - Number of commits made
   - Any tests that were affected

2. **Dead Code Removed** — list everything you removed and why you're confident it was dead

3. **Duplication Reduced** — what you consolidated, plus higher-risk duplications you documented but didn't touch

4. **Consistency Changes** — what patterns you enforced and where

5. **Configuration & Feature Flags**  (expanded from original)
   - Flags removed: table with | Flag | Type | Age | Value | Action Taken |
   -  Flag coupling map (which flags interact and the combinatorial paths created)
   -  Configuration sprawl findings: table with | Config | Location | Issue | Action |
   -  Default value concerns: table with | Config | Default | Concern | Recommendation |
   - Full TODO/FIXME inventory table: | File | Line | Comment | Category | Priority | Recommendation |

6. **Couldn't Touch** — things you wanted to fix but couldn't because:
   - Tests broke when you tried
   - The change was too risky without team input
   - You weren't sure about the intended behavior

7. **Recommendations** — larger refactoring opportunities you noticed that deserve their own effort

## Rules
- Branch: \`codebase-cleanup-[date]\`
- Run tests after EVERY change. No exceptions.
- If tests fail, revert immediately and document why
- Make small, atomic commits — one logical change per commit
- Commit messages should start with \`chore:\` and clearly describe what was done
- DO NOT change any business logic. If you're unsure whether something is dead code or intentional, leave it and document it
- DO NOT refactor working code just because you'd write it differently. Only fix actual issues: dead code, duplication, inconsistency.
- When in doubt, document rather than change. Conservative changes that keep tests green are infinitely more valuable than aggressive changes that might break things.
- You have all night. Be thorough. Check every directory.
\`\`\`


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

---

**Formatting rules for chat output:**
- Use markdown headers, bold for severity labels, and bullet points for scannability.
- Do not duplicate the full report contents — just the highlights and recommendations.
- If you made zero findings in a phase, say so in one line rather than omitting it silently.`,
  },
  {
    number: 8,
    name: "Cross-Cutting Concerns",
    prompt: `# Cross-Cutting Concerns Consistency Audit

Find patterns that should be identical across the codebase but have drifted. Other audits check within a single module; this one checks each pattern **across every instance, file, and layer** — drift between implementations is the bug.

Branch: \`cross-cutting-consistency-[date]\`. Report: \`audit-reports/CROSS_CUTTING_CONSISTENCY_REPORT_[run]_[date].md\`.

---

## Global Rules

- Run tests after every change. Commits: \`fix: standardize [pattern] in [module]\`
- Per concern: **(1)** find every instance, **(2)** identify dominant/best pattern, **(3)** catalog every deviation, **(4)** fix only mechanical low-risk deviations, **(5)** document everything else.
- **Only fix** when: canonical pattern is unambiguous, change is mechanical (not behavioral), code has test coverage, no API contract or user-facing behavior changes.
- **Do NOT fix**: public endpoint response shapes, business logic, untested code, or 50/50 splits (document both, recommend team decision).
- **Be exhaustive.** "37 of 40 endpoints use offset/limit, 3 use cursor-based" is valuable. "Most use offset/limit" is not. Count everything.
- For multi-tenancy and soft-delete: missing filters = potential data leak bugs. Treat as security-severity.

---

## Phase 1: Pagination Consistency

Find every list/collection endpoint, query, UI list, and GraphQL connection. For each, catalog:

- **Strategy**: offset/limit, page/pageSize, cursor-based, keyset, or unbounded
- **Param names**: \`page\`/\`limit\`/\`per_page\`/\`pageSize\`/\`cursor\`/\`after\`/\`next_token\`/etc.
- **Defaults & max page size** (flag missing maximums)
- **Response metadata shape**: \`{ total, page, pageSize }\` vs \`{ totalCount, hasMore, nextCursor }\` vs wrapped vs none
- **Where logic lives**: handler, service, shared utility, ORM scope, inline
- **Edge cases**: page 0 vs 1, negative, beyond total, pageSize=0, pageSize=999999

**Safe fixes**: Add missing max page size limits. Align internal param names. Standardize metadata on internal endpoints. Add missing defaults.

**Report table**: Location | Type | Strategy | Params | Defaults | Max Size | Metadata Shape | Canonical? | Fixed?

---

## Phase 2: Sorting & Filtering Consistency

Find every sortable/filterable endpoint or dynamic query. Catalog:

- **Sort format**: \`?sort=name\` vs \`?sort_by=name&order=asc\` vs \`?sort=name:asc\` vs others
- **Multi-field sort** support and syntax
- **Default sort** (explicit or implicit insertion order = fragile)
- **Filter format**: \`?status=active\` vs \`?filter[status]=active\` vs others
- **Filter operators**: equality only or range/contains/in? Consistent syntax?
- **Search**: \`?q=\` vs \`?search=\` vs \`?query=\` — type (full-text, LIKE, regex) and which fields
- **Validation**: sort fields checked against allowlist? (Flag missing allowlists)
- **SQL injection risk**: dynamic fields parameterized or concatenated? (**CRITICAL** if concatenated)

**Safe fixes**: Standardize internal param names. Add missing sort field allowlists. Add default sorts. Fix SQL injection risks.

**Report table**: Location | Sort Format | Filter Format | Search Format | Default Sort | Validated? | Canonical?

---

## Phase 3: Soft Delete & Data Lifecycle Consistency

Find every deletion operation (DELETE queries, \`.destroy()\`/\`.delete()\`, status→deleted/archived, \`deleted_at\`/\`is_deleted\` updates, hard deletes). Catalog:

- **Strategy**: hard delete, soft delete (timestamp vs boolean vs status-based), or mixed
- **Field used**: \`deleted_at\` vs \`deletedAt\` vs \`is_deleted\` vs \`status\` vs \`active\` (inverted)
- **Query filtering**: do ALL read queries on soft-delete tables exclude deleted records? (Missing filters = silent data integrity bugs)
- **Unique constraints**: can soft-deleted records block new records with same unique field?
- **Cascade**: parent soft-deleted → children soft-deleted? hard-deleted? orphaned?
- **Restoration path**, permanent purge process
- **API behavior**: DELETE returns what? GET on deleted record returns 404, 410, or flagged record?

**Most dangerous drift**: some queries filtering soft-deleted records, others not.

**Safe fixes**: Add missing \`WHERE deleted_at IS NULL\`. Standardize field names via migration files (don't run).

**Report table**: Entity | Strategy | Field | All Queries Filter? | Cascade | Unique Constraint Issue? | Restoration? | Purge?

---

## Phase 4: Audit Logging & Activity Tracking Consistency

Find every audit mechanism (audit tables, activity feeds, event tracking, \`created_by\`/\`updated_by\` fields, timestamps, change history, webhooks). For every create/update/delete on every significant entity, catalog:

- **Is it logged?** Via what mechanism?
- **What's captured?** Actor, action, target, timestamp, before/after values, IP/session context
- **Where logged?** Inline, middleware, ORM hook, DB trigger, event subscriber
- **Storage & retention**

**Flag operations with no audit trail**, especially: user data changes, permission/role changes, financial ops, admin actions, auth events, data exports, config changes, deletions.

**Safe fixes**: Add missing \`updated_at\` auto-update. Populate \`created_by\`/\`updated_by\` where pattern exists but was missed. Add audit entries for unlogged critical ops using existing mechanism. Do NOT introduce new audit mechanisms.

**Report table**: Entity | Create Logged? | Update Logged? (diff?) | Delete Logged? | Actor Captured? | Mechanism | Gaps

---

## Phase 5: Timezone & Date/Time Handling Consistency

Find every date/time operation (creation, parsing, formatting, storage, comparison, arithmetic, timezone conversion, display). Catalog:

- **Storage TZ**: UTC, server-local, user-local, mixed? Column types: \`TIMESTAMP\` vs \`TIMESTAMPTZ\` vs \`DATETIME\` vs \`VARCHAR\`?
- **Library**: \`Date\`, \`moment\`, \`date-fns\`, \`dayjs\`, \`luxon\` — multiple in use?
- **Server-side creation**: \`new Date()\` (server TZ), \`Date.now()\`, \`moment.utc()\`, DB \`NOW()\`?
- **User display**: converted to user TZ? Where does user TZ come from?
- **API format**: ISO 8601? Unix timestamps? Locale strings? Mixed?
- **Date-only values**: stored as datetime (midnight of which TZ?), date type, or string?
- **DST handling**: adds 24 hours (wrong) or 1 calendar day (right)?
- **Date boundaries**: "today's records" — whose today?

**Dangerous drift**: some DB columns UTC, others server-local (invisible until multi-zone or DST). Mixed API date formats.

**Safe fixes**: Replace \`new Date()\` with UTC equivalents per convention. Standardize internal API dates to ISO 8601. Add TZ-aware column types in migration files. Replace deprecated date library usage.

**Report table**: Location | Operation | Library | Timezone | Format | Storage Type | Canonical? | Risk

---

## Phase 6: Currency & Numeric Precision Consistency

**Skip if app doesn't handle money/prices/precision-sensitive numbers. State why.**

Find every monetary/precision operation. Catalog:

- **Storage**: integer cents, \`DECIMAL(x,y)\`, \`FLOAT\`, string?
- **Code representation**: float, BigDecimal, integer cents, money library?
- **Arithmetic**: float math (precision loss), integer math (truncation), library-based?
- **Rounding**: method and consistency
- **Currency**: hardcoded, per-record, configurable?
- **Display & API format**: consistent?

**Dangerous drift**: mixing float and integer cents (off-by-one-cent bugs at scale).

**Report table**: Location | Value Type | Storage | Code Rep | Arithmetic | Rounding | Display | Canonical? | Precision Risk?

---

## Phase 7: Multi-Tenancy & Data Isolation Consistency

**Skip if single-tenant with no org/workspace/team concept. State why.**

Identify tenancy model (row-level \`tenant_id\`, schema-per-tenant, etc.). For every query, endpoint, and background job, audit:

- **Tenant scoping applied?** Via middleware (automatic) or manual per-query?
- **Bypassable?** Can developers write unscoped queries?
- **Background jobs**: receive and enforce tenant context?
- **Caches, file storage, search indexes**: tenant-scoped?
- **Unique constraints**: scoped to tenant?

**Missing tenant scoping on user-data table = CRITICAL cross-tenant data exposure.**

**Report table**: Entity | Has tenant_id? | Scoping Method | All Queries Scoped? | Cache Scoped? | Files Scoped? | Gaps

---

## Phase 8: Error Response & Status Code Consistency

For each scenario below, find every occurrence across all endpoints and compare responses:

**Scenarios**: Validation failure (400 vs 422, shape), Not found (404), Not authorized (401 vs 403), Forbidden, Conflict/duplicate (409 vs 400), Rate limited (429 + headers), Internal error (500, detail leakage), Method not allowed (405), Request too large (413)

For each: catalog dominant response, deviations (with location), and whether deviation is intentional.

**Safe fixes**: Align error responses on internal endpoints to dominant pattern.

**Report table per scenario**: Endpoint | Status Code | Response Shape | Message | Canonical? | Fixed?

---

## Phase 9: Synthesis & Drift Map

### Drift Heat Map
Rate each concern: **Consistent** (90%+), **Minor drift** (70-90%), **Significant drift** (50-70%), **No standard** (<50%).

### Root Cause Analysis
Per area with significant drift: missing shared utility? Convention changed over time? Different developer conventions? Pattern never decided?

### Prevention Recommendations
Per concern: shared utility to build, linter rule to enforce, code review checklist item, documentation to write.

---

## Chat Output Requirement

Print a summary in conversation (don't make user open the report):

1. **Status Line** — What you did, whether tests pass.
2. **Key Findings** — Specific, actionable bullets with severity. Lead with impact.
   - ✅ "CRITICAL: 4 of 22 queries on \`orders\` don't filter \`deleted_at\` — soft-deleted orders appear in invoices."
   - ❌ "Found some inconsistencies with soft deletes."
3. **Changes Made** (if any) — Bullet list. Skip for read-only runs.
4. **Drift Heat Map** — Summary table from report.
5. **Recommendations** — Table (only if warranted):

| # | Recommendation | Impact | Risk if Ignored | Worth Doing? | Details |
|---|---|---|---|---|---|
| *n* | *≤10 words* | *What improves* | *Low/Med/High/Critical* | *Yes/Probably/Only if time* | *1–3 sentences* |

Order by risk descending. Be honest in "Worth Doing?" — not everything is worth the engineering time.

6. **Report Location** — Full path to detailed report.`,
  },
  {
    number: 9,
    name: "File Decomposition",
    prompt: `# File Decomposition & Module Structure

You are running an overnight file decomposition and module structure improvement pass. Your job: find oversized files that are doing too much, and break them into smaller, focused modules that are easier to understand, test, and maintain. Target: no file should exceed 500 lines unless there's a clear structural reason.

This is one of the higher-risk overnight runs — every file split touches imports across the codebase. Move slowly, verify thoroughly, and when in doubt, document rather than split.

Work on branch \`file-decomposition-[date]\`.

---

## Global Rules

- **One file at a time.** Split a file, update ALL imports, run tests, commit. Only then move to the next file.
- Run the FULL test suite after every split — not just related test files. Import breakage can surface anywhere.
- Run the build/compile step after every split too (if applicable). Runtime import errors don't always show up in tests.
- DO NOT change any business logic, function signatures, or public APIs. Only move code between files and update references.
- DO NOT rename functions, variables, classes, or exports during this pass. Renaming + moving simultaneously makes failures harder to diagnose.
- If tests or build fail after a split, revert the ENTIRE split immediately. Do not attempt to debug — document what happened and move on.
- Commit format: \`refactor: decompose [original-file] into [new-modules]\`
- **Conservative threshold**: Only split files over **300 lines**. Files between 300-500 lines should only be split if they contain clearly distinct responsibilities. Files under 300 lines are almost never worth touching.
- You have all night — thoroughness and safety matter more than splitting every possible file.

---

## Phase 1: File Size Inventory & Prioritization

**Step 1: Measure every file**
Scan the entire source directory (excluding \`node_modules\`, \`vendor\`, \`dist\`, \`build\`, \`.git\`, test fixtures, generated files, and migration files). For each file, record:
- Path and filename
- Line count
- Primary responsibility (inferred from reading the file)
- Number of exports (functions, classes, constants, types)
- Number of files that import from it (import fan-out — high fan-out = higher risk to split)

**Step 2: Identify oversized files**
Flag every file exceeding 300 lines. Sort by line count descending.

**Step 3: Classify each oversized file**

- **Clear multi-responsibility** (SPLIT): File contains 2+ distinct logical groupings that don't heavily cross-reference each other. Example: a file with utility functions, API handlers, and type definitions mixed together.
- **Single responsibility, just long** (MAYBE SPLIT): File does one thing but it's large — a big React component with subcomponents inline, a long service class, a comprehensive validation module. May benefit from extracting helpers/subcomponents.
- **Inherently monolithic** (DO NOT SPLIT): Generated files, large config objects, migration files, single complex algorithms, test files with many cases for one unit. Splitting would hurt readability. Document why and skip.
- **High fan-out risk** (SPLIT WITH CAUTION): Many files import from this one. Splitting it means updating many import sites. Extra verification needed.

**Step 4: Create a split plan**
Produce a prioritized list:
1. Clear multi-responsibility files with LOW fan-out (safest, highest value)
2. Clear multi-responsibility files with HIGH fan-out (high value but riskier)
3. Single responsibility files that would benefit from helper extraction
4. Skip inherently monolithic files — document reasoning

For each file in the plan, outline the proposed split BEFORE making any changes:
- Original file path and line count
- Proposed new files with names and responsibilities
- Which exports move where
- Estimated import update count (how many other files reference this one)
- Risk assessment: low / medium / high

---

## Phase 2: Pre-Split Safety Checks

Before splitting ANY file, run these checks:

**Step 1: Map all references**
For the file you're about to split, find EVERY reference:
- Static imports/requires (\`import { x } from './file'\`, \`const x = require('./file')\`)
- Dynamic imports (\`import('./file')\`, \`require.resolve('./file')\`)
- Re-exports from barrel/index files (\`export { x } from './file'\`)
- Build tool references (webpack aliases, tsconfig paths, jest moduleNameMapper, babel module resolver)
- String-based references (route configs, lazy loading paths, test mocks with \`jest.mock('./file')\`)
- Documentation and comments referencing the file path
- CI/CD configs, Dockerfiles, or scripts referencing the file
- Package.json \`main\`, \`exports\`, or \`bin\` fields

**Step 2: Check for circular dependency risk**
Before splitting, trace the dependency graph for the target file:
- What does it import?
- What imports it?
- Would any proposed new module need to import from another proposed new module created from the same original file? If yes — reconsider the split boundaries.

**Step 3: Check for barrel file / index re-export patterns**
If the project uses barrel files (\`index.ts\` that re-exports from submodules):
- Plan to update the barrel file to re-export from the new locations
- This preserves backward compatibility for external consumers
- Internal imports should be updated to import directly from the new files (not through barrels) for clarity

---

## Phase 3: Execute Splits

For each file in the plan (one at a time, in priority order):

**Step 1: Create the new files**
- Name files by their responsibility: \`user-validation.ts\`, \`order-utils.ts\`, \`payment-types.ts\` — not \`file2.ts\` or \`helpers.ts\`
- Match existing project naming conventions (kebab-case, camelCase, PascalCase — whatever the codebase uses)
- Place new files in the same directory as the original, unless a subdirectory makes more structural sense AND the project already uses that pattern
- Move related code together: if a function and its helper are tightly coupled, they go in the same new file
- Keep the original file as a "home" for whatever doesn't have a better place — don't force everything out

**Step 2: Move exports to new files**
- Cut functions/classes/constants/types from the original file
- Paste into the appropriate new file
- Add necessary imports to the new file (dependencies the moved code needs)
- Update the original file to import from the new files if it still references the moved code
- If barrel files exist, update them to re-export from new locations

**Step 3: Update all import references**
- Update every file that imported the moved exports from the original file
- Verify: search the entire codebase for the original file's path to catch string-based references
- Check test files — especially \`jest.mock()\`, \`vi.mock()\`, or equivalent calls that reference file paths
- Check for \`__mocks__\` directories that mirror the original file structure

**Step 4: Verify**
- Run the full build/compile step
- Run the full test suite
- If ANYTHING fails: revert the entire split, document what went wrong, move to the next file
- If everything passes: commit with a clear message listing the original file and all new files created

**Step 5: Verify import cleanliness**
After a successful split, quickly check:
- No circular imports introduced (the build step usually catches this, but verify)
- No duplicate imports (importing the same thing from both the old and new location)
- The original file doesn't import from new files that import back from it

---

## Phase 4: Structural Improvements (Conservative)

After all planned splits are complete, look for broader structural improvements — but ONLY document these, do not implement:

**Directory structure opportunities**
- Are related files scattered across the project that should be co-located?
- Are there directories with 20+ files that would benefit from subdirectories?
- Does the project structure match the architectural pattern? (Feature-based vs. layer-based)

**Barrel file assessment**
- Are barrel files helping or hurting? (They help external consumers but can mask circular deps and hurt tree-shaking)
- Are there missing barrel files where they'd improve import ergonomics?

**Shared module opportunities**
- Did the splits reveal shared utilities that multiple new modules depend on? Would a \`shared/\` or \`common/\` module make sense?

---

## Phase 5: Post-Split Validation

After ALL splits are done:

**Step 1: Full verification**
- Run the complete test suite one final time
- Run the build one final time
- If the project has a linter, run it (new files may need lint fixes for import ordering, etc.)

**Step 2: Metrics**
- Count total files before and after
- Largest file before and after
- Average file size before and after
- Distribution: how many files are now in 0-100, 100-200, 200-300, 300-500, 500+ line buckets

**Step 3: Remaining oversized files**
For files that are still over 500 lines after this pass, document:
- Why they weren't split (inherently monolithic, too risky, failed and reverted)
- Whether a future pass with more context could address them

---

## Output

Create \`audit-reports/\` in project root if needed. Save as \`audit-reports/FILE_DECOMPOSITION_REPORT_[run-number]_[date].md\`, incrementing run number based on existing reports.

### Report Structure

1. **Executive Summary** — Files analyzed, files split, files skipped (and why), total line reduction in largest files, all tests passing.

2. **File Size Inventory** — Before/after table for every file over 300 lines:
   | File | Before (lines) | After (lines) | Action | New Files Created |

3. **Splits Executed** — For each split:
   - Original file, line count, number of exports
   - New files created with line counts and responsibilities
   - Import references updated (count)
   - Test/build status after split
   - Commit hash

4. **Splits Attempted but Reverted** — For each failed split:
   - What was attempted
   - What broke (test failure, build failure, circular dep)
   - Why it couldn't be resolved safely overnight

5. **Files Skipped** — For each oversized file not split:
   - Why (inherently monolithic, too risky, time constraints)
   - Whether it could be addressed in a future pass

6. **Structural Observations (Documentation Only)**
   - Directory structure recommendations
   - Barrel file assessment
   - Shared module opportunities

7. **File Size Distribution** — Before/after histogram:
   | Range | Before | After |
   | 0-100 lines | X | Y |
   | 100-200 | X | Y |
   | 200-300 | X | Y |
   | 300-500 | X | Y |
   | 500+ | X | Y |

8. **Recommendations** — Priority-ordered next steps, files needing manual review for further decomposition, naming/structure conventions to adopt going forward.

## Rules
- Branch: \`file-decomposition-[date]\`
- ONE FILE AT A TIME. Split, update, test, commit. Then next file.
- Run FULL test suite AND build after every split. Not just related tests.
- If tests or build fail, revert the entire split immediately. Do not debug.
- DO NOT rename anything. Only move code between files and update import paths.
- DO NOT change function signatures, behavior, or exports.
- DO NOT split files under 300 lines.
- DO NOT split generated files, migration files, or config files.
- DO NOT split test files (they're supposed to be comprehensive for their unit).
- DO NOT create deeply nested directory structures that don't already exist in the project.
- DO NOT introduce new patterns (if the project doesn't use barrel files, don't add them).
- Preserve git blame where possible — move code in the commit, don't rewrite it.
- When in doubt about a split boundary, keep things together. Over-splitting is worse than under-splitting.
- Check for dynamic imports, string-based references, and build tool configs BEFORE splitting.
- You have all night. Prioritize safe, clean splits over quantity.

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

---

**Formatting rules for chat output:**
- Use markdown headers, bold for severity labels, and bullet points for scannability.
- Do not duplicate the full report contents — just the highlights and recommendations.
- If you made zero findings in a phase, say so in one line rather than omitting it silently.`,
  },
  {
    number: 10,
    name: "Code Elegance",
    prompt: `# Code Elegance & Abstraction Refinement

You are running an overnight code elegance and abstraction refinement pass. Your job: make the codebase something a senior developer would be proud to open. Untangle spaghetti, put logic in the right layers, simplify the convoluted, and make the code read like well-written prose — all without changing a single behavior.

This is the highest-risk overnight run. Every change must preserve exact behavior. Move slowly. Verify obsessively. When in doubt, don't touch it.

Work on branch \`code-elegance-[date]\`.

---

## Global Rules

- **Behavior preservation is sacred.** Every refactor must produce identical inputs → identical outputs, identical side effects, identical error behavior. "It works the same but better" is the only acceptable outcome.
- Run the FULL test suite after every refactor. Not just related tests.
- Run the build after every refactor.
- If tests or build fail, revert the ENTIRE change immediately. Do not debug — document what you attempted and move on.
- **One refactor at a time.** Refactor, test, commit. Then next refactor. Never batch multiple refactors into one commit.
- Commit format: \`refactor: [what you improved] in [file/module]\`
- DO NOT refactor files with less than 60% test coverage unless you write characterization tests first (Phase 1).
- DO NOT refactor code you don't fully understand. If you can't explain what every line does and why, document it as "needs team review" and skip it.
- DO NOT rename public API endpoints, exported function signatures, database columns, or environment variables. Internal names are fair game.
- DO NOT change error messages, log messages, or user-facing strings. Those are behavior.
- You have all night. Quality of each refactor matters infinitely more than quantity.

---

## Phase 1: Characterization Testing (Safety Net First)

Before refactoring anything, you need confidence that existing behavior is captured by tests. This phase builds that safety net for the code you're about to touch.

**Step 1: Identify refactoring candidates (quick scan)**
Do a fast pass through the codebase to identify the ~10-20 files/modules most in need of elegance work (you'll refine this list in Phase 2). Look for:
- Functions over 50 lines
- Deeply nested conditionals (3+ levels)
- Functions with 5+ parameters
- God classes/modules that do everything
- Logic that's clearly in the wrong layer (DB queries in route handlers, business rules in UI components, formatting in data models)
- Copy-paste code with slight variations
- Overly clever code that requires mental gymnastics to follow
- Long chains of if/else or switch statements that could be data-driven
- Callback hell or deeply nested promise chains
- Functions that mix multiple levels of abstraction (high-level orchestration interleaved with low-level details)

**Step 2: Assess test coverage for each candidate**
For each candidate file/module:
- What tests exist? What do they cover?
- Run coverage if tooling exists — what percentage of the code you want to refactor is exercised?
- Are the tests testing behavior (inputs → outputs, side effects) or implementation details?

**Step 3: Write characterization tests where needed**
For any refactoring candidate with less than 60% coverage on the code you plan to change:

- **Characterization tests capture current behavior, not intended behavior.** If the code has a bug, the characterization test should assert the buggy behavior. You're creating a snapshot of "what it does right now" so you'll know if your refactor changes anything.
- For pure functions: test with a variety of inputs including edge cases. Assert exact outputs.
- For functions with side effects: mock dependencies, assert the exact sequence of calls with exact arguments.
- For stateful code: test state transitions with exact before/after snapshots.
- For error paths: trigger every error condition and assert the exact error type, message, and any side effects.
- Name these tests clearly: \`describe('[function] — characterization tests (pre-refactor)')\`
- Commit: \`test: add characterization tests for [module] before refactoring\`

**DO NOT proceed to Phase 2 for any module until you're confident its behavior is captured by tests.**

---

## Phase 2: Code Audit & Refactoring Plan

Now do a thorough analysis. For each file/module in the codebase, evaluate against these code quality dimensions:

### Dimension 1: Single Responsibility
- Does this function/class/module do ONE thing?
- Can you describe what it does in one sentence without using "and"?
- If a function is named \`processOrder\`, does it ONLY process the order, or does it also send emails, update analytics, and log audit trails?

### Dimension 2: Right Level of Abstraction
- Is high-level orchestration mixed with low-level details? A function that coordinates a workflow should call well-named subfunctions — not contain raw SQL, string parsing, and HTTP calls inline.
- Is the code at a consistent level of abstraction within each function? (Not mixing "createUser" with "buffer.toString('base64')" in the same block)
- Are things in the right architectural layer?
  - Route handlers should: validate input, call service layer, format response. Nothing else.
  - Service layer should: orchestrate business logic, coordinate between data sources. No HTTP concepts, no response formatting.
  - Data layer should: query and persist data. No business rules, no formatting.
  - UI components should: render and handle user interaction. No direct API calls, no business logic.

### Dimension 3: Readability & Clarity
- Can a new developer understand this code without tribal knowledge?
- Are variable/function names descriptive and accurate? (\`data\` → \`unprocessedOrders\`, \`temp\` → \`formattedAddress\`, \`flag\` → \`isEligibleForDiscount\`)
- Are there magic numbers or strings that should be named constants?
- Is control flow straightforward, or does it require a flowchart to follow?
- Are there unnecessary intermediate variables, or conversely, overly long expressions that should be broken up?
- Are comments explaining "what" (the code should speak for itself) instead of "why" (which is valuable)?

### Dimension 4: Simplicity
- Is there a simpler way to achieve the same result?
- Are there unnecessary abstractions? (A factory that only creates one type, an interface with one implementation, a wrapper that adds nothing)
- Are there over-engineered patterns? (Strategy pattern for two cases, observer pattern for one subscriber, dependency injection for something with no tests and no alternate implementations)
- Conversely, are there missing abstractions? (The same 5-line pattern repeated 12 times that should be a function)

### Dimension 5: Function Design
- Do functions have reasonable parameter counts? (>3 is a smell; >5 is almost always wrong)
- Could long parameter lists be replaced with an options/config object?
- Are there boolean "flag" parameters that make the function do two different things? (Split into two functions)
- Do functions have a single return type, or do they sometimes return a string, sometimes null, sometimes undefined, sometimes an object?
- Are functions a reasonable length? (>30 lines = usually doing too much)

### Create the refactoring plan

For each issue found, document:
- **File and location**
- **What's wrong** (which dimension, specific description)
- **Proposed refactor** (exactly what you plan to do)
- **Risk level**: Low (rename, extract function, simplify conditional) / Medium (restructure module, change abstraction layer) / High (redesign data flow, split god class)
- **Test coverage**: Adequate / Needs characterization tests first

**Priority order for execution:**
1. Low-risk, high-readability-impact (quick wins that make the code dramatically clearer)
2. Medium-risk, high-impact (abstraction fixes, layer corrections)
3. Low-risk, medium-impact (naming, simplification, constant extraction)
4. High-risk items — document only, do not implement overnight

---

## Phase 3: Execute Refactors

Work through your plan in priority order. For each refactor:

### Before touching code:
- Re-read the function/module completely
- Verify you understand every code path, including error paths
- Verify test coverage is adequate (if not, go back to Phase 1)
- State to yourself: "This refactor changes the structure but not the behavior because: [reason]"

### Refactoring Techniques (use as appropriate):

**Extract Function** — The workhorse refactor. When a block of code inside a function does a distinct sub-task:
- Give it a descriptive name that says what it does, not how
- Pass only what it needs as parameters
- Return only what the caller needs
- The calling function should now read like a high-level summary

**Extract Constant / Config** — Replace magic numbers and strings:
- \`if (retries > 3)\` → \`if (retries > MAX_RETRY_ATTEMPTS)\`
- \`role === 'admin'\` → \`role === ROLES.ADMIN\` (if roles are used in multiple places)
- Group related constants in a well-named object or enum

**Simplify Conditionals:**
- Replace nested if/else with early returns (guard clauses)
- Replace long if/else chains with lookup objects/maps when mapping input → output
- Replace boolean flag parameters with separate, well-named functions
- Replace complex boolean expressions with descriptively named variables: \`const isEligible = age >= 18 && hasVerifiedEmail && !isBanned;\`
- Invert negative conditions for readability: \`if (!isNotReady)\` → \`if (isReady)\`

**Flatten Nesting:**
- Replace \`if (condition) { ...lots of code... }\` with \`if (!condition) return;\` followed by the code at the top level
- Replace nested callbacks with async/await
- Replace nested loops with helper functions or appropriate array methods

**Improve Naming:**
- Variables should describe what they hold, not their type: \`userList\` → \`activeUsers\`, \`str\` → \`serializedPayload\`
- Functions should describe what they do as a verb phrase: \`process()\` → \`calculateShippingCost()\`, \`handle()\` → \`routeIncomingWebhook()\`
- Booleans should read as questions: \`valid\` → \`isValid\`, \`enabled\` → \`isFeatureEnabled\`, \`check\` → \`hasPermission\`
- Match the domain language. If the team says "workspace" not "organization," use "workspace" in code.

**Fix Abstraction Layers:**
- Move database queries out of route handlers into a data/repository layer
- Move business rules out of UI components into a service/logic layer
- Move HTTP/response formatting out of business logic into the controller/handler layer
- Move validation to the input boundary (where data enters the system)
- Each layer should only know about the layer directly below it

**Simplify Over-Engineering:**
- If a class has one method, it should probably be a function
- If a factory creates one type, it should probably be a constructor call
- If an abstraction has one implementation and no tests use an alternate, it may not need to be an abstraction
- If a config option has never been changed from its default, it might just be a constant
- Remove dead abstractions — interfaces nobody implements, base classes with one child, strategies with one strategy

**Replace Imperative with Declarative (where clearer):**
- \`for\` loops building arrays → \`map\`, \`filter\`, \`reduce\` (but only when it's actually clearer — don't force it)
- Manual object construction from another object → spread/destructuring
- Repeated conditional checks → lookup tables/maps
- **Don't over-do this.** A simple \`for\` loop is sometimes more readable than a clever reduce chain. Readability wins over cleverness every time.

### After each refactor:
1. Run the full test suite
2. Run the build
3. Manually verify: does this code do the exact same thing as before? Trace through mentally.
4. If everything passes: commit with a clear message explaining what was improved and why
5. If anything fails: revert immediately, document what went wrong, move to next item

---

## Phase 4: Structural Improvements (Conservative)

After individual refactors are complete, look for broader structural improvements. **Only implement low-risk structural changes. Document the rest.**

### Safe to implement:
- Moving a helper function from a file where it doesn't belong to one where it does (update all imports, test, commit)
- Grouping related functions that are scattered across a file into a logical order
- Adding section comments to long files that organize code into logical groups
- Creating a shared utility function from duplicated logic (only if the duplication is exact or near-exact)

### Document only — do not implement:
- Splitting god modules into focused sub-modules (use the File Decomposition prompt for this)
- Introducing new architectural patterns (repository pattern, service layer, etc.)
- Changing the project's directory structure
- Creating new abstraction layers that don't currently exist

---

## Phase 5: Code Quality Assessment

After all refactors are complete, do a final assessment:

**Step 1: Before/after comparison**
For each file you touched, compare:
- Line count before and after
- Deepest nesting level before and after
- Longest function before and after
- Number of parameters on the most complex function before and after
- Subjective readability score (1-5) before and after

**Step 2: Remaining issues**
What couldn't you fix, and why?
- Too risky for overnight
- Insufficient test coverage
- Requires team input on intended design
- Requires broader architectural changes

**Step 3: Patterns observed**
What recurring anti-patterns did you see? These inform team conventions:
- "Business logic is frequently found in route handlers — the team should adopt a service layer pattern"
- "Functions regularly mix abstraction levels — consider a team convention of extract-function for anything below the main function's abstraction level"
- "Magic numbers are pervasive — consider a project-wide constants file or enum convention"

---

## Output

Create \`audit-reports/\` in project root if needed. Save as \`audit-reports/CODE_ELEGANCE_REPORT_[run-number]_[date].md\`, incrementing run number based on existing reports.

### Report Structure

1. **Executive Summary** — Files analyzed, refactors executed, refactors reverted, tests still passing, overall assessment of code quality improvement.

2. **Characterization Tests Written** — Table: | File/Module | Tests Added | Coverage Before | Coverage After | Purpose |. These tests have value beyond this refactoring pass — they document current behavior.

3. **Refactors Executed** — For each refactor:
   | File | What Changed | Technique Used | Risk Level | Before (metrics) | After (metrics) |
   
   Plus a brief description of what was improved and why for non-obvious changes.

4. **Refactors Attempted but Reverted** — What you tried, what broke, and your assessment of why.

5. **Refactors Identified but Not Attempted** — The backlog. For each:
   | File | Issue | Proposed Refactor | Risk Level | Why Not Attempted | Priority for Next Run |

6. **Code Quality Metrics** — Before/after summary:
   - Longest function (lines): before → after
   - Deepest nesting level: before → after  
   - Largest parameter count: before → after
   - Functions over 50 lines: before → after
   - Files with mixed abstraction layers: before → after

7. **Anti-Pattern Inventory** — Recurring patterns the team should address as conventions:
   | Pattern | Frequency | Where It Appears | Recommended Convention |

8. **Abstraction Layer Assessment** — Current state of architectural layering:
   - Which layers exist and are respected?
   - Which layers are violated and where?
   - Recommended layer boundaries for this project

9. **Recommendations** — Priority-ordered next steps:
   - Refactors to attempt in the next run (from the backlog)
   - Conventions to adopt to prevent new code from regressing
   - Architectural improvements that would benefit the codebase
   - Areas needing team discussion before refactoring

## Rules
- Branch: \`code-elegance-[date]\`
- ONE REFACTOR AT A TIME. Refactor, test, commit. Then next.
- Run FULL test suite AND build after every refactor.
- If tests or build fail, revert the entire change immediately. Do not debug.
- DO NOT refactor code with insufficient test coverage — write characterization tests first.
- DO NOT change behavior. Not even "slightly better" behavior. Behavior changes are a separate task.
- DO NOT change public APIs, exported interfaces, database schemas, or environment variables.
- DO NOT introduce new libraries or dependencies.
- DO NOT refactor test files (they serve a different purpose).
- DO NOT over-abstract. Removing unnecessary abstraction is just as valid as adding necessary abstraction. The goal is the RIGHT level of abstraction, not MORE abstraction.
- Readability beats cleverness. Always. If the "elegant" version is harder to understand, keep the simple version.
- Prefer small, obvious improvements over ambitious restructuring. Ten small refactors that each clearly improve one thing are worth more than one large refactor that tries to fix everything.
- If you're unsure whether a refactor preserves behavior, it's too risky. Document it and move on.
- You have all night. Take your time. Every refactor should make a developer smile when they read the diff.

## Chat Output Requirement

In addition to writing the full report file, you MUST print a summary directly in the conversation when you finish. Do not make the user open the report to get the highlights. The chat summary should include:

### 1. Status Line
One sentence: what you did, how long it took, and whether all tests still pass.

### 2. Key Findings
The most important things discovered — anti-patterns, structural issues, code quality wins, or surprises. Each bullet should be specific and actionable, not vague. Lead with impact.

**Good:** "The \`OrderService\` class (847 lines) handles order creation, payment processing, email sending, inventory management, and analytics — splitting this into focused services would dramatically improve maintainability."
**Bad:** "Found some long files."

### 3. Changes Made
Bullet list of what was refactored, with before/after metrics where meaningful.

### 4. Recommendations

If there are legitimately beneficial recommendations worth pursuing right now, present them in a table. Do **not** force recommendations — if the audit surfaced no actionable improvements, simply state that no recommendations are warranted at this time and move on.

When recommendations exist, use this table format:

| # | Recommendation | Impact | Risk if Ignored | Worth Doing? | Details |
|---|---|---|---|---|---|
| *Sequential number* | *Short description (≤10 words)* | *What improves if addressed* | *Low / Medium / High / Critical* | *Yes / Probably / Only if time allows* | *1–3 sentences explaining the reasoning, context, or implementation guidance* |

Order rows by risk descending (Critical → High → Medium → Low). Be honest in the "Worth Doing?" column — not everything flagged is worth the engineering time. If a recommendation is marginal, say so.

### 5. Report Location
State the full path to the detailed report file for deeper review.

---

**Formatting rules for chat output:**
- Use markdown headers, bold for severity labels, and bullet points for scannability.
- Do not duplicate the full report contents — just the highlights and recommendations.
- If you made zero findings in a phase, say so in one line rather than omitting it silently.`,
  },
  {
    number: 11,
    name: "Architectural Complexity",
    prompt: `# Architectural Complexity Audit

You are running an overnight architectural complexity audit. Your job: find where the system is more complex than it needs to be — unnecessary indirection, over-abstracted boundaries, convoluted data flows, and astronaut architecture — and produce a prioritized simplification roadmap the team can act on.

This is a READ-ONLY analysis. Do not create a branch or modify any code. Architectural simplification requires human judgment about tradeoffs — your job is to surface the complexity, quantify it, and propose specific simplifications with clear risk assessments.

---

## Why This Exists

Code Elegance handles function-level complexity: long functions, deep nesting, bad names, mixed abstraction levels within a file. This prompt handles **system-level complexity**: the kind that makes a new developer ask "why does a button click go through 7 files before it reaches the database?" The kind where every feature takes 3x longer to build because you're fighting the architecture instead of using it.

Unnecessary complexity is a silent tax. It doesn't show up in bug reports or crash logs. It shows up in slower velocity, harder onboarding, more bugs per feature, and engineers quietly dreading certain parts of the codebase.

---

## Global Rules

- This is READ-ONLY. Do not modify any code or create branches.
- Be honest about the difference between **unnecessary complexity** (should be simplified) and **essential complexity** (the problem is genuinely hard). Not every abstraction is over-engineering. Some systems are complex because they need to be.
- When recommending simplification, always state: what you'd remove, what replaces it (or nothing), what capability would be lost (if any), and what would break during the transition.
- Ground every finding in specifics — file paths, call chains, data flow traces. Not "the auth system is over-engineered" but "a login request passes through 6 files (AuthController → AuthService → AuthProvider → TokenManager → SessionFactory → UserRepository) when AuthController → AuthService → UserRepository would preserve all current behavior."
- Distinguish between complexity that's hurting the team NOW vs. complexity that was built for future needs that MAY arrive. The latter deserves a lighter touch — flag it, but acknowledge the team may have context you don't.
- You have all night. Be thorough.

---

## Phase 1: Structural Complexity Mapping

### Step 1: Dependency graph analysis

Map the import/dependency graph of the entire codebase. Identify:

- **Hub modules**: Files imported by 20+ other files. Are they genuine shared utilities, or have they become junk drawers?
- **Deep dependency chains**: Trace the longest import chains from entry point to leaf module. How many layers does a request pass through? How many are doing meaningful work vs. just forwarding?
- **Circular dependencies**: Files or modules that import each other, directly or transitively. These almost always indicate confused boundaries.
- **Orphaned modules**: Files that import from the rest of the codebase but nothing imports them (except possibly tests). Are they dead, or are they entry points?

### Step 2: Layer count analysis

For each major operation in the system (the core 5-10 user actions), trace the full call path from entry point to data store and back. For each layer traversed, note:

- File and function name
- What meaningful work this layer does (validation? transformation? orchestration? logging? nothing?)
- Whether removing this layer would change behavior

**What you're looking for**: layers that exist for "architectural purity" but don't do meaningful work. A controller that calls a service that calls a repository is fine if each layer has a distinct job. A controller that calls a service that calls a manager that calls a provider that calls a repository — where three of those layers just forward the call — is not.

### Step 3: Abstraction inventory

Catalog every abstraction mechanism in the codebase:

- **Interfaces/abstract classes with one implementation**: These add indirection without flexibility. Flag every one. Note whether tests use an alternate implementation (if yes, the abstraction earns its keep).
- **Factories that create one type**: A factory that returns \`new Thing()\` is a function call wearing a hat.
- **Strategy/plugin patterns with one strategy**: The cost of the pattern isn't justified by one case.
- **Event/observer systems**: Map every event emitter and every listener. Are events crossing module boundaries (useful) or being used within a single module as a roundabout function call (unnecessary)?
- **Dependency injection containers**: Is DI used for testability (good) or because "that's how you do it" even where there's nothing to inject and no tests? Map what's injected and whether alternate implementations exist.
- **Generic/parameterized types with one instantiation**: Generics that are only ever used with one concrete type add cognitive overhead for no flexibility.
- **Wrapper/adapter classes that don't adapt anything**: Classes that wrap a library with an identical API "in case we switch libraries."
- **Configuration for things that never change**: Options, settings, and parameters that have had the same value since they were introduced.

For each: name it, location, what it abstracts, how many concrete implementations/usages exist, whether removing it would require changing behavior.

### Step 4: Directory structure vs. actual architecture

- Does the directory structure reflect how the code actually works, or has it drifted?
- Are related files co-located, or scattered across directories by technical type (all controllers in \`/controllers\`, all services in \`/services\`) when they'd be better grouped by feature?
- Are there directories that have become catch-alls (\`/utils\`, \`/helpers\`, \`/common\`, \`/shared\`) with 30+ files that have nothing to do with each other?
- Does the nesting depth of directories match the actual depth of the architecture, or are there 4 levels of folders containing one file each?

---

## Phase 2: Data Flow Complexity

### Step 1: Trace data transformations

For the core data types in the system (users, orders, whatever the domain objects are), trace every transformation from input to storage and from storage to output:

- How many times is the data reshaped between API input and database write? (Request DTO → domain model → ORM model → database, for example)
- How many of those transformations are doing meaningful work (validation, business rules, format conversion) vs. just copying fields between nearly identical shapes?
- Is the same data serialized and deserialized multiple times unnecessarily?
- Are there mapping layers that exist only because two adjacent layers chose different field names for the same thing?

### Step 2: State management complexity

- How many sources of truth exist for key data? (Database, cache, local state, derived state, global store, URL params — how many of these hold the same information?)
- Where is state duplicated and kept in sync manually? (This is where bugs live.)
- Is global state used where local state would suffice? (A global store holding form input that's only used in one component.)
- Are there derived values stored and manually kept in sync instead of computed on demand?
- Is there a state management library/pattern that's more powerful than what the application needs? (Redux for an app with 3 pages and no shared state.)

### Step 3: Configuration complexity

- How many configuration layers exist? (Env vars → config files → runtime config → feature flags → database-driven settings → hardcoded defaults scattered through the code)
- Can you determine what configuration a running instance is actually using without reading 5 files?
- Are there configurations that override other configurations that override other configurations?
- Is the same setting configurable in multiple places with unclear precedence?

---

## Phase 3: Pattern Complexity

### Step 1: Premature generalization

Find code built for flexibility that was never used:

- Multi-tenant infrastructure in a single-tenant app
- Plugin systems with no plugins
- Configurable pipelines with one pipeline
- Abstract base classes designed for "future" subclasses that never arrived
- Schema versioning for schemas that have never changed
- Internationalization infrastructure wrapping hardcoded English strings
- Multi-provider abstractions wrapping a single provider (one payment processor behind a "payment provider" interface, one email service behind an "email provider" interface)

For each: when was it introduced (git history)? Has the generalization EVER been used? What's the ongoing maintenance cost?

### Step 2: Unnecessary indirection patterns

- **Event buses used as function calls**: Module A emits an event that only Module B listens to, and Module A needs to wait for the result. This is a function call with extra steps and lost type safety.
- **Message queues for synchronous work**: Jobs that are enqueued and then immediately awaited, gaining no benefit from async processing.
- **HTTP calls between co-located services**: Services that could be function calls but communicate over the network because "they might be separate services someday."
- **Database as a message broker**: Polling tables for state changes instead of direct communication.
- **Over-normalized data**: Joins across 6 tables to answer a question that could be a single read if the data were structured differently.
- **Over-denormalized data**: The same information stored in 4 places, manually kept in sync, leading to inconsistency bugs.

### Step 3: Cargo-culted patterns

Patterns adopted because they're "best practice" without the context that makes them valuable:

- **CQRS without a read/write asymmetry problem**: Separate read and write models doubling the code for a system where reads and writes are similar.
- **Domain-Driven Design ceremony in a CRUD app**: Aggregates, value objects, domain events, and bounded contexts for an app that reads from a database and shows it on a screen.
- **Microservice patterns in a monolith**: Service discovery, circuit breakers, and API gateways between modules that run in the same process.
- **Repository pattern wrapping an ORM**: A repository that exposes \`findById\`, \`findAll\`, \`save\`, \`delete\` — the exact same interface the ORM already provides, adding a layer that contributes nothing.
- **Clean Architecture / Hexagonal Architecture over-applied**: Ports, adapters, use cases, and domain layers for a 10-endpoint CRUD API where every "use case" is a one-line call to the repository.

For each: what pattern, where it's applied, what problem it's solving (if any), and what the simpler alternative looks like.

### Step 4: Accidental complexity from organic growth

- Features bolted on that don't fit the original architecture, requiring workarounds
- Multiple approaches to the same problem coexisting (old way and new way, both maintained)
- Temporary solutions that became permanent (the \`// temporary\` comment from 2 years ago)
- Code that routes around the official architecture because the architecture made the task too hard

---

## Phase 4: Complexity Quantification

### Step 1: Indirection score per operation

For each of the core 5-10 user operations, calculate:

- **Files touched**: How many files does a request pass through?
- **Meaningful layers**: How many of those files do meaningful work?
- **Indirection ratio**: files touched ÷ meaningful layers. An indirection ratio of 1.0 is perfect (every file earns its place). Above 2.0 is a yellow flag. Above 3.0 is a red flag.
- **Lines of glue code**: Lines that exist only to connect layers (forwarding calls, mapping identical fields, re-exporting).

### Step 2: Abstraction overhead inventory

Total count of:
- Interfaces with one implementation
- Factories creating one type
- Wrapper classes that don't transform behavior
- Generic types instantiated with one concrete type
- Event emissions with one listener
- Configuration options that have never varied

Multiply each by estimated lines of code. This is the **abstraction tax** — code that exists for flexibility that was never used.

### Step 3: Onboarding complexity estimate

For a new developer to understand enough to make a change in each major area:
- How many files must they read?
- How many layers must they understand?
- How many patterns must they recognize?
- How many "you just have to know" conventions exist that aren't enforced by the code?

Rate each area: **Simple** (read 1-3 files, obvious flow), **Moderate** (5-10 files, patterns to learn), **Complex** (10+ files, significant tribal knowledge), **Labyrinthine** (requires a guide, multiple failed attempts expected).

---

## Phase 5: Simplification Roadmap

### Step 1: Categorize every finding

- **Remove**: Abstraction that adds nothing and can be deleted. (Interface with one implementation where no tests use a mock → inline the implementation, delete the interface.)
- **Collapse**: Multiple layers that can become fewer. (Controller → Service → Manager → Repository where Service and Manager do nothing → Controller → Service → Repository.)
- **Replace**: Complex pattern that can be swapped for a simpler one. (Event bus between two modules → direct function call.)
- **Restructure**: Architectural change that would simplify multiple things at once. (Move from technical-layer directories to feature-based directories.)
- **Accept**: Complexity that's justified by the problem domain or a real future need. Explicitly call these out so the team doesn't waste time re-evaluating them.

### Step 2: Risk and effort assessment

For each non-Accept finding:
- **Effort**: Trivial (< 1 hour) / Small (< 1 day) / Medium (< 1 week) / Large (1+ weeks)
- **Risk**: Low (mechanical, type-safe refactor) / Medium (behavioral edge cases possible) / High (cross-cutting, affects many features)
- **Impact**: How much simpler does the codebase get? (Lines removed, layers eliminated, onboarding time reduced)
- **Dependencies**: Does this simplification depend on another simplification happening first?
- **Test coverage**: Is the area well-tested enough to refactor safely?

### Step 3: Prioritized simplification plan

Order by: (Impact × Confidence) ÷ (Effort × Risk)

Group into:
- **This week**: Trivial removals with high confidence and good test coverage. Can be done in the next Code Elegance run.
- **This month**: Small-to-medium simplifications that need planning but not architectural discussion.
- **This quarter**: Larger restructuring that needs team alignment and incremental execution.
- **Backlog**: Good ideas that aren't worth doing until something else forces the issue.

---

## Output

Create \`audit-reports/\` in project root if needed. Save as \`audit-reports/ARCHITECTURAL_COMPLEXITY_REPORT_[run-number]_[date].md\`, incrementing run number based on existing reports.

### Report Structure

1. **Executive Summary** — Overall complexity assessment (lean / reasonable / heavy / over-engineered), the single biggest complexity tax the codebase is paying, top 3 simplification opportunities with estimated impact.

2. **Structural Complexity Map**
   - Dependency graph summary: hub modules, deepest chains, circular dependencies
   - Layer analysis per operation: | Operation | Files Touched | Meaningful Layers | Indirection Ratio | Glue Code Lines |
   - Abstraction inventory: | Abstraction | Type | Location | Implementations | Justification | Verdict |
   - Directory structure assessment

3. **Data Flow Complexity**
   - Transformation chains per core data type: diagram or table showing each reshape and whether it does meaningful work
   - State management assessment: sources of truth, duplication, global vs. local
   - Configuration layer map

4. **Pattern Complexity**
   - Premature generalizations: | Pattern | Location | Introduced | Ever Used? | Maintenance Cost | Recommendation |
   - Unnecessary indirection: | Pattern | Location | Simpler Alternative | Risk of Change |
   - Cargo-culted patterns: | Pattern | Location | Problem It Solves Here | Simpler Alternative |
   - Organic growth tangles: locations where the architecture has been routed around

5. **Complexity Quantification**
   - Indirection scores per operation (table + red/yellow/green)
   - Abstraction overhead: total line count, percentage of codebase
   - Onboarding complexity per area: | Area | Files to Read | Layers | Patterns | Rating |

6. **Simplification Roadmap**
   - Full finding list: | Finding | Category (Remove/Collapse/Replace/Restructure/Accept) | Effort | Risk | Impact | Priority |
   - This week: trivial removals, feed into next Code Elegance or Codebase Cleanup run
   - This month: planned simplifications with suggested approach
   - This quarter: larger restructuring with milestones
   - Backlog: good ideas, low urgency
   - Dependency graph between simplifications (what enables what)

7. **Accepted Complexity**
   - Complexity that's justified, with explicit reasoning. This section exists so the team doesn't re-litigate these decisions.

8. **Recommendations**
   - Priority-ordered next steps
   - Which existing overnight prompts (Code Elegance, File Decomposition, Codebase Cleanup) should run next and what they should target based on these findings
   - Conventions to adopt to prevent new unnecessary complexity
   - How to evaluate "should we add this abstraction?" going forward (a decision framework)

## Rules
- READ-ONLY. Do not modify any code.
- Be specific. Every finding must include file paths, call chains, or data flow traces — not just categories.
- Distinguish essential complexity from accidental complexity. Complex domain logic is not over-engineering.
- Respect that you may lack context. The team may have plans that justify abstractions you'd flag. Frame recommendations as "based on what I can see in the codebase" and mark assumptions.
- Don't recommend simplification that would sacrifice testability. If an abstraction exists solely to enable testing, that's a valid reason to keep it — note it as such.
- Don't conflate "I'd write it differently" with "this is unnecessarily complex." The bar is: does this complexity serve a purpose that justifies its cost?
- Use git history when available to understand whether abstractions were built for growth that materialized or growth that didn't.
- You have all night. Trace every major code path. Check every abstraction.

## Chat Output Requirement

In addition to writing the full report file, you MUST print a summary directly in the conversation when you finish. Do not make the user open the report to get the highlights. The chat summary should include:

### 1. Status Line
One sentence: what you did and how long it took.

### 2. Key Findings
The most important complexity hotspots discovered. Each bullet should be specific and actionable, not vague. Lead with impact.

**Good:** "The order creation flow passes through 9 files (OrderController → OrderValidator → OrderService → OrderOrchestrator → InventoryManager → PricingEngine → PaymentProvider → OrderRepository → AuditLogger) but only 4 do meaningful work — the other 5 are pure forwarding layers. Collapsing to 4 layers would remove ~600 lines of glue code and cut onboarding time for this flow in half."
**Bad:** "Found some unnecessary abstraction layers."

### 3. Simplification Roadmap
The full prioritized list of simplification opportunities from the report, grouped by timeframe (this week / this month / this quarter / backlog). Each item should include: what to simplify, category (Remove/Collapse/Replace/Restructure), risk level, and expected impact. Do not truncate — the user should be able to act on this list without opening the report.

### 4. Accepted Complexity
Briefly list any complexity you evaluated and determined is justified, so the team doesn't re-investigate it.

### 5. Report Location
State the full path to the detailed report file for deeper review.

---

**Formatting rules for chat output:**
- Use markdown headers, bold for severity labels, and bullet points for scannability.
- Do not duplicate the full report contents — just the highlights and top recommendations.
- If you made zero findings in a phase, say so in one line rather than omitting it silently.`,
  },
  {
    number: 12,
    name: "Type Safety",
    prompt: `# Type Safety & Error Handling Hardening

## Prompt

\`\`\`
You are running an overnight robustness hardening pass. You have several hours. Your job is to make the codebase more resilient by strengthening type safety and error handling. You will be modifying code — every change must keep tests passing.

Work on a branch called \`robustness-hardening-[date]\`.

## Your Mission

### Phase 1: Type Safety Audit & Improvement

**If the project uses TypeScript:**

**Step 1: Find type weakness hotspots**
- Search for every instance of \`any\` type (explicit \`any\`, implicit \`any\` from missing annotations)
- Search for type assertions (\`as\`, \`!\` non-null assertions) — each one is a place where you're telling the compiler "trust me" instead of proving correctness
- Search for \`@ts-ignore\` and \`@ts-expect-error\` comments
- Check \`tsconfig.json\` — note which strict mode options are disabled and what they'd catch if enabled
- Look for functions with no return type annotation
- Look for function parameters with no type annotation
- Find places where \`Object\`, \`Function\`, \`{}\`, or \`unknown\` are used as types

**Step 2: Fix type weaknesses, starting with highest risk**

Priority order:
1. **Public API boundaries** (function signatures exposed to other modules or external consumers) — these MUST have explicit, accurate types
2. **Data layer** (database queries, API responses, data transformations) — where runtime data enters the typed world
3. **Business logic** (core domain functions) — where incorrect types cause incorrect behavior
4. **Internal utilities** — lower risk but still worth typing correctly
5. **Test files** — lowest priority, but remove \`any\` where it's easy

For each fix:
- Replace \`any\` with the actual type. If you're not sure what the type should be, read the code that produces and consumes the value to infer it.
- Replace type assertions with proper type narrowing (type guards, conditional checks, discriminated unions)
- Remove \`@ts-ignore\` by fixing the underlying type error
- Add return type annotations to functions that are missing them
- Add parameter type annotations where missing
- Run tests after each batch of related changes
- Commit: \`chore: strengthen types in [module]\`

**Step 3: Identify structural type improvements**
Some type weaknesses require larger refactoring. Don't implement these — document them:
- Places where a discriminated union would prevent impossible states
- Places where branded types would prevent mixing up similar primitives (userId vs. orderId)
- Places where generics would replace duplicated type definitions
- Places where \`unknown\` should replace \`any\` as a safer intermediate step

**If the project uses JavaScript (no TypeScript):**
- Add JSDoc type annotations to all public functions
- Identify functions where input types are ambiguous and document what they actually accept
- Look for implicit type coercion bugs (== vs ===, string + number, truthy/falsy checks on 0 or "")
- Look for functions that sometimes return different types (string | undefined | null) without the callers handling all cases
- Document which files/modules would benefit most from TypeScript migration

**If the project uses Python:**
- Add type hints to all public functions missing them
- Run mypy or pyright if configured and fix reported issues
- Look for functions with ambiguous return types (sometimes returns None, sometimes a value)
- Check for unsafe dict access without \`.get()\` or key checks
- Look for broad \`except\` clauses that swallow type errors

### Phase 2: Error Handling Audit & Improvement

**Step 1: Find error handling problems**

Scan the entire codebase for:
- **Empty catch blocks**: \`catch (e) {}\` or \`catch (e) { // TODO }\` — errors being silently swallowed
- **Catch-and-log-only**: \`catch (e) { console.log(e) }\` with no recovery, re-throw, or user notification
- **Overly broad catches**: Catching all exceptions when only specific ones are expected
- **Missing catches entirely**: Async operations with no error handling (unhandled promise rejections, uncaught async errors)
- **Inconsistent error response formats**: API endpoints returning errors in different shapes (\`{ error: msg }\` vs \`{ message: msg }\` vs \`{ errors: [...] }\`)
- **Error information leakage**: Stack traces, internal paths, database details, or system information exposed in error responses
- **Missing error boundaries**: React error boundaries (if React), global error handlers, unhandled rejection handlers
- **String errors**: \`throw "something went wrong"\` instead of proper Error objects
- **Error swallowing in chains**: \`.catch(() => null)\` or \`.catch(() => {})\` in promise chains
- **Missing finally blocks**: Resources (connections, file handles, streams) that aren't cleaned up on error

**Step 2: Fix error handling issues**

Priority order:
1. **Silent error swallowing** — these are the most dangerous because they hide bugs
2. **Unhandled async errors** — these crash processes in production
3. **Information leakage** — security concern
4. **Inconsistent error formats** — user/developer experience
5. **Missing cleanup** — resource leaks

For each fix:
- Empty catch blocks: Either handle the error properly, re-throw it, or at minimum log it with context about WHERE and WHY
- Overly broad catches: Narrow to specific error types, re-throw unexpected errors
- Missing error handling: Add appropriate try/catch or .catch() handlers
- Inconsistent formats: Identify the dominant pattern in the codebase and align deviations to it
- String errors: Convert to proper Error objects (or custom error classes if the project has them)
- Run tests after each batch of changes
- Commit: \`fix: improve error handling in [module]\`

**Step 3: Error handling infrastructure**
Evaluate and document (don't necessarily implement):
- Does the project have custom error classes? Should it?
- Is there a global error handler? Is it comprehensive?
- Is there an error reporting/monitoring integration? Are errors actually reaching it?
- Are errors being logged with sufficient context to debug them?
- Is there a consistent pattern for operational errors (expected, like "user not found") vs programmer errors (unexpected, like null reference)?

## Output Requirements

Create the \`audit-reports/\` directory in the project root if it doesn't already exist. Save the report as \`audit-reports/TYPE_SAFETY_REPORT_[run-number]_[date].md\` (e.g., \`TYPE_SAFETY_01_2026-02-16.md\`). Increment the run number based on any existing reports with the same name prefix in that folder.

### Report Structure

1. **Summary**
   - \`any\` types removed: X
   - Type assertions replaced with proper narrowing: X
   - \`@ts-ignore\` comments removed: X
   - Return type annotations added: X
   - Empty catch blocks fixed: X
   - Unhandled async errors fixed: X
   - Error format inconsistencies fixed: X
   - Tests still passing: yes/no

2. **Type Safety Improvements Made**
   - Table: | File | Change | Risk Level | Before → After |

3. **Type Safety Improvements Recommended (Not Implemented)**
   - Structural improvements that need team discussion
   - Files/modules that need larger refactoring

4. **Error Handling Fixes Made**
   - Table: | File | Issue | Fix Applied |

5. **Error Handling Infrastructure Assessment**
   - Current state of error handling patterns
   - What's good, what's missing, what needs work

6. **Bugs Discovered**
   - Type errors or error handling gaps that revealed actual bugs
   - These are high-value findings — highlight them

7. **Recommendations**
   - Suggested tsconfig.json strict mode changes (with impact assessment)
   - Error handling patterns the team should adopt
   - Custom error classes to create

## Rules
- Branch: \`robustness-hardening-[date]\`
- Run tests after EVERY batch of changes. No exceptions.
- If tests fail, revert and document why
- DO NOT change business logic. Your job is to make existing logic more type-safe and more resilient to errors, not to change what it does.
- When replacing \`any\`, use the ACTUAL correct type — don't just replace \`any\` with \`unknown\` everywhere as a cop-out (though \`unknown\` is appropriate in some cases)
- When fixing error handling, preserve the existing error recovery intent — if a catch block returns a default value, keep that behavior but add logging
- Match existing code style and conventions
- You have all night. Be thorough. Start with the highest-risk code.
\`\`\`

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

---

**Formatting rules for chat output:**
- Use markdown headers, bold for severity labels, and bullet points for scannability.
- Do not duplicate the full report contents — just the highlights and recommendations.
- If you made zero findings in a phase, say so in one line rather than omitting it silently.`,
  },
  {
    number: 13,
    name: "Message Quality",
    prompt: `# Message Quality Audit

You are running an overnight logging and error message quality audit. Your job: ensure that when things go wrong — in production at 3am, or for a confused user — messages actually help people understand what happened and what to do.

Work on branch \`message-quality-[date]\`.

---

## Global Rules

- Run tests after every batch of changes. Never change business logic or control flow — only message content.
- Match the existing tone/voice of the product's best messages. Consistency > your preference.
- If the project uses i18n, update translation keys/files — don't hardcode strings that bypass the translation layer.
- Sensitive data in logs is a compliance emergency. Fix these FIRST regardless of phase.
- Commit messages: \`copy: improve error messages in [module]\` (user-facing) or \`logging: improve log quality in [module]\` (dev-facing).

---

## Phase 1: User-Facing Error Message Audit

### Step 1: Find every user-facing error message

Search the entire codebase: API error responses, form validation, empty states, not-found pages, permission denied, payment errors, upload errors, notifications/emails, CLI output, modals, fallback/offline states.

### Step 2: Evaluate against these criteria

- **Specific?** "Something went wrong" → useless. "We couldn't save your changes because the file exceeds the 10MB limit" → actionable.
- **Tells user what to do next?** Every error should either: (a) explain how to fix it, (b) say to retry and when, or (c) say how to get help.
- **Blame-free?** Never blame the user. "You entered an invalid date" → "Please enter a date in MM/DD/YYYY format."
- **Consistent tone?** No mixing "We're sorry" with "Error: constraint violation." Same voice, formality, and technical level throughout.
- **No leaked internals?** No DB errors, stack traces, file paths, internal field names, or raw third-party service names ("Stripe error" → "Payment processing error").
- **Accessible?** No color-only indicators, messages announced to screen readers (ARIA), plain language.

### Step 3: Fix — priority order

1. **Leaked internals** (UX + security problem)
2. **Critical-path messages** (signup, login, checkout, core workflow)
3. **Generic/unhelpful messages** on common error paths
4. **Tone/consistency** alignment
5. **Accessibility** fixes

Rewrite each to be specific, actionable, and blame-free. Improve centralized error handlers where applicable.

### Step 4: Create \`docs/ERROR_MESSAGES.md\`

Table: | Location | Trigger | Current Message | Improved Message | Status |

Group by feature. Include a **Message Style Guide** section: voice/tone conventions, structure template (\`[What happened] + [Why] + [What to do]\`), words to avoid, standard phrases for common situations.

---

## Phase 2: Developer-Facing Log Message Audit

### Step 1: Inventory all log statements

Find every \`console.log\`, \`console.error\`, \`logger.*\`, etc. Categorize by: log level, location, context provided, and whether it's on a hot path.

### Step 2: Evaluate log levels

- **ERROR/FATAL**: Unexpected failures needing human attention, data integrity risks, unhandled exceptions. NOT expected conditions (user not found, invalid input).
- **WARN**: Degraded operation, approaching limits, deprecated paths hit, recoverable unusual conditions.
- **INFO**: Significant operation completions, lifecycle events, state changes. NOT per-request noise.
- **DEBUG**: Detailed diagnostics for development only. Never enabled in production by default.

Flag: \`console.log\` used for errors, expected conditions as ERROR (alert fatigue), important events as DEBUG (invisible in prod), verbose hot-path logging at INFO.

### Step 3: Evaluate log message quality

Each log message should:

- **Answer "what happened"** with specifics — Bad: \`"Error in processOrder"\` → Good: \`"Failed to process order=\${orderId}: insufficient stock for SKU=\${sku}"\`
- **Include identifying context** — relevant IDs (user, request, resource, session)
- **Include operational context** — what the system was trying to do, what went wrong, input/trigger, system state
- **Be actionable without reading source code** — an on-call engineer at 3am should understand severity, affected user, failed operation, and likely cause
- **Avoid noise** — no logging inside hot loops (aggregate/sample instead), no redundant messages, no large object dumps, no happy-path noise
- **Avoid sensitive data** — no passwords, tokens, full card numbers, PII, API keys, session tokens, or raw user input that may contain PII

### Step 4: Fix — priority order

1. **Sensitive data in logs** (compliance emergency)
2. **Error-level logs with no context** (incident response)
3. **Misleveled logs** (alert fatigue + prod debuggability)
4. **Missing logs on critical operations**
5. **Log noise** removal/downleveling

Rewrite to include: operation, entity with IDs, what happened, relevant state. Use structured format if the project does.

### Step 5: Document infrastructure gaps (don't implement)

Note gaps in: structured logging, log correlation/request IDs, log aggregation, hot-path sampling, centralized redaction framework. Reference any existing audit reports.

---

## Phase 3: Error Handler & Error Boundary Audit

### Step 1: Find all error handlers

Map every error boundary: global middleware, per-route handlers, React error boundaries, background job handlers, WebSocket handlers, cron handlers, startup error handling.

### Step 2: Evaluate each handler

- **Differentiates error types?** Validation (400), auth (401), authz (403), not found (404), conflict (409), internal (500) — bad handlers treat everything as 500.
- **Logs fully, responds safely?** Full error + stack trace + context in logs; sanitized user-friendly message to client.
- **Includes reference ID?** Error responses should include a request/correlation ID the user can give to support.
- **Handles expected errors gracefully?** Validation failures and not-found shouldn't trigger alerts, log at ERROR, return 500, or include stack traces.

### Step 3: Fix handlers

Improve error type differentiation, add reference IDs, ensure expected errors don't pollute monitoring, ensure unexpected errors log fully but respond safely.

---

## Phase 4: Consistency & Standardization

1. **Error codes**: Does the project use machine-readable codes (\`CARD_DECLINED\`, \`EMAIL_TAKEN\`)? If yes, are they consistent and complete? If no, document the value of adding them.
2. **Log format**: Consistent field names (\`userId\` vs \`user_id\` vs \`uid\`)? Consistent timestamps? Single logging library or a mix?
3. **Standardize**: Align field names, replace raw \`console.*\` with the project logger, add missing error codes.

---

## Output

Save as \`audit-reports/LOGGING_ERROR_MESSAGE_QUALITY_REPORT_[run]_[date].md\`. Increment run number based on existing reports.

### Report Structure

1. **Executive Summary** — counts of messages audited/improved/remaining, sensitive data exposure instances, error handlers audited/improved
2. **User-Facing Error Messages** — tables for: leaked internals fixed, critical-path improvements, generic messages replaced, messages still needing work. Reference \`docs/ERROR_MESSAGES.md\`.
3. **Sensitive Data in Logs (CRITICAL)** — every instance found: | File | Line | Data Type | Fix |. State explicitly if none found.
4. **Log Level Corrections** — misleveled logs fixed: | File | Line | Was | Now | Reason |
5. **Log Message Quality Improvements** — context-poor messages improved, critical operations with logging added, noise removed
6. **Error Handler Assessment** — handler inventory: | Handler | Location | Differentiates? | Logs Properly? | Has Reference ID? | Sanitizes? |. Handlers improved with fixes applied.
7. **Consistency Findings** — error code coverage, log format assessment, standardization changes
8. **Logging Infrastructure Recommendations** — structured logging, redaction framework, correlation, conventions for new code
9. **Bugs Discovered** — cases where investigating messages revealed actual bugs (swallowed errors, incorrect status codes, hidden failures)

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

---

**Formatting rules for chat output:**
- Use markdown headers, bold for severity labels, and bullet points for scannability.
- Do not duplicate the full report contents — just the highlights and recommendations.
- If you made zero findings in a phase, say so in one line rather than omitting it silently.`,
  },
  {
    number: 14,
    name: "Data Integrity",
    prompt: `You are running an overnight data integrity and validation audit. Your job is to find gaps in how data is validated, constrained, and kept consistent — the class of bugs that ships silently and causes serious pain at scale.

Work on branch: \`data-integrity-[date]\`

## Phase 1: Input Validation Audit

**Step 1: Map all input boundaries**
Identify every place the system accepts external data: API request bodies, query/URL params, file uploads, webhook payloads, message queue events, CLI arguments, environment variables, CSV/Excel/JSON imports.

**Step 2: Audit validation at each boundary**
For each input boundary, check:
- Is there ANY validation? Are validation rules comprehensive?
  - Required fields enforced, string length limits, numeric ranges (no negative quantities, no $0 prices)
  - Format validation for emails, URLs, phones, dates (not just "is it a string?")
  - Enum fields restricted to valid values, array/collection size limits, nested object depth limits
- Is validation at the right layer? (handler level, not buried in the data layer)
- Frontend vs. backend consistency — flag cases where frontend validates but backend doesn't
- Are validation errors returned in a consistent, helpful format?

**Step 3: Fix what's safe**
- Add missing validation using the project's existing patterns/libraries
- Add string length and array size limits to unbounded fields
- Align backend validation to match frontend rules where backend is less strict
- Run tests after each batch. Commit: \`fix: add input validation to [endpoint/module]\`

## Phase 2: Database Constraint Audit

**Step 1: Map the schema**
Read all migrations and/or ORM model definitions. For each table, document: columns, types, nullable status, defaults, indexes, foreign keys, unique constraints, check constraints.

**Step 2: Find missing constraints**
Compare schema against application code usage:

- **Missing NOT NULL**: Columns always set during creation, read without null checks, or used in WHERE/JOIN without null handling
- **Missing foreign keys**: Columns referencing other tables (\`*_id\`) without FK constraints — orphaned records possible
- **Missing unique constraints**: Emails, slugs, external IDs (Stripe, OAuth), compound uniqueness rules
- **Missing check constraints**: Non-negative prices, valid status values, start < end dates, percentages 0–100
- **Missing cascade rules**: FKs without ON DELETE behavior — is the current behavior intentional?
- **Overly permissive types**: VARCHAR(255) for short fields, TEXT without limits, INT for booleans

**Step 3: Write migration files (DO NOT run them)**
- Create migration files for recommended constraints
- Each migration must include a comment explaining: what and why, whether existing data might violate it (with suggested cleanup query if so), and downtime impact
- Commit: \`chore: add migration for [constraint type] on [table]\`

## Phase 3: Orphaned Data & Referential Integrity

**Step 1: Identify deletion patterns**
Find every hard delete, soft delete, or archive in the code. For each, trace: are child records handled? References cleaned up? Associated files/assets removed? Caches invalidated?

**Step 2: Find orphan risks**
- Deletions without cascade leaving dangling references
- Soft-deleted parents with non-deleted children (queries on children don't filter by parent's deleted status)
- Missing cleanup (deleted user's files, sessions, API keys persist forever)
- Multi-step deletions that can fail halfway, leaving inconsistent state

**Step 3: Write diagnostic queries (don't run on production)**
Write queries to detect: records pointing to non-existent parents, soft-deleted parents with active children, and stale automated records (expired tokens, abandoned carts, temp records). Include in the report for team review.

## Phase 4: Schema vs. Application Drift

**Step 1: Compare ORM models to actual schema**
Flag: fields in model but not schema (runtime crash), fields in schema but not model (unused or raw-queried), type/default/nullable mismatches.

**Step 2: Check raw query risks**
Find all raw SQL in the codebase. For each: does it reference current columns? Correct types? Parameterized? Fragile references like \`SELECT *\`?

**Step 3: Validate enum/status consistency**
For every status/type/role/category field: are the same values used everywhere (no "active" vs "Active")? Are all values handled in switch/match statements? Do code values match DB enum definitions?

## Phase 5: Business Invariant Documentation

Identify multi-table or conditional invariants that can't be expressed as DB constraints. For each:
- Document it clearly
- Write a diagnostic query to detect violations
- Note enforcement status (enforced, partial, none)
- Recommend enforcement method (app logic, DB trigger, scheduled job)

## Output

Save to \`audit-reports/DATA_INTEGRITY_REPORT_[run-number]_[date].md\`, incrementing run number based on existing reports.

### Report Structure

1. **Executive Summary** — Overall health (poor/fair/good/excellent), critical gaps, totals for validation/constraint/orphan issues
2. **Input Validation** — Unvalidated endpoints (with severity), frontend vs. backend inconsistencies, fixes implemented, remaining gaps
3. **Database Constraints** — Missing constraints table (Table | Column | Missing Constraint | Risk | Migration File), existing data violations, pending migrations
4. **Orphaned Data** — Deletion flows with orphan risks (Deletion Point | Related Data | Current Behavior | Risk), diagnostic queries, recommended cascade/cleanup rules
5. **Schema Drift** — ORM vs. schema mismatches, raw query risks, enum/status inconsistencies
6. **Business Invariants** — Table: Invariant | Currently Enforced? | Diagnostic Query | Recommendation
7. **Recommendations** — Priority-ordered fixes, which migrations to review first, suggested ongoing practices

## Rules
- Run tests after every code change
- DO NOT run migrations or cleanup queries — only create files for review
- DO NOT change business logic — only add validation and document gaps
- Label all diagnostic queries as "run manually after review"
- For constraints: note impact on existing data and downtime requirements
- When uncertain whether a constraint should exist, document it as a question for the team
- Prefer documenting over guessing. Wrong constraints are worse than missing ones.
- Be thorough. Check every table, every endpoint, every deletion path.

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

---

**Formatting rules for chat output:**
- Use markdown headers, bold for severity labels, and bullet points for scannability.
- Do not duplicate the full report contents — just the highlights and recommendations.
- If you made zero findings in a phase, say so in one line rather than omitting it silently.`,
  },
  {
    number: 15,
    name: "Performance",
    prompt: `You are running an overnight performance analysis and optimization pass. Identify bottlenecks, optimize what's safe, and document everything else.

Branch: \`performance-optimization-[date]\`

## General Rules
- Run tests after every change
- DO NOT change behavior — only performance characteristics
- Database migrations: write files but DO NOT run them (need human review)
- Caching: document opportunities, don't implement complex infrastructure overnight
- Only parallelize provably independent operations
-  Frontend: no new dependencies. Attributes (\`loading="lazy"\`, \`font-display: swap\`, \`async\`, \`defer\`) are fine
-  Only add \`React.memo\`/\`useMemo\`/\`useCallback\` where unnecessary re-renders are demonstrable
- Focus on hot paths. Be honest about impact — a query on 50 rows once/day isn't worth optimizing
- Commit format: \`perf: [action] in [location]\` or \`fix: [issue] in [module]\`

## Phase 1: Database & Query Performance

**Step 1: Inventory all database queries**
For each query, note: calling endpoint/function, tables hit, joins/subqueries/aggregations, WHERE clauses, and whether results are paginated or unbounded.

**Step 2: Fix N+1 queries**
Look for: loops executing per-iteration queries, ORM lazy loading, endpoints fetching lists then querying details per item, GraphQL resolvers fetching nested data one-by-one. Fix with eager loading, joins, or batch queries.

**Step 3: Identify missing indexes**
Check every WHERE, JOIN, and ORDER BY column for index coverage. Consider single-column, composite, and partial indexes. Write migration files with documented expected impact.

**Step 4: Other query issues**
- \`SELECT *\` when few columns needed
- Unbounded queries on large tables / missing pagination
- Queries inside unnecessary transaction blocks
- Duplicate queries within a single request
- Sorting/filtering in app code that should be in the DB

## Phase 2: Application-Level Performance

**Step 1: Expensive operations**
- Nested loops (O(n²)+) on large datasets
- Synchronous/blocking operations on hot paths
- Large per-request data transformations that should be cached
- Missing memoization of repeated deterministic computations
- String concatenation in loops; unnecessary JSON.parse/stringify in hot paths

**Step 2: Caching opportunities**
Identify data that is: read-heavy/write-rare, expensive but deterministic, fetched from slow/rate-limited external APIs, or computed identically across requests. Document: what to cache, strategy (in-memory/Redis/HTTP headers), invalidation approach, estimated impact.

**Step 3: Async/concurrency improvements**
- Sequential calls that could be parallelized (\`Promise.all\` / \`asyncio.gather\`)
- Blocking I/O that could be async
- Missing connection pooling
- Missing request throttling for external APIs
- Heavy processing that should be a background job

## Phase 3: Memory & Resource Performance

**Step 1: Memory leak patterns**
- Event listeners added but never removed
- Growing collections never pruned (in-memory caches without eviction)
- Closures capturing large objects unnecessarily
- Unclosed streams/connections (especially in error paths)
- Uncleared intervals/timers
- Circular references; large objects in module-level variables

**Step 2: Resource management issues**
- DB connections not returned to pool (especially on error)
- File handles without guaranteed close (missing finally/using/with)
- Unterminated HTTP connections; unmanaged child processes; orphaned temp files

**Step 3: Fix safe issues** — add missing cleanup (event listeners, timers, finally blocks, connection handling). Test after each fix.

##  Phase 4: Frontend Performance

**Skip entirely if no frontend exists.**

**Step 1: Render performance**

*React (adapt for other frameworks):*
- Unnecessary re-renders (missing \`React.memo\`, \`useMemo\`/\`useCallback\`)
- State stored too high in the tree
- Large lists (50+ items) without virtualization
- Expensive computations in render bodies, unmemoized
- Context providers with inline object/array values causing consumer re-renders
- \`useEffect\` syncing derived state that should be \`useMemo\`
- Components subscribing to full global state but using a small slice

*Framework-agnostic:*
- Layout thrashing (interleaved DOM reads/writes in loops)
- Forced synchronous layouts (reading computed styles after mutations)
- Expensive CSS selectors in frequently re-rendered areas
- CSS animations on layout-triggering properties (\`top\`/\`left\`/\`width\`/\`height\`) instead of \`transform\`/\`opacity\`
- Large DOM trees (>1500 nodes)

**Step 2: Loading performance**

*Critical rendering path:* What blocks first paint? Synchronous \`<head>\` scripts, render-blocking CSS, large synchronous imports. Check for \`async\`/\`defer\`, inline critical CSS, meaningful loading states.

*Code splitting:* Are routes lazy-loaded? Heavy components (editors, charts, PDF viewers)? Modals/dialogs? Appropriate \`Suspense\` boundaries?

*Fonts:* Check \`font-display\` (should be \`swap\`/\`optional\`). Preloaded? Count and size of font files. System font fallback to prevent FOIT?

*Images:* \`loading="lazy"\` below fold? \`srcset\`/\`sizes\` for responsive images? Appropriately sized? Modern formats (WebP/AVIF)? Compressed? SVGs for icons where appropriate?

*Third-party scripts:* Inventory all (analytics, chat, A/B, ads, embeds). Loaded async? Blocking main thread? Deferrable? Total weight vs first-party?

**Step 3: Runtime event handlers**
- Scroll/resize handlers without throttle/debounce
- Input handlers triggering expensive ops per keystroke (search, API validation)
- Mouse move handlers on large areas
- Missing \`passive: true\` on scroll/touch listeners

**Step 4: Animation performance**
- JS animations that could be CSS transitions (compositor thread)
- \`setInterval\` instead of \`requestAnimationFrame\`
- Animations triggering layout recalc — use \`transform\`/\`opacity\` instead
- Missing \`will-change\` on confirmed-animated elements (use sparingly)

## Phase 5: Quick Performance Wins
Implement as you go: replace \`Array.find\` in loops with Map/Set, move invariants out of loops, replace sync file reads with async on hot paths, add early returns, debounce/throttle noisy handlers.

## Output

Save as \`audit-reports/PERFORMANCE_REPORT_[run-number]_[date].md\`. Create directory if needed. Increment run number based on existing reports.

### Report Structure

1. **Executive Summary** — Top 5 issues, severity (critical/high/medium/low), quick wins implemented vs larger efforts needed

2. **Database Performance** — N+1s fixed (with before/after) and unfixed (with reasons). Missing indexes table: Table | Column(s) | Query Location | Migration File. Other query issues with recommendations.

3. **Application Performance** — Expensive operations: Location | Issue | Complexity | Recommendation. Caching: Data | Strategy | Invalidation | Impact. Parallelization implemented/documented.

4. **Memory & Resources** — Leaks fixed, potential leaks needing investigation, resource management gaps.

5.  **Frontend Performance** (skip if no frontend)
   - Render: fixes applied (Component | Issue | Fix) and documented for review (Component | Issue | Impact | Effort)
   - Loading: what blocks first paint, fixes applied (Area | Before | After), larger recommendations (Opportunity | Impact | Effort)
   - Bundle: top 10 largest items (if analyzable)
   - Images: Image/Pattern | Issue | Recommendation
   - Third-party: Script | Purpose | Size | Async? | Deferrable?
   - Event handler and animation fixes applied

6. **Optimizations Implemented** — Every change with before/after. All tests passing: yes/no.

7. **Optimization Roadmap** — Larger efforts ordered by impact with rough effort estimates.

8. **Monitoring Recommendations** — Key metrics, alert-worthy queries,  frontend vitals (LCP, INP, CLS, TTI, bundle size), suggested perf testing approach.

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

---

**Formatting rules for chat output:**
- Use markdown headers, bold for severity labels, and bullet points for scannability.
- Do not duplicate the full report contents — just the highlights and recommendations.
- If you made zero findings in a phase, say so in one line rather than omitting it silently.`,
  },
  {
    number: 16,
    name: "Cost Optimization",
    prompt: `# Cost & Resource Optimization

Overnight audit to find every place the product wastes money — over-provisioned infra, unused services, redundant API calls, unbounded storage, and missing cost controls.

**READ-ONLY for infrastructure.** Code-level fixes (redundant calls, missing caching, wasteful queries) go on branch \`cost-optimization-[date]\`. Run tests after every change.

---

## Global Rules

- Be specific: "$50-150/month based on [reasoning]", not "this could save money." State assumptions.
- Distinguish **high-confidence savings** (unused resources, redundant calls) from **verify-with-metrics savings** (right-sizing, reserved instances).
- Never recommend cost cuts that sacrifice reliability without calling out the tradeoff.
- When you find waste, look for the same pattern elsewhere. Waste clusters.
- Use web search to verify current pricing. Don't nickel-and-dime — focus on material waste.
- You have all night. Be thorough.

---

## Phase 1: Billable Service Inventory

### Map every external service
Search the entire codebase (source, config, IaC, Docker, CI/CD, \`.env.example\`, docs) for every billable service. For each, document: service name/provider, purpose (read the code), billing model, usage pattern (hot path vs. batch vs. rare), config location, SDK client initialization (shared vs. multiple instances), and tier/plan indicators.

### Identify unused or underused services
- Services in config but never called in code
- Services only in dead/commented-out code or behind permanently-off feature flags
- SDK initialized but only a fraction of capabilities used
- Overlapping services (two email providers, two analytics platforms)
- Dev/test services still configured in production

### Identify missing cost controls
For each service: rate limits? Budget caps? Usage alerts? Quota monitoring? Free-tier threshold awareness?

---

## Phase 2: Infrastructure Resource Analysis

### Infrastructure-as-Code (Terraform, CloudFormation, Pulumi, K8s, Docker Compose)

Analyze every provisioned resource across these categories:

- **Compute**: Instance sizing vs. workload, auto-scaling min/max, Lambda memory/timeout over-provisioning, container resource requests vs. actual needs, always-on resources that could be scheduled
- **Database**: Instance size, unused read replicas (provisioned but not referenced in code), unnecessary Multi-AZ, provisioned IOPS vs. GP3, excessive backup retention, unbounded storage auto-scaling
- **Storage**: Missing lifecycle policies, versioning without cleanup, no multipart upload abort policy, unbounded log buckets, CDN cache effectiveness
- **Networking**: NAT Gateway costs ($0.045/GB), unnecessary cross-AZ/region transfer, unneeded load balancers, unattached Elastic IPs
- **Cache/Search**: Instance sizing vs. dataset size, unused cache nodes, cluster mode vs. standalone, search index lifecycle management
- **CDN**: Cache-control headers set correctly? Price class matches user geography?

### Docker
Base image bloat, missing multi-stage builds, dev dependencies in production images.

### CI/CD
Oversized runners for simple tasks, poor build caching, artifact retention policies, test execution efficiency, over-frequent scheduled pipelines.

---

## Phase 3: Application-Level Cost Patterns

### Redundant API calls
Trace every external call: duplicate calls per request? Cacheable data re-fetched every time? Batch endpoints available but not used? Polling instead of webhooks? Data discarded and re-fetched instead of passed through?

**Calculate**: calls_per_request × requests_per_day × cost_per_call = daily waste.

### Database query cost
Full table scans vs. indexed lookups, \`SELECT *\` fetching unneeded blobs, reads hitting primary instead of replicas, analytics on production DB, expensive aggregations recomputed per-request, N+1 queries, full-text search hitting DB when search index exists.

### Storage patterns
Unlimited upload sizes, permanently stored generated files that could expire, unclean temp files, logs on expensive tiers, blobs in DB instead of object storage.

### Serverless patterns
Unnecessary provisioned concurrency, long-running functions better suited to containers, memory over-allocation, function chaining costs, DynamoDB on-demand vs. provisioned mismatch, API Gateway where Lambda URLs suffice.

### Third-party tier optimization
Usage near tier thresholds? Premium features paid but unused? Cheaper alternatives for features actually used? Annual billing discounts missed? Non-prod on paid tiers unnecessarily?

### Fix code-level waste (on branch)
Cache repeated identical API calls, replace individual calls with batch calls, add \`Cache-Control\` headers, remove duplicate calls, add early returns before expensive operations, pass fetched data through call chains. Run tests, commit each batch.

---

## Phase 4: Data Transfer & Egress

Map data movement (client↔server, service↔service, server→third-party, DB→app). Then identify reduction opportunities: response compression (gzip/brotli), pagination on list endpoints, GraphQL depth limiting, CDN caching, production log verbosity, metrics cardinality.

---

## Phase 5: Environment & Development Cost

- Non-prod environments running production-scale infra? Always-on when used only business hours? Cleaned up after merge?
- Paid tool seats for departed team members? Expensive tools used by one person billed to the whole team?

---

## Phase 6: Cost Monitoring & Governance

Assess: budget alerts, cost tagging strategy, per-feature cost attribution, anomaly detection, governance (can any dev provision expensive resources without review?), auto-scaling spending limits, third-party usage spike alerts. Recommend specific monitoring based on services found.

---

## Output

Save to \`audit-reports/COST_OPTIMIZATION_REPORT_[run-number]_[date].md\`.

### Report Structure

1. **Executive Summary** — Total estimated monthly waste (range), confidence, top 5 savings, fixes implemented
2. **Billable Service Inventory** — Table: Service | Provider | Purpose | Billing Model | Usage Pattern | Est. Monthly Cost | Issues
3. **Infrastructure Analysis** — Tables per category (Compute, Database, Storage, Networking, Cache/Search, CDN, Containers, CI/CD) with current config, recommendation, estimated savings, confidence
4. **Application-Level Waste** — Redundant API calls, DB cost patterns, storage patterns, serverless, third-party tier optimization
5. **Data Transfer & Egress** — Patterns, volumes, recommendations
6. **Non-Production Costs** — Environment inventory with parity/always-on/cleanup assessment
7. **Code-Level Fixes Implemented** — File | Change | Impact | Tests Pass?
8. **Cost Monitoring Assessment** — Visibility, tagging, alerts, governance gaps
9. **Savings Roadmap** — Priority-ordered table: Opportunity | Est. Savings | Effort | Risk | Confidence | Details. Grouped into Immediate / This Month / This Quarter / Ongoing
10. **Assumptions & Verification Needed** — Every estimate depending on unseen data, specific questions for the team

### Chat Summary (always print in conversation)

1. **Status** — One sentence: what you did, tests passing?
2. **Key Findings** — Biggest savings with dollar estimates and confidence
3. **Changes Made** — Code fixes applied (skip if none)
4. **Recommendations** — Table if warranted: # | Recommendation | Est. Savings | Effort | Risk | Worth Doing? | Details. If total waste < $50/month, say so.
5. **Verification Checklist** — Metrics/billing data the team should check
6. **Report Location** — File path

---

## Rules Summary

- Branch for code changes only. Run tests after every change.
- DO NOT modify infrastructure, cloud resources, env vars, or provisioning configs.
- DO NOT downgrade tiers or remove resources — only recommend.
- Always include dollar estimates with stated assumptions.
- Never compromise reliability without explicit tradeoff disclosure.
- When in doubt, document rather than change.`,
  },
  {
    number: 17,
    name: "Error Recovery",
    prompt: `You are running an overnight error recovery and resilience audit. Find where the system fails badly — crashes instead of recovering, hangs instead of timing out, corrupts data instead of rolling back — and fix the safe ones while documenting the rest.

Branch: \`resilience-[date]\`

## General Rules
- Run tests after every change.
- Commit messages: \`fix: [what you did] in [module]\`
- DO NOT add new infrastructure dependencies. Use what exists or implement simple utilities.
- DO NOT change business logic or user-facing behavior.
- When adding timeouts, err generous — too-short causes false failures.
- Only retry idempotent operations. If unsure, document instead.
- Graceful shutdown must include a force-kill timeout to prevent hanging forever.
- Be specific about failure modes. Not "this could fail" but "if Redis is unreachable for >5s, all authenticated endpoints hang until the 30s default timeout fires, exhausting the connection pool."
- You have all night. Be thorough.

## Phase 1: Timeout Audit

**Step 1: Inventory every external call** — database queries, HTTP/API calls, cache ops, message queues, DNS, file storage (S3/GCS/NFS), email/SMS, WebSockets, gRPC/RPC.

**Step 2: Check each call's timeout configuration**
- Is there a timeout? Is it appropriate (a 30s default on a <100ms DB call is effectively none)?
- Are connection timeout and read timeout configured separately?
- What happens when the timeout fires — exception, null, retry, or silent hang?
- Flag any calls with NO timeout (most dangerous).

**Step 3: Fix missing/misconfigured timeouts**
- Add timeouts to every unprotected external call. Sensible defaults:
  - Connection: 3-5s
  - Read: 100ms-2s for DB, 5-30s for external APIs, configurable for long-running ops
- Make timeouts configurable via environment variables where they aren't already.

## Phase 2: Retry Logic Audit

**Step 1: Find all existing retry logic** — retry libraries, manual retry loops, queue/job retry config, webhook retry config.

**Step 2: Evaluate each retry**
- Is retry appropriate? Do NOT retry: non-idempotent ops without idempotency keys, client errors (4xx), auth errors, validation errors.
- Has exponential backoff with jitter? (Fixed intervals cause thundering herd)
- Has max retry limit and total timeout cap?
- Are the right errors retried? (Network/503 yes, 400/404 no)
- Is there logging on retry? Does the final error propagate meaningfully?

**Step 3: Find operations that need retries but lack them** — transient-failure-prone external API calls, DB connection issues, queue publishes, notification sending.

**Step 4: Add missing retries (safe operations only)**
Only for idempotent ops expected to fail transiently, not on hot paths. Include exponential backoff with jitter, max 3 retries, transient-error-only filtering, and logged attempts with context.

## Phase 3: Circuit Breaker & Fallback Assessment

**Step 1: Identify circuit breaker needs** — For each external dependency: does failure cascade? Does the app return errors to ALL users, even those not needing that dependency? Does it hang?

**Step 2: Identify fallback/degraded modes**
Examples: cache down → direct DB queries; search down → basic LIKE queries; email down → queue for later; analytics down → continue without tracking; third-party API down → cached/stale data or "temporarily unavailable" UI.

**Step 3: Document recommendations only** (do NOT implement overnight unless library already configured). For each: failure threshold, fallback behavior, recovery check, estimated effort.

## Phase 4: Partial Failure & Data Consistency

**Step 1: Find multi-step operations** with multiple side effects (e.g., create user + send email + create Stripe customer; process payment + update order + send confirmation + decrement inventory).

**Step 2: Analyze failure modes** — What happens if step N fails after step N-1 succeeds? Is there a transaction? Are external side effects inside/outside it? Is there rollback/compensation logic? Audit trail?

**Step 3: Fix safe issues**
- Move external side effects OUTSIDE database transactions.
- Add try/catch around non-critical side effects (notification failure should not fail the parent operation).
- Log progress on critical multi-step operations for failure diagnosis.
- Add idempotency guards for operations that might be retried after partial completion.

## Phase 5: Graceful Shutdown

**Step 1: Assess current behavior** — Does the app handle SIGTERM/SIGINT? On shutdown: does it kill in-flight requests, or drain them? Does it close DB/cache connections, drain queue consumers, flush logs/metrics? Is there a force-kill timeout?

**Step 2: Implement/improve** — Add signal handlers if missing. Stop accepting new work → finish in-flight (with timeout) → close connections → drain queues → flush buffers → exit cleanly.

## Phase 6: Dead Letter & Failure Queue Analysis

If the app uses message queues or background jobs:

**Step 1: Assess failure handling** — Are failed jobs retried with backoff? After max retries, where do they go? Is there a dead letter queue? Is it monitored? Can failed jobs be reprocessed? Are failure reasons logged with context?

**Step 2: Assess queue health** — Unbounded growth risks? Max depth/age limits? Zombie jobs (started but never completed)? Stuck job detection?

**Step 3: Fix what's safe** — Add DLQ config, failure logging, max retry limits, and error context to failed jobs.

## Output

Create \`audit-reports/\` in project root if needed. Save as \`audit-reports/ERROR_RECOVERY_REPORT_[run-number]_[date].md\`, incrementing run number based on existing reports.

### Report Structure

1. **Executive Summary** — Resilience maturity (fragile / basic / moderate / resilient / robust). "What happens right now if [biggest dependency] goes down for 10 minutes?" Top 5 resilience gaps.

2. **Timeout Audit** — Table: Operation | File | Timeout Before | Timeout After | Notes. List operations still missing timeouts and why.

3. **Retry Logic** — Tables for: existing retries (Operation | Correct? | Issues | Fix), retries added (Operation | Strategy | Max Retries | Errors Retried), retries needed but not added (and why).

4. **Circuit Breaker Recommendations** — Table: Dependency | Current Failure Mode | Recommended Config | Fallback | Effort.

5. **Partial Failure Analysis** — Table: Operation | Steps | Failure Modes | Current Handling | Fixes Applied | Remaining Risk.

6. **Graceful Shutdown** — Before/after state. Resource cleanup checklist: Resource | Cleaned Up on Shutdown?

7. **Queue & Job Resilience** — Table: Queue/Job | Retry Config | Dead Letter? | Monitoring? | Fixes Applied.

8. **Cascading Failure Risk Map** — Dependency graph, critical paths with no fallback, blast radius per dependency.

9. **Recommendations** — Priority-ordered improvements, infrastructure needs, testing recommendations (chaos engineering, failure injection), incident response suggestions.

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

---

**Formatting rules for chat output:**
- Use markdown headers, bold for severity labels, and bullet points for scannability.
- Do not duplicate the full report contents — just the highlights and recommendations.
- If you made zero findings in a phase, say so in one line rather than omitting it silently.`,
  },
  {
    number: 18,
    name: "Race Conditions",
    prompt: `# Concurrency & Race Condition Audit

You are running an overnight concurrency and race condition audit. Your job: find where simultaneous operations cause data corruption, lost updates, double-processing, or inconsistent state.

This is primarily analysis and documentation. Race conditions are dangerous to "fix" without deep understanding — fix only clear-cut cases, document everything else with specific, actionable recommendations.

Work on branch \`concurrency-audit-[date]\`.

---

## Global Rules

- Run tests after every change. Commit format: \`fix: [concurrency protection type] in [module]\`
- **Only fix** race conditions where the fix is clearly correct and low-risk: adding unique constraints (migration file, not run), replacing read-modify-write with atomic operations, adding \`SELECT FOR UPDATE\` to existing transactions, adding \`WHERE\` clause guards to status transitions, replacing read-compute-write cache patterns with atomic cache operations, adding missing cache invalidation to write paths, fixing invalidation ordering, adding button disable-on-submit.
- **Do NOT implement** overnight: distributed locking, leader election, event sourcing, global transaction isolation level changes, cache stampede protection (unless project already has a pattern), or TTL changes (unless clearly a framework default).
- When documenting a race condition, show the **interleaved timeline** — the specific sequence of events that causes the problem, with entity IDs and timing where relevant.
  - Bad: "There's a race condition in the order system"
  - Good: "In \`orders_service.js:142\`, two concurrent requests can both read \`inventory_count=1\`, both pass the \`>0\` check, and both decrement → \`inventory_count=-1\`. Fix: \`SELECT FOR UPDATE\` on the inventory row."
- For cache races, include timing windows: "DB write takes ~50ms, invalidation 10ms after → 60ms stale read window."

---

## Phase 1: Shared Mutable State Analysis

**Step 1: Find global and module-level mutable state**
Search for: global variables modified after init, module-level variables written during request handling, singletons with mutable properties, static variables that change at runtime, in-memory caches/registries read AND written during requests, module-level connection pools/rate limiters/counters.

For each: What data? Which code paths read/write it? Can two requests access it simultaneously? Consequence? (Stale read, lost update, corruption, crash?)

**Step 2: Find request-scoped state leaks**
Request data stored on shared objects, improperly isolated thread-local/async-context storage, middleware modifying shared state per-request, object pools retaining previous request state.

**Step 3: Fix clear-cut issues**
Convert mutable globals to request-scoped state where obvious. Add isolation. Make immutable what doesn't need to mutate. Document complex cases in the report.

---

## Phase 2: Database Race Conditions

**Step 1: Find read-modify-write patterns**
Code that reads a value, modifies it in application code, writes it back — counter increments, availability checks + reservation, balance updates, status transitions, list appends.

For each: Is it in a transaction? Appropriate isolation level? Optimistic concurrency (version/\`updated_at\`)? Pessimistic lock (\`SELECT FOR UPDATE\`)? What happens with two simultaneous requests right now?

**Step 2: Find check-then-act patterns**
Code that checks a condition then acts on it without concurrency protection — uniqueness checks without unique constraints, availability checks without locks, eligibility checks without guards.

For each: Is there a database constraint backing the check? A lock? Or just unprotected application logic?

**Step 3: Find transaction scope issues**
Transactions too narrow (partial protection), too broad (locks held during external API calls), external side effects inside transactions (HTTP calls, queue publishes that can't roll back), nested transaction behavior misunderstandings, missing transactions on multi-statement operations.

**Step 4: Fix safe issues**
Add unique constraints, replace read-modify-write with atomic operations (\`UPDATE SET value = value + 1\`), add \`SELECT FOR UPDATE\`, add \`WHERE\` clause guards on status transitions, add optimistic concurrency checks. Write migration files for new constraints (don't run them).

---

## Phase 3: Distributed Cache Race Conditions

**Step 1: Inventory all cache interactions**
For every cache layer (Redis, Memcached, in-memory, CDN, HTTP cache): What data is cached? Key structure? TTL? Where read, written, invalidated? Cache strategy (read-through, write-through, write-behind, cache-aside)?

**Step 2: Stale read races**
For every cached value, trace what happens when underlying data changes:
- Is cache invalidated on every write path? (Watch for new endpoints that modify data cached by older endpoints.)
- Invalidation ordering: after successful DB write, not before.
- Race window: Thread A updates DB → Thread B reads cache (stale hit) → Thread A invalidates. Thread B now has stale data.
- For dangerous stale data (permissions, balances, inventory): is there a cache bypass mechanism?
- Impact assessment: how long could stale data persist (TTL = worst case)? What's the consequence?

**Step 3: Cache stampede (thundering herd)**
When a popular key expires, many concurrent requests hit the DB simultaneously. Look for: high-read-rate keys with short TTLs, invalidation on popular keys without stampede protection, existing mitigations (cache locks, stale-while-revalidate, probabilistic early expiration).

**Step 4: Read-compute-write cache races**
Cache-layer read-modify-write: counter increments, incremental aggregation updates, list appends in cache. For each: can it use atomic cache commands (Redis \`INCR\`, \`LPUSH\`, \`SADD\`)? If not, is there locking?

**Step 5: Cache-database consistency divergence**
Look for: delete-then-cache races (stale "not found" cached between DB delete and cache delete), double-write inconsistency (cache write fails silently after DB write), cold-cache stampede on deploy, cross-service cache invalidation gaps.

**Step 6: Fix safe cache issues**
Replace read-compute-write with atomic operations, add missing cache invalidation to write paths, fix invalidation ordering. Document complex issues (stampede protection, distributed consistency) without implementing.

---

## Phase 4: Queue & Job Idempotency

**Step 1: Assess idempotency**
For every background job/message consumer: What happens if it runs twice? Is there deduplication (idempotency key, unique constraint, "already processed" check)? Can parallel instances of the same job type interfere? What about out-of-order execution?

**Step 2: Distributed concurrency**
Operations assuming single-instance execution? Scheduled jobs running on every instance? Missing distributed locks? Missing leader election?

**Step 3: Fix safe issues**
Add idempotency keys, unique constraints to prevent double-creation, "already processed" guards.

---

## Phase 5: Frontend Concurrency

**Step 1: Find user-facing race conditions**
Double submission (no button disable/request dedup), stale data actions (acting on changed/deleted resources), optimistic UI without proper rollback on failure, concurrent editing without conflict detection, out-of-order API responses overwriting newer data.

**Step 2: Fix safe issues**
Add button disable-on-submit, request debouncing, optimistic UI rollback.

---

## Phase 6: Concurrency Test Generation

**Step 1: Tests for critical race conditions**
Simulate concurrent execution for the most dangerous database and cache races. Use parallel test runners, un-awaited async operations, dual-connection transaction tests, cache invalidation timing tests. Mark failing tests as skipped: \`// RACE CONDITION: [description]\`.

**Step 2: Tests for idempotency**
Call each protected endpoint/job twice with the same input. Verify single side effect and appropriate second-call response.

---

## Output

Save as \`audit-reports/RACE_CONDITION_REPORT_[run]_[date].md\`. Increment run number based on existing reports.

### Report Structure

1. **Executive Summary** — Safety level (dangerous/risky/moderate/safe/robust), race conditions by severity, "at 100 concurrent requests, these things WILL go wrong: [list]"

2. **Shared Mutable State** — Global/module mutable state: | Location | Data | Read By | Written By | Risk | Fix |. Request-scoped leaks. Fixes applied.

3. **Database Race Conditions** — Read-modify-write races: | Location | Operation | Current Protection | Risk | Recommendation |. Check-then-act races. Transaction scope issues. Fixes applied with before/after. Migration files created.

4. **Cache Race Conditions** — Cache inventory: | Cached Data | Backend | TTL | Read/Write/Invalidation Locations | Consistency Risk |. Stale read risks. Stampede risks. Read-compute-write races. Cache-DB consistency issues. Fixes applied.

5. **Queue & Job Idempotency** — | Job/Consumer | Idempotent? | Protection | Risk if Duplicated |. Distributed issues. Fixes applied.

6. **Frontend Concurrency** — Double-submission risks. Stale data actions. Optimistic UI issues. Fixes applied.

7. **Concurrency Tests Written** — Tests proving race conditions exist (skipped), tests verifying protections, idempotency tests, cache consistency tests.

8. **Risk Map** — All race conditions ranked by likelihood × impact. Highest risk first with remediation steps. Estimated manifestation frequency under normal load. Distinguish visible errors vs. silent wrong answers (stale data, lost updates) — silent ones are more dangerous.

9. **Recommendations** — Immediate fixes, patterns for new code (optimistic locking, idempotency keys, atomic operations, cache consistency patterns, stampede mitigation), infrastructure to consider, monitoring to add, load testing approach.

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

---

**Formatting rules for chat output:**
- Use markdown headers, bold for severity labels, and bullet points for scannability.
- Do not duplicate the full report contents — just the highlights and recommendations.
- If you made zero findings in a phase, say so in one line rather than omitting it silently.`,
  },
  {
    number: 19,
    name: "Bug Hunt",
    prompt: `# Bug Hunt

Overnight bug detection pass. Find bugs — logic errors, off-by-ones, unhandled edge cases, silent failures, incorrect assumptions. Be thorough and skeptical. Read every file.

**Default posture: SURFACE bugs, not fix them.** Only fix if ALL criteria are met: (1) ≥90% confident it's a bug, (2) mechanical/obvious fix, (3) tests exist to verify, (4) no business logic or user-facing behavior change. Everything else: document only.

Branch: \`bug-hunt-[date]\` · Commit format: \`fix: [brief description] in [file/module]\`

## Global Rules

- Run tests after every fix. Fail → revert immediately → reclassify as document-only.
- DO NOT change business logic, refactor, or install new tools.
- A bug fix changes the minimum lines to correct the defect — nothing else.
- False positives are cheap. Missed bugs are expensive. When in doubt, report it.
- When you find a bug, search for the same pattern elsewhere. Bugs cluster.
- For every finding, include: what's wrong, why, likely correct behavior, trigger/reproduction, confidence (High/Medium/Low), and a suggested test.

---

## Phase 1: Static Analysis — Pattern-Based Detection

Scan the entire codebase for each category explicitly.

### 1. Comparison & Equality
- \`=\` vs \`==\`/\`===\` in conditionals
- \`==\` vs \`===\` (type coercion: \`0 == ""\`, \`null == undefined\`, \`"0" == false\`)
- Inverted comparisons (\`>\` vs \`<\`, \`>=\` vs \`>\`)
- Unhandled \`null\`/\`undefined\`/\`NaN\` in comparisons (\`NaN !== NaN\`; \`null >= 0\` is true but \`null > 0\` is false)
- Float equality without epsilon
- String vs numeric comparison (\`"10" < "9"\` is true)
- Reference equality where deep equality was intended

### 2. Off-by-One & Boundaries
- \`array[array.length]\`, \`array[-1]\` (both undefined in JS)
- Loop bounds: \`<\` vs \`<=\`, start index 0 vs 1, \`.length\` vs \`.length - 1\`
- Substring/slice inclusive vs exclusive end
- Pagination: page 0 vs 1, last page calc (\`ceil\` vs \`floor\`), empty last page
- Date/time: midnight, month boundaries (31→28), timezone crossing, DST
- Chained range checks (\`min <= value <= max\` doesn't work in most languages)
- Fence-post errors in counting/partitioning

### 3. Null/Undefined/Empty Handling
- Property access on potentially null/undefined without checks
- Missing \`?.\` or wrong fallback (\`?? "Unknown"\` when null means something different)
- Empty string as falsy when valid (\`if (!input)\` rejects \`""\` and \`null\`)
- Empty array/object as truthy (\`if (results)\` is always true for \`[]\`)
- Default params masking caller bugs (\`f(x = 0)\` — is 0 valid or hiding a missing arg?)
- Destructuring without nested defaults
- Missing \`.length === 0\` before accessing first/last element

### 4. Async & Promises
- Missing \`await\` (returns Promise instead of value — often silent)
- \`await\` inside \`forEach\` (doesn't await — use \`for...of\` or \`Promise.all(arr.map(...))\`)
- Missing \`.catch()\` / try-catch on promises
- Race conditions assuming sequential async execution
- \`async\` functions that never await (unnecessary wrapper or forgotten await)
- \`new Promise(async (resolve) => ...)\` anti-pattern
- Swallowed errors in middleware catch blocks
- \`Promise.all\` where \`Promise.allSettled\` was needed
- Async in constructors or synchronous-looking paths

### 5. Logic Errors
- De Morgan violations, double negatives inverting intent
- Short-circuit side effects: \`a && doSomething()\` where \`doSomething\` should always run
- Switch missing \`break\` (fall-through), missing \`default\`, incomplete enum coverage
- Early returns skipping cleanup (resource release, state reset)
- Identical then/else branches (copy-paste)
- Always-true/false conditions (dead branches)
- Variable shadowing (inner scope hiding outer value)
- Operator precedence: \`a & b == c\` → \`a & (b == c)\`
- Chained ternary associativity
- \`x || default\` failing on falsy valid values (\`0\`, \`""\`, \`false\`)

### 6. Data & Type Bugs
- Mutating shared objects/arrays passed by reference
- Sort without comparator (JS default is lexicographic: \`[10,9,80].sort()\` → \`[10,80,9]\`)
- Integer overflow/underflow
- \`parseInt\` pitfalls: \`parseInt("08")\` octal, \`parseInt("123abc")\` → 123, \`Number("")\` → 0
- Regex: unescaped specials, missing anchors, greedy vs lazy, catastrophic backtracking
- \`JSON.parse\`/\`stringify\`: \`undefined\` dropped, \`Date\` → string, \`BigInt\` throws, circular refs
- Spread shallow copy (nested objects share references)
- Map/Set with object keys (reference equality)

### 7. API & Integration
- HTTP status codes unchecked (assuming success)
- Response body structure assumed without validation
- No timeout on HTTP requests
- Retry on non-idempotent operations (POST retry = duplicate)
- Non-idempotent webhook handlers (redelivery = duplicate processing)
- URL construction: missing \`encodeURIComponent\`, double slashes, query param bugs
- Content-Type mismatches
- Pagination: not fetching all pages, off-by-one, ignoring \`hasMore\`/\`nextCursor\`

### 8. Security-Adjacent Logic
- Auth check without permission-level check
- IDOR: user-supplied ID without ownership verification
- Rate limit bypass via alternate routes
- Timing leaks (different response times for user-exists vs not)
- Mass assignment: request body spread into DB update without field filtering
- Permission checked at entry but not on downstream operations

---

## Phase 2: Semantic Analysis — Intent vs Implementation

### Function Contract Analysis
For every function on critical paths (auth, payments, data mutation, core logic):
- Infer intended contract from name, params, docs, callers
- Compare to actual behavior for ALL inputs, including edge cases
- Check if callers can violate the function's assumptions

### State Machine Verification
For every entity with status/state (orders, payments, subscriptions, etc.):
- Map all states and transitions (code locations)
- Check for: unguarded impossible transitions, states with no exit, skipped intermediate states, concurrent transition conflicts

### Business Rule Consistency
- Same rules applied consistently everywhere? (Discount in checkout AND summary AND invoice)
- Frontend-only validation without backend enforcement?
- Hardcoded values duplicated with different values across files?

### Error Path Analysis
For every error handler/catch/fallback:
- Does it accomplish the intended recovery?
- Does the error propagate correctly or get swallowed?
- Is the user informed? Or does it fail silently?
- Is the system left in a consistent state? (Partial writes, uncommitted transactions, half-updated UI)

---

## Phase 3: Data Flow Analysis

### Trace Critical Flows End-to-End (top 5-10 operations)
- Data correctness through every transformation
- Types preserved/converted correctly at each boundary
- Precision preserved (float money, timestamp truncation, timezone loss)
- Required fields guaranteed present at every stage

### Cross-Feature Interference
- Two features writing to the same field with different expectations
- Stale cached values modified by another feature
- Feature A's error handler resetting state Feature B depends on
- Event handler ordering across features

### Migration & Backwards Compatibility
- DB fields that changed meaning over time (old records have different semantics)
- API consumers sending old-format requests
- Serialized objects (DB, cache, queue) in old format
- Code reading data without accounting for schema changes without data migration

---

## Phase 4: Test-Informed Detection

### Existing Failures & Skips
- Skipped tests with \`// BUG\`, \`// FIXME\`, \`// broken\`, \`// flaky\` = known unfixed bugs
- Tests asserting surprising behavior (\`// this is weird but correct\`) — verify it IS correct

### Coverage Gaps
- Code with NO test coverage = most likely bug locations
- Functions tested only happy-path (edge cases are where bugs live)
- Untested error paths

### Test Correctness
- Tests asserting the wrong thing (passes but doesn't verify correct behavior)
- Tautological tests (\`expect(mock).toHaveBeenCalled()\` on unconditionally-called mock)
- Tests that test the mock more than the code

---

## Phase 5: Fix High-Confidence Bugs

For each finding meeting ALL fix criteria:
1. Write minimal fix → 2. Run full test suite → 3. Pass: commit → 4. Fail: revert, reclassify as document-only

**Fixable:** Missing null checks, \`==\`→\`===\`, missing \`await\`, pagination off-by-one, swallowed errors, missing \`break\`, numeric sort without comparator.

**Document-only:** Business logic that might be intentional, race conditions needing architecture changes, state machine gaps needing product decisions, performance issues, ambiguous "correct" behavior.

---

## Output

Save to \`audit-reports/BUG_HUNT_REPORT_[run-number]_[date].md\` (create dir if needed, increment run number).

### Report Sections
1. **Executive Summary** — Total bugs, confidence breakdown, fixed vs documented, critical count, highest-density areas.
2. **Critical Bugs** — Data loss, security, core UX. Per bug: Title, Location (file/line/function), Confidence + reasoning, Description, Impact, Trigger condition, Suggested fix, Status (Fixed w/ commit or Document Only w/ reason).
3. **High-Priority** — Incorrect behavior, data inconsistency, degraded UX. Same format.
4. **Medium-Priority** — Edge cases, minor issues. Same format.
5. **Low-Priority / Potential** — Suspicious but uncertain. Emphasize confidence and what would confirm/disprove.
6. **Bugs Fixed Table** — | File | Bug | Fix | Confidence | Tests Pass? | Commit |
7. **State Machine Analysis** — Per entity: state diagram, valid transitions w/ code locations, missing guards, stuck/impossible states.
8. **Data Flow Findings** — Transformation issues, cross-feature interference, schema/migration concerns.
9. **Test Suite Observations** — Known-bug tests, suspicious assertions, coverage gaps, test correctness issues.
10. **Bug Density Map** — Files/modules with most findings.
11. **Recommendations** — Recurring patterns, missing validation, tests to write.

---

## Chat Output (Primary Deliverable)

The user should NOT need to open the report. Print everything that matters in the conversation.

### 1. Status Line
One sentence: what you did, duration, whether tests pass.

### 2. Bugs Fixed
Per fix: file/line, what was wrong (1 sentence), what you changed (1 sentence), confidence + reasoning (e.g. "99% — mechanical, tests cover this"), commit. Flag any ambiguity with ⚠️.

### 3. Bugs Found — Needs Human Review
ALL bugs not fixed, by severity (Critical → Low). Per bug:
- **Severity + confidence** (e.g. "HIGH (Medium confidence)")
- **File/line**
- **What's wrong** (specific: code does X, should do Y)
- **Trigger condition** (specific: "when user submits empty array for line items")
- **Impact** (data corruption, wrong price, silent failure, crash, etc.)
- **Suggested fix** (plain language or short snippet)
- **Why not fixed** ("not confident it's unintentional" / "no test coverage" / "requires business decision" / "too many call sites")

List ALL findings. Completeness beats brevity.

### 4. Patterns & Hot Spots
- Bug clusters (e.g. "\`payments/\` had 6 findings")
- Recurring patterns (e.g. "missing null checks ×8 — consider lint rule")
- Risky untested areas

### 5. Report Location
Full path to detailed report.`,
  },
  {
    number: 20,
    name: "Frontend Quality",
    prompt: `# Frontend Quality Pass

## Prompt

\`\`\`
You are running an overnight frontend quality audit and improvement pass. You have several hours. Your job is to improve accessibility, UX consistency, bundle efficiency, and internationalization readiness across the frontend codebase.

Work on a branch called \`frontend-quality-[date]\`.

## Your Mission

### Phase 1: Accessibility Audit & Fixes

Accessibility isn't optional — it's both a legal requirement and good engineering. Scan every component and page.

**Step 1: Automated checks**
Scan all component/template files for:

- **Images**: Missing \`alt\` attributes, empty \`alt\` on non-decorative images, decorative images missing \`alt=""\`
- **Forms**: Inputs without associated \`<label>\` elements (or \`aria-label\`/\`aria-labelledby\`), missing form validation announcements, submit buttons that don't indicate their purpose
- **Interactive elements**: Click handlers on non-interactive elements (\`div\`, \`span\`) without \`role\`, \`tabIndex\`, and keyboard event handlers. Buttons that are actually \`<div>\`s or \`<a>\`s without proper roles.
- **Heading hierarchy**: Skipped heading levels (h1 → h3), multiple h1s per page, headings used for styling rather than structure
- **Color and contrast**: Hardcoded colors that might fail WCAG AA contrast ratios (especially light gray text on white backgrounds, placeholder text)
- **Focus management**: Missing focus styles (\`:focus\` or \`:focus-visible\`), focus traps in modals that don't exist, modals that don't return focus on close
- **Dynamic content**: ARIA live regions missing for content that updates dynamically (notifications, loading states, error messages), screen reader announcements for route changes in SPAs
- **Keyboard navigation**: Interactive elements not reachable via Tab, custom components that don't respond to Enter/Space, dropdown menus that don't support arrow keys, escape key not closing modals/popups
- **Semantic HTML**: \`<div>\` and \`<span>\` used where semantic elements should be (\`<nav>\`, \`<main>\`, \`<aside>\`, \`<article>\`, \`<section>\`, \`<header>\`, \`<footer>\`, \`<button>\`, \`<time>\`)
- **ARIA usage**: \`aria-*\` attributes used incorrectly (wrong values, missing required companion attributes, ARIA roles on elements that already have that role natively)

**Step 2: Fix what's safe**
For each issue found:
- Low-risk fixes (adding alt text, adding labels, adding semantic elements, adding ARIA attributes): implement immediately, run tests, commit
- Medium-risk fixes (refactoring div-buttons to real buttons, adding keyboard handlers): implement carefully, test thoroughly
- High-risk fixes (focus management overhauls, major structural changes): document in report only
- Commit: \`a11y: [description] in [component]\`

### Phase 2: UX Consistency Audit

**Step 1: Component inventory**
Catalog every UI pattern used in the app:
- Buttons: How many visual styles exist? Are they consistent? Do similar actions use similar button styles?
- Form inputs: Consistent styling, error states, placeholder text approach, validation feedback
- Loading states: Spinners, skeletons, progress bars — are they consistent? Do all async operations show loading?
- Empty states: What happens when a list has no items? Is it always handled? Is the messaging consistent?
- Error states: How are errors displayed? Consistent format? Red text, toasts, inline, modal?
- Spacing: Consistent use of spacing scale or are padding/margin values random?
- Typography: How many font sizes are actually used? Do they follow a consistent scale?
- Colors: Are colors from a design system / theme, or hardcoded hex values scattered everywhere?
- Icons: Consistent icon library? Mixed icon sources? Missing icons where they'd help?
- Responsive behavior: Do components work at mobile sizes? Tablet? Are breakpoints consistent?

**Step 2: Document inconsistencies**
Create a detailed inventory of every inconsistency pattern found:
- Categorize by severity (confusing to users vs. just messy)
- Group related issues (all button inconsistencies together, all spacing issues together)
- Screenshot descriptions or specific file/line references for each

**Step 3: Fix what's safe**
- If there's a clear design system or component library: fix deviations back to the standard
- Consolidate obviously duplicate component variants (3 different button components that do the same thing)
- Standardize spacing to the nearest consistent value
- Ensure all lists have empty states
- Ensure all async operations have loading states
- Run tests after each batch of changes
- Commit: \`ui: standardize [pattern] across [scope]\`

### Phase 3: Bundle Size Analysis & Optimization

**Step 1: Analyze the bundle**
- If build tooling supports it, generate a bundle analysis (webpack-bundle-analyzer, source-map-explorer, or equivalent)
- Identify:
  - The largest dependencies by size
  - Dependencies that are imported but only partially used (e.g., importing all of lodash for one function)
  - Dependencies with lighter alternatives (moment.js → date-fns, lodash → native methods)
  - Code that's bundled but only used on specific routes (should be lazy-loaded)
  - Duplicate dependencies (same package at multiple versions in the bundle)
  - CSS that's included but never used (dead CSS)

**Step 2: Implement safe optimizations**
- Replace full library imports with specific imports (\`import get from 'lodash/get'\` instead of \`import _ from 'lodash'\`)
- Add dynamic imports / lazy loading for route-specific code that doesn't need to be in the main bundle
- Remove unused CSS if a reliable method is available
- Remove unused dependencies from package.json
- Run the build to verify bundle still works
- Run tests
- Commit: \`perf: reduce bundle size — [what changed]\`

**Step 3: Document larger opportunities**
- Dependencies that should be replaced with lighter alternatives (with migration effort estimate)
- Code splitting strategies that would require architectural changes
- Image optimization opportunities (uncompressed images, missing responsive images, images that should be SVGs)

### Phase 4: Internationalization (i18n) Readiness

**Step 1: Find all hardcoded strings**
Scan every component, template, and UI-related file for:
- Hardcoded user-facing text (labels, messages, headings, button text, placeholder text, error messages, tooltips)
- Hardcoded date formatting (specific date format strings like "MM/DD/YYYY")
- Hardcoded number formatting (currency symbols, decimal separators, thousand separators)
- Hardcoded pluralization logic (\`count === 1 ? "item" : "items"\`)
- Right-to-left (RTL) incompatible layouts (hardcoded left/right padding/margins instead of logical properties)
- Concatenated strings that would break in other languages ("Welcome, " + name + "!")
- Text embedded in images

**Step 2: Create string extraction plan**
- If an i18n framework is already in the project (react-intl, i18next, vue-i18n, etc.), identify strings that should be using it but aren't
- If no i18n framework exists, recommend one and document the migration effort
- For either case, create a catalog:
  - Table: | File | Line | Current String | Suggested Key | Notes |
  - Group by module/page for organized extraction

**Step 3: Implement extraction if framework exists**
If the project already has i18n tooling set up:
- Extract hardcoded strings to the translation file(s)
- Replace hardcoded strings with translation function calls
- Use the existing naming/key convention
- Run tests after each batch
- Commit: \`i18n: extract strings from [module]\`

If no i18n framework exists:
- DO NOT add one overnight. Just document the strings and recommendations.

## Output Requirements

Create the \`audit-reports/\` directory in the project root if it doesn't already exist. Save the report as \`audit-reports/FRONTEND_QUALITY_REPORT_[run-number]_[date].md\` (e.g., \`FRONTEND_QUALITY_REPORT_01_2026-02-16.md\`). Increment the run number based on any existing reports with the same name prefix in that folder.

### Report Structure

1. **Executive Summary**
   - Total accessibility issues found and fixed
   - UX consistency score (your subjective assessment: poor/fair/good/excellent)
   - Bundle size before/after (if measurable)
   - i18n readiness assessment (not ready / partially ready / mostly ready)

2. **Accessibility**
   - Issues fixed: table with | Component | Issue | Fix |
   - Issues remaining: table with | Component | Issue | Severity | Effort to Fix |
   - Overall WCAG compliance assessment

3. **UX Consistency**
   - Component inventory with consistency assessment
   - Inconsistencies found and fixed
   - Inconsistencies documented for team review
   - Recommended design system improvements

4. **Bundle Size**
   - Current bundle composition (top 10 largest items)
   - Optimizations implemented
   - Larger optimization opportunities with effort estimates

5. **Internationalization**
   - Total hardcoded strings found: X
   - Strings extracted (if framework exists): X
   - Strings remaining: X
   - Full string catalog (appendix)
   - Recommended i18n approach and effort estimate

6. **Recommendations**
   - Priority-ordered list of improvements
   - Estimated effort for each
   - Dependencies between improvements

## Rules
- Branch: \`frontend-quality-[date]\`
- Run tests after every change
- For accessibility: implement fixes that don't change visual appearance or behavior. If a fix would change UX flow, document it instead.
- For consistency: align TO the existing dominant pattern, don't impose a new one
- For bundle: don't remove dependencies that might be used dynamically or in ways you can't trace statically — document uncertainty
- For i18n: don't add frameworks or infrastructure. Only extract strings if the framework already exists.
- Visual changes should be minimal — this is about quality and correctness, not redesign
- You have all night. Be thorough. Go component by component.
\`\`\`

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

---

**Formatting rules for chat output:**
- Use markdown headers, bold for severity labels, and bullet points for scannability.
- Do not duplicate the full report contents — just the highlights and recommendations.
- If you made zero findings in a phase, say so in one line rather than omitting it silently.`,
  },
  {
    number: 21,
    name: "State Management",
    prompt: `# State Management Audit

Branch: \`state-audit-[date]\`. Map everything before fixing anything. Run tests after every change. Commit format: \`fix: [state issue] in [module]\`.

**Do NOT**: change business logic/API contracts, introduce new state libraries, refactor working patterns, or combine fixes into single commits.

---

## Phase 1: State Source Inventory

### Catalog every state container

Search the entire codebase for where state lives:

- **Global stores** — Redux, Zustand, MobX, Vuex/Pinia, Recoil/Jotai, Context, Svelte stores, signals. Document: what data, subscribers, update mechanism, navigation persistence.
- **Server cache** — React Query, SWR, Apollo, RTK Query, urql. Document: cache keys, TTLs, invalidation strategy, whether mutations update cache or just refetch.
- **Component-local state** — \`useState\`, \`useReducer\`, \`this.state\`, Vue \`ref()\`/\`reactive()\`. Focus on state that *shouldn't* be local: shared data, state lost on unmount that shouldn't be, duplicates of global/server state.
- **URL state** — Query params, path params, hash. What's encoded? What *should* be (filters, pagination, tabs, search, sort)?
- **Browser storage** — localStorage, sessionStorage, IndexedDB, cookies. Document: data, read/write timing, TTL, unbounded growth, encryption for sensitive data.
- **Form state** — Controlled vs uncontrolled, form library config, multi-step persistence, draft preservation on navigation.
- **Derived/computed state** — Computed on read (selectors, \`useMemo\`) vs eagerly stored (duplication in disguise)?
- **Implicit state** — Untracked DOM state: scroll position, focus, \`<details>\` open/closed, caret position.

### Build a state map

For every meaningful piece of data, document:

| Data | Canonical Source | Other Copies | Sync Mechanism | Stale Window | Survives Refresh? | Should Survive? |
|------|-----------------|--------------|----------------|-------------|-------------------|-----------------|

### Classify state by lifecycle

Label each piece of state: **Session** (survives nav, not tab close), **Page** (resets on nav away), **Transient** (resets after interaction), **Persistent** (survives sessions), **Shared** (consistent across components/routes). Flag every mismatch between actual and correct lifecycle.

---

## Phase 2: Duplicated State

Duplicated state is the #1 source of "sometimes shows wrong data" bugs.

### Find duplicates

**Exact**: same data in server cache + global store, parent props + child fetch, URL params + component state, localStorage + store, overlapping store slices, form library + component state, server cache + manual loading/error state.

**Semantic**: list cache + individual item cache, normalized + denormalized copies, aggregates stored separately from source data (cart total vs cart items), permissions in auth token + separate endpoint.

### Fix safe duplications

Delete the copy; have consumers read from the canonical source. If the copy exists for performance, use a memoized selector. If for access, lift access via context/hooks. If server cache vs global store: server data → server cache library, client-only data → global store.

For complex cases requiring architectural decisions: document only, don't fix overnight.

---

## Phase 3: Stale State

### Identify stale vectors

- **Server cache**: Missing mutation → invalidation links? Appropriate \`staleTime\`/refetch settings? Multi-tab consistency? Optimistic update rollback on failure?
- **Global store**: Updated on every relevant API response or only initial fetch? State cleared on logout? Session expiry awareness?
- **URL state**: Back/forward sync? Deep link initialization? Bidirectional URL ↔ UI sync?
- **Browser storage**: Missing TTL/version key? Stale auth tokens? Schema mismatches after app updates?

### Find specific bugs

Construct exact reproduction scenarios with numbered steps ending in the bug. Rate each: likelihood × visibility × impact.

### Fix

Add missing query invalidations, store updates, URL sync, staleTime config, logout cleanup, storage version keys. Err toward correctness over performance.

---

## Phase 4: Missing State Handling

Every async operation has four states: **idle, loading, error, success (data or empty)**.

### Audit each

**Loading**: Indicator exists? Right granularity (not full-page spinner for sidebar)? Grace period before showing? Independent per fetch? Stale-while-revalidate on refetch? Timeout for hung requests?

**Error**: Error state exists (not infinite loading)? Helpful message? Retry mechanism? Right scope (failed sidebar ≠ full page error)? App still usable? Auto-recovery? Error boundaries at appropriate levels?

**Empty**: Message shown? "No data yet" vs "no results for filter" distinguished? Loading vs empty distinguished (no flash of "No items" before data)?

**Optimistic rollback**: Server rejection reverts UI? User notified? Exact prior state restored? Handles navigation-away before error?

### Fix

Add missing loading/error/empty states matching existing patterns. Fix error boundaries. Fix optimistic rollback bugs.

---

## Phase 5: State Lifecycle Bugs

### Doesn't survive when it should

- **Refresh**: Long form inputs, filters/pagination (→ URL params), auth token.
- **Navigation**: Back button restoring scroll, accordions, filters.
- **Tab switch**: Mobile app suspension, \`visibilitychange\` refetches resetting state.

### Survives when it shouldn't

- **Logout**: ALL user-specific state cleared? (stores, cache, storage, cookies, service worker, singletons). Common bug: User B sees User A's data briefly.
- **Navigation**: \`/entity/123\` → \`/entity/456\` shows old data (missing \`key\` prop or query invalidation).
- **Deletion**: Removed from every list, count, cache, derived state?
- **Permission change**: How long until UI reflects server-side changes?

### Hydration mismatches (SSR only)

Server/client render differences from: missing user context, timezone/locale, browser APIs, random/time values. Check for \`typeof window\` guards causing different output, \`useEffect\`-only state flashes, \`suppressHydrationWarning\` hiding real problems. Fix without changing final rendered output.

### Fix

Add route \`key\` props, unmount/logout cleanup, URL state sync, hydration fixes, sessionStorage for form drafts.

---

## Phase 6: Architecture Assessment (Document only, don't rewrite)

- **Server vs client state separation**: Flag server data manually managed in Redux/Zustand with loading/error/success actions instead of living in a server cache library. Document migration path.
- **State proximity**: Flag over-globalized state (global but used by 1-2 components), under-globalized (prop drilling 4+ levels), over-scoped context providers.
- **Re-render hot spots**: Inline object/array context values, non-granular store subscriptions, missing memo, unmemoized derived state. Focus on lists, expensive components, interactive paths.

---

## Phase 7: Edge Cases (Document, don't fix unless trivial)

**Multi-tab**: Login/logout sync, data edits visible across tabs, concurrent edits (conflict detection?).

**Network interruption**: Mid-mutation offline, offline navigation with cached pages, online recovery/retry.

**Session expiry**: Mid-session token expiry handling, token refresh race deduplication, post-reauth state restoration.

Document: scenario, current behavior, expected behavior, user impact, fix complexity.

---

## Output

Save as \`audit-reports/STATE_MANAGEMENT_REPORT_[run]_[date].md\`.

### Report sections

1. **Executive Summary** — Health rating (chaotic/fragile/adequate/solid/excellent), counts of findings and fixes.
2. **State Source Map** — Complete inventory table.
3. **Duplicated State** — Each duplication with divergence risk, fix status.
4. **Stale State Bugs** — Each with trigger, duration, impact, fix status.
5. **Missing UI States** — Gaps in loading/error/empty handling.
6. **Lifecycle Bugs** — State persisting/vanishing incorrectly.
7. **Hydration Mismatches** (SSR only).
8. **Edge Cases** — Multi-tab, offline, session expiry behavior.
9. **Re-render Hot Spots**.
10. **Architecture Assessment**.
11. **Fixes Applied** — File, issue, fix, tests pass, commit.
12. **Recommendations** — Priority-ordered.

### Chat summary (always print)

1. **Status**: One sentence — what you did, duration, tests passing.
2. **Key Findings**: Specific, actionable bullets with severity. Lead with impact, not vagueness.
3. **Changes Made** (if any).
4. **Recommendations** table (only if warranted):

| # | Recommendation | Impact | Risk if Ignored | Worth Doing? | Details |
|---|---|---|---|---|---|

Ordered by risk descending. Be honest about marginal recommendations.

5. **Report Location**: Full path.`,
  },
  {
    number: 22,
    name: "Perceived Performance",
    prompt: `# Perceived Performance Optimization

Run an overnight pass to make the app *feel* instant. Real speed gains are ideal, but perceived speed is the goal. A 500ms operation that feels instant beats a 200ms one the user waits for.

Branch: \`snappy-[date]\`. Commit format: \`perf: [what] in [where]\`

## Global Rules

- Run tests after every change.
- DO NOT change business logic — only *when/how* data loads and how the UI responds.
- DO NOT add dependencies unless the project has equivalents; document as recommendations instead.
- DO NOT ship optimistic updates that can't be safely rolled back on error.
- Be honest about real vs. perceived speed gains in the report.
- Prioritize by frequency × impact. Critical path > settings page.

---

## Phase 1: Critical Path Mapping

### 1. Identify top 5–10 user journeys
App startup, auth, main dashboard, core CRUD workflow, navigation between sections, search/filtering, write actions.

### 2. Trace the loading waterfall for each
For each journey document: trigger → requests (order, serial vs. parallel) → what blocks rendering → what user sees while waiting → total time to interactive.

### 3. Rank waits by impact
**Priority = Duration × Frequency × Emptiness × Intent.** Blank screen + high frequency + user just clicked = fix first.

---

## Phase 2: Prefetching & Preloading

### Route-level prefetching
- **Hover/focus**: Start fetching destination data on link hover (~200ms head start).
- **Predictive**: After login → prefetch dashboard. After create → prefetch detail view. After list → prefetch top item. Paginated lists → prefetch next page.
- **Router-level**: Fetch data in parallel with code-splitting chunk load (loader pattern > useEffect pattern).
- Check if data-fetching library prefetch utilities (React Query, SWR, Apollo) exist but aren't used.

### Asset preloading
- Images below fold / next screen: \`<link rel="preload">\` or \`new Image().src\`
- Fonts: preload in \`<head>\` to avoid FOIT/FOUT
- Code chunks: \`<link rel="prefetch">\` or idle \`import()\` for likely-next routes
- Configs/feature flags: fetch early in boot, not lazily on first use

### Cache warming
- Warm caches on startup for commonly accessed data.
- After writes, update cache immediately (or invalidate + refetch).
- Use stale-while-revalidate where appropriate.

---

## Phase 3: Optimistic UI & Instant Feedback

### Audit every mutation
For each create/update/delete/toggle: Is the outcome predictable? What's the failure rate? Can it roll back cleanly?

### Good candidates for optimistic updates
Toggles, list adds/removes, text field saves, reordering, simple status transitions.

### Bad candidates
Payments, complex server validation, actions with unpredictable side effects (emails, webhooks).

### Pattern
\`\`\`
// Optimistic: update UI instantly, rollback on error
const prev = item.isFavorite;
setItem({ ...item, isFavorite: !prev });
try { await api.toggleFavorite(id); }
catch { setItem({ ...item, isFavorite: prev }); showErrorToast(); }
\`\`\`

Check if the data-fetching library's built-in optimistic mechanisms are being used.

### Instant feedback even without optimistic updates
Every click/tap should produce immediate visual response: button pressed state, skeleton appearance, item fade-out on delete, shell render on navigation.

---

## Phase 4: Waterfall Elimination

### Find sequential chains that should be parallel
\`\`\`
// BAD: 650ms serial
const user = await fetchUser();
const prefs = await fetchPreferences(user.id);
const dashboard = await fetchDashboard(user.id);

// GOOD: 300ms parallel (prefs + dashboard don't depend on each other)
const user = await fetchUser();
const [prefs, dashboard] = await Promise.all([
  fetchPreferences(user.id), fetchDashboard(user.id)
]);
\`\`\`

**Common waterfalls**: nested component fetches, config → user → data chains, list → per-item detail fetches, auth → route data → component data.

### Fix
- Lift fetching to route level and fire in parallel.
- Use \`Promise.all\`/\`Promise.allSettled\` for independent requests.
- Render partially with early data; show skeletons for slow data.
- Backend: parallelize independent DB/API calls; split slow sub-queries into separate lazy endpoints.

---

## Phase 5: Rendering & Visual Continuity

### Loading state hierarchy (worst → best)
Blank screen → full-page spinner → skeleton screen → stale-while-revalidate

**Fix**: Every page renders its shell instantly. Replace spinners with skeletons or stale content.

### Progressive rendering
Don't gate entire pages on slowest data. Render fast sections immediately, skeleton the rest.

### Transitions
- Fix layout shifts: skeleton dimensions must match real content.
- Route transitions: show destination shell immediately, not blank screen.
- List mutations: animate add/remove, don't pop.
- Above-the-fold first; lazy-load below-fold with intersection observer.
- Large lists (50+ items): consider virtual scrolling.

---

## Phase 6: Caching & Network

- **HTTP caching**: Proper \`Cache-Control\` headers? Static assets with content-hash + long TTL?
- **Client caching**: \`staleTime\`/\`cacheTime\` configured? (Default 0 = always refetch.) Set appropriately: user profile ~5min, catalog ~1min, live feed ~10s.
- **Deduplication**: Multiple components requesting same data → one request or many?
- **Batching**: Can many small requests become one batch request?
- **Cache invalidation**: Do writes update all views displaying that resource?

---

## Phase 7: Startup Speed

### Audit boot sequence
HTML → CSS (render-blocking?) → JS (bundle size?) → framework hydration → data fetches → first paint → interactive.

### Common blockers
Render-blocking scripts (missing \`async\`/\`defer\`), large unsplit bundles, sequential boot chains (auth → config → data → render), eager non-critical init (analytics, chat widgets).

### Fix
- Defer non-critical scripts until after first interactive render.
- Inline critical CSS.
- Parallelize boot: session + config + page data simultaneously.
- Consider rendering app shell before auth completes.

---

## Phase 8: Micro-Interactions

- **Click/tap feedback**: Eliminate delays. All interactive elements need \`:active\`/\`:hover\` states. 150ms ease-out transitions on state changes.
- **Animation as perception**: Fade/slide content in after load. Animate modals/drawers open (~200ms). Prefer determinate progress bars over indeterminate spinners.
- **Debounce/throttle**: Search: 150–300ms debounce (not 500ms+). Scroll/resize handlers: throttled/rAF. Auto-save: debounced, no conflict with manual save.
- **Forms**: Instant confirmation after submit (toast). Inline validation as user types. Re-enable on failure. Prefetch next step in multi-step forms.

---

## Output

Save to \`audit-reports/PERCEIVED_PERFORMANCE_REPORT_[run]_[date].md\`.

### Report Sections
1. **Executive Summary** — Snappiness rating (sluggish → instant-feeling), worst waits, changes made.
2. **Critical Path Analysis** — Waterfall diagrams, per-journey wait times, ranked by impact.
3. **Prefetching** — Opportunities, implementations, estimated time saved.
4. **Optimistic UI** — Mutations audited, which got optimistic treatment, which were too risky.
5. **Waterfall Elimination** — Before/after for parallelized chains, time saved.
6. **Rendering** — Loading state upgrades, progressive rendering, layout shift fixes.
7. **Caching** — Strategy per endpoint, deduplication fixes, header improvements.
8. **Startup** — Boot timeline before/after, blockers removed.
9. **Micro-Interactions** — Responsiveness, animation, debounce, form UX fixes.
10. **Measurements** — Before/after per journey; distinguish real vs. perceived gains.
11. **Recommendations** — Priority-ordered remaining work.

### Chat Summary (required)
Print directly in conversation:

1. **Status** — One sentence: what you did, test status.
2. **Key Findings** — Specific, actionable bullets with user impact. (e.g., "Dashboard loads 4 API calls sequentially = 1.2s. Parallelizing → ~400ms.")
3. **Changes Made** — What was modified. Skip if read-only run.
4. **Recommendations** (if any) — Table:

| # | Recommendation | Impact | Risk if Ignored | Worth Doing? | Details |
|---|---|---|---|---|---|
| | ≤10 words | What improves | Low–Critical | Yes/Probably/If time | 1–3 sentences |

Order by risk descending. Be honest — not everything is worth the engineering time.

5. **Report Location** — Full file path.`,
  },
  {
    number: 23,
    name: "DevOps",
    prompt: `You are running an overnight DevOps and infrastructure audit. Analyze the CI/CD pipeline, environment configuration, logging, and migration safety. Fix what's safe, document the rest.

Work on branch \`devops-audit-[date]\`.

## Your Mission

### Phase 1: CI/CD Pipeline Optimization

**Step 1: Map the current pipeline**
Read all CI/CD configs (GitHub Actions, GitLab CI, CircleCI, Jenkins, etc.) and map every workflow: triggers, steps, order, dependencies, approximate durations, and caching.

**Step 2: Identify optimization opportunities**
- **Parallelization**: Sequential steps with no dependency on each other
- **Caching**: Dependencies re-downloaded every run (node_modules, pip, Docker layers, build artifacts)
- **Unnecessary work**: Full test suite on docs-only changes, building all targets when one changed
- **Slow steps**: Disproportionately long steps — investigate why
- **Redundant steps**: Same work across multiple pipelines
- **Conditional execution**: Missing path filters
- **Resource sizing**: Over- or under-provisioned runners

**Step 3: Implement safe improvements**
Add/improve caching, path filters, parallelization; remove redundant steps. Commit: \`ci: [description]\`

**Step 4: Document larger improvements**
Changes requiring pipeline restructuring, with estimated time savings.

### Phase 2: Environment Configuration Audit

**Step 1: Inventory all configuration**
Catalog every config mechanism: \`.env\` files and variants, env var references in code, config files, Docker Compose env sections, K8s ConfigMaps/Secrets, IaC files, CI/CD variable definitions.

**Step 2: Check for issues**
- Missing documentation (vars used but not in \`.env.example\` or README)
- Missing defaults causing silent failures
- No type validation for non-string env vars
- Dev/prod inconsistency
- Hardcoded values that should be configurable (URLs, endpoints, flags, timeouts)
- Secret management problems (plaintext, committed to repo, shared across environments)
- Stale configuration no longer referenced in code
- No startup validation for required vars

**Step 3: Kill switch & operational toggle inventory**
Catalog every mechanism to change behavior without deploying: env var toggles, feature flags (LaunchDarkly, Flagsmith, etc.), DB-driven config, runtime-reloadable config.

For each, document: what it controls, change latency (immediate / restart / deploy), whether it's documented, incident history.

Assess **missing kill switches**: critical features or external integrations that cannot be disabled without a deploy. Recommend additions.

**Step 4: Production safety checks**
- **Dev/prod divergence**: Verify each difference is intentional
- **Dangerous defaults**: Debug mode, verbose logging, permissive CORS, mock providers, relaxed rate limits defaulting to dev-friendly values
- **Missing production config**: Error reporting, monitoring keys, backup config not validated
- **Secret rotation readiness**: Can secrets be rotated without downtime?

**Step 5: Fix what's safe**
- Update \`.env.example\` with all required vars and descriptions
- Add startup validation that fails fast with clear messages
- Remove stale env var references
- Add type parsing/validation
- Add comments to kill switches explaining purpose and usage
- Create \`docs/CONFIGURATION.md\` if missing, documenting the full config surface area
- Run tests. Commit: \`config: [description]\`

### Phase 3: Log Quality Audit

**Step 1: Assess logging infrastructure**
Identify: logging library, log levels and usage, structured vs string logging, log destinations, correlation/request ID system.

**Step 2: Find logging problems**

- **Missing logging**: Empty catch blocks, critical operations (payments, user creation, data deletion), external API calls, auth events, startup/shutdown
- **Excessive logging**: Debug logs in production paths, logging in tight loops, verbose large-object logging, redundant multi-layer logging
- **Dangerous logging** ⚠️: Passwords/tokens/API keys, PII without redaction, credit card data, session tokens, full request bodies
- **Low-quality logging**: Contextless messages ("Error occurred"), missing timestamps, inconsistent log levels, no correlation IDs, no operational vs programmer error distinction

**Step 3: Fix what's safe**
Add logging to unlogged critical ops, redact sensitive data, improve contextless messages, fix log levels, remove debug logging from hot paths. Run tests. Commit: \`logging: [description]\`

### Phase 4: Migration Safety Check

**Step 1: Inventory all migrations**
Find all migration files, map history and order, identify current state.

**Step 2: Analyze each migration for safety**
- **Reversibility**: Down/rollback exists and would work?
- **Data loss risk**: Drops columns/tables, irreversible data modifications?
- **Downtime risk**: NOT NULL without default, column type changes, index on large table without CONCURRENTLY, long-running backfills?
- **Backward compatibility**: Old code works with new schema and vice versa after partial rollback?
- **Ordering issues**: Unenforceable execution order dependencies?

**Step 3: Check for pending issues**
Unrun migrations, abandoned-feature migrations, conflicting migrations on same tables, schema drift.

## Output Requirements

Save to \`audit-reports/DEVOPS_AUDIT_REPORT_[run-number]_[date].md\`, incrementing run number based on existing reports.

### Report Structure

1. **Executive Summary** — Overall health, top 5 improvements, quick wins implemented

2. **CI/CD Pipeline** — Pipeline diagram (mermaid), optimizations implemented, estimated savings, larger recommendations

3. **Environment Configuration**
   - Variable inventory: | Variable | Used In | Default | Required | Description | Issues |
   - Issues found/fixed and issues remaining
   - Secret management assessment
   - Kill switch inventory: | Toggle | Controls | Change Mechanism | Latency | Documented? |
   - Missing kill switches: | Feature/Dependency | Risk if Unavailable | Recommendation |
   - Production safety: | Config | Issue | Risk | Recommendation |
   - Reference to \`docs/CONFIGURATION.md\` if created

4. **Logging** — Maturity assessment (poor/fair/good/excellent), sensitive data findings (CRITICAL if any), coverage gaps, quality fixes, infrastructure recommendations

5. **Database Migrations** — Inventory with safety assessment, high-risk flags, reversibility per migration, practice recommendations

6. **Recommendations** — Priority-ordered, quick wins vs larger projects, suggested monitoring/alerting

## Rules
- Branch: \`devops-audit-[date]\`
- Run tests after every code change
- DO NOT modify, run, or reorder database migrations — analyze only
- DO NOT modify production configuration or secrets
- DO NOT change deploy-affecting pipeline behavior — only add optimizations (caching, parallelization)
- Credentials logged or exposed = CRITICAL flag at top of report
- When unsure about infrastructure specifics, document assumptions and flag for verification
- Be thorough.

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

---

**Formatting rules for chat output:**
- Use markdown headers, bold for severity labels, and bullet points for scannability.
- Do not duplicate the full report contents — just the highlights and recommendations.
- If you made zero findings in a phase, say so in one line rather than omitting it silently.`,
  },
  {
    number: 24,
    name: "Observability",
    prompt: `# Observability & Monitoring Readiness

## Prompt

\`\`\`
You are running an overnight observability and monitoring readiness audit. Assess whether the team can detect, diagnose, and resolve production issues — then close the most critical gaps.

This is a mix of analysis and implementation. Add health checks, improve instrumentation, and generate runbooks, but don't introduce new infrastructure dependencies.

Work on branch \`observability-[date]\`.

## Your Mission

### Phase 1: Health Check & Readiness Assessment

**Evaluate existing health endpoints** (\`/health\`, \`/healthz\`, \`/readiness\`, \`/status\`, etc.)
- Does it just return 200, or does it verify actual dependencies (database, cache, queues, external APIs, file storage)?
- Does it distinguish liveness (process running) from readiness (ready to serve traffic)?

**Implement or improve health checks.** A good health endpoint should:
- Check every critical dependency, returning structured JSON with per-component status and latency
- Return 200 when healthy, 503 when unhealthy
- Have per-check timeouts so a hung dependency doesn't hang the endpoint
- NOT expose credentials, internal IPs, or stack traces
- Be lightweight enough to call frequently

If appropriate, create separate \`/health/live\` and \`/health/ready\` endpoints.

Run tests. Commit: \`feat: add comprehensive health check endpoint\`

### Phase 2: Metrics & Instrumentation Audit

**Inventory existing instrumentation**, then identify and close gaps across these categories:

- **Request metrics**: Count, latency histogram, error rate — all by endpoint/method/status. Active request concurrency. Request/response sizes.
- **Business metrics**: Significant user actions, conversion funnel steps, user-affecting failures (failed payments, sends, imports).
- **Dependency metrics**: DB query duration (by type/table), connection pool utilization (active/idle/waiting/max), external API latency/success/error per service, cache hit/miss/eviction rate, queue depth and consumer lag.
- **System/runtime metrics**: Memory (heap, RSS), event loop lag / GC pauses / equivalent, open FDs, active connections, thread/worker pool utilization.

**Add missing instrumentation where safe** — instrument via existing metrics libraries, ORM hooks, HTTP client middleware. Don't add a metrics library if none exists; document the recommendation instead.

Run tests after each batch. Commit: \`observability: add [metric type] instrumentation to [module]\`

### Phase 3: Distributed Tracing & Correlation

**Assess request tracing:**
- Is a unique correlation ID generated per request, propagated through logs, included in response headers (\`X-Request-Id\`), and forwarded to downstream calls and background jobs?
- If using a tracing system (OTel, Jaeger, Zipkin): are spans created for DB queries, external calls, and queue operations — not just the top-level request?

**Implement or improve as needed:**
- No correlation ID? Add middleware to generate one, attach to logging context, include in response headers. Commit: \`feat: add request correlation ID middleware\`
- Incomplete propagation? Fix it. Commit: \`fix: propagate request ID to [scope]\`

Run tests after changes.

### Phase 4: Failure Mode Analysis & Runbooks

**Map critical dependencies.** For each (DB, cache, APIs, queue, file storage, auth):
- Impact if down, slow (10x latency), or intermittently erroring
- Does the app crash, hang, or degrade gracefully?
- Timeout configured? Retry logic (with backoff/max)? Circuit breaker/fallback?

**Map critical code paths** (signup, core workflow, payments, exports, etc.):
- What can go wrong at each step?
- How would you detect it (which metric/log)?
- How would you investigate and resolve?

**Generate \`docs/RUNBOOKS.md\`** with a runbook per critical failure mode. Each runbook:
- **Title**: e.g., "Database Connection Pool Exhausted"
- **Symptoms**: Alerts, metrics, logs, or user reports indicating this problem
- **Diagnosis steps**: Ordered — what to check, commands to run, logs to search, metrics to examine
- **Resolution steps**: Immediate mitigation → root cause fix → verification
- **Prevention**: Changes to prevent recurrence
- **Escalation**: When to escalate and to whom (leave blank for team to fill)

**Assess graceful degradation:**
- Can the app partially serve requests when non-critical deps fail?
- Feature flags to disable broken features without deploying? Maintenance mode? Circuit breakers?

Document current state and recommend improvements.

### Phase 5: Alerting Surface Area

**Inventory existing alerts** in the codebase (Prometheus rules, PagerDuty config, CloudWatch alarms, etc.).

**Recommend alert definitions** with specific thresholds inferred from the codebase (timeout values, pool sizes, expected traffic):
- Error rate spike, latency degradation (P95), health check failures
- Dependency failure rates, resource exhaustion (pool/memory/disk)
- Queue backup (depth/lag), business metric anomalies (drop in signups, orders)

## Output Requirements

Create \`audit-reports/\` in project root if needed. Save as \`audit-reports/OBSERVABILITY_REPORT_[run-number]_[date].md\`. Increment run number based on existing reports.

### Report Structure

1. **Executive Summary** — Maturity level (blind/basic/moderate/good/excellent), detection speed, diagnostic capability, top 5 gaps
2. **Health Checks** — Before/after state, dependencies checked
3. **Metrics & Instrumentation** — Coverage table (Category | Present | Missing), what was added, what still needs infra changes
4. **Distributed Tracing** — Current state, improvements made, remaining gaps
5. **Failure Mode Analysis** — Dependency matrix (Dependency | Down Impact | Slow Impact | Timeout? | Retry? | Circuit Breaker? | Graceful Degradation?), link to runbooks
6. **Alerting Recommendations** — Table (Alert Name | Condition | Threshold | Severity), current gaps
7. **Recommendations** — Priority-ordered improvements, infra/tooling recs, quick wins vs. investments, on-call practices

## Rules
- Branch: \`observability-[date]\`
- Run tests after every code change
- DO NOT add new infrastructure dependencies
- DO NOT add heavy middleware on hot paths
- Health checks must be lightweight
- Runbooks must be actionable by someone unfamiliar with the system
- Be specific with recommendations — include metric names, thresholds, and durations, grounded in codebase evidence (timeouts, pool sizes, expected response times)
- You have all night. Be thorough.
\`\`\`

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

---

**Formatting rules for chat output:**
- Use markdown headers, bold for severity labels, and bullet points for scannability.
- Do not duplicate the full report contents — just the highlights and recommendations.
- If you made zero findings in a phase, say so in one line rather than omitting it silently.`,
  },
  {
    number: 25,
    name: "Backup & DR",
    prompt: `You are running an overnight backup and disaster recovery audit. Your job: answer "If the worst happened right now, could we recover — and how much would we lose?"

This is a READ-ONLY analysis. Do not create branches or modify code/infrastructure/data. Produce a comprehensive recovery posture assessment and generate the recovery documentation the team would desperately wish they had at 3am during an outage.

## Phase 1: Data Asset Inventory

**Step 1: Identify every data store** — search the codebase for every place data lives:
- Primary database(s) — engine, data, access patterns
- Cache layers (Redis, Memcached) — reconstructable from primary sources, or used as a primary store?
- File/object storage (S3, GCS, local filesystem) — uploads, generated docs, media
- Search indexes (Elasticsearch, Algolia, Typesense) — rebuildable from primary DB?
- Message queues — messages in-flight representing uncommitted state?
- Session storage — in-memory, database, or Redis?
- Logs and audit trails — survive infrastructure failure?
- Configuration and secrets — vault, env vars, config files, or hardcoded?
- Third-party service data (Stripe, SendGrid, Auth0, etc.) — is local DB or the third-party the source of truth?

**Step 2: Classify by criticality**
- **Irreplaceable**: Cannot be reconstructed (user data, transactions, uploads, audit logs)
- **Reconstructable**: Rebuildable at significant cost/time (search indexes, caches, derived analytics)
- **Ephemeral**: Loss acceptable (sessions, temp files, rate limit counters)

**Step 3: Assess volume and growth** — for each critical store: approximate size, growth pattern, unbounded growth risks, largest table/collection.

## Phase 2: Backup Coverage Assessment

**Step 1: Find existing backup configurations** — search for:
- DB backup scripts, cron jobs, IaC backup config (Terraform, CloudFormation — RDS snapshots, S3 versioning)
- Docker volume backups, backup-related env vars/config/dependencies (pg_dump, restic, velero, etc.)
- CI/CD backup jobs, backup documentation, cloud provider backup settings

**Step 2: Assess backup coverage per data store**
For each: Is it backed up? Method? Frequency? Storage location (same server/region/different)? Encrypted? Retention/rotation policy? Ever tested/restored? Point-in-time recovery capability (WAL, binlog, oplog)?

**Step 3: Identify backup gaps** — flag critical stores with:
- No backup — **CRITICAL**
- Backups on same infrastructure (doesn't survive infra failure) — **HIGH**
- Backups never tested — **HIGH**
- Infrequent backups relative to data change rate — **MEDIUM**
- No PITR despite high-frequency writes — **MEDIUM**
- Unencrypted backups containing PII — **MEDIUM**

## Phase 3: Recovery Capability Assessment

**Step 1: RPO analysis** — for each critical store, determine theoretical RPO:
- Daily backups, no WAL/binlog → up to 24h loss
- Hourly snapshots → up to 1h
- Continuous replication/WAL → near-zero
- No backups → everything since inception (catastrophic)

Flag mismatches against likely business tolerance (e.g., payment system with 24h RPO = unacceptable).

**Step 2: RTO analysis** — estimate total recovery time:
- New infrastructure provisioning (IaC vs. manual?)
- DB restoration time (size-dependent)
- File storage restoration
- Secrets/env reconfiguration
- Search index / cache rebuilding
- Post-restoration verification
- Total: "everything gone" → "users can use the product"

**Step 3: Single points of failure** — trace critical paths:
- Single DB instance (no replica), single server/AZ, single file storage location
- Secrets stored in only one place
- Bus factor = 1 for ops knowledge
- Single third-party dependency with no fallback
- DNS with no redundancy

**Step 4: Infrastructure reproducibility**
- What's defined as code vs. manual-only?
- What can be recreated from the repo alone?
- What requires manual setup (cloud console configs, DNS, SSL, third-party services)?

## Phase 4: Disaster Scenario Analysis

For each scenario below, assess: recovery path, data loss, time to operational, manual steps required, and what info the on-call engineer would need but might not have.

1. **Primary database destroyed** (server failure, accidental deletion, ransomware)
2. **Application servers destroyed** (redeploy from scratch — can repo alone suffice? What secrets/config/stateful components?)
3. **File storage destroyed/corrupted** (backups? Reproducible assets? What functionality breaks?)
4. **Third-party service permanently unavailable** (for each critical dependency: impact, local data sufficiency, coupling level)
5. **Credential compromise** (rotation without downtime? Process per credential type? Documented procedure?)
6. **Accidental data corruption / bad migration** (rollback capability? PITR? How to identify affected data? Audit trail?)

## Phase 5: Recovery Documentation

**Generate \`docs/DISASTER_RECOVERY.md\`** containing:
1. **Data Store Inventory** — table: | Data Store | Type | Criticality | Backup Method | Frequency | Location | RPO | RTO |
2. **Recovery Procedures** — per critical store: prerequisites, locating backups, restore commands, verification, failure fallbacks
3. **Infrastructure Recreation** — from-code vs. manual, env vars/secrets to re-provision
4. **Credential Rotation Procedures** — per credential: location, generation, dependent services, expected downtime
5. **Disaster Response Playbooks** — per scenario: detection, triage, recovery, verification, post-incident
6. **Emergency Contacts & Access** — template for team to fill in; mark gaps with \`⚠️ TEAM INPUT NEEDED: [what's missing]\`

**Generate \`docs/BACKUP_RECOMMENDATIONS.md\`** — specific recommendations: what to implement (with tooling), backup testing schedules, monitoring, redundancy additions, estimated effort per item.

## Output

Save report as \`audit-reports/BACKUP_DISASTER_RECOVERY_REPORT_[run-number]_[date].md\`. Increment run number based on existing reports.

### Report Structure
1. **Executive Summary** — readiness rating (unprepared/minimal/partial/solid/robust), one-sentence worst-case impact statement, top 3 gaps
2. **Data Asset Inventory** — | Data Store | Engine | Criticality | Size Estimate | Growth Pattern | Backed Up? |
3. **Backup Coverage** — coverage matrix, critical gaps
4. **Recovery Capability** — RPO/RTO tables, total system RTO, single points of failure
5. **Infrastructure Reproducibility** — code vs. manual matrix
6. **Disaster Scenario Analysis** — summary table + detailed analysis per scenario
7. **Documentation Generated** — references to generated docs, list of all \`⚠️ TEAM INPUT NEEDED\` items
8. **Recommendations** — priority-ordered: what, why, effort, tooling

## Rules
- Be honest about uncertainty. "No DB backup config found in codebase — could be configured at infrastructure level outside this repo — verify with the team" is better than "There are no backups."
- When estimating RPO/RTO, state your assumptions clearly.
- Write recovery docs for someone stressed, tired, and unfamiliar with the system. Step-by-step. No assumed knowledge.
- Mark everything you can't determine from the codebase with \`⚠️ TEAM INPUT NEEDED\`.
- Use web search to research best practices for the specific databases and services the project uses.
- You have all night. Be thorough.

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

---

**Formatting rules for chat output:**
- Use markdown headers, bold for severity labels, and bullet points for scannability.
- Do not duplicate the full report contents — just the highlights and recommendations.
- If you made zero findings in a phase, say so in one line rather than omitting it silently.`,
  },
  {
    number: 26,
    name: "Product Polish",
    prompt: `# Product Polish & UX Friction Audit

READ-ONLY analysis. Do not modify any code.

## Ground Rules

- Evaluate as a **user**, not a developer. "The code handles this correctly" is irrelevant if the user can't tell.
- Be specific: not "onboarding could be better" but "after signup, user lands on an empty dashboard with no guidance."
- Classify every issue: **broken** / **confusing** / **incomplete** / **missing**.
- Severity = frequency × pain. Trace every flow.

---

## Phase 1: User Journey Mapping

**Entry points** — Trace each: signup, login, invite link, OAuth, magic link, public pages, shared links, API, CLI, deep links.

**Core journeys per user role:**
- First use: signup → onboarding → first meaningful action → "aha moment"
- Core loop: the daily/weekly workflow
- Configuration: settings, profile, team/org management
- Edge cases: account recovery, plan changes, data export, deletion
- Exit points: dead ends, confusing branches, flows that just stop

**Secondary flows** — Notifications, search, filtering, sorting, bulk actions, imports/exports, integrations, billing, admin.

---

## Phase 2: First-Use & Onboarding

**Signup:** Step count, field necessity, email verification clarity (cross-device?), OAuth permission scope & failure fallback, error specificity (duplicate email, weak password, etc.).

**First experience:** What appears post-signup — empty state, tutorial, or sample data? Clear path to first action? Blocking setup steps? Skippable onboarding? Progress saved if user leaves?

**Empty states:** For every list/dashboard/feed — what shows with zero data? Does it guide the user toward populating it?

---

## Phase 3: Core Workflow

**Primary workflow:** Click/step count for common actions. Unnecessary confirmations? Missing confirmations on destructive actions? Undo support? Save clarity (auto vs. manual, feedback)?

**Forms & inputs:** Required/optional marking, inline vs. submit-only validation, sensible defaults, helpful placeholders, error display (all vs. first), input preservation on failure, progress for long forms, timezone/date format clarity.

**Navigation:** Location awareness (breadcrumbs, active states, titles), back-navigation (browser + in-app), information architecture logic, deep link shareability & permissions.

**Feedback & loading:** Immediate feedback on every action? Click-and-nothing-happens cases? Progress for long operations? Safe to navigate away? Retry without re-entry on failure?

---

## Phase 4: Edge Cases & Errors

**Destructive actions:** Confirmation with consequences explained? Undo available & obvious? Cascade effects communicated? Bulk action extra confirmation with count?

**Common error states:** Network offline, session expired (unsaved work?), permission denied (actionable message?), not found (helpful or generic 404?), rate limited (wait guidance?), file upload failures (size/type/network — all communicated?).

**Concurrency:** Two users editing same resource — conflict handling? Multi-tab state sync? Stale data refresh?

**Boundaries:** Long text (truncation/overflow/layout break?), special characters/emoji/RTL, large datasets (1000+ items — pagination/virtualization/performance?), minimum-input functionality.

---

## Phase 5: Settings & Configuration

**Every setting:** Discoverable? Explained? Immediate or requires save? Resettable to default? Dangerous settings guarded?

**Missing settings users would expect:** Notification preferences, display prefs, timezone, language, default views, keyboard shortcuts, data export.

**Account management:** Change email/password/name? Delete account (clear, complete process)? Team invite/role/removal flows? Data fate on leave/deletion?

---

## Phase 6: Notifications

**Inventory all** emails, in-app, push, webhooks: trigger, content quality, user control (opt-out, frequency, channel).

**Transactional:** Welcome email usefulness, password reset clarity & expiry, invite context, billing transparency.

---

## Phase 7: Accessibility Quick Scan

Flag obvious issues only (defer full audit): keyboard-only core flow completion, color-only information, screen reader labels on interactive elements, mobile responsiveness.

---

## Output

Save as \`audit-reports/PRODUCT_POLISH_REPORT_[run-number]_[date].md\`.

### Report Sections

1. **Executive Summary** — Overall polish level (rough/fair/good/polished), worst friction, journey health.
2. **User Journey Map** — All flows traced, health per flow (smooth / some friction / significant friction / broken).
3. **Critical Friction Points** — Table: Flow | Location (file/component) | Issue | Severity | Type
4. **First-Use & Onboarding** — Signup friction, onboarding gaps, empty states.
5. **Core Workflow** — Step-by-step assessment, friction, feedback, form quality.
6. **Edge Cases & Errors** — Destructive action safety, error quality, boundaries.
7. **Settings & Account** — Gaps, account management, configuration polish.
8. **Notifications** — Inventory, quality, missing notifications, user control.
9. **Accessibility Notes** — Obvious issues only.
10. **Recommendations** — Priority-ordered by effort: quick fixes (hours) / medium (days) / larger (weeks).

**Report rules:** Don't pad — if a flow is smooth, say so in one line. Note items requiring a running app as "verify in running app."

---

## Chat Summary (Required)

Print directly in conversation — don't make the user open the file.

1. **Status Line** — One sentence: what you did.
2. **Key Findings** — Most important friction points, specific and actionable.
3. **Recommendations** (only if warranted):

| # | Recommendation | Impact | Risk if Ignored | Worth Doing? | Details |
|---|---|---|---|---|---|
| *#* | *≤10 words* | *What improves* | *Low/Med/High/Critical* | *Yes/Probably/Only if time* | *1–3 sentences* |

Order by risk descending. Be honest in "Worth Doing?" — if marginal, say so.

4. **Report Location** — Full file path.`,
  },
  {
    number: 27,
    name: "Feature Discovery",
    prompt: `# Feature Discovery & Opportunity Audit

Read the entire codebase. Identify features, capabilities, and improvements worth building — grounded purely in what exists, what's partial, and what the architecture supports.

**READ-ONLY. No web search. No code changes.**

---

## Rules

- Every recommendation must reference specific files, models, or patterns.
- Distinguish: **natural extensions** (80%+ done), **logical additions** (users would expect), **ambitious opportunities** (differentiators).
- Quality over quantity. 10 well-reasoned opportunities > 50 shallow ones.
- Be honest about effort and maintenance burden. "Add AI" is not a recommendation — specify data, infrastructure, and minimal viable version.
- Don't recommend features that conflict with the product's design intent.
- Prioritize features leveraging existing data/infrastructure over new systems.
- You have all night. Read everything.

---

## Phase 1: Deep Codebase Understanding

**Product model** — What it does, who it serves, every feature, the full data model (entities, relationships, collected data), user roles/permissions, monetization (free/paid/tiers/gating), integrations.

**Architecture capabilities** — Background jobs, notification systems (email/push/in-app/webhooks), file handling, search (full-text/filtering/faceting), real-time (WebSockets/SSE), API surface & patterns, event/audit tracking.

---

## Phase 2: Unfinished & Abandoned Features

**Partially built features** — Look for:
- DB tables/columns with no UI or API exposure
- Models/types defined but unused in routes/components
- Feature flags permanently off (read the guarded code)
- Routes/endpoints not linked from UI; unreachable components/pages
- TODO/FIXME comments describing planned features
- Migrations adding schema for unfinished features
- Config/env vars for unintegrated services

For each: what was it, how far did it get, what would finish it?

**Vestigial infrastructure** — Libraries barely used, notification infra sending only one type, permission systems more granular than needed, underutilized search/webhook/queue systems. These are sunk investment awaiting ROI.

---

## Phase 3: Data-Driven Opportunities

**Inventory all collected data** — User actions/events, timestamps, entity relationships, stored-but-unsurfaced metadata, computed-but-undisplayed aggregations.

**Underutilized data** — Analytics/insights, personalization signals, automation triggers, collaborative signals, historical trends. For each: what data exists → what feature it enables → existing pipeline support → effort.

**Missing data** — Features that need data not yet collected. What's the minimal collection that unlocks the most value?

---

## Phase 4: Pattern-Based Feature Discovery

**Generalization** — Hardcoded reports → report builder. Single notification type → configurable system. Fixed workflow → customizable engine. Single integration → framework. Manual admin → self-service. Single export → multi-format. Fixed views → customizable dashboards.

**Cross-entity features** — Unified search, activity feeds, bulk operations, broad tagging/categorization, universal comments/notes, import/export gaps.

**Power user features** — Keyboard shortcuts, saved filters/views, bulk editing, templates, API access, advanced search, custom fields, scheduled/recurring actions.

**Admin & ops** — Missing admin views, audit logging gaps, user impersonation, data export, usage analytics, health dashboards.

---

## Phase 5: Automation & Intelligence

**Automate manual processes** — Repetitive action patterns (macros), predictable status transitions, inferable data entry, condition-triggered notifications, manual cleanup tasks.

**Smart defaults** — Fields users fill identically, likely next actions, adaptive settings, context-based pre-population.

**AI-augmentable features** — Text generation/summarization, manual classification, semantic search, auto-tagging, NL summaries of data, answering questions from product data. For each: what's augmented, what data feeds it, what infra exists, minimal viable version.

---

## Phase 6: Platform Opportunities

**API-as-product** — Is the API exposable to third parties? What internal capabilities would externals pay for? Could webhook/event patterns power an integration ecosystem?

**Multi-tenancy / white-label** — Tenant-aware data model? Configurable branding? Partner resale/embedding potential?

**Extensibility** — Custom fields/views/workflows? Plugin architecture potential? Natural integration boundaries?

---

## Output

Save as \`audit-reports/FEATURE_DISCOVERY_REPORT_[run-number]_[date].md\`.

### Report Structure

1. **Executive Summary** — Maturity assessment, opportunity count by category, top 5 highest-value, overall untapped potential.

2. **Unfinished Features** — Table: Feature | Evidence (files/tables) | Completion % | Effort to Finish | Value | Recommendation

3. **Underutilized Infrastructure** — Table: Infrastructure | Current Usage | Potential Usage | Effort | Value

4. **Data Opportunities** — Underutilized: Data Available | Feature Enabled | Pipeline Support | Effort | Impact. Missing: Feature Desired | Data Needed | Collection Effort

5. **Feature Opportunities** (main deliverable) — Per feature: Name/description, Category (natural extension / logical addition / ambitious), Evidence (specific code references), Existing foundation (% estimate), Effort (days/weeks/months with specifics), Impact, Dependencies, Priority (Critical / High / Medium / Nice-to-have)

6. **Automation & Intelligence** — Manual→automated, smart defaults, AI opportunities with data/infra grounding.

7. **Platform Opportunities** — API, multi-tenancy, extensibility assessments.

8. **Recommended Build Order** — Priority sequence by dependencies and effort-to-value. Group: quick wins (days), medium (weeks), strategic (months).

---

## Chat Summary (Required)

Print directly in conversation — don't make the user open the report.

1. **Status** — One sentence: what you did.
2. **Key Findings** — Specific, grounded bullets. Lead with value. (e.g., "The \`user_events\` table tracks every action but nothing surfaces it — a dashboard is low-effort since \`jobs/daily_stats.ts\` already aggregates.")
3. **Recommendations** table:

| # | Recommendation | Impact | Risk if Ignored | Worth Doing? | Details |
|---|---|---|---|---|---|
| | ≤10 words | What improves | Low–Critical | Yes / Probably / Only if time | 1–3 sentences |

Order by value descending. Be honest — not everything is worth the engineering time. If nothing worth building was found, say so.

4. **Report Location** — Full path to the detailed report.

If a phase yielded zero findings, say so in one line.`,
  },
  {
    number: 28,
    name: "Strategic Discovery",
    prompt: `# Strategic Discovery Night

## Prompt

\`\`\`
You are running an overnight strategic analysis of this codebase. You have several hours. Unlike the other overnight runs, this one is less about fixing things and more about discovering opportunities — competitive gaps, feature ideas, and architectural possibilities the team may not have considered.

This is a read-only analysis. Do not create a branch or modify any code.

## Your Mission

### Phase 1: Product Understanding

Before you can identify opportunities, you need to deeply understand what this product does and who it serves.

**Step 1: Reverse-engineer the product**
By reading the codebase, answer:
- What is this product? What problem does it solve?
- Who are the target users? (Infer from UI copy, feature set, data models, onboarding flows)
- What are the core features? List every distinct capability.
- What is the current user journey? (Sign up → onboarding → core usage → retention/engagement loops)
- What data does the product collect and how is it used?
- What integrations exist? (Third-party services, APIs, webhooks)
- What is the monetization model? (Infer from billing code, subscription logic, feature gating)
- What features are gated behind plans/tiers? What's free vs. paid?

**Step 2: Identify the product's strengths**
Based on the codebase:
- What features appear most mature and well-built?
- Where has the most engineering investment gone?
- What seems to be the core differentiator?

**Step 3: Identify the product's weaknesses**
Based on the codebase:
- What features feel half-built or abandoned? (Incomplete code, unused models, feature flags that are off)
- Where is the UX weakest?
- What capabilities are missing that users would likely expect?
- What data is collected but not used to provide value back to users?

### Phase 2: Competitive & Market Research

**Step 1: Identify competitors**
Based on your understanding of the product:
- Search the web for direct competitors (products solving the same problem)
- Search for indirect competitors (different approaches to the same underlying need)
- Search for adjacent products (solve a related problem, might expand into this space)

**Step 2: Analyze competitor features**
For the top 5-8 competitors:
- What features do they offer that this product doesn't?
- What features does this product have that they don't?
- How do they position themselves? (Read their marketing pages, pricing pages)
- What do their users complain about? (Search for reviews, Reddit threads, G2/Capterra reviews, Twitter complaints)
- What are they charging? How does their pricing model compare?
- What recent features have they launched? (Check their changelogs, blogs, social media)

**Step 3: Identify market trends**
- Search for recent industry analysis, trend reports, or thought leadership in this product's space
- What capabilities are becoming table stakes?
- What emerging technologies are competitors adopting?
- What are users in this space increasingly expecting?

### Phase 3: Feature Opportunity Analysis

**Step 1: Gap analysis**
Based on Phases 1 and 2, identify features this product is missing:

For each missing feature:
- What is it?
- Which competitors have it?
- How important is it to users? (Based on competitor reviews, user complaints, market trends)
- How hard would it be to build? (Based on the existing codebase architecture — is the foundation there, or would it require significant new infrastructure?)
- Priority recommendation: critical / high / medium / nice-to-have

**Step 2: Untapped data opportunities**
Look at the data the product already collects:
- What analytics or insights could be derived from existing data that aren't being surfaced to users?
- What personalization opportunities exist based on user behavior data?
- What automation could be triggered by patterns in the data?
- What reporting/dashboards could be built from existing data?

**Step 3: Integration opportunities**
- What third-party services would complement this product?
- What integration points exist in the codebase that aren't being used to their full potential?
- What workflows would benefit from connecting to other tools (Slack, email, calendar, CRM, etc.)?

**Step 4: UX improvement opportunities**
Based on your codebase analysis:
- Where are users likely experiencing friction? (Complex forms, multi-step processes, confusing navigation)
- What tasks take too many steps that could be simplified?
- Where could AI/automation reduce manual work for users?
- What onboarding improvements would help new users get value faster?

### Phase 4: Architectural Opportunity Analysis

**Step 1: Scalability assessment**
- What would break first if the user base 10x'd?
- Are there architectural bottlenecks that would need to be addressed?
- What's the current approach to background jobs, queuing, caching?
- Is the database schema ready for growth? (Missing indexes, inefficient queries, tables that would get too large)

**Step 2: Platform/extensibility opportunities**
- Could this product benefit from a plugin/extension system?
- Could parts of this product be exposed as an API for third-party developers?
- Is there a marketplace or ecosystem opportunity?
- Could the product support white-labeling or multi-tenancy?

**Step 3: AI integration opportunities**
Look at the codebase through an AI lens:
- What manual processes could be augmented or automated with AI?
- Where could AI improve the user experience? (Smart defaults, auto-categorization, natural language search, recommendations, content generation)
- What data does the product have that could train useful models?
- What would an "AI-first" version of this product look like?

## Output Requirements

Create the \`audit-reports/\` directory in the project root if it doesn't already exist. Save the report as \`audit-reports/STRATEGIC_DISCOVERY_REPORT_[run-number]_[date].md\` (e.g., \`STRATEGIC_DISCOVERY_REPORT_01_2026-02-16.md\`). Increment the run number based on any existing reports with the same name prefix in that folder.

### Report Structure

1. **Product Profile**
   - What the product is and does (as understood from the codebase)
   - Target users
   - Core features inventory
   - Strengths and weaknesses
   - Current monetization model

2. **Competitive Landscape**
   - Competitor matrix: table with | Competitor | Overlap | Unique Strengths | Weaknesses | Pricing |
   - What competitors are doing that this product isn't
   - What this product does better than competitors
   - Market trends affecting this space

3. **Feature Opportunities**
   Prioritized list, for each:
   - Feature description
   - User need it addresses
   - Competitive context (who has it, is it table stakes?)
   - Implementation complexity (based on current architecture)
   - Priority: Critical / High / Medium / Nice-to-have
   - Estimated effort: Small (days) / Medium (weeks) / Large (months)

4. **Untapped Data & Intelligence**
   - Data currently collected but underutilized
   - Analytics/insights that could be surfaced
   - Personalization opportunities
   - Automation triggers

5. **Integration & Ecosystem Opportunities**
   - Third-party integrations worth building
   - API/platform possibilities
   - Ecosystem plays

6. **AI Integration Roadmap**
   - AI opportunities ranked by impact and feasibility
   - What data assets exist to support AI features
   - Quick AI wins vs. larger AI initiatives

7. **Architectural Recommendations**
   - Scalability concerns and suggested remediation
   - Platform/extensibility opportunities
   - Technical investments that would unlock future product capabilities

8. **Recommended Roadmap**
   - Synthesize all findings into a suggested priority order
   - Group into: This quarter / Next quarter / Future
   - Note dependencies between items

## Rules
- This is READ-ONLY. Do not modify any code.
- Use web search to research competitors, market trends, and user feedback
- Be honest about uncertainty — mark items as "needs validation" when you're inferring rather than knowing
- Don't just list every possible feature — prioritize ruthlessly based on user impact and implementation feasibility
- When assessing implementation complexity, be specific about what exists in the codebase vs. what would need to be built
- Ground your recommendations in evidence (competitor data, user feedback, market trends, codebase analysis) — not just opinions
- Consider both quick wins and strategic bets
- Think like a product manager AND an engineer — the best opportunities are at the intersection of user value and technical feasibility
- You have all night. Do thorough research.
\`\`\`

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

---

**Formatting rules for chat output:**
- Use markdown headers, bold for severity labels, and bullet points for scannability.
- Do not duplicate the full report contents — just the highlights and recommendations.
- If you made zero findings in a phase, say so in one line rather than omitting it silently.`,
  },
];

export const DOC_UPDATE_PROMPT = `Please update any and all documentation (if necessary) so future AIs know about these changes (only if it will be value-add information to them) and do a git commit/merge.`;

export const CHANGELOG_PROMPT = `You just finished an overnight codebase improvement run. Your job now is to write a plain-English summary of everything that changed — written for someone who is NOT a developer.

Review the full git log and diffs for this run (all commits on this branch). Then write a summary that:

1. Uses first person ("I") as if you personally worked on the codebase overnight
2. Uses zero jargon — explain everything in terms a non-technical person would understand
3. References SPECIFIC numbers from the actual changes (e.g., "I added 47 tests" not "I improved test coverage"; "I removed 1,200 lines of code that weren't being used" not "I cleaned up dead code")
4. Groups related changes into short, friendly paragraphs — don't use bullet points or headers
5. Leads with the most impressive or valuable changes first
6. Keeps the tone warm and slightly proud of the work done — like a helpful colleague leaving a note about what they accomplished overnight
7. Ends with a brief honest note about anything that didn't go as planned (steps that failed or were skipped), framed constructively
8. Is no longer than 400 words — concise and scannable

DO NOT use any of these words: refactor, lint, dependency, CI/CD, middleware, endpoint, schema, migration, module, pipeline, coverage metrics, regression, assertion, deprecation.

Instead of technical terms, describe what the change DOES for the person: "I made sure your login page can't be tricked into running malicious code" instead of "I fixed an XSS vulnerability in the auth middleware."

The summary should make a non-technical person feel genuinely excited about the improvements and confident that their codebase is in better shape — without needing to understand a single technical concept.

Output ONLY the summary text. No headers, no markdown formatting, no preamble.`;
