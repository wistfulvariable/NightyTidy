import { debug, warn } from '../logger.js';

const RETRY_DELAYS = [1000, 5000, 15000];

export class WebhookDispatcher {
  constructor(agentInfo) {
    this.agentInfo = agentInfo; // { machine, version }
  }

  async dispatch(event, data, endpoints) {
    const promises = endpoints.map(ep => this._sendWithRetry(ep, event, data));
    await Promise.allSettled(promises);
  }

  async _sendWithRetry(endpoint, event, data) {
    const isSlack = endpoint.url.includes('hooks.slack.com');
    const isDiscord = endpoint.url.includes('discord.com/api/webhooks');
    const payload = isSlack
      ? this._formatSlack(event, data)
      : isDiscord
        ? this._formatDiscord(event, data)
        : this._formatGeneric(event, data);

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(endpoint.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(endpoint.headers || {}) },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          debug(`Webhook sent to ${endpoint.label}: ${event}`);
          return;
        }
        warn(`Webhook ${endpoint.label} returned ${res.status}, attempt ${attempt + 1}/3`);
      } catch (err) {
        warn(`Webhook ${endpoint.label} error: ${err.message}, attempt ${attempt + 1}/3`);
      }
      if (attempt < 2) {
        await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
      }
    }
    warn(`Webhook ${endpoint.label} failed after 3 attempts`);
  }

  _formatGeneric(event, data) {
    return {
      event,
      ...data,
      agent: this.agentInfo,
    };
  }

  _formatSlack(event, data) {
    const emoji = event.includes('completed') ? ':white_check_mark:'
      : event.includes('failed') ? ':x:'
      : event.includes('started') ? ':rocket:'
      : ':information_source:';

    const step = data.step;
    const run = data.run;
    let text = `${emoji} *${data.project}*`;
    if (step) {
      text += ` — Step ${step.number} "${step.name}" ${step.status}`;
    } else {
      text += ` — ${event.replace(/_/g, ' ')}`;
    }
    if (run) {
      text += `\nProgress: ${run.progress} · $${run.costSoFar?.toFixed(2) || '0.00'} total`;
    }
    return {
      blocks: [{
        type: 'section',
        text: { type: 'mrkdwn', text },
      }],
    };
  }

  _formatDiscord(event, data) {
    const step = data.step;
    const description = step
      ? `Step ${step.number} "${step.name}" ${step.status}`
      : event.replace(/_/g, ' ');
    return {
      embeds: [{
        title: `${data.project} — ${description}`,
        color: event.includes('completed') ? 0x22c55e
          : event.includes('failed') ? 0xef4444
          : 0x3b82f6,
      }],
    };
  }
}
