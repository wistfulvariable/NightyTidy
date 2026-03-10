# Security Audit Report 02 — 2026-03-10

## Executive Summary

NightyTidy's security posture is **excellent for a localhost-only CLI tool**. This follow-up audit (after audits on 2026-03-05 and 2026-03-09) confirms all prior fixes remain in place and working. **Zero npm vulnerabilities** found (down from 6 moderate in previous audits). One low-severity fix applied: added security headers to dashboard API responses. The codebase demonstrates mature security practices — CSRF protection, atomic locking, path traversal guards, XSS escaping, allowlisted env vars, and comprehensive CI security scanning.

---

## Automated Security Scan Results

### Tools Discovered and Run

| Tool | Version | Findings | Critical | High | Medium | Low | False Positives |
|------|---------|----------|----------|------|--------|-----|-----------------|
| npm audit | npm 10.x | **0** | 0 | 0 | 0 | 0 | 0 |
| Gitleaks | CI (v2) | 0 (configured) | 0 | 0 | 0 | 0 | 0 |

**Improvement from previous audits**: npm audit shows 0 vulnerabilities (previously 6 moderate in esbuild via vitest).

### CI/CD Security Pipeline Assessment

| Check | Status | Notes |
|-------|--------|-------|
| Gitleaks secret scan | ✅ Configured | Runs on every push/PR via GitHub Actions |
| npm audit | ✅ Configured | `npm run check:security` runs `npm audit --audit-level=high` |
| Coverage thresholds | ✅ Configured | 90% statements, 80% branches/functions |
| Docs freshness | ✅ Configured | Catches doc drift on every PR |

### Lock File Integrity

| Check | Result |
|-------|--------|
| Lock file committed | ✅ Yes |
| All packages resolve to registry.npmjs.org | ✅ 205/205 |
| All packages have integrity hashes | ✅ 205/205 |
| Suspicious URLs or anomalies | ✅ None found |

---

## Fixes Applied

### Fix 1: Security Headers on Dashboard API Responses (Low)

**Files**: `src/dashboard.js`, `src/dashboard-standalone.js`
**Issue**: POST `/stop` endpoint responses (200, 403, 413) lacked security headers while other endpoints had them.
**Fix**: Added `...SECURITY_HEADERS` spread to all response headers on the `/stop` endpoint.
**Tests Pass**: Yes (738/738)
**Detected By**: Manual review

---

## Phase 1: Secrets & Sensitive Data

| Check | Result |
|-------|--------|
| Hardcoded API keys/tokens | ✅ None found |
| .env files in repo | ✅ None found |
| Credentials in test fixtures | ✅ None found |
| SSH keys / certificates | ✅ None found |
| Base64-encoded secrets | ✅ None found (only npm integrity hashes) |
| .gitignore coverage | ✅ Comprehensive (`.env*`, `*.pem`, `*.key`, `credentials.*`, `secrets.*`) |

**Verdict**: Clean. No secrets in codebase.

---

## Phase 2: Auth & Permissions

### HTTP Endpoint Map

#### Dashboard Servers (`dashboard.js`, `dashboard-standalone.js`)

| Method | Path | Auth | Security Headers |
|--------|------|------|------------------|
| GET | `/` | None | ✅ Yes |
| GET | `/events` | None (SSE) | N/A |
| POST | `/stop` | CSRF token | ✅ Yes (fixed this audit) |

- **CSRF protection**: Correctly implemented via `crypto.randomBytes(16)`
- **Binding**: `127.0.0.1` only — not network-accessible
- **Body size limit**: 1 KB on POST `/stop`

#### GUI Server (`gui/server.js`)

| Method | Path | Auth | Security Headers |
|--------|------|------|------------------|
| GET | `/*` | None | ✅ Yes |
| POST | `/api/*` | None | ✅ Yes |

- **Binding**: `127.0.0.1` only
- **No CORS headers** (removed in previous audit)
- **Body size limit**: 1 MB
- **Heartbeat watchdog**: Self-terminates after 15s with no browser heartbeat

### IDOR/Privilege Escalation

Not applicable — single-user localhost tool with no user authentication.

---

## Phase 3: Common Vulnerability Scan

### Command Injection

| Location | Risk | Analysis |
|----------|------|----------|
| `claude.js` `spawnClaude()` | ✅ Low | Prompts are NightyTidy-controlled (markdown files). `spawn()` used. |
| `gui/server.js` `handleRunCommand()` | ✅ Low | Shell command from localhost frontend only. Expected by design. |
| `checks.js` `checkDiskSpace()` | ✅ Low | `driveLetter = projectDir.charAt(0)` — single character, cannot inject. |

### Path Traversal

| Location | Risk | Analysis |
|----------|------|----------|
| `gui/server.js` `serveStatic()` | ✅ Fixed (prior audit) | Uses `RESOURCES_DIR + sep` boundary check. |
| `gui/server.js` `handleDeleteFile()` | ✅ Safe | Only allows deleting whitelisted NightyTidy files. |

### XSS

| Location | Risk | Analysis |
|----------|------|----------|
| `dashboard-html.js` innerHTML | ✅ Safe | `escapeHtml()` uses DOM `textContent` method. |
| `gui/resources/app.js` innerHTML | ✅ Safe | `NtLogic.escapeHtml()` used for all dynamic content. |
| CSRF token in template | ✅ Safe | Hex-only (`randomBytes(16).toString('hex')`). |

### SSRF

Not applicable — no user-controlled URLs are fetched. `sync.js` fetches from a hardcoded Google Doc URL (configurable via CLI flag, but that's a deliberate user action, not user input).

### Lock File Race Condition

✅ **Fixed in prior audit**: Now uses `fs.openSync(path, 'wx')` (O_EXCL atomic flag).

### Insecure Deserialization

| Location | Risk | Analysis |
|----------|------|----------|
| `orchestrator.js` readState | ✅ Low | `JSON.parse` on NightyTidy-written files only. |
| `gui/server.js` readBody | ✅ Low | `JSON.parse` on localhost-only POST bodies, wrapped in try/catch. |

### Error Information Leakage

| Location | Risk | Analysis |
|----------|------|----------|
| Dashboard error responses | ✅ Safe | Generic messages (`'Invalid token'`, `'Not found'`). |
| GUI server error responses | ✅ Safe | Generic messages (`'File not found or unreadable'`). |
| CLI error output | ✅ Safe | `err.stack` logged to debug-level file only, not exposed via HTTP. |

---

## Phase 4: Dependency & Supply Chain

### npm audit

**0 vulnerabilities** (down from 6 moderate in previous audits).

### Post-install Scripts

| Package | Script Type | Behavior | Risk Level |
|---------|------------|----------|------------|
| esbuild (dev) | postinstall | Downloads platform-specific binary | Low |

All other dependencies have **no install scripts**.

### Typosquatting Assessment

All direct dependencies are well-known packages with millions of weekly downloads:
- `commander`, `chalk`, `ora`, `simple-git`, `node-notifier`, `marked`, `@inquirer/checkbox`

No typosquatting concerns identified.

### Transitive Dependency Stats

| Metric | Value |
|--------|-------|
| Direct dependencies (runtime) | 7 |
| Direct dependencies (dev) | 2 |
| Total packages in lock file | 205 |
| Packages with install scripts | 1 (esbuild) |
| Flagged for maintainer risk | 0 |

---

## Informational Findings (Unfixed — By Design)

### I1: `--dangerously-skip-permissions` Flag Usage

**Severity**: Informational (Accepted Risk)
**Location**: `claude.js:82-84`
**Description**: All Claude Code subprocess invocations use this flag for non-interactive operation.
**Mitigation**: NightyTidy is the permission layer — it controls what prompts are sent and operates on a safety branch with a pre-run tag for recovery.

### I2: GUI `/api/run-command` Executes Arbitrary Commands

**Severity**: Informational (Accepted Risk)
**Description**: By design for GUI functionality. Mitigated by localhost-only binding, no CORS headers, and Chrome `--app` mode isolation.

### I3: GUI `/api/read-file` Reads Arbitrary Files

**Severity**: Informational (Accepted Risk)
**Description**: By design for reading progress files from any project directory. Same trust level as local filesystem access.

---

## Security Architecture Summary

NightyTidy demonstrates mature security engineering:

| Feature | Implementation |
|---------|----------------|
| Network isolation | All HTTP servers bind to `127.0.0.1` |
| CSRF protection | Per-session token via `crypto.randomBytes(16)` |
| Path traversal guards | Boundary check with trailing separator |
| XSS protection | Consistent HTML escaping across all `innerHTML` usage |
| Prompt integrity | SHA-256 hash verification before execution |
| Atomic locking | `O_EXCL` flag prevents TOCTOU races |
| Env var allowlist | Only safe env vars forwarded to subprocesses |
| Git safety | Pre-run tags, dedicated branches, no destructive commands |
| Secret scanning | Gitleaks runs on every push/PR |
| Dependency scanning | `npm run check:security` in CI |

---

## Comparison with Previous Audits

| Finding | Audit 01 (03-05) | Audit 08 (03-09) | This Audit |
|---------|------------------|------------------|------------|
| npm vulnerabilities | 6 moderate | 6 moderate | **0** |
| Dashboard CSRF | Fixed | Present | Present |
| Dashboard security headers | Fixed (HTML) | Fixed (JSON) | **Fixed (all responses)** |
| Lock file TOCTOU | Found | Fixed | Verified fixed |
| Path traversal guard | Not present | Fixed | Verified fixed |

---

*Generated by security audit on 2026-03-10. Branch: nightytidy/run-2026-03-10-0005.*
*Auditor: Claude Opus 4.5*
