# Audit #19 — Cost & Resource Optimization Report

**Date**: 2026-03-09
**Scope**: Full codebase analysis — CI/CD costs, dependency bloat, subprocess costs, disk/file waste, development workflow efficiency

---

## Executive Summary

NightyTidy is a local CLI tool with no cloud infrastructure, no database, and no paid APIs (Claude Code handles its own billing). The cost surface is narrow: GitHub Actions CI minutes, npm dependency size, Claude Code subprocess efficiency, and local disk resource management.

**Material findings**: 3 actionable items, 2 informational observations. No critical waste. The codebase is already lean.

---

## Phase 1: CI/CD Costs (GitHub Actions)

### Finding 1: CI Matrix Runs 4 Jobs + 2 Sequential Jobs = 6 Total Per Push

**Current setup** (`.github/workflows/ci.yml`):
- **Test job**: 2x2 matrix (ubuntu-latest, windows-latest) x (Node 20, 22) = **4 parallel jobs**
- **Coverage job**: ubuntu-latest, Node 22, `needs: test` (sequential) = **1 job**
- **Security job**: ubuntu-latest, Node 22 (parallel with test) = **1 job**

**Cost estimate**: GitHub Free tier gives 2,000 minutes/month (Linux) and 2,000 minutes/month (Windows at 2x multiplier). Each push runs:
- 2 Linux test jobs x ~2 min = 4 min
- 2 Windows test jobs x ~3 min = 6 min (billed as 12 min at 2x)
- 1 coverage job x ~3 min = 3 min
- 1 security job x ~1 min = 1 min
- **Total per push: ~20 billed minutes**

At 5 pushes/day over a month: ~3,000 billed minutes. This is within free tier for light usage but could exceed it during active development.

**Assessment**: **Acceptable for current usage**. The matrix is justified -- Windows testing catches real bugs (EBUSY, shell mode, path separators). Node 20 + 22 coverage matches the `engines: ">=20.12.0"` constraint. No changes recommended.

**Future consideration**: If CI minutes become a concern, the security job could run on `schedule` (weekly) instead of every push. Savings: ~1 minute/push.

### Finding 2: Coverage Job Runs Full Test Suite Twice

The `coverage` job (`needs: test`) re-runs all 416 tests with coverage enabled after they already passed in the `test` job. This is intentional -- coverage requires V8 instrumentation that adds overhead and can expose different behavior.

**Assessment**: **Justified**. Separating test and coverage prevents coverage overhead from affecting the main test matrix. The sequential dependency means coverage only runs when tests pass. No change needed.

### Finding 3: No Artifact Retention Configuration

The CI workflow doesn't produce artifacts (no `actions/upload-artifact`), so there's no artifact storage cost. The `paths-ignore` filter correctly skips runs for docs-only changes.

**Assessment**: **Clean**. No waste.

---

## Phase 2: npm Dependency Bloat

### Dependency Size Breakdown

| Package | Disk Size | Type | Justification |
|---------|-----------|------|---------------|
| `node-notifier` | **5.5 MB** | Production | Desktop notifications |
| `simple-git` | 1.2 MB | Production | Git operations |
| `@inquirer/checkbox` | 229 KB | Production | Interactive step selection |
| `commander` | 239 KB | Production | CLI argument parsing |
| `chalk` | 70 KB | Production | Terminal coloring |
| `ora` | 52 KB | Production | Terminal spinners |
| **Total node_modules** | **48 MB** | All | Including devDeps |

### Finding 4: node-notifier Ships 5.4 MB of Vendor Binaries (HIGH-CONFIDENCE)

`node-notifier` bundles platform-specific notification binaries in `vendor/`:
- `notifu/` — Windows (notifu.exe)
- `snoreToast/` — Windows (SnoreToast.exe)
- `mac.noindex/` — macOS (terminal-notifier.app)
- `terminal-notifier-LICENSE`

**Impact**: 5.4 MB of the 5.5 MB package is vendor binaries. On every `npm install`, all binaries for all platforms are downloaded regardless of the user's OS.

**Assessment**: This is a known issue with `node-notifier`. The dependency is justified (desktop notifications are a core UX feature), and there's no lightweight alternative that supports Windows + macOS + Linux with the same reliability. The 5.4 MB is a one-time install cost, not a runtime cost.

**Recommendation**: No change. The `files` field in `package.json` already correctly excludes `node-notifier` from npm publish (only `bin/` and `src/` are published). Users installing NightyTidy globally will incur this cost, but it's a one-time ~5 MB download.

### Finding 5: Production Dependencies Are Minimal and Justified

All 6 production dependencies serve distinct purposes with no overlap:
- `commander` — CLI parsing (no alternative needed)
- `chalk` — Terminal colors (shared by dashboard-tui.js, logger.js)
- `ora` — Spinners (already uses chalk internally, no extra dep)
- `@inquirer/checkbox` — Interactive selection (v5, modern and small)
- `simple-git` — Git wrapper (core functionality)
- `node-notifier` — Desktop notifications (fire-and-forget UX)

**Assessment**: **No bloat**. The dependency set is well-curated.

---

## Phase 3: Claude Code Subprocess Costs

The primary user-facing cost is Claude Code API usage (billed by Anthropic). NightyTidy's subprocess patterns directly affect how much API credit each run consumes.

### Finding 6: Each Step Spawns 2 Claude Calls (Improvement + Doc Update)

In `executor.js`, `executeSingleStep()` runs:
1. The improvement prompt (main work)
2. A doc-update prompt via `--continue` (same session)

The `--continue` flag reuses the session context, which is efficient -- it avoids re-loading the codebase context that Claude Code built during the first call. This is a deliberate optimization.

**Assessment**: **Well-optimized**. The `--continue` pattern saves significant API cost compared to two independent calls.

### Finding 7: Retry Logic (3 Retries = 4 Total Attempts)

`claude.js` defaults to `DEFAULT_RETRIES = 3` (4 total attempts). Each failed attempt is a full Claude Code subprocess invocation.

**Cost analysis**: If a step consistently fails (e.g., API overloaded), retrying 3 times costs 4x the API credit for zero value. However:
- Retries handle transient failures (network blips, rate limits)
- The retry count is configurable via `options.retries`
- 10-second delay between retries reduces thundering herd

**Assessment**: **Reasonable default**. 3 retries is industry standard. The abort signal check between retries prevents wasted retries after user cancellation. No change needed.

### Finding 8: Pre-Check Auth Verification Costs One Claude Code Call

`checkClaudeAuthenticated()` in `checks.js` runs `claude -p "Say OK"` as a fast authentication test. This spawns a full Claude Code session for a 2-word prompt.

**Cost estimate**: Minimal (a few hundred input tokens, ~2 output tokens). This runs once per NightyTidy invocation, not per step.

**Assessment**: **Acceptable**. The cost is negligible compared to the 33-step run that follows. An alternative (`claude --version`) wouldn't verify authentication. No change needed.

### Finding 9: Safety Preamble Prepended to Every Prompt

`SAFETY_PREAMBLE` (193 bytes) is prepended to every step prompt. Over 33 steps + 33 doc-updates = 66 calls, this adds ~12.7 KB of repeated context.

**Assessment**: **Negligible**. 193 bytes per call is trivial compared to step prompts (5-11 KB each). The safety constraints prevent destructive operations and are essential.

---

## Phase 4: Disk/File Waste

### Finding 10: Ephemeral File Cleanup Is Thorough

NightyTidy generates these ephemeral files and handles cleanup:

| File | Created By | Cleaned By | Risk |
|------|-----------|------------|------|
| `nightytidy-run.log` | `logger.js` | Not cleaned (user reference) | Low — single file, small |
| `nightytidy-progress.json` | `dashboard.js`/`orchestrator.js` | `stopDashboard()`/`cleanupDashboard()` | Low |
| `nightytidy-dashboard.url` | `dashboard.js`/`orchestrator.js` | `stopDashboard()`/`cleanupDashboard()` | Low |
| `nightytidy-run-state.json` | `orchestrator.js` | `deleteState()` in `finishRun()` | Low |
| `nightytidy.lock` | `lock.js` | `process.on('exit')` or `releaseLock()` | Low |

All ephemeral files are listed in `.git/info/exclude` via `excludeEphemeralFiles()`. The `.gitignore` also covers them.

**Assessment**: **Clean**. No orphan files. The log file persists intentionally for user debugging.

### Finding 11: Output Buffer Memory Management Is Sound

Both `dashboard.js` and `orchestrator.js` use a 100 KB rolling buffer (`OUTPUT_BUFFER_SIZE`) with 500ms throttled writes. When buffer exceeds 100 KB, it's trimmed from the front:

```javascript
if (buffer.length > OUTPUT_BUFFER_SIZE) {
  buffer = buffer.slice(buffer.length - OUTPUT_BUFFER_SIZE);
}
```

**Assessment**: **Well-bounded**. No unbounded growth. The `String.prototype.slice()` creates a new string, allowing the old one to be GC'd.

### Finding 12: Duplicated Constants Between dashboard.js and orchestrator.js

`OUTPUT_BUFFER_SIZE` (100 * 1024) and `OUTPUT_WRITE_INTERVAL` (500) are defined identically in both `dashboard.js` and `orchestrator.js`. This is code duplication but not resource waste.

**Assessment**: **Minor DRY violation** but no cost impact. Both modules use independent output buffers for different execution modes (interactive vs. orchestrator).

---

## Phase 5: Development Workflow Efficiency

### Finding 13: Test Suite Runs in ~10 Seconds (416 Tests)

The full test suite takes ~10 seconds. This is fast for 416 tests across 27 files including real git integration tests.

**Assessment**: **Excellent**. No optimization needed.

### Finding 14: `cleanEnv()` Is Duplicated Across `claude.js` and `checks.js`

Both modules define identical `cleanEnv()` functions that clone `process.env` and delete `CLAUDECODE`. This is a DRY violation but each copy creates a fresh env spread per call, so there's no shared-state bug risk.

**Assessment**: **Minor code duplication**. Not a cost issue, but a maintainability concern worth noting.

---

## Summary of Findings

| # | Finding | Severity | Action |
|---|---------|----------|--------|
| 1 | CI matrix (4+2 jobs) | Informational | No change — justified |
| 2 | Coverage re-runs tests | Informational | No change — justified |
| 3 | No artifact retention waste | Clean | N/A |
| 4 | node-notifier ships 5.4 MB vendor binaries | Informational | No change — no lighter alternative |
| 5 | Production deps are minimal | Clean | N/A |
| 6 | `--continue` flag reuses sessions | Well-optimized | N/A |
| 7 | 3 retries = 4 attempts max | Reasonable | No change |
| 8 | Auth check costs 1 Claude call | Negligible | No change |
| 9 | Safety preamble overhead | Negligible | No change |
| 10 | Ephemeral file cleanup | Thorough | N/A |
| 11 | Output buffer bounded at 100 KB | Well-bounded | N/A |
| 12 | Duplicated constants | Minor DRY | Note only |
| 13 | Test suite speed | Excellent | N/A |
| 14 | Duplicated `cleanEnv()` | Minor DRY | Note only |

---

## Actionable Recommendations

### Implemented in This Audit

1. **Extract `cleanEnv()` to a shared utility** — Eliminates duplication between `claude.js` and `checks.js`. A new `src/env.js` module exports the shared function. Saves ~10 lines and prevents future divergence.

### Deferred (Low Priority)

2. **Consider weekly schedule for security audit CI job** — Would save ~1 minute/push if CI minutes become scarce. Not worth changing at current usage levels.

3. **Monitor node-notifier alternatives** — If a lighter cross-platform notification package emerges, consider switching. Current alternatives lack the same Windows/macOS/Linux coverage.

---

## Cost Model

Since NightyTidy has no cloud infrastructure:

| Cost Category | Monthly Cost | Notes |
|---------------|-------------|-------|
| GitHub Actions CI | $0 (free tier) | ~20 billed min/push, well within 2000 min limit |
| Claude Code API | User's own billing | NightyTidy doesn't add overhead; --continue reuse is optimal |
| npm install bandwidth | One-time ~48 MB | Reasonable for the dependency set |
| Disk usage per run | ~1-5 MB ephemeral | Properly cleaned up |
| **Total NightyTidy overhead** | **$0/month** | No services, no subscriptions, no infra |

---

*Generated by NightyTidy Audit #19 — Cost & Resource Optimization*
