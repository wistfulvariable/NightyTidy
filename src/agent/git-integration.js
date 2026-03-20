import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { debug, warn } from '../logger.js';

const execFileAsync = promisify(execFile);

export class AgentGit {
  constructor(projectDir) {
    this.projectDir = projectDir;
  }

  async getDiffStat(baseBranch, runBranch) {
    return this._exec('git', ['diff', '--stat', `${baseBranch}...${runBranch}`]);
  }

  async getDiff(baseBranch, runBranch) {
    return this._exec('git', ['diff', `${baseBranch}...${runBranch}`]);
  }

  async countFilesChanged(baseBranch, runBranch) {
    const output = await this._exec('git', ['diff', '--name-only', `${baseBranch}...${runBranch}`]);
    return output.trim().split('\n').filter(Boolean).length;
  }

  async rollback(tag) {
    // Safety: verify tag exists and is a nightytidy tag
    const tagExists = (await this._exec('git', ['tag', '-l', tag])).trim();
    if (!tagExists || !tag.startsWith('nightytidy-before-')) {
      throw new Error(`Invalid rollback tag: ${tag}`);
    }
    debug(`Rolling back to tag: ${tag}`);
    await this._exec('git', ['reset', '--hard', tag]);
  }

  async createPr(branch, title, body) {
    try {
      // Use execFile with args array to prevent command injection
      const result = await this._exec('gh', [
        'pr', 'create', '--head', branch, '--title', title, '--body', body,
      ]);
      const url = result.trim().split('\n').pop();
      return { success: true, url };
    } catch (err) {
      warn(`PR creation failed: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  async merge(runBranch, targetBranch) {
    try {
      await this._exec('git', ['checkout', targetBranch]);
      await this._exec('git', ['merge', runBranch, '--no-edit']);
      return { success: true };
    } catch (err) {
      // Abort failed merge
      try { await this._exec('git', ['merge', '--abort']); } catch { /* ignore */ }
      return { success: false, conflict: true, error: err.message };
    }
  }

  async getReport(branch) {
    // List files matching NIGHTYTIDY-REPORT*.md on the branch
    const lsOutput = await this._exec('git', ['ls-tree', '--name-only', branch]);
    const reportFile = lsOutput.trim().split('\n')
      .filter(f => f.startsWith('NIGHTYTIDY-REPORT') && f.endsWith('.md'))
      .sort()
      .pop(); // Take the latest (highest numbered)
    if (!reportFile) return null;
    const content = await this._exec('git', ['show', `${branch}:${reportFile}`]);
    return { filename: reportFile, content };
  }

  async _exec(cmd, args) {
    const { stdout } = await execFileAsync(cmd, args, {
      cwd: this.projectDir,
      maxBuffer: 50 * 1024 * 1024, // 50 MB — large diffs from 33-step runs
    });
    return stdout;
  }
}
