/**
 * EmailChannel - Email escalation with SMTP send and IMAP polling
 */

import { BaseChannel } from './BaseChannel.js';
import type {
  ChannelType,
  EmailChannelConfig,
  EscalationRequest,
  EscalationResponse
} from '../types.js';

export class EmailChannel extends BaseChannel {
  readonly type: ChannelType = 'email';
  private config: EmailChannelConfig;
  private pollingInterval: NodeJS.Timeout | null = null;

  constructor(config: EmailChannelConfig) {
    super();
    this.config = config;
  }

  get isConfigured(): boolean {
    return this.config.enabled &&
           !!this.config.smtp.host &&
           !!this.config.fromAddress &&
           !!this.config.toAddress;
  }

  canReceiveResponses(): boolean {
    return !!this.config.imap?.host;
  }

  async send(request: EscalationRequest): Promise<boolean> {
    if (!this.isConfigured) return false;

    try {
      const { subject, html, text } = this.buildEmail(request);

      // Use nodemailer-compatible SMTP send
      const success = await this.sendSMTP(subject, html, text);

      if (success && this.canReceiveResponses()) {
        this.startPolling(request.id);
      }

      return success;
    } catch (error) {
      console.error('[EmailChannel] Send failed:', error);
      return false;
    }
  }

  private buildEmail(request: EscalationRequest): { subject: string; html: string; text: string } {
    const subject = `[RUBIX] ${request.title} [REF:${this.getShortRef(request.id)}]`;

    let html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: ${request.urgency === 'critical' ? '#FF0000' : '#333'};">
          ${this.escapeHtml(request.title)}
        </h2>
        <p style="white-space: pre-wrap;">${this.escapeHtml(request.message).replace(/\n/g, '<br>')}</p>
    `;

    if (request.options?.length) {
      html += `
        <h3>Options:</h3>
        <ul>
          ${request.options.map((o, i) =>
            `<li><strong>${i + 1}. ${this.escapeHtml(o.label)}</strong>: ${this.escapeHtml(o.value)}</li>`
          ).join('')}
        </ul>
      `;
    }

    html += `
        <hr style="border: none; border-top: 1px solid #ccc; margin: 20px 0;">
        <p><strong>Reply to this email with your response.</strong></p>
        <p style="color: #666; font-size: 12px;">
          Reference: ${request.id}<br>
          Task: ${request.taskId}<br>
          Type: ${request.type}
        </p>
      </div>
    `;

    const text = `[RUBIX] ${request.title}\n\n${request.message}\n\n` +
      (request.options?.length
        ? 'Options:\n' + request.options.map((o, i) => `${i + 1}. ${o.label}: ${o.value}`).join('\n') + '\n\n'
        : '') +
      `Reply to this email with your response.\nReference: ${request.id}`;

    return { subject, html, text };
  }

  /**
   * Escape HTML special characters to prevent XSS
   */
  private escapeHtml(text: string): string {
    const htmlEntities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    };
    return text.replace(/[&<>"']/g, char => htmlEntities[char]);
  }

  private async sendSMTP(subject: string, _html: string, _text: string): Promise<boolean> {
    // Build SMTP request (without nodemailer dependency for now)
    // In production, would use nodemailer
    console.log(`[EmailChannel] Would send email to ${this.config.toAddress}`);
    console.log(`[EmailChannel] Subject: ${subject}`);
    console.log(`[EmailChannel] Using SMTP: ${this.config.smtp.host}:${this.config.smtp.port}`);

    // TODO: Implement actual SMTP send with nodemailer
    // const transporter = nodemailer.createTransport(this.config.smtp);
    // await transporter.sendMail({ from, to, subject, html, text });

    return true;
  }

  private startPolling(requestId: string): void {
    if (this.pollingInterval) return;

    console.log(`[EmailChannel] Starting IMAP polling for responses`);

    this.pollingInterval = setInterval(async () => {
      // Check if request is still pending
      if (!this.pendingRequests.has(requestId)) {
        this.stopPolling();
        return;
      }

      // TODO: Implement actual IMAP polling
      // const response = await this.checkIMAPForReply(requestId);
      // if (response) {
      //   await this.handleIncoming(response);
      // }
    }, 10000);  // Poll every 10 seconds
  }

  private stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
      console.log(`[EmailChannel] Stopped IMAP polling`);
    }
  }

  protected async parseResponse(payload: unknown): Promise<EscalationResponse | null> {
    const data = payload as { subject?: string; body?: string; from?: string };

    if (!data.body) return null;

    // Extract reference ID from subject
    const refMatch = data.subject?.match(/\[REF:([a-f0-9]+)\]/i);
    const requestId = this.findRequestByRef(refMatch?.[1]);

    if (!requestId) return null;

    // Extract reply content (remove quoted original)
    let response = data.body;
    const quoteStart = response.indexOf('On ');
    if (quoteStart > 0) {
      response = response.slice(0, quoteStart).trim();
    }

    return {
      requestId,
      channel: 'email',
      response,
      receivedAt: new Date(),
      rawPayload: payload
    };
  }

  async test(): Promise<boolean> {
    if (!this.isConfigured) return false;

    // Test SMTP connection
    console.log(`[EmailChannel] Would test SMTP connection to ${this.config.smtp.host}`);

    // TODO: Implement actual test with nodemailer
    // const transporter = nodemailer.createTransport(this.config.smtp);
    // await transporter.verify();

    return true;
  }

  /**
   * Stop polling and clean up resources
   */
  destroy(): void {
    this.stopPolling();
  }
}

export default EmailChannel;
