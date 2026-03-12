# Security Audit Report #03

**Date**: 2026-03-11 23:35 PST
**Auditor**: Claude Opus 4.5 (Automated)
**Scope**: Full codebase security review
**Duration**: Comprehensive overnight audit

---

## 1. Executive Summary

NightyTidy demonstrates a **strong security posture** for a CLI tool with an optional GUI component. The codebase implements defense-in-depth with CSRF protection, security headers, input validation, and environment variable sanitization. No critical or high-severity vulnerabilities were discovered. The CI pipeline includes Gitleaks secret scanning and npm audit checks. The primary security consideration is that this tool intentionally executes code via Claude Code subprocess, which is by design and documented.

---

## 2. Automated Security Scan Results

### Tools Run

| Tool | Version | Findings | Critical | High | Medium | Low | False Positives |
|------|---------|----------|----------|------|--------|-----|-----------------|
| npm audit | latest | 0 | 0 | 0 | 0 | 0 | 0 |

### Tools Available in CI (via GitHub Actions)

| Tool | Status | Notes |
|------|--------|-------|
| Gitleaks | ✅ Active | Scans git history on every push/PR |
| npm audit | ✅ Active | Runs via `npm run check:security` (--audit-level=high) |

### Tools Recommended but Not Installed

| Tool | What It Catches | Effort to Add | Priority |
|------|-----------------|---------------|----------|
| semgrep | SAST pattern matching | `pip install semgrep` or GitHub Action | Low (manual review covers this) |
| snyk | Deep dependency analysis | `npm install -g snyk` | Low (npm audit sufficient for this project) |

### Security CI/CD Assessment

- ✅ Gitleaks runs on every push/PR to master
- ✅ npm audit runs in CI with high-severity threshold
- ✅ Test coverage enforced at 90% statements, 80% branches/functions
- ✅ Documentation freshness checker prevents doc drift

---

## 3. Fixes Applied

No fixes were applied during this audit. The codebase is in a secure state.

| Issue | Severity | Location | Fix Applied | Tests Pass? | Detected By |
|-------|----------|----------|-------------|-------------|-------------|
| (none) | — | — | — | — | — |

---

## 4. Critical Findings (Unfixed)

**None identified.**

---

## 5. High Findings (Unfixed)

**None identified.**

---

## 6. Medium Findings (Unfixed)

**None identified.**

---

## 7. Low Findings (Unfixed)

### L1: GUI Server innerHTML Usage with User-Influenced Content

**Severity**: Low
**Location**: `gui/resources/app.js` (multiple locations)
**Description**: The GUI uses `innerHTML` to render step names, paths, and Claude output into the DOM. While the code uses `NtLogic.escapeHtml()` for most user-visible strings (step names, error messages), the markdown rendering path (`renderMarkdown()`) processes Claude output directly.

**Impact**: Potential XSS if Claude's output contains malicious HTML. However, the GUI server binds only to `127.0.0.1` (localhost) and Chrome's `--app` mode provides some isolation.

**Proof**:
```javascript
// gui/resources/app.js:1027
outputEl.innerHTML = renderMarkdown(progress.currentStepOutput);
```

**Why It Wasn't Fixed**: The markdown library (`marked.js`) is industry standard and the risk is mitigated by:
1. GUI is localhost-only (not network-accessible)
2. Claude output is from a trusted AI service
3. Content-Security-Policy restricts inline scripts

**Recommendation**: Consider adding DOMPurify for defense-in-depth sanitization of rendered markdown.

**Effort**: Quick fix (add DOMPurify dependency and wrap `markedInstance.parse()`)

---

## 8. Informational

### I1: Command Execution by Design

**Location**: `src/claude.js`, `gui/server.js`
**Description**: The tool intentionally spawns Claude Code as a subprocess with `--dangerously-skip-permissions`. This is documented in CLAUDE.md as the intended security model — NightyTidy is the permission layer, operating on a safety branch.

**Impact**: Non-issue; this is documented, intentional behavior.

### I2: Shell Mode on Windows

**Location**: `src/claude.js:547-548`, `gui/server.js:352-356`
**Description**: On Windows, subprocesses are spawned with `shell: true` because `claude` is a `.cmd` script requiring shell interpretation.

**Impact**: Non-issue; necessary for Windows compatibility. The commands are constructed from controlled inputs (CLI args, not user text input).

### I3: PowerShell Execution for Folder Dialog

**Location**: `gui/server.js:40-111`
**Description**: The GUI writes a temporary PowerShell script to open a native folder picker dialog.

**Impact**: Non-issue; the script content is hardcoded (not user-influenced) and the file is deleted immediately after execution.

### I4: Environment Variable Allowlist

**Location**: `src/env.js`
**Description**: The `cleanEnv()` function uses an explicit allowlist to filter environment variables passed to Claude Code subprocess, blocking `CLAUDECODE` and unknown variables.

**Impact**: Positive security pattern. Prevents accidental credential leakage to subprocess.

### I5: Prompt Integrity Check

**Location**: `src/executor.js:66-120`
**Description**: A SHA-256 hash (`STEPS_HASH`) verifies prompt content before passing to Claude Code with `--dangerously-skip-permissions`. Hash mismatch triggers a warning but does not block execution.

**Impact**: Positive security pattern. Detects unexpected prompt modification.

---

## 9. Supply Chain Risk Assessment

### Post-install Scripts

| Package | Script Type | Behavior | Risk Level | Recommendation |
|---------|-------------|----------|------------|----------------|
| (none found) | — | — | — | — |

No production dependencies have lifecycle scripts.

### Typosquatting Risks

| Package | Similar To | Confidence | Evidence |
|---------|-----------|------------|----------|
| (none flagged) | — | — | All packages are official/mainstream |

Dependencies are well-known, established packages:
- `@inquirer/checkbox` — Official Inquirer.js team
- `chalk` — ~100M weekly downloads
- `commander` — ~150M weekly downloads
- `node-notifier` — ~15M weekly downloads
- `ora` — ~30M weekly downloads
- `simple-git` — ~2M weekly downloads
- `vitest` — Official Vite team
- `@vitest/coverage-v8` — Official Vite team

### Namespace/Scope Risks

| Package | Risk Type | Detail | Recommendation |
|---------|-----------|--------|----------------|
| (none flagged) | — | — | — |

No scoped internal packages, no private registry mixing.

### Lock File Integrity

**Status**: ✅ Pass

- Lock file committed and current
- All resolved URLs point to `registry.npmjs.org`
- No packages resolving to unexpected URLs/IPs
- Integrity hashes present for all packages

### Maintainer Risk

| Package | Concern | Evidence | Risk Level |
|---------|---------|----------|------------|
| (none flagged) | — | — | — |

All dependencies are actively maintained by established teams/authors.

### Transitive Dependency Stats

| Metric | Value |
|--------|-------|
| Total packages (including transitive) | 204 |
| Production dependencies | 43 |
| Dev dependencies | 162 |
| Max depth | ~6 levels (vitest → vite → esbuild chain) |
| Flagged packages | 0 |

---

## 10. Security Architecture Strengths

The codebase demonstrates several positive security patterns:

1. **CSRF Protection** (`src/dashboard.js`): POST `/stop` requires CSRF token generated via `crypto.randomBytes(16)`
2. **Security Headers** (`gui/server.js`, `src/dashboard.js`): CSP, X-Frame-Options, X-Content-Type-Options on all responses
3. **Body Size Limits**: 1 MB for GUI server, 1 KB for dashboard stop endpoint
4. **Localhost Binding**: Both servers bind to `127.0.0.1` only
5. **Path Traversal Protection** (`gui/server.js:240-248`): Validates file paths against resources directory
6. **Singleton Guard** (`gui/server.js:117-164`): Prevents multiple GUI instances, cleans stale locks
7. **Env Var Sanitization** (`src/env.js`): Explicit allowlist for subprocess environment
8. **Git Safety** (`src/executor.js:124-130`): Safety preamble prevents destructive git operations
9. **Gitleaks CI**: Automated secret scanning on every push/PR

---

## 11. Recommendations

| # | Recommendation | Impact | Risk if Ignored | Worth Doing? | Details |
|---|----------------|--------|-----------------|--------------|---------|
| 1 | Add DOMPurify for markdown output sanitization | Defense-in-depth against XSS | Low | Only if time allows | The current risk is minimal due to localhost-only access and trusted Claude output, but DOMPurify is a lightweight addition for extra safety. |
| 2 | Consider adding `.npmrc` with `ignore-scripts=true` | Blocks malicious post-install scripts in new deps | Low | Probably | Currently no deps have scripts, but this provides protection against future supply chain attacks via dependency additions. |

---

## 12. Test Suite Verification

```
Test Files: 39 passed (39)
Tests:      886 passed (886)
Duration:   11.25s
```

All tests pass. The codebase is in a healthy, secure state.

---

## 13. Conclusion

NightyTidy has a solid security foundation with defense-in-depth practices throughout the codebase. The CI pipeline provides automated security checks via Gitleaks and npm audit. No critical, high, or medium severity vulnerabilities were identified. The single low-severity finding (innerHTML with markdown) is mitigated by localhost-only access and should be addressed opportunistically rather than urgently.

---

*Report generated by Claude Opus 4.5 Security Audit Agent*
