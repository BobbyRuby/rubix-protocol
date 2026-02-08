/**
 * DiscordChannel - Discord escalation with rich embeds
 */

import { BaseChannel } from './BaseChannel.js';
import type {
  ChannelType,
  DiscordChannelConfig,
  EscalationRequest,
  EscalationResponse
} from '../types.js';

export class DiscordChannel extends BaseChannel {
  readonly type: ChannelType = 'discord';
  private config: DiscordChannelConfig;

  constructor(config: DiscordChannelConfig) {
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
      const message = this.buildDiscordMessage(request);

      const response = await fetch(this.config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message)
      });

      if (!response.ok) {
        console.error('[DiscordChannel] Webhook error:', await response.text());
        return false;
      }

      console.log(`[DiscordChannel] Message sent`);
      return true;
    } catch (error) {
      console.error('[DiscordChannel] Send failed:', error);
      return false;
    }
  }

  private buildDiscordMessage(request: EscalationRequest): object {
    const color = request.urgency === 'critical' ? 0xFF0000 :
                  request.urgency === 'high' ? 0xFFA500 : 0x0099FF;

    const embed: {
      title: string;
      description: string;
      color: number;
      fields: Array<{ name: string; value: string; inline: boolean }>;
      footer: { text: string };
      timestamp: string;
    } = {
      title: `[RUBIX] ${request.title}`,
      description: request.message.slice(0, 4096),
      color,
      fields: [
        { name: 'Type', value: request.type, inline: true },
        { name: 'Urgency', value: request.urgency, inline: true },
        { name: 'Reference', value: this.getShortRef(request.id), inline: true }
      ],
      footer: { text: `Task: ${request.taskId.slice(0, 8)}` },
      timestamp: request.createdAt.toISOString()
    };

    // Add options as fields
    if (request.options?.length) {
      embed.fields.push({
        name: 'Options',
        value: request.options.map((o, i) => `${i + 1}. **${o.label}**: ${o.value}`).join('\n'),
        inline: false
      });
    }

    return {
      content: `**RUBIX needs your input** - Reply to this message with your response`,
      embeds: [embed],
      allowed_mentions: { parse: [] }
    };
  }

  protected async parseResponse(payload: unknown): Promise<EscalationResponse | null> {
    const data = payload as {
      content?: string;
      author?: { bot?: boolean };
      reference?: { message_id?: string };
    };

    // Ignore bot messages
    if (data.author?.bot) return null;

    const text = data.content;
    if (!text) return null;

    // Extract ref from message if present
    const refMatch = text.match(/\[REF:([a-f0-9]+)\]/i);
    const requestId = this.findRequestByRef(refMatch?.[1]);

    if (requestId || this.pendingRequests.size > 0) {
      return {
        requestId: requestId || Array.from(this.pendingRequests.keys()).slice(-1)[0],
        channel: 'discord',
        response: text.replace(/\[REF:[a-f0-9]+\]/gi, '').trim(),
        receivedAt: new Date(),
        rawPayload: payload
      };
    }

    return null;
  }

  async test(): Promise<boolean> {
    if (!this.isConfigured) return false;

    try {
      const response = await fetch(this.config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'RUBIX connection test' })
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

export default DiscordChannel;
