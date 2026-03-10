# NightyTidy Backup Recommendations

**Generated**: 2026-03-10
**Context**: This document provides specific recommendations for backup and disaster recovery improvements.

---

## Executive Summary

NightyTidy is a **stateless CLI tool** with an **excellent built-in recovery story**. It has no database, no cloud infrastructure, and no persistent user data. The primary backup mechanisms are:

1. **Git** (source code → GitHub)
2. **npm registry** (published package)
3. **Google Doc** (prompt source of truth)
4. **Safety tags** (user codebase protection, built-in)

**Overall Assessment**: The existing architecture minimizes backup requirements. Most recommendations focus on **documentation and process** rather than new backup infrastructure.

---

## Recommendations

### Priority 1: Critical (Implement This Week)

#### R1: Fill in DISASTER_RECOVERY.md Team Input Sections

**What**: The newly generated `docs/DISASTER_RECOVERY.md` contains `⚠️ TEAM INPUT NEEDED` markers for emergency contacts, access credentials, and document ownership.

**Why**: During an incident, responders need to know who to contact and where credentials are stored. Missing this information causes delays.

**Effort**: 30 minutes

**How**:
1. Open `docs/DISASTER_RECOVERY.md`
2. Search for `⚠️ TEAM INPUT NEEDED`
3. Fill in all 15+ placeholders with actual names, contacts, and locations

---

### Priority 2: High (Implement This Month)

#### R2: Enable GitHub Repository Mirroring

**What**: Mirror the GitHub repository to a second Git hosting service (GitLab, Bitbucket, or a self-hosted Git server).

**Why**: If GitHub experiences a catastrophic outage or the repository is accidentally deleted, a mirror provides a secondary recovery point.

**Effort**: 1-2 hours setup, automated thereafter

**How**:
1. Create a mirror repository on GitLab (free tier supports unlimited private repos)
2. Add a GitHub Action to push to the mirror on every commit:
   ```yaml
   - name: Mirror to GitLab
     run: |
       git push --mirror https://gitlab.com/YOUR_ORG/NightyTidy.git
   ```
3. Test the mirror by cloning from it and running tests

**Tooling**: GitHub Actions + GitLab (or Bitbucket, AWS CodeCommit)

---

#### R3: Enable npm Package 2FA

**What**: Enable two-factor authentication for the npm account that publishes `nightytidy`.

**Why**: npm packages are high-value supply chain targets. 2FA prevents unauthorized publishes even if credentials leak.

**Effort**: 15 minutes

**How**:
1. Log in to npmjs.com
2. Navigate to Account Settings > Security
3. Enable 2FA for all operations (not just "publish")
4. Store backup codes in a password manager

**Tooling**: Authenticator app (Authy, Google Authenticator, 1Password)

---

### Priority 3: Medium (Implement This Quarter)

#### R4: Create Prompt Backup Exports

**What**: Periodically export prompt content from the Google Doc to a versioned backup location.

**Why**: While prompts can be synced from the Google Doc, having a backup prevents loss if the doc is deleted or access is revoked.

**Effort**: 1 hour setup, 5 minutes monthly

**How**:
1. Export the Google Doc as PDF and HTML monthly
2. Store exports in a dedicated `prompts-backup/` directory in the repo (or a separate backup repo)
3. Consider automating with Google Apps Script or a cron job

**Tooling**: Google Drive API or manual export

---

#### R5: Document Recovery Testing Procedure

**What**: Create a runbook for quarterly recovery testing.

**Why**: Backups are useless if they've never been tested. A formal testing procedure ensures the team knows recovery works.

**Effort**: 2-3 hours to create, 1 hour quarterly to execute

**How**:
1. Create `docs/RECOVERY_TEST_PROCEDURE.md`
2. Define test scenarios:
   - Clone fresh from GitHub, run tests
   - Install from npm registry, verify version
   - Sync prompts from Google Doc, compare with local
   - Create a test project, run NightyTidy, test rollback
3. Schedule quarterly execution
4. Log results in the document

---

### Priority 4: Low (Implement When Convenient)

#### R6: Add Backup Status to CI

**What**: Add a CI check that verifies backup locations are accessible.

**Why**: Silent backup failures are common. A CI check provides early warning.

**Effort**: 1-2 hours

**How**:
1. Add a scheduled GitHub Action (weekly) that:
   - Verifies the mirror repository is reachable
   - Verifies the Google Doc sync endpoint responds
   - Verifies npm package metadata is accessible
2. Alert on failure (GitHub notification, Slack, email)

**Tooling**: GitHub Actions scheduled workflow

---

#### R7: Create Offline Recovery Kit

**What**: Prepare a USB drive or offline archive with:
- Full repository clone
- npm package tarball
- Prompt markdown files
- This documentation

**Why**: In a truly catastrophic scenario (no internet, all cloud services down), an offline kit enables local development to continue.

**Effort**: 1 hour to create, update annually

**How**:
```bash
# Create offline kit
mkdir nightytidy-recovery-kit
cd nightytidy-recovery-kit
git clone --mirror https://github.com/YOUR_ORG/NightyTidy.git repo.git
npm pack nightytidy
cp -r /path/to/NightyTidy/src/prompts prompts/
cp /path/to/NightyTidy/docs/*.md docs/
tar -czvf nightytidy-recovery-kit.tar.gz *
```

---

## Not Recommended

The following are explicitly **not recommended** due to NightyTidy's architecture:

| Don't Do | Reason |
|----------|--------|
| Set up a database backup system | NightyTidy has no database |
| Implement file storage replication | All files are ephemeral or in Git |
| Create Redis/cache backups | No cache layer exists |
| Set up log aggregation | Logs are per-run and non-critical |
| Implement PITR for state files | State files are ephemeral and small |

---

## Implementation Checklist

| # | Recommendation | Priority | Effort | Owner | Due Date | Done |
|---|----------------|----------|--------|-------|----------|------|
| R1 | Fill DISASTER_RECOVERY.md | Critical | 30 min | ⚠️ TBD | This week | [ ] |
| R2 | GitHub mirroring | High | 2 hours | ⚠️ TBD | This month | [ ] |
| R3 | npm 2FA | High | 15 min | ⚠️ TBD | This month | [ ] |
| R4 | Prompt backup exports | Medium | 1 hour | ⚠️ TBD | This quarter | [ ] |
| R5 | Recovery test procedure | Medium | 3 hours | ⚠️ TBD | This quarter | [ ] |
| R6 | Backup status CI | Low | 2 hours | ⚠️ TBD | When convenient | [ ] |
| R7 | Offline recovery kit | Low | 1 hour | ⚠️ TBD | When convenient | [ ] |

---

*Review this document after implementing recommendations or after any infrastructure changes.*
