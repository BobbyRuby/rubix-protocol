#!/usr/bin/env node
/**
 * Migrate Memories from Another God-Agent Instance
 *
 * Usage: node scripts/migrate-memories.mjs <source-data-dir>
 * Example: node scripts/migrate-memories.mjs "C:/Users/rruby/PhpstormProjects/OneShotProAi/god-agent/data"
 */

import { MemoryEngine } from '../dist/core/MemoryEngine.js';
import { MemorySource } from '../dist/core/types.js';
import Database from 'better-sqlite3';
import { existsSync } from 'fs';
import { join } from 'path';

const sourceDataDir = process.argv[2];

if (!sourceDataDir) {
  console.error('Usage: node scripts/migrate-memories.mjs <source-data-dir>');
  console.error('Example: node scripts/migrate-memories.mjs "C:/Users/rruby/PhpstormProjects/OneShotProAi/god-agent/data"');
  process.exit(1);
}

const sourceDbPath = join(sourceDataDir, 'memory.db');

if (!existsSync(sourceDbPath)) {
  console.error(`Source database not found: ${sourceDbPath}`);
  process.exit(1);
}

async function migrateMemories() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Migrate Memories to RUBIX');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  console.log(`Source: ${sourceDbPath}`);
  console.log('');

  // Open source database (read-only)
  const sourceDb = new Database(sourceDbPath, { readonly: true });

  // Count entries
  const countResult = sourceDb.prepare('SELECT COUNT(*) as count FROM memory_entries').get();
  console.log(`[Source] Found ${countResult.count} memory entries`);

  // Get all entries with their tags
  const entries = sourceDb.prepare(`
    SELECT
      e.id,
      e.content,
      e.source,
      e.importance,
      e.created_at,
      e.updated_at,
      e.context,
      GROUP_CONCAT(t.tag) as tags
    FROM memory_entries e
    LEFT JOIN memory_tags t ON e.id = t.entry_id
    GROUP BY e.id
    ORDER BY e.created_at ASC
  `).all();

  console.log(`[Source] Retrieved ${entries.length} entries with tags`);
  console.log('');

  // Initialize target RUBIX engine
  const targetDataDir = process.env.GOD_AGENT_DATA_DIR || './data';
  console.log(`[Target] Data directory: ${targetDataDir}`);

  const engine = new MemoryEngine({ dataDir: targetDataDir });
  await engine.initialize();
  console.log('[Target] MemoryEngine initialized');
  console.log('');

  // Migrate entries
  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  for (const entry of entries) {
    try {
      // Parse existing tags
      const existingTags = entry.tags ? entry.tags.split(',') : [];

      // Add migration tags
      const tags = [
        ...existingTags,
        'migrated',
        'migrated:oneshotproai'
      ];

      // Parse context if exists
      let metadata = {};
      if (entry.context) {
        try {
          metadata = JSON.parse(entry.context);
        } catch {
          // Ignore parse errors
        }
      }

      // Map source enum
      const sourceMap = {
        'user_input': MemorySource.USER_INPUT,
        'agent_inference': MemorySource.AGENT_INFERENCE,
        'tool_output': MemorySource.TOOL_OUTPUT,
        'system': MemorySource.SYSTEM,
        'external': MemorySource.EXTERNAL
      };

      const source = sourceMap[entry.source] || MemorySource.EXTERNAL;

      // Store in RUBIX
      const newEntry = await engine.store(entry.content, {
        tags: [...new Set(tags)], // Dedupe tags
        source,
        importance: entry.importance || 0.5,
        confidence: 0.8, // Default confidence for migrated entries
        context: {
          ...metadata,
          migratedFrom: 'OneShotProAi',
          originalId: entry.id,
          originalCreatedAt: entry.created_at,
          migratedAt: new Date().toISOString()
        }
      });

      migrated++;

      if (migrated % 100 === 0) {
        console.log(`[Progress] ${migrated}/${entries.length} migrated...`);
      }

    } catch (error) {
      console.error(`[Error] Failed to migrate entry ${entry.id}: ${error.message}`);
      failed++;
    }
  }

  // Close source database
  sourceDb.close();

  // Summary
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Migration Complete');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Source entries: ${entries.length}`);
  console.log(`  Migrated:       ${migrated}`);
  console.log(`  Skipped:        ${skipped}`);
  console.log(`  Failed:         ${failed}`);
  console.log('');
  console.log('  Verify with:');
  console.log('    god_query({ query: "...", tags: ["migrated:oneshotproai"] })');
  console.log('    god_stats()');
  console.log('');
}

migrateMemories().catch((error) => {
  console.error('[Fatal] Migration failed:', error);
  process.exit(1);
});
