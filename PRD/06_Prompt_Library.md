# Prompt Library

## Overview

Houses all prompts NightyTidy sends to Claude Code: the 28 improvement step prompts, the documentation update prompt (run after every step), and the narrated changelog prompt (run once at the end). Prompts are hardcoded in `src/prompts/steps.js` — no YAML, no config files, no user customization.

## Dependencies

- `05_Claude_Code_Integration.md` — prompts are consumed by `runPrompt()`
- External: Google Doc containing the 28 prompts (see below)

## Module: `src/prompts/steps.js`

### Data Structure

Export a single array of 28 step objects:

```javascript
export const STEPS = [
  {
    number: 1,
    name: "Documentation",
    prompt: "...full prompt text..."
  },
  {
    number: 2,
    name: "Test Coverage",
    prompt: "...full prompt text..."
  },
  // ... through step 28
];
```

Each step has:

| Field | Type | Description |
|-------|------|-------------|
| `number` | number | 1-28, sequential |
| `name` | string | Short display name for the step selector and logs (e.g., "Documentation", "Test Coverage", "File Decomposition") |
| `prompt` | string | The full prompt text sent to Claude Code via `claude -p` |

### The 28 Improvement Prompts — Source

**Source document**: [Google Doc](https://docs.google.com/document/d/1NRYDOq0IYcaQ4s_dyXszwFrC1d0z56QjaDkw8ndYIhM/edit?usp=sharing)

**Build instruction for Claude Code**: When building `src/prompts/steps.js`, pull the prompts directly from this Google Doc. Each prompt in the doc corresponds to one step. Extract:
1. The step number (1-28)
2. A short display name derived from the prompt's primary focus
3. The full prompt text exactly as written — do not edit, shorten, or paraphrase

**Why hardcoded**: The prompts are the core product. They shouldn't be editable by end users — accidental modifications would degrade the experience. Updating prompts means updating the source code and releasing a new version.

### Documentation Update Prompt

Run after every improvement step completes. Handles both documentation updates and the git commit. This is a separate export:

```javascript
export const DOC_UPDATE_PROMPT = `Please update any and all documentation (if necessary) so future AIs know about these changes (only if it will be value-add information to them) and do a git commit/merge.`;
```

**Behavior**: Claude Code receives this prompt in a fresh session in the same project directory. It reviews what changed (via git diff or file inspection), updates docs if warranted, and commits. The commit message is Claude Code's choice — NightyTidy doesn't dictate it.

**Why a fresh session**: Each `claude -p` invocation is stateless. The doc update prompt runs in a new session that sees the filesystem as modified by the previous step. It doesn't have conversation context from the improvement step — it discovers changes by examining the codebase.

### Narrated Changelog Prompt

Run once at the very end of the full run. Generates the plain-English summary that opens `NIGHTYTIDY-REPORT.md`. Separate export:

```javascript
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
```

This prompt is the single most important piece of UX in the entire tool. Iterate on it during testing — the tone, specificity, and jargon-avoidance directly determine whether users feel the value of a run.

### Prompt Length Considerations

- Most improvement prompts from the Google Doc are expected to be 500-3,000 characters
- The narrated changelog prompt above is ~1,500 characters
- The doc update prompt is ~170 characters
- If any prompt exceeds 8,000 characters, the Claude Code integration module (`src/claude.js`) automatically switches from `-p` argument to stdin delivery. See `05_Claude_Code_Integration.md`.

### Step Display Names

The `name` field appears in:
1. The interactive step selector (Inquirer checkbox)
2. The terminal spinner during execution
3. Log entries
4. The summary report
5. Desktop notifications on failure

Keep names short (1-3 words), descriptive, and non-technical:

Examples (actual names should be derived from the Google Doc content):
- "Documentation"
- "Test Coverage"
- "Test Hardening"
- "Security Audit"
- "Dead Code Cleanup"
- "File Decomposition"
- "Performance Optimization"
- "Error Handling"
- "Code Formatting"
- "Naming Conventions"

Avoid jargon — these names are seen by vibe coders. "Dead Code Cleanup" over "Tree Shaking", "Security Audit" over "SAST Analysis".

## Testing Notes

- Verify `STEPS` array has exactly 28 entries
- Verify each entry has `number`, `name`, and `prompt` fields
- Verify numbers are sequential 1-28
- Verify no prompt is empty
- Verify `DOC_UPDATE_PROMPT` and `CHANGELOG_PROMPT` are non-empty strings
- No need to test prompt content quality — that's validated via manual Claude Code runs

## Gaps & Assumptions

- **The 28 prompts are not in this document.** They live in the Google Doc and must be pulled during development. This file defines the container; the Google Doc provides the content.
- **Prompt versioning** — No mechanism to track which version of the prompts was used in a given run. If prompts are updated between NightyTidy versions, old runs can't be compared to new ones. Acceptable for MVP.
- **Prompt ordering** — Steps are run in the order defined in the array (1-28). The PRD doesn't specify whether this order is significant. Assume it is — the Google Doc's ordering is intentional and should be preserved.
