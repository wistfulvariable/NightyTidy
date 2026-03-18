# Report Generation — Tier 2 Reference

Assumes CLAUDE.md loaded. Report logic in `src/report.js`, action plan logic in `src/consolidation.js`.

## Exports

| Function | Purpose |
|----------|---------|
| `generateReport(results, narration, metadata, { actionPlanText, reportFile })` | Writes NIGHTYTIDY-REPORT.md (with inline action plan) + updates CLAUDE.md |
| `cleanNarration(text)` | Strips conversational preamble from AI-generated narration (applied internally by `generateReport`) |
| `formatDuration(ms)` | Format milliseconds to human-readable string |
| `getVersion()` | Returns version from package.json (lazy-cached, defaults to '0.1.0' on error) |
| `buildReportNames(projectDir, startTime)` | Returns `{ reportFile }` with auto-incremented number + timestamp |

## Report Structure (single file — no separate ACTIONS file)

```markdown
# NightyTidy Report — YYYY-MM-DD

[Narration or fallback paragraph]

---

## Run Summary
- Date, Duration, Steps completed/failed, Branch, Safety tag, Total cost (if available)

## Step Results
| # | Step | Status | Duration | Attempts | Cost |  ← Cost column only if any step has cost data

## Failed Steps          ← Only if failedCount > 0
### Step N: Name
- Error, Attempts, Suggestion

## NightyTidy Action Plan ← Inline, only if generated (headings downgraded from consolidation.js output)
### Recommended Refactors (Critical / High / Medium / Low tiers)
### Requires Human Review (features, UI/UX changes needing human judgment)

## How to Undo This Run
- Claude Code instruction + git command
```

## Narration Handling

- `cleanNarration()` strips known conversational preamble patterns ("I understand...", "Sure...", etc.)
- Truthy cleaned narration → use in report
- Null/empty → `fallbackNarration(results)` generates generic paragraph with step counts

## Action Plan Flow

1. `consolidation.js` `generateActionPlan()` calls Claude with step outputs + consolidation prompt
2. Returns raw text with headings downgraded one level (H1→H2, etc.), or `null` on failure
3. `generateReport()` embeds it inline when `actionPlanText` is truthy
4. No separate file is written — everything is in one report

## CLAUDE.md Auto-Update

`updateClaudeMd(metadata)` manages a `## NightyTidy — Last Run` section:

1. CLAUDE.md exists + has marker → find section boundaries, replace in-place
2. CLAUDE.md exists, no marker → append section at end
3. CLAUDE.md doesn't exist → create new file with section

Content: last run date + undo tag reference.

## formatDuration(ms)

- `>= 1 hour`: `"Xh YYm"` (minutes zero-padded)
- `< 1 hour`: `"Xm YYs"` (seconds zero-padded)
- Example: `3720000` → `"1h 02m"`, `30000` → `"0m 30s"`

Imported by `cli.js` for terminal summary (single source — no duplication).

## Error Handling

- `getVersion()` swallows read errors → defaults to '0.1.0'
- `cleanNarration()` returns original text if stripping would leave it empty
- `updateClaudeMd()` wraps in try/catch → warns but never throws
- `generateReport()` overall: warns but never throws (per error contract)
- `generateActionPlan()` returns null on failure — report still generated without action plan
