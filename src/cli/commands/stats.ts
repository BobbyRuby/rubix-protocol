/**
 * Stats Command
 *
 * Display memory system statistics.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { MemoryEngine } from '../../index.js';

export const statsCommand = new Command('stats')
  .description('Display memory system statistics')
  .option('-d, --data-dir <path>', 'Data directory path', './data')
  .option('-o, --output <format>', 'Output format (json, text)', 'text')
  .action(async (options) => {
    const spinner = ora('Gathering statistics...').start();

    try {
      const engine = new MemoryEngine({ dataDir: options.dataDir });
      await engine.initialize();

      const stats = engine.getStats();

      await engine.close();
      spinner.succeed('Statistics gathered');

      if (options.output === 'json') {
        console.log(JSON.stringify(stats, null, 2));
      } else {
        console.log();
        console.log(chalk.cyan('Rubix Memory Statistics'));
        console.log(chalk.dim('─'.repeat(40)));
        console.log();
        console.log(chalk.dim('Memory Entries:'), chalk.white(stats.totalEntries.toString()));
        console.log(chalk.dim('Vector Count:'), chalk.white(stats.vectorCount.toString()));
        console.log(chalk.dim('Causal Relations:'), chalk.white(stats.causalRelations.toString()));
        console.log(chalk.dim('Pattern Templates:'), chalk.white(stats.patternTemplates.toString()));
        console.log();
        console.log(chalk.dim('Average L-Score:'), chalk.white(stats.avgLScore.toFixed(4)));
        console.log();
      }

    } catch (error) {
      spinner.fail(chalk.red('Failed to gather statistics'));
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });
