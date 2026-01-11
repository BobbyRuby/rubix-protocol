/**
 * Environment Validation
 *
 * Validates required environment variables and provides helpful error messages.
 */

export interface EnvRequirements {
  required: readonly string[];
  optional: readonly string[];
}

export interface EnvValidationResult {
  valid: boolean;
  missing: string[];
  present: string[];
  summary: string;
}

/**
 * Validate that required environment variables are set
 */
export function validateEnv(requirements: EnvRequirements): EnvValidationResult {
  const missing: string[] = [];
  const present: string[] = [];

  for (const key of requirements.required) {
    if (process.env[key]) {
      present.push(key);
    } else {
      missing.push(key);
    }
  }

  for (const key of requirements.optional) {
    if (process.env[key]) {
      present.push(`${key} (optional)`);
    }
  }

  const valid = missing.length === 0;
  const summary = valid
    ? `All required environment variables present (${present.length} vars)`
    : `Missing required environment variables: ${missing.join(', ')}`;

  return { valid, missing, present, summary };
}

/**
 * Get a summary of current environment configuration
 */
export function getEnvSummary(): string {
  const lines: string[] = [
    '=== Environment Summary ===',
    '',
    `OPENAI_API_KEY:       ${mask(process.env.OPENAI_API_KEY)}`,
    `ANTHROPIC_API_KEY:    ${mask(process.env.ANTHROPIC_API_KEY)}`,
    `TELEGRAM_BOT_TOKEN:   ${mask(process.env.TELEGRAM_BOT_TOKEN)}`,
    `GOD_AGENT_DATA_DIR:   ${process.env.GOD_AGENT_DATA_DIR || './data (default)'}`,
    `WEBHOOK_PORT:         ${process.env.WEBHOOK_PORT || '3456 (default)'}`,
    '',
    'Optional channels:',
    `  SLACK_WEBHOOK_URL:  ${mask(process.env.SLACK_WEBHOOK_URL)}`,
    `  DISCORD_WEBHOOK_URL: ${mask(process.env.DISCORD_WEBHOOK_URL)}`,
    ''
  ];

  return lines.join('\n');
}

/**
 * Mask sensitive values for display
 */
function mask(value: string | undefined): string {
  if (!value) return '(not set)';
  if (value.length <= 8) return '***';
  return `${value.substring(0, 8)}...${value.substring(value.length - 4)}`;
}

/**
 * Require environment variables or exit with helpful error
 */
export function requireEnv(requirements: EnvRequirements, serviceName: string): void {
  const result = validateEnv(requirements);

  if (!result.valid) {
    console.error(`\n[${serviceName}] Environment validation failed!`);
    console.error(`Missing: ${result.missing.join(', ')}`);
    console.error('\nPlease set these environment variables or create a .env file.\n');
    console.error(getEnvSummary());
    process.exit(1);
  }

  console.log(`[${serviceName}] Environment validated: ${result.present.length} variables configured`);
}

/**
 * Common environment requirements by service
 */
export const ENV_REQUIREMENTS = {
  /** Full stack - needs everything */
  all: {
    required: ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY'],
    optional: ['TELEGRAM_BOT_TOKEN', 'SLACK_WEBHOOK_URL', 'DISCORD_WEBHOOK_URL', 'GOD_AGENT_DATA_DIR', 'WEBHOOK_PORT']
  },

  /** Telegram bot with RUBIX */
  telegram: {
    required: ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'TELEGRAM_BOT_TOKEN'],
    optional: ['GOD_AGENT_DATA_DIR']
  },

  /** Scheduler daemon */
  daemon: {
    required: ['OPENAI_API_KEY'],
    optional: ['ANTHROPIC_API_KEY', 'GOD_AGENT_DATA_DIR']
  },

  /** Webhook server only */
  webhooks: {
    required: [],
    optional: ['WEBHOOK_PORT']
  }
} as const;
