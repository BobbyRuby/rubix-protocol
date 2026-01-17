#!/usr/bin/env node
/**
 * Compress All Uncompressed Memories
 *
 * This script:
 * 1. Finds all entries WITHOUT compression tags
 * 2. Compresses them using LLM compression
 * 3. Updates entries with compressed content and 'llm-compressed' tag
 *
 * Run: node scripts/compress-all.mjs
 */

import { MemoryEngine } from '../dist/core/MemoryEngine.js';
import { LLMCompressor } from '../dist/memory/LLMCompressor.js';

async function compressAll() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Compress All Uncompressed Memories');
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

  // Find all entries
  console.log('[Search] Finding all entries...');
  const results = await engine.query('*', { topK: 500 });

  // Filter to only uncompressed entries
  const uncompressedEntries = results.filter(r => {
    const tags = r.entry.metadata.tags || [];
    return !tags.includes('compressed') && !tags.includes('llm-compressed');
  });

  console.log(`[Search] Found ${uncompressedEntries.length} uncompressed entries`);
  console.log('');

  if (uncompressedEntries.length === 0) {
    console.log('[Done] No uncompressed entries to process.');
    return;
  }

  // Process each entry
  let compressed = 0;
  let failed = 0;
  let skipped = 0;
  let totalSaved = 0;

  for (const result of uncompressedEntries) {
    const entry = result.entry;
    const tags = entry.metadata.tags || [];
    const originalContent = entry.content;

    console.log(`[${compressed + failed + skipped + 1}/${uncompressedEntries.length}] Processing ${entry.id.substring(0, 8)}...`);

    // Skip very short content
    if (originalContent.length < 50) {
      console.log(`   Skipped: Too short (${originalContent.length} chars)`);
      skipped++;
      continue;
    }

    try {
      // Compress with LLM
      const compressedContent = await llmCompressor.compress(originalContent);

      // Skip if compression didn't help
      if (compressedContent.length >= originalContent.length) {
        console.log(`   Skipped: No compression benefit (${originalContent.length} → ${compressedContent.length})`);
        skipped++;
        continue;
      }

      // Update tags
      const newTags = [...tags, 'llm-compressed'];

      // Update entry
      await engine.updateEntry(entry.id, {
        content: compressedContent,
        tags: newTags
      });

      const saved = originalContent.length - compressedContent.length;
      totalSaved += saved;
      const ratio = Math.round((1 - compressedContent.length / originalContent.length) * 100);
      console.log(`   Compressed: ${originalContent.length} → ${compressedContent.length} chars (${ratio}% reduction, saved ${saved} chars)`);
      compressed++;

    } catch (error) {
      console.error(`   Failed: ${error}`);
      failed++;
    }
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Compression Complete');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Compressed: ${compressed}`);
  console.log(`  Skipped:    ${skipped}`);
  console.log(`  Failed:     ${failed}`);
  console.log(`  Total chars saved: ${totalSaved}`);
  console.log(`  Est. tokens saved: ~${Math.round(totalSaved / 4)}`);
  console.log('');
}

compressAll().catch((error) => {
  console.error('[Fatal] Compression failed:', error);
  process.exit(1);
});
