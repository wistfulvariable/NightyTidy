# Report Generation — Tier 2 Reference

Assumes CLAUDE.md loaded. Report logic in `src/report.js`.

## Exports

| Function | Purpose |
|----------|---------|
| `generateReport(results, narration, metadata)` | Writes NIGHTYTIDY-REPORT.md + updates CLAUDE.md |
| `formatDuration(ms)` | Format milliseconds to human-readable string |
| `getVersion()` | Returns version from package.json (lazy-cached, defaults to '0.1.0' on error) |

## Report Structure (NIGHTYTIDY-REPORT.md)

```markdown
# NightyTidy Report — YYYY-MM-DD

[Narration or fallback paragraph]

---

## Run Summary
- Date, Duration, Steps completed/failed, Branch, Safety tag

## Step Results
| # | Step | Status | Duration | Attempts |

## Failed Steps          ← Only if failedCount > 0
### Step N: Name
- Error, Attempts, Suggestion

## How to Undo This Run
- Claude Code instruction + git command
```

## Narration Handling

- Truthy `narration` param → use as-is
- Null/empty → `fallbackNarration(results)` generates generic paragraph with step counts

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

## Metadata Shape

```js
{ projectDir, branchName, tagName, originalBranch, startTime, endTime }
```

All strings except `startTime`/`endTime` (numbers from `Date.now()`).

## Error Handling

- `getVersion()` swallows read errors → defaults to '0.1.0'
- `updateClaudeMd()` wraps in try/catch → warns but never throws
- `generateReport()` overall: warns but never throws (per error contract)
