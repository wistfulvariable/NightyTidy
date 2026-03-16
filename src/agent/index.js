// src/agent/index.js
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
    version: '1.0.0',
  });

  // Track the active CLI bridge so stop-run can kill it
  let activeBridge = null;
  let pauseRequested = false;
  let skipCurrentStep = false;
  let runOutputBuffer = '';  // Accumulated raw output for the current run

  // Command handler (async — some commands need await)
  const handleCommand = async (msg, reply) => {
    switch (msg.type) {
      case 'list-projects':
        reply({ type: 'projects', projects: projectManager.listProjects() });
        break;

      case 'add-project':
        try {
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
          reply({
            type: 'run-state',
            runId: current.id,
            projectId: current.projectId,
            projectName: proj?.name ?? current.projectId,
            status: current.status,
            steps: current.steps,
            startedAt: current.startedAt,
            rawOutput: runOutputBuffer,
          });
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

      case 'cancel-queued': {
        runQueue.cancel(msg.runId);
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
    onCommand: handleCommand,
    onAuthCallback: ({ token }) => {
      // Firebase ID tokens expire after 1 hour
      firebaseAuth.setToken(token, Date.now() + 3600_000);
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
    if (!run) return;

    const project = projectManager.getProject(run.projectId);
    if (!project) {
      runQueue.completeCurrent({ success: false });
      processQueue();
      return;
    }

    const bridge = new CliBridge(project.path);
    activeBridge = bridge;
    runOutputBuffer = '';

    info(`\n━━━ Run started: ${project.name} ━━━`);
    info(`  Steps: [${run.steps.join(', ')}] (${run.steps.length} total)`);
    info(`  Project: ${project.path}`);

    wsServer.broadcast({ type: 'run-started', runId: run.id, projectId: run.projectId, projectName: project.name, branch: '' });
    const initResult = await bridge.initRun(run.steps, run.timeout);
    if (!initResult.success) {
      info(`  ✗ Init failed: ${initResult.stderr}`);
      wsServer.broadcast({ type: 'run-failed', runId: run.id, error: initResult.stderr });
      runQueue.completeCurrent({ success: false });
      processQueue();
      return;
    }

    const runBranch = initResult.parsed?.runBranch || '';
    if (runBranch) info(`  Branch: ${runBranch}`);

    wsServer.broadcast({
      type: 'run-init',
      runId: run.id,
      projectName: project.name,
      totalSteps: run.steps.length,
      startedAt: run.startedAt,
    });

    // Send run_started webhook so Firestore run doc is created immediately
    const startEndpoints = [...(project.webhooks || [])];
    if (firebaseAuth.isAuthenticated()) {
      startEndpoints.push({
        url: 'https://webhookingest-24h6taciuq-uc.a.run.app',
        label: 'nightytidy.com',
        headers: firebaseAuth.getAuthHeader(),
      });
    }
    webhookDispatcher.dispatch('run_started', {
      project: project.name,
      projectId: project.id,
      run: {
        id: run.id,
        startedAt: run.startedAt,
        selectedSteps: run.steps,
        gitBranch: initResult.parsed?.runBranch || '',
        gitTag: initResult.parsed?.tagName || '',
      },
    }, startEndpoints);

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

        wsServer.broadcast({
          type: 'step-completed',
          runId: run.id,
          step: stepData,
          cost: stepData.cost,
        });

        const endpoints = [...(project.webhooks || [])];
        if (firebaseAuth.isAuthenticated()) {
          endpoints.push({
            url: 'https://webhookingest-24h6taciuq-uc.a.run.app',
            label: 'nightytidy.com',
            headers: firebaseAuth.getAuthHeader(),
          });
        }
        webhookDispatcher.dispatch('step_completed', {
          project: project.name,
          projectId: project.id,
          step: stepData,
          run: { id: run.id, progress: `${stepIndex + 1}/${totalSteps}`, costSoFar: stepData.cost, elapsedMs: stepData.duration },
        }, endpoints);
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
        info(`  ✗ Step ${stepNum} "${stepName}" failed: ${stepParsed.error || 'unknown error'}`);
        wsServer.broadcast({
          type: 'step-failed',
          runId: run.id,
          step: { number: stepNum, name: stepName },
          error: stepParsed.error || stepResult.stderr,
          duration: stepParsed.duration || 0,
          cost: stepParsed.costUSD || 0,
        });

        const endpoints = [...(project.webhooks || [])];
        if (firebaseAuth.isAuthenticated()) {
          endpoints.push({
            url: 'https://webhookingest-24h6taciuq-uc.a.run.app',
            label: 'nightytidy.com',
            headers: firebaseAuth.getAuthHeader(),
          });
        }
        webhookDispatcher.dispatch('step_failed', {
          project: project.name,
          projectId: project.id,
          step: { number: stepNum, name: stepParsed.name || `Step ${stepNum}`, status: 'failed', duration: stepParsed.duration || 0, cost: stepParsed.costUSD || 0 },
          run: { id: run.id },
        }, endpoints);
        stepIndex++;
      }
    }

    info(`  Finishing run (report + merge)...`);
    await bridge.finishRun();
    projectManager.updateProject(run.projectId, { lastRunAt: Date.now() });

    const elapsedMs = Date.now() - run.startedAt;
    const elMin = Math.floor(elapsedMs / 60000);
    const elSec = Math.floor((elapsedMs % 60000) / 1000);
    const elStr = elMin > 0 ? `${elMin}m ${elSec}s` : `${elSec}s`;
    info(`━━━ Run complete: ${project.name} (${totalSteps} steps, ${elStr}) ━━━\n`);

    wsServer.broadcast({ type: 'run-completed', runId: run.id, results: {} });

    const completionEndpoints = [...(project.webhooks || [])];
    if (firebaseAuth.isAuthenticated()) {
      completionEndpoints.push({
        url: 'https://webhookingest-24h6taciuq-uc.a.run.app',
        label: 'nightytidy.com',
        headers: firebaseAuth.getAuthHeader(),
      });
    }
    webhookDispatcher.dispatch('run_completed', {
      project: project.name,
      projectId: project.id,
      run: { id: run.id, totalSteps, completedSteps: run.steps.length, elapsedMs: Date.now() - run.startedAt },
    }, completionEndpoints);

    activeBridge = null;
    runQueue.completeCurrent({ success: true });
    processQueue();
  }

  function handleStopRun(msg, reply) {
    const current = runQueue.getCurrent();
    if (current && current.id === msg.runId) {
      info(`  ■ Run stopped by user`);
      if (activeBridge) {
        activeBridge.kill();
        activeBridge = null;
      }
      runQueue.completeCurrent({ success: false });
      wsServer.broadcast({ type: 'run-failed', runId: msg.runId, error: 'Stopped by user' });
      reply({ type: 'run-failed', runId: msg.runId, error: 'Stopped by user' });
      processQueue();
    } else {
      runQueue.cancel(msg.runId);
      reply({ type: 'queue-updated', queue: runQueue.getQueue() });
    }
  }

  // Graceful shutdown
  const shutdown = async () => {
    info('Agent shutting down...');
    scheduler.stopAll();
    await wsServer.stop();
    info('Agent stopped');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Print startup info
  console.log(`\nNightyTidy Agent v1.0.0`);
  console.log(`WebSocket: ws://127.0.0.1:${actualPort}`);
  console.log(`Token: ${config.token.slice(0, 6)}...(see ~/.nightytidy/config.json)`);
  console.log(`\nOpen nightytidy.com to connect.\n`);

  return { wsServer, scheduler, projectManager, runQueue };
}
