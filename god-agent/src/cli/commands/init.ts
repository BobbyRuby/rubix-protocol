/**
 * Init Command
 *
 * Initialize the God Agent data directory and database.
 */

import { Command } from 'commander';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import ora from 'ora';

export const initCommand = new Command('init')
  .description('Initialize God Agent data directory')
  .option('-d, --data-dir <path>', 'Data directory path', './data')
  .option('-f, --force', 'Overwrite existing configuration', false)
  .action(async (options) => {
    const spinner = ora('Initializing God Agent...').start();

    try {
      const dataDir = options.dataDir;

      // Check if already initialized
      if (existsSync(join(dataDir, 'memory.db')) && !options.force) {
        spinner.warn('Data directory already initialized. Use --force to reinitialize.');
        return;
      }

      // Create data directory
      if (!existsSync(dataDir)) {
        mkdirSync(dataDir, { recursive: true });
        spinner.text = 'Created data directory';
      }

      // Create config file
      const configPath = join(dataDir, 'config.json');
      const config = {
        version: '0.1.0',
        createdAt: new Date().toISOString(),
        settings: {
          embeddingModel: 'text-embedding-3-small',
          embeddingDimensions: 768,
          hnswMaxElements: 100000,
          hnswEfConstruction: 200,
          hnswEfSearch: 100,
          hnswM: 16,
          lScoreDecay: 0.9,
          lScoreMin: 0.01
        }
      };

      writeFileSync(configPath, JSON.stringify(config, null, 2));

      // Import and initialize memory engine to create database
      const { MemoryEngine } = await import('../../core/MemoryEngine.js');
      const engine = new MemoryEngine({ dataDir });
      await engine.initialize();
      await engine.close();

      spinner.succeed(chalk.green('God Agent initialized successfully!'));
      console.log();
      console.log(chalk.dim('Data directory:'), dataDir);
      console.log(chalk.dim('Database:'), join(dataDir, 'memory.db'));
      console.log(chalk.dim('Vector index:'), join(dataDir, 'vectors.hnsw'));
      console.log();
      console.log(chalk.cyan('Next steps:'));
      console.log('  god-agent store "Your first memory"');
      console.log('  god-agent query "Search for memories"');

    } catch (error) {
      spinner.fail(chalk.red('Initialization failed'));
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });
