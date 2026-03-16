import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CliBridge } from '../src/agent/cli-bridge.js';
import { EventEmitter } from 'node:events';

vi.mock('../src/logger.js', () => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  initLogger: vi.fn(),
}));

function createMockProcess(stdout = '', exitCode = 0) {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.pid = 12345;
  proc.kill = vi.fn();
  setTimeout(() => {
    if (stdout) proc.stdout.emit('data', Buffer.from(stdout));
    proc.emit('close', exitCode);
  }, 10);
  return proc;
}

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => createMockProcess('{"steps":[{"number":1,"name":"Documentation"}]}\n')),
}));

describe('CliBridge', () => {
  let bridge;

  beforeEach(() => {
    bridge = new CliBridge('/path/to/project');
  });

  it('lists steps via --list --json', async () => {
    const result = await bridge.listSteps();
    expect(result).toBeDefined();
  });

  it('builds correct command for init-run', () => {
    const cmd = CliBridge.buildArgs({ initRun: true, steps: [1, 5, 12] });
    expect(cmd).toContain('--init-run');
    expect(cmd).toContain('--steps');
    expect(cmd).toContain('1,5,12');
    expect(cmd).toContain('--skip-dashboard');
    expect(cmd).toContain('--skip-sync');
  });

  it('builds correct command for run-step', () => {
    const cmd = CliBridge.buildArgs({ runStep: 5 });
    expect(cmd).toContain('--run-step');
    expect(cmd).toContain('5');
  });

  it('builds correct command for finish-run', () => {
    const cmd = CliBridge.buildArgs({ finishRun: true });
    expect(cmd).toContain('--finish-run');
  });

  it('includes timeout when specified', () => {
    const cmd = CliBridge.buildArgs({ initRun: true, steps: [1], timeout: 60 });
    expect(cmd).toContain('--timeout');
    expect(cmd).toContain('60');
  });

  it('parses JSON from CLI stdout', () => {
    const parsed = CliBridge.parseOutput('some warning\n{"success":true}\n');
    expect(parsed).toEqual({ success: true });
  });

  it('returns null for unparseable output', () => {
    const parsed = CliBridge.parseOutput('not json at all');
    expect(parsed).toBeNull();
  });
});
