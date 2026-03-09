# Audit #01 — Documentation Review

**Date**: 2026-03-09
**Auditor**: Claude Opus 4.6
**Scope**: Full documentation system (CLAUDE.md, MEMORY.md, .claude/memory/*.md)

---

## Executive Summary

NightyTidy's documentation system is **well-structured and largely accurate**. The three-tier model is properly implemented with clear loading boundaries. The `check-docs-freshness.js` CI script catches structural drift automatically. However, several factual inaccuracies, stale LOC counts, and two memory files exceeding size targets were found.

**Verdict**: Good documentation system with minor maintenance debt. No architectural issues.

---

## Tier Assessment

### Tier 1: CLAUDE.md (Always Loaded)

**File**: `CLAUDE.md` — 344 lines (target: 250-350)
**Status**: At upper boundary of target range

| Criterion | Rating | Notes |
|-----------|--------|-------|
| Accuracy | B+ | Several factual inaccuracies found (see below) |
| Completeness | A | All modules, commands, conventions covered |
| Conciseness | B | Could trim some sections; near 350-line ceiling |
| Prevents mistakes | A | Error contracts, init sequence, "What NOT to Do" are excellent |
| Token efficiency | B+ | ~10,700 tokens (~5.4% of 200K window) — within 5-7% target |

#### Factual Inaccuracies Found

1. **Pre-check count**: Module map says "6 checks" but `checks.js` has 7 checks (git installed, git repo, has commits, claude installed, claude authenticated, disk space, existing branches).

2. **EPHEMERAL_FILES mismatch**: `git-workflow.md` documents 3 ephemeral files but `git.js` actually has 4 — `nightytidy-run-state.json` was added but the memory file was not updated.

3. **LOC counts are stale**: Several approximate LOC counts in the Project Structure section are outdated:
   - `dashboard.js` documented as "~230 LOC" — actual: 283 lines
   - `orchestrator.js` documented as "~400 LOC" — actual: 422 lines
   - `dashboard-html.js` documented as "~410 LOC" — actual: 483 lines
   - `dashboard-standalone.js` documented as "~100 LOC" — actual: 136 lines
   - `lock.js` documented as "~100 LOC" — actual: 118 lines
   - `logger.js` documented as "~50 LOC" — actual: 54 lines (close enough)
   - `cli.js` documented as "~450 LOC" in cli-lifecycle.md — actual: 536 lines

4. **`fallbackCommit` pathspec claim is stale**: CLAUDE.md git-workflow section says `fallbackCommit()` uses `:!file` pathspec exclusions. The code was refactored — it now does plain `git add -A` and relies on `.git/info/exclude`. The code comment in `git.js` line 107 explicitly says "Do NOT use `:!` pathspec exclusions".

5. **Test count in MEMORY.md**: Says "188 (17 test files)" — actual: 359 tests, 24 files. This is severely out of date.

6. **`cli-lifecycle.md` --all flag**: Says "Run all 28 steps" — should be 33 steps.

7. **Pre-checks count in `cli-lifecycle.md`**: Says "7 checks" — the actual code has 7 (git, repo, commits, claude installed, claude auth, disk space, existing branches). The Module Map in CLAUDE.md says "6 checks". These are inconsistent.

8. **`executor-loop.md` import reference**: Says `DOC_UPDATE_PROMPT` is from `prompts/steps.js` — should be `prompts/loader.js`.

9. **`executor-loop.md` LOC count**: Says "105 lines" — actual: 143 lines.

10. **`git-workflow.md` LOC count**: Says "143 lines" — actual: 144 lines (trivial but noted).

11. **`git-workflow.md` RETRY_LIMIT constant**: Documents a constant `RETRY_LIMIT = 10`. The code uses `MAX_NAME_RETRIES = 10`. Name mismatch.

### Tier 2: Memory Files (On-Demand)

**Directory**: `.claude/memory/` — 9 topic files + 1 index
**Total**: 687 lines across all files

| File | Lines | Target (30-80) | Status |
|------|-------|-----------------|--------|
| `MEMORY.md` | 38 | index file | OK |
| `testing.md` | 88 | 30-80 | OVER (8 lines) |
| `prompts.md` | 64 | 30-80 | OK |
| `git-workflow.md` | 64 | 30-80 | OK |
| `cli-lifecycle.md` | 73 | 30-80 | OK |
| `claude-integration.md` | 57 | 30-80 | OK |
| `executor-loop.md` | 76 | 30-80 | OK |
| `dashboard.md` | 94 | 30-80 | OVER (14 lines) |
| `report-generation.md` | 71 | 30-80 | OK |
| `pitfalls.md` | 62 | 30-80 | OK |

#### Issues

1. **`testing.md`** at 88 lines — exceeds 80-line target. The test file table is comprehensive but could be trimmed by removing the "Type" column.

2. **`dashboard.md`** at 94 lines — significantly exceeds 80-line target. The "Orchestrator Mode Dashboard" section at the bottom could be folded into the main constants/exports tables to reduce length.

3. **MEMORY.md index is stale**: Reports "188 (17 test files)" for test count and "Last major change: GitHub-readiness". Multiple sessions of work have occurred since then (orchestrator mode, GUI, prompts refactor).

4. **Missing topic coverage**: The GUI module (`gui/server.js`, `gui/resources/logic.js`, `gui/resources/app.js`) has no dedicated memory file. While the CLAUDE.md module map covers it, there's no Tier 2 reference for GUI-specific patterns.

### Tier 3: Human-Facing Reference

**Files**: `docs/ERROR_MESSAGES.md`, `00_README.md`..`14_*.md` (PRD docs)
**Status**: Referenced in CLAUDE.md conventions but not auto-loaded — correct per design.

No issues found at this tier.

---

## Documentation System Architecture

### Strengths

1. **CI-enforced freshness**: `check-docs-freshness.js` verifies test file count, module map coverage, memory file index, sub-memory table sync, and step count. This is an excellent automated guard.

2. **Clear loading boundaries**: CLAUDE.md (always), memory files (on demand), PRD docs (never). The "When to load" table in CLAUDE.md makes it easy to know which file to consult.

3. **Error contract table**: The error handling strategy table is one of the most valuable sections — it prevents a common class of mistakes.

4. **Documentation hierarchy rules**: The placement decision matrix ("Prevents mistakes on unrelated tasks -> CLAUDE.md") is well-articulated.

5. **Terse, imperative format**: Memory files use tables and bullets consistently. No prose bloat.

### Weaknesses

1. **LOC counts are maintenance overhead**: Approximate line counts in the Project Structure section (e.g., "~230 LOC") create ongoing accuracy debt. They provide marginal value — a developer can check file size trivially.

2. **No freshness check for LOC counts or test counts per file**: The CI checker validates structural counts (test file count, module count, memory file count) but not the per-file test counts documented in CLAUDE.md and testing.md.

3. **MEMORY.md is a single-point-of-failure index**: If it goes stale (as it has), all "Current State" and "Recent Changes" info becomes misleading. The CI check only validates that the topic file names match — not that the content stats are correct.

4. **Duplicate information between CLAUDE.md and memory files**: The test file table appears in both CLAUDE.md (Project Structure) and testing.md (Test File table). When a test file is added, both must be updated.

---

## Recommended Actions

### Must Fix (accuracy)

1. Fix pre-check count: "6 checks" -> "7 checks" in CLAUDE.md module map
2. Fix MEMORY.md stale stats: test count 188 -> 359, file count 17 -> 24
3. Fix cli-lifecycle.md: "--all" runs 33 steps, not 28
4. Fix executor-loop.md: import reference `prompts/steps.js` -> `prompts/loader.js`
5. Fix executor-loop.md: LOC "105 lines" -> remove or update
6. Fix git-workflow.md: EPHEMERAL_FILES list (add `nightytidy-run-state.json`)
7. Fix git-workflow.md: constant name `RETRY_LIMIT` -> `MAX_NAME_RETRIES`
8. Fix `fallbackCommit` pathspec claim in git-workflow.md (`:!file` is no longer used)

### Should Fix (size/staleness)

9. Trim `testing.md` to under 80 lines
10. Trim `dashboard.md` to under 80 lines
11. Remove approximate LOC counts from CLAUDE.md Project Structure section — they create maintenance debt with little value
12. Update MEMORY.md "Current State" and "Recent Changes" sections

### Consider (nice-to-have)

13. Add a `gui.md` memory file for GUI-specific patterns (when GUI work becomes more frequent)
14. Add per-file test count to the CI freshness checker to prevent the "188 tests" drift from recurring

---

## Token Cost Analysis

| Document | Lines | Est. Tokens | % of 200K |
|----------|-------|-------------|-----------|
| CLAUDE.md | 344 | ~10,700 | 5.4% |
| MEMORY.md (index) | 38 | ~1,200 | 0.6% |
| **Tier 1 total** | **382** | **~11,900** | **6.0%** |
| Average Tier 2 file | ~70 | ~2,200 | 1.1% |
| All Tier 2 files | 649 | ~20,100 | 10.1% |

Tier 1 at 6.0% of context is within the 5-7% target. Individual Tier 2 files at ~1.1% are within the ~1-2% target. The system is well-calibrated for token efficiency.

---

*Audit completed 2026-03-09 by Claude Opus 4.6*
