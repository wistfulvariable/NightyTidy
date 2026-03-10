# NightyTidy Disaster Recovery Guide

**Last Updated**: 2026-03-10
**Document Owner**: ⚠️ TEAM INPUT NEEDED: Assign a document owner

This document provides recovery procedures for NightyTidy in disaster scenarios. NightyTidy is a stateless CLI tool with no database, no cloud infrastructure, and no persistent user data beyond Git artifacts.

---

## 1. Data Store Inventory

| Data Store | Type | Criticality | Backup Method | Frequency | Location | RPO | RTO |
|------------|------|-------------|---------------|-----------|----------|-----|-----|
| Source code (this repo) | Git | Irreplaceable | GitHub remote | Every push | GitHub | Per-commit | <5 min |
| User's target codebase | Git (external) | N/A (user-managed) | Safety tag + run branch | Per NightyTidy run | Local + user's remote | Near-zero | <1 min |
| npm package | Published artifact | Reconstructable | npm registry | Every publish | npmjs.com | Per-version | <5 min |
| Prompt definitions | Markdown files | Reconstructable | Git + Google Doc sync | Every sync | Local (synced from Google Doc) | Near-zero | <5 min |
| Per-run log file | Ephemeral | Non-critical | None | N/A | Local filesystem | N/A | N/A |
| Per-run state files | Ephemeral | Non-critical | None | N/A | Local filesystem | N/A | N/A |

### Criticality Classification

**Irreplaceable**:
- Source code in this repository (primary development work)
- ⚠️ TEAM INPUT NEEDED: Identify any proprietary prompt content that should be backed up separately

**Reconstructable**:
- npm package (republish from source)
- Prompt files (re-sync from Google Doc source)
- node_modules (npm install)

**Ephemeral** (loss acceptable):
- `nightytidy-run.log` — per-run execution log
- `nightytidy-progress.json` — live progress state
- `nightytidy-run-state.json` — orchestrator mode state
- `nightytidy.lock` — concurrent run prevention
- `nightytidy-dashboard.url` — dashboard URL file
- `nightytidy-gui.log` — GUI session log

---

## 2. Recovery Procedures

### 2.1 Source Code Repository Lost

**Scenario**: The GitHub repository is deleted, corrupted, or inaccessible.

**Prerequisites**:
- A local clone of the repository exists on any developer machine
- OR a fork exists on GitHub

**Recovery Steps**:

1. **Locate a backup clone**:
   ```bash
   # Check for local clones
   find ~ -type d -name "NightyTidy" 2>/dev/null
   ```

2. **Create new GitHub repository**:
   - Go to https://github.com/new
   - Name: `NightyTidy`
   - Make it private initially for safety

3. **Push from local clone**:
   ```bash
   cd /path/to/local/NightyTidy
   git remote set-url origin https://github.com/YOUR_ORG/NightyTidy.git
   git push --all origin
   git push --tags origin
   ```

4. **Verify integrity**:
   ```bash
   npm install
   npm test
   ```

**Fallback**: If no local clone exists but a fork does, clone from the fork.

**⚠️ TEAM INPUT NEEDED**: List all developers with local clones:
- [ ] Developer 1: _______________
- [ ] Developer 2: _______________

---

### 2.2 npm Package Republish

**Scenario**: The npm package is unpublished, corrupted, or a malicious version was published.

**Prerequisites**:
- Source code repository is intact
- npm account credentials for the `nightytidy` package

**Recovery Steps**:

1. **Verify source integrity**:
   ```bash
   git checkout master
   npm install
   npm test
   npm run test:ci  # Verify coverage thresholds
   ```

2. **Bump version if needed** (to publish over a corrupt version):
   ```bash
   npm version patch
   ```

3. **Publish**:
   ```bash
   npm publish
   ```

4. **Verify publication**:
   ```bash
   npm info nightytidy
   npx nightytidy --version
   ```

**⚠️ TEAM INPUT NEEDED**: npm account owner and backup account:
- Primary: _______________
- Backup: _______________

---

### 2.3 Prompt Files Corrupted or Lost

**Scenario**: Local prompt files in `src/prompts/steps/` are deleted, corrupted, or diverged from source of truth.

**Prerequisites**:
- The Google Doc (source of truth) is accessible
- Internet connectivity

**Recovery Steps**:

1. **Re-sync from Google Doc**:
   ```bash
   npx nightytidy --sync
   ```

2. **Verify sync succeeded**:
   ```bash
   git diff src/prompts/
   npm test  # steps.test.js validates prompt integrity
   ```

3. **If Google Doc is unavailable**, restore from Git history:
   ```bash
   git checkout HEAD~10 -- src/prompts/
   git diff HEAD src/prompts/  # Review changes
   ```

**⚠️ TEAM INPUT NEEDED**: Google Doc URL for prompts:
- URL: _______________
- Owner: _______________

---

### 2.4 User's Codebase Recovery (NightyTidy Run Gone Wrong)

**Scenario**: A NightyTidy run made unwanted changes to a user's codebase.

**Prerequisites**:
- The safety tag `nightytidy-before-*` was created (always created by NightyTidy before any changes)

**Recovery Steps** (in the user's project directory):

1. **Find the safety tag**:
   ```bash
   git tag | grep nightytidy-before
   ```

2. **Reset to pre-run state**:
   ```bash
   git reset --hard nightytidy-before-YYYY-MM-DD-HHMM
   ```

3. **Clean up the run branch** (optional):
   ```bash
   git branch -D nightytidy/run-YYYY-MM-DD-HHMM
   ```

4. **Verify recovery**:
   ```bash
   git status
   git log --oneline -5
   ```

**If safety tag is missing** (should never happen):
- Check for any `nightytidy/run-*` branches
- Use `git reflog` to find the pre-run commit

---

### 2.5 Interrupted Run Recovery

**Scenario**: A NightyTidy run was interrupted (Ctrl+C, power loss, system crash).

**Recovery Steps**:

1. **Check current state**:
   ```bash
   git branch --show-current  # Should be nightytidy/run-* or original branch
   git tag | grep nightytidy-before  # Find safety tag
   ls nightytidy-run-state.json  # Orchestrator state (if exists)
   ls nightytidy.lock  # Lock file (if exists)
   ```

2. **Option A: Keep partial changes**:
   ```bash
   git checkout main  # Or your original branch
   git merge nightytidy/run-YYYY-MM-DD-HHMM
   ```

3. **Option B: Discard all changes**:
   ```bash
   git reset --hard nightytidy-before-YYYY-MM-DD-HHMM
   ```

4. **Clean up ephemeral files**:
   ```bash
   rm -f nightytidy.lock nightytidy-run-state.json nightytidy-progress.json
   ```

---

## 3. Infrastructure Recreation

### What Can Be Recreated From Git Alone

| Component | Fully Recreatable | Notes |
|-----------|-------------------|-------|
| Source code | Yes | Git clone |
| Dependencies | Yes | `npm install` |
| Test suite | Yes | `npm test` |
| CLI tool | Yes | `npx nightytidy` or `npm link` |
| GUI | Yes | `npm run gui` |
| Prompts | Yes | `--sync` from Google Doc |

### What Requires Manual Setup

| Component | Manual Steps Required |
|-----------|----------------------|
| npm publish access | Request access from npm package owner |
| GitHub repo admin | Request access from repo owner |
| Google Doc access | Request access from doc owner |
| Claude Code auth | Run `claude` and sign in with Anthropic account |

**⚠️ TEAM INPUT NEEDED**: Document all manual setup requirements:
- npm publish credentials: _______________
- GitHub repo admin contacts: _______________
- Google Doc access contacts: _______________

---

## 4. Credential Rotation Procedures

### 4.1 npm Token Rotation

**Trigger**: npm token compromised or routine rotation

**Steps**:
1. Log in to npmjs.com
2. Navigate to Access Tokens
3. Revoke the compromised token
4. Generate a new token
5. Update any CI/CD secrets that use this token

**Expected Downtime**: None (publishing only affected)

**⚠️ TEAM INPUT NEEDED**: Where are npm tokens stored?
- CI system: _______________
- Developer machines: _______________

### 4.2 GitHub Token Rotation

**Trigger**: GitHub PAT compromised or routine rotation

**Steps**:
1. Log in to GitHub
2. Settings > Developer settings > Personal access tokens
3. Revoke the compromised token
4. Generate a new token with appropriate scopes
5. Update any CI/CD secrets

**Expected Downtime**: None (CI failures until token updated)

### 4.3 Anthropic API Key Rotation (Claude Code)

NightyTidy does **not** handle Anthropic credentials directly. Claude Code manages its own authentication.

**Rotation Steps**:
1. Run `claude logout` (if such a command exists)
2. Run `claude` to re-authenticate
3. Follow the OAuth/browser flow

**Expected Downtime**: None per user; each user manages their own auth

---

## 5. Disaster Response Playbooks

### Playbook A: Repository Unavailable

**Detection**: GitHub 5xx errors, repository 404, or "repository not found" errors

**Triage**:
1. Check https://www.githubstatus.com/ for outages
2. Verify repository URL is correct
3. Check team access hasn't been revoked

**Recovery**:
- If GitHub outage: Wait for resolution
- If repo deleted: Follow Section 2.1 (Source Code Repository Lost)
- If access revoked: Contact repo admin

**Verification**:
```bash
git fetch origin
git status
```

**Post-Incident**:
- Document cause
- Review access controls
- Consider additional backup (mirror to GitLab/Bitbucket)

---

### Playbook B: npm Package Compromised

**Detection**: User reports malicious behavior, npm audit alerts, or version mismatch

**Triage**:
1. Check npm package page for unexpected versions
2. `npm view nightytidy versions`
3. Compare published content with source

**Recovery**:
1. `npm unpublish nightytidy@COMPROMISED_VERSION` (if <72h since publish)
2. Otherwise, publish a patched version with higher version number
3. Alert users via README, GitHub issues, social media

**Verification**:
```bash
npm info nightytidy
npm pack nightytidy && tar -tvf nightytidy-*.tgz
```

**Post-Incident**:
- Rotate npm tokens
- Review CI/CD security
- Enable npm 2FA if not already

---

### Playbook C: Claude Code Service Outage

**Detection**: "Claude Code didn't respond within 30 seconds" error, or API timeout errors

**Triage**:
1. Check https://status.anthropic.com/
2. Test manually: `claude -p "Say OK"`

**Recovery**:
- Wait for Anthropic to resolve the outage
- NightyTidy has no fallback AI provider

**Mitigation**:
- Users can retry later
- Partial runs are preserved on the run branch

---

## 6. Emergency Contacts & Access

| Role | Name | Contact | Access Level |
|------|------|---------|--------------|
| Repository Owner | ⚠️ TEAM INPUT NEEDED | ⚠️ TEAM INPUT NEEDED | Admin |
| npm Package Owner | ⚠️ TEAM INPUT NEEDED | ⚠️ TEAM INPUT NEEDED | Publish |
| Google Doc Owner | ⚠️ TEAM INPUT NEEDED | ⚠️ TEAM INPUT NEEDED | Edit |
| On-Call Engineer | ⚠️ TEAM INPUT NEEDED | ⚠️ TEAM INPUT NEEDED | Developer |

---

## 7. Recovery Testing Schedule

| Test | Frequency | Last Tested | Next Scheduled |
|------|-----------|-------------|----------------|
| Clone from GitHub and run tests | Monthly | ⚠️ Never | ⚠️ Schedule |
| npm install from registry | Monthly | ⚠️ Never | ⚠️ Schedule |
| Prompt sync from Google Doc | Monthly | ⚠️ Never | ⚠️ Schedule |
| Safety tag rollback | Per release | Built into tests | N/A |

---

*This document should be reviewed and updated after any incident or major infrastructure change.*
