/**
 * Setup Module
 *
 * Interactive setup wizard for RUBIX configuration.
 * Prompts for API keys, Telegram credentials, and generates config files.
 */

import * as readline from 'readline';
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync, accessSync, constants } from 'fs';
import { join } from 'path';
import { platform, userInfo } from 'os';
import chalk from 'chalk';

export type Platform = 'windows' | 'linux' | 'macos';

export interface PermissionCheck {
  canWrite: boolean;
  isRoot: boolean;
  user: string;
  group?: string;
  issues: string[];
  suggestions: string[];
}

/**
 * Detect the current platform
 */
export function detectPlatform(): Platform {
  const p = platform();
  if (p === 'win32') return 'windows';
  if (p === 'darwin') return 'macos';
  return 'linux';
}

/**
 * Check permissions for Linux/macOS systems
 */
export function checkPermissions(godAgentDir: string, dataDir: string, currentPlatform: Platform): PermissionCheck {
  const result: PermissionCheck = {
    canWrite: true,
    isRoot: false,
    user: 'unknown',
    issues: [],
    suggestions: []
  };

  // Get current user info
  try {
    const info = userInfo();
    result.user = info.username;
    result.isRoot = info.uid === 0;
  } catch {
    result.user = process.env.USER || process.env.USERNAME || 'unknown';
  }

  // Windows doesn't need the same permission checks
  if (currentPlatform === 'windows') {
    return result;
  }

  // Check if running as root (not recommended)
  if (result.isRoot) {
    result.issues.push('Running as root is not recommended');
    result.suggestions.push('Run as a regular user: sudo -u $USER ./assimilate.sh');
  }

  // Check write access to god-agent directory
  try {
    accessSync(godAgentDir, constants.W_OK);
  } catch {
    result.canWrite = false;
    result.issues.push(`Cannot write to ${godAgentDir}`);
    result.suggestions.push(`Fix with: sudo chown -R ${result.user}:${result.user} ${godAgentDir}`);
  }

  // Check/create data directory with proper permissions
  const fullDataDir = join(godAgentDir, dataDir);
  if (!existsSync(fullDataDir)) {
    try {
      mkdirSync(fullDataDir, { recursive: true, mode: 0o755 });
    } catch (err) {
      result.canWrite = false;
      result.issues.push(`Cannot create data directory: ${fullDataDir}`);
      result.suggestions.push(`Create manually: sudo mkdir -p ${fullDataDir} && sudo chown ${result.user}:${result.user} ${fullDataDir}`);
    }
  } else {
    try {
      accessSync(fullDataDir, constants.W_OK);
    } catch {
      result.canWrite = false;
      result.issues.push(`Cannot write to data directory: ${fullDataDir}`);
      result.suggestions.push(`Fix with: sudo chown -R ${result.user}:${result.user} ${fullDataDir}`);
    }
  }

  return result;
}

/**
 * Display permission check results
 */
export function displayPermissionCheck(check: PermissionCheck, currentPlatform: Platform): boolean {
  if (currentPlatform === 'windows') {
    return true; // Windows doesn't need these checks
  }

  console.log(chalk.cyan('\n[0/7] PERMISSION CHECK'));
  console.log(chalk.gray('─'.repeat(30)));
  console.log(chalk.gray(`User: ${check.user}${check.isRoot ? ' (root)' : ''}`));

  if (check.issues.length === 0) {
    console.log(chalk.green('✓ All permissions OK'));
    return true;
  }

  console.log(chalk.yellow('\nIssues found:'));
  for (const issue of check.issues) {
    console.log(chalk.yellow(`  ⚠ ${issue}`));
  }

  console.log(chalk.cyan('\nSuggested fixes:'));
  for (const suggestion of check.suggestions) {
    console.log(chalk.white(`  $ ${suggestion}`));
  }

  if (!check.canWrite) {
    console.log(chalk.red('\n✗ Cannot proceed without write permissions'));
    return false;
  }

  return true;
}

/**
 * Set proper permissions on created files (Linux/macOS)
 */
export function setFilePermissions(filePath: string, mode: number, currentPlatform: Platform): void {
  if (currentPlatform === 'windows') return;

  try {
    chmodSync(filePath, mode);
  } catch (err) {
    console.log(chalk.yellow(`  Warning: Could not set permissions on ${filePath}`));
  }
}

/**
 * Set directory permissions recursively (Linux/macOS)
 */
export function setDirectoryPermissions(dirPath: string, currentPlatform: Platform): void {
  if (currentPlatform === 'windows') return;

  try {
    // Set directory to 755 (rwxr-xr-x)
    chmodSync(dirPath, 0o755);
  } catch (err) {
    console.log(chalk.yellow(`  Warning: Could not set permissions on ${dirPath}`));
  }
}

export interface AllowedPath {
  pattern: string;
  permission: 'read' | 'read-write';
  reason?: string;
}

export interface SetupConfig {
  openaiKey: string;
  anthropicKey: string;
  telegramToken: string;
  telegramChatId: string;
  wolframAppId: string;
  dataDir: string;
  allowedPaths: AllowedPath[];
}

/**
 * Mask a sensitive value for display
 */
function mask(value: string): string {
  if (!value) return '(not set)';
  if (value.length <= 8) return '****';
  return value.slice(0, 4) + '...' + value.slice(-4);
}

/**
 * Prompt for user input with optional default value
 */
async function prompt(
  rl: readline.Interface,
  question: string,
  defaultValue?: string
): Promise<string> {
  return new Promise((resolve) => {
    const suffix = defaultValue ? chalk.gray(` [Enter to keep: ${mask(defaultValue)}]`) : '';
    rl.question(chalk.white(question) + suffix + '\n' + chalk.cyan('> '), (answer) => {
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

/**
 * Prompt for a choice from options
 */
async function promptChoice(
  rl: readline.Interface,
  question: string,
  options: string[],
  defaultValue?: string
): Promise<string> {
  return new Promise((resolve) => {
    const optionsStr = options.map((o, i) => `${i + 1}) ${o}`).join('  ');
    const defaultIdx = defaultValue ? options.indexOf(defaultValue) + 1 : 1;
    rl.question(
      chalk.white(question) + '\n' +
      chalk.gray(optionsStr) + '\n' +
      chalk.cyan(`> [${defaultIdx}] `),
      (answer) => {
        const idx = parseInt(answer.trim()) - 1;
        if (idx >= 0 && idx < options.length) {
          resolve(options[idx]);
        } else {
          resolve(options[defaultIdx - 1] || options[0]);
        }
      }
    );
  });
}

/**
 * Load existing configuration from .env file
 */
export function loadExistingConfig(envPath: string): Partial<SetupConfig> {
  const config: Partial<SetupConfig> = {};

  if (existsSync(envPath)) {
    const content = readFileSync(envPath, 'utf-8');
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const [key, ...valueParts] = trimmed.split('=');
      const value = valueParts.join('=');

      switch (key) {
        case 'OPENAI_API_KEY':
          config.openaiKey = value;
          break;
        case 'ANTHROPIC_API_KEY':
          config.anthropicKey = value;
          break;
        case 'TELEGRAM_BOT_TOKEN':
          config.telegramToken = value;
          break;
        case 'TELEGRAM_CHAT_ID':
          config.telegramChatId = value;
          break;
        case 'RUBIX_DATA_DIR':
          config.dataDir = value;
          break;
        case 'WOLFRAM_APP_ID':
          config.wolframAppId = value;
          break;
      }
    }
  }

  return config;
}

/**
 * Run interactive setup wizard
 */
export async function runSetup(options: { dataDir?: string; godAgentDir: string }): Promise<SetupConfig> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  // Load existing config
  const envPath = join(options.godAgentDir, '.env');
  const existing = loadExistingConfig(envPath);

  console.log(chalk.cyan('\n[1/7] API CONFIGURATION') + chalk.red(' (Required)'));
  console.log(chalk.gray('─'.repeat(35)));

  const openaiKey = await prompt(rl, 'OpenAI API Key (for embeddings):', existing.openaiKey);
  const anthropicKey = await prompt(rl, 'Anthropic API Key (for CODEX):', existing.anthropicKey);

  console.log(chalk.cyan('\n[2/7] TELEGRAM SETUP') + chalk.yellow(' (Recommended)'));
  console.log(chalk.gray('─'.repeat(35)));

  const telegramToken = await prompt(rl, 'Telegram Bot Token:', existing.telegramToken);
  const telegramChatId = await prompt(rl, 'Telegram Chat ID:', existing.telegramChatId);

  console.log(chalk.cyan('\n[3/7] OPTIONAL INTEGRATIONS'));
  console.log(chalk.gray('─'.repeat(35)));

  const wolframAppId = await prompt(rl, 'Wolfram Alpha App ID (optional):', existing.wolframAppId);

  console.log(chalk.cyan('\n[4/7] DATA STORAGE'));
  console.log(chalk.gray('─'.repeat(35)));
  console.log(chalk.gray('Where to store RUBIX databases (memory.db, vectors.hnsw)'));
  console.log(chalk.gray('Examples: ./data, E:\\rubix-data, /mnt/external/rubix'));

  const dataDir = await prompt(rl, 'Data directory:', options.dataDir || existing.dataDir || './data');

  console.log(chalk.cyan('\n[5/7] PATH PERMISSIONS'));
  console.log(chalk.gray('─'.repeat(35)));
  console.log(chalk.gray('RUBIX can only access paths you explicitly allow.'));
  console.log(chalk.gray('Project root is always read-write. Add other paths below.'));
  console.log(chalk.gray('Examples: E:/, D:/projects/**, /mnt/data'));
  console.log('');

  const allowedPaths: AllowedPath[] = [];
  let addMore = true;

  while (addMore) {
    const pattern = await prompt(rl, 'Add allowed path (Enter to finish):', '');

    if (!pattern) {
      addMore = false;
      continue;
    }

    // Normalize pattern - add /** if it looks like a directory without glob
    let normalizedPattern = pattern;
    if (!pattern.includes('*') && !pattern.endsWith('/')) {
      normalizedPattern = pattern.replace(/\\/g, '/');
      if (!normalizedPattern.endsWith('/')) {
        normalizedPattern += '/**';
      }
    }

    const permission = await promptChoice(rl, 'Permission level:', ['read', 'read-write'], 'read-write') as 'read' | 'read-write';

    allowedPaths.push({
      pattern: normalizedPattern,
      permission,
      reason: 'Added during setup'
    });

    console.log(chalk.green(`  + ${normalizedPattern} (${permission})`));
    console.log('');
  }

  if (allowedPaths.length > 0) {
    console.log(chalk.green(`Added ${allowedPaths.length} allowed path(s)`));
  } else {
    console.log(chalk.gray('No additional paths configured'));
  }

  rl.close();

  return {
    openaiKey,
    anthropicKey,
    telegramToken,
    telegramChatId,
    wolframAppId,
    dataDir,
    allowedPaths
  };
}

/**
 * Generate .env file content
 */
export function generateEnvFile(config: SetupConfig, envPath: string): void {
  const content = `# RUBIX Configuration
# Generated by assimilate wizard

# Required - Embeddings
OPENAI_API_KEY=${config.openaiKey}
RUBIX_EMBEDDING_MODEL=text-embedding-3-small
RUBIX_EMBEDDING_DIMENSIONS=768

# Required - CODEX Code Generation
ANTHROPIC_API_KEY=${config.anthropicKey}

# Data Storage
RUBIX_DATA_DIR=${config.dataDir}

# Telegram Integration
TELEGRAM_BOT_TOKEN=${config.telegramToken}
TELEGRAM_CHAT_ID=${config.telegramChatId}

# CODEX Extended Thinking
CODEX_ULTRATHINK=true
CODEX_THINK_BASE=5000
CODEX_THINK_MAX=16000

# Optional - Wolfram Alpha
WOLFRAM_APP_ID=${config.wolframAppId}
`;

  writeFileSync(envPath, content);
}

/**
 * Generate .claude/mcp.json for Claude Code integration
 */
export function generateMcpConfig(config: SetupConfig, projectRoot: string, godAgentDir: string): void {
  const mcpDir = join(projectRoot, '.claude');
  const mcpPath = join(mcpDir, 'mcp.json');

  // Ensure .claude directory exists
  if (!existsSync(mcpDir)) {
    mkdirSync(mcpDir, { recursive: true });
  }

  // Load existing MCP config if present (preserve other servers)
  let mcpConfig: any = { mcpServers: {} };
  if (existsSync(mcpPath)) {
    try {
      mcpConfig = JSON.parse(readFileSync(mcpPath, 'utf-8'));
      if (!mcpConfig.mcpServers) {
        mcpConfig.mcpServers = {};
      }
    } catch {
      // Invalid JSON, start fresh
      mcpConfig = { mcpServers: {} };
    }
  }

  // Update rubix server config
  mcpConfig.mcpServers.rubix = {
    command: 'node',
    args: ['dist/mcp-server.js'],
    cwd: godAgentDir,
    env: {
      OPENAI_API_KEY: config.openaiKey,
      ANTHROPIC_API_KEY: config.anthropicKey,
      RUBIX_DATA_DIR: config.dataDir,
      TELEGRAM_BOT_TOKEN: config.telegramToken,
      TELEGRAM_CHAT_ID: config.telegramChatId,
      WOLFRAM_APP_ID: config.wolframAppId
    }
  };

  writeFileSync(mcpPath, JSON.stringify(mcpConfig, null, 2));
}

/**
 * Generate containment.json for path permissions
 */
export function generateContainmentConfig(config: SetupConfig, dataDir: string): void {
  if (!config.allowedPaths || config.allowedPaths.length === 0) {
    return; // No paths to save
  }

  // Resolve data directory
  const resolvedDataDir = join(process.cwd(), dataDir);

  // Ensure data directory exists
  if (!existsSync(resolvedDataDir)) {
    mkdirSync(resolvedDataDir, { recursive: true });
  }

  const containmentPath = join(resolvedDataDir, 'containment.json');

  const containmentConfig = {
    version: 1,
    rules: config.allowedPaths.map((path, index) => ({
      pattern: path.pattern,
      permission: path.permission,
      reason: path.reason || 'Added during setup',
      priority: 60 - index // Higher priority for earlier rules
    }))
  };

  writeFileSync(containmentPath, JSON.stringify(containmentConfig, null, 2));
}

/**
 * Validate configuration - split required vs optional
 */
export function validateConfig(config: SetupConfig): {
  valid: boolean;
  required: string[];
  optional: string[];
} {
  const required: string[] = [];
  const optional: string[] = [];

  // Required - block if missing
  if (!config.openaiKey) required.push('OpenAI API Key');
  if (!config.anthropicKey) required.push('Anthropic API Key');

  // Optional - warn only
  if (!config.telegramToken) optional.push('Telegram Bot Token');
  if (!config.telegramChatId) optional.push('Telegram Chat ID');
  if (!config.wolframAppId) optional.push('Wolfram Alpha App ID');

  return {
    valid: required.length === 0,
    required,
    optional
  };
}

/**
 * Generate launcher scripts for the target platform
 */
export function generateLauncherScripts(godAgentDir: string, currentPlatform: Platform): void {
  if (currentPlatform === 'windows') {
    // Windows batch files already exist, just ensure they're there
    console.log(chalk.gray('  Windows batch files available in god-agent directory'));
  } else {
    // Generate shell scripts for Linux/macOS
    generateShellScripts(godAgentDir);
  }
}

/**
 * Generate shell scripts for Linux/macOS
 */
function generateShellScripts(godAgentDir: string): void {
  // assimilate.sh
  const assimilateScript = `#!/bin/bash
# RUBIX Assimilation Protocol - Linux/macOS

echo ""
echo "==============================================="
echo "         RUBIX ASSIMILATION PROTOCOL"
echo "==============================================="
echo ""

# Get the directory where this script is located (god-agent root)
RUBIX_DIR="$( cd "$( dirname "\${BASH_SOURCE[0]}" )" && pwd )"

# Get the current working directory (project to assimilate to)
PROJECT_DIR="$(pwd)"

echo "God-Agent Location: $RUBIX_DIR"
echo "Project Directory:  $PROJECT_DIR"
echo ""

# Change to god-agent directory to run node
cd "$RUBIX_DIR"

# Run assimilate with project root
node dist/cli/index.js assimilate --project-root "$PROJECT_DIR"

# Return to original directory
cd "$PROJECT_DIR"
`;

  // launch.sh
  const launchScript = `#!/bin/bash
# RUBIX Full Stack Launcher - Linux/macOS

SCRIPT_DIR="$( cd "$( dirname "\${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo "Starting RUBIX (Telegram + Daemon + Webhooks)..."
node dist/launch/all.js
`;

  // launch-telegram.sh
  const telegramScript = `#!/bin/bash
# RUBIX Telegram Launcher - Linux/macOS

SCRIPT_DIR="$( cd "$( dirname "\${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo "Starting RUBIX Telegram Bot..."
node dist/launch/telegram.js
`;

  // Write scripts and make executable
  const scripts = [
    { name: 'assimilate.sh', content: assimilateScript },
    { name: 'launch.sh', content: launchScript },
    { name: 'launch-telegram.sh', content: telegramScript }
  ];

  for (const script of scripts) {
    const scriptPath = join(godAgentDir, script.name);
    writeFileSync(scriptPath, script.content);
    try {
      chmodSync(scriptPath, '755'); // rwxr-xr-x
      console.log(chalk.green(`  Created ${script.name} (executable)`));
    } catch (err) {
      console.log(chalk.yellow(`  Created ${script.name} (chmod may require sudo)`));
    }
  }
}

/**
 * Show platform-specific instructions
 */
export function showPlatformInstructions(currentPlatform: Platform, godAgentDir: string): void {
  console.log(chalk.cyan('\nPlatform-Specific Instructions:'));
  console.log(chalk.gray('─'.repeat(35)));

  if (currentPlatform === 'windows') {
    console.log(chalk.white('Run from any project folder:'));
    console.log(chalk.gray(`  ${godAgentDir}\\assimilate.bat`));
    console.log('');
    console.log(chalk.white('Or add to PATH for global access:'));
    console.log(chalk.gray(`  setx PATH "%PATH%;${godAgentDir}"`));
  } else {
    console.log(chalk.white('Run from any project folder:'));
    console.log(chalk.gray(`  ${godAgentDir}/assimilate.sh`));
    console.log('');
    console.log(chalk.white('Or add to PATH for global access:'));
    console.log(chalk.gray(`  echo 'export PATH="$PATH:${godAgentDir}"' >> ~/.bashrc`));
    console.log(chalk.gray(`  source ~/.bashrc`));
    console.log('');
    console.log(chalk.white('Or create a symlink:'));
    console.log(chalk.gray(`  sudo ln -s ${godAgentDir}/assimilate.sh /usr/local/bin/rubix-assimilate`));
  }
}

export default {
  runSetup,
  generateEnvFile,
  generateMcpConfig,
  loadExistingConfig,
  validateConfig,
  detectPlatform,
  checkPermissions,
  displayPermissionCheck,
  setFilePermissions,
  setDirectoryPermissions,
  generateLauncherScripts,
  showPlatformInstructions
};
