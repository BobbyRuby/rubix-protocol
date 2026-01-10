/**
 * Communication Layer Types
 *
 * Multi-channel escalation system with fallback chain.
 */

import { randomUUID } from 'crypto';

// Channel types
export type ChannelType = 'phone' | 'sms' | 'slack' | 'discord' | 'email';
export type ChannelStatus = 'idle' | 'sending' | 'waiting' | 'timeout' | 'responded' | 'error';

// Phone channel config
export interface PhoneChannelConfig {
  enabled: boolean;
  provider: 'callme' | 'twilio' | 'telnyx';
  phoneNumber: string;
  // CallMe specific
  callMe?: {
    pluginPath?: string;
    openaiApiKey?: string;
  };
  // Direct provider config
  accountSid?: string;
  authToken?: string;
  fromNumber?: string;
}

// SMS channel config
export interface SMSChannelConfig {
  enabled: boolean;
  provider: 'twilio' | 'telnyx';
  phoneNumber: string;
  accountSid: string;
  authToken: string;
  fromNumber: string;
}

// Slack channel config
export interface SlackChannelConfig {
  enabled: boolean;
  webhookUrl: string;
  botToken?: string;
  appId?: string;
  signingSecret?: string;
  responseChannel?: string;
}

// Discord channel config
export interface DiscordChannelConfig {
  enabled: boolean;
  webhookUrl: string;
  botToken?: string;
  responseChannelId?: string;
}

// Email channel config
export interface EmailChannelConfig {
  enabled: boolean;
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    auth: { user: string; pass: string };
  };
  imap: {
    host: string;
    port: number;
    auth: { user: string; pass: string };
  };
  fromAddress: string;
  toAddress: string;
  replySubjectPattern?: string;
}

// Webhook server config
export interface WebhookServerConfig {
  port: number;
  publicUrl?: string;
}

// Main communication config
export interface CommunicationConfig {
  enabled: boolean;
  fallbackOrder: ChannelType[];
  timeoutMs: number;  // Default 300000 (5 min)
  retryAttempts: number;

  phone?: PhoneChannelConfig;
  sms?: SMSChannelConfig;
  slack?: SlackChannelConfig;
  discord?: DiscordChannelConfig;
  email?: EmailChannelConfig;

  webhookServer: WebhookServerConfig;
}

// Escalation request
export interface EscalationRequest {
  id: string;
  escalationId: string;
  taskId: string;
  type: 'clarification' | 'decision' | 'blocked' | 'approval';
  urgency: 'normal' | 'high' | 'critical';
  title: string;
  message: string;
  context?: string;
  options?: Array<{ label: string; value: string }>;
  timeout: number;
  createdAt: Date;
}

// Escalation response
export interface EscalationResponse {
  requestId: string;
  channel: ChannelType;
  response: string;
  selectedOption?: string;
  receivedAt: Date;
  rawPayload?: unknown;
}

// Channel interface
export interface IChannel {
  readonly type: ChannelType;
  readonly isConfigured: boolean;

  sendAndWait(request: EscalationRequest): Promise<EscalationResponse | null>;
  send(request: EscalationRequest): Promise<boolean>;
  canReceiveResponses(): boolean;
  handleIncomingResponse(payload: unknown): Promise<void>;
  getStatus(): ChannelStatus;
  test(): Promise<boolean>;
}

// Default config
export const DEFAULT_COMMUNICATION_CONFIG: CommunicationConfig = {
  enabled: false,
  fallbackOrder: ['phone', 'sms', 'slack', 'discord', 'email'],
  timeoutMs: 300000,  // 5 minutes
  retryAttempts: 1,
  webhookServer: {
    port: 3456
  }
};

// Helper to create escalation request
export function createEscalationRequest(
  escalationId: string,
  taskId: string,
  type: EscalationRequest['type'],
  title: string,
  message: string,
  options?: EscalationRequest['options'],
  timeout: number = 300000
): EscalationRequest {
  return {
    id: randomUUID(),
    escalationId,
    taskId,
    type,
    urgency: type === 'blocked' ? 'critical' : 'high',
    title,
    message,
    options,
    timeout,
    createdAt: new Date()
  };
}
