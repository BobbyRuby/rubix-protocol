/**
 * SMSChannel - SMS escalation via Twilio or Telnyx
 */

import { BaseChannel } from './BaseChannel.js';
import type {
  ChannelType,
  SMSChannelConfig,
  EscalationRequest,
  EscalationResponse
} from '../types.js';

export class SMSChannel extends BaseChannel {
  readonly type: ChannelType = 'sms';
  private config: SMSChannelConfig;

  constructor(config: SMSChannelConfig) {
    super();
    this.config = config;
  }

  get isConfigured(): boolean {
    return this.config.enabled &&
           !!this.config.phoneNumber &&
           !!this.config.accountSid &&
           !!this.config.authToken &&
           !!this.config.fromNumber;
  }

  canReceiveResponses(): boolean {
    return true;  // Via webhook
  }

  async send(request: EscalationRequest): Promise<boolean> {
    if (!this.isConfigured) {
      return false;
    }

    try {
      const smsBody = this.formatForSMS(request);

      // Track request for response correlation
      this.trackRequest(request);

      if (this.config.provider === 'twilio') {
        return await this.sendViaTwilio(smsBody);
      } else {
        return await this.sendViaTelnyx(smsBody);
      }
    } catch (error) {
      console.error('[SMSChannel] Send failed:', error);
      return false;
    }
  }

  private formatForSMS(request: EscalationRequest): string {
    let message = `[CODEX] ${request.title}\n\n${request.message}`;

    if (request.options?.length) {
      message += '\n\nReply with:';
      request.options.forEach((o, i) => {
        message += `\n${i + 1} = ${o.label}`;
      });
    }

    // Add reference ID for response matching
    message += `\n\n[REF:${this.getShortRef(request.id)}]`;

    // SMS limit is typically 1600 chars for concatenated
    return message.slice(0, 1600);
  }

  private async sendViaTwilio(body: string): Promise<boolean> {
    // Twilio REST API
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.config.accountSid}/Messages.json`;

    const auth = Buffer.from(`${this.config.accountSid}:${this.config.authToken}`).toString('base64');

    const params = new URLSearchParams({
      To: this.config.phoneNumber,
      From: this.config.fromNumber,
      Body: body
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[SMSChannel] Twilio error:', error);
      return false;
    }

    console.log(`[SMSChannel] SMS sent to ${this.config.phoneNumber}`);
    return true;
  }

  private async sendViaTelnyx(body: string): Promise<boolean> {
    // Telnyx REST API
    const url = 'https://api.telnyx.com/v2/messages';

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.authToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: this.config.fromNumber,
        to: this.config.phoneNumber,
        text: body
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[SMSChannel] Telnyx error:', error);
      return false;
    }

    console.log(`[SMSChannel] SMS sent to ${this.config.phoneNumber}`);
    return true;
  }

  protected async parseResponse(payload: unknown): Promise<EscalationResponse | null> {
    // Twilio/Telnyx webhook payload
    const data = payload as { From?: string; Body?: string; from?: string; text?: string };
    const body = data.Body || data.text;

    if (!body) return null;

    // Extract reference ID from response
    const refMatch = body.match(/\[REF:([a-f0-9]+)\]/i);
    let requestId = this.findRequestByRef(refMatch?.[1]);

    if (!requestId) {
      // Use most recent pending request
      const [fallbackId] = Array.from(this.pendingRequests.keys()).slice(-1);
      if (!fallbackId) return null;
      requestId = fallbackId;
    }

    // Clean up the response (remove reference ID)
    const cleanResponse = body.replace(/\[REF:[a-f0-9]+\]/gi, '').trim();

    return {
      requestId,
      channel: 'sms',
      response: cleanResponse,
      receivedAt: new Date(),
      rawPayload: payload
    };
  }

  async test(): Promise<boolean> {
    if (!this.isConfigured) return false;

    // Test by verifying credentials
    if (this.config.provider === 'twilio') {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${this.config.accountSid}.json`;
      const auth = Buffer.from(`${this.config.accountSid}:${this.config.authToken}`).toString('base64');

      try {
        const response = await fetch(url, {
          headers: { 'Authorization': `Basic ${auth}` }
        });
        return response.ok;
      } catch {
        return false;
      }
    }

    // Telnyx test
    try {
      const response = await fetch('https://api.telnyx.com/v2/messaging_profiles', {
        headers: { 'Authorization': `Bearer ${this.config.authToken}` }
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

export default SMSChannel;
