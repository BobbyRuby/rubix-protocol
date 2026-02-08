/**
 * Legacy Database Discovery & Import
 *
 * Finds legacy god-agent/rubix installations, processes entries,
 * and offers interactive import during assimilation.
 */

import Database from 'better-sqlite3';
import chalk from 'chalk';
import { glob } from 'glob';
import { homedir } from 'os';
import { join } from 'path';
import { existsSync, readFileSync, statSync } from 'fs';
import { createInterface } from 'readline';
import { MemoryEngine } from '../../core/MemoryEngine.js';
import { MemorySource } from '../../core/types.js';
import { InputCompressor } from '../../prompts/InputCompressor.js';

// ============================================================
// Types
// ============================================================

export interface LegacyEntry {
  id: string;
  content: string;
  tags: string[];
  source: string;
  importance: number;
  created_at: string;
}

export interface ProcessedEntry {
  content: string;
  tags: string[];
  classification: 'system' | 'learning' | 'project' | 'skip';
  similarity: number;
  recommendation: 'import' | 'skip' | 'merge';
  original: LegacyEntry;
}

export interface DatabaseSummary {
  path: string;
  totalEntries: number;
  systemEntries: number;
  projectEntries: number;
  oldestEntry: string | null;
  newestEntry: string | null;
  topTags: Array<{ tag: string; count: number }>;
  sizeBytes: number;
}

// ============================================================
// Discovery
// ============================================================

/**
 * Search for legacy god-agent/rubix databases
 */
export async function discoverLegacyDatabases(currentDbPath: string): Promise<string[]> {
  const found: string[] = [];
  const home = homedir();

  // Common search patterns
  const patterns = [
    // User home directories
    join(home, '*', 'god-agent', 'data', 'memory.db'),
    join(home, '*', 'rubix', 'data', 'memory.db'),
    join(home, 'Projects', '*', 'god-agent', 'data', 'memory.db'),
    join(home, 'Projects', '*', 'rubix', 'data', 'memory.db'),
    join(home, 'projects', '*', 'god-agent', 'data', 'memory.db'),
    join(home, 'projects', '*', 'rubix', 'data', 'memory.db'),
    // Windows common locations
    'C:\\Projects\\*\\god-agent\\data\\memory.db',
    'C:\\Projects\\*\\rubix\\data\\memory.db',
    'D:\\*\\god-agent\\data\\memory.db',
    'D:\\*\\rubix\\data\\memory.db',
  ];

  for (const pattern of patterns) {
    try {
      const matches = await glob(pattern, { windowsPathsNoEscape: true });
      found.push(...matches);
    } catch {
      // Pattern didn't match, continue
    }
  }

  // Also search for mcp.json references
  try {
    const mcpConfigs = await glob(join(home, '**', '.claude', 'mcp.json'), {
      ignore: ['**/node_modules/**'],
      windowsPathsNoEscape: true,
    });

    for (const configPath of mcpConfigs) {
      try {
        const content = JSON.parse(readFileSync(configPath, 'utf-8'));
        if (content.mcpServers) {
          for (const server of Object.values(content.mcpServers) as any[]) {
            if (server.cwd) {
              const dbPath = join(server.cwd, 'data', 'memory.db');
              if (existsSync(dbPath)) {
                found.push(dbPath);
              }
            }
          }
        }
      } catch {
        // Invalid JSON or structure, continue
      }
    }
  } catch {
    // glob failed, continue
  }

  // Normalize current path for comparison
  const currentNormalized = currentDbPath.replace(/\\/g, '/').toLowerCase();

  // Filter out current database and duplicates
  const unique = [...new Set(found)].filter(p => {
    const norm = p.replace(/\\/g, '/').toLowerCase();
    return norm !== currentNormalized && existsSync(p);
  });

  return unique;
}

// ============================================================
// Database Summary
// ============================================================

/**
 * Get summary of a legacy database
 */
export function getDatabaseSummary(dbPath: string): DatabaseSummary {
  const db = new Database(dbPath, { readonly: true });

  try {
    // Basic stats
    const stats = db.prepare(`
      SELECT
        COUNT(*) as total,
        MIN(created_at) as oldest,
        MAX(created_at) as newest
      FROM memory_entries
    `).get() as { total: number; oldest: string | null; newest: string | null };

    // System entry count
    const systemResult = db.prepare(`
      SELECT COUNT(DISTINCT me.id) as count
      FROM memory_entries me
      JOIN memory_tags mt ON me.id = mt.entry_id
      WHERE mt.tag LIKE 'rubix:%' OR mt.tag LIKE 'system%'
    `).get() as { count: number };

    // Top tags
    const tags = db.prepare(`
      SELECT tag, COUNT(*) as count
      FROM memory_tags
      GROUP BY tag
      ORDER BY count DESC
      LIMIT 10
    `).all() as Array<{ tag: string; count: number }>;

    // File size
    const fileStats = statSync(dbPath);

    return {
      path: dbPath,
      totalEntries: stats.total,
      systemEntries: systemResult.count,
      projectEntries: stats.total - systemResult.count,
      oldestEntry: stats.oldest,
      newestEntry: stats.newest,
      topTags: tags,
      sizeBytes: fileStats.size,
    };
  } finally {
    db.close();
  }
}

/**
 * Display database summary
 */
export function displaySummary(summary: DatabaseSummary): void {
  console.log('');
  console.log(chalk.cyan(`Found: ${summary.path}`));
  console.log(chalk.gray('─'.repeat(50)));
  console.log(`  Entries:     ${chalk.white(summary.totalEntries)}`);
  console.log(`  System:      ${chalk.green(summary.systemEntries)} (rubix:*)`);
  console.log(`  Project:     ${chalk.yellow(summary.projectEntries)}`);

  if (summary.oldestEntry && summary.newestEntry) {
    const oldest = summary.oldestEntry.split('T')[0];
    const newest = summary.newestEntry.split('T')[0];
    console.log(`  Date range:  ${chalk.gray(oldest)} to ${chalk.gray(newest)}`);
  }

  if (summary.topTags.length > 0) {
    const tagStr = summary.topTags.slice(0, 5).map(t => t.tag).join(', ');
    console.log(`  Top tags:    ${chalk.gray(tagStr)}`);
  }

  const sizeMB = (summary.sizeBytes / 1024 / 1024).toFixed(1);
  console.log(`  Size:        ${chalk.gray(sizeMB + ' MB')}`);
  console.log('');
}

// ============================================================
// Entry Processing
// ============================================================

/**
 * Iterate over entries in a legacy database
 */
export function* iterateLegacyEntries(dbPath: string): Generator<LegacyEntry> {
  const db = new Database(dbPath, { readonly: true });

  try {
    const entries = db.prepare(`
      SELECT me.id, me.content, me.source, me.importance, me.created_at,
             GROUP_CONCAT(mt.tag) as tags
      FROM memory_entries me
      LEFT JOIN memory_tags mt ON me.id = mt.entry_id
      GROUP BY me.id
      ORDER BY me.created_at
    `).all() as Array<{
      id: string;
      content: string;
      source: string;
      importance: number;
      created_at: string;
      tags: string | null;
    }>;

    for (const entry of entries) {
      yield {
        id: entry.id,
        content: entry.content,
        tags: entry.tags ? entry.tags.split(',') : [],
        source: entry.source,
        importance: entry.importance,
        created_at: entry.created_at,
      };
    }
  } finally {
    db.close();
  }
}

/**
 * Classify an entry type
 */
function classifyEntry(entry: LegacyEntry): 'system' | 'learning' | 'project' {
  // Check for system knowledge patterns
  if (entry.content.startsWith('SYS:')) return 'system';
  if (entry.tags.some(t => t.startsWith('rubix:'))) return 'system';
  if (entry.tags.some(t => t === 'system' || t === 'self-knowledge')) return 'system';

  // Check for learning patterns
  if (entry.tags.some(t => t.includes('failure') || t.includes('pattern'))) return 'learning';

  // Everything else is project-specific
  return 'project';
}

/**
 * Check if content is already in token format
 */
function isTokenFormat(content: string): boolean {
  // Token format starts with KEY: pattern
  return /^[A-Z]+:/m.test(content);
}

/**
 * Convert prose to token format if needed
 */
function convertToTokenFormat(content: string, classification: string): string {
  if (isTokenFormat(content)) {
    return content; // Already in token format
  }

  // For system knowledge, try to extract structure
  if (classification === 'system') {
    // Try to compress using InputCompressor
    try {
      const result = InputCompressor.compress(content);
      return result.compressed;
    } catch {
      return content; // Keep original if compression fails
    }
  }

  // For learning patterns, keep as-is (they may have specific structure)
  return content;
}

/**
 * Map legacy tags to RUBIX tag system
 */
function mapToRubixTags(oldTags: string[], classification: string): string[] {
  const newTags: string[] = [];

  // Add classification tag
  if (classification === 'system') newTags.push('rubix:core');
  if (classification === 'learning') newTags.push('rubix:learning');

  // Map known legacy tags
  const tagMap: Record<string, string> = {
    'self-knowledge': 'rubix:self',
    'system': 'rubix:core',
    'failure': 'rubix:failure',
    'pattern': 'rubix:learning',
    'config': 'rubix:config',
    'capability': 'rubix:capability',
  };

  for (const tag of oldTags) {
    if (tagMap[tag]) {
      newTags.push(tagMap[tag]);
    } else if (tag.startsWith('rubix:')) {
      newTags.push(tag);
    }
  }

  return [...new Set(newTags)];
}

/**
 * Process a legacy entry for import
 */
export async function processLegacyEntry(
  entry: LegacyEntry,
  engine: MemoryEngine
): Promise<ProcessedEntry> {
  // 1. Classify
  const classification = classifyEntry(entry);

  // 2. Convert to token format if needed
  const content = convertToTokenFormat(entry.content, classification);

  // 3. Check for duplicates
  let similarity = 0;
  try {
    const similar = await engine.query(content, { topK: 1 });
    similarity = similar[0]?.score || 0;
  } catch {
    // Query failed, assume no duplicates
  }

  // 4. Map tags
  const tags = mapToRubixTags(entry.tags, classification);

  // 5. Determine recommendation
  let recommendation: 'import' | 'skip' | 'merge';
  if (similarity > 0.95) {
    recommendation = 'skip'; // Already exists
  } else if (similarity > 0.7) {
    recommendation = 'merge'; // Similar, might merge
  } else if (classification === 'project') {
    recommendation = 'skip'; // Project data, don't import
  } else {
    recommendation = 'import';
  }

  return {
    content,
    tags,
    classification,
    similarity,
    recommendation,
    original: entry,
  };
}

/**
 * Display a processed entry for review
 */
export function displayProcessedEntry(
  index: number,
  total: number,
  processed: ProcessedEntry
): void {
  console.log('');
  console.log(chalk.cyan(`Processing entry ${index}/${total}`));
  console.log(chalk.gray('─'.repeat(50)));

  // Show content preview
  const preview = processed.content.substring(0, 200);
  console.log(chalk.white('Content:'));
  console.log(chalk.gray(`  "${preview}${processed.content.length > 200 ? '...' : ''}"`));
  console.log('');

  // Classification
  const classColor = processed.classification === 'system' ? chalk.green :
                     processed.classification === 'learning' ? chalk.yellow :
                     chalk.gray;
  console.log(`Classification: ${classColor(processed.classification.toUpperCase())}`);

  // Similarity
  const simPercent = Math.round(processed.similarity * 100);
  const simColor = simPercent > 70 ? chalk.red : simPercent > 30 ? chalk.yellow : chalk.green;
  console.log(`Similarity:     ${simColor(simPercent + '%')} ${simPercent > 70 ? '(duplicate?)' : '(new content)'}`);

  // Tags
  console.log(`Tags:           ${chalk.cyan(processed.tags.join(', ') || '(none)')}`);

  // Recommendation
  const recColor = processed.recommendation === 'import' ? chalk.green :
                   processed.recommendation === 'merge' ? chalk.yellow :
                   chalk.gray;
  console.log(`Recommendation: ${recColor(processed.recommendation.toUpperCase())}`);
  console.log('');
}

// ============================================================
// Interactive Import
// ============================================================

/**
 * Prompt for user input
 */
async function prompt(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Import a processed entry into the engine
 */
async function importEntry(engine: MemoryEngine, processed: ProcessedEntry): Promise<void> {
  await engine.store(processed.content, {
    tags: processed.tags,
    source: MemorySource.SYSTEM,
    importance: processed.original.importance || 1.0,
  });
}

/**
 * Run interactive import from a legacy database
 */
export async function runInteractiveImport(
  dbPath: string,
  engine: MemoryEngine,
  summary: DatabaseSummary,
  skipPrompts: boolean = false
): Promise<{ imported: number; skipped: number }> {
  let importAllSystem = skipPrompts; // Auto-import system if skipPrompts
  let skipRest = false;
  let imported = 0;
  let skipped = 0;
  let idx = 0;

  for (const entry of iterateLegacyEntries(dbPath)) {
    idx++;

    if (skipRest) {
      skipped++;
      continue;
    }

    const processed = await processLegacyEntry(entry, engine);

    // Auto-skip project data
    if (processed.classification === 'project') {
      skipped++;
      continue;
    }

    // Auto-import system entries if user chose "All" or skipPrompts
    if (importAllSystem && processed.classification === 'system') {
      await importEntry(engine, processed);
      imported++;
      process.stdout.write(chalk.green('.'));
      continue;
    }

    // Auto-skip high-similarity entries
    if (processed.similarity > 0.95) {
      skipped++;
      continue;
    }

    // If skipPrompts, auto-skip non-system entries (don't prompt)
    if (skipPrompts) {
      skipped++;
      continue;
    }

    // Show entry and ask
    displayProcessedEntry(idx, summary.totalEntries, processed);

    const action = await prompt(
      chalk.cyan('[I]mport  [S]kip  [A]ll-system  [N]one-remaining  [V]iew-full  > ')
    );

    switch (action.toLowerCase()) {
      case 'i':
      case '':  // Enter = import
        await importEntry(engine, processed);
        imported++;
        console.log(chalk.green('  ✓ Imported'));
        break;

      case 's':
        skipped++;
        console.log(chalk.gray('  ○ Skipped'));
        break;

      case 'a':
        importAllSystem = true;
        await importEntry(engine, processed);
        imported++;
        console.log(chalk.green('  ✓ Imported (auto-importing remaining system entries...)'));
        break;

      case 'n':
        skipRest = true;
        skipped++;
        console.log(chalk.gray('  ○ Skipping all remaining entries'));
        break;

      case 'v':
        console.log(chalk.gray('\n--- Full Content ---'));
        console.log(processed.original.content);
        console.log(chalk.gray('--- End Content ---\n'));
        // Re-show the prompt
        idx--;
        break;

      default:
        // Unknown input, skip
        skipped++;
        break;
    }
  }

  console.log('');
  return { imported, skipped };
}

/**
 * Main entry point for legacy import during assimilation
 */
export async function discoverAndImportLegacy(
  currentDbPath: string,
  engine: MemoryEngine,
  skipPrompts: boolean = false
): Promise<{ totalImported: number; totalSkipped: number; databasesProcessed: number }> {
  console.log(chalk.cyan('\n[LEGACY DISCOVERY] Searching for existing RUBIX/god-agent databases...'));

  const legacyDbs = await discoverLegacyDatabases(currentDbPath);

  if (legacyDbs.length === 0) {
    console.log(chalk.gray('  No legacy databases found.\n'));
    return { totalImported: 0, totalSkipped: 0, databasesProcessed: 0 };
  }

  console.log(chalk.green(`  Found ${legacyDbs.length} legacy database(s)\n`));

  let totalImported = 0;
  let totalSkipped = 0;
  let databasesProcessed = 0;

  for (const dbPath of legacyDbs) {
    try {
      const summary = getDatabaseSummary(dbPath);
      displaySummary(summary);

      if (summary.systemEntries === 0) {
        console.log(chalk.gray('  No system entries to import. Skipping.\n'));
        continue;
      }

      if (skipPrompts) {
        // Auto-import all system entries, skip non-system
        console.log(chalk.yellow('  Auto-importing system entries (--yes flag)...'));
        const { imported, skipped } = await runInteractiveImport(dbPath, engine, summary, true);
        totalImported += imported;
        totalSkipped += skipped;
        databasesProcessed++;
      } else {
        const answer = await prompt(
          chalk.cyan('  Process entries from this database? [Y/n]: ')
        );

        if (answer.toLowerCase() === 'n') {
          console.log(chalk.gray('  Skipped.\n'));
          continue;
        }

        const { imported, skipped } = await runInteractiveImport(dbPath, engine, summary);
        totalImported += imported;
        totalSkipped += skipped;
        databasesProcessed++;
      }

      console.log(chalk.green(`  ✓ Database processed: ${totalImported} imported, ${totalSkipped} skipped\n`));

    } catch (error) {
      console.log(chalk.red(`  ✗ Error processing ${dbPath}: ${error instanceof Error ? error.message : 'Unknown error'}\n`));
    }
  }

  return { totalImported, totalSkipped, databasesProcessed };
}
