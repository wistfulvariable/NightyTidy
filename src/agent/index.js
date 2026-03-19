// src/agent/index.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { info, warn, debug } from '../logger.js';
import { getConfigDir, readConfig, writeConfig, ensureConfigDir } from './config.js';
import { ProjectManager } from './project-manager.js';
import { RunQueue } from './run-queue.js';
import { Scheduler } from './scheduler.js';
import { AgentWebSocketServer } from './websocket-server.js';
import { WebhookDispatcher } from './webhook-dispatcher.js';
import { CliBridge } from './cli-bridge.js';
import { AgentGit } from './git-integration.js';
import { FirebaseAuth } from './firebase-auth.js';
import { acquireKeepAwake, releaseKeepAwake } from './keep-awake.js';

const FIREBASE_WEBHOOK_URL = 'https://webhookingest-24h6taciuq-uc.a.run.app';

// Read version from package.json so it stays in sync with npm
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf-8'));
const AGENT_VERSION = pkg.version;

export async function startAgent() {
  const configDir = getConfigDir();
  ensureConfigDir(configDir);
  const config = readConfig(configDir);

  info(`NightyTidy Agent starting on ${config.machine}`);

  // Initialize components
  const projectManager = new ProjectManager(configDir);
  projectManager.pruneStaleProjects();

  const runQueue = new RunQueue(configDir);
  const firebaseAuth = new FirebaseAuth(configDir);
  const webhookDispatcher = new WebhookDispatcher({
    machine: config.machine,
    version: AGENT_VERSION,
  });

  // Wire up webhook queue replay: when a fresh token arrives,
  // re-dispatch any webhooks that failed due to expired auth.
  firebaseAuth.onTokenRefresh((queue) => {
    for (const { event, data } of queue) {
      webhookDispatcher.dispatch(event, data, [{
        url: FIREBASE_WEBHOOK_URL,
        label: 'nightytidy.com',
        headers: firebaseAuth.getAuthHeader(),
      }]);
    }
  });

  /**
   * Dispatch a webhook to user endpoints + Firestore.
   * If not authenticated, queues the Firestore payload for replay when a fresh token arrives.
   * User webhooks (Slack/Discord) are always sent immediately.
   */
  function dispatchWithQueue(event, data, projectWebhooks) {
    const userEndpoints = [...(projectWebhooks || [])];
    if (firebaseAuth.isAuthenticated()) {
      userEndpoints.push({
        url: FIREBASE_WEBHOOK_URL,
        label: 'nightytidy.com',
        headers: firebaseAuth.getAuthHeader(),
      });
      webhookDispatcher.dispatch(event, data, userEndpoints);
    } else {
      if (userEndpoints.length > 0) {
        webhookDispatcher.dispatch(event, data, userEndpoints);
      }
      firebaseAuth.queueWebhook(event, data);
      warn(`Firebase webhook queued (not authenticated) — will replay when token arrives`);
    }
  }

  // Track the active CLI bridge so stop-run can kill it
  let activeBridge = null;
  let pauseRequested = false;
  let skipCurrentStep = false;
  let runOutputBuffer = '';  // Accumulated raw output for the current run

  // Accumulated run state — survives page refreshes via get-run
  let runProgress = {
    stepList: [],       // [{ number, name, status, duration?, cost?, ... }]
    completedCount: 0,
    failedCount: 0,
    totalCost: 0,
    currentStepNum: null,
  };

  /**
   * Request a fresh Firebase auth token from the connected web app.
   * Broadcasts a token-refresh-needed event; the web app responds
   * with an auth-refresh command containing the new token.
   * No-op if no refresh is needed or no clients are connected.
   */
  function requestTokenRefreshIfNeeded() {
    if (!firebaseAuth.needsRefresh()) return;
    firebaseAuth.markRefreshRequested();
    warn('Firebase auth token expiring soon — requesting refresh from web app');
    wsServer.broadcast({ type: 'token-refresh-needed' });
  }

  // Command handler (async — some commands need await)
  const handleCommand = async (msg, reply) => {
    switch (msg.type) {
      case 'list-projects':
        reply({ type: 'projects', projects: projectManager.listProjects() });
        break;

      case 'add-project':
        try {
          // Validate path is a git repository
          const gitCheck = new AgentGit(msg.path);
          try {
            await gitCheck._exec('git', ['rev-parse', '--is-inside-work-tree']);
          } catch {
            reply({ type: 'error', message: 'Not a git repository. NightyTidy requires a git repo.', code: 'not_git_repo' });
            break;
          }
          const name = msg.path.split(/[\\/]/).pop();
          const project = projectManager.addProject(msg.path, name);
          reply({ type: 'projects', projects: projectManager.listProjects() });
        } catch (err) {
          reply({ type: 'error', message: err.message, code: 'add_failed' });
        }
        break;

      case 'remove-project':
        projectManager.removeProject(msg.projectId);
        reply({ type: 'projects', projects: projectManager.listProjects() });
        break;

      case 'get-queue':
        reply({
          type: 'queue-updated',
          queue: runQueue.getQueue(),
          current: runQueue.getCurrent(),
        });
        break;

      case 'get-run': {
        const current = runQueue.getCurrent();
        if (current && (!msg.runId || current.id === msg.runId)) {
          const proj = projectManager.getProject(current.projectId);
          if (current.status === 'interrupted') {
            // Return interrupted run state from saved progress
            const progress = current.lastProgress || {};
            reply({
              type: 'run-state',
              runId: current.id,
              projectId: current.projectId,
              projectName: proj?.name ?? current.projectId,
              status: 'interrupted',
              steps: current.steps,
              startedAt: current.startedAt,
              interruptedAt: current.interruptedAt,
              stepList: progress.stepList || [],
              completedCount: progress.completedCount || 0,
              failedCount: progress.failedCount || 0,
              totalCost: progress.totalCost || 0,
              currentStepNum: null,
              resumable: true,
            });
          } else {
            reply({
              type: 'run-state',
              runId: current.id,
              projectId: current.projectId,
              projectName: proj?.name ?? current.projectId,
              status: current.status,
              steps: current.steps,
              startedAt: current.startedAt,
              rawOutput: runOutputBuffer,
              // Accumulated progress for page refresh recovery
              stepList: runProgress.stepList,
              completedCount: runProgress.completedCount,
              failedCount: runProgress.failedCount,
              totalCost: runProgress.totalCost,
              currentStepNum: runProgress.currentStepNum,
            });
          }
        } else {
          reply({ type: 'run-state', runId: null, status: 'not_found' });
        }
        break;
      }

      case 'start-run':
        handleStartRun(msg, reply);
        break;

      case 'stop-run':
        handleStopRun(msg, reply);
        break;

      case 'select-folder': {
        reply({ type: 'folder-selected', path: msg.path || null });
        break;
      }

      case 'pause-run': {
        pauseRequested = true;
        wsServer.broadcast({ type: 'run-paused', runId: msg.runId });
        reply({ type: 'run-paused', runId: msg.runId });
        break;
      }

      case 'resume-run': {
        pauseRequested = false;
        wsServer.broadcast({ type: 'run-resumed', runId: msg.runId });
        reply({ type: 'run-resumed', runId: msg.runId });
        break;
      }

      case 'skip-step': {
        skipCurrentStep = true;
        reply({ type: 'step-skipped', runId: msg.runId, step: msg.step });
        break;
      }

      case 'get-diff': {
        const proj = projectManager.getProject(msg.projectId);
        if (!proj) { reply({ type: 'error', message: 'Project not found', code: 'project_not_found' }); break; }
        const gitObj = new AgentGit(proj.path);
        try {
          const diff = await gitObj.getDiff(msg.baseBranch, msg.runBranch);
          const stat = await gitObj.getDiffStat(msg.baseBranch, msg.runBranch);
          reply({ type: 'diff', diff, stat });
        } catch (err) {
          const message = err.message || 'Failed to get diff';
          const code = message.includes('unknown revision') || message.includes('bad revision')
            ? 'branch_not_found'
            : 'diff_failed';
          reply({ type: 'error', message, code });
        }
        break;
      }

      case 'get-report': {
        const proj = projectManager.getProject(msg.projectId);
        if (!proj) { reply({ type: 'error', message: 'Project not found', code: 'project_not_found' }); break; }
        const gitObj = new AgentGit(proj.path);
        try {
          const report = await gitObj.getReport(msg.runBranch);
          if (report) {
            reply({ type: 'report', filename: report.filename, content: report.content });
          } else {
            reply({ type: 'error', message: 'No report found on branch', code: 'report_not_found' });
          }
        } catch (err) {
          const message = err.message || 'Failed to get report';
          const code = message.includes('unknown revision') ? 'branch_not_found' : 'report_failed';
          reply({ type: 'error', message, code });
        }
        break;
      }

      case 'merge': {
        const proj = projectManager.getProject(msg.projectId);
        if (!proj) { reply({ type: 'error', message: 'Project not found', code: 'project_not_found' }); break; }
        const gitObj = new AgentGit(proj.path);
        const result = await gitObj.merge(msg.runBranch, msg.targetBranch);
        reply({ type: 'merge-result', ...result });
        break;
      }

      case 'rollback': {
        const proj = projectManager.getProject(msg.projectId);
        if (!proj) { reply({ type: 'error', message: 'Project not found', code: 'project_not_found' }); break; }
        const gitObj = new AgentGit(proj.path);
        try {
          await gitObj.rollback(msg.tag);
          reply({ type: 'rollback-result', success: true });
        } catch (err) {
          reply({ type: 'error', message: err.message, code: 'rollback_failed' });
        }
        break;
      }

      case 'create-pr': {
        const proj = projectManager.getProject(msg.projectId);
        if (!proj) { reply({ type: 'error', message: 'Project not found', code: 'project_not_found' }); break; }
        const gitObj = new AgentGit(proj.path);
        const result = await gitObj.createPr(msg.branch, msg.title, msg.body);
        reply({ type: 'pr-result', ...result });
        break;
      }

      case 'retry-step': {
        const proj = projectManager.getProject(msg.projectId);
        if (!proj) { reply({ type: 'error', message: 'Project not found', code: 'project_not_found' }); break; }
        const retryRun = runQueue.enqueue({
          projectId: msg.projectId,
          steps: [msg.step],
          timeout: msg.timeout || 45,
        });
        wsServer.broadcast({ type: 'queue-updated', queue: runQueue.getQueue() });
        reply({ type: 'retry-queued', runId: retryRun.id });
        if (!runQueue.getCurrent()) processQueue();
        break;
      }

      case 'reorder-queue': {
        runQueue.reorder(msg.order);
        wsServer.broadcast({ type: 'queue-updated', queue: runQueue.getQueue() });
        reply({ type: 'queue-updated', queue: runQueue.getQueue() });
        break;
      }

      case 'auth-refresh': {
        if (msg.token && typeof msg.token === 'string') {
          firebaseAuth.setToken(msg.token);
          info('Firebase auth token refreshed by web app');
          reply({ type: 'auth-refresh-ack' });
        } else {
          reply({ type: 'error', message: 'Missing token', code: 'invalid_auth_refresh' });
        }
        break;
      }

      case 'resume-interrupted': {
        const interrupted = runQueue.getInterrupted();
        if (!interrupted) {
          reply({ type: 'error', message: 'No interrupted run to resume', code: 'no_interrupted_run' });
          break;
        }
        const proj = projectManager.getProject(interrupted.projectId);
        if (!proj) {
          reply({ type: 'error', message: 'Project not found', code: 'project_not_found' });
          break;
        }
        // Check if the CLI state file exists (needed for --run-step to work)
        const stateFile = path.join(proj.path, 'nightytidy-run-state.json');
        if (!fs.existsSync(stateFile)) {
          reply({ type: 'error', message: 'Run state file not found — cannot resume. Use "Finish with Partial Results" instead.', code: 'state_missing' });
          break;
        }
        reply({ type: 'resume-started', runId: interrupted.id });
        // Transition back to running and resume the step loop
        resumeInterruptedRun(interrupted, proj);
        break;
      }

      case 'finish-interrupted': {
        const interrupted = runQueue.getInterrupted();
        if (!interrupted) {
          reply({ type: 'error', message: 'No interrupted run to finish', code: 'no_interrupted_run' });
          break;
        }
        const proj = projectManager.getProject(interrupted.projectId);
        if (!proj) {
          reply({ type: 'error', message: 'Project not found', code: 'project_not_found' });
          break;
        }
        reply({ type: 'finish-started', runId: interrupted.id });
        finishInterruptedRun(interrupted, proj);
        break;
      }

      case 'discard-interrupted': {
        const interrupted = runQueue.getInterrupted();
        if (!interrupted) {
          reply({ type: 'error', message: 'No interrupted run to discard', code: 'no_interrupted_run' });
          break;
        }
        runQueue.clearInterrupted();
        // Notify Firestore
        dispatchWithQueue('run_failed', {
          projectId: interrupted.projectId,
          run: { id: interrupted.id },
        }, []);
        reply({ type: 'interrupted-discarded', runId: interrupted.id });
        if (!runQueue.getCurrent()) processQueue();
        break;
      }

      case 'cancel-queued': {
        runQueue.cancel(msg.runId);
        // Also notify Firestore — the run may exist there even if not in local queue
        // (e.g. orphaned after a timeout/crash where the agent already discarded it)
        dispatchWithQueue('run_failed', {
          projectId: msg.projectId || '',
          run: { id: msg.runId },
        }, []);
        wsServer.broadcast({ type: 'queue-updated', queue: runQueue.getQueue() });
        reply({ type: 'queue-updated', queue: runQueue.getQueue() });
        break;
      }

      case 'get-schedules': {
        reply({ type: 'schedules', schedules: scheduler.getSchedules() });
        break;
      }

      case 'set-schedule': {
        if (!Scheduler.isValidCron(msg.cron)) {
          reply({ type: 'error', message: 'Invalid cron expression', code: 'invalid_cron' });
          break;
        }
        scheduler.addSchedule(msg.projectId, msg.cron);
        projectManager.updateProject(msg.projectId, {
          schedule: { cron: msg.cron, enabled: true, steps: msg.steps || [] },
        });
        reply({ type: 'schedule-updated', projectId: msg.projectId });
        break;
      }

      case 'remove-schedule': {
        scheduler.removeSchedule(msg.projectId);
        projectManager.updateProject(msg.projectId, {
          schedule: { cron: null, enabled: false, steps: [] },
        });
        reply({ type: 'schedule-removed', projectId: msg.projectId });
        break;
      }

      default:
        reply({ type: 'error', message: `Unknown command: ${msg.type}`, code: 'unknown_command' });
    }
  };

  // Start WebSocket server
  const wsServer = new AgentWebSocketServer({
    port: config.port,
    token: config.token,
    version: AGENT_VERSION,
    onCommand: handleCommand,
    onAuthCallback: ({ token }) => {
      firebaseAuth.setToken(token);
      info('Firebase auth token received from web app');
    },
  });

  const actualPort = await wsServer.start();

  // Update config with actual port
  config.port = actualPort;
  writeConfig(configDir, config);

  // Initialize scheduler
  const scheduler = new Scheduler((projectId) => {
    const project = projectManager.getProject(projectId);
    if (project) {
      runQueue.enqueue({
        projectId,
        steps: project.schedule?.steps || [],
        timeout: 45,
      });
      wsServer.broadcast({ type: 'queue-updated', queue: runQueue.getQueue() });
      webhookDispatcher.dispatch('schedule_triggered', {
        project: project.name,
        projectId,
      }, project.webhooks || []);
    }
  });

  // Load schedules from projects
  for (const project of projectManager.listProjects()) {
    if (project.schedule?.enabled && project.schedule?.cron) {
      scheduler.addSchedule(project.id, project.schedule.cron);
    }
  }

  // Run execution handler
  async function handleStartRun(msg, reply) {
    const project = projectManager.getProject(msg.projectId);
    if (!project) {
      reply({ type: 'error', message: 'Project not found', code: 'project_not_found' });
      return;
    }

    const run = runQueue.enqueue({
      projectId: msg.projectId,
      steps: msg.steps,
      timeout: msg.timeout || 45,
    });

    wsServer.broadcast({ type: 'queue-updated', queue: runQueue.getQueue() });
    reply({ type: 'run-started', runId: run.id, projectId: msg.projectId });

    if (!runQueue.getCurrent()) {
      processQueue();
    }
  }

  async function processQueue() {
    const run = runQueue.dequeue();
    if (!run) {
      releaseKeepAwake();
      return;
    }

    const project = projectManager.getProject(run.projectId);
    if (!project) {
      dispatchWithQueue('run_failed', {
        projectId: run.projectId,
        run: { id: run.id },
      }, []);
      runQueue.completeCurrent({ success: false });
      processQueue();
      return;
    }

    const bridge = new CliBridge(project.path);
    activeBridge = bridge;
    runOutputBuffer = '';
    runProgress = { stepList: [], completedCount: 0, failedCount: 0, totalCost: 0, currentStepNum: null };

    acquireKeepAwake();
    info(`\n━━━ Run started: ${project.name} ━━━`);
    info(`  Steps: [${run.steps.join(', ')}] (${run.steps.length} total)`);
    info(`  Project: ${project.path}`);

    // Clean stale files from previous failed/abandoned runs
    // so --init-run doesn't refuse to start
    for (const staleFile of ['nightytidy-run-state.json', 'nightytidy.lock']) {
      try {
        const filePath = path.join(project.path, staleFile);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          debug(`Removed stale ${staleFile}`);
        }
      } catch { /* ignore — init-run will report if it's still a problem */ }
    }

    wsServer.broadcast({ type: 'run-started', runId: run.id, projectId: run.projectId, projectName: project.name, branch: '' });
    wsServer.broadcast({ type: 'run-status', runId: run.id, status: 'initializing', message: 'Running pre-checks and setting up git branch...' });
    const initResult = await bridge.initRun(run.steps, run.timeout);
    if (!initResult.success) {
      const errorMsg = initResult.timedOut
        ? 'Initialization timed out — Claude Code may be unavailable. Restart the agent to retry.'
        : (initResult.parsed?.error || initResult.stderr || 'Unknown init error');
      info(`  ✗ Init failed: ${errorMsg}`);
      if (initResult.stdout) debug(`  Init stdout: ${initResult.stdout.slice(-500)}`);
      if (initResult.stderr) debug(`  Init stderr: ${initResult.stderr.slice(-500)}`);
      wsServer.broadcast({ type: 'run-failed', runId: run.id, error: errorMsg });
      dispatchWithQueue('run_failed', {
        project: project.name,
        projectId: project.id,
        run: { id: run.id },
      }, project.webhooks);
      runQueue.completeCurrent({ success: false });
      processQueue();
      return;
    }

    const runBranch = initResult.parsed?.runBranch || '';
    if (runBranch) info(`  Branch: ${runBranch}`);

    // Fetch step names so the web app can show the full step list
    let stepNames = {};
    try {
      const listResult = await bridge.listSteps();
      const allSteps = listResult.parsed || [];
      for (const s of allSteps) {
        stepNames[s.number] = s.name;
      }
    } catch { /* non-critical — steps will show as "Step N" */ }

    // Initialize accumulated step list for refresh recovery
    runProgress.stepList = run.steps.map(n => ({
      number: n,
      name: stepNames[n] || `Step ${n}`,
      status: 'pending',
    }));

    wsServer.broadcast({
      type: 'run-init',
      runId: run.id,
      projectName: project.name,
      totalSteps: run.steps.length,
      startedAt: run.startedAt,
      steps: run.steps.map(n => ({ number: n, name: stepNames[n] || `Step ${n}` })),
    });

    // Send run_started webhook so Firestore run doc is created immediately
    dispatchWithQueue('run_started', {
      project: project.name,
      projectId: project.id,
      run: {
        id: run.id,
        startedAt: run.startedAt,
        selectedSteps: run.steps,
        gitBranch: initResult.parsed?.runBranch || '',
        gitTag: initResult.parsed?.tagName || '',
      },
    }, project.webhooks);

    startHeartbeat(run.id, project.id);

    const stepsToRun = [...run.steps];
    const totalSteps = stepsToRun.length;
    let stepIndex = 0;
    while (stepIndex < stepsToRun.length) {
      while (pauseRequested) {
        await new Promise(r => setTimeout(r, 1000));
      }
      if (skipCurrentStep) {
        skipCurrentStep = false;
        wsServer.broadcast({ type: 'step-skipped', runId: run.id, step: { number: stepsToRun[stepIndex] } });
        stepIndex++;
        continue;
      }

      const stepNum = stepsToRun[stepIndex];
      runProgress.currentStepNum = stepNum;
      // Update step status in accumulated list
      const si = runProgress.stepList.findIndex(s => s.number === stepNum);
      if (si >= 0) runProgress.stepList[si].status = 'running';

      info(`  [${stepIndex + 1}/${totalSteps}] Running step ${stepNum}...`);
      wsServer.broadcast({ type: 'step-started', runId: run.id, step: { number: stepNum } });

      const stepResult = await bridge.runStep(stepNum, (text) => {
        runOutputBuffer += text;
        wsServer.broadcast({ type: 'step-output', runId: run.id, text, mode: 'raw' });
      });

      const stepParsed = stepResult.parsed || {};
      if (stepParsed.success) {
        const git = new AgentGit(project.path);
        let filesChanged = 0;
        try {
          const branch = initResult.parsed?.runBranch;
          const tag = initResult.parsed?.tagName;
          if (branch && tag) {
            filesChanged = await git.countFilesChanged(tag, branch);
          }
        } catch { /* ignore */ }

        // Build step data from parsed result — orchestrator returns flat object
        // with fields: name, duration, costUSD, output, attempts, inputTokens, outputTokens
        const stepData = {
          number: stepNum,
          name: stepParsed.name || `Step ${stepNum}`,
          status: 'completed',
          duration: stepParsed.duration || 0,
          cost: stepParsed.costUSD || 0,
          attempts: stepParsed.attempts || 1,
          summary: stepParsed.output || null,
          filesChanged,
          inputTokens: stepParsed.inputTokens || null,
          outputTokens: stepParsed.outputTokens || null,
        };

        const durMin = Math.floor((stepData.duration || 0) / 60000);
        const durSec = Math.floor(((stepData.duration || 0) % 60000) / 1000);
        const durStr = durMin > 0 ? `${durMin}m ${durSec}s` : `${durSec}s`;
        const costStr = stepData.cost > 0 ? `, $${stepData.cost.toFixed(2)}` : '';
        info(`  ✓ Step ${stepNum} "${stepData.name}" passed (${durStr}${costStr})`);

        // Update accumulated progress
        runProgress.completedCount++;
        runProgress.totalCost += stepData.cost;
        runProgress.currentStepNum = null;
        const ci = runProgress.stepList.findIndex(s => s.number === stepNum);
        if (ci >= 0) Object.assign(runProgress.stepList[ci], { status: 'completed', ...stepData });

        wsServer.broadcast({
          type: 'step-completed',
          runId: run.id,
          step: stepData,
          cost: stepData.cost,
        });

        requestTokenRefreshIfNeeded();
        dispatchWithQueue('step_completed', {
          project: project.name,
          projectId: project.id,
          step: stepData,
          run: { id: run.id, progress: `${stepIndex + 1}/${totalSteps}`, costSoFar: stepData.cost, elapsedMs: stepData.duration },
        }, project.webhooks);
        stepIndex++;
      } else {
        const errorType = stepParsed.errorType;
        if (errorType === 'rate_limit') {
          const waitSec = Math.round((stepParsed.retryAfterMs || 120000) / 1000);
          info(`  ⏸ Rate limited — waiting ${waitSec}s before retrying step ${stepNum}`);
          wsServer.broadcast({
            type: 'rate-limit',
            runId: run.id,
            retryAfterMs: stepParsed.retryAfterMs || 120000,
            step: { number: stepNum },
          });
          await new Promise(r => setTimeout(r, stepParsed.retryAfterMs || 120000));
          info(`  ▶ Resuming after rate limit`);
          wsServer.broadcast({ type: 'rate-limit-resumed', runId: run.id });
          continue;
        }
        const stepName = stepParsed.name || `Step ${stepNum}`;
        const failCost = stepParsed.costUSD || 0;
        info(`  ✗ Step ${stepNum} "${stepName}" failed: ${stepParsed.error || 'unknown error'}`);

        // Update accumulated progress
        runProgress.failedCount++;
        runProgress.totalCost += failCost;
        runProgress.currentStepNum = null;
        const fi = runProgress.stepList.findIndex(s => s.number === stepNum);
        if (fi >= 0) Object.assign(runProgress.stepList[fi], {
          status: 'failed', name: stepName,
          duration: stepParsed.duration || 0, cost: failCost,
          error: stepParsed.error || stepResult.stderr,
        });

        wsServer.broadcast({
          type: 'step-failed',
          runId: run.id,
          step: { number: stepNum, name: stepName },
          error: stepParsed.error || stepResult.stderr,
          duration: stepParsed.duration || 0,
          cost: failCost,
        });

        requestTokenRefreshIfNeeded();
        dispatchWithQueue('step_failed', {
          project: project.name,
          projectId: project.id,
          step: { number: stepNum, name: stepParsed.name || `Step ${stepNum}`, status: 'failed', duration: stepParsed.duration || 0, cost: stepParsed.costUSD || 0 },
          run: { id: run.id },
        }, project.webhooks);
        stepIndex++;
      }
    }

    stopHeartbeat();
    info(`  Finishing run (report + merge)...`);
    const finishResult = await bridge.finishRun();
    const reportMarkdown = finishResult?.parsed?.reportContent || null;
    projectManager.updateProject(run.projectId, { lastRunAt: Date.now() });

    const elapsedMs = Date.now() - run.startedAt;
    const elMin = Math.floor(elapsedMs / 60000);
    const elSec = Math.floor((elapsedMs % 60000) / 1000);
    const elStr = elMin > 0 ? `${elMin}m ${elSec}s` : `${elSec}s`;
    info(`━━━ Run complete: ${project.name} (${totalSteps} steps, ${elStr}) ━━━\n`);

    wsServer.broadcast({ type: 'run-completed', runId: run.id, results: {} });

    requestTokenRefreshIfNeeded();
    dispatchWithQueue('run_completed', {
      project: project.name,
      projectId: project.id,
      run: { id: run.id, totalSteps, completedSteps: run.steps.length, elapsedMs: Date.now() - run.startedAt },
      reportMarkdown,
    }, project.webhooks);

    activeBridge = null;
    runQueue.completeCurrent({ success: true });
    processQueue();
  }

  function handleStopRun(msg, reply) {
    const current = runQueue.getCurrent();
    if (current && current.id === msg.runId) {
      info(`  ■ Run stopped by user`);
      stopHeartbeat();
      if (activeBridge) {
        activeBridge.kill();
        activeBridge = null;
      }
      const project = projectManager.getProject(current.projectId);
      runQueue.completeCurrent({ success: false });
      wsServer.broadcast({ type: 'run-failed', runId: msg.runId, error: 'Stopped by user' });
      dispatchWithQueue('run_failed', {
        project: project?.name,
        projectId: current.projectId,
        run: { id: msg.runId },
      }, project?.webhooks || []);
      reply({ type: 'run-failed', runId: msg.runId, error: 'Stopped by user' });
      processQueue();
    } else {
      runQueue.cancel(msg.runId);
      reply({ type: 'queue-updated', queue: runQueue.getQueue() });
    }
  }

  /**
   * Resume an interrupted run by running remaining steps then finishing.
   */
  async function resumeInterruptedRun(interrupted, project) {
    // Determine which steps are already completed by reading the CLI state file
    // (more reliable than lastProgress which may be empty if agent crashed before our code)
    const completedNums = new Set();
    try {
      const stateFile = path.join(project.path, 'nightytidy-run-state.json');
      const stateRaw = fs.readFileSync(stateFile, 'utf-8');
      const state = JSON.parse(stateRaw);
      for (const s of (state.completedSteps || [])) {
        completedNums.add(s.number);
      }
      info(`  Found ${completedNums.size} completed steps in CLI state file`);
    } catch {
      // Fall back to lastProgress if state file is missing
      const progress = interrupted.lastProgress || {};
      for (const s of (progress.stepList || [])) {
        if (s.status === 'completed') completedNums.add(s.number);
      }
      info(`  No CLI state file — using agent progress (${completedNums.size} completed)`);
    }
    const remainingSteps = interrupted.steps.filter(n => !completedNums.has(n));

    if (remainingSteps.length === 0) {
      info('  No remaining steps — finishing interrupted run');
      return finishInterruptedRun(interrupted, project);
    }

    // Transition queue entry back to running
    interrupted.status = 'running';
    runQueue._save();

    const bridge = new CliBridge(project.path);
    activeBridge = bridge;
    runOutputBuffer = '';

    // Build step list with known completed steps marked
    const stepList = interrupted.steps.map(n => ({
      number: n,
      name: `Step ${n}`,
      status: completedNums.has(n) ? 'completed' : 'pending',
    }));

    runProgress = {
      stepList,
      completedCount: completedNums.size,
      failedCount: 0,
      totalCost: 0,
      currentStepNum: null,
    };

    info(`\n━━━ Resuming interrupted run: ${project.name} ━━━`);
    info(`  Remaining steps: [${remainingSteps.join(', ')}] (${remainingSteps.length} of ${interrupted.steps.length})`);

    wsServer.broadcast({
      type: 'run-resumed',
      runId: interrupted.id,
      projectName: project.name,
      totalSteps: interrupted.steps.length,
      completedSteps: runProgress.completedCount,
      remainingSteps,
    });

    startHeartbeat(interrupted.id, project.id);

    // Notify Firestore the run is active again (use run_resumed, NOT run_started
    // which would reset completedSteps/totalCost counters to 0)
    dispatchWithQueue('run_resumed', {
      project: project.name,
      projectId: project.id,
      run: { id: interrupted.id, startedAt: interrupted.startedAt },
    }, project.webhooks);

    // Run remaining steps (reuse the same step loop pattern)
    for (const stepNum of remainingSteps) {
      while (pauseRequested) {
        await new Promise(r => setTimeout(r, 1000));
      }

      runProgress.currentStepNum = stepNum;
      const si = runProgress.stepList.findIndex(s => s.number === stepNum);
      if (si >= 0) runProgress.stepList[si].status = 'running';

      info(`  [resume] Running step ${stepNum}...`);
      wsServer.broadcast({ type: 'step-started', runId: interrupted.id, step: { number: stepNum } });

      const stepResult = await bridge.runStep(stepNum, (text) => {
        runOutputBuffer += text;
        wsServer.broadcast({ type: 'step-output', runId: interrupted.id, text, mode: 'raw' });
      });

      const stepParsed = stepResult.parsed || {};
      if (stepParsed.success) {
        const git = new AgentGit(project.path);
        let filesChanged = 0;
        try {
          const stateRaw = fs.readFileSync(path.join(project.path, 'nightytidy-run-state.json'), 'utf-8');
          const state = JSON.parse(stateRaw);
          if (state.runBranch && state.tagName) {
            filesChanged = await git.countFilesChanged(state.tagName, state.runBranch);
          }
        } catch { /* ignore */ }

        const stepData = {
          number: stepNum,
          name: stepParsed.name || `Step ${stepNum}`,
          status: 'completed',
          duration: stepParsed.duration || 0,
          cost: stepParsed.costUSD || 0,
          attempts: stepParsed.attempts || 1,
          summary: stepParsed.output || null,
          filesChanged,
        };

        info(`  ✓ Step ${stepNum} "${stepData.name}" passed`);
        runProgress.completedCount++;
        runProgress.totalCost += stepData.cost;
        runProgress.currentStepNum = null;
        const ci = runProgress.stepList.findIndex(s => s.number === stepNum);
        if (ci >= 0) Object.assign(runProgress.stepList[ci], { status: 'completed', ...stepData });

        wsServer.broadcast({ type: 'step-completed', runId: interrupted.id, step: stepData, cost: stepData.cost });

        requestTokenRefreshIfNeeded();
        dispatchWithQueue('step_completed', {
          project: project.name, projectId: project.id, step: stepData,
          run: { id: interrupted.id, costSoFar: stepData.cost, elapsedMs: stepData.duration },
        }, project.webhooks);
      } else if (stepParsed.errorType === 'rate_limit') {
        const waitMs = stepParsed.retryAfterMs || 120000;
        info(`  ⏸ Rate limited — waiting ${Math.round(waitMs / 1000)}s`);
        wsServer.broadcast({ type: 'rate-limit', runId: interrupted.id, retryAfterMs: waitMs, step: { number: stepNum } });
        await new Promise(r => setTimeout(r, waitMs));
        wsServer.broadcast({ type: 'rate-limit-resumed', runId: interrupted.id });
        // Retry by re-adding to remaining (loop will naturally continue)
        continue;
      } else if ((stepParsed.error || stepResult.stderr || '').includes('already been completed')) {
        // Step was already completed in a prior session — skip, not fail
        info(`  ⊘ Step ${stepNum} already completed — skipping`);
        runProgress.completedCount++;
        runProgress.currentStepNum = null;
        const si = runProgress.stepList.findIndex(s => s.number === stepNum);
        if (si >= 0) Object.assign(runProgress.stepList[si], { status: 'completed' });
        wsServer.broadcast({ type: 'step-completed', runId: interrupted.id, step: { number: stepNum, status: 'completed', duration: 0, cost: 0 }, cost: 0 });
      } else {
        info(`  ✗ Step ${stepNum} failed: ${stepParsed.error || 'unknown'}`);
        runProgress.failedCount++;
        runProgress.currentStepNum = null;
        const fi = runProgress.stepList.findIndex(s => s.number === stepNum);
        if (fi >= 0) Object.assign(runProgress.stepList[fi], {
          status: 'failed', duration: stepParsed.duration || 0, cost: stepParsed.costUSD || 0,
          error: stepParsed.error || stepResult.stderr,
        });
        wsServer.broadcast({ type: 'step-failed', runId: interrupted.id, step: { number: stepNum }, error: stepParsed.error || stepResult.stderr });
      }
    }

    // Finish the run
    stopHeartbeat();
    info(`  Finishing resumed run (report + merge)...`);
    const finishResult = await bridge.finishRun();
    const reportMarkdown = finishResult?.parsed?.reportContent || null;
    projectManager.updateProject(interrupted.projectId, { lastRunAt: Date.now() });

    wsServer.broadcast({ type: 'run-completed', runId: interrupted.id, results: {} });

    requestTokenRefreshIfNeeded();
    dispatchWithQueue('run_completed', {
      project: project.name, projectId: project.id,
      run: { id: interrupted.id, totalSteps: interrupted.steps.length, completedSteps: runProgress.completedCount, elapsedMs: Date.now() - interrupted.startedAt },
      reportMarkdown,
    }, project.webhooks);

    activeBridge = null;
    runQueue.completeCurrent({ success: true });
    info(`━━━ Resumed run complete: ${project.name} ━━━\n`);
    processQueue();
  }

  /**
   * Finish an interrupted run without resuming remaining steps.
   * Calls --finish-run to generate a partial report from completed steps.
   */
  async function finishInterruptedRun(interrupted, project) {
    const bridge = new CliBridge(project.path);
    activeBridge = bridge;

    info(`  Finishing interrupted run with partial results...`);
    interrupted.status = 'running';
    runQueue._save();

    let finishResult = null;
    try {
      finishResult = await bridge.finishRun();
    } catch (err) {
      warn(`  finishRun failed: ${err.message}`);
    }
    const reportMarkdown = finishResult?.parsed?.reportContent || null;

    projectManager.updateProject(interrupted.projectId, { lastRunAt: Date.now() });
    wsServer.broadcast({ type: 'run-completed', runId: interrupted.id, status: 'completed', results: {} });

    requestTokenRefreshIfNeeded();
    dispatchWithQueue('run_completed', {
      project: project.name, projectId: project.id,
      run: { id: interrupted.id, totalSteps: interrupted.steps.length, completedSteps: interrupted.lastProgress?.completedCount || 0, elapsedMs: Date.now() - interrupted.startedAt },
      reportMarkdown,
    }, project.webhooks);

    activeBridge = null;
    runQueue.completeCurrent({ success: true });
    info(`━━━ Partial finish complete: ${project.name} ━━━\n`);
    processQueue();
  }

  // Heartbeat interval for Firestore liveness detection
  let heartbeatInterval = null;
  let currentRunId = null;
  let currentProjectId = null;

  function startHeartbeat(runId, projectId) {
    currentRunId = runId;
    currentProjectId = projectId;
    heartbeatInterval = setInterval(() => {
      if (!firebaseAuth.isAuthenticated()) return;
      webhookDispatcher.dispatch('heartbeat', {
        projectId: currentProjectId,
        run: { id: currentRunId },
      }, [{
        url: FIREBASE_WEBHOOK_URL,
        label: 'nightytidy.com',
        headers: firebaseAuth.getAuthHeader(),
      }]);
    }, 60_000);
  }

  function stopHeartbeat() {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
    currentRunId = null;
    currentProjectId = null;
  }

  // Preserve interrupted run state on shutdown
  function saveInterruptedState() {
    const current = runQueue.getCurrent();
    if (current && current.status === 'running' && activeBridge) {
      activeBridge.kill();
      activeBridge = null;
      runQueue.markInterrupted(runProgress);

      // Best-effort: notify Firestore (may not complete before exit)
      dispatchWithQueue('run_interrupted', {
        projectId: current.projectId,
        run: {
          id: current.id,
          completedSteps: runProgress.completedCount,
          failedSteps: runProgress.failedCount,
          totalCost: runProgress.totalCost,
        },
      }, []);

      // Notify connected clients
      wsServer.broadcast({
        type: 'run-interrupted',
        runId: current.id,
        completedSteps: runProgress.completedCount,
        failedSteps: runProgress.failedCount,
        totalCost: runProgress.totalCost,
      });
    }
    stopHeartbeat();
  }

  // Graceful shutdown
  const shutdown = async () => {
    info('Agent shutting down...');
    releaseKeepAwake();
    saveInterruptedState();
    scheduler.stopAll();
    await wsServer.stop();
    info('Agent stopped');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Catch unexpected crashes — save state before dying
  process.on('uncaughtException', (err) => {
    warn(`Uncaught exception: ${err.message}`);
    saveInterruptedState();
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    warn(`Unhandled rejection: ${reason}`);
    saveInterruptedState();
    process.exit(1);
  });

  // Check for interrupted run from previous session
  const interrupted = runQueue.getInterrupted();
  if (interrupted) {
    const proj = projectManager.getProject(interrupted.projectId);
    const projName = proj?.name ?? interrupted.projectId;
    const progress = interrupted.lastProgress || {};
    const completed = progress.completedCount || 0;
    const total = interrupted.steps?.length || 0;

    if (completed === 0) {
      // Run never actually started (init timed out or crashed before any steps).
      // Auto-discard — there's nothing to resume or finish, and blocking the
      // queue for user action is pointless.
      info(`Auto-discarding interrupted run with 0 completed steps: ${projName} (${interrupted.id})`);
      runQueue.clearInterrupted();
      dispatchWithQueue('run_failed', {
        projectId: proj?.id || interrupted.projectId,
        run: { id: interrupted.id },
      }, []);
    } else {
      info(`Found interrupted run: ${projName} (${completed}/${total} steps completed)`);
      info(`  Run ID: ${interrupted.id}`);
      info(`  Use the web app to Resume, Finish with Partial Results, or Discard`);

      // Best-effort: notify Firestore that this run is interrupted
      // (in case the shutdown webhook didn't make it)
      if (proj) {
        dispatchWithQueue('run_interrupted', {
          projectId: proj.id,
          run: {
            id: interrupted.id,
            completedSteps: completed,
            failedSteps: progress.failedCount || 0,
            totalCost: progress.totalCost || 0,
          },
        }, []);
      }
    }
  }

  // Also handle case where queue has a "running" entry from a crash
  // (agent died without graceful shutdown, so markInterrupted was never called)
  const current = runQueue.getCurrent();
  if (current && current.status === 'running' && !activeBridge) {
    // Orphaned run with no progress — auto-discard instead of blocking the queue
    info(`Found orphaned running run: ${current.id} — auto-discarding (0 steps completed)`);
    runQueue.completeCurrent({ success: false });
    dispatchWithQueue('run_failed', {
      projectId: current.projectId,
      run: { id: current.id },
    }, []);
  }

  // Process any queued runs left from a previous session
  if (!runQueue.getInterrupted() && !runQueue.getCurrent()) {
    const pending = runQueue.getQueue();
    if (pending.length > 0) {
      info(`Found ${pending.length} queued run(s) — starting queue processing`);
      processQueue();
    }
  }

  // Print startup info
  console.log(`\nNightyTidy Agent v${AGENT_VERSION}`);
  console.log(`WebSocket: ws://127.0.0.1:${actualPort}`);
  console.log(`Token: ${config.token.slice(0, 6)}...(see ~/.nightytidy/config.json)`);
  if (interrupted) {
    console.log(`\n⚠ Interrupted run detected — open nightytidy.com to resume or finish.\n`);
  }
  console.log(`\nOpen nightytidy.com to connect.\n`);

  return { wsServer, scheduler, projectManager, runQueue };
}
