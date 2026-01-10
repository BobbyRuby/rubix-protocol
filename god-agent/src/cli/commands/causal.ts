/**
 * Causal Command
 *
 * Manage causal relationships between memory entries.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { MemoryEngine, CausalRelationType } from '../../index.js';

export const causalCommand = new Command('causal')
  .description('Manage causal relationships');

// Add subcommand
causalCommand
  .command('add')
  .description('Add a causal relationship')
  .requiredOption('-s, --sources <ids>', 'Source entry IDs (comma-separated)')
  .requiredOption('-t, --targets <ids>', 'Target entry IDs (comma-separated)')
  .option('-d, --data-dir <path>', 'Data directory path', './data')
  .option('--type <type>', 'Relation type (causes, enables, prevents, correlates, precedes, triggers)', 'causes')
  .option('--strength <number>', 'Relationship strength (0-1)', '0.8')
  .option('-o, --output <format>', 'Output format (json, text)', 'text')
  .action(async (options) => {
    const spinner = ora('Adding causal relationship...').start();

    try {
      const engine = new MemoryEngine({ dataDir: options.dataDir });
      await engine.initialize();

      const sourceIds = options.sources.split(',').map((s: string) => s.trim());
      const targetIds = options.targets.split(',').map((t: string) => t.trim());

      const typeMap: Record<string, CausalRelationType> = {
        'causes': CausalRelationType.CAUSES,
        'enables': CausalRelationType.ENABLES,
        'prevents': CausalRelationType.PREVENTS,
        'correlates': CausalRelationType.CORRELATES,
        'precedes': CausalRelationType.PRECEDES,
        'triggers': CausalRelationType.TRIGGERS
      };

      const relation = engine.addCausalRelation(
        sourceIds,
        targetIds,
        typeMap[options.type] ?? CausalRelationType.CAUSES,
        parseFloat(options.strength)
      );

      await engine.close();
      spinner.succeed('Causal relationship added');

      if (options.output === 'json') {
        console.log(JSON.stringify({
          id: relation.id,
          type: relation.type,
          sourceIds: relation.sourceIds,
          targetIds: relation.targetIds,
          strength: relation.strength,
          createdAt: relation.createdAt.toISOString()
        }, null, 2));
      } else {
        console.log();
        console.log(chalk.dim('ID:'), relation.id);
        console.log(chalk.dim('Type:'), relation.type);
        console.log(chalk.dim('Sources:'), relation.sourceIds.join(', '));
        console.log(chalk.dim('Targets:'), relation.targetIds.join(', '));
        console.log(chalk.dim('Strength:'), relation.strength);
      }

    } catch (error) {
      spinner.fail(chalk.red('Failed to add relationship'));
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Find subcommand
causalCommand
  .command('find')
  .description('Find causal paths from an entry')
  .argument('<id>', 'Starting entry ID')
  .option('-d, --data-dir <path>', 'Data directory path', './data')
  .option('--direction <dir>', 'Traversal direction (forward, backward, both)', 'forward')
  .option('-n, --depth <number>', 'Maximum depth', '5')
  .option('--type <types>', 'Filter by relation types (comma-separated)')
  .option('--min-strength <number>', 'Minimum strength threshold')
  .option('-o, --output <format>', 'Output format (json, mermaid, text)', 'text')
  .action(async (id, options) => {
    const spinner = ora('Finding causal relationships...').start();

    try {
      const engine = new MemoryEngine({ dataDir: options.dataDir });
      await engine.initialize();

      const typeMap: Record<string, CausalRelationType> = {
        'causes': CausalRelationType.CAUSES,
        'enables': CausalRelationType.ENABLES,
        'prevents': CausalRelationType.PREVENTS,
        'correlates': CausalRelationType.CORRELATES,
        'precedes': CausalRelationType.PRECEDES,
        'triggers': CausalRelationType.TRIGGERS
      };

      const relationTypes = options.type
        ? options.type.split(',').map((t: string) => typeMap[t.trim()]).filter(Boolean)
        : undefined;

      const result = engine.traverseCausal({
        startNodeIds: [id],
        direction: options.direction,
        maxDepth: parseInt(options.depth, 10),
        relationTypes,
        minStrength: options.minStrength ? parseFloat(options.minStrength) : undefined
      });

      await engine.close();
      spinner.succeed(`Found ${result.paths.length} causal paths`);

      if (result.paths.length === 0) {
        console.log(chalk.yellow('\nNo causal relationships found.'));
        return;
      }

      if (options.output === 'json') {
        console.log(JSON.stringify({
          startId: id,
          direction: options.direction,
          paths: result.paths,
          visitedNodes: Array.from(result.visitedNodes),
          visitedEdges: Array.from(result.visitedEdges)
        }, null, 2));
      } else if (options.output === 'mermaid') {
        console.log('\n```mermaid');
        console.log(engine.causalToMermaid());
        console.log('```');
      } else {
        console.log();
        console.log(chalk.cyan('Causal Paths from'), id.substring(0, 8) + '...');
        console.log(chalk.dim('Direction:'), options.direction);
        console.log(chalk.dim('Visited Nodes:'), result.visitedNodes.size);
        console.log();

        for (let i = 0; i < Math.min(result.paths.length, 10); i++) {
          const path = result.paths[i];
          console.log(chalk.cyan(`[Path ${i + 1}]`), chalk.dim('Strength:'), path.totalStrength.toFixed(4));
          console.log(chalk.dim('  Nodes:'), path.nodes.map(n => n.substring(0, 8) + '...').join(' -> '));
          console.log(chalk.dim('  Types:'), path.relationTypes.join(' -> '));
          console.log();
        }

        if (result.paths.length > 10) {
          console.log(chalk.dim(`... and ${result.paths.length - 10} more paths`));
        }
      }

    } catch (error) {
      spinner.fail(chalk.red('Find failed'));
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Effects subcommand
causalCommand
  .command('effects')
  .description('Find all effects (consequences) of an entry')
  .argument('<id>', 'Entry ID')
  .option('-d, --data-dir <path>', 'Data directory path', './data')
  .option('-n, --depth <number>', 'Maximum depth', '5')
  .option('-o, --output <format>', 'Output format (json, text)', 'text')
  .action(async (id, options) => {
    const spinner = ora('Finding effects...').start();

    try {
      const engine = new MemoryEngine({ dataDir: options.dataDir });
      await engine.initialize();

      const effects = engine.findEffects(id, parseInt(options.depth, 10));

      await engine.close();
      spinner.succeed(`Found ${effects.length} effects`);

      if (options.output === 'json') {
        console.log(JSON.stringify({ sourceId: id, effects }, null, 2));
      } else {
        console.log();
        if (effects.length === 0) {
          console.log(chalk.yellow('No effects found.'));
        } else {
          console.log(chalk.cyan('Effects of'), id.substring(0, 8) + '...');
          for (const effectId of effects) {
            const entry = engine.getEntry(effectId);
            console.log(chalk.dim('  -'), effectId.substring(0, 8) + '...',
              entry ? chalk.dim(entry.content.substring(0, 40) + '...') : '');
          }
        }
      }

    } catch (error) {
      spinner.fail(chalk.red('Failed to find effects'));
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Causes subcommand
causalCommand
  .command('causes')
  .description('Find all causes of an entry')
  .argument('<id>', 'Entry ID')
  .option('-d, --data-dir <path>', 'Data directory path', './data')
  .option('-n, --depth <number>', 'Maximum depth', '5')
  .option('-o, --output <format>', 'Output format (json, text)', 'text')
  .action(async (id, options) => {
    const spinner = ora('Finding causes...').start();

    try {
      const engine = new MemoryEngine({ dataDir: options.dataDir });
      await engine.initialize();

      const causes = engine.findCauses(id, parseInt(options.depth, 10));

      await engine.close();
      spinner.succeed(`Found ${causes.length} causes`);

      if (options.output === 'json') {
        console.log(JSON.stringify({ targetId: id, causes }, null, 2));
      } else {
        console.log();
        if (causes.length === 0) {
          console.log(chalk.yellow('No causes found.'));
        } else {
          console.log(chalk.cyan('Causes of'), id.substring(0, 8) + '...');
          for (const causeId of causes) {
            const entry = engine.getEntry(causeId);
            console.log(chalk.dim('  -'), causeId.substring(0, 8) + '...',
              entry ? chalk.dim(entry.content.substring(0, 40) + '...') : '');
          }
        }
      }

    } catch (error) {
      spinner.fail(chalk.red('Failed to find causes'));
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });
