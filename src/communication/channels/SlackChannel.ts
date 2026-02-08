/**
 * SlackChannel - Slack escalation with interactive message buttons
 */

import { BaseChannel } from './BaseChannel.js';
import type {
  ChannelType,
  SlackChannelConfig,
  EscalationRequest,
  EscalationResponse
} from '../types.js';

export class SlackChannel extends BaseChannel {
  readonly type: ChannelType = 'slack';
  private config: SlackChannelConfig;

  constructor(config: SlackChannelConfig) {
    super();
    this.config = config;
  }

  get isConfigured(): boolean {
    return this.config.enabled && !!this.config.webhookUrl;
  }

  canReceiveResponses(): boolean {
    return !!this.config.botToken;
  }

  async send(request: EscalationRequest): Promise<boolean> {
    if (!this.isConfigured) return false;

    try {
      const message = this.buildSlackMessage(request);

      const response = await fetch(this.config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message)
      });

      if (!response.ok) {
        console.error('[SlackChannel] Webhook error:', await response.text());
        return false;
      }

      console.log(`[SlackChannel] Message sent`);
      return true;
    } catch (error) {
      console.error('[SlackChannel] Send failed:', error);
      return false;
    }
  }

  private buildSlackMessage(request: EscalationRequest): object {
    const urgencyEmoji = request.urgency === 'critical' ? ':rotating_light:' :
                         request.urgency === 'high' ? ':warning:' : ':information_source:';

    const blocks: unknown[] = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${urgencyEmoji} [RUBIX] ${request.title}`,
          emoji: true
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: request.message.slice(0, 3000)
        }
      },
      {
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text: `*Task:* ${request.taskId.slice(0, 8)} | *Type:* ${request.type} | *Ref:* ${this.getShortRef(request.id)}`
        }]
      }
    ];

    // Add option buttons if provided
    if (request.options?.length) {
      blocks.push({
        type: 'actions',
        block_id: `response_${request.id}`,
        elements: request.options.slice(0, 5).map((opt, i) => ({
          type: 'button',
          text: { type: 'plain_text', text: opt.label.slice(0, 75) },
          value: JSON.stringify({ requestId: request.id, option: opt.value }),
          action_id: `codex_respond_${i}`
        }))
      });
    }

    // Add text input for free-form response
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '*Or reply in thread with your response*' }
    });

    return {
      text: `[RUBIX] ${request.title}`,
      blocks,
      unfurl_links: false,
      unfurl_media: false
    };
  }

  protected async parseResponse(payload: unknown): Promise<EscalationResponse | null> {
    const data = payload as {
      type?: string;
      actions?: Array<{ action_id: string; value: string }>;
      message?: { text?: string; thread_ts?: string };
      event?: { text?: string; thread_ts?: string };
    };

    // Handle button click (block_actions)
    if (data.type === 'block_actions' && data.actions?.[0]) {
      try {
        const value = JSON.parse(data.actions[0].value);
        return {
          requestId: value.requestId,
          channel: 'slack',
          response: value.option,
          selectedOption: value.option,
          receivedAt: new Date(),
          rawPayload: payload
        };
      } catch {
        // Not our button format
      }
    }

    // Handle thread reply
    if (data.event?.text) {
      const text = data.event.text;
      // Extract ref from message if present
      const refMatch = text.match(/\[REF:([a-f0-9]+)\]/i);
      const requestId = this.findRequestByRef(refMatch?.[1]);

      if (requestId || this.pendingRequests.size > 0) {
        return {
          requestId: requestId || Array.from(this.pendingRequests.keys()).slice(-1)[0],
          channel: 'slack',
          response: text.replace(/\[REF:[a-f0-9]+\]/gi, '').trim(),
          receivedAt: new Date(),
          rawPayload: payload
        };
      }
    }

    return null;
  }

  async test(): Promise<boolean> {
    if (!this.isConfigured) return false;

    try {
      // Test webhook with a minimal message
      const response = await fetch(this.config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'RUBIX connection test' })
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

export default SlackChannel;
