import cron from 'node-cron';
import { info, debug } from '../logger.js';

export class Scheduler {
  constructor(onTrigger) {
    this.onTrigger = onTrigger;
    this.jobs = new Map(); // projectId → { cron, task }
  }

  addSchedule(projectId, cronExpression) {
    this.removeSchedule(projectId);
    const task = cron.schedule(cronExpression, () => {
      info(`Scheduled run triggered for project ${projectId}`);
      this.onTrigger(projectId, cronExpression);
    });
    this.jobs.set(projectId, { cron: cronExpression, task });
    debug(`Scheduled project ${projectId}: ${cronExpression}`);
  }

  removeSchedule(projectId) {
    const job = this.jobs.get(projectId);
    if (job) {
      job.task.stop();
      this.jobs.delete(projectId);
      debug(`Removed schedule for project ${projectId}`);
    }
  }

  getSchedules() {
    return Array.from(this.jobs.entries()).map(([projectId, { cron: expr }]) => ({
      projectId,
      cron: expr,
    }));
  }

  stopAll() {
    const ids = [...this.jobs.keys()];
    for (const id of ids) {
      this.removeSchedule(id);
    }
  }

  static isValidCron(expression) {
    return cron.validate(expression);
  }
}
