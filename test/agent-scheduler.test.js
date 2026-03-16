import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Scheduler } from '../src/agent/scheduler.js';

vi.mock('../src/logger.js', () => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  initLogger: vi.fn(),
}));

vi.mock('node-cron', () => ({
  default: {
    schedule: vi.fn(() => ({ stop: vi.fn() })),
    validate: vi.fn((expr) => {
      // Accept standard 5-field cron expressions (minute hour day month weekday)
      const parts = expr.trim().split(/\s+/);
      return parts.length === 5 && parts.every(p => /^[\d*,/\-]+$/.test(p));
    }),
  },
}));

describe('Scheduler', () => {
  let scheduler, onTrigger;

  beforeEach(() => {
    onTrigger = vi.fn();
    scheduler = new Scheduler(onTrigger);
  });

  afterEach(() => {
    scheduler.stopAll();
  });

  it('adds a schedule for a project', () => {
    scheduler.addSchedule('proj1', '0 2 * * *');
    expect(scheduler.getSchedules()).toHaveLength(1);
  });

  it('removes a schedule', () => {
    scheduler.addSchedule('proj1', '0 2 * * *');
    scheduler.removeSchedule('proj1');
    expect(scheduler.getSchedules()).toHaveLength(0);
  });

  it('replaces existing schedule for same project', () => {
    scheduler.addSchedule('proj1', '0 2 * * *');
    scheduler.addSchedule('proj1', '0 3 * * *');
    expect(scheduler.getSchedules()).toHaveLength(1);
  });

  it('validates cron expressions', () => {
    expect(Scheduler.isValidCron('0 2 * * *')).toBe(true);
    expect(Scheduler.isValidCron('invalid')).toBe(false);
  });

  it('stops all schedules', () => {
    scheduler.addSchedule('proj1', '0 2 * * *');
    scheduler.addSchedule('proj2', '0 3 * * *');
    scheduler.stopAll();
    expect(scheduler.getSchedules()).toHaveLength(0);
  });
});
