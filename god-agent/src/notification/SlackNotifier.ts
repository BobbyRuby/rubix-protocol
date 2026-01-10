/**
 * SlackNotifier
 *
 * Sends notifications to Slack via webhook.
 */

import {
  type SlackConfig,
  type Notification,
  type ChannelResult,
  type SlackMessage,
  type SlackAttachment,
  type SlackBlock,
  type SlackBlockElement,
  URGENCY_COLORS,
  TYPE_COLORS,
  TYPE_EMOJIS
} from './types.js';

/**
 * SlackNotifier - Slack webhook integration
 */
export class SlackNotifier {
  private config: SlackConfig;

  constructor(config: SlackConfig) {
    this.config = config;
  }

  /**
   * Send notification to Slack
   */
  async send(notification: Notification): Promise<ChannelResult> {
    if (!this.config.enabled || !this.config.webhookUrl) {
      return {
        channel: 'slack',
        status: 'skipped',
        error: 'Slack not enabled or webhook URL not configured'
      };
    }

    try {
      const message = this.buildMessage(notification);
      const response = await this.sendWebhook(message);

      return {
        channel: 'slack',
        status: 'sent',
        response
      };
    } catch (error) {
      return {
        channel: 'slack',
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Build Slack message from notification
   */
  private buildMessage(notification: Notification): SlackMessage {
    const emoji = TYPE_EMOJIS[notification.type] || ':bell:';
    const color = TYPE_COLORS[notification.type]?.hex || URGENCY_COLORS[notification.urgency].hex;

    // Build blocks for rich formatting
    const blocks: SlackBlock[] = [];

    // Header block
    blocks.push({
      type: 'header',
      text: {
        type: 'plain_text',
        text: `${notification.title}`,
        emoji: true
      }
    });

    // Main content section
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: notification.message
      }
    });

    // Context section with metadata
    const contextFields: Array<{ type: 'mrkdwn'; text: string }> = [];

    if (notification.task) {
      contextFields.push({
        type: 'mrkdwn',
        text: `*Task:* ${notification.task}`
      });
    }

    if (notification.summary && notification.summary !== notification.message) {
      contextFields.push({
        type: 'mrkdwn',
        text: `*Summary:* ${notification.summary}`
      });
    }

    contextFields.push({
      type: 'mrkdwn',
      text: `*Urgency:* ${notification.urgency.toUpperCase()}`
    });

    if (contextFields.length > 0) {
      blocks.push({
        type: 'section',
        fields: contextFields
      });
    }

    // Context block (additional details)
    if (notification.context) {
      blocks.push({
        type: 'context',
        elements: [{
          type: 'mrkdwn' as const,
          text: notification.context
        }] as unknown as SlackBlockElement[]
      });
    }

    // Actions block
    if (notification.actions && notification.actions.length > 0) {
      const actionElements: SlackBlockElement[] = notification.actions
        .slice(0, 5) // Slack limits to 5 buttons
        .map((action, index) => ({
          type: 'button' as const,
          text: {
            type: 'plain_text' as const,
            text: action.label,
            emoji: true
          },
          url: action.url,
          action_id: action.id || `action_${index}`,
          style: action.style === 'danger' ? 'danger' as const :
                 action.style === 'primary' ? 'primary' as const : undefined
        }));

      blocks.push({
        type: 'actions',
        elements: actionElements
      });
    }

    // Divider
    blocks.push({ type: 'divider' });

    // Fallback attachment for older Slack clients
    const attachment: SlackAttachment = {
      color,
      title: notification.title,
      text: notification.message,
      footer: `CODEX | ${notification.type}`,
      ts: Math.floor(notification.timestamp.getTime() / 1000)
    };

    if (notification.task || notification.summary) {
      attachment.fields = [];
      if (notification.task) {
        attachment.fields.push({
          title: 'Task',
          value: notification.task,
          short: true
        });
      }
      if (notification.summary) {
        attachment.fields.push({
          title: 'Summary',
          value: notification.summary,
          short: true
        });
      }
    }

    return {
      text: `${emoji} ${notification.title}: ${notification.message}`,
      channel: this.config.channel,
      username: this.config.username || 'CODEX',
      icon_emoji: this.config.iconEmoji || ':robot_face:',
      blocks,
      attachments: [attachment]
    };
  }

  /**
   * Send webhook request
   */
  private async sendWebhook(message: SlackMessage): Promise<unknown> {
    const response = await fetch(this.config.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(message)
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Slack webhook failed: ${response.status} - ${text}`);
    }

    return response.text();
  }

  /**
   * Test Slack connection
   */
  async test(): Promise<boolean> {
    try {
      const result = await this.send({
        id: 'test',
        type: 'info',
        urgency: 'low',
        title: 'Test Notification',
        message: 'This is a test notification from CODEX.',
        timestamp: new Date()
      });
      return result.status === 'sent';
    } catch {
      return false;
    }
  }
}

export default SlackNotifier;
