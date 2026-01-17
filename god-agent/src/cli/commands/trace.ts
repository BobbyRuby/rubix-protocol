/**
 * Trace Command
 *
 * Trace provenance lineage for memory entries.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { MemoryEngine } from '../../index.js';
import { getLLMCompressor } from '../../memory/LLMCompressor.js';

/**
 * Decompress LLM-compressed content.
 */
async function decompressContent(content: string, tags: string[]): Promise<string> {
  if (!tags.includes('llm-compressed')) {
    return content;
  }

  try {
    const compressor = getLLMCompressor();
    if (compressor.isAvailable()) {
      return await compressor.decompress(content);
    }
  } catch {
    // Not initialized or failed
  }

  return content;
}

export const traceCommand = new Command('trace')
  .description('Trace provenance lineage for an entry')
  .argument('<id>', 'Memory entry ID')
  .option('-d, --data-dir <path>', 'Data directory path', './data')
  .option('-n, --depth <number>', 'Maximum trace depth', '10')
  .option('-o, --output <format>', 'Output format (json, tree)', 'tree')
  .action(async (id, options) => {
    const spinner = ora('Tracing lineage...').start();

    try {
      const engine = new MemoryEngine({ dataDir: options.dataDir });
      await engine.initialize();

      const entry = engine.getEntry(id);
      if (!entry) {
        spinner.fail(chalk.red(`Entry not found: ${id}`));
        process.exit(1);
      }

      const chain = engine.trace(id, parseInt(options.depth, 10));
      const reliability = engine.getReliabilityCategory(id);

      await engine.close();
      spinner.succeed('Lineage traced');

      if (options.output === 'json') {
        const nodesArray = Array.from(chain.nodes.entries()).map(([nodeId, node]) => ({
          id: nodeId,
          depth: node.depth,
          confidence: node.confidence,
          relevance: node.relevance,
          lScore: node.lScore,
          childCount: node.children.length
        }));

        console.log(JSON.stringify({
          rootId: chain.rootId,
          maxDepth: chain.maxDepth,
          aggregateLScore: chain.aggregateLScore,
          reliability,
          nodes: nodesArray
        }, null, 2));
      } else {
        console.log();
        console.log(chalk.cyan('Entry:'), id);
        const tags = entry.metadata.tags || [];
        const content = await decompressContent(entry.content, tags);
        console.log(chalk.dim('Content:'), content.substring(0, 100) + (content.length > 100 ? '...' : ''));
        console.log();

        console.log(chalk.cyan('Provenance Summary:'));
        console.log(chalk.dim('  Max Depth:'), chain.maxDepth);
        console.log(chalk.dim('  Aggregate L-Score:'), chain.aggregateLScore.toFixed(4));
        console.log(chalk.dim('  Reliability:'), getReliabilityColor(reliability)(reliability));
        console.log(chalk.dim('  Total Nodes:'), chain.nodes.size);
        console.log();

        // Print tree
        console.log(chalk.cyan('Lineage Tree:'));
        const rootNode = chain.nodes.get(id);
        if (rootNode) {
          await printTree(rootNode, engine, '', true);
        }
      }

    } catch (error) {
      spinner.fail(chalk.red('Trace failed'));
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

async function printTree(
  node: { entryId: string; depth: number; confidence: number; relevance: number; lScore: number; children: unknown[] },
  engine: MemoryEngine,
  prefix: string,
  isLast: boolean
): Promise<void> {
  const connector = isLast ? '└── ' : '├── ';
  const entry = engine.getEntry(node.entryId);
  let contentPreview = '(unknown)';
  if (entry) {
    const tags = entry.metadata.tags || [];
    const content = await decompressContent(entry.content, tags);
    contentPreview = content.substring(0, 40);
  }

  console.log(
    prefix + connector +
    chalk.dim(`[${node.depth}]`) + ' ' +
    node.entryId.substring(0, 8) + '... ' +
    chalk.dim(`L:${node.lScore.toFixed(2)} C:${node.confidence.toFixed(2)} R:${node.relevance.toFixed(2)}`)
  );
  console.log(prefix + (isLast ? '    ' : '│   ') + chalk.dim(contentPreview + (entry && entry.content.length > 40 ? '...' : '')));

  const children = node.children as typeof node[];
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const childIsLast = i === children.length - 1;
    const newPrefix = prefix + (isLast ? '    ' : '│   ');
    await printTree(child, engine, newPrefix, childIsLast);
  }
}

function getReliabilityColor(reliability: string): (text: string) => string {
  switch (reliability) {
    case 'high': return chalk.green;
    case 'medium': return chalk.yellow;
    case 'low': return chalk.red;
    case 'unreliable': return chalk.bgRed;
    default: return chalk.white;
  }
}
