/**
 * CommunicationManager
 *
 * Orchestrates multi-channel escalation with fallback chain.
 * Phone → SMS → Slack → Discord → Email
 * Each channel has a configurable timeout (default 5 min).
 */

import { randomUUID } from 'crypto';
import type {
  CommunicationConfig,
  ChannelType,
  EscalationRequest,
  EscalationResponse,
  IChannel
} from './types.js';
import { PhoneChannel } from './channels/PhoneChannel.js';
import { SMSChannel } from './channels/SMSChannel.js';
import { SlackChannel } from './channels/SlackChannel.js';
import { DiscordChannel } from './channels/DiscordChannel.js';
import { EmailChannel } from './channels/EmailChannel.js';
import { TelegramChannel } from './channels/TelegramChannel.js';

// Import Escalation type from codex if available
interface Escalation {
  id: string;
  taskId: string;
  type: 'clarification' | 'decision' | 'blocked' | 'approval';
  title: string;
  context: string;
  questions?: string[];
  options?: Array<{ label: string; description: string }>;
  errors?: string[];
  blocking?: boolean;
}

export class CommunicationManager {
  private config: CommunicationConfig;
  private channels: Map<ChannelType, IChannel> = new Map();
  private isInitialized: boolean = false;

  constructor(config: Partial<CommunicationConfig> = {}) {
    this.config = {
      enabled: config.enabled ?? false,
      fallbackOrder: config.fallbackOrder ?? ['telegram', 'phone', 'sms', 'slack', 'discord', 'email'],
      timeoutMs: config.timeoutMs ?? 300000,
      retryAttempts: config.retryAttempts ?? 1,
      webhookServer: config.webhookServer ?? { port: 3456 },
      phone: config.phone,
      sms: config.sms,
      slack: config.slack,
      discord: config.discord,
      email: config.email,
      telegram: config.telegram
    };
  }

  /**
   * Initialize all configured channels
   */
  initialize(): void {
    if (this.isInitialized) return;

    // Initialize each channel if configured
    if (this.config.phone?.enabled) {
      this.channels.set('phone', new PhoneChannel(this.config.phone));
      console.log('[CommunicationManager] Phone channel initialized');
    }

    if (this.config.sms?.enabled) {
      this.channels.set('sms', new SMSChannel(this.config.sms));
      console.log('[CommunicationManager] SMS channel initialized');
    }

    if (this.config.slack?.enabled) {
      this.channels.set('slack', new SlackChannel(this.config.slack));
      console.log('[CommunicationManager] Slack channel initialized');
    }

    if (this.config.discord?.enabled) {
      this.channels.set('discord', new DiscordChannel(this.config.discord));
      console.log('[CommunicationManager] Discord channel initialized');
    }

    if (this.config.email?.enabled) {
      this.channels.set('email', new EmailChannel(this.config.email));
      console.log('[CommunicationManager] Email channel initialized');
    }

    if (this.config.telegram?.enabled) {
      const telegramChannel = new TelegramChannel(this.config.telegram);
      this.channels.set('telegram', telegramChannel);
      // Start polling for responses
      telegramChannel.startPolling();
      console.log('[CommunicationManager] Telegram channel initialized');
    }

    this.isInitialized = true;
    console.log(`[CommunicationManager] Initialized with ${this.channels.size} channels`);
    console.log(`[CommunicationManager] Fallback order: ${this.config.fallbackOrder.join(' → ')}`);
  }

  /**
   * Main escalation method - tries each channel in fallback order
   * Blocks until response received or all channels exhausted
   */
  async escalate(escalation: Escalation): Promise<EscalationResponse | null> {
    if (!this.config.enabled) {
      console.log('[CommunicationManager] Communications disabled, skipping escalation');
      return null;
    }

    if (!this.isInitialized) {
      this.initialize();
    }

    // Build escalation request
    const request: EscalationRequest = {
      id: randomUUID(),
      escalationId: escalation.id,
      taskId: escalation.taskId,
      type: escalation.type,
      urgency: escalation.blocking ? 'critical' : 'high',
      title: escalation.title,
      message: this.formatEscalationMessage(escalation),
      context: escalation.context,
      options: escalation.options?.map(o => ({
        label: o.label,
        value: o.description
      })),
      timeout: this.config.timeoutMs,
      createdAt: new Date()
    };

    console.log(`[CommunicationManager] Starting escalation ${request.id.slice(0,8)}`);
    console.log(`[CommunicationManager] Title: ${request.title}`);
    console.log(`[CommunicationManager] Timeout per channel: ${this.config.timeoutMs / 1000}s`);

    // Try each channel in fallback order
    for (const channelType of this.config.fallbackOrder) {
      const channel = this.channels.get(channelType);

      if (!channel) {
        console.log(`[CommunicationManager] ${channelType} not configured, skipping`);
        continue;
      }

      if (!channel.isConfigured) {
        console.log(`[CommunicationManager] ${channelType} not properly configured, skipping`);
        continue;
      }

      console.log(`[CommunicationManager] Trying ${channelType}...`);

      try {
        const response = await channel.sendAndWait(request);

        if (response) {
          console.log(`[CommunicationManager] Got response via ${channelType}!`);
          return response;
        }

        console.log(`[CommunicationManager] ${channelType} timed out or failed, trying next...`);
      } catch (error) {
        console.error(`[CommunicationManager] ${channelType} error:`, error);
      }
    }

    console.log(`[CommunicationManager] All channels exhausted, no response received`);
    return null;
  }

  /**
   * Send notification without waiting for response
   */
  async notify(
    title: string,
    message: string,
    urgency: 'normal' | 'high' | 'critical' = 'normal'
  ): Promise<boolean> {
    if (!this.config.enabled) return false;
    if (!this.isInitialized) this.initialize();

    const request: EscalationRequest = {
      id: randomUUID(),
      escalationId: randomUUID(),
      taskId: 'notification',
      type: 'clarification',
      urgency,
      title,
      message,
      timeout: 0,
      createdAt: new Date()
    };

    // Send to first available channel
    for (const channelType of this.config.fallbackOrder) {
      const channel = this.channels.get(channelType);
      if (channel?.isConfigured) {
        const sent = await channel.send(request);
        if (sent) return true;
      }
    }

    return false;
  }

  /**
   * Format escalation into readable message
   */
  private formatEscalationMessage(escalation: Escalation): string {
    const lines: string[] = [];

    lines.push(escalation.context);

    if (escalation.questions?.length) {
      lines.push('');
      lines.push('**Questions:**');
      escalation.questions.forEach((q, i) => lines.push(`${i+1}. ${q}`));
    }

    if (escalation.options?.length) {
      lines.push('');
      lines.push('**Options:**');
      escalation.options.forEach((o, i) =>
        lines.push(`${i+1}. **${o.label}**: ${o.description}`)
      );
    }

    if (escalation.errors?.length) {
      lines.push('');
      lines.push('**Recent Errors:**');
      escalation.errors.slice(0, 3).forEach(e => lines.push(`- ${e}`));
    }

    return lines.join('\n');
  }

  /**
   * Route incoming webhook to appropriate channel
   */
  async handleWebhook(channelType: ChannelType, payload: unknown): Promise<void> {
    const channel = this.channels.get(channelType);
    if (channel) {
      await channel.handleIncomingResponse(payload);
    }
  }

  /**
   * Test all configured channels
   */
  async testAllChannels(): Promise<Record<ChannelType, boolean>> {
    if (!this.isInitialized) this.initialize();

    const results: Record<string, boolean> = {};

    for (const [type, channel] of this.channels) {
      try {
        results[type] = await channel.test();
        console.log(`[CommunicationManager] ${type} test: ${results[type] ? 'PASS' : 'FAIL'}`);
      } catch {
        results[type] = false;
        console.log(`[CommunicationManager] ${type} test: FAIL (error)`);
      }
    }

    return results as Record<ChannelType, boolean>;
  }

  /**
   * Get status of all channels
   */
  getStatus(): {
    enabled: boolean;
    enabledChannels: ChannelType[];
    fallbackOrder: ChannelType[];
    channels: Record<ChannelType, { configured: boolean; status: string }>;
  } {
    const channelStatus: Record<string, { configured: boolean; status: string }> = {};
    const enabledChannels: ChannelType[] = [];

    for (const type of this.config.fallbackOrder) {
      const channel = this.channels.get(type);
      const isConfigured = channel?.isConfigured ?? false;

      channelStatus[type] = {
        configured: isConfigured,
        status: channel?.getStatus() ?? 'not_initialized'
      };

      if (isConfigured) {
        enabledChannels.push(type);
      }
    }

    return {
      enabled: this.config.enabled,
      enabledChannels,
      fallbackOrder: this.config.fallbackOrder,
      channels: channelStatus as Record<ChannelType, { configured: boolean; status: string }>
    };
  }

  /**
   * Update configuration with deep merge for channel configs
   */
  updateConfig(config: Partial<CommunicationConfig>): void {
    // Deep merge to preserve channel configs
    this.config = {
      ...this.config,
      ...config,
      // Preserve existing channel configs, merge new ones
      phone: config.phone !== undefined
        ? { ...this.config.phone, ...config.phone }
        : this.config.phone,
      sms: config.sms !== undefined
        ? { ...this.config.sms, ...config.sms }
        : this.config.sms,
      slack: config.slack !== undefined
        ? { ...this.config.slack, ...config.slack }
        : this.config.slack,
      discord: config.discord !== undefined
        ? { ...this.config.discord, ...config.discord }
        : this.config.discord,
      email: config.email !== undefined
        ? { ...this.config.email, ...config.email }
        : this.config.email,
      telegram: config.telegram !== undefined
        ? { ...this.config.telegram, ...config.telegram }
        : this.config.telegram,
    };
    this.isInitialized = false;
    this.channels.clear();
    console.log('[CommunicationManager] Configuration updated, re-initialization required');
  }

  /**
   * Get current configuration (without sensitive data)
   */
  getConfig(): Partial<CommunicationConfig> {
    return {
      enabled: this.config.enabled,
      fallbackOrder: this.config.fallbackOrder,
      timeoutMs: this.config.timeoutMs,
      retryAttempts: this.config.retryAttempts,
      phone: this.config.phone ? {
        enabled: this.config.phone.enabled,
        provider: this.config.phone.provider,
        phoneNumber: this.config.phone.phoneNumber ? '****' + this.config.phone.phoneNumber.slice(-4) : undefined
      } : undefined,
      sms: this.config.sms ? {
        enabled: this.config.sms.enabled,
        provider: this.config.sms.provider,
        phoneNumber: this.config.sms.phoneNumber ? '****' + this.config.sms.phoneNumber.slice(-4) : undefined
      } : undefined,
      slack: this.config.slack ? {
        enabled: this.config.slack.enabled,
        webhookUrl: this.config.slack.webhookUrl ? '****configured****' : undefined
      } : undefined,
      discord: this.config.discord ? {
        enabled: this.config.discord.enabled,
        webhookUrl: this.config.discord.webhookUrl ? '****configured****' : undefined
      } : undefined,
      email: this.config.email ? {
        enabled: this.config.email.enabled,
        toAddress: this.config.email.toAddress
      } : undefined,
      telegram: this.config.telegram ? {
        enabled: this.config.telegram.enabled,
        chatId: this.config.telegram.chatId ? '****' + this.config.telegram.chatId.slice(-4) : undefined
      } : undefined
    } as Partial<CommunicationConfig>;
  }

  /**
   * Check if communications are enabled
   */
  isEnabled(): boolean {
    return this.config.enabled && this.channels.size > 0;
  }

  /**
   * Get list of configured channel types
   */
  getConfiguredChannels(): ChannelType[] {
    return Array.from(this.channels.keys());
  }

  /**
   * Enable/disable TelegramBot polling mode.
   * When active, TelegramChannel operates in send-only mode
   * to avoid conflict (only one poller per bot token allowed).
   */
  setTelegramBotActive(active: boolean): void {
    const telegramChannel = this.channels.get('telegram') as TelegramChannel | undefined;
    if (telegramChannel) {
      telegramChannel.setSendOnlyMode(active);
      console.log(`[CommunicationManager] Telegram send-only mode: ${active}`);
    }
  }

  /**
   * Handle a Telegram response forwarded from TelegramBot.
   * Used when TelegramBot handles all polling and forwards escalation responses.
   */
  async handleTelegramResponse(message: {
    text: string;
    replyToText?: string;
    callbackData?: string;
  }): Promise<void> {
    const telegramChannel = this.channels.get('telegram') as TelegramChannel | undefined;
    if (telegramChannel) {
      const response = await telegramChannel.receiveForwardedResponse(message);
      if (response) {
        console.log(`[CommunicationManager] Received escalation response: ${response.response}`);
      }
    }
  }

  /**
   * Inject a response for a pending escalation from an external source (e.g., MCP tool).
   * This resolves the waiting Promise in whatever channel is currently waiting.
   */
  injectResponse(escalationId: string, responseText: string): boolean {
    // Find channel with pending request for this escalation
    for (const [channelType, channel] of this.channels) {
      const pendingInfo = channel.getPendingInfo();

      // Check if any pending request matches this escalation
      for (const pending of pendingInfo) {
        // The request ID contains the escalation ID
        if (pending.requestId.includes(escalationId) || pendingInfo.length > 0) {
          // Found a pending request - inject the response
          console.log(`[CommunicationManager] Injecting MCP response into ${channelType} channel`);

          // Call the channel's handleIncomingResponse with a synthetic payload
          // that will be parsed correctly
          channel.handleIncomingResponse({
            _synthetic: true,
            requestId: pending.requestId,
            response: responseText
          });

          return true;
        }
      }
    }

    console.log(`[CommunicationManager] No pending channel request found for escalation ${escalationId}`);
    return false;
  }

  /**
   * Get the TelegramChannel for direct access (e.g., from TelegramBot).
   */
  getTelegramChannel(): TelegramChannel | undefined {
    return this.channels.get('telegram') as TelegramChannel | undefined;
  }

  /**
   * Extend timeout for all pending escalations by additional time (default 10 minutes)
   * Used when user needs more time to respond (/wait command)
   */
  extendTimeout(additionalMinutes: number = 10): {
    extended: boolean;
    channelsExtended: string[];
    newTimeout?: Date;
  } {
    const additionalMs = additionalMinutes * 60000;
    const channelsExtended: string[] = [];
    let latestTimeout: Date | undefined;

    for (const [channelType, channel] of this.channels) {
      if (channel.hasPendingRequests()) {
        const result = channel.extendTimeout(additionalMs);
        if (result.extended) {
          channelsExtended.push(channelType);
          if (!latestTimeout || (result.newTimeout && result.newTimeout > latestTimeout)) {
            latestTimeout = result.newTimeout;
          }
        }
      }
    }

    if (channelsExtended.length > 0) {
      console.log(`[CommunicationManager] Extended timeout by ${additionalMinutes} minutes on channels: ${channelsExtended.join(', ')}`);
      return {
        extended: true,
        channelsExtended,
        newTimeout: latestTimeout
      };
    }

    return { extended: false, channelsExtended: [] };
  }

  /**
   * Get pending escalation info from all channels
   */
  getPendingEscalations(): Array<{
    channel: string;
    requestId: string;
    title: string;
    waitingSince: Date;
  }> {
    const pending: Array<{
      channel: string;
      requestId: string;
      title: string;
      waitingSince: Date;
    }> = [];

    for (const [channelType, channel] of this.channels) {
      const channelPending = channel.getPendingInfo();
      for (const p of channelPending) {
        pending.push({
          channel: channelType,
          ...p
        });
      }
    }

    return pending;
  }
}

export default CommunicationManager;
