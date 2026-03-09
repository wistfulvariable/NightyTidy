You just completed a multi-step automated codebase improvement run. Below are the outputs from each step — what was analyzed, changed, and recommended.

Your task is to produce a **consolidated, prioritized action plan** of recommendations that still need to be done.

## Instructions

1. Review each step's output to extract actionable recommendations, suggestions, and identified issues.
2. **Check the current codebase** — read the relevant files to determine which recommendations have ALREADY been implemented by previous steps in this run.
3. **Deduplicate** — if multiple steps flagged the same issue, consolidate into one recommendation.
4. **Tier** the remaining (not-yet-implemented) items by importance.
5. Output the action plan in the exact format below.

## Output Format

```markdown
# NightyTidy Action Plan

> Generated from a {N}-step improvement run. Items below have been verified as **not yet implemented** in the current codebase.

## Critical

<!-- Security vulnerabilities, data loss risks, breaking bugs, blocking issues -->

### [Short, specific title]
- **What**: [Concrete action — reference specific files, functions, or patterns]
- **Value**: [Why this matters — plain language, one sentence]
- **Impact**: [Which files/modules/areas are affected]
- **Risk**: [Low / Medium / High — risk of implementing this change, and why]

## High

<!-- Reliability, performance, error handling, significant code quality gaps -->

(same item format)

## Medium

<!-- Maintainability, test coverage gaps, refactoring opportunities, minor UX issues -->

(same item format)

## Low

<!-- Polish, style improvements, nice-to-haves, minor optimizations -->

(same item format)

## Summary

[One sentence on overall codebase health. One sentence on the single highest-value next action.]
```

## Rules

- Do NOT include anything already implemented in the codebase — verify by reading files.
- Do NOT include vague advice like "add more tests" — be specific about WHAT to test and WHERE.
- Each recommendation MUST reference specific files, functions, or code patterns.
- Deduplicate ruthlessly — one item per distinct issue, even if multiple steps found it.
- Maximum **5 items per tier** (20 items total). Prioritize ruthlessly.
- If a tier has zero items, include the heading with a note: *No items at this priority level.*
- Output ONLY the markdown document. No preamble, no commentary, no code fences wrapping the whole document.
