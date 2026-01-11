/**
 * WebhookNotifier
 *
 * Sends notifications to generic webhooks.
 */

import {
  type WebhookConfig,
  type Notification,
  type ChannelResult
} from './types.js';

/**
 * WebhookNotifier - Generic webhook integration
 */
export class WebhookNotifier {
  private webhooks: WebhookConfig[];

  constructor(webhooks: WebhookConfig[]) {
    this.webhooks = webhooks.filter(w => w.enabled);
  }

  /**
   * Send notification to all configured webhooks
   */
  async send(notification: Notification): Promise<ChannelResult> {
    if (this.webhooks.length === 0) {
      return {
        channel: 'webhook',
        status: 'skipped',
        error: 'No webhooks configured'
      };
    }

    const results: Array<{ id: string; success: boolean; error?: string }> = [];

    for (const webhook of this.webhooks) {
      // Check if webhook should receive this notification type
      if (webhook.types && !webhook.types.includes(notification.type)) {
        continue;
      }

      try {
        await this.sendToWebhook(webhook, notification);
        results.push({ id: webhook.id, success: true });
      } catch (error) {
        results.push({
          id: webhook.id,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    if (successCount === 0 && failCount > 0) {
      return {
        channel: 'webhook',
        status: 'failed',
        error: `All ${failCount} webhooks failed`,
        response: results
      };
    }

    return {
      channel: 'webhook',
      status: 'sent',
      response: {
        sent: successCount,
        failed: failCount,
        results
      }
    };
  }

  /**
   * Send notification to a specific webhook
   */
  private async sendToWebhook(
    webhook: WebhookConfig,
    notification: Notification
  ): Promise<void> {
    const payload = this.buildPayload(notification);
    const headers = this.buildHeaders(webhook);

    const response = await fetch(webhook.url, {
      method: webhook.method || 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Webhook ${webhook.id} failed: ${response.status} - ${text}`);
    }
  }

  /**
   * Build payload for webhook
   */
  private buildPayload(notification: Notification): Record<string, unknown> {
    return {
      id: notification.id,
      type: notification.type,
      urgency: notification.urgency,
      title: notification.title,
      message: notification.message,
      task: notification.task,
      taskId: notification.taskId,
      summary: notification.summary,
      context: notification.context,
      actions: notification.actions,
      metadata: notification.metadata,
      timestamp: notification.timestamp.toISOString(),
      source: 'codex'
    };
  }

  /**
   * Build headers for webhook request
   */
  private buildHeaders(webhook: WebhookConfig): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...webhook.headers
    };

    // Add authentication headers
    if (webhook.auth) {
      switch (webhook.auth.type) {
        case 'bearer':
          if (webhook.auth.token) {
            headers['Authorization'] = `Bearer ${webhook.auth.token}`;
          }
          break;

        case 'basic':
          if (webhook.auth.username && webhook.auth.password) {
            const credentials = Buffer.from(
              `${webhook.auth.username}:${webhook.auth.password}`
            ).toString('base64');
            headers['Authorization'] = `Basic ${credentials}`;
          }
          break;

        case 'header':
          if (webhook.auth.headerName && webhook.auth.headerValue) {
            headers[webhook.auth.headerName] = webhook.auth.headerValue;
          }
          break;
      }
    }

    return headers;
  }

  /**
   * Add a webhook
   */
  addWebhook(webhook: WebhookConfig): void {
    this.webhooks.push(webhook);
  }

  /**
   * Remove a webhook
   */
  removeWebhook(webhookId: string): boolean {
    const index = this.webhooks.findIndex(w => w.id === webhookId);
    if (index !== -1) {
      this.webhooks.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Get all webhooks
   */
  getWebhooks(): WebhookConfig[] {
    return [...this.webhooks];
  }

  /**
   * Test a specific webhook
   */
  async testWebhook(webhookId: string): Promise<boolean> {
    const webhook = this.webhooks.find(w => w.id === webhookId);
    if (!webhook) {
      return false;
    }

    try {
      await this.sendToWebhook(webhook, {
        id: 'test',
        type: 'info',
        urgency: 'low',
        title: 'Test Notification',
        message: 'This is a test notification from RUBIX.',
        timestamp: new Date()
      });
      return true;
    } catch {
      return false;
    }
  }
}

export default WebhookNotifier;
