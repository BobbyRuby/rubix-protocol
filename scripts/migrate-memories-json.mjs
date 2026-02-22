#!/usr/bin/env node
/**
 * Import Core Memories from JSON Export
 *
 * Usage: node scripts/migrate-memories-json.mjs <json-file-path>
 * Example: node scripts/migrate-memories-json.mjs rubix-core-memories.json
 */

import { MemoryEngine } from '../dist/core/MemoryEngine.js';
import { MemorySource } from '../dist/core/types.js';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const jsonPath = process.argv[2];

if (!jsonPath) {
  console.error('Usage: node scripts/migrate-memories-json.mjs <json-file-path>');
  console.error('Example: node scripts/migrate-memories-json.mjs rubix-core-memories.json');
  process.exit(1);
}

const resolvedPath = resolve(jsonPath);

if (!existsSync(resolvedPath)) {
  console.error(`JSON file not found: ${resolvedPath}`);
  process.exit(1);
}

const sourceMap = {
  'user_input': MemorySource.USER_INPUT,
  'agent_inference': MemorySource.AGENT_INFERENCE,
  'tool_output': MemorySource.TOOL_OUTPUT,
  'system': MemorySource.SYSTEM,
  'external': MemorySource.EXTERNAL
};

async function importMemories() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Import Core Memories from JSON');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  console.log(`Source: ${resolvedPath}`);
  console.log('');

  // Read and parse JSON
  const raw = readFileSync(resolvedPath, 'utf-8');
  const data = JSON.parse(raw);

  const entries = data.entries;
  if (!Array.isArray(entries) || entries.length === 0) {
    console.error('No entries found in JSON file');
    process.exit(1);
  }

  console.log(`[Source] ${data.description || 'No description'}`);
  console.log(`[Source] Export date: ${data.exportDate || 'unknown'}`);
  console.log(`[Source] Found ${entries.length} entries`);
  console.log('');

  // Initialize target engine
  const targetDataDir = process.env.GOD_AGENT_DATA_DIR || process.env.RUBIX_DATA_DIR || './data';
  console.log(`[Target] Data directory: ${targetDataDir}`);

  const engine = new MemoryEngine({ dataDir: targetDataDir });
  await engine.initialize();
  console.log('[Target] MemoryEngine initialized');
  console.log('');

  // Import entries
  let imported = 0;
  let failed = 0;

  for (const entry of entries) {
    try {
      const source = sourceMap[entry.source] || MemorySource.EXTERNAL;

      const tags = [
        ...(entry.tags || []),
        'imported:core-export',
        `originalId:${entry.id}`
      ];

      await engine.store(entry.content, {
        tags: [...new Set(tags)],
        source,
        importance: entry.importance || 0.5,
        confidence: 0.95,
        context: {
          category: entry.category,
          originalId: entry.id,
          importedAt: new Date().toISOString()
        }
      });

      imported++;
      console.log(`  [${imported}/${entries.length}] ${entry.category} (${entry.id})`);
    } catch (error) {
      console.error(`  [ERROR] Failed to import ${entry.id}: ${error.message}`);
      failed++;
    }
  }

  // Summary
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Import Complete');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Source entries: ${entries.length}`);
  console.log(`  Imported:       ${imported}`);
  console.log(`  Failed:         ${failed}`);
  console.log('');
  console.log('  Verify with:');
  console.log('    god_query({ query: "user style", tags: ["core_memory"], topK: 5 })');
  console.log('    god_query({ query: "code quality", tags: ["imported:core-export"], topK: 5 })');
  console.log('    god_stats()');
  console.log('');
}

importMemories().catch((error) => {
  console.error('[Fatal] Import failed:', error);
  process.exit(1);
});
