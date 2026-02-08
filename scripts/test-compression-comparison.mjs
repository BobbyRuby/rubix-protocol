#!/usr/bin/env node
/**
 * Compression Comparison: Opus vs Ollama
 */

import { MemoryEngine } from '../dist/core/MemoryEngine.js';
import { LLMCompressor } from '../dist/memory/LLMCompressor.js';

async function test() {
  const engine = new MemoryEngine({ dataDir: './data' });
  await engine.initialize();

  // Create BOTH compressors
  const opus = new LLMCompressor({
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-opus-4-5-20251101'
  });

  const ollama = new LLMCompressor({
    ollamaConfig: {
      provider: 'ollama',
      model: 'qwen2.5-coder:32b',
      apiEndpoint: 'http://localhost:11434'
    }
  });

  // Wait for ollama health check
  await new Promise(r => setTimeout(r, 2000));

  console.log('Opus available:', opus.isAvailable());
  console.log('Ollama available:', ollama.isAvailable());

  if (!ollama.isAvailable()) {
    console.log('\n⚠️  Ollama not available. Is it running on localhost:11434?');
    console.log('Start with: ollama serve');
    console.log('Then: ollama run qwen2.5-coder:32b\n');
  }

  console.log('\n===========================================');
  console.log('TEST 1: Decompress Opus-compressed memory');
  console.log('===========================================\n');

  const results = await engine.query('*', { topK: 100 });
  const llmEntry = results.find(r => {
    const tags = r.entry.metadata.tags || [];
    return tags.includes('llm-compressed') && r.entry.content.length > 100;
  });

  if (llmEntry) {
    const compressed = llmEntry.entry.content;
    console.log('ORIGINAL (Opus-compressed):');
    console.log(compressed);
    console.log('');

    console.log('--- OPUS DECOMPRESSION ---');
    const opusDecomp = await opus.decompress(compressed);
    console.log(opusDecomp);
    console.log('');

    if (ollama.isAvailable()) {
      console.log('--- OLLAMA DECOMPRESSION ---');
      const ollamaDecomp = await ollama.decompress(compressed);
      console.log(ollamaDecomp);
    }
  }

  console.log('\n===========================================');
  console.log('TEST 2: Compress entry #45 with BOTH');
  console.log('===========================================\n');

  // Find uncompressed entries
  const uncompressed = results.filter(r => {
    const tags = r.entry.metadata.tags || [];
    return !tags.includes('llm-compressed') && !tags.includes('compressed') && r.entry.content.length > 80;
  });

  const entry45 = uncompressed[Math.min(44, uncompressed.length - 1)];
  if (entry45) {
    const original = entry45.entry.content;
    console.log('ORIGINAL UNCOMPRESSED (' + original.length + ' chars):');
    console.log(original);
    console.log('');

    console.log('--- OPUS COMPRESSION ---');
    const opusComp = await opus.compress(original);
    console.log(opusComp);
    console.log('Length:', opusComp.length, 'chars (' + Math.round((1 - opusComp.length/original.length) * 100) + '% reduction)');
    console.log('');

    let ollamaComp = original;
    if (ollama.isAvailable()) {
      console.log('--- OLLAMA COMPRESSION ---');
      ollamaComp = await ollama.compress(original);
      console.log(ollamaComp);
      console.log('Length:', ollamaComp.length, 'chars (' + Math.round((1 - ollamaComp.length/original.length) * 100) + '% reduction)');
      console.log('');
    }

    console.log('\n===========================================');
    console.log('TEST 3: Cross-decompress');
    console.log('===========================================\n');

    console.log('--- OPUS-compressed → OPUS-decompressed ---');
    console.log(await opus.decompress(opusComp));
    console.log('');

    if (ollama.isAvailable()) {
      console.log('--- OPUS-compressed → OLLAMA-decompressed ---');
      console.log(await ollama.decompress(opusComp));
      console.log('');

      console.log('--- OLLAMA-compressed → OPUS-decompressed ---');
      console.log(await opus.decompress(ollamaComp));
      console.log('');

      console.log('--- OLLAMA-compressed → OLLAMA-decompressed ---');
      console.log(await ollama.decompress(ollamaComp));
    }
  }

  console.log('\n===========================================');
  console.log('DONE');
  console.log('===========================================\n');
}

test().catch(console.error);
