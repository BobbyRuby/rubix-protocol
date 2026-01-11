/**
 * Configuration Manager
 *
 * Central management for RUBIX configuration.
 * Handles loading, saving, validation, and live updates.
 */

import { existsSync } from 'fs';
import { resolve } from 'path';
import { ConfigLoader } from './ConfigLoader.js';
import {
  CodexConfiguration,
  PartialCodexConfiguration,
  ConfigValidationResult,
  ConfigValidationError,
  ConfigValidationWarning,
  ConfigWatchCallback,
  ConfigChangeEvent,
  DEFAULT_CODEX_CONFIGURATION
} from './types.js';

/**
 * ConfigurationManager
 *
 * Singleton manager for RUBIX configuration.
 * Supports:
 * - Loading from codex.yaml
 * - Saving configuration
 * - Live configuration updates
 * - Validation
 */
export class ConfigurationManager {
  private static instance: ConfigurationManager | null = null;

  private config: CodexConfiguration;
  private loader: ConfigLoader;
  private configPath: string | null = null;
  private watchCallbacks: ConfigWatchCallback[] = [];
  private isWatching: boolean = false;

  constructor() {
    this.config = { ...DEFAULT_CODEX_CONFIGURATION };
    this.loader = new ConfigLoader();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): ConfigurationManager {
    if (!ConfigurationManager.instance) {
      ConfigurationManager.instance = new ConfigurationManager();
    }
    return ConfigurationManager.instance;
  }

  /**
   * Reset singleton instance (for testing)
   */
  static resetInstance(): void {
    if (ConfigurationManager.instance) {
      ConfigurationManager.instance.stopWatching();
    }
    ConfigurationManager.instance = null;
  }

  /**
   * Load configuration from file
   *
   * @param path - Path to codex.yaml (optional, will search if not provided)
   * @returns Loaded configuration
   */
  loadConfig(path?: string): CodexConfiguration {
    // Find config file if path not provided
    const configPath = path || this.loader.findConfigFile();

    if (!configPath) {
      // No config file found, use defaults
      this.config = { ...DEFAULT_CODEX_CONFIGURATION };
      this.configPath = null;
      return this.config;
    }

    if (!existsSync(configPath)) {
      throw new Error(`Configuration file not found: ${configPath}`);
    }

    try {
      const rawConfig = this.loader.loadYaml(configPath);
      this.config = this.loader.parseRawConfig(rawConfig);
      this.configPath = resolve(configPath);

      // Validate after loading
      const validation = this.validateConfig(this.config);
      if (!validation.valid) {
        const errorMessages = validation.errors.map(e => `${e.path}: ${e.message}`);
        throw new Error(`Invalid configuration:\n${errorMessages.join('\n')}`);
      }

      // Log warnings
      for (const warning of validation.warnings) {
        console.warn(`Config warning at ${warning.path}: ${warning.message}`);
        if (warning.suggestion) {
          console.warn(`  Suggestion: ${warning.suggestion}`);
        }
      }

      return this.config;
    } catch (error) {
      if (error instanceof Error && error.message.includes('Invalid configuration')) {
        throw error;
      }
      throw new Error(`Failed to load configuration from ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Save current configuration to file
   *
   * @param path - Path to save to (optional, uses loaded path or default)
   */
  saveConfig(path?: string): void {
    const savePath = path || this.configPath || 'codex.yaml';

    try {
      this.loader.saveYaml(savePath, this.config);
      this.configPath = resolve(savePath);
    } catch (error) {
      throw new Error(`Failed to save configuration to ${savePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): CodexConfiguration {
    return { ...this.config };
  }

  /**
   * Get a specific configuration section
   */
  getSection<K extends keyof CodexConfiguration>(section: K): CodexConfiguration[K] {
    const value = this.config[section];
    if (typeof value === 'object' && value !== null) {
      return { ...value } as CodexConfiguration[K];
    }
    return value;
  }

  /**
   * Update configuration with partial values
   *
   * @param partial - Partial configuration to merge
   */
  setConfig(partial: PartialCodexConfiguration): void {
    const previousConfig = { ...this.config };

    // Deep merge
    this.config = this.mergeWithDefaults({
      ...this.config,
      ...partial,
      escalation: partial.escalation
        ? { ...this.config.escalation, ...partial.escalation }
        : this.config.escalation,
      workMode: partial.workMode
        ? { ...this.config.workMode, ...partial.workMode }
        : this.config.workMode,
      playwright: partial.playwright
        ? { ...this.config.playwright, ...partial.playwright }
        : this.config.playwright,
      review: partial.review
        ? { ...this.config.review, ...partial.review }
        : this.config.review,
      notifications: partial.notifications
        ? { ...this.config.notifications, ...partial.notifications }
        : this.config.notifications,
      memory: partial.memory
        ? { ...this.config.memory, ...partial.memory }
        : this.config.memory
    });

    // Notify watchers
    const changedPaths = this.findChangedPaths(previousConfig, this.config);
    if (changedPaths.length > 0) {
      const event: ConfigChangeEvent = {
        timestamp: new Date(),
        previousConfig,
        newConfig: this.config,
        changedPaths,
        source: 'api'
      };
      this.notifyWatchers(event);
    }
  }

  /**
   * Validate configuration
   *
   * @param config - Configuration to validate
   * @returns Validation result with errors and warnings
   */
  validateConfig(config: CodexConfiguration): ConfigValidationResult {
    const errors: ConfigValidationError[] = [];
    const warnings: ConfigValidationWarning[] = [];

    // Version validation
    if (!config.version || typeof config.version !== 'string') {
      errors.push({
        path: 'version',
        message: 'Version is required and must be a string',
        value: config.version
      });
    }

    // Escalation validation
    if (config.escalation.maxAttemptsBeforeEscalate < 1) {
      errors.push({
        path: 'escalation.maxAttemptsBeforeEscalate',
        message: 'Must be at least 1',
        value: config.escalation.maxAttemptsBeforeEscalate
      });
    }
    if (config.escalation.maxAttemptsBeforeEscalate > 10) {
      warnings.push({
        path: 'escalation.maxAttemptsBeforeEscalate',
        message: 'High value may cause long delays before escalation',
        suggestion: 'Consider using 3-5 for most use cases'
      });
    }

    // Playwright validation
    if (config.playwright.timeout < 1000) {
      errors.push({
        path: 'playwright.timeout',
        message: 'Timeout must be at least 1000ms',
        value: config.playwright.timeout
      });
    }
    if (config.playwright.timeout > 300000) {
      warnings.push({
        path: 'playwright.timeout',
        message: 'Very high timeout (>5 minutes)',
        suggestion: 'Consider using 30000-60000ms for most use cases'
      });
    }
    if (!['headless', 'visible'].includes(config.playwright.defaultMode)) {
      errors.push({
        path: 'playwright.defaultMode',
        message: 'Must be either "headless" or "visible"',
        value: config.playwright.defaultMode
      });
    }

    // Memory validation
    if (config.memory.pruneAfterDays < 1) {
      errors.push({
        path: 'memory.pruneAfterDays',
        message: 'Must be at least 1 day',
        value: config.memory.pruneAfterDays
      });
    }
    if (config.memory.pruneAfterDays < 7) {
      warnings.push({
        path: 'memory.pruneAfterDays',
        message: 'Very short retention period',
        suggestion: 'Consider at least 30 days for useful learning'
      });
    }

    // Notifications validation
    if (config.notifications.slack) {
      if (!config.notifications.slack.webhookUrl.startsWith('https://hooks.slack.com/')) {
        warnings.push({
          path: 'notifications.slack.webhookUrl',
          message: 'Webhook URL does not appear to be a valid Slack webhook',
          suggestion: 'Slack webhooks typically start with https://hooks.slack.com/'
        });
      }
    }
    if (config.notifications.discord) {
      if (!config.notifications.discord.webhookUrl.startsWith('https://discord.com/api/webhooks/')) {
        warnings.push({
          path: 'notifications.discord.webhookUrl',
          message: 'Webhook URL does not appear to be a valid Discord webhook',
          suggestion: 'Discord webhooks typically start with https://discord.com/api/webhooks/'
        });
      }
    }

    // Review patterns validation
    for (const pattern of config.review.requireHumanReview) {
      if (!pattern.includes('*') && !existsSync(pattern)) {
        warnings.push({
          path: 'review.requireHumanReview',
          message: `Pattern "${pattern}" is not a glob and file does not exist`,
          suggestion: 'Use glob patterns like "*.env*" or ensure file exists'
        });
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Get default configuration
   */
  getDefault(): CodexConfiguration {
    return { ...DEFAULT_CODEX_CONFIGURATION };
  }

  /**
   * Merge partial configuration with defaults
   *
   * @param partial - Partial configuration
   * @returns Complete configuration with defaults filled in
   */
  mergeWithDefaults(partial: PartialCodexConfiguration): CodexConfiguration {
    return {
      version: partial.version || DEFAULT_CODEX_CONFIGURATION.version,

      escalation: {
        maxAttemptsBeforeEscalate:
          partial.escalation?.maxAttemptsBeforeEscalate ??
          DEFAULT_CODEX_CONFIGURATION.escalation.maxAttemptsBeforeEscalate,
        autonomousDecisions:
          partial.escalation?.autonomousDecisions ??
          DEFAULT_CODEX_CONFIGURATION.escalation.autonomousDecisions,
        requireApproval:
          partial.escalation?.requireApproval ??
          DEFAULT_CODEX_CONFIGURATION.escalation.requireApproval
      },

      workMode: {
        notifyOnProgress:
          partial.workMode?.notifyOnProgress ??
          DEFAULT_CODEX_CONFIGURATION.workMode.notifyOnProgress,
        notifyOnComplete:
          partial.workMode?.notifyOnComplete ??
          DEFAULT_CODEX_CONFIGURATION.workMode.notifyOnComplete,
        notifyOnBlocked:
          partial.workMode?.notifyOnBlocked ??
          DEFAULT_CODEX_CONFIGURATION.workMode.notifyOnBlocked,
        batchDecisions:
          partial.workMode?.batchDecisions ??
          DEFAULT_CODEX_CONFIGURATION.workMode.batchDecisions,
        deepWorkDefault:
          partial.workMode?.deepWorkDefault ??
          DEFAULT_CODEX_CONFIGURATION.workMode.deepWorkDefault
      },

      playwright: {
        defaultMode:
          partial.playwright?.defaultMode ??
          DEFAULT_CODEX_CONFIGURATION.playwright.defaultMode,
        screenshotOnFailure:
          partial.playwright?.screenshotOnFailure ??
          DEFAULT_CODEX_CONFIGURATION.playwright.screenshotOnFailure,
        captureConsole:
          partial.playwright?.captureConsole ??
          DEFAULT_CODEX_CONFIGURATION.playwright.captureConsole,
        timeout:
          partial.playwright?.timeout ??
          DEFAULT_CODEX_CONFIGURATION.playwright.timeout
      },

      review: {
        autoReview:
          partial.review?.autoReview ??
          DEFAULT_CODEX_CONFIGURATION.review.autoReview,
        securityScan:
          partial.review?.securityScan ??
          DEFAULT_CODEX_CONFIGURATION.review.securityScan,
        requireHumanReview:
          partial.review?.requireHumanReview ??
          DEFAULT_CODEX_CONFIGURATION.review.requireHumanReview,
        autoApproveIf:
          partial.review?.autoApproveIf ??
          DEFAULT_CODEX_CONFIGURATION.review.autoApproveIf
      },

      notifications: {
        console:
          partial.notifications?.console ??
          DEFAULT_CODEX_CONFIGURATION.notifications.console,
        slack: partial.notifications?.slack ?? DEFAULT_CODEX_CONFIGURATION.notifications.slack,
        discord: partial.notifications?.discord ?? DEFAULT_CODEX_CONFIGURATION.notifications.discord
      },

      memory: {
        storeFailures:
          partial.memory?.storeFailures ??
          DEFAULT_CODEX_CONFIGURATION.memory.storeFailures,
        storeSuccesses:
          partial.memory?.storeSuccesses ??
          DEFAULT_CODEX_CONFIGURATION.memory.storeSuccesses,
        pruneAfterDays:
          partial.memory?.pruneAfterDays ??
          DEFAULT_CODEX_CONFIGURATION.memory.pruneAfterDays
      }
    };
  }

  /**
   * Reset configuration to defaults
   */
  resetToDefaults(): void {
    const previousConfig = { ...this.config };
    this.config = { ...DEFAULT_CODEX_CONFIGURATION };

    const event: ConfigChangeEvent = {
      timestamp: new Date(),
      previousConfig,
      newConfig: this.config,
      changedPaths: ['root'],
      source: 'reset'
    };
    this.notifyWatchers(event);
  }

  /**
   * Watch for configuration changes
   *
   * @param callback - Callback to invoke on changes
   */
  watchConfig(callback: ConfigWatchCallback): void {
    this.watchCallbacks.push(callback);

    // Start file watching if we have a config path
    if (this.configPath && !this.isWatching) {
      this.loader.watchConfigFile(
        this.configPath,
        (event) => {
          this.config = event.newConfig;
          this.notifyWatchers(event);
        },
        this.config
      );
      this.isWatching = true;
    }
  }

  /**
   * Stop watching configuration
   */
  stopWatching(): void {
    if (this.configPath && this.isWatching) {
      this.loader.unwatchConfigFile(this.configPath);
      this.isWatching = false;
    }
    this.watchCallbacks = [];
  }

  /**
   * Get current config file path
   */
  getConfigPath(): string | null {
    return this.configPath;
  }

  /**
   * Check if a decision type is autonomous
   */
  isAutonomousDecision(decisionType: string): boolean {
    return this.config.escalation.autonomousDecisions.includes(decisionType);
  }

  /**
   * Check if a decision type requires approval
   */
  requiresApproval(decisionType: string): boolean {
    return this.config.escalation.requireApproval.includes(decisionType);
  }

  /**
   * Check if a file requires human review
   */
  requiresHumanReview(filePath: string): boolean {
    const patterns = this.config.review.requireHumanReview;

    for (const pattern of patterns) {
      // Simple glob matching
      if (pattern.includes('*')) {
        const regex = new RegExp(
          '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$'
        );
        if (regex.test(filePath)) {
          return true;
        }
      } else if (filePath.includes(pattern)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get notification settings summary
   */
  getNotificationSettings(): {
    console: boolean;
    slack: boolean;
    discord: boolean;
    onProgress: boolean;
    onComplete: boolean;
    onBlocked: boolean;
  } {
    return {
      console: this.config.notifications.console,
      slack: !!this.config.notifications.slack,
      discord: !!this.config.notifications.discord,
      onProgress: this.config.workMode.notifyOnProgress,
      onComplete: this.config.workMode.notifyOnComplete,
      onBlocked: this.config.workMode.notifyOnBlocked
    };
  }

  /**
   * Notify all watchers of a change
   */
  private notifyWatchers(event: ConfigChangeEvent): void {
    for (const callback of this.watchCallbacks) {
      try {
        callback(event);
      } catch (error) {
        console.error('Config watch callback error:', error);
      }
    }
  }

  /**
   * Find paths that changed between two configs
   */
  private findChangedPaths(
    prev: CodexConfiguration,
    next: CodexConfiguration
  ): string[] {
    const changes: string[] = [];

    const checkChanges = (p: unknown, n: unknown, path: string): void => {
      if (p === n) return;

      if (typeof p !== typeof n) {
        changes.push(path);
        return;
      }

      if (Array.isArray(p) && Array.isArray(n)) {
        if (p.length !== n.length || p.some((v, i) => v !== n[i])) {
          changes.push(path);
        }
        return;
      }

      if (typeof p === 'object' && p !== null && typeof n === 'object' && n !== null) {
        const pObj = p as Record<string, unknown>;
        const nObj = n as Record<string, unknown>;
        const keys = new Set([...Object.keys(pObj), ...Object.keys(nObj)]);
        for (const key of keys) {
          checkChanges(pObj[key], nObj[key], path ? `${path}.${key}` : key);
        }
        return;
      }

      if (p !== n) {
        changes.push(path);
      }
    };

    checkChanges(prev, next, '');
    return changes;
  }
}
