import notifier from 'node-notifier';
import { debug, warn } from './logger.js';

export function notify(title, message) {
  try {
    notifier.notify({
      title,
      message,
      sound: false,
      wait: false,
    });
    debug(`Notification sent: ${title}`);
  } catch (err) {
    warn(`Failed to send notification: ${err.message}`);
  }
}
