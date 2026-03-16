import path from 'path';
import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';

import { initLogger, info, error as logError, debug, warn } from './logger.js';
import { runPreChecks } from './checks.js';
import { initGit, excludeEphemeralFiles, getCurrentBranch, createPreRunTag, createRunBranch, mergeRunBranch, getGitInstance, ensureOnBranch } from './git.js';
import { existsSync, readFileSync } from 'fs';
import { runPrompt } from './claude.js';
import { STEPS, reloadSteps } from './prompts/loader.js';
import { executeSteps, SAFETY_PREAMBLE, copyPromptsToProject } from './executor.js';
import { notify } from './notifications.js';
import { generateReport, formatDuration, getVersion, buildReportNames, buildReportPrompt, verifyReportContent, updateClaudeMd } from './report.js';
import { setupProject } from './setup.js';
import { startDashboard, updateDashboard, stopDashboard, scheduleShutdown, broadcastOutput, clearOutputBuffer } from './dashboard.js';
import { acquireLock } from './lock.js';
import { initRun, runStep, finishRun, readState, writeState, deleteState, STATE_VERSION } from './orchestrator.js';

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

function buildStepCallbacks(spinner, selected, dashState, { ctx, projectDir } = {}) {
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
    onRateLimitPause: (retryAfterMs, snapshot) => {
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
      // Save state for --resume (lets user close terminal safely)
      if (snapshot && ctx?.runStarted && projectDir) {
        try {
          saveRunState(projectDir, ctx, snapshot);
          console.log(chalk.dim(
            `   State saved \u2014 you can safely close this terminal.\n` +
            `   To resume later: npx nightytidy --resume\n`
          ));
        } catch (err) {
          debug(`Failed to save run state: ${err.message}`);
        }
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

/**
 * Save run state to disk for later resumption via --resume.
 * Uses the same state format as orchestrator mode.
 */
function saveRunState(projectDir, ctx, snapshot) {
  const completed = snapshot.results
    .filter(r => r.status === 'completed')
    .map(r => ({
      number: r.step.number,
      name: r.step.name,
      status: 'completed',
      duration: r.duration,
      attempts: r.attempts,
      output: (r.output || '').slice(0, 6000),
      error: null,
      cost: r.cost || null,
      suspiciousFast: r.suspiciousFast || false,
      errorType: null,
      retryAfterMs: null,
    }));

  const failed = snapshot.results
    .filter(r => r.status === 'failed')
    .map(r => ({
      number: r.step.number,
      name: r.step.name,
      status: 'failed',
      duration: r.duration,
      attempts: r.attempts,
      output: (r.output || '').slice(0, 6000),
      error: r.error || 'Step failed',
      cost: r.cost || null,
      suspiciousFast: false,
      errorType: r.errorType || null,
      retryAfterMs: r.retryAfterMs || null,
    }));

  writeState(projectDir, {
    version: STATE_VERSION,
    originalBranch: ctx.originalBranch,
    runBranch: ctx.runBranch,
    tagName: ctx.tagName,
    selectedSteps: ctx.selectedStepNumbers,
    completedSteps: completed,
    failedSteps: failed,
    startTime: ctx.runStartTime || Date.now(),
    timeout: ctx.timeoutMs || null,
    dashboardPid: null,
    dashboardUrl: null,
    pausedAt: Date.now(),
    pauseReason: 'usage_limit',
  });
}

async function handleAbortedRun(executionResults, { projectDir, runBranch, tagName, originalBranch }) {
  info('Run interrupted by user');
  const { reportFile } = buildReportNames(projectDir, Date.now() - executionResults.totalDuration);
  const totalInputTokens = executionResults.results.reduce((sum, r) => sum + (r.cost?.inputTokens || 0), 0) || null;
  const totalOutputTokens = executionResults.results.reduce((sum, r) => sum + (r.cost?.outputTokens || 0), 0) || null;
  generateReport(executionResults, null, {
    projectDir,
    branchName: runBranch,
    tagName,
    originalBranch,
    startTime: Date.now() - executionResults.totalDuration,
    endTime: Date.now(),
    totalInputTokens,
    totalOutputTokens,
  }, { reportFile });

  const gitInstance = getGitInstance();
  try {
    await gitInstance.add([reportFile]);
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

/**
 * Validate that a saved run state is safe to resume.
 * Checks git branch existence and step availability.
 */
async function validateResumeState(state) {
  if (!state || state.version !== STATE_VERSION) {
    return { ok: false, error: 'State file is missing or has an incompatible version.' };
  }
  if (!state.runBranch || !state.originalBranch || !state.selectedSteps?.length) {
    return { ok: false, error: 'State file is incomplete (missing branch or step data).' };
  }

  // Check run branch exists
  const git = getGitInstance();
  try {
    const branches = await git.branch();
    if (!branches.all.includes(state.runBranch)) {
      return { ok: false, error: `Run branch "${state.runBranch}" no longer exists. Cannot resume.` };
    }
  } catch (err) {
    return { ok: false, error: `Git check failed: ${err.message}` };
  }

  // Check selected steps are still available
  const loadedNums = new Set(STEPS.map(s => s.number));
  const missing = state.selectedSteps.filter(n => !loadedNums.has(n));
  if (missing.length > 0) {
    return { ok: false, error: `Steps ${missing.join(', ')} from saved state are no longer available.` };
  }

  return { ok: true };
}

/**
 * Resume a previously paused run from saved state.
 * Reads nightytidy-run-state.json, validates, skips completed steps, and resumes.
 */
async function handleResume(projectDir, timeoutMs) {
  initLogger(projectDir);
  info('NightyTidy --resume: checking for saved state');

  const state = readState(projectDir);
  if (!state) {
    console.error(chalk.red('No saved run state found. Nothing to resume.'));
    console.log(chalk.dim('Start a new run with: npx nightytidy'));
    process.exit(1);
  }

  await acquireLock(projectDir);
  initGit(projectDir);
  excludeEphemeralFiles();

  const validation = await validateResumeState(state);
  if (!validation.ok) {
    console.error(chalk.red(`Cannot resume: ${validation.error}`));
    process.exit(1);
  }

  // Calculate remaining steps
  const doneNums = new Set([
    ...state.completedSteps.map(s => s.number),
    ...state.failedSteps.map(s => s.number),
  ]);
  const remainingNums = state.selectedSteps.filter(n => !doneNums.has(n));
  const remainingSteps = STEPS.filter(s => remainingNums.includes(s.number));

  if (remainingSteps.length === 0) {
    console.log(chalk.yellow('All selected steps already completed or failed.'));
    console.log(chalk.dim('Running finish phase (report + merge)...'));
    const result = await finishRun(projectDir);
    if (!result.success) {
      console.error(chalk.red(`Finish failed: ${result.error}`));
    }
    deleteState(projectDir);
    process.exit(result.success ? 0 : 1);
  }

  // Ensure we're on the run branch
  await ensureOnBranch(state.runBranch);

  // Show resume info
  const pausedStr = state.pausedAt
    ? new Date(state.pausedAt).toLocaleString()
    : 'unknown';
  console.log(chalk.cyan(
    `\nResuming NightyTidy run (paused ${pausedStr})\n` +
    `  Branch: ${state.runBranch}\n` +
    `  Completed: ${state.completedSteps.length}/${state.selectedSteps.length}\n` +
    `  Failed: ${state.failedSteps.length}\n` +
    `  Remaining: ${remainingSteps.length} step(s)\n`
  ));

  // Build context for the resumed run
  const ctx = {
    spinner: null,
    runStarted: true,
    tagName: state.tagName,
    runBranch: state.runBranch,
    originalBranch: state.originalBranch,
    dashState: null,
    abortController: new AbortController(),
    timeoutMs: timeoutMs || state.timeout,
    runStartTime: state.startTime,
    selectedStepNumbers: state.selectedSteps,
  };

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

  ctx.spinner = ora({
    text: `\u23f3 Resuming: Step ${remainingSteps[0].number} \u2014 ${remainingSteps[0].name}...`,
    color: 'cyan',
  }).start();

  const executionResults = await executeSteps(remainingSteps, projectDir, {
    signal: ctx.abortController.signal,
    timeout: ctx.timeoutMs,
    ...buildStepCallbacks(ctx.spinner, remainingSteps, ctx.dashState, { ctx, projectDir }),
  });

  ctx.spinner.stop();

  // Merge prior results with new results
  const priorResults = [
    ...state.completedSteps.map(s => ({
      step: { number: s.number, name: s.name },
      status: s.status,
      output: s.output || '',
      duration: s.duration,
      attempts: s.attempts,
      error: s.error,
      cost: s.cost || null,
    })),
    ...state.failedSteps.map(s => ({
      step: { number: s.number, name: s.name },
      status: s.status,
      output: s.output || '',
      duration: s.duration,
      attempts: s.attempts,
      error: s.error,
      cost: s.cost || null,
    })),
  ];

  const mergedResults = {
    results: [...priorResults, ...executionResults.results],
    totalDuration: Date.now() - state.startTime,
    completedCount: priorResults.filter(r => r.status === 'completed').length + executionResults.completedCount,
    failedCount: priorResults.filter(r => r.status === 'failed').length + executionResults.failedCount,
  };

  // Clean up state file
  deleteState(projectDir);

  // Handle interrupted resumed run
  if (ctx.abortController.signal.aborted) {
    await handleAbortedRun(mergedResults, {
      projectDir,
      runBranch: ctx.runBranch,
      tagName: ctx.tagName,
      originalBranch: ctx.originalBranch,
    });
  }

  // Finalize (report + merge)
  await finalizeRun(mergedResults, projectDir, ctx);
}

function printCompletionSummary(executionResults, mergeResult, { runBranch, tagName, reportFile }) {
  const totalSteps = executionResults.completedCount + executionResults.failedCount;
  const durationStr = formatDuration(executionResults.totalDuration);
  const rpt = reportFile || 'NIGHTYTIDY-REPORT.md';

  if (mergeResult.success) {
    if (executionResults.failedCount === 0) {
      notify('NightyTidy Complete \u2713', `All ${executionResults.completedCount} steps succeeded. See ${rpt}`);
    } else {
      notify('NightyTidy Complete', `${executionResults.completedCount}/${totalSteps} succeeded, ${executionResults.failedCount} failed. See ${rpt}`);
    }
  } else {
    notify('NightyTidy Complete', `${executionResults.completedCount}/${totalSteps} steps done. Merge needs attention \u2014 see terminal.`);
    notify('NightyTidy: Merge Conflict', `Changes are on branch ${runBranch}. See ${rpt} for resolution steps.`);
  }

  if (mergeResult.success) {
    if (executionResults.failedCount === 0) {
      console.log(chalk.green(`\n\u2705 NightyTidy complete \u2014 ${executionResults.completedCount}/${totalSteps} steps succeeded (${durationStr})`));
    } else {
      console.log(chalk.yellow(`\n\u26a0\ufe0f  NightyTidy complete \u2014 ${executionResults.completedCount}/${totalSteps} steps succeeded, ${executionResults.failedCount} failed (${durationStr})`));
    }
    console.log(chalk.dim(`\ud83d\udcc4 Report: ${rpt}`));
    console.log(chalk.dim(`\ud83c\udff7\ufe0f  Safety tag: ${tagName}`));

    if (executionResults.failedCount > 0) {
      const failedNames = executionResults.results
        .filter(r => r.status === 'failed')
        .map(r => r.step.name);
      console.log(chalk.yellow(`\n   Failed steps: ${failedNames.join(', ')}`));
      console.log(chalk.dim(`   See ${rpt} for details and retry suggestions.`));
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
  ctx.runStartTime = Date.now();
  ctx.selectedStepNumbers = selected.map(s => s.number);

  // Sync all prompts into the target project for audit trail
  copyPromptsToProject(projectDir);
  try {
    const gitInstance = getGitInstance();
    await gitInstance.add([path.join('audit-reports', 'refactor-prompts')]);
    await gitInstance.commit('NightyTidy: Sync refactor prompts');
  } catch (err) {
    warn(`Failed to commit refactor prompts: ${err.message}`);
  }

  notify('NightyTidy Started', `Running ${selected.length} steps. Check nightytidy-run.log for progress.`);

  ctx.spinner = ora({
    text: `\u23f3 Step 1/${selected.length}: ${selected[0].name}...`,
    color: 'cyan',
  }).start();

  const executionResults = await executeSteps(selected, projectDir, {
    signal: ctx.abortController.signal,
    timeout: ctx.timeoutMs,
    ...buildStepCallbacks(ctx.spinner, selected, ctx.dashState, { ctx, projectDir }),
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
  // Clean up any pause state file (run completed, no longer resumable)
  deleteState(projectDir);

  // Update dashboard to finishing state
  if (ctx.dashState) {
    ctx.dashState.status = 'finishing';
    ctx.dashState.currentStepIndex = -1;
    ctx.dashState.currentStepName = '';
    updateDashboard(ctx.dashState);
  }

  // Build unique report filename (numbered + timestamped)
  const startTime = Date.now() - executionResults.totalDuration;
  const { reportFile } = buildReportNames(projectDir, startTime);

  const totalInputTokens = executionResults.results.reduce((sum, r) => sum + (r.cost?.inputTokens || 0), 0) || null;
  const totalOutputTokens = executionResults.results.reduce((sum, r) => sum + (r.cost?.outputTokens || 0), 0) || null;

  const metadata = {
    projectDir,
    branchName: ctx.runBranch,
    tagName: ctx.tagName,
    originalBranch: ctx.originalBranch,
    startTime,
    endTime: Date.now(),
    totalInputTokens,
    totalOutputTokens,
  };

  // Single AI call for report generation (narration + action plan)
  info('Generating report...');
  ctx.spinner = ora({ text: 'Generating report...', color: 'cyan' }).start();

  const reportPrompt = buildReportPrompt(executionResults, metadata, { reportFile });
  const reportResult = await runPrompt(SAFETY_PREAMBLE + reportPrompt, projectDir, {
    label: 'Report generation',
    timeout: ctx.timeoutMs,
  });

  ctx.spinner.stop();

  // Verify the report file was created correctly
  const reportPath = path.join(projectDir, reportFile);
  let reportOk = false;
  try {
    if (existsSync(reportPath)) {
      const content = readFileSync(reportPath, 'utf8');
      reportOk = verifyReportContent(content, metadata);
    }
  } catch { /* verification failed */ }

  if (!reportOk) {
    warn('AI report generation failed — using template fallback');
    generateReport(executionResults, null, metadata, { reportFile, skipClaudeMdUpdate: true });
    console.log(chalk.dim('Report generated with fallback template.'));
  } else {
    console.log(chalk.green('Report generated successfully.'));
  }

  // Always update CLAUDE.md via JS (not AI)
  updateClaudeMd(metadata);

  // Commit report + CLAUDE.md (if not already committed by Claude)
  const gitInstance = getGitInstance();
  try {
    const filesToCommit = [reportFile, 'CLAUDE.md'];
    await gitInstance.add(filesToCommit);
    await gitInstance.commit('NightyTidy: Add run report and update CLAUDE.md');
  } catch (err) {
    warn(`Failed to commit report: ${err.message}`);
  }

  // Merge run branch
  const mergeResult = await mergeRunBranch(ctx.originalBranch, ctx.runBranch);

  // Completion notification + terminal summary
  printCompletionSummary(executionResults, mergeResult, { runBranch: ctx.runBranch, tagName: ctx.tagName, reportFile });

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
    .option('--skip-sync', 'Skip automatic prompt sync from Google Doc before running')
    .option('--skip-dashboard', 'Skip launching the standalone dashboard server (used by GUI)')
    .option('--resume', 'Resume a previously paused run (usage limit / manual restart)');

  // Handle 'agent' subcommand before Commander parses — avoids breaking
  // Commander's option-only routing when a .command() subcommand is registered.
  if (process.argv.includes('agent')) {
    const { initLogger } = await import('./logger.js');
    initLogger(process.cwd());
    const { startAgent } = await import('./agent/index.js');
    await startAgent();
    return;
  }

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
    const result = await initRun(projectDir, { steps: opts.steps, timeout: timeoutMs, skipDashboard: opts.skipDashboard });
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

  // Resume a previously paused run
  if (opts.resume) {
    return await handleResume(projectDir, timeoutMs);
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
