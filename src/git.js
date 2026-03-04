import simpleGit from 'simple-git';
import { readFileSync, appendFileSync, existsSync } from 'fs';
import path from 'path';
import { info, debug, warn } from './logger.js';

const EPHEMERAL_FILES = ['nightytidy-run.log', 'nightytidy-progress.json', 'nightytidy-dashboard.url'];

let git = null;
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

export function initGit(projectDir) {
  projectRoot = projectDir;
  git = simpleGit(projectDir);
  return git;
}

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
    warn(`Could not add ephemeral file exclusions: ${err.message}`);
  }
}

export async function getCurrentBranch() {
  const status = await git.status();
  return status.current;
}

export async function createPreRunTag() {
  const timestamp = getTimestamp();
  const baseName = `nightytidy-before-${timestamp}`;
  let tagName = baseName;

  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await git.tag([tagName]);
      info(`Created pre-run safety tag: ${tagName}`);
      return tagName;
    } catch {
      tagName = `${baseName}-${attempt + 2}`;
    }
  }

  throw new Error(`Could not create safety tag — too many runs within the same minute. Try again shortly.`);
}

export async function createRunBranch(sourceBranch) {
  const timestamp = getTimestamp();
  const baseName = `nightytidy/run-${timestamp}`;
  let branchName = baseName;

  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await git.checkoutLocalBranch(branchName);
      info(`Created run branch: ${branchName} (from ${sourceBranch})`);
      return branchName;
    } catch {
      branchName = `${baseName}-${attempt + 2}`;
    }
  }

  throw new Error(`Could not create run branch — too many runs within the same minute. Try again shortly.`);
}

export async function getHeadHash() {
  try {
    const log = await git.log({ maxCount: 1 });
    return log.latest ? log.latest.hash : null;
  } catch {
    // Empty repo — git.log throws "does not have any commits yet"
    return null;
  }
}

export async function hasNewCommit(sinceHash) {
  const currentHash = await getHeadHash();
  return currentHash !== sinceHash;
}

export async function fallbackCommit(stepNumber, stepName) {
  // Exclude NightyTidy's ephemeral files — staging them causes the log file
  // to be tracked by git, and subsequent Claude Code subprocess git operations
  // can reset tracked files, losing log entries for later steps.
  const excludes = EPHEMERAL_FILES.map(f => `:!${f}`);
  await git.raw(['add', '-A', '--', '.', ...excludes]);

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

export function getGitInstance() {
  return git;
}
