import { Command } from 'commander';
import checkbox from '@inquirer/checkbox';
import ora from 'ora';
import chalk from 'chalk';
import { homedir } from 'os';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';

import { initLogger, info, error as logError, debug, warn } from './logger.js';
import { runPreChecks } from './checks.js';
import { initGit, getCurrentBranch, createPreRunTag, createRunBranch, mergeRunBranch, getGitInstance } from './git.js';
import { runPrompt } from './claude.js';
import { STEPS, CHANGELOG_PROMPT } from './prompts/steps.js';
import { executeSteps } from './executor.js';
import { notify } from './notifications.js';
import { generateReport, formatDuration, getVersion } from './report.js';

function buildStepCallbacks(spinner, selected) {
  return {
    onStepStart: (step, idx, total) => {
      spinner.text = `\u23f3 Step ${idx + 1}/${total}: ${step.name}...`;
    },
    onStepComplete: (step, idx, total) => {
      spinner.stop();
      console.log(chalk.green(`\u2713 Step ${idx + 1}/${total}: ${step.name} \u2014 done`));
      if (idx + 1 < total) {
        spinner.start(`\u23f3 Step ${idx + 2}/${total}: ${selected[idx + 1].name}...`);
      }
    },
    onStepFail: (step, idx, total) => {
      spinner.stop();
      console.log(chalk.red(`\u2717 Step ${idx + 1}/${total}: ${step.name} \u2014 failed`));
      if (idx + 1 < total) {
        spinner.start(`\u23f3 Step ${idx + 2}/${total}: ${selected[idx + 1].name}...`);
      }
    },
  };
}

async function handleAbortedRun(executionResults, { projectDir, runBranch, tagName, originalBranch }) {
  info('Run interrupted by user');
  await generateReport(executionResults, null, {
    projectDir,
    branchName: runBranch,
    tagName,
    originalBranch,
    startTime: Date.now() - executionResults.totalDuration,
    endTime: Date.now(),
  });

  const gitInstance = getGitInstance();
  try {
    await gitInstance.add(['NIGHTYTIDY-REPORT.md']);
    await gitInstance.commit('NightyTidy: Add partial run report');
  } catch { /* ignore */ }

  notify('NightyTidy Stopped', `${executionResults.completedCount} steps completed. Changes on branch ${runBranch}.`);

  console.log(chalk.yellow(
    `\n\u26a0\ufe0f  NightyTidy stopped. ${executionResults.completedCount} steps completed.\n` +
    `   Changes are on branch: ${runBranch}\n` +
    `   To merge what was done: git checkout ${originalBranch} && git merge ${runBranch}\n`
  ));
  process.exit(0);
}

function printCompletionSummary(executionResults, mergeResult, { runBranch, tagName }) {
  const totalSteps = executionResults.completedCount + executionResults.failedCount;
  const durationStr = formatDuration(executionResults.totalDuration);

  if (mergeResult.success) {
    if (executionResults.failedCount === 0) {
      notify('NightyTidy Complete \u2713', `All ${executionResults.completedCount} steps succeeded. See NIGHTYTIDY-REPORT.md`);
    } else {
      notify('NightyTidy Complete', `${executionResults.completedCount}/${totalSteps} succeeded, ${executionResults.failedCount} failed. See NIGHTYTIDY-REPORT.md`);
    }
  } else {
    notify('NightyTidy Complete', `${executionResults.completedCount}/${totalSteps} steps done. Merge needs attention \u2014 see terminal.`);
    notify('NightyTidy: Merge Conflict', `Changes are on branch ${runBranch}. See NIGHTYTIDY-REPORT.md for resolution steps.`);
  }

  if (mergeResult.success) {
    if (executionResults.failedCount === 0) {
      console.log(chalk.green(`\n\u2705 NightyTidy complete \u2014 ${executionResults.completedCount}/${totalSteps} steps succeeded (${durationStr})`));
    } else {
      console.log(chalk.yellow(`\n\u26a0\ufe0f  NightyTidy complete \u2014 ${executionResults.completedCount}/${totalSteps} steps succeeded, ${executionResults.failedCount} failed (${durationStr})`));
    }
    console.log(chalk.dim(`\ud83d\udcc4 Report: NIGHTYTIDY-REPORT.md`));
    console.log(chalk.dim(`\ud83c\udff7\ufe0f  Safety tag: ${tagName}`));
  } else {
    console.log(chalk.yellow(`\n\u26a0\ufe0f  NightyTidy complete \u2014 ${executionResults.completedCount}/${totalSteps} steps succeeded, but merge needs attention.`));
    console.log(chalk.dim(`\ud83d\udcc4 Changes on branch: ${runBranch}`));
    console.log(chalk.dim(`\ud83c\udff7\ufe0f  Safety tag: ${tagName}`));
    console.log(chalk.yellow(
      `\n   Your improvements are safe on: ${runBranch}\n\n` +
      `   To merge manually:\n` +
      `     git merge ${runBranch}\n` +
      `     (resolve conflicts)\n` +
      `     git commit\n\n` +
      `   Or ask Claude Code:\n` +
      `     "Merge the branch ${runBranch} into my current branch\n` +
      `      and resolve any conflicts."\n`
    ));
  }
}

function showWelcome() {
  const markerDir = path.join(homedir(), '.nightytidy');
  const markerFile = path.join(markerDir, 'welcome-shown');

  if (existsSync(markerFile)) return;

  console.log(chalk.cyan(
    '\n' +
    '\u256d\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256e\n' +
    '\u2502                                                              \u2502\n' +
    '\u2502  Welcome to NightyTidy!                                      \u2502\n' +
    '\u2502                                                              \u2502\n' +
    '\u2502  NightyTidy will run 28 codebase improvement steps through   \u2502\n' +
    '\u2502  Claude Code. This typically takes 4-8 hours.                \u2502\n' +
    '\u2502                                                              \u2502\n' +
    '\u2502  All changes happen on a dedicated branch and are            \u2502\n' +
    '\u2502  automatically merged when done. You can check progress      \u2502\n' +
    '\u2502  anytime in nightytidy-run.log.                              \u2502\n' +
    '\u2502                                                              \u2502\n' +
    '\u2502  A safety snapshot is created before starting \u2014 you can      \u2502\n' +
    '\u2502  always undo everything if needed.                           \u2502\n' +
    '\u2502                                                              \u2502\n' +
    '\u2570\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256f\n'
  ));

  try {
    mkdirSync(markerDir, { recursive: true });
    writeFileSync(markerFile, new Date().toISOString(), 'utf8');
  } catch {
    debug('Could not create welcome marker file');
  }
}

export async function run() {
  const program = new Command();
  program
    .name('nightytidy')
    .description('Automated overnight codebase improvement through Claude Code')
    .version(getVersion());

  program.parse();

  const projectDir = process.cwd();
  let spinner;
  let runStarted = false;
  let tagName = '';
  let runBranch = '';
  let originalBranch = '';

  // Unhandled rejection safety net
  process.on('unhandledRejection', (reason) => {
    try { logError(`Unhandled rejection: ${reason}`); } catch { /* logger may not be init */ }
    console.error(chalk.red('\n\u274c An unexpected error occurred. Check nightytidy-run.log for details.'));
    process.exit(1);
  });

  // Ctrl+C handling
  let interrupted = false;
  const abortController = new AbortController();

  process.on('SIGINT', () => {
    if (interrupted) {
      console.log('\nForce stopping.');
      process.exit(1);
    }
    interrupted = true;
    console.log(chalk.yellow('\n\u26a0\ufe0f  Stopping NightyTidy... finishing current step.'));
    abortController.abort();
  });

  try {
    // 1. Initialize logger
    initLogger(projectDir);
    info('NightyTidy starting');

    // 2. Show first-run welcome
    showWelcome();

    // 3. Initialize git and run pre-checks
    const git = initGit(projectDir);
    await runPreChecks(projectDir, git);

    // 4. Step selector
    const selected = await checkbox({
      message: 'Select steps to run (Enter to run all):',
      choices: STEPS.map(step => ({
        name: `${step.number}. ${step.name}`,
        value: step,
        checked: true,
      })),
      pageSize: 15,
    });

    if (!selected || selected.length === 0) {
      console.log(chalk.yellow('You need to select at least one step. Exiting.'));
      process.exit(0);
    }

    // 5. Sleep tip
    console.log(chalk.dim(
      '\n\ud83d\udca1 Tip: Make sure your computer won\'t go to sleep during the run.\n' +
      '   This typically takes 4-8 hours. Disable sleep in your power settings.\n'
    ));

    // 6. Git setup
    originalBranch = await getCurrentBranch();
    tagName = await createPreRunTag();
    runBranch = await createRunBranch(originalBranch);
    runStarted = true;

    // 7. Run started notification
    notify('NightyTidy Started', `Running ${selected.length} steps. Check nightytidy-run.log for progress.`);

    // 8. Spinner
    spinner = ora({
      text: `\u23f3 Step 1/${selected.length}: ${selected[0].name}...`,
      color: 'cyan',
    }).start();

    // 9. Execute steps
    const executionResults = await executeSteps(selected, projectDir, {
      signal: abortController.signal,
      ...buildStepCallbacks(spinner, selected),
    });

    spinner.stop();

    // Handle interrupted run
    if (abortController.signal.aborted) {
      await handleAbortedRun(executionResults, { projectDir, runBranch, tagName, originalBranch });
    }

    // 10. Narrated changelog
    info('Generating narrated changelog...');
    spinner = ora({ text: 'Generating changelog...', color: 'cyan' }).start();

    const changelogResult = await runPrompt(CHANGELOG_PROMPT, projectDir, {
      label: 'Narrated changelog',
    });
    const narration = changelogResult.success ? changelogResult.output : null;
    if (!narration) warn('Narrated changelog generation failed — using fallback text');

    spinner.stop();

    // 11. Generate report
    const startTime = Date.now() - executionResults.totalDuration;
    await generateReport(executionResults, narration, {
      projectDir,
      branchName: runBranch,
      tagName,
      originalBranch,
      startTime,
      endTime: Date.now(),
    });

    // 12. Commit report on run branch
    const gitInstance = getGitInstance();
    try {
      await gitInstance.add(['NIGHTYTIDY-REPORT.md', 'CLAUDE.md']);
      await gitInstance.commit('NightyTidy: Add run report and update CLAUDE.md');
    } catch (err) {
      warn(`Failed to commit report: ${err.message}`);
    }

    // 13. Merge run branch
    const mergeResult = await mergeRunBranch(originalBranch, runBranch);

    // 14. Completion notification + terminal summary
    printCompletionSummary(executionResults, mergeResult, { runBranch, tagName });

  } catch (err) {
    spinner?.stop();
    console.error(chalk.red(`\n\u274c ${err.message}`));

    try {
      logError(`Fatal: ${err.message}`);
      debug(`Stack: ${err.stack}`);
    } catch { /* logger may not be initialized */ }

    if (runStarted) {
      notify('NightyTidy Error', `Run stopped: ${err.message}. Check nightytidy-run.log.`);
      console.error(chalk.yellow(`\n\ud83d\udca1 Your code is safe. Reset to tag ${tagName} to undo any changes.`));
    }

    process.exit(1);
  }
}
