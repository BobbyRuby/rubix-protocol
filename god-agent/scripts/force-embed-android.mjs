/**
 * Force-embed pending entries for oneshotpro-android
 *
 * Uses the compiled god-agent code to generate embeddings.
 */

import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GOD_AGENT_ROOT = path.resolve(__dirname, '..');
const hnswModule = await import(pathToFileURL(path.join(GOD_AGENT_ROOT, 'dist/vector/HNSWIndex.js')).href);
const vectorModule = await import(pathToFileURL(path.join(GOD_AGENT_ROOT, 'dist/vector/VectorDB.js')).href);
const { HNSWIndex } = hnswModule;
const { VectorDB } = vectorModule;

// Get OpenAI API key from MCP config or environment
let OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  try {
    const mcpConfig = JSON.parse(fs.readFileSync('D:/rubix-protocol/.claude/mcp.json', 'utf8'));
    OPENAI_API_KEY = mcpConfig.mcpServers['oneshotpro-android']?.env?.OPENAI_API_KEY
      || mcpConfig.mcpServers['rubix']?.env?.OPENAI_API_KEY;
  } catch (e) {
    // Ignore
  }
}
if (!OPENAI_API_KEY) {
  console.error('ERROR: OPENAI_API_KEY not found in environment or mcp.json');
  process.exit(1);
}

const TARGET_DIR = 'D:/rubix-protocol/god-agent/data/projects/oneshotpro-android';
const TARGET_DB = path.join(TARGET_DIR, 'memory.db');
const TARGET_VECTORS = path.join(TARGET_DIR, 'vectors.hnsw');

const EMBEDDING_DIM = 768;
const BATCH_SIZE = 50;

async function generateEmbeddings(texts) {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: texts,
      dimensions: EMBEDDING_DIM
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.data.map(d => d.embedding);
}

// Normalize vector to unit length (L2)
function normalizeVector(vec) {
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  if (norm === 0) return vec;
  return vec.map(v => v / norm);
}

async function main() {
  console.log('===========================================');
  console.log('  Force Embed Pending Entries (ESM)');
  console.log('===========================================\n');

  // Open database
  const db = new Database(TARGET_DB);
  console.log('Opened database:', TARGET_DB);

  // Get pending entries
  const pending = db.prepare(`
    SELECT m.id, m.content, v.label
    FROM memory_entries m
    JOIN vector_mappings v ON m.id = v.entry_id
    WHERE m.pending_embedding = 1
  `).all();

  console.log(`Found ${pending.length} entries pending embedding\n`);

  if (pending.length === 0) {
    console.log('Nothing to do!');
    db.close();
    return;
  }

  // Load or create VectorDB
  const vectorDb = new VectorDB({
    dimensions: EMBEDDING_DIM,
    maxElements: Math.max(100000, pending.length + 1000),
    indexPath: TARGET_VECTORS,
    M: 16,
    efConstruction: 200,
    efSearch: 100
  });

  // Initialize the VectorDB
  console.log('Initializing VectorDB...');
  await vectorDb.initialize();
  console.log(`VectorDB initialized with ${vectorDb.getCount()} existing vectors`);

  // Process in batches
  let processed = 0;
  let errors = 0;

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);
    const texts = batch.map(e => e.content.substring(0, 8000)); // Truncate long content

    console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(pending.length / BATCH_SIZE)} (${batch.length} entries)...`);

    try {
      const embeddings = await generateEmbeddings(texts);

      for (let j = 0; j < batch.length; j++) {
        const entry = batch[j];
        const embedding = normalizeVector(embeddings[j]);

        try {
          // Check if label exists, update or add
          if (vectorDb.has(entry.label)) {
            vectorDb.update(entry.label, embedding);
          } else {
            vectorDb.add(entry.label, embedding);
          }
          processed++;
        } catch (e) {
          console.error(`  Error adding entry ${entry.id}: ${e.message}`);
          errors++;
        }
      }

      // Update pending_embedding = 0 for processed entries
      const ids = batch.map(e => e.id);
      const placeholders = ids.map(() => '?').join(',');
      db.prepare(`UPDATE memory_entries SET pending_embedding = 0 WHERE id IN (${placeholders})`).run(...ids);

    } catch (e) {
      console.error(`  Batch error: ${e.message}`);
      errors += batch.length;
    }

    // Small delay to avoid rate limiting
    if (i + BATCH_SIZE < pending.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  // Save vectors
  console.log('\nSaving vectors...');
  vectorDb.save();
  console.log(`Saved ${vectorDb.getCount()} vectors`);

  db.close();

  console.log('\n========== SUMMARY ==========');
  console.log(`Processed: ${processed}`);
  console.log(`Errors: ${errors}`);
  console.log(`Total vectors: ${vectorDb.getCount()}`);
  console.log('==============================');
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
