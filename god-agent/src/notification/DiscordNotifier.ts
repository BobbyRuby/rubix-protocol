/**
 * DiscordNotifier
 *
 * Sends notifications to Discord via webhook.
 */

import {
  type DiscordConfig,
  type Notification,
  type ChannelResult,
  type DiscordMessage,
  type DiscordEmbed,
  type DiscordField,
  URGENCY_COLORS,
  TYPE_COLORS
} from './types.js';

/**
 * DiscordNotifier - Discord webhook integration
 */
export class DiscordNotifier {
  private config: DiscordConfig;

  constructor(config: DiscordConfig) {
    this.config = config;
  }

  /**
   * Send notification to Discord
   */
  async send(notification: Notification): Promise<ChannelResult> {
    if (!this.config.enabled || !this.config.webhookUrl) {
      return {
        channel: 'discord',
        status: 'skipped',
        error: 'Discord not enabled or webhook URL not configured'
      };
    }

    try {
      const message = this.buildMessage(notification);
      const response = await this.sendWebhook(message);

      return {
        channel: 'discord',
        status: 'sent',
        response
      };
    } catch (error) {
      return {
        channel: 'discord',
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Build Discord message from notification
   */
  private buildMessage(notification: Notification): DiscordMessage {
    const color = TYPE_COLORS[notification.type]?.decimal ||
                  URGENCY_COLORS[notification.urgency].decimal;

    // Build embed
    const embed: DiscordEmbed = {
      title: notification.title,
      description: notification.message,
      color,
      timestamp: notification.timestamp.toISOString(),
      footer: {
        text: `RUBIX | ${notification.type.toUpperCase()}`
      }
    };

    // Add fields
    const fields: DiscordField[] = [];

    if (notification.task) {
      fields.push({
        name: 'Task',
        value: notification.task,
        inline: true
      });
    }

    if (notification.summary && notification.summary !== notification.message) {
      fields.push({
        name: 'Summary',
        value: notification.summary,
        inline: true
      });
    }

    fields.push({
      name: 'Urgency',
      value: notification.urgency.toUpperCase(),
      inline: true
    });

    if (notification.context) {
      fields.push({
        name: 'Context',
        value: notification.context.substring(0, 1024), // Discord field limit
        inline: false
      });
    }

    // Add actions as fields (Discord doesn't support buttons in webhooks)
    if (notification.actions && notification.actions.length > 0) {
      const actionsText = notification.actions
        .map(a => a.url ? `[${a.label}](${a.url})` : a.label)
        .join(' | ');

      fields.push({
        name: 'Actions',
        value: actionsText,
        inline: false
      });
    }

    embed.fields = fields;

    return {
      username: this.config.username || 'RUBIX',
      avatar_url: this.config.avatarUrl,
      embeds: [embed]
    };
  }

  /**
   * Send webhook request
   */
  private async sendWebhook(message: DiscordMessage): Promise<unknown> {
    const response = await fetch(this.config.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(message)
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Discord webhook failed: ${response.status} - ${text}`);
    }

    // Discord returns empty body on success (204)
    if (response.status === 204) {
      return { success: true };
    }

    return response.json().catch(() => ({ success: true }));
  }

  /**
   * Test Discord connection
   */
  async test(): Promise<boolean> {
    try {
      const result = await this.send({
        id: 'test',
        type: 'info',
        urgency: 'low',
        title: 'Test Notification',
        message: 'This is a test notification from RUBIX.',
        timestamp: new Date()
      });
      return result.status === 'sent';
    } catch {
      return false;
    }
  }
}

export default DiscordNotifier;
