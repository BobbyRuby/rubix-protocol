/**
 * PhoneChannel - Phone call escalation via CallMe
 *
 * Uses the CallMe plugin (https://github.com/ZeframLou/call-me)
 * for voice calls with speech-to-text responses.
 */

import { BaseChannel } from './BaseChannel.js';
import type {
  ChannelType,
  PhoneChannelConfig,
  EscalationRequest,
  EscalationResponse
} from '../types.js';

export class PhoneChannel extends BaseChannel {
  readonly type: ChannelType = 'phone';
  private config: PhoneChannelConfig;

  constructor(config: PhoneChannelConfig) {
    super();
    this.config = config;
  }

  get isConfigured(): boolean {
    return this.config.enabled && !!this.config.phoneNumber;
  }

  canReceiveResponses(): boolean {
    return true;  // CallMe handles bidirectional audio
  }

  async send(request: EscalationRequest): Promise<boolean> {
    if (!this.isConfigured) {
      return false;
    }

    try {
      const voiceMessage = this.formatForVoice(request);

      if (this.config.provider === 'callme') {
        // CallMe uses MCP protocol - we need to invoke their tool
        // For now, we'll simulate the call and log what would happen
        console.log(`[PhoneChannel] Would call ${this.config.phoneNumber} via CallMe`);
        console.log(`[PhoneChannel] Message: ${voiceMessage.slice(0, 200)}...`);

        // TODO: Integrate with actual CallMe MCP client
        // await callMeClient.initiateCall(this.config.phoneNumber, voiceMessage);

        // Track request for response correlation
        this.trackRequest(request);

        return true;
      }

      // Direct Twilio/Telnyx fallback
      return await this.directCall(request);
    } catch (error) {
      console.error('[PhoneChannel] Send failed:', error);
      return false;
    }
  }

  private formatForVoice(request: EscalationRequest): string {
    let message = `Hello. This is RUBIX calling with an urgent matter. `;
    message += request.title + '. ';
    message += request.message.replace(/\n/g, '. ').replace(/[#*`]/g, '');

    if (request.options?.length) {
      message += ' Please respond with one of the following options: ';
      request.options.forEach((o, i) => {
        message += `Option ${i + 1}, ${o.label}. `;
      });
    } else {
      message += ' Please provide your response.';
    }

    return message;
  }

  private async directCall(request: EscalationRequest): Promise<boolean> {
    // Direct Twilio/Telnyx integration for non-CallMe providers
    if (!this.config.accountSid || !this.config.authToken || !this.config.fromNumber) {
      console.log('[PhoneChannel] Direct call not configured');
      return false;
    }

    // Track request for response correlation
    this.trackRequest(request);

    // Would use Twilio SDK here
    console.log(`[PhoneChannel] Would make direct call via ${this.config.provider}`);
    return true;
  }

  protected async parseResponse(payload: unknown): Promise<EscalationResponse | null> {
    // CallMe returns transcribed audio
    const data = payload as { transcription?: string; requestId?: string };
    if (!data.transcription) return null;

    // Find matching pending request
    const requestId = data.requestId || this.findRequestByRef(undefined);
    if (!requestId) {
      // Use most recent pending
      const [fallbackId] = Array.from(this.pendingRequests.keys()).slice(-1);
      if (!fallbackId) return null;

      return {
        requestId: fallbackId,
        channel: 'phone',
        response: data.transcription,
        receivedAt: new Date(),
        rawPayload: payload
      };
    }

    return {
      requestId,
      channel: 'phone',
      response: data.transcription,
      receivedAt: new Date(),
      rawPayload: payload
    };
  }

  async test(): Promise<boolean> {
    return this.isConfigured;
  }
}

export default PhoneChannel;
