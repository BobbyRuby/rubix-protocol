/**
 * CommunicationManager
 *
 * Orchestrates multi-channel escalation with fallback chain.
 * Phone → SMS → Slack → Discord → Email
 * Each channel has a configurable timeout (default 5 min).
 *
 * SECURITY: All outgoing messages are sanitized to prevent secret exposure.
 */

import { randomUUID } from 'crypto';
import { getSanitizer } from '../core/OutputSanitizer.js';
import type {
  CommunicationConfig,
  ChannelType,
  EscalationRequest,
  EscalationResponse,
  IChannel,
  AutoDecisionConfig
} from './types.js';
import { DEFAULT_AUTO_DECISION_CONFIG } from './types.js';
import { PhoneChannel } from './channels/PhoneChannel.js';
import { SMSChannel } from './channels/SMSChannel.js';
import { SlackChannel } from './channels/SlackChannel.js';
import { DiscordChannel } from './channels/DiscordChannel.js';
import { EmailChannel } from './channels/EmailChannel.js';
import { TelegramChannel } from './channels/TelegramChannel.js';

// Question with optional per-question options
interface EscalationQuestion {
  text: string;
  options?: Array<{ label: string; description: string }>;
}

// Import Escalation type from codex if available
interface Escalation {
  id: string;
  taskId: string;
  type: 'clarification' | 'decision' | 'blocked' | 'approval';
  title: string;
  context: string;
  // Questions can be strings or objects with per-question options
  questions?: Array<string | EscalationQuestion>;
  options?: Array<{ label: string; description: string }>;  // Global options
  errors?: string[];
  blocking?: boolean;
}

export class CommunicationManager {
  private config: CommunicationConfig;
  private channels: Map<ChannelType, IChannel> = new Map();
  private isInitialized: boolean = false;

  /** Maximum number of questions to process in a queued escalation */
  private readonly MAX_QUEUED_QUESTIONS = 7;

  /** Auto-decision configuration */
  private autoDecisionConfig: AutoDecisionConfig;

  /** Pending override resolvers - maps requestId to resolver and timeout handle for cleanup */
  private overridePending: Map<string, {
    resolve: (response: EscalationResponse | null) => void;
    timeoutHandle: NodeJS.Timeout;
  }> = new Map();

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
      telegram: config.telegram,
      autoDecision: config.autoDecision
    };

    // Initialize auto-decision config with defaults
    this.autoDecisionConfig = {
      ...DEFAULT_AUTO_DECISION_CONFIG,
      ...config.autoDecision
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
      // DON'T start polling here - wait for setTelegramBotActive() to decide
      // This prevents polling conflicts when TelegramBot is also running
      console.log('[CommunicationManager] Telegram channel initialized (polling deferred)');
    }

    this.isInitialized = true;
    console.log(`[CommunicationManager] Initialized with ${this.channels.size} channels`);
    console.log(`[CommunicationManager] Fallback order: ${this.config.fallbackOrder.join(' → ')}`);
  }

  /**
   * Main escalation method - tries each channel in fallback order
   * Blocks until response received or all channels exhausted
   *
   * If escalation has multiple questions, they are sent one-by-one
   * and responses are collected sequentially (max 7 questions).
   */
  async escalate(escalation: Escalation): Promise<EscalationResponse | null> {
    if (!this.config.enabled) {
      console.log('[CommunicationManager] Communications disabled, skipping escalation');
      return null;
    }

    if (!this.isInitialized) {
      this.initialize();
    }

    // Normalize questions to consistent format
    const questions = this.normalizeQuestions(escalation);

    // If multiple questions, use queue-based flow
    if (questions.length > 1) {
      console.log(`[CommunicationManager] Detected ${questions.length} questions, using queued flow`);
      return await this.escalateQueued(escalation, questions);
    }

    // Single question - use standard flow
    // SECURITY: Sanitize all content before building the request
    const sanitizer = getSanitizer();

    // Build escalation request
    const request: EscalationRequest = {
      id: randomUUID(),
      escalationId: escalation.id,
      taskId: escalation.taskId,
      type: escalation.type,
      urgency: escalation.blocking ? 'critical' : 'high',
      title: sanitizer.sanitize(escalation.title),
      message: this.formatEscalationMessage(escalation),
      context: sanitizer.sanitize(escalation.context),
      options: escalation.options?.map(o => ({
        label: sanitizer.sanitize(o.label),
        value: sanitizer.sanitize(o.description)
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

    // Try auto-decision if enabled and options are available
    console.log(`[AutoDecision] All channels exhausted for request ${request.id.slice(0, 8)}`);
    console.log(`[AutoDecision] Auto-decision enabled: ${this.autoDecisionConfig.enabled}`);
    console.log(`[AutoDecision] Options available: ${request.options?.length || 0}`);

    if (this.autoDecisionConfig.enabled && request.options && request.options.length > 0) {
      console.log(`[AutoDecision] Triggering auto-decision flow...`);
      return await this.handleAutoDecision(request);
    }

    console.log(`[AutoDecision] Auto-decision not triggered (disabled or no options)`);
    return null;
  }

  /**
   * Handle auto-decision when all channels are exhausted
   * Picks an option automatically, notifies user, and waits for override
   */
  private async handleAutoDecision(request: EscalationRequest): Promise<EscalationResponse | null> {
    console.log(`[AutoDecision] === START handleAutoDecision ===`);
    console.log(`[AutoDecision] Request ID: ${request.id}`);
    console.log(`[AutoDecision] Request title: ${request.title}`);
    console.log(`[AutoDecision] Options: ${JSON.stringify(request.options)}`);
    console.log(`[AutoDecision] Strategy: ${this.autoDecisionConfig.strategy}`);
    console.log(`[AutoDecision] Override window: ${this.autoDecisionConfig.overrideWindowMs}ms`);

    try {
      // 1. Pick an answer using configured strategy
      const selectedOption = this.pickAutoDecision(request);
      console.log(`[AutoDecision] Picked option: ${selectedOption}`);

      // 2. Notify user with override option
      const overrideDeadline = new Date(Date.now() + this.autoDecisionConfig.overrideWindowMs);

      // Wrap notify in try/catch - don't fail if notification fails
      if (this.autoDecisionConfig.notifyUser) {
        console.log(`[AutoDecision] Sending notification to user...`);
        try {
          await this.notifyAutoDecision(request, selectedOption, overrideDeadline);
          console.log(`[AutoDecision] Notification sent successfully`);
        } catch (err) {
          console.error(`[AutoDecision] Failed to send notification:`, err);
          console.error(`[AutoDecision] Stack:`, err instanceof Error ? err.stack : 'no stack');
          // Continue anyway - notification failure shouldn't block auto-decision
        }
      }

      // 3. Wait for override window, listening for responses
      console.log(`[AutoDecision] Starting override window (${this.autoDecisionConfig.overrideWindowMs}ms)...`);
      const override = await this.waitForOverride(request.id, this.autoDecisionConfig.overrideWindowMs);
      console.log(`[AutoDecision] Override window complete`);
      console.log(`[AutoDecision] Override received: ${!!override}`);

      // 4. Return override or auto-decision
      if (override) {
        console.log(`[AutoDecision] User overrode with: ${override.selectedOption || override.response}`);
        console.log(`[AutoDecision] === END handleAutoDecision (overridden) ===`);
        return {
          ...override,
          metadata: {
            autoDecision: true,
            strategy: this.autoDecisionConfig.strategy,
            wasOverridden: true
          }
        };
      }

      console.log(`[AutoDecision] No override, proceeding with: ${selectedOption}`);
      console.log(`[AutoDecision] === END handleAutoDecision (auto) ===`);
      return {
        requestId: request.id,
        channel: 'auto_decision',
        response: selectedOption,
        selectedOption,
        receivedAt: new Date(),
        metadata: {
          autoDecision: true,
          strategy: this.autoDecisionConfig.strategy,
          wasOverridden: false
        }
      };
    } catch (err) {
      console.error(`[AutoDecision] CRITICAL ERROR in handleAutoDecision:`, err);
      console.error(`[AutoDecision] Stack:`, err instanceof Error ? err.stack : 'no stack');
      console.log(`[AutoDecision] === END handleAutoDecision (error) ===`);
      // Return null to fall back to original behavior (fail gracefully)
      return null;
    }
  }

  /**
   * Pick an auto-decision option using configured strategy
   */
  private pickAutoDecision(request: EscalationRequest): string {
    console.log(`[AutoDecision] pickAutoDecision called`);
    const options = request.options || [];
    console.log(`[AutoDecision] Number of options: ${options.length}`);

    if (options.length === 0) {
      console.log(`[AutoDecision] No options, returning 'proceed'`);
      return 'proceed';
    }

    console.log(`[AutoDecision] Using strategy: ${this.autoDecisionConfig.strategy}`);

    let result: string;
    switch (this.autoDecisionConfig.strategy) {
      case 'first_option':
        result = options[0].value;
        console.log(`[AutoDecision] first_option strategy: ${result}`);
        break;

      case 'random':
        const randomIndex = Math.floor(Math.random() * options.length);
        result = options[randomIndex].value;
        console.log(`[AutoDecision] random strategy (index ${randomIndex}): ${result}`);
        break;

      case 'intelligent':
        console.log(`[AutoDecision] Checking for safe options...`);
        // Prefer safe options: "skip", "cancel", "default", "no", "abort"
        const safeOption = options.find(o =>
          /skip|cancel|default|no|abort|continue|proceed/i.test(o.value) ||
          /skip|cancel|default|no|abort|continue|proceed/i.test(o.label)
        );
        console.log(`[AutoDecision] Safe option found: ${safeOption?.value || 'none'}`);
        result = safeOption?.value || options[0].value;
        break;

      default:
        console.log(`[AutoDecision] Unknown strategy, falling back to first_option`);
        result = options[0].value;
    }

    console.log(`[AutoDecision] Final pick: ${result}`);
    return result;
  }

  /**
   * Notify user about auto-decision with override option
   */
  private async notifyAutoDecision(
    request: EscalationRequest,
    selectedOption: string,
    overrideDeadline: Date
  ): Promise<void> {
    console.log(`[AutoDecision] notifyAutoDecision called`);
    console.log(`[AutoDecision] Selected option: ${selectedOption}`);
    console.log(`[AutoDecision] Override deadline: ${overrideDeadline.toISOString()}`);

    const minutes = Math.ceil((overrideDeadline.getTime() - Date.now()) / 60000);
    console.log(`[AutoDecision] Minutes until deadline: ${minutes}`);

    const optionLabel = request.options?.find(o => o.value === selectedOption)?.label || selectedOption;

    const message = `🤖 **Auto-Decision Made**

No response received for: *${request.title}*

**Selected:** ${optionLabel}
**Strategy:** ${this.autoDecisionConfig.strategy}

_Reply within ${minutes} minutes to override this decision._
_Send any option number or text to change._`;

    console.log(`[AutoDecision] Message to send: ${message.slice(0, 100)}...`);
    console.log(`[AutoDecision] Calling notify()...`);
    await this.notify('Auto-Decision', message, 'high');
    console.log(`[AutoDecision] notify() complete`);
  }

  /**
   * Wait for user override during override window
   */
  private waitForOverride(
    requestId: string,
    timeoutMs: number
  ): Promise<EscalationResponse | null> {
    console.log(`[AutoDecision] waitForOverride called for ${requestId.slice(0, 8)}`);
    console.log(`[AutoDecision] Timeout: ${timeoutMs}ms`);
    console.log(`[AutoDecision] Setting up timeout handler...`);

    return new Promise((resolve) => {
      const timeoutHandle = setTimeout(() => {
        console.log(`[AutoDecision] Timeout fired for ${requestId.slice(0, 8)}`);
        console.log(`[AutoDecision] Checking if still pending...`);
        console.log(`[AutoDecision] Still pending: ${this.overridePending.has(requestId)}`);

        if (this.overridePending.has(requestId)) {
          this.overridePending.delete(requestId);
          console.log(`[AutoDecision] Cleaning up and resolving null`);
          console.log(`[AutoDecision] Override window expired for ${requestId.slice(0, 8)}`);
          resolve(null);
        }
      }, timeoutMs);

      // Store BOTH resolver and timeout handle for cleanup
      this.overridePending.set(requestId, { resolve, timeoutHandle });
      console.log(`[AutoDecision] Stored pending override in Map (size: ${this.overridePending.size})`);
    });
  }

  /**
   * Inject an override response for a pending auto-decision
   * Called when user responds during the override window
   */
  injectOverrideResponse(requestId: string, response: EscalationResponse): boolean {
    console.log(`[AutoDecision] injectOverrideResponse called`);
    console.log(`[AutoDecision] Request ID: ${requestId.slice(0, 8)}`);
    console.log(`[AutoDecision] Response: ${JSON.stringify(response).slice(0, 200)}`);
    console.log(`[AutoDecision] Pending Map size: ${this.overridePending.size}`);

    const pending = this.overridePending.get(requestId);
    console.log(`[AutoDecision] Found pending: ${!!pending}`);

    if (pending) {
      // CRITICAL: Cancel the timeout to prevent double-resolve
      console.log(`[AutoDecision] Clearing timeout handle...`);
      clearTimeout(pending.timeoutHandle);
      console.log(`[AutoDecision] Deleting from Map...`);
      this.overridePending.delete(requestId);
      console.log(`[AutoDecision] Calling resolver with response...`);
      pending.resolve(response);
      console.log(`[AutoDecision] Override injection complete for ${requestId.slice(0, 8)}`);
      return true;
    }
    console.log(`[AutoDecision] No pending override found for ${requestId.slice(0, 8)}`);
    return false;
  }

  /**
   * Check if there's a pending override for any request
   */
  hasPendingOverride(): boolean {
    return this.overridePending.size > 0;
  }

  /**
   * Get list of pending override request IDs
   */
  getPendingOverrideRequestIds(): string[] {
    return Array.from(this.overridePending.keys());
  }

  /**
   * Normalize questions to consistent format: Array<{ text, options? }>
   */
  private normalizeQuestions(escalation: Escalation): Array<EscalationQuestion> {
    if (!escalation.questions || escalation.questions.length === 0) {
      // No questions array - treat context as single question with global options
      return [{
        text: escalation.context,
        options: escalation.options
      }];
    }

    return escalation.questions.slice(0, this.MAX_QUEUED_QUESTIONS).map(q => {
      if (typeof q === 'string') {
        // String question - no per-question options
        return { text: q };
      }
      return q;  // Already in { text, options? } format
    });
  }

  /**
   * Queue-based escalation for multiple questions.
   * Sends questions one-by-one and collects responses sequentially.
   * SECURITY: All content is sanitized before sending.
   */
  private async escalateQueued(
    escalation: Escalation,
    questions: Array<EscalationQuestion>
  ): Promise<EscalationResponse | null> {
    const sanitizer = getSanitizer();
    const responses: string[] = [];
    const totalQuestions = questions.length;
    let lastChannel: ChannelType = 'telegram';

    console.log(`[CommunicationManager] Starting queued escalation with ${totalQuestions} questions`);

    // Send title/context first as a header (sanitized)
    const sanitizedTitle = sanitizer.sanitize(escalation.title);
    const sanitizedContext = sanitizer.sanitize(escalation.context);
    await this.sendAcknowledgment(
      `📋 *${sanitizedTitle}*\n\n${sanitizedContext}\n\n_${totalQuestions} questions to answer:_`
    );

    for (let i = 0; i < questions.length; i++) {
      const question = questions[i];
      const questionNum = i + 1;

      // Build single-question request with sanitized content
      const request: EscalationRequest = {
        id: `${escalation.id}-q${questionNum}`,
        escalationId: escalation.id,
        taskId: escalation.taskId,
        type: escalation.type,
        urgency: escalation.blocking ? 'critical' : 'high',
        title: `📝 Question ${questionNum}/${totalQuestions}`,
        message: sanitizer.sanitize(question.text),
        context: sanitizedContext,
        options: question.options?.map(o => ({
          label: sanitizer.sanitize(o.label),
          value: sanitizer.sanitize(o.description)
        })),
        timeout: this.config.timeoutMs,
        createdAt: new Date()
      };

      console.log(`[CommunicationManager] Sending question ${questionNum}/${totalQuestions}: ${question.text.slice(0, 50)}...`);

      // Try channels in order until we get a response
      let questionResponse: EscalationResponse | null = null;

      for (const channelType of this.config.fallbackOrder) {
        const channel = this.channels.get(channelType);
        if (!channel?.isConfigured) continue;

        try {
          questionResponse = await channel.sendAndWait(request);
          if (questionResponse) {
            lastChannel = channelType;
            break;
          }
        } catch (error) {
          console.error(`[CommunicationManager] ${channelType} error on question ${questionNum}:`, error);
        }
      }

      if (!questionResponse) {
        console.log(`[CommunicationManager] No response for question ${questionNum}, aborting queue`);
        return null;
      }

      // Store response
      responses.push(questionResponse.response);
      console.log(`[CommunicationManager] Got answer ${questionNum}: ${questionResponse.response}`);

      // Send acknowledgment
      if (i < questions.length - 1) {
        await this.sendAcknowledgment(`✓ Got it: ${questionResponse.response.slice(0, 50)}${questionResponse.response.length > 50 ? '...' : ''}`);
      } else {
        await this.sendAcknowledgment(`✓ Got all ${totalQuestions} answers. Processing...`);
      }
    }

    // Return aggregated response
    return {
      requestId: escalation.id,
      channel: lastChannel,
      response: responses.join('\n---\n'),  // Combined text for backwards compat
      responses,  // Array of individual responses
      receivedAt: new Date()
    };
  }

  /**
   * Send a quick acknowledgment message (no response expected)
   */
  private async sendAcknowledgment(message: string): Promise<void> {
    for (const channelType of this.config.fallbackOrder) {
      const channel = this.channels.get(channelType);
      if (channel?.isConfigured) {
        await channel.send({
          id: `ack-${Date.now()}`,
          escalationId: 'ack',
          taskId: 'ack',
          type: 'clarification',
          urgency: 'normal',
          title: '',  // Empty title signals acknowledgment
          message,
          timeout: 0,
          createdAt: new Date()
        });
        return;  // Only send to first available channel
      }
    }
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
   * SECURITY: All content is sanitized to prevent secret exposure in notifications
   */
  private formatEscalationMessage(escalation: Escalation): string {
    const sanitizer = getSanitizer();
    const lines: string[] = [];

    // Sanitize context before adding
    lines.push(sanitizer.sanitize(escalation.context));

    if (escalation.questions?.length) {
      lines.push('');
      lines.push('**Questions:**');
      escalation.questions.forEach((q, i) => {
        const questionText = typeof q === 'string' ? q : q.text;
        lines.push(`${i+1}. ${sanitizer.sanitize(questionText)}`);
      });
    }

    if (escalation.options?.length) {
      lines.push('');
      lines.push('**Options:**');
      escalation.options.forEach((o, i) =>
        lines.push(`${i+1}. **${sanitizer.sanitize(o.label)}**: ${sanitizer.sanitize(o.description)}`)
      );
    }

    if (escalation.errors?.length) {
      lines.push('');
      lines.push('**Recent Errors:**');
      // Sanitize errors to prevent secret exposure in error messages
      escalation.errors.slice(0, 3).forEach(e => lines.push(`- ${sanitizer.sanitize(e)}`));
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
      autoDecision: config.autoDecision !== undefined
        ? { ...this.config.autoDecision, ...config.autoDecision }
        : this.config.autoDecision,
    };

    // Update autoDecisionConfig instance variable as well
    if (config.autoDecision) {
      this.autoDecisionConfig = {
        ...this.autoDecisionConfig,
        ...config.autoDecision
      };
    }

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
      } : undefined,
      autoDecision: this.autoDecisionConfig
    } as Partial<CommunicationConfig>;
  }

  /**
   * Get auto-decision configuration
   */
  getAutoDecisionConfig(): AutoDecisionConfig {
    return { ...this.autoDecisionConfig };
  }

  /**
   * Update auto-decision configuration
   */
  updateAutoDecisionConfig(config: Partial<AutoDecisionConfig>): void {
    this.autoDecisionConfig = {
      ...this.autoDecisionConfig,
      ...config
    };
    console.log('[CommunicationManager] Auto-decision config updated:', this.autoDecisionConfig);
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
      if (active) {
        // TelegramBot will handle polling - use send-only mode
        telegramChannel.setSendOnlyMode(true);
        console.log('[CommunicationManager] Telegram send-only mode enabled (TelegramBot active)');
      } else {
        // No TelegramBot - CommunicationManager needs to poll itself
        telegramChannel.setSendOnlyMode(false);
        telegramChannel.startPolling();
        console.log('[CommunicationManager] TelegramChannel started polling (no TelegramBot)');
      }
    }
  }

  /**
   * Handle a Telegram response forwarded from TelegramBot.
   * Used when TelegramBot handles all polling and forwards escalation responses.
   * Also checks for pending auto-decision overrides.
   */
  async handleTelegramResponse(message: {
    text: string;
    replyToText?: string;
    callbackData?: string;
  }): Promise<void> {
    console.log(`[AutoDecision] handleTelegramResponse called`);
    console.log(`[AutoDecision] Message text: ${message.text}`);
    console.log(`[AutoDecision] Callback data: ${message.callbackData || 'none'}`);
    console.log(`[AutoDecision] Pending overrides: ${this.overridePending.size}`);

    // First check if this is an override for a pending auto-decision
    if (this.overridePending.size > 0) {
      console.log(`[AutoDecision] Checking for pending auto-decisions...`);

      // Copy keys to avoid iterator invalidation (Map is modified during loop)
      const pendingIds = Array.from(this.overridePending.keys());
      console.log(`[AutoDecision] Pending IDs: ${JSON.stringify(pendingIds.map(id => id.slice(0, 8)))}`);

      for (const requestId of pendingIds) {
        console.log(`[AutoDecision] Processing override for ${requestId.slice(0, 8)}`);

        // Safe JSON parse with try/catch
        let selectedOption = message.text;
        if (message.callbackData) {
          console.log(`[AutoDecision] Parsing callback data...`);
          try {
            const parsed = JSON.parse(message.callbackData);
            selectedOption = parsed?.opt || message.text;
            console.log(`[AutoDecision] Parsed selectedOption: ${selectedOption}`);
          } catch (err) {
            console.error(`[AutoDecision] Failed to parse callback data:`, err);
            console.error(`[AutoDecision] Stack:`, err instanceof Error ? err.stack : 'no stack');
            // Fall back to text on parse failure
          }
        }

        const response: EscalationResponse = {
          requestId,
          channel: 'telegram',
          response: message.text,
          selectedOption,
          receivedAt: new Date(),
          rawPayload: message
        };

        const injected = this.injectOverrideResponse(requestId, response);
        console.log(`[AutoDecision] Inject result: ${injected}`);

        if (injected) {
          console.log(`[AutoDecision] Override received: ${message.text}`);
          return;
        }
      }
    }

    // Normal response handling via Telegram channel
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
