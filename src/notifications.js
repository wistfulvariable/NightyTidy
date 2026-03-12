/**
 * @fileoverview Desktop notifications for NightyTidy events.
 *
 * Error contract: Swallows all errors silently. Notifications are fire-and-forget
 * and must never crash a run.
 *
 * @module notifications
 */

import notifier from 'node-notifier';
import { debug, warn } from './logger.js';

/**
 * Send a desktop notification.
 *
 * Non-blocking, fire-and-forget. Errors are logged but never thrown.
 *
 * @param {string} title - Notification title
 * @param {string} message - Notification body
 */
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
