/**
 * Migration Script: Android Memories to Dedicated MCP Instance
 *
 * This script migrates OneShotPro Android-related memories from the main
 * rubix database to the dedicated oneshotpro-android MCP instance.
 *
 * Unlike the web migration (full DB copy), this script:
 * - Filters entries by Android-related tags
 * - Marks migrated entries to prevent re-migration
 * - Preserves source entries (tagged, not deleted)
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// Paths
const SOURCE_DB = 'D:/rubix-protocol/god-agent/data/memory.db';
const SOURCE_VECTORS = 'D:/rubix-protocol/god-agent/data/vectors.hnsw';
const TARGET_DIR = 'D:/rubix-protocol/god-agent/data/projects/oneshotpro-android';
const TARGET_DB = path.join(TARGET_DIR, 'memory.db');
const TARGET_VECTORS = path.join(TARGET_DIR, 'vectors.hnsw');
const SCHEMA_FILE = 'D:/rubix-protocol/god-agent/src/storage/schema.sql';

// Temp files to avoid locking issues
const TEMP_DB = path.join(TARGET_DIR, 'memory-migration.db');

// Migration marker tag
const MIGRATION_MARKER = 'migrated:oneshotpro-android';

// Tag patterns to filter (case-insensitive matching)
const TAG_PATTERNS = [
  /codebase:.*androidstudioprojects.*oneshotproai/i,
  /codebase:.*oneshotpro.*android/i,
  /project:.*oneshotpro.*android/i,
  /android.*oneshotpro/i,
  /oneshotpro.*android/i,
];

// Content patterns to match (case-insensitive)
const CONTENT_PATTERNS = [
  /androidstudioprojects.*oneshotproai/i,
  /OneShotProAi.*Android/i,
  /android.*OneShotPro/i,
];

console.log('===========================================');
console.log('  OneShotPro Android Memory Migration');
console.log('===========================================\n');

// Ensure target directory exists
if (!fs.existsSync(TARGET_DIR)) {
  fs.mkdirSync(TARGET_DIR, { recursive: true });
  console.log('Created target directory:', TARGET_DIR);
}

// Remove temp files if they exist
try {
  if (fs.existsSync(TEMP_DB)) fs.unlinkSync(TEMP_DB);
  if (fs.existsSync(TEMP_DB + '-shm')) fs.unlinkSync(TEMP_DB + '-shm');
  if (fs.existsSync(TEMP_DB + '-wal')) fs.unlinkSync(TEMP_DB + '-wal');
} catch (e) {
  console.log('Warning: Could not remove temp files:', e.message);
}

// Open source database
console.log('Opening source database:', SOURCE_DB);
const sourceDb = new Database(SOURCE_DB, { readonly: false }); // Need write access to add marker tags

// Find entries to migrate
console.log('\nScanning for Android-related entries...');

// Step 1: Find entry IDs by tag patterns
const allTags = sourceDb.prepare(`
  SELECT DISTINCT entry_id, tag FROM memory_tags
  WHERE entry_id NOT IN (
    SELECT entry_id FROM memory_tags WHERE tag = ?
  )
`).all(MIGRATION_MARKER);

const entryIdsFromTags = new Set();
for (const row of allTags) {
  for (const pattern of TAG_PATTERNS) {
    if (pattern.test(row.tag)) {
      entryIdsFromTags.add(row.entry_id);
      break;
    }
  }
}
console.log('  Found', entryIdsFromTags.size, 'entries by tag patterns');

// Step 2: Find entry IDs by content patterns (for entries without matching tags)
const allEntries = sourceDb.prepare(`
  SELECT id, content FROM memory_entries
  WHERE id NOT IN (
    SELECT entry_id FROM memory_tags WHERE tag = ?
  )
`).all(MIGRATION_MARKER);

const entryIdsFromContent = new Set();
for (const row of allEntries) {
  for (const pattern of CONTENT_PATTERNS) {
    if (pattern.test(row.content)) {
      entryIdsFromContent.add(row.id);
      break;
    }
  }
}
console.log('  Found', entryIdsFromContent.size, 'entries by content patterns');

// Combine entry IDs
const allEntryIds = new Set([...entryIdsFromTags, ...entryIdsFromContent]);
console.log('  Total unique entries to migrate:', allEntryIds.size);

if (allEntryIds.size === 0) {
  console.log('\nNo entries to migrate. Exiting.');
  sourceDb.close();
  process.exit(0);
}

// Create target database with schema
console.log('\nCreating target database...');
const schema = fs.readFileSync(SCHEMA_FILE, 'utf8');
const targetDb = new Database(TEMP_DB);
targetDb.pragma('journal_mode = WAL');
targetDb.pragma('foreign_keys = OFF');
targetDb.exec(schema);
console.log('  Created temp database with schema');

// Migration stats
const stats = {
  memoryEntries: 0,
  tags: 0,
  provenance: 0,
  provenanceLinks: 0,
  causalRelations: 0,
  causalSources: 0,
  causalTargets: 0,
  vectorMappings: 0,
  markerTags: 0
};

// Convert entry IDs to array for SQL IN clause
const entryIdArray = Array.from(allEntryIds);
const placeholders = entryIdArray.map(() => '?').join(',');

// Begin transactions
targetDb.exec('BEGIN TRANSACTION');

try {
  // 1. Migrate memory_entries
  console.log('\nMigrating memory_entries...');
  const entries = sourceDb.prepare(`
    SELECT * FROM memory_entries WHERE id IN (${placeholders})
  `).all(...entryIdArray);

  const insertEntry = targetDb.prepare(`
    INSERT INTO memory_entries (id, content, source, importance, session_id, agent_id, context,
      pending_embedding, created_at, updated_at, q_value, q_update_count, last_q_update)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const e of entries) {
    insertEntry.run(
      e.id, e.content, e.source, e.importance, e.session_id, e.agent_id, e.context,
      e.pending_embedding || 0, e.created_at, e.updated_at,
      e.q_value || 0, e.q_update_count || 0, e.last_q_update
    );
    stats.memoryEntries++;
  }
  console.log('  Migrated', stats.memoryEntries, 'entries');

  // 2. Migrate memory_tags
  console.log('Migrating memory_tags...');
  const tags = sourceDb.prepare(`
    SELECT * FROM memory_tags WHERE entry_id IN (${placeholders})
  `).all(...entryIdArray);

  const insertTag = targetDb.prepare('INSERT OR IGNORE INTO memory_tags (entry_id, tag) VALUES (?, ?)');
  for (const t of tags) {
    insertTag.run(t.entry_id, t.tag);
    stats.tags++;
  }
  console.log('  Migrated', stats.tags, 'tags');

  // 3. Migrate provenance
  console.log('Migrating provenance...');
  const provs = sourceDb.prepare(`
    SELECT * FROM provenance WHERE entry_id IN (${placeholders})
  `).all(...entryIdArray);

  const insertProv = targetDb.prepare(`
    INSERT OR IGNORE INTO provenance (entry_id, lineage_depth, confidence, relevance, l_score)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const p of provs) {
    insertProv.run(p.entry_id, p.lineage_depth, p.confidence, p.relevance, p.l_score);
    stats.provenance++;
  }
  console.log('  Migrated', stats.provenance, 'provenance records');

  // 4. Migrate provenance_links (where both parent and child are migrated entries)
  console.log('Migrating provenance_links...');
  const provLinks = sourceDb.prepare(`
    SELECT * FROM provenance_links
    WHERE child_id IN (${placeholders}) AND parent_id IN (${placeholders})
  `).all(...entryIdArray, ...entryIdArray);

  const insertProvLink = targetDb.prepare('INSERT OR IGNORE INTO provenance_links (child_id, parent_id) VALUES (?, ?)');
  for (const pl of provLinks) {
    insertProvLink.run(pl.child_id, pl.parent_id);
    stats.provenanceLinks++;
  }
  console.log('  Migrated', stats.provenanceLinks, 'provenance links');

  // 5. Find causal relations involving migrated entries
  console.log('Migrating causal_relations...');
  const causalRelationIds = new Set();

  // Find relations where sources include migrated entries
  const csrcs = sourceDb.prepare(`
    SELECT relation_id FROM causal_sources WHERE entry_id IN (${placeholders})
  `).all(...entryIdArray);
  for (const cs of csrcs) {
    causalRelationIds.add(cs.relation_id);
  }

  // Find relations where targets include migrated entries
  const ctgts = sourceDb.prepare(`
    SELECT relation_id FROM causal_targets WHERE entry_id IN (${placeholders})
  `).all(...entryIdArray);
  for (const ct of ctgts) {
    causalRelationIds.add(ct.relation_id);
  }

  // Migrate causal relations
  if (causalRelationIds.size > 0) {
    const relationIdArray = Array.from(causalRelationIds);
    const relPlaceholders = relationIdArray.map(() => '?').join(',');

    const causals = sourceDb.prepare(`
      SELECT * FROM causal_relations WHERE id IN (${relPlaceholders})
    `).all(...relationIdArray);

    const insertCausal = targetDb.prepare(`
      INSERT OR IGNORE INTO causal_relations (id, type, strength, metadata, created_at, ttl, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const c of causals) {
      insertCausal.run(c.id, c.type, c.strength, c.metadata, c.created_at, c.ttl, c.expires_at);
      stats.causalRelations++;
    }
    console.log('  Migrated', stats.causalRelations, 'causal relations');

    // Migrate causal_sources for these relations (only migrated entries)
    console.log('Migrating causal_sources...');
    const allCsrcs = sourceDb.prepare(`
      SELECT * FROM causal_sources
      WHERE relation_id IN (${relPlaceholders}) AND entry_id IN (${placeholders})
    `).all(...relationIdArray, ...entryIdArray);

    const insertCsrc = targetDb.prepare('INSERT OR IGNORE INTO causal_sources (relation_id, entry_id) VALUES (?, ?)');
    for (const cs of allCsrcs) {
      insertCsrc.run(cs.relation_id, cs.entry_id);
      stats.causalSources++;
    }
    console.log('  Migrated', stats.causalSources, 'causal sources');

    // Migrate causal_targets for these relations (only migrated entries)
    console.log('Migrating causal_targets...');
    const allCtgts = sourceDb.prepare(`
      SELECT * FROM causal_targets
      WHERE relation_id IN (${relPlaceholders}) AND entry_id IN (${placeholders})
    `).all(...relationIdArray, ...entryIdArray);

    const insertCtgt = targetDb.prepare('INSERT OR IGNORE INTO causal_targets (relation_id, entry_id) VALUES (?, ?)');
    for (const ct of allCtgts) {
      insertCtgt.run(ct.relation_id, ct.entry_id);
      stats.causalTargets++;
    }
    console.log('  Migrated', stats.causalTargets, 'causal targets');
  } else {
    console.log('  No causal relations to migrate');
  }

  // 6. Migrate vector_mappings
  console.log('Migrating vector_mappings...');
  const vectors = sourceDb.prepare(`
    SELECT * FROM vector_mappings WHERE entry_id IN (${placeholders})
  `).all(...entryIdArray);

  const insertVector = targetDb.prepare(`
    INSERT OR IGNORE INTO vector_mappings (entry_id, label, access_count, last_accessed_at, compression_tier)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const v of vectors) {
    insertVector.run(v.entry_id, v.label, v.access_count, v.last_accessed_at, v.compression_tier || 'hot');
    stats.vectorMappings++;
  }
  console.log('  Migrated', stats.vectorMappings, 'vector mappings');

  // Commit target transaction
  targetDb.exec('COMMIT');
  targetDb.pragma('foreign_keys = ON');
  console.log('\nTarget database committed successfully!');

  // Add migration marker tags to source entries
  console.log('\nMarking source entries as migrated...');
  const insertMarker = sourceDb.prepare('INSERT OR IGNORE INTO memory_tags (entry_id, tag) VALUES (?, ?)');
  sourceDb.exec('BEGIN TRANSACTION');
  for (const entryId of entryIdArray) {
    insertMarker.run(entryId, MIGRATION_MARKER);
    stats.markerTags++;
  }
  sourceDb.exec('COMMIT');
  console.log('  Added', stats.markerTags, 'migration marker tags');

} catch (error) {
  targetDb.exec('ROLLBACK');
  console.error('\nMigration failed, rolled back:', error.message);
  console.error(error.stack);
  sourceDb.close();
  targetDb.close();
  process.exit(1);
}

sourceDb.close();
targetDb.close();

// Note: Vector embeddings are stored in HNSW index with label = entry_id
// The target instance will regenerate embeddings on first use
// We don't copy vectors.hnsw since the entries need to be re-embedded

// Try to rename temp files to final names
console.log('\nFinalizing migration...');
let needsManualRename = false;

try {
  // Remove old files if they exist
  if (fs.existsSync(TARGET_DB)) fs.unlinkSync(TARGET_DB);
  if (fs.existsSync(TARGET_DB + '-shm')) fs.unlinkSync(TARGET_DB + '-shm');
  if (fs.existsSync(TARGET_DB + '-wal')) fs.unlinkSync(TARGET_DB + '-wal');

  // Rename temp DB to final
  fs.renameSync(TEMP_DB, TARGET_DB);
  if (fs.existsSync(TEMP_DB + '-shm')) fs.renameSync(TEMP_DB + '-shm', TARGET_DB + '-shm');
  if (fs.existsSync(TEMP_DB + '-wal')) fs.renameSync(TEMP_DB + '-wal', TARGET_DB + '-wal');
  console.log('  Renamed database files');
} catch (e) {
  console.log('  Could not rename database (MCP server may be holding lock)');
  console.log('  Temp file saved as:', TEMP_DB);
  needsManualRename = true;
}

// Print summary
console.log('\n========== MIGRATION SUMMARY ==========');
console.log('Memory entries:', stats.memoryEntries);
console.log('Tags:', stats.tags);
console.log('Provenance records:', stats.provenance);
console.log('Provenance links:', stats.provenanceLinks);
console.log('Causal relations:', stats.causalRelations);
console.log('Causal sources:', stats.causalSources);
console.log('Causal targets:', stats.causalTargets);
console.log('Vector mappings:', stats.vectorMappings);
console.log('Migration markers added:', stats.markerTags);
console.log('========================================');

if (needsManualRename) {
  console.log('\n⚠️  MANUAL STEP REQUIRED:');
  console.log('The MCP server is holding a lock on the database.');
  console.log('After restarting Claude Code, run:');
  console.log('  mv "' + TEMP_DB + '" "' + TARGET_DB + '"');
} else {
  console.log('\n✅ Migration completed successfully!');
  console.log('\nNext steps:');
  console.log('1. Restart Claude Code to pick up the new database');
  console.log('2. Test with: mcp__oneshotpro-android__god_stats()');
  console.log('3. Query with: mcp__oneshotpro-android__god_query({ query: "OneShotProAi" })');
  console.log('\nNote: Vector embeddings will be regenerated on first query.');
}
