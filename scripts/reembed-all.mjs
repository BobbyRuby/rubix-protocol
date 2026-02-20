#!/usr/bin/env node
/**
 * reembed-all.mjs — One-shot re-embed script for sqlite-vec migration recovery
 *
 * Clears stale vector state (vec_vectors + vector_mappings), then re-embeds
 * all memory_entries via OpenAI text-embedding-3-small into fresh sqlite-vec rows.
 *
 * Usage:
 *   node scripts/reembed-all.mjs [--db path/to/memory.db] [--dry-run]
 *
 * Requires OPENAI_API_KEY in .env or environment.
 */

import { config as loadDotenv } from 'dotenv';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import OpenAI from 'openai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');

// Load .env
loadDotenv({ path: join(projectRoot, '.env') });

// ─── Config ───────────────────────────────────────────────────────────────────
const DIMENSIONS = 768;
const BATCH_SIZE = 100;
const MODEL = 'text-embedding-3-small';
const L2_NORM_TOLERANCE = 0.01;

// ─── Parse args ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
let dbPath = join(projectRoot, 'data', 'memory.db');

const dbArgIdx = args.indexOf('--db');
if (dbArgIdx !== -1 && args[dbArgIdx + 1]) {
  dbPath = resolve(args[dbArgIdx + 1]);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function normalizeVector(vector) {
  const result = new Float32Array(vector.length);
  let sumSquares = 0;
  for (let i = 0; i < vector.length; i++) {
    sumSquares += vector[i] * vector[i];
  }
  const norm = Math.sqrt(sumSquares);
  if (norm === 0) {
    result.set(vector);
    return result;
  }
  for (let i = 0; i < vector.length; i++) {
    result[i] = vector[i] / norm;
  }
  return result;
}

function float32ToBuffer(arr) {
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log(' reembed-all.mjs — sqlite-vec re-embedding');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`Database: ${dbPath}`);
  console.log(`Dry run:  ${dryRun}`);
  console.log();

  // Validate API key
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('ERROR: OPENAI_API_KEY not set. Set it in .env or environment.');
    process.exit(1);
  }

  // Open database
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  // Load sqlite-vec extension
  sqliteVec.load(db);

  // ─── Report current state ───────────────────────────────────────────
  const totalEntries = db.prepare('SELECT count(*) as c FROM memory_entries').get().c;
  const pendingCount = db.prepare('SELECT count(*) as c FROM memory_entries WHERE pending_embedding = 1').get().c;
  const mappingCount = db.prepare('SELECT count(*) as c FROM vector_mappings').get().c;

  let vecCount = 0;
  try {
    vecCount = db.prepare('SELECT count(*) as c FROM vec_vectors').get().c;
  } catch {
    // Table doesn't exist yet
  }

  console.log('── Before ──────────────────────────────────────────');
  console.log(`  memory_entries:       ${totalEntries}`);
  console.log(`  pending_embedding=1:  ${pendingCount}`);
  console.log(`  vector_mappings:      ${mappingCount}`);
  console.log(`  vec_vectors:          ${vecCount}`);
  console.log();

  if (totalEntries === 0) {
    console.log('No entries to embed. Exiting.');
    db.close();
    return;
  }

  if (dryRun) {
    console.log('DRY RUN — would clear vector_mappings, vec_vectors, re-embed all entries.');
    console.log(`Estimated API calls: ${Math.ceil(totalEntries / BATCH_SIZE)}`);
    console.log(`Estimated tokens: ~${totalEntries * 150} (~$${(totalEntries * 150 * 0.00000002).toFixed(4)})`);
    db.close();
    return;
  }

  // ─── Step 1: Clean slate ────────────────────────────────────────────
  console.log('Step 1: Clearing stale vector state...');

  // Drop vec_vectors (will be recreated)
  db.exec('DROP TABLE IF EXISTS vec_vectors');
  console.log('  Dropped vec_vectors');

  // Clear vector_mappings
  const deletedMappings = db.prepare('DELETE FROM vector_mappings').run().changes;
  console.log(`  Deleted ${deletedMappings} vector_mappings`);

  // Mark ALL entries for re-embedding
  const markedPending = db.prepare('UPDATE memory_entries SET pending_embedding = 1').run().changes;
  console.log(`  Marked ${markedPending} entries as pending_embedding=1`);

  // ─── Step 2: Recreate vec_vectors ───────────────────────────────────
  console.log('\nStep 2: Recreating vec_vectors table...');
  db.exec(`
    CREATE VIRTUAL TABLE vec_vectors
    USING vec0(embedding float[${DIMENSIONS}] distance_metric=cosine)
  `);
  console.log('  Created vec_vectors table');

  // Prepare insert statement
  const stmtInsertVec = db.prepare(
    'INSERT INTO vec_vectors(rowid, embedding) VALUES (?, ?)'
  );
  const stmtInsertMapping = db.prepare(
    'INSERT INTO vector_mappings (entry_id, label) VALUES (?, ?)'
  );
  const stmtClearPending = db.prepare(
    'UPDATE memory_entries SET pending_embedding = 0 WHERE id = ?'
  );

  // ─── Step 3: Create mappings + embed ────────────────────────────────
  console.log('\nStep 3: Re-embedding all entries...');

  // Get all entries
  const entries = db.prepare('SELECT id, content FROM memory_entries ORDER BY created_at ASC').all();

  // Initialize OpenAI client
  const openai = new OpenAI({ apiKey, timeout: 60000, maxRetries: 3 });

  let label = 0;
  let totalTokens = 0;
  let embedded = 0;
  let failed = 0;
  const failedIds = [];
  const totalBatches = Math.ceil(entries.length / BATCH_SIZE);

  for (let batchIdx = 0; batchIdx < entries.length; batchIdx += BATCH_SIZE) {
    const batch = entries.slice(batchIdx, batchIdx + BATCH_SIZE);
    const batchNum = Math.floor(batchIdx / BATCH_SIZE) + 1;

    process.stdout.write(`  Batch ${batchNum}/${totalBatches} (${batch.length} entries)...`);

    try {
      // Call OpenAI embeddings API
      const response = await openai.embeddings.create({
        model: MODEL,
        input: batch.map(e => e.content),
        dimensions: DIMENSIONS
      });

      totalTokens += response.usage.total_tokens;

      // Insert into DB within a transaction
      const insertBatch = db.transaction(() => {
        for (let i = 0; i < batch.length; i++) {
          const entry = batch[i];
          const embeddingData = response.data[i];

          if (!embeddingData) {
            failedIds.push(entry.id);
            failed++;
            continue;
          }

          const embedding = new Float32Array(embeddingData.embedding);

          // Validate dimensions
          if (embedding.length !== DIMENSIONS) {
            console.warn(`\n  WARNING: Entry ${entry.id.substring(0, 8)} has ${embedding.length} dims, expected ${DIMENSIONS}. Skipping.`);
            failedIds.push(entry.id);
            failed++;
            continue;
          }

          // Normalize
          const normalized = normalizeVector(embedding);

          // Assign label and insert mapping
          const currentLabel = label++;
          stmtInsertMapping.run(entry.id, currentLabel);

          // Insert vector
          stmtInsertVec.run(BigInt(currentLabel), float32ToBuffer(normalized));

          // Clear pending flag
          stmtClearPending.run(entry.id);

          embedded++;
        }
      });

      insertBatch();
      console.log(` OK (${response.usage.total_tokens} tokens)`);

    } catch (error) {
      console.error(` FAILED: ${error.message}`);
      // Mark entire batch as failed
      for (const entry of batch) {
        failedIds.push(entry.id);
        failed++;
      }
    }
  }

  // ─── Step 4: Report results ─────────────────────────────────────────
  const finalVecCount = db.prepare('SELECT count(*) as c FROM vec_vectors').get().c;
  const finalMappingCount = db.prepare('SELECT count(*) as c FROM vector_mappings').get().c;
  const finalPending = db.prepare('SELECT count(*) as c FROM memory_entries WHERE pending_embedding = 1').get().c;

  console.log('\n── After ───────────────────────────────────────────');
  console.log(`  memory_entries:       ${totalEntries}`);
  console.log(`  vec_vectors:          ${finalVecCount}`);
  console.log(`  vector_mappings:      ${finalMappingCount}`);
  console.log(`  pending_embedding=1:  ${finalPending}`);
  console.log();
  console.log(`  Embedded:   ${embedded}`);
  console.log(`  Failed:     ${failed}`);
  console.log(`  Tokens:     ${totalTokens}`);
  console.log(`  Est. cost:  $${(totalTokens * 0.00000002).toFixed(4)}`);

  if (failedIds.length > 0) {
    console.log(`\n  Failed entry IDs:`);
    for (const id of failedIds.slice(0, 10)) {
      console.log(`    ${id}`);
    }
    if (failedIds.length > 10) {
      console.log(`    ... and ${failedIds.length - 10} more`);
    }
  }

  // Verify match
  if (finalVecCount === finalMappingCount && finalPending === 0) {
    console.log('\n✓ SUCCESS: All entries embedded. vec_vectors = vector_mappings, no pending.');
  } else {
    console.log('\n⚠ WARNING: Counts do not fully match. Check failed entries above.');
  }

  console.log('\n═══════════════════════════════════════════════════════');

  db.close();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
