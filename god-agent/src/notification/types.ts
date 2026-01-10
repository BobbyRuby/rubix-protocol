/**
 * Notification Types
 *
 * Type definitions for the CODEX notification system.
 * Supports console, Slack, Discord, and webhook notifications.
 */

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Notification configuration
 */
export interface NotificationConfig {
  /** Console notifications always enabled */
  console: boolean;
  /** Slack webhook configuration */
  slack?: SlackConfig;
  /** Discord webhook configuration */
  discord?: DiscordConfig;
  /** Generic webhook configuration */
  webhooks?: WebhookConfig[];
  /** Notification preferences */
  preferences: NotificationPreferences;
}

/**
 * Slack configuration
 */
export interface SlackConfig {
  /** Slack webhook URL */
  webhookUrl: string;
  /** Default channel (can be overridden per notification) */
  channel?: string;
  /** Bot username */
  username?: string;
  /** Bot icon emoji */
  iconEmoji?: string;
  /** Enable/disable Slack notifications */
  enabled: boolean;
}

/**
 * Discord configuration
 */
export interface DiscordConfig {
  /** Discord webhook URL */
  webhookUrl: string;
  /** Bot username */
  username?: string;
  /** Bot avatar URL */
  avatarUrl?: string;
  /** Enable/disable Discord notifications */
  enabled: boolean;
}

/**
 * Generic webhook configuration
 */
export interface WebhookConfig {
  /** Unique identifier for this webhook */
  id: string;
  /** Webhook name */
  name: string;
  /** Webhook URL */
  url: string;
  /** HTTP method (default: POST) */
  method?: 'POST' | 'PUT';
  /** Custom headers */
  headers?: Record<string, string>;
  /** Authentication type */
  auth?: WebhookAuth;
  /** Enable/disable this webhook */
  enabled: boolean;
  /** Notification types to send to this webhook */
  types?: NotificationType[];
}

/**
 * Webhook authentication
 */
export interface WebhookAuth {
  type: 'bearer' | 'basic' | 'header';
  /** Token for bearer auth */
  token?: string;
  /** Username for basic auth */
  username?: string;
  /** Password for basic auth */
  password?: string;
  /** Header name for header auth */
  headerName?: string;
  /** Header value for header auth */
  headerValue?: string;
}

/**
 * Notification preferences
 */
export interface NotificationPreferences {
  /** Notify on task completion */
  onComplete: boolean;
  /** Notify when blocked/stuck */
  onBlocked: boolean;
  /** Notify when decision needed */
  onDecision: boolean;
  /** Notify when review ready */
  onReviewReady: boolean;
  /** Notify on progress milestones */
  onProgress: boolean;
  /** Notify on errors */
  onError: boolean;
  /** Minimum urgency level to notify */
  minUrgency: NotificationUrgency;
  /** Quiet hours (no notifications) */
  quietHours?: QuietHours;
}

/**
 * Quiet hours configuration
 */
export interface QuietHours {
  /** Enable quiet hours */
  enabled: boolean;
  /** Start time (HH:MM in 24h format) */
  start: string;
  /** End time (HH:MM in 24h format) */
  end: string;
  /** Timezone */
  timezone: string;
  /** Allow urgent notifications during quiet hours */
  allowUrgent: boolean;
}

/**
 * Default notification configuration
 */
export const DEFAULT_NOTIFICATION_CONFIG: NotificationConfig = {
  console: true,
  preferences: {
    onComplete: true,
    onBlocked: true,
    onDecision: true,
    onReviewReady: true,
    onProgress: false,
    onError: true,
    minUrgency: 'low'
  }
};

// =============================================================================
// Notification Types
// =============================================================================

/**
 * Notification type
 */
export type NotificationType =
  | 'complete'      // Task completed
  | 'blocked'       // Task blocked, need help
  | 'decision'      // Decision needed from user
  | 'review_ready'  // Code review ready
  | 'progress'      // Progress milestone
  | 'error'         // Error occurred
  | 'escalation'    // Escalation from CODEX
  | 'approval'      // Approval request
  | 'info';         // General information

/**
 * Notification urgency
 */
export type NotificationUrgency = 'low' | 'normal' | 'high' | 'critical';

/**
 * Notification status
 */
export type NotificationStatus = 'pending' | 'sent' | 'failed' | 'skipped';

/**
 * A notification to send
 */
export interface Notification {
  /** Unique notification ID */
  id: string;
  /** Notification type */
  type: NotificationType;
  /** Urgency level */
  urgency: NotificationUrgency;
  /** Title/subject */
  title: string;
  /** Main message */
  message: string;
  /** Associated task ID */
  taskId?: string;
  /** Task description */
  task?: string;
  /** Short summary */
  summary?: string;
  /** Detailed context */
  context?: string;
  /** Available actions */
  actions?: NotificationAction[];
  /** Additional metadata */
  metadata?: Record<string, unknown>;
  /** Timestamp */
  timestamp: Date;
  /** Channels to send to */
  channels?: NotificationChannel[];
}

/**
 * Notification action
 */
export interface NotificationAction {
  /** Action label */
  label: string;
  /** Action URL (optional) */
  url?: string;
  /** Action style */
  style?: 'primary' | 'secondary' | 'danger';
  /** Action identifier */
  id?: string;
}

/**
 * Notification channel
 */
export type NotificationChannel = 'console' | 'slack' | 'discord' | 'webhook';

// =============================================================================
// Notification Result Types
// =============================================================================

/**
 * Result of sending a notification
 */
export interface NotificationResult {
  /** Notification ID */
  notificationId: string;
  /** Overall status */
  status: NotificationStatus;
  /** Results per channel */
  channelResults: ChannelResult[];
  /** Timestamp */
  timestamp: Date;
  /** Error message if failed */
  error?: string;
}

/**
 * Result of sending to a specific channel
 */
export interface ChannelResult {
  /** Channel type */
  channel: NotificationChannel;
  /** Channel-specific identifier (webhook ID, etc.) */
  channelId?: string;
  /** Send status */
  status: NotificationStatus;
  /** Error message if failed */
  error?: string;
  /** Response from webhook (if any) */
  response?: unknown;
}

// =============================================================================
// Event Types
// =============================================================================

/**
 * Notification event
 */
export interface NotificationEvent {
  /** Event type */
  type: NotificationEventType;
  /** Event timestamp */
  timestamp: Date;
  /** Notification ID */
  notificationId: string;
  /** Event details */
  details: Record<string, unknown>;
}

/**
 * Notification event types
 */
export type NotificationEventType =
  | 'notification_created'
  | 'notification_sent'
  | 'notification_failed'
  | 'notification_skipped'
  | 'channel_error'
  | 'config_updated';

// =============================================================================
// Slack-specific Types
// =============================================================================

/**
 * Slack message payload
 */
export interface SlackMessage {
  text: string;
  channel?: string;
  username?: string;
  icon_emoji?: string;
  attachments?: SlackAttachment[];
  blocks?: SlackBlock[];
}

/**
 * Slack attachment
 */
export interface SlackAttachment {
  color?: string;
  title?: string;
  title_link?: string;
  text?: string;
  fields?: SlackField[];
  footer?: string;
  ts?: number;
}

/**
 * Slack field
 */
export interface SlackField {
  title: string;
  value: string;
  short?: boolean;
}

/**
 * Slack block (simplified)
 */
export interface SlackBlock {
  type: 'section' | 'divider' | 'actions' | 'context' | 'header';
  text?: {
    type: 'plain_text' | 'mrkdwn';
    text: string;
    emoji?: boolean;
  };
  fields?: Array<{
    type: 'plain_text' | 'mrkdwn';
    text: string;
  }>;
  elements?: SlackBlockElement[];
  accessory?: SlackBlockElement;
}

/**
 * Slack block element
 */
export interface SlackBlockElement {
  type: 'button' | 'image' | 'static_select';
  text?: {
    type: 'plain_text';
    text: string;
    emoji?: boolean;
  };
  url?: string;
  action_id?: string;
  style?: 'primary' | 'danger';
  image_url?: string;
  alt_text?: string;
}

// =============================================================================
// Discord-specific Types
// =============================================================================

/**
 * Discord webhook payload
 */
export interface DiscordMessage {
  content?: string;
  username?: string;
  avatar_url?: string;
  embeds?: DiscordEmbed[];
}

/**
 * Discord embed
 */
export interface DiscordEmbed {
  title?: string;
  description?: string;
  url?: string;
  timestamp?: string;
  color?: number;
  footer?: {
    text: string;
    icon_url?: string;
  };
  author?: {
    name: string;
    url?: string;
    icon_url?: string;
  };
  fields?: DiscordField[];
}

/**
 * Discord embed field
 */
export interface DiscordField {
  name: string;
  value: string;
  inline?: boolean;
}

// =============================================================================
// Color Constants
// =============================================================================

/**
 * Colors for notification urgency (hex for Slack, decimal for Discord)
 */
export const URGENCY_COLORS = {
  low: { hex: '#36a64f', decimal: 3581519 },      // Green
  normal: { hex: '#2196f3', decimal: 2201331 },   // Blue
  high: { hex: '#ff9800', decimal: 16750592 },    // Orange
  critical: { hex: '#f44336', decimal: 16007990 } // Red
} as const;

/**
 * Colors for notification types
 */
export const TYPE_COLORS = {
  complete: { hex: '#4caf50', decimal: 5025616 },    // Green
  blocked: { hex: '#f44336', decimal: 16007990 },    // Red
  decision: { hex: '#ff9800', decimal: 16750592 },   // Orange
  review_ready: { hex: '#2196f3', decimal: 2201331 },// Blue
  progress: { hex: '#9c27b0', decimal: 10233520 },   // Purple
  error: { hex: '#f44336', decimal: 16007990 },      // Red
  escalation: { hex: '#ff5722', decimal: 16733986 }, // Deep Orange
  approval: { hex: '#ffc107', decimal: 16761095 },   // Amber
  info: { hex: '#607d8b', decimal: 6323595 }         // Blue Grey
} as const;

/**
 * Emoji for notification types
 */
export const TYPE_EMOJIS: Record<NotificationType, string> = {
  complete: ':white_check_mark:',
  blocked: ':octagonal_sign:',
  decision: ':thinking_face:',
  review_ready: ':mag:',
  progress: ':chart_with_upwards_trend:',
  error: ':x:',
  escalation: ':mega:',
  approval: ':raised_hand:',
  info: ':information_source:'
};
