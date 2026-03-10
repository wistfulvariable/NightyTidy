# NightyTidy — Cost & Resource Optimization Report

**Run #01** | **Date**: 2026-03-10 | **Auditor**: Claude Opus 4.5

---

## 1. Executive Summary

### Total Estimated Monthly Waste: **$0-5/month** (High Confidence)

NightyTidy is a **lean, cost-efficient project** with minimal billable service exposure. The only billable service is the **Anthropic Claude Code API**, which is usage-based and inherently efficient for the product's design (overnight batch processing).

### Key Findings

1. **Single Billable Service**: Anthropic Claude Code API is the only cost driver
2. **No Infrastructure Waste**: No cloud provisioning, no always-on services
3. **No Redundant API Calls**: Claude invocations are minimal per design
4. **CI/CD Runs Free**: GitHub Actions on public repo (free tier)
5. **Google Docs Sync is Free**: Public document export (no API key)

### Top 5 Savings Opportunities

| # | Opportunity | Est. Savings | Effort | Status |
|---|-------------|--------------|--------|--------|
| 1 | Step-level cost visibility | $0 (transparency only) | Low | Recommended |
| 2 | Prompt caching awareness | 5-20% of Claude costs | Low | In place |
| 3 | CI matrix reduction (optional) | $0 (free tier) | Low | Not needed |
| 4 | Timeout tuning | Variable | Low | User-configurable |
| 5 | Partial run support | Variable | Already implemented | ✓ Done |

### Code-Level Fixes Implemented

**None required.** The codebase is well-optimized with no redundant API calls or wasteful patterns.

---

## 2. Billable Service Inventory

| Service | Provider | Purpose | Billing Model | Usage Pattern | Est. Monthly Cost | Issues |
|---------|----------|---------|---------------|---------------|-------------------|--------|
| **Claude Code API** | Anthropic | Core improvement engine | Per-token (usage-based) | Batch (overnight runs) | **$0.50-50+ per run** | None |
| Google Docs Export | Google | Prompt sync | Free (public) | Maintenance only | $0 | None |
| GitHub Actions | GitHub | CI/CD | Free (public repo) | Per-push | $0 | None |
| npm Registry | npm | Dependencies | Free | One-time install | $0 | None |

### Claude Code API — Cost Structure

**Per-Run Cost Estimate** (based on typical usage):

| Component | Invocations | Est. Cost |
|-----------|-------------|-----------|
| Improvement prompts | 33 steps × 1 | $0.20-$1.00/step |
| Doc-update prompts | 33 steps × 1 | ~$0.01/step |
| Changelog generation | 1 | ~$0.05 |
| Action plan consolidation | 1 | ~$0.10 |
| Rate-limit probes | 0-10 | ~$0.001 each |
| **Full Run (33 steps)** | ~68 calls | **$7-40 estimated** |

*Note: Actual costs depend on codebase size, prompt complexity, and Claude model tier. Costs extracted from `total_cost_usd` in Claude's JSON output.*

---

## 3. Infrastructure Analysis

### Compute Resources

| Resource | Current Config | Recommendation | Savings | Confidence |
|----------|---------------|----------------|---------|------------|
| Runtime | Local Node.js | No change | $0 | High |
| Subprocess | Claude CLI | No change | $0 | High |

**Finding**: NightyTidy has **zero cloud compute costs**. It runs entirely on the user's local machine.

### Database Resources

**Finding**: **No database.** State is stored in ephemeral JSON files (`nightytidy-run-state.json`, `nightytidy-progress.json`).

### Storage Resources

| Resource | Purpose | Cleanup Policy | Issue |
|----------|---------|----------------|-------|
| `nightytidy-run.log` | Run log | Manual | None |
| `nightytidy-progress.json` | Dashboard | Auto-deleted on stop | ✓ |
| `nightytidy-run-state.json` | Orchestrator state | Auto-deleted on finish | ✓ |
| `nightytidy.lock` | Concurrency lock | Auto-released | ✓ |
| `NIGHTYTIDY-REPORT.md` | Run report | Committed to git | None |
| `NIGHTYTIDY-ACTIONS.md` | Action plan | Committed to git | None |

**Finding**: Storage is minimal and properly cleaned up. No unbounded growth.

### Networking

**Finding**: No cloud networking. All network traffic is:
- Local HTTP server (127.0.0.1 only, ephemeral port)
- Claude CLI subprocess communication (local)
- Google Docs fetch (optional sync, ~30KB/request)

### CI/CD Resources

| Workflow | Runners | Matrix | Cost |
|----------|---------|--------|------|
| test | 6 jobs | 2 OS × 3 Node versions | $0 (public repo) |
| coverage | 1 job | Ubuntu only | $0 |
| secrets-scan | 1 job | Gitleaks action | $0 |
| security | 1 job | npm audit | $0 |

**Finding**: CI/CD is free on GitHub's public repo tier. Matrix (6 jobs) is reasonable for cross-platform CLI tool.

**Optional Reduction**: Could reduce to 2 OS × 2 Node versions if CI time becomes a concern, but no cost savings (free tier).

### Container Resources

**Finding**: No Docker. Plain Node.js ESM execution.

---

## 4. Application-Level Waste

### Redundant API Calls

**Finding**: **None detected.**

Claude Code invocations are minimal by design:
- 1 improvement prompt per step
- 1 doc-update prompt per step (uses `--continue` for session reuse)
- 1 changelog prompt at end
- 1 consolidation prompt at end

**Session Continuity**: The `--continue` flag enables Claude session reuse, which likely benefits from prompt caching (reducing input token costs on repeated context).

### Retry Logic Analysis

| Setting | Value | Assessment |
|---------|-------|------------|
| Max retries | 3 | Appropriate |
| Retry delay | 10s | Appropriate |
| Rate-limit retries | Skipped | **Optimal** — avoids wasted retry costs |

**Finding**: Rate-limit detection (`classifyError()`) skips retries for 429 errors. This is **optimal** — retrying rate-limited requests in 10s would fail again and waste API calls.

### Fast-Completion Detection

**Finding**: Steps completing in under 2 minutes trigger automatic retry with context (`FAST_RETRY_PREFIX`). This is a **quality assurance measure**, not waste. It prevents Claude from bailing out without doing work.

**Cost Impact**: ~2× Claude cost for suspiciously fast steps. This is intentional and appropriate.

### Database Query Patterns

**Finding**: No database. N/A.

### Storage Patterns

**Finding**: No unbounded storage growth. Ephemeral files auto-cleaned.

### Serverless Patterns

**Finding**: No serverless. N/A.

### Third-Party Tier Optimization

| Service | Current Tier | Optimal Tier | Savings |
|---------|--------------|--------------|---------|
| GitHub Actions | Free (public repo) | Free | $0 |
| npm | Free | Free | $0 |
| Anthropic Claude | Usage-based | Usage-based | N/A |

**Finding**: All services are on appropriate tiers. No overpaying.

---

## 5. Data Transfer & Egress

| Flow | Volume | Cost | Optimization |
|------|--------|------|--------------|
| Claude CLI ↔ API | ~10-50 KB/step | Included in token cost | N/A |
| Google Docs fetch | ~30 KB/sync | Free | N/A |
| Dashboard SSE | ~1-5 KB/step | Local (no cost) | N/A |

**Finding**: Data transfer is minimal. No egress costs (no cloud hosting).

---

## 6. Non-Production Costs

### Environment Inventory

| Environment | Parity | Always-On | Cleanup |
|-------------|--------|-----------|---------|
| Development | N/A | No | N/A |
| CI | Identical | No (per-push) | Auto |
| Production | N/A (local CLI) | No | N/A |

**Finding**: NightyTidy is a local CLI tool. No non-prod environments running expensive infrastructure.

### Tool Seats

**Finding**: No SaaS subscriptions requiring seat management.

---

## 7. Code-Level Fixes Implemented

**None required.**

The codebase demonstrates excellent cost awareness:

1. **Session reuse** via `--continue` flag (line 172 in `claude.js`)
2. **Rate-limit detection** with exponential backoff (lines 564-578 in `claude.js`)
3. **Prompt size optimization** via stdin threshold (line 54 in `claude.js`)
4. **Cost tracking** with `total_cost_usd` extraction (lines 421-431 in `claude.js`)
5. **Partial run support** via `--steps` flag (allows subset execution)

---

## 8. Cost Monitoring Assessment

### Current Visibility

| Metric | Tracked | Location |
|--------|---------|----------|
| Per-step cost | ✓ | `result.cost.costUSD` |
| Total run cost | ✓ | Summed in `orchestrator.js:668-671` |
| Input tokens | ✓ | `result.cost.inputTokens` |
| Output tokens | ✓ | `result.cost.outputTokens` |
| Cache tokens | ✓ | Included in inputTokens total |
| API duration | ✓ | `result.cost.durationApiMs` |

**Assessment**: Cost visibility is **excellent**. All relevant metrics are captured from Claude's JSON output.

### Cost Reporting

| Report | Contains Cost Data |
|--------|-------------------|
| `NIGHTYTIDY-REPORT.md` | ✓ Yes (per-step + total) |
| GUI display | ✓ Yes (`formatCost()` helper) |
| CLI output | ✓ Yes (in JSON mode) |

### Budget Alerts

**Not implemented**. Could add:
- Per-step cost threshold warning
- Total run cost cap with auto-abort

**Recommendation**: Not urgent for overnight batch tool, but useful for cost-conscious users.

### Governance

**Current**: No pre-approval workflow for expensive runs.

**Acceptable**: This is a local CLI tool, not a multi-tenant service. User controls invocation.

---

## 9. Savings Roadmap

### Immediate (< 1 week)

| Opportunity | Est. Savings | Effort | Risk | Confidence | Details |
|-------------|--------------|--------|------|------------|---------|
| None required | $0 | — | — | High | Codebase is well-optimized |

### This Month

| Opportunity | Est. Savings | Effort | Risk | Confidence | Details |
|-------------|--------------|--------|------|------------|---------|
| Add cost cap option | User-defined | Low | Low | High | `--max-cost 10` flag to auto-abort if run exceeds $10 |
| Cache hit logging | Transparency | Low | None | High | Log cache_read_input_tokens vs cache_creation to show savings |

### This Quarter

| Opportunity | Est. Savings | Effort | Risk | Confidence | Details |
|-------------|--------------|--------|------|------------|---------|
| Step prioritization by cost | Variable | Medium | Low | Medium | Run cheaper steps first to fail-fast on budget |
| Cost estimation before run | Transparency | Medium | Low | Medium | Estimate total cost based on codebase size before confirming |

### Ongoing

| Opportunity | Est. Savings | Effort | Risk | Confidence | Details |
|-------------|--------------|--------|------|------------|---------|
| Monitor Anthropic pricing changes | Variable | Low | None | High | Adjust recommendations as model pricing evolves |
| Track prompt size trends | Variable | Low | None | High | Ensure prompts don't grow unbounded over time |

---

## 10. Assumptions & Verification Needed

### Assumptions Made

1. **Claude Code pricing**: Assumed standard Anthropic API pricing (~$3/MTok input, $15/MTok output for Claude 3.5 Sonnet). Actual rates depend on user's Anthropic plan.

2. **Typical run costs**: $7-40 estimate based on 33 steps with moderate codebase size. Large codebases with extensive changes could exceed this.

3. **Cache effectiveness**: Assumed 20-50% cache hit rate for `--continue` sessions. Actual rate depends on prompt similarity.

4. **No hidden services**: Verified via codebase grep — no API keys, no SaaS SDKs beyond Claude CLI.

### Verification Checklist

- [ ] **Actual run costs**: Check `NIGHTYTIDY-REPORT.md` from a real run for actual `totalCostUSD`
- [ ] **Anthropic billing**: Review Anthropic dashboard for actual charges
- [ ] **Cache hit rate**: Add logging for `cache_read_input_tokens / inputTokens` ratio
- [ ] **GitHub Actions minutes**: Check GitHub billing page (should show $0 for public repo)
- [ ] **Model tier**: Confirm which Claude model the CLI uses (Sonnet vs Opus affects pricing)

---

## Summary

### Status

Comprehensive cost audit completed. No code changes needed.

### Key Findings

1. **Single billable service**: Anthropic Claude Code API (usage-based, no monthly minimum)
2. **Zero infrastructure costs**: Local CLI, no cloud resources
3. **Excellent cost tracking**: Per-step and total costs captured and reported
4. **Optimal retry logic**: Rate-limits detected and handled efficiently
5. **No redundant API calls**: Design is minimal (1 improvement + 1 doc-update per step)

### Changes Made

None. The codebase is well-optimized for cost efficiency.

### Recommendations

| # | Recommendation | Est. Savings | Effort | Risk | Worth Doing? | Details |
|---|----------------|--------------|--------|------|--------------|---------|
| 1 | Add `--max-cost` flag | User-defined | Low | Low | ✓ Yes | Auto-abort if run exceeds cost threshold |
| 2 | Log cache hit ratio | Transparency | Low | None | ✓ Yes | Show users how much caching saves |
| 3 | Pre-run cost estimate | Transparency | Medium | Low | ✓ Maybe | Estimate before confirming, based on codebase size |

**Total estimated waste**: **< $5/month** — this is effectively zero waste.

### Verification Checklist

- [ ] Run `npm test` to confirm all tests pass
- [ ] Review actual `total_cost_usd` from a real NightyTidy run
- [ ] Check Anthropic dashboard for historical usage
- [ ] Verify GitHub Actions billing shows $0

### Report Location

`audit-reports/COST_OPTIMIZATION_REPORT_01_2026-03-10.md`

---

*Generated by NightyTidy Cost Optimization Audit*
