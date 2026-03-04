import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import path from 'path';

import { Command } from 'commander';
import checkbox from '@inquirer/checkbox';
import ora from 'ora';
import chalk from 'chalk';

import { initLogger, info, error as logError, debug, warn } from './logger.js';
import { runPreChecks } from './checks.js';
import { initGit, excludeEphemeralFiles, getCurrentBranch, createPreRunTag, createRunBranch, mergeRunBranch, getGitInstance } from './git.js';
import { runPrompt } from './claude.js';
import { STEPS, CHANGELOG_PROMPT } from './prompts/steps.js';
import { executeSteps, SAFETY_PREAMBLE } from './executor.js';
import { notify } from './notifications.js';
import { generateReport, formatDuration, getVersion } from './report.js';
import { setupProject } from './setup.js';
import { startDashboard, updateDashboard, stopDashboard, scheduleShutdown } from './dashboard.js';

const LOCK_FILENAME = 'nightytidy.lock';

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireLock(projectDir) {
  const lockPath = path.join(projectDir, LOCK_FILENAME);

  if (existsSync(lockPath)) {
    try {
      const lockData = JSON.parse(readFileSync(lockPath, 'utf8'));
      if (lockData.pid && isProcessAlive(lockData.pid)) {
        throw new Error(
          `Another NightyTidy run is already in progress (PID ${lockData.pid}, started ${lockData.started}).\n` +
          `If this is wrong, delete ${LOCK_FILENAME} and try again.`
        );
      }
    } catch (err) {
      if (err.message.includes('already in progress')) throw err;
      // Corrupt lock file — treat as stale
    }
    unlinkSync(lockPath);
    warn('Removed stale lock file from a previous run');
  }

  writeFileSync(lockPath, JSON.stringify({ pid: process.pid, started: new Date().toISOString() }));

  // Auto-remove on any exit
  process.on('exit', () => {
    try { unlinkSync(lockPath); } catch { /* already gone */ }
  });
}

function buildStepCallbacks(spinner, selected, dashState) {
  const stepStartTimes = new Map();

  return {
    onStepStart: (step, idx, total) => {
      spinner.text = `\u23f3 Step ${idx + 1}/${total}: ${step.name}...`;
      stepStartTimes.set(idx, Date.now());
      if (dashState) {
        dashState.status = 'running';
        dashState.currentStepIndex = idx;
        dashState.currentStepName = step.name;
        dashState.steps[idx].status = 'running';
        if (!dashState.startTime) dashState.startTime = Date.now();
        updateDashboard(dashState);
      }
    },
    onStepComplete: (step, idx, total) => {
      spinner.stop();
      console.log(chalk.green(`\u2713 Step ${idx + 1}/${total}: ${step.name} \u2014 done`));
      if (idx + 1 < total) {
        spinner.start(`\u23f3 Step ${idx + 2}/${total}: ${selected[idx + 1].name}...`);
      }
      if (dashState) {
        dashState.steps[idx].status = 'completed';
        dashState.steps[idx].duration = Date.now() - (stepStartTimes.get(idx) || Date.now());
        dashState.completedCount++;
        updateDashboard(dashState);
      }
    },
    onStepFail: (step, idx, total) => {
      spinner.stop();
      console.log(chalk.red(`\u2717 Step ${idx + 1}/${total}: ${step.name} \u2014 failed`));
      if (idx + 1 < total) {
        spinner.start(`\u23f3 Step ${idx + 2}/${total}: ${selected[idx + 1].name}...`);
      }
      if (dashState) {
        dashState.steps[idx].status = 'failed';
        dashState.steps[idx].duration = Date.now() - (stepStartTimes.get(idx) || Date.now());
        dashState.failedCount++;
        updateDashboard(dashState);
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
}

export async function run() {
  const program = new Command();
  program
    .name('nightytidy')
    .description('Automated overnight codebase improvement through Claude Code')
    .version(getVersion())
    .option('--all', 'Run all steps without interactive selection')
    .option('--steps <numbers>', 'Run specific steps by number (comma-separated, e.g. --steps 1,5,12)')
    .option('--list', 'List all available steps and exit')
    .option('--setup', 'Add NightyTidy integration to this project\u2019s CLAUDE.md so Claude Code knows how to use it')
    .option('--timeout <minutes>', 'Timeout per step in minutes (default: 45)', parseInt);

  program.parse();
  const opts = program.opts();

  const projectDir = process.cwd();
  const timeoutMs = opts.timeout ? opts.timeout * 60 * 1000 : undefined;
  if (opts.timeout !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
    console.error(chalk.red('--timeout must be a positive number of minutes'));
    process.exit(1);
  }
  let spinner;
  let runStarted = false;
  let tagName = '';
  let runBranch = '';
  let originalBranch = '';
  let dashState = null;

  // Unhandled rejection safety net
  process.on('unhandledRejection', (reason) => {
    try { logError(`Unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`); } catch { /* logger may not be init */ }
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

    // 2. Prevent concurrent runs
    acquireLock(projectDir);

    // 3. List steps and exit (no git or pre-checks needed)
    if (opts.list) {
      STEPS.forEach(step => console.log(`${step.number}. ${step.name}`));
      process.exit(0);
    }

    // 3. Setup mode — add CLAUDE.md integration and exit
    if (opts.setup) {
      const result = setupProject(projectDir);
      const action = result === 'created' ? 'Created CLAUDE.md with' : 'Added';
      console.log(chalk.green(`\u2713 ${action} NightyTidy integration to this project.`));
      console.log(chalk.dim('  Claude Code now knows how to run NightyTidy in this project.'));
      process.exit(0);
    }

    // 4. Show first-run welcome
    showWelcome();

    // 4. Initialize git and run pre-checks
    const git = initGit(projectDir);
    excludeEphemeralFiles();
    await runPreChecks(projectDir, git);

    // 4. Step selector
    let selected;
    if (opts.all) {
      selected = STEPS;
      info(`Running all ${STEPS.length} steps (--all)`);
    } else if (opts.steps) {
      const requestedNums = opts.steps.split(',').map(s => parseInt(s.trim(), 10));
      const invalid = requestedNums.filter(n => isNaN(n) || n < 1 || n > STEPS.length);
      if (invalid.length > 0) {
        console.log(chalk.red(`Invalid step number(s): ${invalid.join(', ')}. Valid range: 1-${STEPS.length}.`));
        process.exit(1);
      }
      selected = STEPS.filter(step => requestedNums.includes(step.number));
      info(`Running ${selected.length} selected step(s) (--steps ${opts.steps})`);
    } else if (!process.stdin.isTTY) {
      console.log(chalk.red('Non-interactive mode requires --all or --steps <numbers>.'));
      console.log(chalk.dim('  Example: npx nightytidy --all'));
      console.log(chalk.dim('  Example: npx nightytidy --steps 1,5,12'));
      console.log(chalk.dim('  Run npx nightytidy --list to see available steps.'));
      process.exit(1);
    } else {
      selected = await checkbox({
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
    }

    // 5. Start live dashboard
    dashState = {
      status: 'starting',
      totalSteps: selected.length,
      currentStepIndex: -1,
      currentStepName: '',
      steps: selected.map(s => ({ number: s.number, name: s.name, status: 'pending', duration: null })),
      completedCount: 0,
      failedCount: 0,
      startTime: null,
      error: null,
    };
    const dashboard = await startDashboard(dashState, {
      onStop: () => abortController.abort(),
      projectDir,
    });
    if (dashboard) {
      console.log(chalk.cyan('\n\ud83d\udcca Progress window opened.'));
      if (dashboard.url) {
        console.log(chalk.cyan(`\n\ud83c\udf10 Live dashboard: ${dashboard.url}`));
        console.log(chalk.dim('   Open this link in your browser to monitor progress in real time.'));
      }
    }

    // 6. Sleep tip
    console.log(chalk.dim(
      '\n\ud83d\udca1 Tip: Make sure your computer won\'t go to sleep during the run.\n' +
      '   This typically takes 4-8 hours. Disable sleep in your power settings.\n'
    ));

    // 7. Git setup
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
      timeout: timeoutMs,
      ...buildStepCallbacks(spinner, selected, dashState),
    });

    spinner.stop();

    // Handle interrupted run
    if (abortController.signal.aborted) {
      if (dashState) {
        dashState.status = 'stopped';
        updateDashboard(dashState);
      }
      stopDashboard();
      await handleAbortedRun(executionResults, { projectDir, runBranch, tagName, originalBranch });
    }

    // Update dashboard to finishing state
    if (dashState) {
      dashState.status = 'finishing';
      dashState.currentStepIndex = -1;
      dashState.currentStepName = '';
      updateDashboard(dashState);
    }

    // 10. Narrated changelog
    info('Generating narrated changelog...');
    spinner = ora({ text: 'Generating changelog...', color: 'cyan' }).start();

    const changelogResult = await runPrompt(SAFETY_PREAMBLE + CHANGELOG_PROMPT, projectDir, {
      label: 'Narrated changelog',
      timeout: timeoutMs,
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

    // Update dashboard to completed and schedule shutdown
    if (dashState) {
      dashState.status = 'completed';
      updateDashboard(dashState);
    }
    scheduleShutdown();

  } catch (err) {
    spinner?.stop();
    console.error(chalk.red(`\n\u274c ${err.message}`));

    try {
      logError(`Fatal: ${err.message}`);
      debug(`Stack: ${err.stack}`);
    } catch { /* logger may not be initialized */ }

    if (dashState) {
      dashState.status = 'error';
      dashState.error = err.message;
      updateDashboard(dashState);
    }
    scheduleShutdown();

    if (runStarted) {
      notify('NightyTidy Error', `Run stopped: ${err.message}. Check nightytidy-run.log.`);
      console.error(chalk.yellow(`\n\ud83d\udca1 Your code is safe. Reset to tag ${tagName} to undo any changes.`));
    }

    process.exit(1);
  }
}
