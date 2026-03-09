import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Chalk mock: every property access and function call returns the identity passthrough.
// Supports chaining like chalk.cyan.bold('text') -> 'text'.
vi.mock('chalk', () => {
  function createChainable() {
    const fn = (s) => s;
    return new Proxy(fn, {
      get(target, prop) {
        if (prop === 'default') return createChainable();
        if (prop === '__esModule') return true;
        if (prop === Symbol.toPrimitive) return () => '';
        return createChainable();
      },
      apply(_target, _thisArg, args) {
        return args[0];
      },
    });
  }
  return { default: createChainable() };
});

// Imports - after mocks
import { formatMs, progressBar, render } from '../src/dashboard-tui.js';

// formatMs
describe('dashboard-tui.js', () => {
  describe('formatMs', () => {
    it.each([
      [0, '0s', 'zero'],
      [999, '0s', 'sub-second'],
      [1000, '1s', 'exactly 1 second'],
      [59999, '59s', 'just under 1 minute'],
      [60000, '1m 00s', 'exactly 1 minute'],
      [90000, '1m 30s', '1.5 minutes'],
      [3599000, '59m 59s', 'just under 1 hour'],
      [3600000, '1h 00m', 'exactly 1 hour'],
      [5400000, '1h 30m', '1.5 hours'],
      [7200000, '2h 00m', 'exactly 2 hours'],
    ])('formats %i ms as "%s" (%s)', (ms, expected) => {
      expect(formatMs(ms)).toBe(expected);
    });
  });

  // progressBar
  describe('progressBar', () => {
    it('returns 0% bar when no steps are done', () => {
      const bar = progressBar(0, 10);
      expect(bar).toContain('0/10');
      expect(bar).toContain('0%');
    });

    it('returns 100% bar when all steps are done', () => {
      const bar = progressBar(10, 10);
      expect(bar).toContain('10/10');
      expect(bar).toContain('100%');
    });

    it('shows partial progress for active step', () => {
      const withActive = progressBar(5, 10, true);
      const withoutActive = progressBar(5, 10, false);
      expect(withActive).toContain('5/10');
      expect(withoutActive).toContain('5/10');
      // active makes percentage slightly higher
      expect(withActive).toContain('55%');
      expect(withoutActive).toContain('50%');
    });

    it('handles zero total steps gracefully', () => {
      const bar = progressBar(0, 0);
      expect(bar).toContain('0/0');
      expect(bar).toContain('0%');
    });
  });

  // render
  describe('render', () => {
    let stdoutSpy;

    beforeEach(() => {
      stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    });

    afterEach(() => {
      stdoutSpy.mockRestore();
    });

    function makeState(overrides = {}) {
      return {
        status: 'running',
        totalSteps: 3,
        currentStepIndex: 1,
        currentStepName: 'Format',
        steps: [
          { number: 1, name: 'Lint', status: 'completed', duration: 60000 },
          { number: 2, name: 'Format', status: 'running', duration: null },
          { number: 3, name: 'Test', status: 'pending', duration: null },
        ],
        completedCount: 1,
        failedCount: 0,
        startTime: Date.now() - 120000,
        error: null,
        ...overrides,
      };
    }

    it('renders without crashing for a running state', () => {
      render(makeState());
      expect(stdoutSpy).toHaveBeenCalled();
      const output = stdoutSpy.mock.calls.map(c => c[0]).join('');
      expect(output).toContain('NightyTidy');
      expect(output).toContain('Lint');
      expect(output).toContain('Format');
    });

    it('renders completed state with finished message', () => {
      render(makeState({ status: 'completed' }));
      const output = stdoutSpy.mock.calls.map(c => c[0]).join('');
      expect(output).toContain('finished');
    });

    it('renders error state with error message', () => {
      render(makeState({ status: 'error', error: 'something broke' }));
      const output = stdoutSpy.mock.calls.map(c => c[0]).join('');
      expect(output).toContain('something broke');
    });

    it('renders stopped state with finished message', () => {
      render(makeState({ status: 'stopped' }));
      const output = stdoutSpy.mock.calls.map(c => c[0]).join('');
      expect(output).toContain('finished');
    });

    it('shows passed/failed counts', () => {
      render(makeState({
        completedCount: 2,
        failedCount: 1,
        totalSteps: 5,
        steps: [
          { number: 1, name: 'Lint', status: 'completed', duration: 60000 },
          { number: 2, name: 'Format', status: 'completed', duration: 30000 },
          { number: 3, name: 'Test', status: 'failed', duration: 10000 },
          { number: 4, name: 'Docs', status: 'pending', duration: null },
          { number: 5, name: 'Build', status: 'pending', duration: null },
        ],
      }));
      const output = stdoutSpy.mock.calls.map(c => c[0]).join('');
      expect(output).toContain('2 passed');
      expect(output).toContain('1 failed');
    });

    it('shows step duration when available', () => {
      render(makeState());
      const output = stdoutSpy.mock.calls.map(c => c[0]).join('');
      expect(output).toContain('1m 00s');
    });

    it('shows running indicator for active step', () => {
      render(makeState());
      const output = stdoutSpy.mock.calls.map(c => c[0]).join('');
      expect(output).toContain('running');
    });

    it('handles state with no startTime gracefully', () => {
      render(makeState({ startTime: null }));
      const output = stdoutSpy.mock.calls.map(c => c[0]).join('');
      expect(output).toContain('0s');
    });

    it('truncates step list when more than MAX_VISIBLE_STEPS', () => {
      const manySteps = Array.from({ length: 20 }, (_, i) => ({
        number: i + 1,
        name: `Step${i + 1}`,
        status: 'pending',
        duration: null,
      }));
      render(makeState({ steps: manySteps, totalSteps: 20 }));
      const output = stdoutSpy.mock.calls.map(c => c[0]).join('');
      expect(output).toContain('more');
    });

    it('shows Ctrl+C hint when still running', () => {
      render(makeState({ status: 'running' }));
      const output = stdoutSpy.mock.calls.map(c => c[0]).join('');
      expect(output).toContain('Ctrl+C');
    });

    it('hides Ctrl+C hint when completed', () => {
      render(makeState({
        status: 'completed',
        steps: [
          { number: 1, name: 'Lint', status: 'completed', duration: 60000 },
        ],
      }));
      const output = stdoutSpy.mock.calls.map(c => c[0]).join('');
      expect(output).not.toContain('Ctrl+C');
    });

    it('shows Claude output section when currentStepOutput is present and running', () => {
      render(makeState({
        currentStepOutput: 'Reading file src/index.js\nEditing function foo\nDone.',
      }));
      const output = stdoutSpy.mock.calls.map(c => c[0]).join('');
      expect(output).toContain('Claude Code Output');
      expect(output).toContain('Reading file src/index.js');
      expect(output).toContain('Editing function foo');
    });

    it('truncates output to MAX_OUTPUT_LINES showing last lines', () => {
      const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
      render(makeState({
        currentStepOutput: lines.join('\n'),
      }));
      const output = stdoutSpy.mock.calls.map(c => c[0]).join('');
      expect(output).toContain('Claude Code Output');
      // Should show "lines above" indicator
      expect(output).toContain('lines above');
      // Should show the last lines
      expect(output).toContain('line 30');
      expect(output).toContain('line 29');
    });

    it('hides output section when not running', () => {
      render(makeState({
        status: 'completed',
        currentStepOutput: 'some output',
        steps: [
          { number: 1, name: 'Lint', status: 'completed', duration: 60000 },
        ],
      }));
      const output = stdoutSpy.mock.calls.map(c => c[0]).join('');
      expect(output).not.toContain('Claude Code Output');
    });

    it('hides output section when currentStepOutput is absent', () => {
      render(makeState());
      const output = stdoutSpy.mock.calls.map(c => c[0]).join('');
      expect(output).not.toContain('Claude Code Output');
    });
  });
});
