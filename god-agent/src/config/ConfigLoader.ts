/**
 * Configuration Loader
 *
 * Handles loading and saving YAML configuration files.
 * Provides file watching for live configuration updates.
 */

import { readFileSync, writeFileSync, existsSync, watchFile, unwatchFile, statSync } from 'fs';
import { join, dirname, resolve } from 'path';
import type { CodexConfiguration, ConfigWatchCallback, ConfigChangeEvent } from './types.js';

/**
 * Simple YAML parser (handles our config structure without external deps)
 * Supports:
 * - Key-value pairs
 * - Nested objects (indentation-based)
 * - Arrays (dash prefix)
 * - Strings, numbers, booleans
 * - Comments (# prefix)
 */
function parseYaml(content: string): Record<string, unknown> {
  const lines = content.split('\n');
  const result: Record<string, unknown> = {};
  const stack: Array<{ obj: Record<string, unknown>; indent: number }> = [{ obj: result, indent: -1 }];
  let currentArray: unknown[] | null = null;
  let currentArrayIndent: number = -1;

  for (const line of lines) {
    // Skip empty lines and comments
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    // Calculate indentation
    const indent = line.search(/\S/);

    // Check if array item
    if (trimmed.startsWith('- ')) {
      const value = trimmed.substring(2).trim();
      if (currentArray !== null && indent >= currentArrayIndent) {
        (currentArray as unknown[]).push(parseValue(value));
      }
      continue;
    }

    // Check for key-value pair
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex === -1) continue;

    const key = trimmed.substring(0, colonIndex).trim();
    const valueStr = trimmed.substring(colonIndex + 1).trim();

    // Close array if we moved out
    if (currentArray && indent <= currentArrayIndent) {
      currentArray = null;
      currentArrayIndent = -1;
    }

    // Pop stack if we moved out of nesting
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1].obj;

    if (valueStr === '' || valueStr === '|' || valueStr === '>') {
      // Nested object or start of array
      const newObj: Record<string, unknown> = {};
      parent[key] = newObj;
      stack.push({ obj: newObj, indent });
    } else if (valueStr === '[]') {
      // Empty array
      parent[key] = [];
    } else if (key && colonIndex === trimmed.length - 1) {
      // Key with no value, might be start of nested object
      const newObj: Record<string, unknown> = {};
      parent[key] = newObj;
      stack.push({ obj: newObj, indent });
    } else {
      // Regular key-value
      parent[key] = parseValue(valueStr);
    }

    // Check for array start in next line (peek ahead)
    if (valueStr === '') {
      // Mark potential array start
      currentArrayIndent = indent;
    }
  }

  // Second pass: find arrays that were marked as objects
  fixArrays(result);

  return result;
}

/**
 * Fix arrays that were incorrectly parsed as empty objects
 */
function fixArrays(obj: Record<string, unknown>): void {
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (value && typeof value === 'object') {
      if (Array.isArray(value)) {
        continue;
      }
      const record = value as Record<string, unknown>;
      if (Object.keys(record).length === 0) {
        // Empty object might be an array
        continue;
      }
      fixArrays(record);
    }
  }
}

/**
 * Parse a YAML value string to appropriate type
 */
function parseValue(str: string): unknown {
  // Remove quotes
  if ((str.startsWith('"') && str.endsWith('"')) ||
      (str.startsWith("'") && str.endsWith("'"))) {
    return str.slice(1, -1);
  }

  // Boolean
  if (str === 'true') return true;
  if (str === 'false') return false;

  // Null
  if (str === 'null' || str === '~') return null;

  // Number
  const num = Number(str);
  if (!isNaN(num) && str !== '') return num;

  // Array inline [item1, item2]
  if (str.startsWith('[') && str.endsWith(']')) {
    const inner = str.slice(1, -1);
    if (inner === '') return [];
    return inner.split(',').map(s => parseValue(s.trim()));
  }

  // String
  return str;
}

/**
 * ConfigLoader class
 *
 * Handles loading and saving YAML configuration files.
 */
export class ConfigLoader {
  private watchers: Map<string, ConfigWatchCallback[]> = new Map();
  private lastConfig: CodexConfiguration | null = null;
  private watchInterval: NodeJS.Timeout | null = null;

  /**
   * Load configuration from a YAML file
   */
  loadYaml(path: string): Record<string, unknown> {
    if (!existsSync(path)) {
      throw new Error(`Configuration file not found: ${path}`);
    }

    const content = readFileSync(path, 'utf-8');
    return parseYaml(content);
  }

  /**
   * Save configuration to a YAML file
   */
  saveYaml(path: string, config: CodexConfiguration): void {
    const yamlContent = this.generateYaml(config);
    writeFileSync(path, yamlContent, 'utf-8');
  }

  /**
   * Generate YAML content from configuration
   */
  generateYaml(config: CodexConfiguration): string {
    let yaml = `# RUBIX Configuration
# Version: ${config.version}
# Generated: ${new Date().toISOString()}

version: "${config.version}"

# Escalation Settings
# Controls when RUBIX asks for human help
escalation:
  maxAttemptsBeforeEscalate: ${config.escalation.maxAttemptsBeforeEscalate}
  autonomousDecisions:
`;

    for (const decision of config.escalation.autonomousDecisions) {
      yaml += `    - ${decision}\n`;
    }

    yaml += `  requireApproval:
`;
    for (const approval of config.escalation.requireApproval) {
      yaml += `    - ${approval}\n`;
    }

    // Add autoDecision config if present
    if (config.escalation.autoDecision) {
      yaml += `  # Auto-decision settings for timeout scenarios
  autoDecision:
    enabled: ${config.escalation.autoDecision.enabled}
    primaryTimeoutMs: ${config.escalation.autoDecision.primaryTimeoutMs}
    overrideWindowMs: ${config.escalation.autoDecision.overrideWindowMs}
    strategy: "${config.escalation.autoDecision.strategy}"
    notifyUser: ${config.escalation.autoDecision.notifyUser}
`;
    }

    yaml += `
# Work Mode Settings
# Controls notification behavior and interruptions
workMode:
  notifyOnProgress: ${config.workMode.notifyOnProgress}
  notifyOnComplete: ${config.workMode.notifyOnComplete}
  notifyOnBlocked: ${config.workMode.notifyOnBlocked}
  batchDecisions: ${config.workMode.batchDecisions}
  deepWorkDefault: ${config.workMode.deepWorkDefault}

# Playwright Browser Settings
# Controls browser automation for verification
playwright:
  defaultMode: ${config.playwright.defaultMode}
  screenshotOnFailure: ${config.playwright.screenshotOnFailure}
  captureConsole: ${config.playwright.captureConsole}
  timeout: ${config.playwright.timeout}

# Code Review Settings
# Controls automatic code review behavior
review:
  autoReview: ${config.review.autoReview}
  securityScan: ${config.review.securityScan}
  requireHumanReview:
`;

    for (const pattern of config.review.requireHumanReview) {
      yaml += `    - "${pattern}"\n`;
    }

    yaml += `  autoApproveIf:
`;
    for (const condition of config.review.autoApproveIf) {
      yaml += `    - ${condition}\n`;
    }

    yaml += `
# Notification Settings
# Where to send notifications
notifications:
  console: ${config.notifications.console}
`;

    if (config.notifications.slack) {
      yaml += `  slack:
    webhookUrl: "${config.notifications.slack.webhookUrl}"
`;
      if (config.notifications.slack.channel) {
        yaml += `    channel: "${config.notifications.slack.channel}"\n`;
      }
      if (config.notifications.slack.username) {
        yaml += `    username: "${config.notifications.slack.username}"\n`;
      }
      if (config.notifications.slack.iconEmoji) {
        yaml += `    iconEmoji: "${config.notifications.slack.iconEmoji}"\n`;
      }
    }

    if (config.notifications.discord) {
      yaml += `  discord:
    webhookUrl: "${config.notifications.discord.webhookUrl}"
`;
      if (config.notifications.discord.username) {
        yaml += `    username: "${config.notifications.discord.username}"\n`;
      }
      if (config.notifications.discord.avatarUrl) {
        yaml += `    avatarUrl: "${config.notifications.discord.avatarUrl}"\n`;
      }
    }

    yaml += `
# Memory Settings
# Controls what is stored and retention
memory:
  storeFailures: ${config.memory.storeFailures}
  storeSuccesses: ${config.memory.storeSuccesses}
  pruneAfterDays: ${config.memory.pruneAfterDays}
`;

    return yaml;
  }

  /**
   * Find configuration file in current directory and parent directories
   */
  findConfigFile(startDir?: string): string | null {
    const configNames = ['codex.yaml', 'codex.yml', '.codex.yaml', '.codex.yml'];
    let currentDir = startDir || process.cwd();

    // Search up to 10 levels
    for (let i = 0; i < 10; i++) {
      for (const name of configNames) {
        const configPath = join(currentDir, name);
        if (existsSync(configPath)) {
          return configPath;
        }
      }

      const parentDir = dirname(currentDir);
      if (parentDir === currentDir) {
        // Reached root
        break;
      }
      currentDir = parentDir;
    }

    return null;
  }

  /**
   * Watch a configuration file for changes
   */
  watchConfigFile(
    path: string,
    callback: ConfigWatchCallback,
    config: CodexConfiguration
  ): void {
    const absolutePath = resolve(path);

    // Initialize last config
    this.lastConfig = config;

    // Add callback to list
    const callbacks = this.watchers.get(absolutePath) || [];
    callbacks.push(callback);
    this.watchers.set(absolutePath, callbacks);

    // Start watching if not already
    if (callbacks.length === 1) {
      let lastMtime = 0;
      try {
        lastMtime = statSync(absolutePath).mtimeMs;
      } catch {
        // File might not exist yet
      }

      // Poll-based watching for cross-platform compatibility
      this.watchInterval = setInterval(() => {
        try {
          const currentMtime = statSync(absolutePath).mtimeMs;
          if (currentMtime > lastMtime) {
            lastMtime = currentMtime;
            this.handleFileChange(absolutePath);
          }
        } catch {
          // File might be temporarily unavailable
        }
      }, 1000);

      // Also use native file watching as backup
      watchFile(absolutePath, { interval: 1000 }, (curr, prev) => {
        if (curr.mtime > prev.mtime) {
          this.handleFileChange(absolutePath);
        }
      });
    }
  }

  /**
   * Handle file change event
   */
  private handleFileChange(path: string): void {
    const callbacks = this.watchers.get(path);
    if (!callbacks || callbacks.length === 0) return;

    try {
      const rawConfig = this.loadYaml(path);
      const newConfig = this.parseRawConfig(rawConfig);

      const changedPaths = this.findChangedPaths(this.lastConfig, newConfig);

      if (changedPaths.length === 0) return;

      const event: ConfigChangeEvent = {
        timestamp: new Date(),
        previousConfig: this.lastConfig!,
        newConfig,
        changedPaths,
        source: 'file'
      };

      this.lastConfig = newConfig;

      for (const callback of callbacks) {
        try {
          callback(event);
        } catch (error) {
          console.error('Config watch callback error:', error);
        }
      }
    } catch (error) {
      console.error('Error reloading config:', error);
    }
  }

  /**
   * Stop watching a configuration file
   */
  unwatchConfigFile(path: string): void {
    const absolutePath = resolve(path);
    this.watchers.delete(absolutePath);
    unwatchFile(absolutePath);
    if (this.watchInterval) {
      clearInterval(this.watchInterval);
      this.watchInterval = null;
    }
  }

  /**
   * Parse raw YAML config to typed configuration
   */
  parseRawConfig(raw: Record<string, unknown>): CodexConfiguration {
    const { DEFAULT_CODEX_CONFIGURATION } = require('./types.js');

    // Deep merge with defaults
    return {
      version: String(raw.version || DEFAULT_CODEX_CONFIGURATION.version),

      escalation: {
        maxAttemptsBeforeEscalate: this.getNumber(
          raw.escalation,
          'maxAttemptsBeforeEscalate',
          DEFAULT_CODEX_CONFIGURATION.escalation.maxAttemptsBeforeEscalate
        ),
        autonomousDecisions: this.getStringArray(
          raw.escalation,
          'autonomousDecisions',
          DEFAULT_CODEX_CONFIGURATION.escalation.autonomousDecisions
        ),
        requireApproval: this.getStringArray(
          raw.escalation,
          'requireApproval',
          DEFAULT_CODEX_CONFIGURATION.escalation.requireApproval
        ),
        autoDecision: this.parseAutoDecisionConfig(raw.escalation)
      },

      workMode: {
        notifyOnProgress: this.getBoolean(
          raw.workMode,
          'notifyOnProgress',
          DEFAULT_CODEX_CONFIGURATION.workMode.notifyOnProgress
        ),
        notifyOnComplete: this.getBoolean(
          raw.workMode,
          'notifyOnComplete',
          DEFAULT_CODEX_CONFIGURATION.workMode.notifyOnComplete
        ),
        notifyOnBlocked: this.getBoolean(
          raw.workMode,
          'notifyOnBlocked',
          DEFAULT_CODEX_CONFIGURATION.workMode.notifyOnBlocked
        ),
        batchDecisions: this.getBoolean(
          raw.workMode,
          'batchDecisions',
          DEFAULT_CODEX_CONFIGURATION.workMode.batchDecisions
        ),
        deepWorkDefault: this.getBoolean(
          raw.workMode,
          'deepWorkDefault',
          DEFAULT_CODEX_CONFIGURATION.workMode.deepWorkDefault
        )
      },

      playwright: {
        defaultMode: this.getString(
          raw.playwright,
          'defaultMode',
          DEFAULT_CODEX_CONFIGURATION.playwright.defaultMode
        ) as 'headless' | 'visible',
        screenshotOnFailure: this.getBoolean(
          raw.playwright,
          'screenshotOnFailure',
          DEFAULT_CODEX_CONFIGURATION.playwright.screenshotOnFailure
        ),
        captureConsole: this.getBoolean(
          raw.playwright,
          'captureConsole',
          DEFAULT_CODEX_CONFIGURATION.playwright.captureConsole
        ),
        timeout: this.getNumber(
          raw.playwright,
          'timeout',
          DEFAULT_CODEX_CONFIGURATION.playwright.timeout
        )
      },

      review: {
        autoReview: this.getBoolean(
          raw.review,
          'autoReview',
          DEFAULT_CODEX_CONFIGURATION.review.autoReview
        ),
        securityScan: this.getBoolean(
          raw.review,
          'securityScan',
          DEFAULT_CODEX_CONFIGURATION.review.securityScan
        ),
        requireHumanReview: this.getStringArray(
          raw.review,
          'requireHumanReview',
          DEFAULT_CODEX_CONFIGURATION.review.requireHumanReview
        ),
        autoApproveIf: this.getStringArray(
          raw.review,
          'autoApproveIf',
          DEFAULT_CODEX_CONFIGURATION.review.autoApproveIf
        )
      },

      notifications: {
        console: this.getBoolean(
          raw.notifications,
          'console',
          DEFAULT_CODEX_CONFIGURATION.notifications.console
        ),
        slack: this.parseSlackConfig(raw.notifications),
        discord: this.parseDiscordConfig(raw.notifications)
      },

      memory: {
        storeFailures: this.getBoolean(
          raw.memory,
          'storeFailures',
          DEFAULT_CODEX_CONFIGURATION.memory.storeFailures
        ),
        storeSuccesses: this.getBoolean(
          raw.memory,
          'storeSuccesses',
          DEFAULT_CODEX_CONFIGURATION.memory.storeSuccesses
        ),
        pruneAfterDays: this.getNumber(
          raw.memory,
          'pruneAfterDays',
          DEFAULT_CODEX_CONFIGURATION.memory.pruneAfterDays
        )
      }
    };
  }

  /**
   * Parse Slack configuration
   */
  private parseSlackConfig(notifications: unknown): { webhookUrl: string; channel?: string; username?: string; iconEmoji?: string } | undefined {
    if (!notifications || typeof notifications !== 'object') return undefined;
    const notif = notifications as Record<string, unknown>;
    const slack = notif.slack;
    if (!slack || typeof slack !== 'object') return undefined;
    const slackObj = slack as Record<string, unknown>;
    const webhookUrl = slackObj.webhookUrl;
    if (!webhookUrl || typeof webhookUrl !== 'string') return undefined;
    return {
      webhookUrl,
      channel: typeof slackObj.channel === 'string' ? slackObj.channel : undefined,
      username: typeof slackObj.username === 'string' ? slackObj.username : undefined,
      iconEmoji: typeof slackObj.iconEmoji === 'string' ? slackObj.iconEmoji : undefined
    };
  }

  /**
   * Parse Discord configuration
   */
  private parseDiscordConfig(notifications: unknown): { webhookUrl: string; username?: string; avatarUrl?: string } | undefined {
    if (!notifications || typeof notifications !== 'object') return undefined;
    const notif = notifications as Record<string, unknown>;
    const discord = notif.discord;
    if (!discord || typeof discord !== 'object') return undefined;
    const discordObj = discord as Record<string, unknown>;
    const webhookUrl = discordObj.webhookUrl;
    if (!webhookUrl || typeof webhookUrl !== 'string') return undefined;
    return {
      webhookUrl,
      username: typeof discordObj.username === 'string' ? discordObj.username : undefined,
      avatarUrl: typeof discordObj.avatarUrl === 'string' ? discordObj.avatarUrl : undefined
    };
  }

  /**
   * Parse auto-decision configuration
   */
  private parseAutoDecisionConfig(escalation: unknown): {
    enabled: boolean;
    primaryTimeoutMs: number;
    overrideWindowMs: number;
    strategy: 'first_option' | 'random' | 'intelligent';
    notifyUser: boolean;
  } | undefined {
    const { DEFAULT_CODEX_CONFIGURATION } = require('./types.js');
    const defaults = DEFAULT_CODEX_CONFIGURATION.escalation.autoDecision;

    if (!escalation || typeof escalation !== 'object') return defaults;
    const esc = escalation as Record<string, unknown>;
    const autoDecision = esc.autoDecision;
    if (!autoDecision || typeof autoDecision !== 'object') return defaults;
    const adObj = autoDecision as Record<string, unknown>;

    // Validate strategy
    let strategy: 'first_option' | 'random' | 'intelligent' = defaults.strategy;
    if (adObj.strategy === 'first_option' || adObj.strategy === 'random' || adObj.strategy === 'intelligent') {
      strategy = adObj.strategy;
    }

    return {
      enabled: typeof adObj.enabled === 'boolean' ? adObj.enabled : defaults.enabled,
      primaryTimeoutMs: typeof adObj.primaryTimeoutMs === 'number' ? adObj.primaryTimeoutMs : defaults.primaryTimeoutMs,
      overrideWindowMs: typeof adObj.overrideWindowMs === 'number' ? adObj.overrideWindowMs : defaults.overrideWindowMs,
      strategy,
      notifyUser: typeof adObj.notifyUser === 'boolean' ? adObj.notifyUser : defaults.notifyUser
    };
  }

  /**
   * Get nested boolean value with default
   */
  private getBoolean(obj: unknown, key: string, defaultValue: boolean): boolean {
    if (!obj || typeof obj !== 'object') return defaultValue;
    const value = (obj as Record<string, unknown>)[key];
    if (typeof value === 'boolean') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    return defaultValue;
  }

  /**
   * Get nested number value with default
   */
  private getNumber(obj: unknown, key: string, defaultValue: number): number {
    if (!obj || typeof obj !== 'object') return defaultValue;
    const value = (obj as Record<string, unknown>)[key];
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (!isNaN(parsed)) return parsed;
    }
    return defaultValue;
  }

  /**
   * Get nested string value with default
   */
  private getString(obj: unknown, key: string, defaultValue: string): string {
    if (!obj || typeof obj !== 'object') return defaultValue;
    const value = (obj as Record<string, unknown>)[key];
    if (typeof value === 'string') return value;
    return defaultValue;
  }

  /**
   * Get nested string array with default
   */
  private getStringArray(obj: unknown, key: string, defaultValue: string[]): string[] {
    if (!obj || typeof obj !== 'object') return defaultValue;
    const value = (obj as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      return value.filter(v => typeof v === 'string') as string[];
    }
    return defaultValue;
  }

  /**
   * Find paths that changed between two configs
   */
  private findChangedPaths(
    prev: CodexConfiguration | null,
    next: CodexConfiguration,
    prefix: string = ''
  ): string[] {
    if (!prev) return [prefix || 'root'];

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

    checkChanges(prev, next, prefix);
    return changes;
  }
}
