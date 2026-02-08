#!/usr/bin/env node
/**
 * Migration Script: Legacy Compression → LLM Compression
 *
 * This script:
 * 1. Finds all entries with 'compressed' tag (legacy regex compression)
 * 2. Decodes them using memoryCompressor.decode()
 * 3. Re-compresses using LLM compression (semantic, lossless)
 * 4. Updates entries with new content and 'llm-compressed' tag
 *
 * Run: node scripts/migrate-compression.mjs
 */

import { MemoryEngine } from '../dist/core/MemoryEngine.js';
import { memoryCompressor } from '../dist/memory/MemoryCompressor.js';
import { LLMCompressor } from '../dist/memory/LLMCompressor.js';

async function migrate() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Memory Compression Migration: Legacy → LLM');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  // Initialize engine
  const dataDir = process.env.GOD_AGENT_DATA_DIR || './data';
  console.log(`[Init] Data directory: ${dataDir}`);

  const engine = new MemoryEngine({ dataDir });
  await engine.initialize();
  console.log('[Init] MemoryEngine initialized');

  // Initialize LLM compressor
  const llmCompressor = new LLMCompressor({
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.RUBIX_MODEL || 'claude-opus-4-5-20251101',
    ollamaConfig: process.env.OLLAMA_ENDPOINT ? {
      provider: 'ollama',
      model: process.env.OLLAMA_MODEL || 'qwen2.5-coder:32b',
      apiEndpoint: process.env.OLLAMA_ENDPOINT || 'http://localhost:11434'
    } : undefined
  });

  if (!llmCompressor.isAvailable()) {
    console.error('[Error] No LLM provider available. Set ANTHROPIC_API_KEY or OLLAMA_ENDPOINT.');
    process.exit(1);
  }

  const status = llmCompressor.getStatus();
  console.log(`[Init] LLMCompressor: Anthropic=${status.anthropic}, Ollama=${status.ollama}, Model=${status.model}`);
  console.log('');

  // Find all legacy compressed entries
  console.log('[Search] Finding legacy compressed entries...');
  const results = await engine.query('*', {
    topK: 500,  // Process up to 500 entries
    filters: { tags: ['compressed'] }
  });

  // Filter to only get entries with 'compressed' tag (not 'llm-compressed')
  const legacyEntries = results.filter(r => {
    const tags = r.entry.metadata.tags || [];
    return tags.includes('compressed') && !tags.includes('llm-compressed');
  });

  console.log(`[Search] Found ${legacyEntries.length} legacy compressed entries`);
  console.log('');

  if (legacyEntries.length === 0) {
    console.log('[Done] No legacy compressed entries to migrate.');
    return;
  }

  // Process each entry
  let migrated = 0;
  let failed = 0;
  let skipped = 0;

  for (const result of legacyEntries) {
    const entry = result.entry;
    const tags = entry.metadata.tags || [];

    console.log(`[${migrated + failed + skipped + 1}/${legacyEntries.length}] Processing ${entry.id.substring(0, 8)}...`);

    try {
      // 1. Decode using legacy decoder
      const typeTag = tags.find(t => t.startsWith('type:'));
      const memType = typeTag ? typeTag.replace('type:', '') : undefined;
      const decoded = memoryCompressor.decode(entry.content, memType);

      // 2. Re-compress with LLM
      const recompressed = await llmCompressor.compress(decoded);

      // Skip only if LLM made it longer
      if (recompressed.length > decoded.length) {
        console.log(`   Skipped: LLM made it longer (${decoded.length} → ${recompressed.length})`);
        skipped++;
        continue;
      }

      // 3. Update tags: remove 'compressed', add 'llm-compressed'
      const newTags = tags
        .filter(t => t !== 'compressed')
        .concat('llm-compressed');

      // 4. Update entry
      await engine.edit(entry.id, {
        content: recompressed,
        tags: newTags
      });

      const ratio = Math.round((1 - recompressed.length / decoded.length) * 100);
      console.log(`   Migrated: ${decoded.length} → ${recompressed.length} chars (${ratio}% reduction)`);
      migrated++;

    } catch (error) {
      console.error(`   Failed: ${error}`);
      failed++;
    }
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Migration Complete');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Migrated: ${migrated}`);
  console.log(`  Skipped:  ${skipped} (LLM compression not beneficial)`);
  console.log(`  Failed:   ${failed}`);
  console.log('');
}

migrate().catch((error) => {
  console.error('[Fatal] Migration failed:', error);
  process.exit(1);
});
