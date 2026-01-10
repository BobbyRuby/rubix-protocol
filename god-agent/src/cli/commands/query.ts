/**
 * Query Command
 *
 * Search memories by semantic similarity.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { MemoryEngine, MemorySource } from '../../index.js';

export const queryCommand = new Command('query')
  .description('Search memories by semantic similarity')
  .argument('<text>', 'Search query text')
  .option('-d, --data-dir <path>', 'Data directory path', './data')
  .option('-k, --top-k <number>', 'Number of results', '10')
  .option('-m, --min-score <number>', 'Minimum similarity score', '0.0')
  .option('--trace', 'Include provenance information', false)
  .option('--sources <sources>', 'Filter by sources (comma-separated)')
  .option('--tags <tags>', 'Filter by tags (comma-separated)')
  .option('--min-importance <number>', 'Minimum importance score')
  .option('--session <id>', 'Filter by session ID')
  .option('--agent <id>', 'Filter by agent ID')
  .option('-o, --output <format>', 'Output format (json, table)', 'table')
  .action(async (text, options) => {
    const spinner = ora('Searching memories...').start();

    try {
      const engine = new MemoryEngine({ dataDir: options.dataDir });
      await engine.initialize();

      const sourceMap: Record<string, MemorySource> = {
        'user_input': MemorySource.USER_INPUT,
        'agent_inference': MemorySource.AGENT_INFERENCE,
        'tool_output': MemorySource.TOOL_OUTPUT,
        'system': MemorySource.SYSTEM,
        'external': MemorySource.EXTERNAL
      };

      const filters: Record<string, unknown> = {};

      if (options.sources) {
        filters.sources = options.sources.split(',').map((s: string) => sourceMap[s.trim()]).filter(Boolean);
      }
      if (options.tags) {
        filters.tags = options.tags.split(',').map((t: string) => t.trim());
      }
      if (options.minImportance) {
        filters.minImportance = parseFloat(options.minImportance);
      }
      if (options.session) {
        filters.sessionId = options.session;
      }
      if (options.agent) {
        filters.agentId = options.agent;
      }

      const results = await engine.query(text, {
        topK: parseInt(options.topK, 10),
        minScore: parseFloat(options.minScore),
        filters: Object.keys(filters).length > 0 ? filters : undefined,
        includeProvenance: options.trace
      });

      await engine.close();
      spinner.succeed(`Found ${results.length} results`);

      if (results.length === 0) {
        console.log(chalk.yellow('\nNo matching memories found.'));
        return;
      }

      if (options.output === 'json') {
        const output = results.map(r => ({
          id: r.entry.id,
          content: r.entry.content,
          score: r.score,
          lScore: r.lScore,
          metadata: r.entry.metadata,
          provenance: r.entry.provenance
        }));
        console.log(JSON.stringify(output, null, 2));
      } else {
        console.log();
        for (let i = 0; i < results.length; i++) {
          const r = results[i];
          console.log(chalk.cyan(`[${i + 1}]`), chalk.dim('Score:'), r.score.toFixed(4));
          console.log(chalk.dim('    ID:'), r.entry.id);
          console.log(chalk.dim('    Content:'), r.entry.content.substring(0, 80) + (r.entry.content.length > 80 ? '...' : ''));
          if (r.entry.metadata.tags.length > 0) {
            console.log(chalk.dim('    Tags:'), r.entry.metadata.tags.join(', '));
          }
          if (options.trace && r.lScore !== undefined) {
            console.log(chalk.dim('    L-Score:'), r.lScore.toFixed(4));
            console.log(chalk.dim('    Lineage:'), r.entry.provenance.lineageDepth);
          }
          console.log();
        }
      }

    } catch (error) {
      spinner.fail(chalk.red('Query failed'));
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });
