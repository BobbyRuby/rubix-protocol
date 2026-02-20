#!/usr/bin/env node
/**
 * reembed-remaining.mjs — Recover entries that still have pending_embedding=1
 *
 * Processes entries ONE AT A TIME to avoid batch token limit issues.
 * Truncates overly long content to stay under the 8191-token limit.
 *
 * Usage:
 *   node scripts/reembed-remaining.mjs [--db path/to/memory.db]
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

loadDotenv({ path: join(projectRoot, '.env') });

const DIMENSIONS = 768;
const MODEL = 'text-embedding-3-small';
// Rough token limit: ~4 chars per token, leave margin
const MAX_CHARS = 28000; // ~7000 tokens, well under 8191

const args = process.argv.slice(2);
let dbPath = join(projectRoot, 'data', 'memory.db');
const dbArgIdx = args.indexOf('--db');
if (dbArgIdx !== -1 && args[dbArgIdx + 1]) {
  dbPath = resolve(args[dbArgIdx + 1]);
}

function normalizeVector(vector) {
  const result = new Float32Array(vector.length);
  let sumSquares = 0;
  for (let i = 0; i < vector.length; i++) {
    sumSquares += vector[i] * vector[i];
  }
  const norm = Math.sqrt(sumSquares);
  if (norm === 0) { result.set(vector); return result; }
  for (let i = 0; i < vector.length; i++) {
    result[i] = vector[i] / norm;
  }
  return result;
}

function float32ToBuffer(arr) {
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
}

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log(' reembed-remaining.mjs — recover pending entries');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`Database: ${dbPath}`);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('ERROR: OPENAI_API_KEY not set.');
    process.exit(1);
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  sqliteVec.load(db);

  // Get current max label from vector_mappings
  const maxLabelRow = db.prepare('SELECT MAX(label) as m FROM vector_mappings').get();
  let nextLabel = (maxLabelRow.m ?? -1) + 1;

  // Get pending entries (those with no vector_mapping yet)
  const pendingEntries = db.prepare(`
    SELECT m.id, m.content
    FROM memory_entries m
    WHERE m.pending_embedding = 1
    AND m.id NOT IN (SELECT entry_id FROM vector_mappings)
    ORDER BY m.created_at ASC
  `).all();

  console.log(`\nFound ${pendingEntries.length} entries still pending without mappings.`);

  if (pendingEntries.length === 0) {
    // Check for entries with mappings but pending (shouldn't happen after first script)
    const pendingWithMappings = db.prepare(`
      SELECT count(*) as c
      FROM memory_entries m
      JOIN vector_mappings v ON m.id = v.entry_id
      WHERE m.pending_embedding = 1
    `).get().c;

    if (pendingWithMappings > 0) {
      console.log(`${pendingWithMappings} entries have mappings but pending flag — clearing flags.`);
      db.prepare(`
        UPDATE memory_entries SET pending_embedding = 0
        WHERE id IN (
          SELECT m.id FROM memory_entries m
          JOIN vector_mappings v ON m.id = v.entry_id
          WHERE m.pending_embedding = 1
        )
      `).run();
    }

    console.log('Nothing to do.');
    db.close();
    return;
  }

  const openai = new OpenAI({ apiKey, timeout: 60000, maxRetries: 3 });

  const stmtInsertVec = db.prepare(
    'INSERT INTO vec_vectors(rowid, embedding) VALUES (?, ?)'
  );
  const stmtInsertMapping = db.prepare(
    'INSERT INTO vector_mappings (entry_id, label) VALUES (?, ?)'
  );
  const stmtClearPending = db.prepare(
    'UPDATE memory_entries SET pending_embedding = 0 WHERE id = ?'
  );

  let embedded = 0;
  let failed = 0;
  let totalTokens = 0;
  let truncated = 0;

  for (let i = 0; i < pendingEntries.length; i++) {
    const entry = pendingEntries[i];
    let content = entry.content;

    // Truncate if too long
    if (content.length > MAX_CHARS) {
      content = content.substring(0, MAX_CHARS);
      truncated++;
    }

    process.stdout.write(`  [${i + 1}/${pendingEntries.length}] ${entry.id.substring(0, 8)}... `);

    try {
      const response = await openai.embeddings.create({
        model: MODEL,
        input: content,
        dimensions: DIMENSIONS
      });

      const embData = response.data[0].embedding;
      const embedding = normalizeVector(new Float32Array(embData));
      totalTokens += response.usage.total_tokens;

      const label = nextLabel++;

      // Transaction: insert mapping + vector + clear pending
      db.transaction(() => {
        stmtInsertMapping.run(entry.id, label);
        stmtInsertVec.run(BigInt(label), float32ToBuffer(embedding));
        stmtClearPending.run(entry.id);
      })();

      embedded++;
      console.log(`OK (${response.usage.total_tokens} tokens${content.length < entry.content.length ? ', truncated' : ''})`);

    } catch (error) {
      failed++;
      console.log(`FAILED: ${error.message}`);
    }
  }

  // Final stats
  const finalVecCount = db.prepare('SELECT count(*) as c FROM vec_vectors').get().c;
  const finalMappingCount = db.prepare('SELECT count(*) as c FROM vector_mappings').get().c;
  const finalPending = db.prepare('SELECT count(*) as c FROM memory_entries WHERE pending_embedding = 1').get().c;

  console.log('\n── Results ─────────────────────────────────────────');
  console.log(`  Embedded:     ${embedded}`);
  console.log(`  Failed:       ${failed}`);
  console.log(`  Truncated:    ${truncated}`);
  console.log(`  Tokens:       ${totalTokens}`);
  console.log(`  vec_vectors:  ${finalVecCount}`);
  console.log(`  mappings:     ${finalMappingCount}`);
  console.log(`  pending:      ${finalPending}`);

  if (finalPending === 0 && finalVecCount === finalMappingCount) {
    console.log('\n✓ SUCCESS: All entries embedded.');
  } else {
    console.log('\n⚠ Some entries may still be pending.');
  }

  console.log('═══════════════════════════════════════════════════════');
  db.close();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
