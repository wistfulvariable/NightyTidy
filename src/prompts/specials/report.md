You are generating the final run report for a NightyTidy codebase improvement run. You will be given:

1. Pre-built markdown sections (summary table, step results, failed steps, undo instructions) — include these VERBATIM
2. Step outputs from the improvement run — use these to generate the action plan section
3. The report filename to write to

Your job is to produce a single markdown file that combines a human-friendly narration with the pre-built sections and an action plan.

## Part 1: Narration

Review the full git log and diffs for this run (all commits on this branch). Write a plain-English summary that:

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

## Part 2: Action Plan

Review the step outputs provided below to extract actionable recommendations that still need to be done. Split them into two categories:

1. **Recommended Refactors** — improvements with clear implementations that can be automated
2. **Requires Human Review** — features, UI/UX changes, and product decisions needing human input

### Instructions

1. Review each step's output to extract actionable recommendations, suggestions, and identified issues.
2. **Check the current codebase** — read the relevant files to determine which recommendations have ALREADY been implemented by previous steps in this run.
3. **Deduplicate** — if multiple steps flagged the same issue, consolidate into one recommendation.
4. **Categorize** each item:
   - **Refactors**: Code cleanup, bug fixes, security patches, performance improvements, test additions, error handling, architectural improvements — anything with a clear "right answer" that can be implemented without product decisions.
   - **Human Review**: New features, UI/UX changes, workflow modifications, user-facing behavior changes, product strategy suggestions — anything requiring understanding user needs or making trade-offs.
5. **Prioritize** refactors by importance (Critical → High → Medium → Low). Order human review items by potential value.

Structure the action plan as:

```
## NightyTidy Action Plan

> Generated from a {N}-step improvement run. Items below have been verified as **not yet implemented** in the current codebase.

### Recommended Refactors

These improvements have clear implementations and can be done automatically in a future run.

#### Critical
<!-- Security vulnerabilities, data loss risks, breaking bugs -->
(items or "No items at this priority level.")

#### High
<!-- Reliability, performance, error handling, code quality gaps -->
(items)

#### Medium
<!-- Maintainability, test coverage, architectural improvements -->
(items)

#### Low
<!-- Polish, style, minor optimizations -->
(items)

---

### Requires Human Review

These suggestions involve product decisions, user experience changes, or feature additions that need human judgment.

(items ordered by potential value)

---

### Summary
[One sentence on overall codebase health. One sentence on the top refactor priority. One sentence on the most valuable human-review item.]
```

**Refactor item format:**
- **[Short, specific title]**: [Concrete action — reference specific files, functions, or patterns]. Value: [Why this matters]. Impact: [Which areas affected]. Risk: [Low/Medium/High].

**Human Review item format:**
- **[Short, specific title]**: [Concrete suggestion]. Why: [Problem or opportunity]. Trade-offs: [Decisions involved]. Effort: [Small/Medium/Large].

Rules:
- Do NOT include anything already implemented — verify by reading files
- Be specific — reference files, functions, patterns. No vague advice like "add more tests"
- Include ALL items — no limits. The human needs the complete list for easy copy-paste
- Deduplicate ruthlessly

## Part 3: Write the Report File

Write the complete report to the file specified below. Use this exact structure:

```
# NightyTidy Report — {date}

{your narration from Part 1}

---

{VERBATIM summary section}
{VERBATIM step results table}
{VERBATIM failed steps section, if present}

{your action plan from Part 2}

{VERBATIM undo section}
```

Rules:
1. The pre-built sections below are wrapped in VERBATIM markers. Copy them EXACTLY as-is into the output file. Do not reformat, reword, or restructure them.
2. Write the complete report to the exact filename specified.
3. Commit the file with message: "NightyTidy: Add run report"
4. Do NOT start the narration with any preamble ("I understand", "Sure", "Here is", etc.). Begin with the first word of your actual summary.
