# Report Generation — Tier 2 Reference

Assumes CLAUDE.md loaded. Report logic in `src/report.js` (145 lines).

## Exports

| Function | Purpose |
|----------|---------|
| `generateReport(results, narration, metadata)` | Writes NIGHTYTIDY-REPORT.md + updates CLAUDE.md |
| `formatDuration(ms)` | Format milliseconds to human-readable string |

## Report Structure (NIGHTYTIDY-REPORT.md)

```markdown
# NightyTidy Report — YYYY-MM-DD

[Narration or fallback paragraph]

---

## Run Summary
- Date, Duration, Steps completed/failed, Branch, Safety tag

## Step Results
| # | Step | Status | Duration | Attempts |

## Failed Steps          ← Only present if failedCount > 0
### Step N: Name
- Error, Attempts, Suggestion

## How to Undo This Run
- Claude Code instruction + git command
```

## Narration Handling

- If `narration` param is truthy → use it as-is
- If null/empty → `fallbackNarration(results)` generates a generic paragraph
- Fallback mentions step counts and suggests checking the log

## CLAUDE.md Auto-Update

`updateClaudeMd(metadata)` appends/replaces a `## NightyTidy — Last Run` section:

```markdown
## NightyTidy — Last Run

Last run: YYYY-MM-DD. To undo, reset to git tag `nightytidy-before-*`.
```

Logic:
1. If CLAUDE.md exists and contains `## NightyTidy`:
   - Find marker index, find next `\n## ` after it
   - Replace that section (preserves content before and after)
2. If exists but no marker → append section at end
3. If doesn't exist → create new file with just the section

## formatDuration(ms)

- `>= 1 hour`: `"Xh YYm"` (minutes zero-padded)
- `< 1 hour`: `"Xm YYs"` (seconds zero-padded)
- Example: `3720000` → `"1h 02m"`, `30000` → `"0m 30s"`

**Note**: `cli.js` imports `formatDuration` from `report.js` for its terminal summary (consolidated — no longer duplicated).

## Metadata Shape

`{ projectDir, branchName, tagName, originalBranch, startTime, endTime }` — all strings except timestamps (numbers from `Date.now()`).

## Error Handling

- `updateClaudeMd` wraps everything in try/catch → warns but never throws
- `report.js` overall: warns but never throws (per error contract in CLAUDE.md)
