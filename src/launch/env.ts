/**
 * Environment Validation
 *
 * Validates required environment variables and provides helpful error messages.
 * Supports interactive prompting for missing required vars at launch.
 */

import * as readline from 'readline';
import { existsSync, writeFileSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Get module directory for .env path
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const godAgentRoot = join(__dirname, '..', '..');

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
    `RUBIX_DATA_DIR:   ${process.env.RUBIX_DATA_DIR || './data (default)'}`,
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
    optional: ['TELEGRAM_BOT_TOKEN', 'SLACK_WEBHOOK_URL', 'DISCORD_WEBHOOK_URL', 'RUBIX_DATA_DIR', 'WEBHOOK_PORT']
  },

  /** Telegram bot with RUBIX */
  telegram: {
    required: ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'TELEGRAM_BOT_TOKEN'],
    optional: ['RUBIX_DATA_DIR']
  },

  /** Scheduler daemon */
  daemon: {
    required: ['OPENAI_API_KEY'],
    optional: ['ANTHROPIC_API_KEY', 'RUBIX_DATA_DIR']
  },

  /** Webhook server only */
  webhooks: {
    required: [],
    optional: ['WEBHOOK_PORT']
  },

  /** MCP server */
  mcp: {
    required: ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY'],
    optional: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'WOLFRAM_APP_ID', 'RUBIX_DATA_DIR']
  }
} as const;

/**
 * Human-readable descriptions for environment variables
 */
const ENV_DESCRIPTIONS: Record<string, string> = {
  OPENAI_API_KEY: 'OpenAI API Key (for embeddings)',
  ANTHROPIC_API_KEY: 'Anthropic API Key (for CODEX code generation)',
  TELEGRAM_BOT_TOKEN: 'Telegram Bot Token',
  TELEGRAM_CHAT_ID: 'Telegram Chat ID',
  WOLFRAM_APP_ID: 'Wolfram Alpha App ID',
  RUBIX_DATA_DIR: 'Data directory path'
};

/**
 * URLs for getting API keys
 */
const API_KEY_URLS: Record<string, string> = {
  OPENAI_API_KEY: 'https://platform.openai.com/api-keys',
  ANTHROPIC_API_KEY: 'https://console.anthropic.com/',
  TELEGRAM_BOT_TOKEN: 'https://t.me/BotFather',
  WOLFRAM_APP_ID: 'https://developer.wolframalpha.com/'
};

/**
 * Prompt user for a single environment variable value
 */
async function promptForValue(
  rl: readline.Interface,
  varName: string,
  description: string
): Promise<string> {
  const url = API_KEY_URLS[varName];
  const urlHint = url ? ` (Get it: ${url})` : '';

  return new Promise((resolve) => {
    rl.question(`\n${description}${urlHint}\n> `, (answer) => {
      resolve(answer.trim());
    });
  });
}

/**
 * Append a variable to .env file
 */
function appendToEnvFile(varName: string, value: string): void {
  const envPath = join(godAgentRoot, '.env');

  // Check if .env exists, create if not
  if (!existsSync(envPath)) {
    writeFileSync(envPath, '# RUBIX Configuration\n# Generated at launch\n\n');
  }

  // Append the variable
  appendFileSync(envPath, `${varName}=${value}\n`);

  // Also set it in current process
  process.env[varName] = value;
}

/**
 * Interactively prompt for missing required environment variables
 * Returns true if all required vars are now set, false if user declined
 */
export async function promptForMissingEnv(
  requirements: EnvRequirements,
  serviceName: string
): Promise<boolean> {
  const result = validateEnv(requirements);

  if (result.valid) {
    return true; // Nothing missing
  }

  console.log('');
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║      RUBIX - Missing Required Configuration    ║');
  console.log('╚════════════════════════════════════════════════╝');
  console.log('');
  console.log(`Service: ${serviceName}`);
  console.log('');
  console.log('The following required configuration is missing:');
  for (const varName of result.missing) {
    const desc = ENV_DESCRIPTIONS[varName] || varName;
    console.log(`  ✗ ${desc}`);
  }
  console.log('');
  console.log('You can enter the values now, or press Ctrl+C to exit.');
  console.log('Values will be saved to .env for future launches.');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    for (const varName of result.missing) {
      const desc = ENV_DESCRIPTIONS[varName] || varName;
      const value = await promptForValue(rl, varName, desc);

      if (!value) {
        console.log(`\n✗ ${desc} is required. Cannot proceed without it.`);
        rl.close();
        return false;
      }

      // Save to .env and set in process
      appendToEnvFile(varName, value);
      console.log(`✓ ${varName} saved`);
    }

    rl.close();
    console.log('');
    console.log('✓ All required configuration provided!');
    console.log('');
    return true;

  } catch (error) {
    rl.close();
    return false;
  }
}

/**
 * Require environment variables - prompts interactively if missing
 * Exits if user doesn't provide required values
 */
export async function requireEnvInteractive(
  requirements: EnvRequirements,
  serviceName: string
): Promise<void> {
  const success = await promptForMissingEnv(requirements, serviceName);

  if (!success) {
    console.error('');
    console.error(`[${serviceName}] Cannot start without required configuration.`);
    console.error('Run the assimilate wizard to configure: node dist/cli/index.js assimilate');
    console.error('');
    process.exit(1);
  }

  // Re-validate after prompting
  const result = validateEnv(requirements);
  console.log(`[${serviceName}] Environment validated: ${result.present.length} variables configured`);
}
