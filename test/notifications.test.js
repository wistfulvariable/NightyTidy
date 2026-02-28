import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node-notifier', () => ({
  default: {
    notify: vi.fn(),
  },
}));

vi.mock('../src/logger.js', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

import notifier from 'node-notifier';
import { notify } from '../src/notifications.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('notify', () => {
  it('calls notifier.notify with the given title and message', () => {
    notify('Test Title', 'Test Message');

    expect(notifier.notify).toHaveBeenCalledTimes(1);
    expect(notifier.notify).toHaveBeenCalledWith({
      title: 'Test Title',
      message: 'Test Message',
      sound: false,
      wait: false,
    });
  });

  it('does not throw when the notifier throws an error', () => {
    notifier.notify.mockImplementation(() => {
      throw new Error('Notification system unavailable');
    });

    expect(() => notify('Title', 'Message')).not.toThrow();
  });
});
