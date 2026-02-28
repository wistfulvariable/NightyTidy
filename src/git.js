import simpleGit from 'simple-git';
import { info, debug, warn } from './logger.js';

let git = null;

function getTimestamp() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}-${hh}${min}`;
}

export function initGit(projectDir) {
  git = simpleGit(projectDir);
  return git;
}

export async function getCurrentBranch() {
  const status = await git.status();
  return status.current;
}

export async function createPreRunTag() {
  const timestamp = getTimestamp();
  let tagName = `nightytidy-before-${timestamp}`;

  try {
    await git.tag([tagName]);
  } catch {
    // Tag exists — append counter
    tagName = `${tagName}-2`;
    await git.tag([tagName]);
  }

  info(`Created pre-run safety tag: ${tagName}`);
  return tagName;
}

export async function createRunBranch(sourceBranch) {
  const timestamp = getTimestamp();
  const branchName = `nightytidy/run-${timestamp}`;

  await git.checkoutLocalBranch(branchName);
  info(`Created run branch: ${branchName} (from ${sourceBranch})`);
  return branchName;
}

export async function getHeadHash() {
  const log = await git.log({ maxCount: 1 });
  return log.latest.hash;
}

export async function hasNewCommit(sinceHash) {
  const currentHash = await getHeadHash();
  return currentHash !== sinceHash;
}

export async function fallbackCommit(stepNumber, stepName) {
  await git.add('-A');
  const status = await git.status();

  if (status.staged.length === 0 && status.files.length === 0) {
    info(`Step ${stepNumber}: No changes detected — skipping fallback commit`);
    return false;
  }

  const message = `NightyTidy: Step ${stepNumber} \u2014 ${stepName} complete`;
  await git.commit(message);
  info(`Step ${stepNumber}: fallback commit made \u2713`);
  return true;
}

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

export async function findExistingRunBranches() {
  const branches = await git.branch();
  return branches.all.filter(b => b.startsWith('nightytidy/run-'));
}

export function getGitInstance() {
  return git;
}
