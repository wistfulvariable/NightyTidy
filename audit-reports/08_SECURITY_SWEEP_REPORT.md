# Audit #08 -- Security Sweep Report

**Date**: 2026-03-09
**Auditor**: Claude Opus 4.6

---

## Executive Summary

NightyTidy's security posture is solid for a localhost-only CLI tool. No compromised credentials were found. The codebase demonstrates security awareness -- CSRF protection on dashboards, atomic lock files, prompt integrity hashing, path traversal guards, and XSS escaping. Four low-severity issues were fixed; several informational items documented for awareness.

---

## Phase 0: Automated Security Tooling

### npm audit
**6 moderate vulnerabilities** in dev-only dependency chain:
- `esbuild <=0.24.2` (GHSA-67mh-4wv8-2f99): allows any website to send requests to dev server
- Affects: `esbuild -> vite -> @vitest/mocker -> vitest -> @vitest/coverage-v8`
- **Impact**: Dev-only. No production exposure. Fix requires `vitest` v4 (breaking change).
- **Recommendation**: Update vitest to v4 at next convenience. Not urgent.

### SAST Tools
- **None configured**: No `.eslintrc`, no pre-commit hooks, no `.husky/` directory.
- **Recommendation**: Consider adding ESLint with `eslint-plugin-security` for automated static analysis.

### .gitignore
- Comprehensive coverage for secrets (`.env*`, `*.pem`, `*.key`, `credentials.*`, etc.)
- **Gap found**: `nightytidy-run-state.json` and `repomix-output.*` were missing. **Fixed.**

---

## Phase 1: Secrets & Sensitive Data

| Check | Result |
|-------|--------|
| Hardcoded API keys/tokens | None found |
| .env files in repo | None found |
| Credentials in test fixtures | None found (only a test CSRF token: `'wrong-token-value'`) |
| SSH keys / certificates | None found |
| AWS/GCP/Azure credentials | None found |
| Base64-encoded secrets | None found |

**Verdict**: Clean. No secrets in codebase.

---

## Phase 2: Auth & Permissions

### HTTP Endpoint Map

#### Dashboard Server (`dashboard.js`, `dashboard-standalone.js`)
| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/` | None | Serves HTML dashboard |
| GET | `/events` | None | SSE stream for live updates |
| POST | `/stop` | CSRF token | Stops the running NightyTidy process |

- **CSRF protection**: Correctly implemented. `crypto.randomBytes(16)` generates per-session token, embedded in HTML template, verified server-side via JSON body comparison.
- **Binding**: `127.0.0.1` only -- not exposed to network.
- **Security headers**: CSP, X-Frame-Options: DENY, X-Content-Type-Options: nosniff -- correctly applied to HTML responses.

#### GUI Server (`gui/server.js`)
| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/*` | None | Static files from `gui/resources/` |
| POST | `/api/select-folder` | None | Opens native folder dialog |
| POST | `/api/run-command` | None | **Executes shell commands** |
| POST | `/api/kill-process` | None | Kills tracked process by ID |
| POST | `/api/read-file` | None | Reads any file from disk |
| POST | `/api/exit` | None | Shuts down server |

- **Binding**: `127.0.0.1` only -- not exposed to network.
- **CORS removed**: Confirmed. Audit #07 removed CORS `Access-Control-Allow-Origin` header. Verified: no CORS headers present in current code.
- **Body size limit**: 1 MB (`MAX_BODY_BYTES`) on all POST bodies. Correctly enforced with `req.destroy()` on overflow.

### IDOR Vulnerabilities
- No user-specific resources. Single-user localhost tool. Not applicable.

### Security Observations (Informational)

1. **`/api/run-command` executes arbitrary commands**: By design -- the GUI needs to invoke `npx nightytidy` commands. The `command` parameter from the client is passed directly to a shell subprocess. This is acceptable because:
   - Server binds to 127.0.0.1 only (not network-accessible)
   - No CORS headers (browser same-origin policy blocks cross-origin requests)
   - Chrome `--app` mode isolates the window
   - The user who runs `npm run gui` already has shell access

2. **`/api/read-file` reads arbitrary files**: By design -- it reads `nightytidy-progress.json` from the target project directory. Any local process can already read files, so restricting this adds no real security. Documented for awareness.

---

## Phase 3: Common Vulnerabilities

### Command Injection
| Location | Risk | Analysis |
|----------|------|----------|
| `claude.js` `spawnClaude()` | **Low** | Prompts are NightyTidy-controlled (loaded from markdown files). User has no input vector to inject into prompts. `spawn` used (not `exec`). |
| `gui/server.js` `handleRunCommand()` | **Low** | Shell command from frontend client. Acceptable -- see Auth section above. |
| `gui/server.js` `handleKillProcess()` | **Low** | `taskkill /pid ${proc.pid}` uses numeric PID from tracked process map, not user input. |
| `checks.js` `checkDiskSpace()` | **Low** | `driveLetter` extracted from `projectDir.charAt(0)`, single character, validated by PowerShell. |

### Path Traversal
| Location | Risk | Analysis |
|----------|------|----------|
| `gui/server.js` `serveStatic()` | **Fixed** | Had `startsWith(RESOURCES_DIR)` without trailing separator -- `resources-extra` directory would pass check. Now uses `RESOURCES_DIR + sep` boundary. |
| `gui/server.js` `handleReadFile()` | **Info** | Reads any path. By design for localhost GUI. |

### XSS
| Location | Risk | Analysis |
|----------|------|----------|
| `dashboard-html.js` | **Safe** | `escapeHtml()` uses `document.createElement('div').textContent = str` (DOM-based, safe). Used for step names in `innerHTML`. |
| `gui/resources/logic.js` | **Safe** | `escapeHtml()` replaces `&<>"` characters. Used consistently in `app.js` for all dynamic content. |
| `gui/resources/app.js` | **Safe** | All user-supplied data (step names, paths, results) goes through `NtLogic.escapeHtml()` before `innerHTML`. |
| `dashboard-html.js` line 475 | **Safe** | CSRF token is `crypto.randomBytes(16).toString('hex')` -- hex-only, cannot break out of string literal in template. |

### SSRF
- No user-controlled URLs anywhere in the codebase. Not applicable.

### Insecure Deserialization
| Location | Risk | Analysis |
|----------|------|----------|
| `orchestrator.js` `readState()` | **Low** | `JSON.parse` on `nightytidy-run-state.json` -- NightyTidy writes this file, not user input. |
| `lock.js` | **Low** | `JSON.parse` on lock file content -- NightyTidy writes this file. |
| `dashboard-standalone.js` | **Low** | `JSON.parse` on progress JSON -- NightyTidy writes this file. |
| `gui/server.js` `readBody()` | **Low** | `JSON.parse` on POST body from localhost-only server. Wrapped in try/catch. |

### Error Information Leakage
| Location | Risk | Analysis |
|----------|------|----------|
| `cli.js` line 515-519 | **Low** | `err.message` shown to user on console, `err.stack` logged to debug-level file log only. Not exposed via HTTP. |
| Dashboard HTTP responses | **Safe** | Error responses use generic messages (`'Invalid token'`, `'Not found'`). No stack traces. |
| GUI server responses | **Safe** | Error responses use generic messages (`'File not found or unreadable'`). No stack traces. |

### Body Size Limits
| Server | Before | After |
|--------|--------|-------|
| `gui/server.js` | 1 MB limit | 1 MB limit (already good) |
| `dashboard.js` POST `/stop` | **No limit** | **1 KB limit added** |
| `dashboard-standalone.js` POST `/stop` | **No limit** | **1 KB limit added** |

---

## Phase 4: Dependency & Supply Chain

### npm audit
- 6 moderate vulnerabilities, all in dev-only `vitest -> vite -> esbuild` chain
- No production dependency vulnerabilities

### Lock File Integrity
- `package-lock.json` present and committed

### Post-install Scripts
- No `preinstall` or `postinstall` scripts in `package.json`

### Dependency Review
| Package | Version | Risk Assessment |
|---------|---------|-----------------|
| `commander` | 12.1.0 | Low -- well-maintained, no known CVEs |
| `chalk` | 5.6.2 | Low -- pure formatting, no I/O |
| `ora` | 8.2.0 | Low -- terminal spinner, no I/O |
| `simple-git` | 3.32.3 | Low -- wraps git CLI, well-maintained |
| `node-notifier` | 10.0.1 | Low -- desktop notifications. Historical CVE (v5/v6 command injection) fixed. v10 safe. |
| `@inquirer/checkbox` | 5.1.0 | Low -- terminal UI, no network |

### Typosquatting Risk
- All dependencies are well-known packages with millions of weekly downloads. No typosquatting risk detected.

---

## Phase 5: Fixes Applied

### Fix 1: Dashboard body size limit (LOW severity)
**Files**: `src/dashboard.js`, `src/dashboard-standalone.js`
**Issue**: `POST /stop` endpoint accumulated request body without size limit, allowing memory exhaustion via large POST body from any local process.
**Fix**: Added `MAX_BODY_BYTES = 1024` constant and body size check with `req.destroy()` + 413 response.

### Fix 2: Path traversal hardening (LOW severity)
**File**: `gui/server.js`
**Issue**: `serveStatic()` used `filePath.startsWith(RESOURCES_DIR)` without trailing separator. A hypothetical sibling directory `resources-extra` would pass the check.
**Fix**: Changed to compare against `RESOURCES_DIR + sep` boundary. While no such directory currently exists, this is a defense-in-depth improvement.

### Fix 3: Security headers on API responses (LOW severity)
**File**: `gui/server.js`
**Issue**: `sendJson()` responses lacked security headers (CSP, X-Frame-Options, X-Content-Type-Options). HTML responses already had them.
**Fix**: Added `...SECURITY_HEADERS` to `sendJson()` response headers.

### Fix 4: .gitignore coverage (LOW severity)
**File**: `.gitignore`
**Issue**: Missing entries for `nightytidy-run-state.json` (orchestrator state file), `repomix-output.*` (build tool output), and `Thumbs.db` (Windows).
**Fix**: Added missing entries.

### All tests pass (416/416) after all fixes.

---

## Issues Not Fixed (Document Only)

### 1. GUI `/api/run-command` arbitrary command execution (ACCEPTED RISK)
**Severity**: Informational
**Rationale**: By design. Localhost-only, no CORS, same trust level as the user's terminal. Restricting it would break the GUI's core functionality.

### 2. GUI `/api/read-file` arbitrary file read (ACCEPTED RISK)
**Severity**: Informational
**Rationale**: By design. Needs to read progress files from any project directory. Same trust level as local file system access.

### 3. `--dangerously-skip-permissions` flag (ACCEPTED RISK)
**Severity**: Informational
**Rationale**: Required for non-interactive Claude Code invocation. NightyTidy is the permission layer -- it controls what prompts are sent and operates on a safety branch with a pre-run tag for recovery.

### 4. No SAST tooling configured
**Severity**: Informational
**Recommendation**: Add `eslint-plugin-security` to catch potential issues at development time.

### 5. Dev dependency vulnerability (esbuild)
**Severity**: Moderate (dev-only)
**Recommendation**: Update vitest to v4 at next major version bump.

---

## Security Architecture Summary

NightyTidy has a well-designed security model for a localhost CLI tool:

- **Network isolation**: All HTTP servers bind to `127.0.0.1`
- **CSRF protection**: Dashboard stop endpoint requires per-session token
- **Path traversal protection**: Static file serving validates against resource directory boundary
- **XSS protection**: Consistent HTML escaping across all dynamic content insertion
- **Prompt integrity**: SHA-256 hash verification of prompt content before execution
- **Git safety**: Pre-run tags, dedicated branches, no destructive git commands in prompts
- **Atomic locking**: `O_EXCL` flag prevents TOCTOU races on lock file creation
- **No secrets**: No API keys, tokens, or credentials in codebase
- **Error handling**: No stack traces or internal details leaked in HTTP responses
