import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebhookDispatcher } from '../src/agent/webhook-dispatcher.js';

vi.mock('../src/logger.js', () => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  initLogger: vi.fn(),
}));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('WebhookDispatcher', () => {
  let dispatcher;

  beforeEach(() => {
    vi.useFakeTimers();
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
    dispatcher = new WebhookDispatcher({ machine: 'TestPC', version: '1.0.0' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends webhook to a single endpoint', async () => {
    const endpoints = [{ url: 'https://example.com/hook', label: 'test' }];
    await dispatcher.dispatch('step_completed', {
      project: 'TestApp',
      step: { number: 1, name: 'Docs', status: 'completed' },
    }, endpoints);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('sends to multiple endpoints', async () => {
    const endpoints = [
      { url: 'https://a.com/hook', label: 'a' },
      { url: 'https://b.com/hook', label: 'b' },
    ];
    await dispatcher.dispatch('run_completed', { project: 'TestApp' }, endpoints);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('includes agent metadata in payload', async () => {
    const endpoints = [{ url: 'https://example.com/hook', label: 'test' }];
    await dispatcher.dispatch('run_started', { project: 'X' }, endpoints);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.agent.machine).toBe('TestPC');
    expect(body.event).toBe('run_started');
  });

  it('retries on failure up to 3 times', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    const endpoints = [{ url: 'https://example.com/hook', label: 'test' }];
    const promise = dispatcher.dispatch('run_started', { project: 'X' }, endpoints);
    // Advance through retry delays (1s + 5s)
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(5000);
    await promise;
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('gives up after 3 failed attempts', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    const endpoints = [{ url: 'https://example.com/hook', label: 'test' }];
    const promise = dispatcher.dispatch('run_started', { project: 'X' }, endpoints);
    // Advance through retry delays (1s + 5s)
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(5000);
    await promise;
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('formats Slack-style payload for slack URLs', async () => {
    const endpoints = [{ url: 'https://hooks.slack.com/services/T0/B0/x', label: 'slack' }];
    await dispatcher.dispatch('step_completed', {
      project: 'App',
      step: { number: 5, name: 'Security', status: 'completed', duration: 180000 },
      run: { progress: '5/33', costSoFar: 2.10 },
    }, endpoints);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.blocks).toBeDefined();
  });
});
