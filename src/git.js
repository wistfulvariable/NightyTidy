/**
 * @fileoverview Git operations for NightyTidy.
 *
 * Provides branching, tagging, and commit operations for run management.
 * Uses simple-git as the underlying implementation.
 *
 * Error contract:
 * - Most functions throw on failure (caught by caller)
 * - mergeRunBranch NEVER throws — returns { success: false, conflict: true }
 */

import { readFileSync, appendFileSync, existsSync } from 'fs';
import path from 'path';
import simpleGit from 'simple-git';
import { info, debug, warn } from './logger.js';

/**
 * @typedef {import('simple-git').SimpleGit} SimpleGit
 */

/**
 * @typedef {Object} MergeResult
 * @property {boolean} success - Whether merge succeeded
 * @property {boolean} [conflict] - True if merge failed due to conflict
 */

const EPHEMERAL_FILES = ['nightytidy-run.log', 'nightytidy-progress.json', 'nightytidy-dashboard.url', 'nightytidy-run-state.json', 'nightytidy-run-state.json.tmp'];

const MAX_NAME_RETRIES = 10;

/** @type {SimpleGit|null} */
let git = null;
/** @type {string|null} */
let projectRoot = null;

function getTimestamp() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}-${hh}${min}`;
}

/**
 * Initialize the git module with a project directory.
 * Must be called before any other git operations.
 *
 * @param {string} projectDir - Absolute path to the project
 * @returns {SimpleGit} The git instance
 */
export function initGit(projectDir) {
  projectRoot = projectDir;
  git = simpleGit(projectDir);
  return git;
}

/**
 * Add NightyTidy ephemeral files to .git/info/exclude.
 * Prevents log and progress files from being tracked by git.
 *
 * @returns {void}
 */
export function excludeEphemeralFiles() {
  try {
    const excludePath = path.join(projectRoot, '.git', 'info', 'exclude');

    let content = '';
    if (existsSync(excludePath)) {
      content = readFileSync(excludePath, 'utf8');
    }

    const toAdd = EPHEMERAL_FILES.filter(f => !content.includes(f));
    if (toAdd.length === 0) return;

    const separator = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
    appendFileSync(excludePath, separator + '# NightyTidy ephemeral files\n' + toAdd.join('\n') + '\n', 'utf8');
    debug('Added ephemeral file exclusions to .git/info/exclude');
  } catch (err) {
    warn(`Could not add ephemeral file exclusions (${err.code || 'unknown'}): ${err.message}`);
  }
}

/**
 * Get the current branch name.
 *
 * @returns {Promise<string>} Current branch name
 */
export async function getCurrentBranch() {
  const status = await git.status();
  return status.current;
}

/**
 * Retry an operation with incrementing suffix on name collision.
 *
 * @param {string} baseName - Base name to try
 * @param {(name: string) => Promise<void>} operationFn - Operation to attempt
 * @param {string} errorMessage - Error message if all retries fail
 * @returns {Promise<string>} The successful name (with or without suffix)
 */
async function retryWithSuffix(baseName, operationFn, errorMessage) {
  let name = baseName;
  for (let attempt = 0; attempt < MAX_NAME_RETRIES; attempt++) {
    try {
      await operationFn(name);
      return name;
    } catch {
      name = `${baseName}-${attempt + 2}`;
    }
  }
  throw new Error(errorMessage);
}

/**
 * Create a pre-run safety tag at HEAD.
 * Allows user to undo all run changes by resetting to this tag.
 *
 * @returns {Promise<string>} The created tag name
 */
export async function createPreRunTag() {
  const baseName = `nightytidy-before-${getTimestamp()}`;
  const tagName = await retryWithSuffix(
    baseName,
    (name) => git.tag([name]),
    'Could not create safety tag — too many runs within the same minute. Try again shortly.',
  );
  info(`Created pre-run safety tag: ${tagName}`);
  return tagName;
}

/**
 * Create and checkout a new run branch.
 *
 * @param {string} sourceBranch - Branch to branch from (for logging)
 * @returns {Promise<string>} The created branch name
 */
export async function createRunBranch(sourceBranch) {
  const baseName = `nightytidy/run-${getTimestamp()}`;
  const branchName = await retryWithSuffix(
    baseName,
    (name) => git.checkoutLocalBranch(name),
    'Could not create run branch — too many runs within the same minute. Try again shortly.',
  );
  info(`Created run branch: ${branchName} (from ${sourceBranch})`);
  return branchName;
}

/**
 * Get the commit hash of HEAD.
 *
 * @returns {Promise<string|null>} 40-character hex hash, or null if no commits
 */
export async function getHeadHash() {
  try {
    const log = await git.log({ maxCount: 1 });
    return log.latest ? log.latest.hash : null;
  } catch {
    // Empty repo — git.log throws "does not have any commits yet"
    return null;
  }
}

/**
 * Check if a new commit has been made since a given hash.
 *
 * @param {string|null} sinceHash - Previous HEAD hash to compare against
 * @returns {Promise<boolean>} True if HEAD has changed
 */
export async function hasNewCommit(sinceHash) {
  const currentHash = await getHeadHash();
  return currentHash !== sinceHash;
}

/**
 * Create a fallback commit for a step if Claude didn't commit.
 *
 * @param {number} stepNumber - Step number for commit message
 * @param {string} stepName - Step name for commit message
 * @returns {Promise<boolean>} True if commit was created, false if nothing to commit
 */
export async function fallbackCommit(stepNumber, stepName) {
  // Ephemeral files are already excluded via .git/info/exclude
  // (set up by excludeEphemeralFiles). Plain `git add -A` respects that.
  // Do NOT use `:!` pathspec exclusions — git 2.53+ errors when the
  // excluded file also matches a .gitignore pattern in the target project.
  await git.raw(['add', '-A']);

  const status = await git.status();
  if (status.staged.length === 0) {
    info(`Step ${stepNumber}: No changes detected — skipping fallback commit`);
    return false;
  }

  const message = `NightyTidy: Step ${stepNumber} \u2014 ${stepName} complete`;
  await git.commit(message);
  info(`Step ${stepNumber}: fallback commit made \u2713`);
  return true;
}

/**
 * Merge the run branch back into the original branch.
 *
 * Error contract: This function NEVER throws. On conflict, it returns
 * { success: false, conflict: true } and aborts the merge.
 *
 * @param {string} originalBranch - Branch to merge into
 * @param {string} runBranch - Branch to merge from
 * @returns {Promise<MergeResult>} Merge result (never throws)
 */
export async function mergeRunBranch(originalBranch, runBranch) {
  try {
    await git.checkout(originalBranch);
    await git.merge([runBranch, '--no-ff']);
    info(`Merged ${runBranch} into ${originalBranch}`);
    return { success: true };
  } catch (err) {
    // Merge conflict — abort and return conflict indicator
    try {
      await git.merge(['--abort']);
    } catch {
      // Abort may fail if not in merge state
    }
    warn(`Merge conflict merging ${runBranch} into ${originalBranch}`);
    debug(`Merge error: ${err.message}`);
    return { success: false, conflict: true };
  }
}

/**
 * @typedef {Object} BranchGuardResult
 * @property {boolean} recovered - True if branch recovery was needed
 * @property {string} [strayBranch] - The branch we recovered from
 * @property {boolean} [mergeOk] - True if stray branch was successfully merged
 */

/**
 * Ensure the working directory is on the expected branch.
 *
 * If Claude Code created/switched to a different branch during a step,
 * this function recovers by checking out the expected branch and merging
 * the stray branch's work into it. This prevents commit fragmentation
 * across multiple branches during a NightyTidy run.
 *
 * @param {string} expectedBranch - The branch we should be on
 * @returns {Promise<BranchGuardResult>} Result (never throws)
 */
export async function ensureOnBranch(expectedBranch) {
  try {
    const current = await getCurrentBranch();

    // Detached HEAD (current is null) — force checkout expected branch
    if (!current) {
      warn(`Branch drift: detached HEAD — checking out "${expectedBranch}"`);
      await git.checkout(expectedBranch);
      return { recovered: true, strayBranch: '(detached HEAD)', mergeOk: false };
    }

    if (current === expectedBranch) {
      return { recovered: false };
    }

    warn(`Branch drift: expected "${expectedBranch}" but on "${current}" — recovering`);

    // Stage any uncommitted work on the stray branch before switching
    const status = await git.status();
    if (status.files.length > 0) {
      debug(`Stray branch has ${status.files.length} uncommitted files — committing before merge`);
      await git.raw(['add', '-A']);
      await git.commit('NightyTidy: save uncommitted work before branch recovery');
    }

    // Switch back to the expected branch
    await git.checkout(expectedBranch);

    // Merge the stray branch to capture its commits
    try {
      await git.merge([current, '--no-ff', '-m', `NightyTidy: merge step work from ${current}`]);
      info(`Branch guard: merged "${current}" into "${expectedBranch}"`);
      return { recovered: true, strayBranch: current, mergeOk: true };
    } catch {
      // Merge conflict — abort and warn. Step work is preserved on the stray branch.
      try { await git.merge(['--abort']); } catch { /* may not be in merge state */ }
      warn(`Branch guard: could not auto-merge "${current}" — step work preserved on that branch`);
      return { recovered: true, strayBranch: current, mergeOk: false };
    }
  } catch (err) {
    warn(`Branch guard error: ${err.message}`);
    return { recovered: false };
  }
}

/**
 * Get the initialized git instance.
 *
 * @returns {SimpleGit|null} The git instance, or null if not initialized
 */
export function getGitInstance() {
  return git;
}
