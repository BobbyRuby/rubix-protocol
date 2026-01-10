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
      fallbackOrder: config.fallbackOrder ?? ['phone', 'sms', 'slack', 'discord', 'email'],
      timeoutMs: config.timeoutMs ?? 300000,
      retryAttempts: config.retryAttempts ?? 1,
      webhookServer: config.webhookServer ?? { port: 3456 },
      phone: config.phone,
      sms: config.sms,
      slack: config.slack,
      discord: config.discord,
      email: config.email
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
   * Update configuration
   */
  updateConfig(config: Partial<CommunicationConfig>): void {
    this.config = { ...this.config, ...config };
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
      } : undefined
    } as Partial<CommunicationConfig>;
  }

  /**
   * Check if communications are enabled
   */
  isEnabled(): boolean {
    return this.config.enabled && this.channels.size > 0;
  }
}

export default CommunicationManager;
