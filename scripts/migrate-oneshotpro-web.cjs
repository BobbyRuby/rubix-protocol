const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const SOURCE_DB = 'C:/Users/rruby/PhpstormProjects/OneShotProAi/god-agent/data/memory.db';
const SOURCE_VECTORS = 'C:/Users/rruby/PhpstormProjects/OneShotProAi/god-agent/data/vectors.hnsw';
const TARGET_DIR = 'D:/rubix-protocol/data/projects/oneshotpro-web';
const TARGET_DB = path.join(TARGET_DIR, 'memory.db');
const TARGET_VECTORS = path.join(TARGET_DIR, 'vectors.hnsw');
const SCHEMA_FILE = 'D:/rubix-protocol/src/storage/schema.sql';

// Use temp file to avoid locking issues
const TEMP_DB = path.join(TARGET_DIR, 'memory-migration.db');

// Ensure target directory exists
if (!fs.existsSync(TARGET_DIR)) {
  fs.mkdirSync(TARGET_DIR, { recursive: true });
  console.log('Created target directory:', TARGET_DIR);
}

// Remove temp file if exists
try {
  if (fs.existsSync(TEMP_DB)) fs.unlinkSync(TEMP_DB);
  if (fs.existsSync(TEMP_DB + '-shm')) fs.unlinkSync(TEMP_DB + '-shm');
  if (fs.existsSync(TEMP_DB + '-wal')) fs.unlinkSync(TEMP_DB + '-wal');
} catch (e) {
  console.log('Warning: Could not remove temp files:', e.message);
}

// Create target database with new schema
const schema = fs.readFileSync(SCHEMA_FILE, 'utf8');
const targetDb = new Database(TEMP_DB);
targetDb.pragma('journal_mode = WAL');
targetDb.pragma('foreign_keys = OFF'); // Disable FK checks during migration
targetDb.exec(schema);
console.log('Created temp database with schema');

// Open source database
const sourceDb = new Database(SOURCE_DB, { readonly: true });
console.log('Opened source database');

// Migration stats
let stats = {
  memoryEntries: 0,
  tags: 0,
  provenance: 0,
  provenanceLinks: 0,
  causalRelations: 0,
  causalSources: 0,
  causalTargets: 0,
  vectorMappings: 0,
  patterns: 0,
  patternStats: 0,
  scheduledTasks: 0,
  systemMetadata: 0
};

// Begin transaction
targetDb.exec('BEGIN TRANSACTION');

try {
  // 1. Migrate memory_entries (with new columns defaulted)
  console.log('\nMigrating memory_entries...');
  const entries = sourceDb.prepare('SELECT * FROM memory_entries').all();
  const insertEntry = targetDb.prepare(`
    INSERT INTO memory_entries (id, content, source, importance, session_id, agent_id, context,
      pending_embedding, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `);

  for (const e of entries) {
    insertEntry.run(e.id, e.content, e.source, e.importance, e.session_id, e.agent_id,
      e.context, e.created_at, e.updated_at);
    stats.memoryEntries++;
  }
  console.log('  Migrated', stats.memoryEntries, 'entries');

  // 2. Migrate memory_tags
  console.log('Migrating memory_tags...');
  const tags = sourceDb.prepare('SELECT * FROM memory_tags').all();
  const insertTag = targetDb.prepare('INSERT OR IGNORE INTO memory_tags (entry_id, tag) VALUES (?, ?)');
  for (const t of tags) {
    insertTag.run(t.entry_id, t.tag);
    stats.tags++;
  }
  console.log('  Migrated', stats.tags, 'tags');

  // 3. Migrate provenance
  console.log('Migrating provenance...');
  const provs = sourceDb.prepare('SELECT * FROM provenance').all();
  const insertProv = targetDb.prepare(`
    INSERT OR IGNORE INTO provenance (entry_id, lineage_depth, confidence, relevance, l_score)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const p of provs) {
    insertProv.run(p.entry_id, p.lineage_depth, p.confidence, p.relevance, p.l_score);
    stats.provenance++;
  }
  console.log('  Migrated', stats.provenance, 'provenance records');

  // 4. Migrate provenance_links
  console.log('Migrating provenance_links...');
  const provLinks = sourceDb.prepare('SELECT * FROM provenance_links').all();
  const insertProvLink = targetDb.prepare('INSERT OR IGNORE INTO provenance_links (child_id, parent_id) VALUES (?, ?)');
  for (const pl of provLinks) {
    insertProvLink.run(pl.child_id, pl.parent_id);
    stats.provenanceLinks++;
  }
  console.log('  Migrated', stats.provenanceLinks, 'provenance links');

  // 5. Migrate causal_relations
  console.log('Migrating causal_relations...');
  const causals = sourceDb.prepare('SELECT * FROM causal_relations').all();
  const insertCausal = targetDb.prepare(`
    INSERT OR IGNORE INTO causal_relations (id, type, strength, metadata, created_at, ttl, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const c of causals) {
    insertCausal.run(c.id, c.type, c.strength, c.metadata, c.created_at, c.ttl, c.expires_at);
    stats.causalRelations++;
  }
  console.log('  Migrated', stats.causalRelations, 'causal relations');

  // 6. Migrate causal_sources
  console.log('Migrating causal_sources...');
  const csrcs = sourceDb.prepare('SELECT * FROM causal_sources').all();
  const insertCsrc = targetDb.prepare('INSERT OR IGNORE INTO causal_sources (relation_id, entry_id) VALUES (?, ?)');
  for (const cs of csrcs) {
    insertCsrc.run(cs.relation_id, cs.entry_id);
    stats.causalSources++;
  }
  console.log('  Migrated', stats.causalSources, 'causal sources');

  // 7. Migrate causal_targets
  console.log('Migrating causal_targets...');
  const ctgts = sourceDb.prepare('SELECT * FROM causal_targets').all();
  const insertCtgt = targetDb.prepare('INSERT OR IGNORE INTO causal_targets (relation_id, entry_id) VALUES (?, ?)');
  for (const ct of ctgts) {
    insertCtgt.run(ct.relation_id, ct.entry_id);
    stats.causalTargets++;
  }
  console.log('  Migrated', stats.causalTargets, 'causal targets');

  // 8. Migrate vector_mappings
  console.log('Migrating vector_mappings...');
  const vectors = sourceDb.prepare('SELECT * FROM vector_mappings').all();
  const insertVector = targetDb.prepare(`
    INSERT OR IGNORE INTO vector_mappings (entry_id, label, access_count, last_accessed_at, compression_tier)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const v of vectors) {
    insertVector.run(v.entry_id, v.label, v.access_count, v.last_accessed_at, v.compression_tier || 'hot');
    stats.vectorMappings++;
  }
  console.log('  Migrated', stats.vectorMappings, 'vector mappings');

  // 9. Migrate pattern_templates
  console.log('Migrating pattern_templates...');
  const patterns = sourceDb.prepare('SELECT * FROM pattern_templates').all();
  const insertPattern = targetDb.prepare(`
    INSERT OR IGNORE INTO pattern_templates (id, name, pattern, slots, priority, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const p of patterns) {
    insertPattern.run(p.id, p.name, p.pattern, p.slots, p.priority, p.created_at);
    stats.patterns++;
  }
  console.log('  Migrated', stats.patterns, 'patterns');

  // 10. Migrate pattern_stats
  console.log('Migrating pattern_stats...');
  const pstats = sourceDb.prepare('SELECT * FROM pattern_stats').all();
  const insertPstat = targetDb.prepare(`
    INSERT OR IGNORE INTO pattern_stats (pattern_id, use_count, success_count, last_used_at)
    VALUES (?, ?, ?, ?)
  `);
  for (const ps of pstats) {
    insertPstat.run(ps.pattern_id, ps.use_count, ps.success_count, ps.last_used_at);
    stats.patternStats++;
  }
  console.log('  Migrated', stats.patternStats, 'pattern stats');

  // 11. Migrate scheduled_tasks
  console.log('Migrating scheduled_tasks...');
  try {
    const tasks = sourceDb.prepare('SELECT * FROM scheduled_tasks').all();
    const insertTask = targetDb.prepare(`
      INSERT OR IGNORE INTO scheduled_tasks (id, name, description, prompt_template, trigger_type,
        trigger_config, context_ids, context_query, status, priority, notify_on_complete,
        notify_on_decision, notify_on_failure, created_at, last_run, next_run, run_count, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const t of tasks) {
      insertTask.run(t.id, t.name, t.description, t.prompt_template, t.trigger_type, t.trigger_config,
        t.context_ids, t.context_query, t.status, t.priority, t.notify_on_complete, t.notify_on_decision,
        t.notify_on_failure, t.created_at, t.last_run, t.next_run, t.run_count, t.metadata);
      stats.scheduledTasks++;
    }
    console.log('  Migrated', stats.scheduledTasks, 'scheduled tasks');
  } catch (e) { console.log('  Skipped scheduled_tasks:', e.message); }

  // 12. Migrate system_metadata
  console.log('Migrating system_metadata...');
  const meta = sourceDb.prepare('SELECT * FROM system_metadata').all();
  const insertMeta = targetDb.prepare('INSERT OR REPLACE INTO system_metadata (key, value, updated_at) VALUES (?, ?, ?)');
  for (const m of meta) {
    insertMeta.run(m.key, m.value, m.updated_at);
    stats.systemMetadata++;
  }
  console.log('  Migrated', stats.systemMetadata, 'metadata entries');

  // Commit transaction
  targetDb.exec('COMMIT');
  targetDb.pragma('foreign_keys = ON'); // Re-enable FK checks
  console.log('\nTransaction committed successfully!');

} catch (error) {
  targetDb.exec('ROLLBACK');
  console.error('Migration failed, rolled back:', error.message);
  console.error(error.stack);
  process.exit(1);
}

sourceDb.close();
targetDb.close();

// Copy vectors.hnsw file
console.log('\nCopying vectors.hnsw file...');
const TEMP_VECTORS = path.join(TARGET_DIR, 'vectors-migration.hnsw');
if (fs.existsSync(SOURCE_VECTORS)) {
  fs.copyFileSync(SOURCE_VECTORS, TEMP_VECTORS);
  const size = fs.statSync(TEMP_VECTORS).size;
  console.log('  Copied vectors.hnsw (' + (size / 1024 / 1024).toFixed(2) + ' MB)');
} else {
  console.log('  No vectors.hnsw file to copy');
}

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

try {
  if (fs.existsSync(TARGET_VECTORS)) fs.unlinkSync(TARGET_VECTORS);
  if (fs.existsSync(TEMP_VECTORS)) {
    fs.renameSync(TEMP_VECTORS, TARGET_VECTORS);
    console.log('  Renamed vectors file');
  }
} catch (e) {
  console.log('  Could not rename vectors (may be in use)');
  console.log('  Temp file saved as:', TEMP_VECTORS);
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
console.log('Patterns:', stats.patterns);
console.log('Pattern stats:', stats.patternStats);
console.log('Scheduled tasks:', stats.scheduledTasks);
console.log('System metadata:', stats.systemMetadata);
console.log('========================================');

if (needsManualRename) {
  console.log('\n⚠️  MANUAL STEP REQUIRED:');
  console.log('The MCP server is holding a lock on the database.');
  console.log('After restarting Claude Code, run:');
  console.log('  mv "' + TEMP_DB + '" "' + TARGET_DB + '"');
  console.log('  mv "' + TEMP_VECTORS + '" "' + TARGET_VECTORS + '"');
} else {
  console.log('\nMigration completed successfully!');
}
