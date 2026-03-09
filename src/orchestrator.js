import { readFileSync, writeFileSync, renameSync, unlinkSync, existsSync } from 'fs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

import { initLogger, info, warn, error as logError } from './logger.js';
import { runPreChecks } from './checks.js';
import { initGit, excludeEphemeralFiles, getCurrentBranch, createPreRunTag, createRunBranch, mergeRunBranch, getGitInstance } from './git.js';
import { runPrompt } from './claude.js';
import { STEPS, CHANGELOG_PROMPT } from './prompts/loader.js';
import { executeSingleStep, SAFETY_PREAMBLE } from './executor.js';
import { notify } from './notifications.js';
import { generateReport, formatDuration, getVersion } from './report.js';
import { generateActionPlan } from './consolidation.js';
import { acquireLock, releaseLock } from './lock.js';

const PROGRESS_FILENAME = 'nightytidy-progress.json';
const URL_FILENAME = 'nightytidy-dashboard.url';

const STATE_FILENAME = 'nightytidy-run-state.json';
const STATE_VERSION = 1;
const DASHBOARD_STARTUP_TIMEOUT = 5000; // ms — max wait for dashboard server to respond
const SSE_FLUSH_DELAY = 500; // ms — brief delay to let last SSE event reach clients

function statePath(projectDir) {
  return path.join(projectDir, STATE_FILENAME);
}

function readState(projectDir) {
  const fp = statePath(projectDir);
  if (!existsSync(fp)) return null;
  try {
    const data = JSON.parse(readFileSync(fp, 'utf8'));
    if (data.version !== STATE_VERSION) return null;
    return data;
  } catch {
    return null;
  }
}

function writeState(projectDir, state) {
  // Write to temp file then rename for atomic replacement.
  // Prevents truncated JSON on crash (FINDING-06, audit #21).
  const target = statePath(projectDir);
  const tmp = target + '.tmp';
  writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  renameSync(tmp, target);
}

function deleteState(projectDir) {
  try { unlinkSync(statePath(projectDir)); } catch { /* already gone */ }
}

function ok(data) {
  return { success: true, ...data };
}

function fail(error) {
  return { success: false, error };
}

function validateStepNumbers(numbers) {
  const valid = STEPS.map(s => s.number);
  const invalid = numbers.filter(n => !valid.includes(n));
  if (invalid.length > 0) {
    return fail(`Invalid step number(s): ${invalid.join(', ')}. Valid range: 1-${STEPS.length}.`);
  }
  return null;
}

function buildExecutionResults(state) {
  const allStepResults = [...state.completedSteps, ...state.failedSteps]
    .sort((a, b) => state.selectedSteps.indexOf(a.number) - state.selectedSteps.indexOf(b.number));

  return {
    results: allStepResults.map(s => ({
      step: { number: s.number, name: s.name },
      status: s.status,
      output: s.output || '',
      duration: s.duration,
      attempts: s.attempts,
      error: s.status === 'failed' ? 'Step failed during orchestrated run' : null,
      cost: s.cost || null,
    })),
    completedCount: state.completedSteps.length,
    failedCount: state.failedSteps.length,
  };
}

function buildProgressState(state) {
  const doneNums = new Set([
    ...state.completedSteps.map(s => s.number),
    ...state.failedSteps.map(s => s.number),
  ]);
  return {
    status: 'running',
    totalSteps: state.selectedSteps.length,
    currentStepIndex: -1,
    currentStepName: '',
    steps: state.selectedSteps.map(num => {
      const step = STEPS.find(s => s.number === num);
      const completed = state.completedSteps.find(s => s.number === num);
      const failed = state.failedSteps.find(s => s.number === num);
      return {
        number: num,
        name: step?.name || `Step ${num}`,
        status: completed ? 'completed' : failed ? 'failed' : 'pending',
        duration: completed?.duration || failed?.duration || null,
      };
    }),
    completedCount: state.completedSteps.length,
    failedCount: state.failedSteps.length,
    startTime: state.startTime,
    error: null,
  };
}

function writeProgress(projectDir, progressState) {
  try {
    writeFileSync(path.join(projectDir, PROGRESS_FILENAME), JSON.stringify(progressState), 'utf8');
  } catch { /* non-critical */ }
}

const OUTPUT_BUFFER_SIZE = 100 * 1024;
const OUTPUT_WRITE_INTERVAL = 500;

function createOutputHandler(progress, projectDir) {
  let buffer = '';
  let writePending = false;

  return (chunk) => {
    buffer += chunk;
    if (buffer.length > OUTPUT_BUFFER_SIZE) {
      buffer = buffer.slice(buffer.length - OUTPUT_BUFFER_SIZE);
    }
    if (!writePending) {
      writePending = true;
      setTimeout(() => {
        writePending = false;
        progress.currentStepOutput = buffer;
        writeProgress(projectDir, progress);
      }, OUTPUT_WRITE_INTERVAL);
    }
  };
}

function cleanupDashboard(projectDir) {
  for (const f of [PROGRESS_FILENAME, URL_FILENAME]) {
    try { unlinkSync(path.join(projectDir, f)); } catch { /* already gone */ }
  }
}

function spawnDashboardServer(projectDir) {
  try {
    const serverScript = fileURLToPath(new URL('./dashboard-standalone.js', import.meta.url));
    const useShell = process.platform === 'win32';

    const child = spawn('node', [serverScript, projectDir], {
      detached: true,
      stdio: ['ignore', 'pipe', 'ignore'],
      shell: useShell,
      windowsHide: true,
    });

    return new Promise((resolve) => {
      let output = '';
      const timer = setTimeout(() => {
        child.stdout.removeAllListeners();
        child.unref();
        info('Dashboard server did not respond in time — continuing without dashboard');
        resolve(null);
      }, DASHBOARD_STARTUP_TIMEOUT);

      child.stdout.on('data', (chunk) => {
        output += chunk.toString();
        if (output.includes('\n')) {
          clearTimeout(timer);
          child.stdout.removeAllListeners();
          child.unref();
          try {
            const parsed = JSON.parse(output.trim());
            return resolve({ url: parsed.url, pid: parsed.pid });
          } catch {
            resolve(null);
          }
        }
      });

      child.on('error', () => {
        clearTimeout(timer);
        resolve(null);
      });
    });
  } catch (err) {
    warn(`Could not start dashboard server: ${err.message}`);
    return Promise.resolve(null);
  }
}

function stopDashboardServer(pid) {
  if (!pid) return;
  try {
    process.kill(pid, 'SIGTERM');
  } catch { /* already dead */ }
}

export async function initRun(projectDir, { steps, timeout } = {}) {
  try {
    initLogger(projectDir, { quiet: true });
    info(`NightyTidy v${getVersion()} orchestrator starting (Node ${process.version}, ${process.platform} ${process.arch})`);

    // Check for existing run
    if (readState(projectDir)) {
      return fail('A run is already in progress. Call --finish-run first, or delete nightytidy-run-state.json to reset.');
    }

    await acquireLock(projectDir, { persistent: true });

    const git = initGit(projectDir);
    excludeEphemeralFiles();
    await runPreChecks(projectDir, git);

    // Validate and select steps
    let selectedNums;
    if (steps) {
      const rawTokens = steps.split(',').map(s => s.trim());
      const nums = rawTokens.map(s => parseInt(s, 10));
      const droppedTokens = rawTokens.filter((s, i) => Number.isNaN(nums[i]));
      if (droppedTokens.length > 0) {
        warn(`Ignoring non-numeric step values: ${droppedTokens.join(', ')}`);
      }
      const validNums = nums.filter(n => !Number.isNaN(n));
      if (validNums.length === 0) {
        return fail('No valid step numbers provided. Use --list to see available steps.');
      }
      const err = validateStepNumbers(validNums);
      if (err) return err;
      selectedNums = validNums;
    } else {
      selectedNums = STEPS.map(s => s.number);
    }

    const originalBranch = await getCurrentBranch();
    const tagName = await createPreRunTag();
    const runBranch = await createRunBranch(originalBranch);

    const state = {
      version: STATE_VERSION,
      originalBranch,
      runBranch,
      tagName,
      selectedSteps: selectedNums,
      completedSteps: [],
      failedSteps: [],
      startTime: Date.now(),
      timeout: timeout || null,
      dashboardPid: null,
      dashboardUrl: null,
    };
    writeState(projectDir, state);

    // Write initial progress JSON and spawn dashboard server
    writeProgress(projectDir, buildProgressState(state));
    const dashboard = await spawnDashboardServer(projectDir);
    if (dashboard) {
      state.dashboardPid = dashboard.pid;
      state.dashboardUrl = dashboard.url;
      writeState(projectDir, state);
      info(`Dashboard server at ${dashboard.url} (PID ${dashboard.pid})`);
    }

    notify('NightyTidy Started', `Orchestrator run initialized with ${selectedNums.length} steps.`);
    info(`Orchestrator init complete: branch=${runBranch}, tag=${tagName}, steps=${selectedNums.join(',')}`);

    return ok({
      runBranch,
      tagName,
      originalBranch,
      selectedSteps: selectedNums,
      dashboardUrl: state.dashboardUrl,
    });
  } catch (err) {
    return fail(err.message);
  }
}

export async function runStep(projectDir, stepNumber, { timeout } = {}) {
  try {
    if (!Number.isFinite(stepNumber) || stepNumber < 1) {
      return fail(`Invalid step number: ${stepNumber}. Use --list to see available steps.`);
    }

    initLogger(projectDir, { quiet: true });

    const state = readState(projectDir);
    if (!state) {
      return fail('No active orchestrator run. Call --init-run first.');
    }

    if (!state.selectedSteps.includes(stepNumber)) {
      return fail(`Step ${stepNumber} is not in the selected steps for this run. Selected: ${state.selectedSteps.join(', ')}`);
    }

    if (state.completedSteps.some(s => s.number === stepNumber)) {
      return fail(`Step ${stepNumber} has already been completed in this run.`);
    }
    if (state.failedSteps.some(s => s.number === stepNumber)) {
      return fail(`Step ${stepNumber} has already been attempted and failed in this run.`);
    }

    const step = STEPS.find(s => s.number === stepNumber);
    if (!step) {
      return fail(`Step ${stepNumber} not found in available steps.`);
    }

    initGit(projectDir);

    const stepTimeout = timeout || state.timeout || undefined;

    info(`Orchestrator: running step ${stepNumber} — ${step.name}`);

    // Update progress: mark step as running
    const stepIdx = state.selectedSteps.indexOf(stepNumber);
    const progress = buildProgressState(state);
    progress.currentStepIndex = stepIdx;
    progress.currentStepName = step.name;
    if (stepIdx >= 0 && progress.steps[stepIdx]) {
      progress.steps[stepIdx].status = 'running';
    }
    writeProgress(projectDir, progress);

    // Stream Claude output to progress file for dashboard consumption
    const onOutput = createOutputHandler(progress, projectDir);

    const result = await executeSingleStep(step, projectDir, { timeout: stepTimeout, onOutput });

    // Update state
    const output = (result.output || '').slice(0, 6000);
    const stepError = result.status === 'failed' ? (result.error || 'Step failed during orchestrated run') : null;
    const entry = { number: step.number, name: step.name, status: result.status, duration: result.duration, attempts: result.attempts, output, error: stepError, cost: result.cost || null, suspiciousFast: result.suspiciousFast || false };
    if (result.status === 'completed') {
      state.completedSteps.push(entry);
    } else {
      state.failedSteps.push(entry);
    }
    writeState(projectDir, state);

    // Update progress after step completes (clear output)
    const finalProgress = buildProgressState(state);
    delete finalProgress.currentStepOutput;
    writeProgress(projectDir, finalProgress);

    // Compute remaining
    const doneNums = new Set([...state.completedSteps.map(s => s.number), ...state.failedSteps.map(s => s.number)]);
    const remaining = state.selectedSteps.filter(n => !doneNums.has(n));

    return ok({
      step: stepNumber,
      name: step.name,
      status: result.status,
      output,
      error: stepError,
      duration: result.duration,
      durationFormatted: formatDuration(result.duration),
      attempts: result.attempts,
      costUSD: result.cost?.costUSD ?? null,
      inputTokens: result.cost?.inputTokens ?? null,
      outputTokens: result.cost?.outputTokens ?? null,
      suspiciousFast: result.suspiciousFast || false,
      remainingSteps: remaining,
    });
  } catch (err) {
    return fail(err.message);
  }
}

export async function finishRun(projectDir) {
  try {
    initLogger(projectDir, { quiet: true });

    const state = readState(projectDir);
    if (!state) {
      return fail('No active orchestrator run. Nothing to finish.');
    }

    initGit(projectDir);
    info('Orchestrator: finishing run');

    const executionResults = buildExecutionResults(state);

    const totalDuration = Date.now() - state.startTime;

    // Generate changelog
    let narration = null;
    let overheadCostUSD = 0;
    if (executionResults.completedCount > 0) {
      info('Orchestrator: generating narrated changelog...');
      const changelogResult = await runPrompt(SAFETY_PREAMBLE + CHANGELOG_PROMPT, projectDir, {
        label: 'Narrated changelog',
        timeout: state.timeout || undefined,
      });
      narration = changelogResult.success ? changelogResult.output : null;
      if (!narration) warn('Orchestrator: narrated changelog generation failed — using fallback text');
      overheadCostUSD += changelogResult.cost?.costUSD || 0;
    }

    // Consolidated action plan
    const actionPlan = await generateActionPlan(executionResults, projectDir, {
      timeout: state.timeout || undefined,
    });

    // Sum step costs + overhead (changelog, consolidation tracked via overhead)
    const stepsCostUSD = executionResults.results.reduce((sum, r) => sum + (r.cost?.costUSD || 0), 0);
    const totalCostUSD = stepsCostUSD + overheadCostUSD;
    const totalInputTokens = executionResults.results.reduce((sum, r) => sum + (r.cost?.inputTokens || 0), 0) || null;
    const totalOutputTokens = executionResults.results.reduce((sum, r) => sum + (r.cost?.outputTokens || 0), 0) || null;

    // Generate report
    generateReport(executionResults, narration, {
      projectDir,
      branchName: state.runBranch,
      tagName: state.tagName,
      originalBranch: state.originalBranch,
      startTime: state.startTime,
      endTime: Date.now(),
      totalCostUSD: totalCostUSD || null,
    }, { actionPlan: !!actionPlan });

    // Commit report
    const gitInstance = getGitInstance();
    try {
      const filesToCommit = ['NIGHTYTIDY-REPORT.md', 'CLAUDE.md'];
      if (actionPlan) filesToCommit.push('NIGHTYTIDY-ACTIONS.md');
      await gitInstance.add(filesToCommit);
      await gitInstance.commit('NightyTidy: Add run report and update CLAUDE.md');
    } catch (err) {
      warn(`Failed to commit report: ${err.message}`);
    }

    // Merge
    const mergeResult = await mergeRunBranch(state.originalBranch, state.runBranch);

    // Update progress to completed status before cleanup
    const finalProgress = buildProgressState(state);
    finalProgress.status = 'completed';
    writeProgress(projectDir, finalProgress);

    // Stop dashboard server and clean up
    stopDashboardServer(state.dashboardPid);
    await new Promise(resolve => setTimeout(resolve, SSE_FLUSH_DELAY));
    cleanupDashboard(projectDir);
    releaseLock(projectDir);
    deleteState(projectDir);

    const completionMsg = mergeResult.success
      ? `Run complete: ${executionResults.completedCount} completed, ${executionResults.failedCount} failed.`
      : `Run complete but merge needs attention. Changes on branch: ${state.runBranch}`;
    notify('NightyTidy Complete', completionMsg);

    info(`Orchestrator finish complete: ${executionResults.completedCount} completed, ${executionResults.failedCount} failed`);

    return ok({
      completed: executionResults.completedCount,
      failed: executionResults.failedCount,
      totalDurationFormatted: formatDuration(totalDuration),
      totalCostUSD: totalCostUSD || null,
      totalInputTokens,
      totalOutputTokens,
      merged: mergeResult.success,
      mergeConflict: mergeResult.conflict || false,
      reportPath: 'NIGHTYTIDY-REPORT.md',
      actionsPath: actionPlan ? 'NIGHTYTIDY-ACTIONS.md' : null,
      tagName: state.tagName,
      runBranch: state.runBranch,
    });
  } catch (err) {
    return fail(err.message);
  }
}
