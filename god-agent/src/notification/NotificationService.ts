/**
 * NotificationService
 *
 * Main notification service for RUBIX.
 * Handles sending notifications to console, Slack, Discord, and webhooks.
 */

import { randomUUID } from 'crypto';
import type { MemoryEngine } from '../core/MemoryEngine.js';

import {
  type NotificationConfig,
  type Notification,
  type NotificationResult,
  type ChannelResult,
  type NotificationType,
  type NotificationUrgency,
  type NotificationAction,
  type NotificationChannel,
  DEFAULT_NOTIFICATION_CONFIG
} from './types.js';

import { SlackNotifier } from './SlackNotifier.js';
import { DiscordNotifier } from './DiscordNotifier.js';
import { WebhookNotifier } from './WebhookNotifier.js';

/**
 * NotificationService - Central notification hub
 */
export class NotificationService {
  private engine: MemoryEngine;
  private config: NotificationConfig;
  private slack: SlackNotifier | null = null;
  private discord: DiscordNotifier | null = null;
  private webhooks: WebhookNotifier | null = null;
  private notificationHistory: Map<string, NotificationResult> = new Map();

  constructor(engine: MemoryEngine, config: Partial<NotificationConfig> = {}) {
    this.engine = engine;
    this.config = { ...DEFAULT_NOTIFICATION_CONFIG, ...config };
    this.initializeNotifiers();
  }

  /**
   * Initialize notifiers based on configuration
   */
  private initializeNotifiers(): void {
    if (this.config.slack?.enabled) {
      this.slack = new SlackNotifier(this.config.slack);
    }

    if (this.config.discord?.enabled) {
      this.discord = new DiscordNotifier(this.config.discord);
    }

    if (this.config.webhooks && this.config.webhooks.length > 0) {
      this.webhooks = new WebhookNotifier(this.config.webhooks);
    }
  }

  // ===========================================================================
  // Main Notification Methods
  // ===========================================================================

  /**
   * Send a notification
   */
  async notify(notification: Omit<Notification, 'id' | 'timestamp'>): Promise<NotificationResult> {
    const fullNotification: Notification = {
      ...notification,
      id: randomUUID(),
      timestamp: new Date()
    };

    // Check if notification should be sent
    if (!this.shouldNotify(fullNotification)) {
      return this.createSkippedResult(fullNotification.id, 'Notification filtered by preferences');
    }

    // Determine channels
    const channels = this.determineChannels(fullNotification);

    // Send to all channels
    const channelResults = await this.sendToChannels(fullNotification, channels);

    // Create result
    const result: NotificationResult = {
      notificationId: fullNotification.id,
      status: this.determineOverallStatus(channelResults),
      channelResults,
      timestamp: new Date()
    };

    // Store in history
    this.notificationHistory.set(fullNotification.id, result);

    // Store in memory for important notifications
    if (fullNotification.urgency === 'high' || fullNotification.urgency === 'critical') {
      await this.storeNotification(fullNotification, result);
    }

    return result;
  }

  /**
   * Send task completion notification
   */
  async notifyComplete(
    taskId: string,
    task: string,
    summary: string,
    actions?: NotificationAction[]
  ): Promise<NotificationResult> {
    return this.notify({
      type: 'complete',
      urgency: 'normal',
      title: 'Task Complete',
      message: `Task "${task}" has been completed.`,
      taskId,
      task,
      summary,
      actions
    });
  }

  /**
   * Send blocked notification
   */
  async notifyBlocked(
    taskId: string,
    task: string,
    reason: string,
    context?: string,
    actions?: NotificationAction[]
  ): Promise<NotificationResult> {
    return this.notify({
      type: 'blocked',
      urgency: 'high',
      title: 'Task Blocked',
      message: `Task "${task}" is blocked: ${reason}`,
      taskId,
      task,
      summary: reason,
      context,
      actions
    });
  }

  /**
   * Send decision needed notification
   */
  async notifyDecision(
    taskId: string,
    task: string,
    question: string,
    options?: NotificationAction[]
  ): Promise<NotificationResult> {
    return this.notify({
      type: 'decision',
      urgency: 'normal',
      title: 'Decision Needed',
      message: question,
      taskId,
      task,
      summary: question,
      actions: options
    });
  }

  /**
   * Send review ready notification
   */
  async notifyReviewReady(
    taskId: string,
    task: string,
    summary: string,
    reviewUrl?: string
  ): Promise<NotificationResult> {
    const actions: NotificationAction[] = [];
    if (reviewUrl) {
      actions.push({ label: 'View Review', url: reviewUrl, style: 'primary' });
    }

    return this.notify({
      type: 'review_ready',
      urgency: 'normal',
      title: 'Review Ready',
      message: `Code review ready for "${task}"`,
      taskId,
      task,
      summary,
      actions
    });
  }

  /**
   * Send error notification
   */
  async notifyError(
    error: string,
    context?: string,
    taskId?: string,
    task?: string
  ): Promise<NotificationResult> {
    return this.notify({
      type: 'error',
      urgency: 'high',
      title: 'Error Occurred',
      message: error,
      taskId,
      task,
      summary: error,
      context
    });
  }

  /**
   * Send escalation notification
   */
  async notifyEscalation(
    taskId: string,
    task: string,
    reason: string,
    attemptsSummary?: string,
    actions?: NotificationAction[]
  ): Promise<NotificationResult> {
    return this.notify({
      type: 'escalation',
      urgency: 'high',
      title: 'Escalation Required',
      message: `Task "${task}" requires escalation: ${reason}`,
      taskId,
      task,
      summary: reason,
      context: attemptsSummary,
      actions
    });
  }

  /**
   * Send progress notification
   */
  async notifyProgress(
    taskId: string,
    task: string,
    progress: number,
    currentStep: string
  ): Promise<NotificationResult> {
    return this.notify({
      type: 'progress',
      urgency: 'low',
      title: 'Progress Update',
      message: `Task "${task}": ${progress}% - ${currentStep}`,
      taskId,
      task,
      summary: `${progress}% complete`,
      metadata: { progress, currentStep }
    });
  }

  /**
   * Send info notification
   */
  async notifyInfo(
    title: string,
    message: string,
    metadata?: Record<string, unknown>
  ): Promise<NotificationResult> {
    return this.notify({
      type: 'info',
      urgency: 'low',
      title,
      message,
      summary: message,
      metadata
    });
  }

  // ===========================================================================
  // Channel Sending
  // ===========================================================================

  /**
   * Send notification to all specified channels
   */
  private async sendToChannels(
    notification: Notification,
    channels: NotificationChannel[]
  ): Promise<ChannelResult[]> {
    const results: ChannelResult[] = [];

    for (const channel of channels) {
      try {
        const result = await this.sendToChannel(notification, channel);
        results.push(result);
      } catch (error) {
        results.push({
          channel,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    return results;
  }

  /**
   * Send notification to a specific channel
   */
  private async sendToChannel(
    notification: Notification,
    channel: NotificationChannel
  ): Promise<ChannelResult> {
    switch (channel) {
      case 'console':
        return this.sendToConsole(notification);

      case 'slack':
        if (!this.slack) {
          return { channel, status: 'skipped', error: 'Slack not configured' };
        }
        return this.slack.send(notification);

      case 'discord':
        if (!this.discord) {
          return { channel, status: 'skipped', error: 'Discord not configured' };
        }
        return this.discord.send(notification);

      case 'webhook':
        if (!this.webhooks) {
          return { channel, status: 'skipped', error: 'Webhooks not configured' };
        }
        return this.webhooks.send(notification);

      default:
        return { channel, status: 'failed', error: `Unknown channel: ${channel}` };
    }
  }

  /**
   * Send notification to console
   */
  private sendToConsole(notification: Notification): ChannelResult {
    const emoji = this.getConsoleEmoji(notification.type);
    const urgencyLabel = notification.urgency.toUpperCase();
    const timestamp = notification.timestamp.toISOString();

    // Build console output
    const lines: string[] = [];
    lines.push('');
    lines.push(`${emoji} [${urgencyLabel}] ${notification.title}`);
    lines.push(`   ${notification.message}`);

    if (notification.summary && notification.summary !== notification.message) {
      lines.push(`   Summary: ${notification.summary}`);
    }

    if (notification.context) {
      lines.push(`   Context: ${notification.context}`);
    }

    if (notification.task) {
      lines.push(`   Task: ${notification.task}`);
    }

    if (notification.actions && notification.actions.length > 0) {
      lines.push(`   Actions:`);
      for (const action of notification.actions) {
        const urlPart = action.url ? ` (${action.url})` : '';
        lines.push(`     - ${action.label}${urlPart}`);
      }
    }

    lines.push(`   Time: ${timestamp}`);
    lines.push('');

    // Use appropriate console method based on urgency
    const output = lines.join('\n');
    switch (notification.urgency) {
      case 'critical':
        console.error(output);
        break;
      case 'high':
        console.warn(output);
        break;
      default:
        console.log(output);
    }

    return { channel: 'console', status: 'sent' };
  }

  /**
   * Get console emoji for notification type
   */
  private getConsoleEmoji(type: NotificationType): string {
    const emojiMap: Record<NotificationType, string> = {
      complete: '\u2705',      // ✅
      blocked: '\u26D4',       // ⛔
      decision: '\u2753',      // ❓
      review_ready: '\u{1F50D}', // 🔍
      progress: '\u{1F4C8}',   // 📈
      error: '\u274C',         // ❌
      escalation: '\u{1F4E2}', // 📢
      approval: '\u270B',      // ✋
      info: '\u2139\uFE0F'     // ℹ️
    };
    return emojiMap[type] || '\u{1F514}'; // 🔔
  }

  // ===========================================================================
  // Filtering and Preferences
  // ===========================================================================

  /**
   * Check if notification should be sent based on preferences
   */
  private shouldNotify(notification: Notification): boolean {
    const prefs = this.config.preferences;

    // Check type-specific preferences
    switch (notification.type) {
      case 'complete':
        if (!prefs.onComplete) return false;
        break;
      case 'blocked':
        if (!prefs.onBlocked) return false;
        break;
      case 'decision':
        if (!prefs.onDecision) return false;
        break;
      case 'review_ready':
        if (!prefs.onReviewReady) return false;
        break;
      case 'progress':
        if (!prefs.onProgress) return false;
        break;
      case 'error':
        if (!prefs.onError) return false;
        break;
    }

    // Check minimum urgency
    if (!this.meetsUrgencyThreshold(notification.urgency, prefs.minUrgency)) {
      return false;
    }

    // Check quiet hours
    if (prefs.quietHours?.enabled && this.isQuietHours(prefs.quietHours)) {
      // Allow urgent notifications during quiet hours if configured
      if (prefs.quietHours.allowUrgent &&
          (notification.urgency === 'high' || notification.urgency === 'critical')) {
        return true;
      }
      return false;
    }

    return true;
  }

  /**
   * Check if urgency meets threshold
   */
  private meetsUrgencyThreshold(
    urgency: NotificationUrgency,
    threshold: NotificationUrgency
  ): boolean {
    const levels: NotificationUrgency[] = ['low', 'normal', 'high', 'critical'];
    return levels.indexOf(urgency) >= levels.indexOf(threshold);
  }

  /**
   * Check if currently in quiet hours
   */
  private isQuietHours(quietHours: { start: string; end: string; timezone: string }): boolean {
    try {
      const now = new Date();

      // Parse times
      const [startHour, startMin] = quietHours.start.split(':').map(Number);
      const [endHour, endMin] = quietHours.end.split(':').map(Number);

      const currentHour = now.getHours();
      const currentMin = now.getMinutes();
      const currentTime = currentHour * 60 + currentMin;
      const startTime = startHour * 60 + startMin;
      const endTime = endHour * 60 + endMin;

      // Handle overnight quiet hours (e.g., 22:00 - 08:00)
      if (startTime > endTime) {
        return currentTime >= startTime || currentTime < endTime;
      }

      return currentTime >= startTime && currentTime < endTime;
    } catch {
      return false;
    }
  }

  /**
   * Determine which channels to send to
   */
  private determineChannels(notification: Notification): NotificationChannel[] {
    // If channels specified in notification, use those
    if (notification.channels && notification.channels.length > 0) {
      return notification.channels;
    }

    // Otherwise, determine based on configuration
    const channels: NotificationChannel[] = [];

    // Console always included if enabled
    if (this.config.console) {
      channels.push('console');
    }

    // Add Slack if configured and enabled
    if (this.slack && this.config.slack?.enabled) {
      channels.push('slack');
    }

    // Add Discord if configured and enabled
    if (this.discord && this.config.discord?.enabled) {
      channels.push('discord');
    }

    // Add webhooks if configured
    if (this.webhooks) {
      channels.push('webhook');
    }

    return channels;
  }

  // ===========================================================================
  // Status and Results
  // ===========================================================================

  /**
   * Determine overall status from channel results
   */
  private determineOverallStatus(results: ChannelResult[]): 'sent' | 'failed' | 'skipped' {
    const sentCount = results.filter(r => r.status === 'sent').length;
    const failedCount = results.filter(r => r.status === 'failed').length;

    if (sentCount > 0) return 'sent';
    if (failedCount > 0) return 'failed';
    return 'skipped';
  }

  /**
   * Create a skipped result
   */
  private createSkippedResult(notificationId: string, reason: string): NotificationResult {
    return {
      notificationId,
      status: 'skipped',
      channelResults: [],
      timestamp: new Date(),
      error: reason
    };
  }

  /**
   * Store notification in memory
   */
  private async storeNotification(
    notification: Notification,
    result: NotificationResult
  ): Promise<void> {
    try {
      const content = `Notification sent:
Type: ${notification.type}
Urgency: ${notification.urgency}
Title: ${notification.title}
Message: ${notification.message}
Task: ${notification.task || 'N/A'}
Status: ${result.status}
Channels: ${result.channelResults.map(r => `${r.channel}:${r.status}`).join(', ')}`;

      await this.engine.store(content, {
        tags: ['codex', 'notification', notification.type, notification.urgency],
        importance: notification.urgency === 'critical' ? 0.9 : 0.6
      });
    } catch {
      // Ignore storage errors
    }
  }

  // ===========================================================================
  // Configuration
  // ===========================================================================

  /**
   * Update configuration
   */
  setConfig(config: Partial<NotificationConfig>): void {
    this.config = { ...this.config, ...config };
    this.initializeNotifiers();
  }

  /**
   * Get current configuration
   */
  getConfig(): NotificationConfig {
    return { ...this.config };
  }

  /**
   * Configure Slack
   */
  configureSlack(config: NonNullable<NotificationConfig['slack']>): void {
    this.config.slack = config;
    if (config.enabled) {
      this.slack = new SlackNotifier(config);
    } else {
      this.slack = null;
    }
  }

  /**
   * Configure Discord
   */
  configureDiscord(config: NonNullable<NotificationConfig['discord']>): void {
    this.config.discord = config;
    if (config.enabled) {
      this.discord = new DiscordNotifier(config);
    } else {
      this.discord = null;
    }
  }

  /**
   * Get notification history
   */
  getHistory(limit = 100): NotificationResult[] {
    const results = Array.from(this.notificationHistory.values());
    return results.slice(-limit);
  }

  /**
   * Clear notification history
   */
  clearHistory(): void {
    this.notificationHistory.clear();
  }

  /**
   * Test notification (sends to all configured channels)
   */
  async test(): Promise<NotificationResult> {
    return this.notify({
      type: 'info',
      urgency: 'low',
      title: 'Test Notification',
      message: 'This is a test notification from RUBIX.',
      summary: 'Test notification'
    });
  }
}

export default NotificationService;
