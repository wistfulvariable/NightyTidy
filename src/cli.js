import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';

import { initLogger, info, error as logError, debug, warn } from './logger.js';
import { runPreChecks } from './checks.js';
import { initGit, excludeEphemeralFiles, getCurrentBranch, createPreRunTag, createRunBranch, mergeRunBranch, getGitInstance } from './git.js';
import { runPrompt } from './claude.js';
import { STEPS, CHANGELOG_PROMPT, reloadSteps } from './prompts/loader.js';
import { executeSteps, SAFETY_PREAMBLE } from './executor.js';
import { generateActionPlan } from './consolidation.js';
import { notify } from './notifications.js';
import { generateReport, formatDuration, getVersion } from './report.js';
import { setupProject } from './setup.js';
import { startDashboard, updateDashboard, stopDashboard, scheduleShutdown, broadcastOutput, clearOutputBuffer } from './dashboard.js';
import { acquireLock } from './lock.js';
import { initRun, runStep, finishRun } from './orchestrator.js';

const PROGRESS_SUMMARY_INTERVAL = 5; // Print a summary every N completed steps
const DESC_MAX_LENGTH = 72;

function extractStepDescription(prompt) {
  // Grab the first two sentences from the prompt to use as a brief description.
  // Strip markdown heading prefixes and common prompt preambles.
  const cleaned = prompt.replace(/^#+\s*/m, '').replace(/^You are running an overnight\s+/i, '');
  const sentences = cleaned.match(/[^.!?\n]+[.!?]/g);
  if (!sentences || sentences.length === 0) return '';
  let desc = sentences[0].trim();
  if (desc.length > DESC_MAX_LENGTH) desc = desc.slice(0, DESC_MAX_LENGTH - 1) + '\u2026';
  return desc;
}

function buildStepCallbacks(spinner, selected, dashState) {
  const stepStartTimes = new Map();
  let runStartTime = null;
  let doneCount = 0;
  let passCount = 0;
  let failCountLocal = 0;

  function updateStepDash(idx, status) {
    if (!dashState) return;
    dashState.steps[idx].status = status;
    dashState.steps[idx].duration = Date.now() - (stepStartTimes.get(idx) || Date.now());
    if (status === 'completed') dashState.completedCount++;
    if (status === 'failed') dashState.failedCount++;
    updateDashboard(dashState);
  }

  function startNextSpinner(idx, total) {
    if (idx + 1 < total) {
      spinner.start(`\u23f3 Step ${idx + 2}/${total}: ${selected[idx + 1].name}...`);
    }
  }

  function maybePrintProgressSummary(total) {
    if (total <= PROGRESS_SUMMARY_INTERVAL) return;
    if (doneCount % PROGRESS_SUMMARY_INTERVAL !== 0) return;
    const elapsed = formatDuration(Date.now() - runStartTime);
    const remaining = total - doneCount;
    console.log(chalk.dim(
      `\n   Progress: ${doneCount}/${total} done (${passCount} passed, ${failCountLocal} failed) \u2014 ${elapsed} elapsed, ${remaining} remaining\n`
    ));
  }

  return {
    onOutput: (chunk) => {
      broadcastOutput(chunk);
      // Stream raw Claude output to the main terminal
      if (spinner.isSpinning) spinner.stop();
      process.stdout.write(chunk);
    },
    onStepStart: (step, idx, total) => {
      clearOutputBuffer();
      spinner.text = `\u23f3 Step ${idx + 1}/${total}: ${step.name}...`;
      stepStartTimes.set(idx, Date.now());
      if (!runStartTime) runStartTime = Date.now();
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
      doneCount++;
      passCount++;
      maybePrintProgressSummary(total);
      startNextSpinner(idx, total);
      updateStepDash(idx, 'completed');
    },
    onStepFail: (step, idx, total) => {
      spinner.stop();
      console.log(chalk.red(`\u2717 Step ${idx + 1}/${total}: ${step.name} \u2014 failed`));
      doneCount++;
      failCountLocal++;
      maybePrintProgressSummary(total);
      startNextSpinner(idx, total);
      updateStepDash(idx, 'failed');
    },
    onRateLimitPause: (retryAfterMs) => {
      if (spinner.isSpinning) spinner.stop();
      const waitStr = retryAfterMs
        ? formatDuration(retryAfterMs)
        : 'unknown (using exponential backoff)';
      console.log(chalk.yellow(
        `\n\u26a0  Rate limit reached \u2014 pausing run.\n` +
        `   Estimated wait: ${waitStr}\n` +
        `   Press Ctrl+C to stop and get partial results.\n`
      ));
      if (dashState) {
        dashState.status = 'paused';
        updateDashboard(dashState);
      }
    },
    onRateLimitResume: () => {
      console.log(chalk.green('\n\u2713 Rate limit cleared \u2014 resuming run.\n'));
      if (dashState) {
        dashState.status = 'running';
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
  } catch (err) { debug(`Could not commit partial report: ${err.message}`); }

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

    if (executionResults.failedCount > 0) {
      const failedNames = executionResults.results
        .filter(r => r.status === 'failed')
        .map(r => r.step.name);
      console.log(chalk.yellow(`\n   Failed steps: ${failedNames.join(', ')}`));
      console.log(chalk.dim('   See NIGHTYTIDY-REPORT.md for details and retry suggestions.'));
    }
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

async function selectSteps(opts) {
  if (opts.all) {
    info(`Running all ${STEPS.length} steps (--all)`);
    return STEPS;
  }

  if (opts.steps) {
    const requestedNums = opts.steps.split(',').map(s => parseInt(s.trim(), 10));
    const invalid = requestedNums.filter(n => Number.isNaN(n) || n < 1 || n > STEPS.length);
    if (invalid.length > 0) {
      console.log(chalk.red(`Invalid step number(s): ${invalid.join(', ')}. Valid range: 1-${STEPS.length}.`));
      process.exit(1);
    }
    const selected = STEPS.filter(step => requestedNums.includes(step.number));
    info(`Running ${selected.length} selected step(s) (--steps ${opts.steps})`);
    return selected;
  }

  if (!process.stdin.isTTY) {
    console.log(chalk.red('Non-interactive mode requires --all or --steps <numbers>.'));
    console.log(chalk.dim('  Example: npx nightytidy --all'));
    console.log(chalk.dim('  Example: npx nightytidy --steps 1,5,12'));
    console.log(chalk.dim('  Run npx nightytidy --list to see available steps.'));
    process.exit(1);
  }

  const { default: checkbox } = await import('@inquirer/checkbox');
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
    console.log(chalk.yellow('No steps selected. Select at least one step to continue.'));
    process.exit(0);
  }

  return selected;
}

function showWelcome() {
  console.log(chalk.cyan(
    '\n' +
    '\u256d\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256e\n' +
    '\u2502                                                              \u2502\n' +
    '\u2502  Welcome to NightyTidy!                                      \u2502\n' +
    '\u2502                                                              \u2502\n' +
    '\u2502  NightyTidy will run 33 codebase improvement steps through   \u2502\n' +
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

function printSyncSummary(summary, isDryRun) {
  const prefix = isDryRun ? '[DRY RUN] ' : '';
  console.log(chalk.cyan(`\n${prefix}Prompt Sync Summary\n`));

  if (summary.updated.length > 0) {
    console.log(chalk.yellow(`  Updated (${summary.updated.length}):`));
    for (const p of summary.updated) console.log(`    ${p.id} — ${p.name}`);
  }
  if (summary.added.length > 0) {
    console.log(chalk.green(`  Added (${summary.added.length}):`));
    for (const p of summary.added) console.log(`    ${p.id} — ${p.name}`);
  }
  if (summary.removed.length > 0) {
    console.log(chalk.red(`  Removed (${summary.removed.length}):`));
    for (const p of summary.removed) console.log(`    ${p.id} — ${p.name}`);
  }
  if (summary.unchanged.length > 0) {
    console.log(chalk.dim(`  Unchanged (${summary.unchanged.length}):`));
    for (const p of summary.unchanged) console.log(chalk.dim(`    ${p.id} — ${p.name}`));
  }

  console.log();
  const total = summary.updated.length + summary.added.length + summary.removed.length + summary.unchanged.length;
  console.log(`  Total: ${total} prompts`);
  if (summary.newStepsHash) {
    console.log(chalk.dim(`  New STEPS_HASH: ${summary.newStepsHash.slice(0, 16)}...`));
  }
  if (isDryRun) {
    console.log(chalk.dim(`\n  Run with --sync to apply these changes.`));
  } else {
    console.log(chalk.green(`\n  Sync complete.`));
  }
}

function printStepList() {
  console.log(chalk.cyan(`\nAvailable steps (${STEPS.length} total):\n`));
  const numWidth = String(STEPS.length).length;
  for (const step of STEPS) {
    const num = String(step.number).padStart(numWidth);
    const desc = extractStepDescription(step.prompt);
    if (desc) {
      console.log(`  ${num}. ${step.name}`);
      console.log(chalk.dim(`      ${desc}`));
    } else {
      console.log(`  ${num}. ${step.name}`);
    }
  }
  console.log(chalk.dim(`\nUse --steps 1,5,12 to run specific steps, or --all to run everything.`));
}

async function setupGitAndPreChecks(projectDir) {
  const git = initGit(projectDir);
  excludeEphemeralFiles();
  const checkSpinner = ora({ text: 'Running pre-flight checks...', color: 'cyan' }).start();
  try {
    await runPreChecks(projectDir, git);
    checkSpinner.succeed('Pre-flight checks passed');
  } catch (err) {
    checkSpinner.fail('Pre-flight check failed');
    throw err;
  }
}

/**
 * Auto-sync prompts from Google Doc before a run.
 * Non-blocking: warns on failure and continues with cached prompts.
 */
async function autoSyncPrompts(opts) {
  if (opts.skipSync) {
    debug('Prompt sync skipped (--skip-sync)');
    return;
  }

  const syncSpinner = ora({ text: 'Syncing prompts from Google Doc...', color: 'cyan' }).start();
  try {
    const { syncPrompts } = await import('./sync.js');
    const result = await syncPrompts();

    if (!result.success) {
      syncSpinner.warn(`Could not sync prompts: ${result.error}. Using cached versions.`);
      return;
    }

    const { summary } = result;
    const changeCount = summary.updated.length + summary.added.length + summary.removed.length;

    if (changeCount === 0) {
      syncSpinner.succeed('Prompts up to date');
    } else {
      reloadSteps();
      syncSpinner.succeed(`Prompts synced (${changeCount} change${changeCount === 1 ? '' : 's'})`);
      if (summary.updated.length > 0) {
        console.log(chalk.dim(`  Updated: ${summary.updated.map(p => p.name).join(', ')}`));
      }
      if (summary.added.length > 0) {
        console.log(chalk.green(`  Added: ${summary.added.map(p => p.name).join(', ')}`));
      }
      if (summary.removed.length > 0) {
        console.log(chalk.yellow(`  Removed: ${summary.removed.map(p => p.name).join(', ')}`));
      }
    }
  } catch (err) {
    syncSpinner.warn(`Prompt sync error: ${err.message}. Using cached versions.`);
  }
}

async function executeRunFlow(selected, projectDir, ctx) {
  // Start live dashboard
  ctx.dashState = {
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
  const dashboard = await startDashboard(ctx.dashState, {
    onStop: () => ctx.abortController.abort(),
    projectDir,
  });
  if (dashboard) {
    console.log(chalk.cyan('\n\ud83d\udcca Progress window opened.'));
    if (dashboard.url) {
      console.log(chalk.cyan(`\n\ud83c\udf10 Live dashboard: ${dashboard.url}`));
      console.log(chalk.dim('   Open this link in your browser to monitor progress in real time.'));
    }
  }

  console.log(chalk.dim(
    '\n\ud83d\udca1 Tip: Make sure your computer won\'t go to sleep during the run.\n' +
    '   This typically takes 4-8 hours. Disable sleep in your power settings.\n'
  ));

  // Git setup
  ctx.originalBranch = await getCurrentBranch();
  ctx.tagName = await createPreRunTag();
  ctx.runBranch = await createRunBranch(ctx.originalBranch);
  ctx.runStarted = true;

  notify('NightyTidy Started', `Running ${selected.length} steps. Check nightytidy-run.log for progress.`);

  ctx.spinner = ora({
    text: `\u23f3 Step 1/${selected.length}: ${selected[0].name}...`,
    color: 'cyan',
  }).start();

  const executionResults = await executeSteps(selected, projectDir, {
    signal: ctx.abortController.signal,
    timeout: ctx.timeoutMs,
    ...buildStepCallbacks(ctx.spinner, selected, ctx.dashState),
  });

  ctx.spinner.stop();

  // Handle interrupted run
  if (ctx.abortController.signal.aborted) {
    if (ctx.dashState) {
      ctx.dashState.status = 'stopped';
      updateDashboard(ctx.dashState);
    }
    stopDashboard();
    await handleAbortedRun(executionResults, {
      projectDir,
      runBranch: ctx.runBranch,
      tagName: ctx.tagName,
      originalBranch: ctx.originalBranch,
    });
  }

  return executionResults;
}

async function finalizeRun(executionResults, projectDir, ctx) {
  // Update dashboard to finishing state
  if (ctx.dashState) {
    ctx.dashState.status = 'finishing';
    ctx.dashState.currentStepIndex = -1;
    ctx.dashState.currentStepName = '';
    updateDashboard(ctx.dashState);
  }

  // Narrated changelog
  info('Generating narrated changelog...');
  ctx.spinner = ora({ text: 'Generating changelog...', color: 'cyan' }).start();

  const changelogResult = await runPrompt(SAFETY_PREAMBLE + CHANGELOG_PROMPT, projectDir, {
    label: 'Narrated changelog',
    timeout: ctx.timeoutMs,
  });
  const narration = changelogResult.success ? changelogResult.output : null;
  if (!narration) warn('Narrated changelog generation failed \u2014 using fallback text');

  ctx.spinner.stop();

  // Consolidated action plan
  ctx.spinner = ora({ text: 'Generating action plan...', color: 'cyan' }).start();
  const actionPlan = await generateActionPlan(executionResults, projectDir, {
    timeout: ctx.timeoutMs,
  });
  ctx.spinner.stop();
  if (actionPlan) {
    console.log(chalk.green('Action plan generated: NIGHTYTIDY-ACTIONS.md'));
  } else {
    console.log(chalk.dim('Action plan skipped (no data or generation failed).'));
  }

  // Generate report
  const startTime = Date.now() - executionResults.totalDuration;
  await generateReport(executionResults, narration, {
    projectDir,
    branchName: ctx.runBranch,
    tagName: ctx.tagName,
    originalBranch: ctx.originalBranch,
    startTime,
    endTime: Date.now(),
  }, { actionPlan: !!actionPlan });

  // Commit report on run branch
  const gitInstance = getGitInstance();
  try {
    const filesToCommit = ['NIGHTYTIDY-REPORT.md', 'CLAUDE.md'];
    if (actionPlan) filesToCommit.push('NIGHTYTIDY-ACTIONS.md');
    await gitInstance.add(filesToCommit);
    await gitInstance.commit('NightyTidy: Add run report and update CLAUDE.md');
  } catch (err) {
    warn(`Failed to commit report: ${err.message}`);
  }

  // Merge run branch
  const mergeResult = await mergeRunBranch(ctx.originalBranch, ctx.runBranch);

  // Completion notification + terminal summary
  printCompletionSummary(executionResults, mergeResult, { runBranch: ctx.runBranch, tagName: ctx.tagName });

  // Update dashboard to completed and schedule shutdown
  if (ctx.dashState) {
    ctx.dashState.status = 'completed';
    updateDashboard(ctx.dashState);
  }
  scheduleShutdown();
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
    .option('--timeout <minutes>', 'Timeout per step in minutes (default: 45)', parseInt)
    .option('--dry-run', 'Run pre-checks and show selected steps without executing')
    .option('--json', 'Output as JSON (use with --list)')
    .option('--init-run', 'Initialize an orchestrated run (pre-checks, git setup, state file)')
    .option('--run-step <N>', 'Run a single step in an orchestrated run', parseInt)
    .option('--finish-run', 'Finish an orchestrated run (report, merge, cleanup)')
    .option('--sync', 'Sync prompts from the published Google Doc')
    .option('--sync-dry-run', 'Preview what --sync would change without writing files')
    .option('--sync-url <url>', 'Override the Google Doc URL for sync')
    .option('--skip-sync', 'Skip automatic prompt sync from Google Doc before running');

  program.parse();
  const opts = program.opts();

  const projectDir = process.cwd();
  const timeoutMs = opts.timeout ? opts.timeout * 60 * 1000 : undefined;
  if (opts.timeout !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
    console.error(chalk.red(`--timeout expects a positive number of minutes (got "${opts.timeout}"). Example: --timeout 60`));
    process.exit(1);
  }

  // Orchestrator commands — output JSON and exit
  if (opts.list && opts.json) {
    const steps = STEPS.map(s => ({
      number: s.number,
      name: s.name,
      description: extractStepDescription(s.prompt),
    }));
    console.log(JSON.stringify({ steps }));
    process.exit(0);
  }

  if (opts.initRun) {
    const result = await initRun(projectDir, { steps: opts.steps, timeout: timeoutMs });
    console.log(JSON.stringify(result));
    process.exit(result.success ? 0 : 1);
  }

  if (opts.runStep !== undefined) {
    if (!Number.isFinite(opts.runStep) || opts.runStep < 1) {
      console.log(JSON.stringify({ success: false, error: `--run-step expects a positive step number (got "${process.argv.find(a => a === String(opts.runStep)) ?? opts.runStep}"). Use --list to see available steps.` }));
      process.exit(1);
    }
    const result = await runStep(projectDir, opts.runStep, { timeout: timeoutMs });
    console.log(JSON.stringify(result));
    process.exit(result.success ? 0 : 1);
  }

  if (opts.finishRun) {
    const result = await finishRun(projectDir);
    console.log(JSON.stringify(result));
    process.exit(result.success ? 0 : 1);
  }

  // Sync commands — update local prompt files from Google Doc
  if (opts.sync || opts.syncDryRun) {
    initLogger(projectDir);
    const { syncPrompts } = await import('./sync.js');
    const result = await syncPrompts({
      dryRun: !!opts.syncDryRun,
      url: opts.syncUrl,
    });
    if (result.success) {
      printSyncSummary(result.summary, !!opts.syncDryRun);
    } else {
      console.error(chalk.red(`\nSync failed: ${result.error}`));
    }
    process.exit(result.success ? 0 : 1);
  }

  const ctx = {
    spinner: null,
    runStarted: false,
    tagName: '',
    runBranch: '',
    originalBranch: '',
    dashState: null,
    abortController: new AbortController(),
    timeoutMs,
  };

  // Unhandled rejection safety net
  process.on('unhandledRejection', (reason) => {
    try { logError(`Unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`); } catch { /* logger may not be init */ }
    console.error(chalk.red('\n\u274c An unexpected error occurred. Check nightytidy-run.log for details.'));
    process.exit(1);
  });

  // Ctrl+C handling
  let interrupted = false;
  process.on('SIGINT', () => {
    if (interrupted) {
      console.log('\nForce stopping.');
      process.exit(1);
    }
    interrupted = true;
    console.log(chalk.yellow('\n\u26a0\ufe0f  Stopping NightyTidy... finishing current step.'));
    ctx.abortController.abort();
  });

  try {
    initLogger(projectDir);
    info(`NightyTidy v${getVersion()} starting (Node ${process.version}, ${process.platform} ${process.arch})`);

    await acquireLock(projectDir);

    if (opts.list) {
      printStepList();
      process.exit(0);
    }

    if (opts.setup) {
      const result = setupProject(projectDir);
      const action = result === 'created' ? 'Created CLAUDE.md with' : 'Added';
      console.log(chalk.green(`\u2713 ${action} NightyTidy integration to this project.`));
      console.log(chalk.dim('  Claude Code now knows how to run NightyTidy in this project.'));
      process.exit(0);
    }

    showWelcome();
    await setupGitAndPreChecks(projectDir);
    await autoSyncPrompts(opts);

    const selected = await selectSteps(opts);

    if (opts.dryRun) {
      console.log(chalk.cyan(`\n--- Dry Run ---\n`));
      console.log(`Pre-checks: ${chalk.green('passed')}`);
      console.log(`Steps selected: ${selected.length}`);
      console.log(`Estimated time: ${Math.ceil(selected.length * 15)}\u2013${selected.length * 30} minutes`);
      console.log(`Timeout per step: ${opts.timeout ? `${opts.timeout} min` : '45 min (default)'}\n`);
      for (const step of selected) {
        console.log(`  ${step.number}. ${step.name}`);
      }
      console.log(chalk.dim(`\nRemove --dry-run to start the actual run.`));
      process.exit(0);
    }

    const executionResults = await executeRunFlow(selected, projectDir, ctx);
    await finalizeRun(executionResults, projectDir, ctx);

  } catch (err) {
    ctx.spinner?.stop();
    console.error(chalk.red(`\n\u274c ${err.message}`));

    try {
      logError(`Fatal: ${err.message}`);
      debug(`Stack: ${err.stack}`);
    } catch { /* logger may not be initialized */ }

    if (ctx.dashState) {
      ctx.dashState.status = 'error';
      ctx.dashState.error = err.message;
      updateDashboard(ctx.dashState);
    }
    stopDashboard();

    if (ctx.runStarted) {
      notify('NightyTidy Error', `Run stopped: ${err.message}. Check nightytidy-run.log.`);
      console.error(chalk.yellow(`\n\ud83d\udca1 Your code is safe. Reset to tag ${ctx.tagName} to undo any changes.`));
    }

    process.exit(1);
  }
}
