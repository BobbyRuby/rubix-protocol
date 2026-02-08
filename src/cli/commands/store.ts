/**
 * Store Command
 *
 * Store content in memory with embeddings and provenance tracking.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { MemoryEngine, MemorySource } from '../../index.js';

export const storeCommand = new Command('store')
  .description('Store content in memory')
  .argument('<content>', 'Content to store')
  .option('-d, --data-dir <path>', 'Data directory path', './data')
  .option('-t, --tags <tags>', 'Comma-separated tags')
  .option('-i, --importance <number>', 'Importance score (0-1)', '0.5')
  .option('-p, --parent <ids>', 'Comma-separated parent entry IDs')
  .option('-s, --source <source>', 'Source type (user_input, agent_inference, tool_output, system, external)', 'user_input')
  .option('-c, --confidence <number>', 'Confidence score (0-1)', '1.0')
  .option('-r, --relevance <number>', 'Relevance score (0-1)', '1.0')
  .option('--session <id>', 'Session ID')
  .option('--agent <id>', 'Agent ID')
  .option('-o, --output <format>', 'Output format (json, text)', 'text')
  .action(async (content, options) => {
    const spinner = ora('Storing memory...').start();

    try {
      const engine = new MemoryEngine({ dataDir: options.dataDir });
      await engine.initialize();

      const tags = options.tags ? options.tags.split(',').map((t: string) => t.trim()) : [];
      const parentIds = options.parent ? options.parent.split(',').map((p: string) => p.trim()) : [];

      const sourceMap: Record<string, MemorySource> = {
        'user_input': MemorySource.USER_INPUT,
        'agent_inference': MemorySource.AGENT_INFERENCE,
        'tool_output': MemorySource.TOOL_OUTPUT,
        'system': MemorySource.SYSTEM,
        'external': MemorySource.EXTERNAL
      };

      const entry = await engine.store(content, {
        tags,
        importance: parseFloat(options.importance),
        parentIds: parentIds.length > 0 ? parentIds : undefined,
        source: sourceMap[options.source] ?? MemorySource.USER_INPUT,
        confidence: parseFloat(options.confidence),
        relevance: parseFloat(options.relevance),
        sessionId: options.session,
        agentId: options.agent
      });

      await engine.close();
      spinner.succeed('Memory stored successfully');

      if (options.output === 'json') {
        console.log(JSON.stringify({
          id: entry.id,
          content: entry.content,
          metadata: entry.metadata,
          provenance: entry.provenance,
          createdAt: entry.createdAt.toISOString()
        }, null, 2));
      } else {
        console.log();
        console.log(chalk.dim('ID:'), entry.id);
        console.log(chalk.dim('Content:'), entry.content.substring(0, 100) + (entry.content.length > 100 ? '...' : ''));
        console.log(chalk.dim('Tags:'), entry.metadata.tags.join(', ') || '(none)');
        console.log(chalk.dim('Source:'), entry.metadata.source);
        console.log(chalk.dim('Importance:'), entry.metadata.importance);
        console.log(chalk.dim('L-Score:'), entry.provenance.lScore?.toFixed(4) ?? 'N/A');
        console.log(chalk.dim('Lineage Depth:'), entry.provenance.lineageDepth);
      }

    } catch (error) {
      spinner.fail(chalk.red('Failed to store memory'));
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });
