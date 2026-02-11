#!/usr/bin/env node
/**
 * Import Polyglot Knowledge into RUBIX Memory
 *
 * This script:
 * 1. Reads all train-on/*.txt files
 * 2. Stores each as a memory entry with appropriate tags
 * 3. Moves processed files to train-on/trained/
 *
 * Tags scheme:
 * - rubix_patterns_*.txt → ['polyglot', 'polyglot:pattern', 'polyglot:{type}']
 * - rubix_platform_*.txt → ['polyglot', 'polyglot:platform', 'polyglot:{platform}']
 * - rubix_tool_*.txt → ['polyglot', 'polyglot:tool', 'polyglot:{tool}']
 *
 * Run: node scripts/import-polyglot.mjs
 */

import { MemoryEngine } from '../dist/core/MemoryEngine.js';
import { MemorySource } from '../dist/core/types.js';
import { readdir, readFile, mkdir, rename } from 'fs/promises';
import { join, basename } from 'path';
import { existsSync } from 'fs';

const TRAIN_ON_DIR = join(process.cwd(), 'train-on');
const TRAINED_DIR = join(TRAIN_ON_DIR, 'trained');

/**
 * Parse filename to extract category and type
 * @param {string} filename - e.g., "rubix_patterns_api.txt"
 * @returns {{ category: string, type: string }}
 */
function parseFilename(filename) {
  // Remove .txt extension
  const name = filename.replace('.txt', '');

  // Expected format: rubix_{category}_{type}
  const parts = name.split('_');

  if (parts.length < 3 || parts[0] !== 'rubix') {
    throw new Error(`Unexpected filename format: ${filename}`);
  }

  const category = parts[1]; // patterns, platform, tool
  const type = parts.slice(2).join('_'); // api, nodejs, git, etc.

  return { category, type };
}

/**
 * Generate tags for a file
 * @param {string} category
 * @param {string} type
 * @returns {string[]}
 */
function generateTags(category, type) {
  // Normalize category to singular form for consistency
  const categoryTag = category === 'patterns' ? 'pattern'
                    : category === 'platform' ? 'platform'
                    : category === 'tool' ? 'tool'
                    : category === 'library' ? 'library'
                    : category;

  return [
    'polyglot',
    `polyglot:${categoryTag}`,
    `polyglot:${type}`
  ];
}

async function importPolyglot() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Import Polyglot Knowledge into RUBIX Memory');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  // Check train-on directory exists
  if (!existsSync(TRAIN_ON_DIR)) {
    console.error(`[Error] train-on directory not found: ${TRAIN_ON_DIR}`);
    process.exit(1);
  }

  // Create trained directory if it doesn't exist
  if (!existsSync(TRAINED_DIR)) {
    await mkdir(TRAINED_DIR, { recursive: true });
    console.log(`[Init] Created trained directory: ${TRAINED_DIR}`);
  }

  // Initialize MemoryEngine
  const dataDir = process.env.GOD_AGENT_DATA_DIR || './data';
  console.log(`[Init] Data directory: ${dataDir}`);

  const engine = new MemoryEngine({ dataDir });
  await engine.initialize();
  console.log('[Init] MemoryEngine initialized');
  console.log('');

  // Read all .txt files in train-on directory
  const files = await readdir(TRAIN_ON_DIR);
  const txtFiles = files.filter(f => f.endsWith('.txt') && f.startsWith('rubix_'));

  console.log(`[Scan] Found ${txtFiles.length} polyglot files to import`);
  console.log('');

  if (txtFiles.length === 0) {
    console.log('[Done] No files to import.');
    return;
  }

  // Process each file
  let imported = 0;
  let failed = 0;
  let totalChars = 0;

  for (const filename of txtFiles) {
    const filePath = join(TRAIN_ON_DIR, filename);

    try {
      // Parse filename
      const { category, type } = parseFilename(filename);
      const tags = generateTags(category, type);

      console.log(`[${imported + failed + 1}/${txtFiles.length}] ${filename}`);
      console.log(`   Category: ${category}, Type: ${type}`);
      console.log(`   Tags: ${tags.join(', ')}`);

      // Read file content
      const content = await readFile(filePath, 'utf-8');
      console.log(`   Content: ${content.length} chars`);

      // Store in memory
      const entry = await engine.store(content, {
        tags,
        source: MemorySource.SYSTEM,
        importance: 0.85,
        confidence: 0.95,
        relevance: 1.0,
        context: {
          originalFile: filename,
          category,
          type,
          importedAt: new Date().toISOString()
        }
      });

      console.log(`   Stored: ${entry.id.substring(0, 8)}...`);

      // Move file to trained directory
      const trainedPath = join(TRAINED_DIR, filename);
      await rename(filePath, trainedPath);
      console.log(`   Moved to: trained/${filename}`);

      imported++;
      totalChars += content.length;
      console.log('');

    } catch (error) {
      console.error(`   [Error] ${error.message}`);
      failed++;
      console.log('');
    }
  }

  // Summary
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Import Complete');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Imported: ${imported}`);
  console.log(`  Failed:   ${failed}`);
  console.log(`  Total chars: ${totalChars}`);
  console.log(`  Est. tokens: ~${Math.round(totalChars / 4)}`);
  console.log('');
  console.log('  Verify with:');
  console.log('    god_query({ query: "REST API patterns", tags: ["polyglot"] })');
  console.log('    god_stats()');
  console.log('');
}

importPolyglot().catch((error) => {
  console.error('[Fatal] Import failed:', error);
  process.exit(1);
});
