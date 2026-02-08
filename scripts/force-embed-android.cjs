/**
 * Force-embed pending entries for oneshotpro-android
 *
 * This script directly generates embeddings for entries with pending_embedding=1
 * and stores them in the HNSW index.
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

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

const TARGET_DIR = 'D:/rubix-protocol/data/projects/oneshotpro-android';
const TARGET_DB = path.join(TARGET_DIR, 'memory.db');
const TARGET_VECTORS = path.join(TARGET_DIR, 'vectors.hnsw');

// Load hnswlib-node
let HierarchicalNSW;
try {
  HierarchicalNSW = require('hnswlib-node').HierarchicalNSW;
} catch (e) {
  console.error('ERROR: hnswlib-node not found. Run from god-agent directory with node_modules.');
  process.exit(1);
}

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

async function main() {
  console.log('===========================================');
  console.log('  Force Embed Pending Entries');
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

  // Load or create HNSW index
  let index;
  const maxElements = Math.max(100000, pending.length + 1000);

  if (fs.existsSync(TARGET_VECTORS)) {
    console.log('Loading existing HNSW index...');
    index = new HierarchicalNSW('cosine', EMBEDDING_DIM);
    index.readIndexSync(TARGET_VECTORS);

    // Resize if needed
    const currentMax = index.getMaxElements();
    if (currentMax < pending.length + index.getCurrentCount()) {
      console.log(`Resizing index from ${currentMax} to ${maxElements}`);
      index.resizeIndex(maxElements);
    }
  } else {
    console.log('Creating new HNSW index...');
    index = new HierarchicalNSW('cosine', EMBEDDING_DIM);
    index.initIndex(maxElements, 16, 200, 100);
  }

  console.log(`Index has ${index.getCurrentCount()} existing vectors\n`);

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
        const embedding = embeddings[j];

        try {
          // Add to index (use label from vector_mappings)
          index.addPoint(embedding, entry.label);
          processed++;
        } catch (e) {
          // Label may already exist, try to update
          if (e.message.includes('already exists')) {
            // Mark point for deletion and re-add
            index.markDelete(entry.label);
            index.addPoint(embedding, entry.label);
            processed++;
          } else {
            console.error(`  Error adding entry ${entry.id}: ${e.message}`);
            errors++;
          }
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

  // Save index
  console.log('\nSaving HNSW index...');
  index.writeIndexSync(TARGET_VECTORS);
  console.log(`Index saved with ${index.getCurrentCount()} vectors`);

  db.close();

  console.log('\n========== SUMMARY ==========');
  console.log(`Processed: ${processed}`);
  console.log(`Errors: ${errors}`);
  console.log(`Total vectors in index: ${index.getCurrentCount()}`);
  console.log('==============================');
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
