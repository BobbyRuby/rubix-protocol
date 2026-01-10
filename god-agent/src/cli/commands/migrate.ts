/**
 * Migrate Command
 *
 * Orchestrates knowledge migration into God Agent memory.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import { MemoryEngine } from '../../index.js';
import { migrateGitHistory } from '../../migrations/git-history.js';
import { migrateSkills } from '../../migrations/skills.js';
import { migrateSecurity } from '../../migrations/security.js';
import { updateClaudeMd } from '../../migrations/claude-md.js';
import type { MigrationConfig, MigrationResult, ProgressCallback } from '../../migrations/types.js';
import { DEFAULT_MIGRATION_CONFIG } from '../../migrations/types.js';

/**
 * Create a progress callback that updates a spinner
 */
function createProgressCallback(spinner: Ora): ProgressCallback {
  return (phase: string, current: number, total: number, message?: string) => {
    if (total > 0) {
      const percent = Math.round((current / total) * 100);
      const bar = createProgressBar(percent);
      spinner.text = message
        ? `${phase}: ${bar} ${percent}% - ${message}`
        : `${phase}: ${bar} ${percent}%`;
    } else if (message) {
      spinner.text = `${phase}: ${message}`;
    }
  };
}

/**
 * Create a simple progress bar
 */
function createProgressBar(percent: number, width: number = 20): string {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  return '[' + '█'.repeat(filled) + '░'.repeat(empty) + ']';
}

/**
 * Format duration in human-readable format
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/**
 * Print migration summary
 */
function printSummary(results: MigrationResult[], totalDuration: number): void {
  console.log();
  console.log(chalk.bold('═══════════════════════════════════════════════════════════'));
  console.log(chalk.bold.green('Migration Complete!'));
  console.log(chalk.bold('═══════════════════════════════════════════════════════════'));
  console.log();

  // Summary table
  const totalEntries = results.reduce((sum, r) => sum + r.entriesStored, 0);
  const totalRelations = results.reduce((sum, r) => sum + r.relationsCreated, 0);
  const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);

  console.log(chalk.dim('Phase Summary:'));
  for (const result of results) {
    const status = result.errors.length > 0
      ? chalk.yellow('⚠')
      : chalk.green('✓');
    console.log(
      `  ${status} ${result.phase}: ${result.entriesStored} entries, ${result.relationsCreated} relations (${formatDuration(result.duration)})`
    );
  }

  console.log();
  console.log(chalk.dim('Totals:'));
  console.log(`  • Entries stored: ${chalk.cyan(totalEntries)}`);
  console.log(`  • Relations created: ${chalk.cyan(totalRelations)}`);
  console.log(`  • Errors: ${totalErrors > 0 ? chalk.yellow(totalErrors) : chalk.green(totalErrors)}`);
  console.log(`  • Duration: ${chalk.cyan(formatDuration(totalDuration))}`);

  // Dry run notice
  if (results[0]?.dryRun) {
    console.log();
    console.log(chalk.yellow('⚠ DRY RUN - No changes were made'));
  }

  // Show errors if any
  if (totalErrors > 0) {
    console.log();
    console.log(chalk.yellow('Errors:'));
    for (const result of results) {
      for (const error of result.errors) {
        console.log(chalk.dim(`  [${result.phase}] `) + error);
      }
    }
  }

  console.log();
  console.log(chalk.dim('Verify with: god-agent stats'));
}

export const migrateCommand = new Command('migrate')
  .description('Migrate knowledge into God Agent memory')
  .option('-d, --data-dir <path>', 'Data directory path', DEFAULT_MIGRATION_CONFIG.dataDir)
  .option('--all', 'Run all migration phases')
  .option('--git', 'Migrate git history')
  .option('--skills', 'Migrate skill files')
  .option('--security', 'Seed security patterns')
  .option('--claude-md', 'Update CLAUDE.md with routing table')
  .option('--progress', 'Show real-time progress', DEFAULT_MIGRATION_CONFIG.progress)
  .option('--dry-run', 'Preview changes without storing', DEFAULT_MIGRATION_CONFIG.dryRun)
  .option('--resume', 'Resume interrupted migration', DEFAULT_MIGRATION_CONFIG.resume)
  .option('--batch-size <number>', 'Commits per batch for git migration', '50')
  .option('-p, --project-root <path>', 'Project root directory', process.cwd())
  .action(async (options) => {
    const startTime = Date.now();
    const results: MigrationResult[] = [];

    // Determine which phases to run
    const runAll = options.all || (!options.git && !options.skills && !options.security && !options.claudeMd);
    const runGit = runAll || options.git;
    const runSkills = runAll || options.skills;
    const runSecurity = runAll || options.security;
    const runClaudeMd = runAll || options.claudeMd;

    // Build config
    const config: MigrationConfig = {
      dataDir: options.dataDir,
      dryRun: options.dryRun || false,
      batchSize: parseInt(options.batchSize, 10),
      progress: options.progress ?? true,
      resume: options.resume || false,
      projectRoot: options.projectRoot,
    };

    // Print header
    console.log();
    console.log(chalk.bold('God Agent Knowledge Migration'));
    console.log(chalk.bold('═══════════════════════════════════════════════════════════'));
    if (config.dryRun) {
      console.log(chalk.yellow('DRY RUN MODE - No changes will be made'));
    }
    console.log();

    let engine: MemoryEngine | null = null;
    let spinner: Ora | null = null;

    try {
      // Initialize engine (except for claude-md only)
      if (runGit || runSkills || runSecurity) {
        spinner = ora('Initializing God Agent...').start();
        engine = new MemoryEngine({ dataDir: config.dataDir });
        await engine.initialize();
        spinner.succeed('God Agent initialized');
      }

      const progressCallback = spinner ? createProgressCallback(spinner) : undefined;

      // Phase 1: Git History
      if (runGit && engine) {
        console.log();
        console.log(chalk.bold('[1/4] Git History Migration'));
        spinner = ora('Starting git migration...').start();

        const result = await migrateGitHistory(engine, config, progressCallback);
        results.push(result);

        if (result.errors.length > 0) {
          spinner.warn(`Git migration completed with ${result.errors.length} errors`);
        } else {
          spinner.succeed(
            `Git migration complete: ${result.entriesStored} commits, ${result.relationsCreated} relations`
          );
        }
      }

      // Phase 2: Skills
      if (runSkills && engine) {
        console.log();
        console.log(chalk.bold('[2/4] Skills Migration'));
        spinner = ora('Starting skills migration...').start();

        const result = await migrateSkills(engine, config, progressCallback);
        results.push(result);

        if (result.errors.length > 0) {
          spinner.warn(`Skills migration completed with ${result.errors.length} errors`);
        } else {
          spinner.succeed(
            `Skills migration complete: ${result.entriesStored} entries, ${result.relationsCreated} relations`
          );
        }
      }

      // Phase 3: Security
      if (runSecurity && engine) {
        console.log();
        console.log(chalk.bold('[3/4] Security Patterns'));
        spinner = ora('Extracting security patterns...').start();

        const result = await migrateSecurity(engine, config, progressCallback);
        results.push(result);

        if (result.errors.length > 0) {
          spinner.warn(`Security extraction completed with ${result.errors.length} errors`);
        } else {
          spinner.succeed(
            `Security extraction complete: ${result.entriesStored} patterns, ${result.relationsCreated} relations`
          );
        }
      }

      // Phase 4: CLAUDE.md
      if (runClaudeMd) {
        console.log();
        console.log(chalk.bold('[4/4] CLAUDE.md Update'));
        spinner = ora('Updating CLAUDE.md...').start();

        const result = await updateClaudeMd(config, progressCallback);
        results.push(result);

        if (result.errors.length > 0) {
          spinner.warn(`CLAUDE.md update completed with ${result.errors.length} errors`);
        } else {
          spinner.succeed('CLAUDE.md updated with routing table');
        }
      }

      // Close engine
      if (engine) {
        await engine.close();
      }

      // Print summary
      const totalDuration = Date.now() - startTime;
      printSummary(results, totalDuration);

    } catch (error) {
      spinner?.fail(chalk.red('Migration failed'));
      console.error(error instanceof Error ? error.message : error);

      // Try to close engine
      if (engine) {
        try {
          await engine.close();
        } catch {
          // Ignore close errors
        }
      }

      process.exit(1);
    }
  });
