You just completed a multi-step automated codebase improvement run. Below are the outputs from each step — what was analyzed, changed, and recommended.

Your task is to produce a **consolidated, prioritized action plan** split into two sections:
1. **Refactors** — improvements the AI can do automatically without human judgment
2. **Human Review** — features, UI/UX changes, and product decisions requiring human input

## Instructions

1. Review each step's output to extract actionable recommendations, suggestions, and identified issues.
2. **Check the current codebase** — read the relevant files to determine which recommendations have ALREADY been implemented by previous steps in this run.
3. **Deduplicate** — if multiple steps flagged the same issue, consolidate into one recommendation.
4. **Categorize** each item:
   - **Refactors**: Code cleanup, bug fixes, security patches, performance improvements, test additions, error handling, architectural improvements — anything that has a clear "right answer" and can be implemented without product decisions.
   - **Human Review**: New features, UI/UX changes, workflow modifications, user-facing behavior changes, product strategy suggestions — anything that requires understanding user needs or making trade-offs that affect the product direction.
5. **Prioritize** within each section by importance (Critical → High → Medium → Low).
6. Output the action plan in the exact format below.

## Output Format

```markdown
# NightyTidy Action Plan

> Generated from a {N}-step improvement run. Items below have been verified as **not yet implemented** in the current codebase.

## Recommended Refactors

These improvements have clear implementations and can be done automatically in a future run.

### Critical
<!-- Security vulnerabilities, data loss risks, breaking bugs -->
(items or "No items at this priority level.")

### High
<!-- Reliability, performance, error handling, code quality gaps -->
(items)

### Medium
<!-- Maintainability, test coverage, architectural improvements -->
(items)

### Low
<!-- Polish, style, minor optimizations -->
(items)

---

## Requires Human Review

These suggestions involve product decisions, user experience changes, or feature additions that need human judgment.

### [Short, specific title]
- **What**: [Concrete suggestion — reference specific areas or user flows]
- **Why**: [The problem this solves or opportunity it creates]
- **Trade-offs**: [What considerations or decisions are involved]
- **Effort**: [Small / Medium / Large — rough implementation scope]

(repeat for each item, ordered by potential value)

---

## Summary

[One sentence on overall codebase health. One sentence on the top refactor priority. One sentence on the most valuable human-review item.]
```

## Item Formats

**For Refactors** (each item):
- **[Short, specific title]**: [Concrete action — reference specific files, functions, or patterns]. Value: [Why this matters]. Impact: [Which areas affected]. Risk: [Low/Medium/High].

**For Human Review** (each item):
### [Short, specific title]
- **What**: [Concrete suggestion]
- **Why**: [Problem or opportunity]
- **Trade-offs**: [Decisions involved]
- **Effort**: [Small/Medium/Large]

## Rules

- Do NOT include anything already implemented in the codebase — verify by reading files.
- Do NOT include vague advice like "add more tests" — be specific about WHAT to test and WHERE.
- Each recommendation MUST reference specific files, functions, or code patterns.
- Deduplicate ruthlessly — one item per distinct issue, even if multiple steps found it.
- Include ALL items — no limits. The human needs the complete list for easy copy-paste.
- If a section has zero items, include the heading with a note: *No items in this category.*
- Output ONLY the markdown document. No preamble, no commentary, no code fences wrapping the whole document.
