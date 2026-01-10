/**
 * Configuration Module
 *
 * Exports configuration management for CODEX.
 * Provides YAML-based configuration with live reloading support.
 */

// Main manager
export { ConfigurationManager } from './ConfigurationManager.js';

// Loader utilities
export { ConfigLoader } from './ConfigLoader.js';

// Types
export {
  // Main configuration
  CodexConfiguration,
  PartialCodexConfiguration,

  // Section types
  EscalationConfig,
  WorkModeConfig,
  PlaywrightConfig,
  ReviewConfig,
  NotificationsConfig,
  MemoryConfig,
  SlackConfig,
  DiscordConfig,

  // Validation types
  ConfigValidationResult,
  ConfigValidationError,
  ConfigValidationWarning,

  // Change event types
  ConfigChangeEvent,
  ConfigWatchCallback,

  // Default configuration
  DEFAULT_CODEX_CONFIGURATION
} from './types.js';
