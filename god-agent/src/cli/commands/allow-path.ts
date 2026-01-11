/**
 * Allow-Path Command
 *
 * CLI command for managing RUBIX path permissions.
 * Add, remove, or list allowed paths with read/read-write permissions.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';

interface ContainmentRule {
  pattern: string;
  permission: 'read' | 'read-write' | 'deny';
  reason?: string;
  priority?: number;
}

interface ContainmentConfig {
  version: number;
  rules: ContainmentRule[];
}

/**
 * Get the containment.json path
 */
function getContainmentPath(): string {
  const dataDir = process.env.GOD_AGENT_DATA_DIR || './data';
  return join(resolve(dataDir), 'containment.json');
}

/**
 * Load containment config
 */
function loadConfig(): ContainmentConfig {
  const configPath = getContainmentPath();

  if (!existsSync(configPath)) {
    return { version: 1, rules: [] };
  }

  try {
    const content = readFileSync(configPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return { version: 1, rules: [] };
  }
}

/**
 * Save containment config
 */
function saveConfig(config: ContainmentConfig): void {
  const configPath = getContainmentPath();
  const dir = join(configPath, '..');

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(configPath, JSON.stringify(config, null, 2));
}

/**
 * Normalize a path pattern
 */
function normalizePattern(pattern: string): string {
  let normalized = pattern.replace(/\\/g, '/');

  // Add /** if it looks like a directory without glob
  if (!normalized.includes('*') && !normalized.endsWith('/')) {
    normalized += '/**';
  }

  return normalized;
}

export const allowPathCommand = new Command('allow-path')
  .description('Manage allowed paths for RUBIX file access')
  .argument('[pattern]', 'Path or glob pattern (e.g., E:/, D:/projects/**)')
  .option('-p, --permission <type>', 'Permission level: read | read-write', 'read-write')
  .option('-r, --remove', 'Remove this pattern from allowed paths')
  .option('-l, --list', 'List all allowed paths')
  .option('--reason <text>', 'Reason for this permission')
  .action(async (pattern: string | undefined, options) => {
    // List mode
    if (options.list) {
      const config = loadConfig();

      if (config.rules.length === 0) {
        console.log(chalk.gray('No custom path permissions configured.'));
        console.log(chalk.gray('Use: rubix allow-path "E:/**" -p read-write'));
        return;
      }

      console.log(chalk.cyan('\nAllowed Paths:'));
      console.log(chalk.gray('─'.repeat(50)));

      for (const rule of config.rules) {
        const icon = rule.permission === 'read' ? '📖' : '📝';
        const permColor = rule.permission === 'read' ? chalk.blue : chalk.green;
        console.log(`  ${icon} ${chalk.white(rule.pattern)} ${permColor(`(${rule.permission})`)}`);
        if (rule.reason) {
          console.log(chalk.gray(`     ${rule.reason}`));
        }
      }

      console.log('');
      console.log(chalk.gray(`Config file: ${getContainmentPath()}`));
      return;
    }

    // Pattern required for add/remove
    if (!pattern) {
      console.log(chalk.red('Error: Pattern is required'));
      console.log(chalk.gray('Usage: rubix allow-path "E:/**" -p read-write'));
      console.log(chalk.gray('       rubix allow-path "E:/**" --remove'));
      console.log(chalk.gray('       rubix allow-path --list'));
      process.exit(1);
    }

    const normalizedPattern = normalizePattern(pattern);
    const config = loadConfig();

    // Remove mode
    if (options.remove) {
      const index = config.rules.findIndex(r => r.pattern === normalizedPattern);

      if (index === -1) {
        console.log(chalk.yellow(`Pattern not found: ${normalizedPattern}`));
        return;
      }

      config.rules.splice(index, 1);
      saveConfig(config);
      console.log(chalk.green(`✓ Removed: ${normalizedPattern}`));
      return;
    }

    // Add/update mode
    const permission = options.permission as 'read' | 'read-write';

    if (permission !== 'read' && permission !== 'read-write') {
      console.log(chalk.red('Error: Permission must be "read" or "read-write"'));
      process.exit(1);
    }

    const existingIndex = config.rules.findIndex(r => r.pattern === normalizedPattern);

    const rule: ContainmentRule = {
      pattern: normalizedPattern,
      permission,
      reason: options.reason || 'Added via CLI',
      priority: 60
    };

    if (existingIndex >= 0) {
      config.rules[existingIndex] = rule;
      console.log(chalk.green(`✓ Updated: ${normalizedPattern} (${permission})`));
    } else {
      config.rules.push(rule);
      console.log(chalk.green(`✓ Added: ${normalizedPattern} (${permission})`));
    }

    saveConfig(config);
    console.log(chalk.gray(`Config saved to: ${getContainmentPath()}`));
    console.log(chalk.gray('Restart MCP server to apply changes.'));
  });

export default allowPathCommand;
