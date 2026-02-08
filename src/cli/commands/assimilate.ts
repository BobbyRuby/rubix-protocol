/**
 * Assimilate Command
 *
 * Full RUBIX setup wizard + memory assimilation.
 * Handles cross-platform setup (Windows, Linux, macOS).
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { join } from 'path';
import { MemoryEngine, getDefaultConfig } from '../../index.js';
import { SYSTEM_TAGS } from '../../core/constants.js';
import {
  runSetup,
  generateEnvFile,
  generateMcpConfig,
  generateContainmentConfig,
  detectPlatform,
  checkPermissions,
  displayPermissionCheck,
  setFilePermissions,
  generateLauncherScripts,
  showPlatformInstructions,
  validateConfig,
  SetupConfig
} from './setup.js';
import { discoverAndImportLegacy } from './legacy-import.js';

export const assimilateCommand = new Command('assimilate')
  .description('Full RUBIX setup wizard + assimilation')
  .option('-d, --data-dir <path>', 'Data directory path', './data')
  .option('-y, --yes', 'Skip confirmation prompts', false)
  .option('--skip-setup', 'Skip setup wizard, only wipe memory', false)
  .option('--project-root <path>', 'Project root for MCP config (defaults to current directory)')
  .action(async (options) => {
    const godAgentDir = process.cwd();
    const projectRoot = options.projectRoot || godAgentDir;
    const currentPlatform = detectPlatform();

    console.log('');
    console.log(chalk.cyan('╔═══════════════════════════════════════╗'));
    console.log(chalk.cyan('║     RUBIX ASSIMILATION PROTOCOL       ║'));
    console.log(chalk.cyan('╚═══════════════════════════════════════╝'));
    console.log('');
    console.log(chalk.gray(`Platform: ${currentPlatform}`));
    console.log(chalk.gray(`God-Agent: ${godAgentDir}`));
    console.log(chalk.gray(`Target Project: ${projectRoot}`));
    console.log('');

    // Step 0: Permission check (Linux/macOS)
    if (!options.skipSetup) {
      const permCheck = checkPermissions(godAgentDir, options.dataDir, currentPlatform);
      const permOk = displayPermissionCheck(permCheck, currentPlatform);

      if (!permOk) {
        console.log(chalk.red('\nPlease fix permission issues and try again.'));
        process.exit(1);
      }
    }

    let config: SetupConfig | null = null;

    // Step 1-2: Interactive setup (unless skipped)
    if (!options.skipSetup) {
      try {
        config = await runSetup({ dataDir: options.dataDir, godAgentDir });

        // Validate required fields
        const validation = validateConfig(config);

        // Block on missing required keys
        if (!validation.valid) {
          console.log(chalk.red('\nMissing REQUIRED configuration:'));
          for (const missing of validation.required) {
            console.log(chalk.red(`  ✗ ${missing}`));
          }
          console.log(chalk.red('\nCannot proceed without required API keys.'));
          console.log(chalk.gray('Get your keys from:'));
          console.log(chalk.gray('  OpenAI: https://platform.openai.com/api-keys'));
          console.log(chalk.gray('  Anthropic: https://console.anthropic.com/'));
          process.exit(1);
        }

        // Warn on missing optional
        if (validation.optional.length > 0) {
          console.log(chalk.yellow('\nOptional configuration not set:'));
          for (const missing of validation.optional) {
            console.log(chalk.yellow(`  ⚠ ${missing}`));
          }
          console.log(chalk.gray('These features will be disabled until configured.'));
        }

        console.log(chalk.cyan('\n[6/7] SAVING CONFIGURATION'));
        console.log(chalk.gray('─'.repeat(30)));

        // Generate .env file
        const envPath = join(godAgentDir, '.env');
        generateEnvFile(config, envPath);
        setFilePermissions(envPath, 0o600, currentPlatform); // rw------- (sensitive)
        console.log(chalk.green('✓ Created .env'));

        // Generate MCP config in project root
        generateMcpConfig(config, projectRoot, godAgentDir);
        console.log(chalk.green(`✓ Updated ${projectRoot}/.claude/mcp.json`));

        // Generate containment config for path permissions
        if (config.allowedPaths && config.allowedPaths.length > 0) {
          generateContainmentConfig(config, config.dataDir);
          console.log(chalk.green(`✓ Created containment.json with ${config.allowedPaths.length} allowed path(s)`));
        }

        // Generate platform-specific launcher scripts
        console.log(chalk.gray('\nGenerating launcher scripts...'));
        generateLauncherScripts(godAgentDir, currentPlatform);

      } catch (error) {
        console.error(chalk.red('\nSetup failed:'), error instanceof Error ? error.message : 'Unknown error');
        process.exit(1);
      }
    }

    // Step 6.5: Legacy Database Discovery & Import
    console.log(chalk.cyan('\n[6.5/7] LEGACY DATABASE DISCOVERY'));
    console.log(chalk.gray('─'.repeat(30)));

    const memoryConfig = getDefaultConfig(options.dataDir);
    const engine = new MemoryEngine(memoryConfig);
    await engine.initialize();

    const currentDbPath = join(options.dataDir, 'memory.db');
    const legacyResults = await discoverAndImportLegacy(currentDbPath, engine, options.yes);

    if (legacyResults.databasesProcessed > 0) {
      console.log(chalk.green(`Legacy import complete: ${legacyResults.totalImported} entries imported from ${legacyResults.databasesProcessed} database(s)`));
    }

    // Step 7: Memory assimilation
    console.log(chalk.cyan('\n[7/7] MEMORY ASSIMILATION'));
    console.log(chalk.gray('─'.repeat(30)));

    console.log(chalk.yellow('This will:'));
    console.log(chalk.yellow('  • Delete all project-specific memory'));
    console.log(chalk.yellow('  • Preserve RUBIX system knowledge'));
    if (legacyResults.totalImported > 0) {
      console.log(chalk.yellow(`  • Keep ${legacyResults.totalImported} imported legacy entries`));
    }
    console.log('');
    console.log(chalk.gray(`Preserved tags: ${SYSTEM_TAGS.join(', ')}`));

    if (!options.yes) {
      console.log('');
      console.log(chalk.yellow('Proceeding in 3 seconds... (Ctrl+C to cancel)'));
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    const spinner = ora('Assimilating memory...').start();

    try {
      // Get stats before
      const statsBefore = await engine.getStats();
      spinner.text = `Found ${statsBefore.totalEntries} entries in memory`;

      // Perform assimilation
      spinner.text = 'Assimilating...';
      const { deleted, preserved } = await engine.assimilate();

      await engine.close();

      spinner.succeed('Assimilation complete');

      console.log('');
      console.log(chalk.green('Results:'));
      console.log(chalk.green(`  • Deleted: ${deleted} project entries`));
      console.log(chalk.green(`  • Preserved: ${preserved} system entries`));

    } catch (error) {
      spinner.fail('Assimilation failed');
      console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
      process.exit(1);
    }

    // Final output
    console.log('');
    console.log(chalk.cyan('═'.repeat(45)));
    console.log(chalk.cyan.bold(`RUBIX is ready for: ${projectRoot}`));
    console.log(chalk.cyan('═'.repeat(45)));

    // Show platform-specific instructions
    if (!options.skipSetup) {
      showPlatformInstructions(currentPlatform, godAgentDir);
    }

    console.log('');
  });

export default assimilateCommand;
