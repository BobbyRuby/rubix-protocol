/**
 * Configuration Types for CODEX
 *
 * Type definitions for the codex.yaml configuration system.
 * Provides comprehensive typing for all configurable aspects of the
 * autonomous developer agent.
 */

/**
 * Work mode configuration
 * Controls notification behavior and deep work defaults
 */
export interface WorkModeConfig {
  /** Notify on task progress updates */
  notifyOnProgress: boolean;
  /** Notify when task completes */
  notifyOnComplete: boolean;
  /** Notify when task is blocked */
  notifyOnBlocked: boolean;
  /** Batch multiple decisions together */
  batchDecisions: boolean;
  /** Default to deep work mode (minimal interruptions) */
  deepWorkDefault: boolean;
}

/**
 * Escalation configuration
 * Controls when and how CODEX escalates to humans
 */
export interface EscalationConfig {
  /** Maximum attempts before escalating to user */
  maxAttemptsBeforeEscalate: number;
  /** Decision types that CODEX can make autonomously */
  autonomousDecisions: string[];
  /** Decision types that always require user approval */
  requireApproval: string[];
}

/**
 * Playwright browser configuration
 * Controls browser automation behavior
 */
export interface PlaywrightConfig {
  /** Default browser mode */
  defaultMode: 'headless' | 'visible';
  /** Take screenshot on failure */
  screenshotOnFailure: boolean;
  /** Capture console output */
  captureConsole: boolean;
  /** Default timeout in milliseconds */
  timeout: number;
}

/**
 * Code review configuration
 * Controls automatic code review behavior
 */
export interface ReviewConfig {
  /** Automatically review changes */
  autoReview: boolean;
  /** Run security scans */
  securityScan: boolean;
  /** File patterns that always require human review */
  requireHumanReview: string[];
  /** Conditions for auto-approval */
  autoApproveIf: string[];
}

/**
 * Slack notification configuration
 */
export interface SlackConfig {
  /** Slack webhook URL */
  webhookUrl: string;
  /** Default channel */
  channel?: string;
  /** Bot username */
  username?: string;
  /** Bot icon emoji */
  iconEmoji?: string;
}

/**
 * Discord notification configuration
 */
export interface DiscordConfig {
  /** Discord webhook URL */
  webhookUrl: string;
  /** Bot username */
  username?: string;
  /** Bot avatar URL */
  avatarUrl?: string;
}

/**
 * Notifications configuration
 * Controls where and how notifications are sent
 */
export interface NotificationsConfig {
  /** Enable console notifications */
  console: boolean;
  /** Slack integration */
  slack?: SlackConfig;
  /** Discord integration */
  discord?: DiscordConfig;
}

/**
 * Memory configuration
 * Controls what is stored in memory and retention
 */
export interface MemoryConfig {
  /** Store failed attempts in memory */
  storeFailures: boolean;
  /** Store successful attempts in memory */
  storeSuccesses: boolean;
  /** Days before pruning old entries */
  pruneAfterDays: number;
}

/**
 * Phone channel configuration (CallMe integration)
 */
export interface PhoneChannelConfig {
  /** Enable phone channel */
  enabled: boolean;
  /** Phone provider (callme) */
  provider: 'callme';
  /** Phone number to call */
  phoneNumber: string;
}

/**
 * SMS channel configuration (Twilio/Telnyx)
 */
export interface SMSChannelConfig {
  /** Enable SMS channel */
  enabled: boolean;
  /** SMS provider */
  provider: 'twilio' | 'telnyx';
  /** User's phone number */
  phoneNumber: string;
  /** Provider account SID */
  accountSid: string;
  /** Provider auth token */
  authToken: string;
  /** From phone number */
  fromNumber: string;
}

/**
 * Slack channel configuration (bidirectional)
 */
export interface SlackChannelConfig {
  /** Enable Slack channel */
  enabled: boolean;
  /** Slack webhook URL */
  webhookUrl: string;
  /** Bot token for receiving messages */
  botToken?: string;
  /** Channel for responses */
  responseChannel?: string;
}

/**
 * Discord channel configuration (bidirectional)
 */
export interface DiscordChannelConfig {
  /** Enable Discord channel */
  enabled: boolean;
  /** Discord webhook URL */
  webhookUrl: string;
  /** Bot token for receiving messages */
  botToken?: string;
  /** Channel ID for responses */
  responseChannelId?: string;
}

/**
 * Email channel configuration (SMTP/IMAP)
 */
export interface EmailChannelConfig {
  /** Enable email channel */
  enabled: boolean;
  /** SMTP settings */
  smtp: {
    host: string;
    port: number;
    auth: {
      user: string;
      pass: string;
    };
  };
  /** IMAP settings for receiving replies */
  imap?: {
    host: string;
    port: number;
    auth: {
      user: string;
      pass: string;
    };
  };
  /** From email address */
  fromAddress: string;
  /** To email address */
  toAddress: string;
}

/**
 * Webhook server configuration
 */
export interface WebhookServerConfig {
  /** Server port */
  port: number;
  /** Public URL for callbacks (e.g., ngrok URL) */
  publicUrl?: string;
}

/**
 * Channel type for fallback order
 */
export type CommunicationChannelType = 'phone' | 'sms' | 'slack' | 'discord' | 'email';

/**
 * Communications configuration
 * Controls escalation fallback chain
 */
export interface CommunicationsConfig {
  /** Enable communications */
  enabled: boolean;
  /** Fallback order for channels */
  fallbackOrder: CommunicationChannelType[];
  /** Timeout per channel in ms (default: 300000 = 5 min) */
  timeoutMs: number;
  /** Number of retry attempts per channel */
  retryAttempts: number;

  /** Webhook server configuration */
  webhookServer: WebhookServerConfig;

  /** Phone channel (CallMe) */
  phone?: PhoneChannelConfig;
  /** SMS channel (Twilio/Telnyx) */
  sms?: SMSChannelConfig;
  /** Slack channel (bidirectional) */
  slack?: SlackChannelConfig;
  /** Discord channel (bidirectional) */
  discord?: DiscordChannelConfig;
  /** Email channel (SMTP/IMAP) */
  email?: EmailChannelConfig;
}

/**
 * Main CODEX Configuration
 *
 * Comprehensive configuration for the autonomous developer agent.
 * Can be loaded from codex.yaml or configured programmatically.
 */
export interface CodexConfiguration {
  /** Configuration version */
  version: string;

  /** Escalation behavior */
  escalation: EscalationConfig;

  /** Work mode settings */
  workMode: WorkModeConfig;

  /** Playwright browser automation */
  playwright: PlaywrightConfig;

  /** Code review settings */
  review: ReviewConfig;

  /** Notification settings */
  notifications: NotificationsConfig;

  /** Memory retention settings */
  memory: MemoryConfig;

  /** Communication escalation settings */
  communications?: CommunicationsConfig;
}

/**
 * Partial configuration for updates
 */
export type PartialCodexConfiguration = {
  version?: string;
  escalation?: Partial<EscalationConfig>;
  workMode?: Partial<WorkModeConfig>;
  playwright?: Partial<PlaywrightConfig>;
  review?: Partial<ReviewConfig>;
  notifications?: Partial<NotificationsConfig>;
  memory?: Partial<MemoryConfig>;
  communications?: Partial<CommunicationsConfig>;
};

/**
 * Configuration validation result
 */
export interface ConfigValidationResult {
  valid: boolean;
  errors: ConfigValidationError[];
  warnings: ConfigValidationWarning[];
}

/**
 * Configuration validation error
 */
export interface ConfigValidationError {
  path: string;
  message: string;
  value?: unknown;
}

/**
 * Configuration validation warning
 */
export interface ConfigValidationWarning {
  path: string;
  message: string;
  suggestion?: string;
}

/**
 * Configuration change event
 */
export interface ConfigChangeEvent {
  timestamp: Date;
  previousConfig: CodexConfiguration;
  newConfig: CodexConfiguration;
  changedPaths: string[];
  source: 'file' | 'api' | 'reset';
}

/**
 * Configuration watcher callback
 */
export type ConfigWatchCallback = (event: ConfigChangeEvent) => void;

/**
 * Default configuration values
 */
export const DEFAULT_CODEX_CONFIGURATION: CodexConfiguration = {
  version: '1.0.0',

  escalation: {
    maxAttemptsBeforeEscalate: 3,
    autonomousDecisions: [
      'dependency_minor_versions',
      'code_formatting',
      'variable_naming',
      'test_structure',
      'import_organization',
      'comment_style'
    ],
    requireApproval: [
      'database_schema_changes',
      'api_breaking_changes',
      'new_dependencies',
      'architecture_changes',
      'security_sensitive_changes',
      'production_deployment'
    ]
  },

  workMode: {
    notifyOnProgress: false,
    notifyOnComplete: true,
    notifyOnBlocked: true,
    batchDecisions: true,
    deepWorkDefault: true
  },

  playwright: {
    defaultMode: 'headless',
    screenshotOnFailure: true,
    captureConsole: true,
    timeout: 30000
  },

  review: {
    autoReview: true,
    securityScan: true,
    requireHumanReview: [
      '*.env*',
      '*credentials*',
      '*secret*',
      '*password*',
      'config/production*'
    ],
    autoApproveIf: [
      'only_formatting_changes',
      'only_comment_changes',
      'test_file_only'
    ]
  },

  notifications: {
    console: true,
    slack: undefined,
    discord: undefined
  },

  memory: {
    storeFailures: true,
    storeSuccesses: true,
    pruneAfterDays: 90
  }
};
