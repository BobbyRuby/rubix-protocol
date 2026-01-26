/**
 * SQLite Storage Layer
 *
 * Persistent storage for memory entries, provenance, and causal relations.
 * Uses better-sqlite3 for synchronous, high-performance SQLite operations.
 */

import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type {
  MemoryEntry,
  MemorySource,
  ProvenanceInfo,
  CausalRelation,
  CausalRelationType,
  PatternTemplate,
  PatternSlot,
  StorageConfig
} from '../core/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class SQLiteStorage {
  private db: Database.Database;
  private nextVectorLabel: number = 0;

  constructor(config: StorageConfig) {
    this.db = new Database(config.sqlitePath);

    if (config.enableWAL) {
      this.db.pragma('journal_mode = WAL');
    }

    this.db.pragma('foreign_keys = ON');
    this.initializeSchema();
    this.loadNextVectorLabel();
  }

  private initializeSchema(): void {
    // Run migrations BEFORE schema to ensure columns exist for indexes
    this.runMigrations();

    const schemaPath = join(__dirname, 'schema.sql');
    const schema = readFileSync(schemaPath, 'utf-8');
    this.db.exec(schema);
  }

  /**
   * Run migrations for existing databases that may be missing columns.
   * Must run BEFORE schema.sql because schema creates indexes on new columns.
   */
  private runMigrations(): void {
    // Migrate causal_relations
    this.migrateTable('causal_relations', [
      { name: 'ttl', type: 'INTEGER' },
      { name: 'expires_at', type: 'TEXT' }
    ]);

    // Migrate vector_mappings
    this.migrateTable('vector_mappings', [
      { name: 'access_count', type: 'INTEGER DEFAULT 0' },
      { name: 'last_accessed_at', type: 'TEXT' },
      { name: 'compression_tier', type: "TEXT DEFAULT 'hot'" }
    ]);

    // Migrate memory_entries for deferred embedding
    this.migrateTable('memory_entries', [
      { name: 'pending_embedding', type: 'INTEGER DEFAULT 0' }
    ]);

    // Migrate memory_entries for MemRL Q-value learning
    this.migrateTable('memory_entries', [
      { name: 'q_value', type: 'REAL DEFAULT 0.5' },
      { name: 'q_update_count', type: 'INTEGER DEFAULT 0' },
      { name: 'last_q_update', type: 'TEXT' }
    ]);

    // Create any missing tables (for databases created before these tables were added)
    this.createMissingTables();
  }

  /**
   * Create tables that were added after initial database creation.
   * Uses CREATE TABLE IF NOT EXISTS to be safe for new databases.
   */
  private createMissingTables(): void {
    // memrl_queries table (added for MemRL learning feedback tracking)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memrl_queries (
        id TEXT PRIMARY KEY,
        query_text TEXT NOT NULL,
        entry_ids TEXT NOT NULL,
        similarities TEXT NOT NULL,
        q_values TEXT NOT NULL,
        delta_used REAL NOT NULL,
        lambda_used REAL NOT NULL,
        has_feedback INTEGER DEFAULT 0,
        created_at TEXT NOT NULL
      )
    `);

    // Create indexes if they don't exist (safe to run multiple times)
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_memrl_queries_created ON memrl_queries(created_at DESC)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_memrl_queries_feedback ON memrl_queries(has_feedback)`);

    // feedback_ratings table (added for AutoRecall feedback tracking)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS feedback_ratings (
        query_id TEXT PRIMARY KEY,
        score INTEGER NOT NULL,
        auto INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY (query_id) REFERENCES memrl_queries(id) ON DELETE CASCADE
      )
    `);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_feedback_ratings_auto ON feedback_ratings(auto)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_feedback_ratings_score ON feedback_ratings(score)`);

    // feedback_disagreements table (added for calibration learning)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS feedback_disagreements (
        id TEXT PRIMARY KEY,
        query_id TEXT NOT NULL,
        auto_score INTEGER NOT NULL,
        human_score INTEGER NOT NULL,
        context TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (query_id) REFERENCES memrl_queries(id) ON DELETE CASCADE
      )
    `);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_disagreements_created ON feedback_disagreements(created_at DESC)`);
  }

  /**
   * Add missing columns to an existing table
   */
  private migrateTable(tableName: string, columns: Array<{ name: string; type: string }>): void {
    // Check if table exists
    const tableExists = this.db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name=?
    `).get(tableName);

    if (!tableExists) {
      // Table doesn't exist yet, schema.sql will create it with all columns
      return;
    }

    // Get current columns
    const currentColumns = this.db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
    const columnNames = new Set(currentColumns.map(col => col.name));

    // Add missing columns
    for (const col of columns) {
      if (!columnNames.has(col.name)) {
        console.log(`[SQLiteStorage] Running migration: Adding ${col.name} column to ${tableName}`);
        this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${col.name} ${col.type}`);
      }
    }
  }

  private loadNextVectorLabel(): void {
    const result = this.db.prepare('SELECT MAX(label) as maxLabel FROM vector_mappings').get() as { maxLabel: number | null };
    this.nextVectorLabel = (result?.maxLabel ?? -1) + 1;
  }

  // ==========================================
  // MEMORY ENTRIES
  // ==========================================

  storeEntry(entry: MemoryEntry): void {
    const insertEntry = this.db.prepare(`
      INSERT INTO memory_entries (id, content, source, importance, session_id, agent_id, context, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertTag = this.db.prepare(`
      INSERT INTO memory_tags (entry_id, tag) VALUES (?, ?)
    `);

    const insertProvenance = this.db.prepare(`
      INSERT INTO provenance (entry_id, lineage_depth, confidence, relevance, l_score)
      VALUES (?, ?, ?, ?, ?)
    `);

    const insertProvenanceLink = this.db.prepare(`
      INSERT INTO provenance_links (child_id, parent_id) VALUES (?, ?)
    `);

    const transaction = this.db.transaction(() => {
      insertEntry.run(
        entry.id,
        entry.content,
        entry.metadata.source,
        entry.metadata.importance,
        entry.metadata.sessionId ?? null,
        entry.metadata.agentId ?? null,
        entry.metadata.context ? JSON.stringify(entry.metadata.context) : null,
        entry.createdAt.toISOString(),
        entry.updatedAt.toISOString()
      );

      for (const tag of entry.metadata.tags) {
        insertTag.run(entry.id, tag);
      }

      insertProvenance.run(
        entry.id,
        entry.provenance.lineageDepth,
        entry.provenance.confidence,
        entry.provenance.relevance,
        entry.provenance.lScore ?? null
      );

      for (const parentId of entry.provenance.parentIds) {
        insertProvenanceLink.run(entry.id, parentId);
      }
    });

    transaction();
  }

  getEntry(id: string): MemoryEntry | null {
    const entryRow = this.db.prepare(`
      SELECT * FROM memory_entries WHERE id = ?
    `).get(id) as EntryRow | undefined;

    if (!entryRow) return null;

    const tags = this.db.prepare(`
      SELECT tag FROM memory_tags WHERE entry_id = ?
    `).all(id) as { tag: string }[];

    const provRow = this.db.prepare(`
      SELECT * FROM provenance WHERE entry_id = ?
    `).get(id) as ProvenanceRow | undefined;

    const parentIds = this.db.prepare(`
      SELECT parent_id FROM provenance_links WHERE child_id = ?
    `).all(id) as { parent_id: string }[];

    return this.rowToEntry(entryRow, tags.map(t => t.tag), provRow, parentIds.map(p => p.parent_id));
  }

  getAllEntries(): MemoryEntry[] {
    // OPTIMIZED: Batch queries with JOINs instead of N+1 pattern
    // Fetch all entries
    const entries = this.db.prepare(`SELECT * FROM memory_entries ORDER BY created_at DESC`).all() as EntryRow[];
    if (entries.length === 0) return [];

    // Batch fetch all tags grouped by entry_id
    const allTags = this.db.prepare(`
      SELECT entry_id, GROUP_CONCAT(tag) as tags
      FROM memory_tags
      GROUP BY entry_id
    `).all() as { entry_id: string; tags: string | null }[];
    const tagMap = new Map(allTags.map(t => [t.entry_id, t.tags ? t.tags.split(',') : []]));

    // Batch fetch all provenance
    const allProvenance = this.db.prepare(`SELECT * FROM provenance`).all() as ProvenanceRow[];
    const provMap = new Map(allProvenance.map(p => [p.entry_id, p]));

    // Batch fetch all parent links
    const allParentLinks = this.db.prepare(`
      SELECT child_id, GROUP_CONCAT(parent_id) as parent_ids
      FROM provenance_links
      GROUP BY child_id
    `).all() as { child_id: string; parent_ids: string | null }[];
    const parentMap = new Map(allParentLinks.map(p => [p.child_id, p.parent_ids ? p.parent_ids.split(',') : []]));

    // Build entries from cached data (O(N) instead of O(N²))
    return entries.map(entry => {
      const tags = tagMap.get(entry.id) || [];
      const provRow = provMap.get(entry.id);
      const parentIds = parentMap.get(entry.id) || [];
      return this.rowToEntry(entry, tags, provRow, parentIds);
    });
  }

  deleteEntry(id: string): boolean {
    const result = this.db.prepare('DELETE FROM memory_entries WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /**
   * Delete all entries EXCEPT those with specified tags
   * Used by assimilate to preserve system knowledge while wiping project data
   * @returns Number of deleted entries
   */
  deleteEntriesExceptTags(preserveTags: string[]): number {
    if (preserveTags.length === 0) {
      // No tags to preserve = delete everything
      const result = this.db.prepare('DELETE FROM memory_entries').run();
      return result.changes;
    }

    // Get IDs of entries to preserve (have any of the preserve tags)
    const preserveIds = this.getEntryIdsByTags(preserveTags);

    if (preserveIds.length === 0) {
      // Nothing to preserve = delete everything
      const result = this.db.prepare('DELETE FROM memory_entries').run();
      return result.changes;
    }

    // Delete all entries NOT in the preserve list
    const placeholders = preserveIds.map(() => '?').join(',');
    const result = this.db.prepare(
      `DELETE FROM memory_entries WHERE id NOT IN (${placeholders})`
    ).run(...preserveIds);

    return result.changes;
  }

  /**
   * Update an existing memory entry
   */
  updateEntry(id: string, updates: {
    content?: string;
    tags?: string[];
    importance?: number;
    source?: MemorySource;
  }): boolean {
    const entry = this.getEntry(id);
    if (!entry) return false;

    const now = new Date().toISOString();

    const transaction = this.db.transaction(() => {
      // Update content if provided
      if (updates.content !== undefined) {
        this.db.prepare(`
          UPDATE memory_entries SET content = ?, updated_at = ? WHERE id = ?
        `).run(updates.content, now, id);
      }

      // Update importance if provided
      if (updates.importance !== undefined) {
        this.db.prepare(`
          UPDATE memory_entries SET importance = ?, updated_at = ? WHERE id = ?
        `).run(updates.importance, now, id);
      }

      // Update source if provided
      if (updates.source !== undefined) {
        this.db.prepare(`
          UPDATE memory_entries SET source = ?, updated_at = ? WHERE id = ?
        `).run(updates.source, now, id);
      }

      // Update tags if provided (replace all existing)
      if (updates.tags !== undefined) {
        this.db.prepare('DELETE FROM memory_tags WHERE entry_id = ?').run(id);
        for (const tag of updates.tags) {
          this.db.prepare('INSERT INTO memory_tags (entry_id, tag) VALUES (?, ?)').run(id, tag);
        }
        // Also update timestamp since tags changed
        this.db.prepare('UPDATE memory_entries SET updated_at = ? WHERE id = ?').run(now, id);
      }
    });

    transaction();
    return true;
  }

  updateLScore(entryId: string, lScore: number): void {
    this.db.prepare('UPDATE provenance SET l_score = ? WHERE entry_id = ?').run(lScore, entryId);
  }

  // ==========================================
  // MEMRL Q-VALUE OPERATIONS
  // ==========================================

  /**
   * Get Q-value for a memory entry
   */
  getQValue(entryId: string): number {
    const row = this.db.prepare('SELECT q_value FROM memory_entries WHERE id = ?').get(entryId) as { q_value: number } | undefined;
    return row?.q_value ?? 0.5; // Default neutral Q-value
  }

  /**
   * Get Q-values for multiple entries in batch
   */
  getQValuesBatch(entryIds: string[]): Map<string, number> {
    if (entryIds.length === 0) return new Map();

    const placeholders = entryIds.map(() => '?').join(',');
    const rows = this.db.prepare(`
      SELECT id, q_value FROM memory_entries WHERE id IN (${placeholders})
    `).all(...entryIds) as Array<{ id: string; q_value: number | null }>;

    const result = new Map<string, number>();
    for (const row of rows) {
      result.set(row.id, row.q_value ?? 0.5);
    }
    // Fill in defaults for missing entries
    for (const id of entryIds) {
      if (!result.has(id)) {
        result.set(id, 0.5);
      }
    }
    return result;
  }

  /**
   * Update Q-value for a memory entry using EMA
   * Q_new = Q_old + alpha * (reward - Q_old)
   */
  updateQValue(entryId: string, reward: number, alpha: number = 0.1): { oldQ: number; newQ: number } {
    const now = new Date().toISOString();
    const oldQ = this.getQValue(entryId);

    // EMA update with bounds
    let newQ = oldQ + alpha * (reward - oldQ);
    newQ = Math.max(0.1, Math.min(1.0, newQ)); // Clamp to [0.1, 1.0]

    this.db.prepare(`
      UPDATE memory_entries
      SET q_value = ?, q_update_count = q_update_count + 1, last_q_update = ?
      WHERE id = ?
    `).run(newQ, now, entryId);

    return { oldQ, newQ };
  }

  /**
   * Batch update Q-values for multiple entries
   */
  updateQValuesBatch(updates: Array<{ entryId: string; reward: number }>, alpha: number = 0.1): number {
    const now = new Date().toISOString();
    let updated = 0;

    const transaction = this.db.transaction(() => {
      for (const { entryId, reward } of updates) {
        const oldQ = this.getQValue(entryId);
        let newQ = oldQ + alpha * (reward - oldQ);
        newQ = Math.max(0.1, Math.min(1.0, newQ));

        const result = this.db.prepare(`
          UPDATE memory_entries
          SET q_value = ?, q_update_count = q_update_count + 1, last_q_update = ?
          WHERE id = ?
        `).run(newQ, now, entryId);

        if (result.changes > 0) updated++;
      }
    });

    transaction();
    return updated;
  }

  /**
   * Get MemRL Q-value statistics
   */
  getQValueStats(): {
    totalEntries: number;
    entriesWithUpdates: number;
    avgQValue: number;
    distribution: { low: number; medium: number; high: number };
  } {
    const stats = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN q_update_count > 0 THEN 1 ELSE 0 END) as with_updates,
        AVG(q_value) as avg_q,
        SUM(CASE WHEN q_value < 0.4 THEN 1 ELSE 0 END) as low,
        SUM(CASE WHEN q_value >= 0.4 AND q_value < 0.7 THEN 1 ELSE 0 END) as medium,
        SUM(CASE WHEN q_value >= 0.7 THEN 1 ELSE 0 END) as high
      FROM memory_entries
    `).get() as { total: number; with_updates: number; avg_q: number; low: number; medium: number; high: number };

    return {
      totalEntries: stats.total,
      entriesWithUpdates: stats.with_updates ?? 0,
      avgQValue: stats.avg_q ?? 0.5,
      distribution: {
        low: stats.low ?? 0,
        medium: stats.medium ?? 0,
        high: stats.high ?? 0
      }
    };
  }

  // ==========================================
  // MEMRL QUERY TRACKING
  // ==========================================

  /**
   * Store a MemRL query for feedback tracking
   */
  storeMemRLQuery(
    id: string,
    queryText: string,
    entryIds: string[],
    similarities: number[],
    qValues: number[],
    delta: number,
    lambda: number
  ): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO memrl_queries (id, query_text, entry_ids, similarities, q_values, delta_used, lambda_used, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      queryText,
      JSON.stringify(entryIds),
      JSON.stringify(similarities),
      JSON.stringify(qValues),
      delta,
      lambda,
      now
    );
  }

  /**
   * Get a stored MemRL query
   */
  getMemRLQuery(id: string): {
    queryText: string;
    entryIds: string[];
    similarities: number[];
    qValues: number[];
    delta: number;
    lambda: number;
    hasFeedback: boolean;
  } | null {
    const row = this.db.prepare(`
      SELECT query_text, entry_ids, similarities, q_values, delta_used, lambda_used, has_feedback
      FROM memrl_queries WHERE id = ?
    `).get(id) as {
      query_text: string;
      entry_ids: string;
      similarities: string;
      q_values: string;
      delta_used: number;
      lambda_used: number;
      has_feedback: number;
    } | undefined;

    if (!row) return null;

    return {
      queryText: row.query_text,
      entryIds: JSON.parse(row.entry_ids),
      similarities: JSON.parse(row.similarities),
      qValues: JSON.parse(row.q_values),
      delta: row.delta_used,
      lambda: row.lambda_used,
      hasFeedback: row.has_feedback === 1
    };
  }

  /**
   * Mark a MemRL query as having received feedback
   */
  markMemRLQueryFeedback(id: string): void {
    this.db.prepare('UPDATE memrl_queries SET has_feedback = 1 WHERE id = ?').run(id);
  }

  /**
   * Get MemRL query statistics
   */
  getMemRLQueryStats(): { totalQueries: number; queriesWithFeedback: number } {
    const stats = this.db.prepare(`
      SELECT COUNT(*) as total, SUM(has_feedback) as with_feedback
      FROM memrl_queries
    `).get() as { total: number; with_feedback: number };

    return {
      totalQueries: stats.total,
      queriesWithFeedback: stats.with_feedback ?? 0
    };
  }

  // ==========================================
  // FEEDBACK RATINGS
  // ==========================================

  /**
   * Get feedback rating for a query
   */
  getQueryFeedback(queryId: string): { score: number; auto: boolean; createdAt: string } | null {
    const row = this.db.prepare(`
      SELECT score, auto, created_at
      FROM feedback_ratings WHERE query_id = ?
    `).get(queryId) as { score: number; auto: number; created_at: string } | undefined;

    if (!row) return null;

    return {
      score: row.score,
      auto: row.auto === 1,
      createdAt: row.created_at
    };
  }

  /**
   * Store or update feedback rating for a query
   */
  markQueryFeedback(queryId: string, score: number, auto: boolean): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT OR REPLACE INTO feedback_ratings (query_id, score, auto, created_at)
      VALUES (?, ?, ?, ?)
    `).run(queryId, score, auto ? 1 : 0, now);

    // Also mark the query as having feedback
    this.markMemRLQueryFeedback(queryId);
  }

  /**
   * Store a disagreement between auto and human ratings
   */
  storeDisagreement(data: {
    queryId: string;
    autoScore: number;
    humanScore: number;
    context?: string;
  }): void {
    const now = new Date().toISOString();
    const { v4: uuidv4 } = require('uuid');
    const id = uuidv4();

    this.db.prepare(`
      INSERT INTO feedback_disagreements (id, query_id, auto_score, human_score, context, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      id,
      data.queryId,
      data.autoScore,
      data.humanScore,
      data.context ? JSON.stringify(data.context) : null,
      now
    );
  }

  /**
   * Count queries without feedback
   */
  countQueriesWithoutFeedback(): number {
    const result = this.db.prepare(`
      SELECT COUNT(*) as count
      FROM memrl_queries
      WHERE has_feedback = 0
    `).get() as { count: number };

    return result.count;
  }

  // ==========================================
  // VECTOR MAPPINGS
  // ==========================================

  storeVectorMapping(entryId: string): number {
    const maxRetries = 3;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const label = this.nextVectorLabel++;
      try {
        this.db.prepare('INSERT INTO vector_mappings (entry_id, label) VALUES (?, ?)').run(entryId, label);
        return label;
      } catch (error: any) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || error.message?.includes('UNIQUE constraint failed')) {
          // Label collision - refresh counter from DB and retry
          this.loadNextVectorLabel();
          continue;
        }
        throw error;
      }
    }
    // Final attempt after refreshing
    this.loadNextVectorLabel();
    const label = this.nextVectorLabel++;
    this.db.prepare('INSERT INTO vector_mappings (entry_id, label) VALUES (?, ?)').run(entryId, label);
    return label;
  }

  getVectorLabel(entryId: string): number | null {
    const result = this.db.prepare('SELECT label FROM vector_mappings WHERE entry_id = ?').get(entryId) as { label: number } | undefined;
    return result?.label ?? null;
  }

  getEntryIdByLabel(label: number): string | null {
    const result = this.db.prepare('SELECT entry_id FROM vector_mappings WHERE label = ?').get(label) as { entry_id: string } | undefined;
    return result?.entry_id ?? null;
  }

  /**
   * Record an access to a vector (for compression tier management)
   */
  recordVectorAccess(label: number): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE vector_mappings
      SET access_count = access_count + 1, last_accessed_at = ?
      WHERE label = ?
    `).run(now, label);
  }

  /**
   * Get access statistics for a vector
   */
  getVectorAccessStats(label: number): VectorAccessRow | null {
    const row = this.db.prepare(`
      SELECT label, access_count, last_accessed_at, compression_tier
      FROM vector_mappings WHERE label = ?
    `).get(label) as VectorAccessRow | undefined;
    return row ?? null;
  }

  /**
   * Update the compression tier for a vector
   */
  updateVectorTier(label: number, tier: string): void {
    this.db.prepare(`
      UPDATE vector_mappings SET compression_tier = ? WHERE label = ?
    `).run(tier, label);
  }

  /**
   * Clear orphaned vector mappings (entries that no longer exist)
   * Returns count of deleted mappings
   */
  clearOrphanedVectorMappings(): number {
    const result = this.db.prepare(`
      DELETE FROM vector_mappings
      WHERE entry_id NOT IN (SELECT id FROM memory_entries)
    `).run();
    // Reset the label counter
    this.loadNextVectorLabel();
    return result.changes;
  }

  /**
   * Clear all vector mappings (for full rebuild)
   * Returns count of deleted mappings
   */
  clearAllVectorMappings(): number {
    const result = this.db.prepare('DELETE FROM vector_mappings').run();
    this.nextVectorLabel = 0;
    return result.changes;
  }

  /**
   * Get all vectors with their access stats for tier evaluation
   */
  getAllVectorAccessStats(): VectorAccessRow[] {
    return this.db.prepare(`
      SELECT label, access_count, last_accessed_at, compression_tier
      FROM vector_mappings
      ORDER BY access_count DESC
    `).all() as VectorAccessRow[];
  }

  /**
   * Get the maximum access count (for frequency calculation)
   */
  getMaxVectorAccessCount(): number {
    const result = this.db.prepare(`
      SELECT MAX(access_count) as max_count FROM vector_mappings
    `).get() as { max_count: number | null };
    return result?.max_count ?? 0;
  }

  /**
   * Get vectors in a specific compression tier
   */
  getVectorsByTier(tier: string): number[] {
    const rows = this.db.prepare(`
      SELECT label FROM vector_mappings WHERE compression_tier = ?
    `).all(tier) as { label: number }[];
    return rows.map(r => r.label);
  }

  /**
   * Get compression tier distribution
   */
  getCompressionTierCounts(): Record<string, number> {
    const rows = this.db.prepare(`
      SELECT compression_tier, COUNT(*) as count
      FROM vector_mappings
      GROUP BY compression_tier
    `).all() as { compression_tier: string; count: number }[];

    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.compression_tier] = row.count;
    }
    return result;
  }

  // ==========================================
  // PROVENANCE
  // ==========================================

  getParentIds(entryId: string): string[] {
    const rows = this.db.prepare('SELECT parent_id FROM provenance_links WHERE child_id = ?').all(entryId) as { parent_id: string }[];
    return rows.map(r => r.parent_id);
  }

  getChildIds(entryId: string): string[] {
    const rows = this.db.prepare('SELECT child_id FROM provenance_links WHERE parent_id = ?').all(entryId) as { child_id: string }[];
    return rows.map(r => r.child_id);
  }

  getProvenance(entryId: string): ProvenanceInfo | null {
    const provRow = this.db.prepare('SELECT * FROM provenance WHERE entry_id = ?').get(entryId) as ProvenanceRow | undefined;
    if (!provRow) return null;

    const parentIds = this.getParentIds(entryId);
    return {
      parentIds,
      lineageDepth: provRow.lineage_depth,
      confidence: provRow.confidence,
      relevance: provRow.relevance,
      lScore: provRow.l_score ?? undefined
    };
  }

  /**
   * OPTIMIZED: Batch fetch provenance data for multiple entries
   * Used by ProvenanceStore.traceLineage() to avoid N+1 queries
   */
  getBatchProvenance(entryIds: string[]): Map<string, ProvenanceInfo> {
    if (entryIds.length === 0) return new Map();

    const placeholders = entryIds.map(() => '?').join(',');

    // Batch fetch provenance rows
    const provRows = this.db.prepare(`
      SELECT * FROM provenance WHERE entry_id IN (${placeholders})
    `).all(...entryIds) as ProvenanceRow[];

    // Batch fetch parent links
    const parentLinks = this.db.prepare(`
      SELECT child_id, parent_id FROM provenance_links WHERE child_id IN (${placeholders})
    `).all(...entryIds) as { child_id: string; parent_id: string }[];

    // Build parent map
    const parentMap = new Map<string, string[]>();
    for (const link of parentLinks) {
      if (!parentMap.has(link.child_id)) parentMap.set(link.child_id, []);
      parentMap.get(link.child_id)!.push(link.parent_id);
    }

    // Build result map
    const result = new Map<string, ProvenanceInfo>();
    for (const row of provRows) {
      result.set(row.entry_id, {
        parentIds: parentMap.get(row.entry_id) || [],
        lineageDepth: row.lineage_depth,
        confidence: row.confidence,
        relevance: row.relevance,
        lScore: row.l_score ?? undefined
      });
    }

    return result;
  }

  /**
   * OPTIMIZED: Use recursive CTE to fetch entire lineage in single query
   * Returns all entry IDs in the lineage tree up to maxDepth
   */
  getLineageEntryIds(rootId: string, maxDepth: number = 10): string[] {
    // SQLite recursive CTE to traverse provenance_links
    const result = this.db.prepare(`
      WITH RECURSIVE lineage(entry_id, depth) AS (
        -- Base case: start with root
        SELECT ?, 0
        UNION ALL
        -- Recursive case: follow parent links
        SELECT pl.parent_id, lineage.depth + 1
        FROM provenance_links pl
        JOIN lineage ON pl.child_id = lineage.entry_id
        WHERE lineage.depth < ?
      )
      SELECT DISTINCT entry_id FROM lineage
    `).all(rootId, maxDepth) as { entry_id: string }[];

    return result.map(r => r.entry_id);
  }

  /**
   * OPTIMIZED: Batch fetch entries by IDs
   */
  getBatchEntries(entryIds: string[]): Map<string, MemoryEntry> {
    if (entryIds.length === 0) return new Map();

    const placeholders = entryIds.map(() => '?').join(',');

    // Fetch all entries
    const entries = this.db.prepare(`
      SELECT * FROM memory_entries WHERE id IN (${placeholders})
    `).all(...entryIds) as EntryRow[];

    // Batch fetch tags
    const allTags = this.db.prepare(`
      SELECT entry_id, GROUP_CONCAT(tag) as tags
      FROM memory_tags WHERE entry_id IN (${placeholders})
      GROUP BY entry_id
    `).all(...entryIds) as { entry_id: string; tags: string | null }[];
    const tagMap = new Map(allTags.map(t => [t.entry_id, t.tags ? t.tags.split(',') : []]));

    // Batch fetch provenance
    const provMap = this.getBatchProvenance(entryIds);

    // Build result map
    const result = new Map<string, MemoryEntry>();
    for (const entry of entries) {
      const tags = tagMap.get(entry.id) || [];
      const prov = provMap.get(entry.id);
      const parentIds = prov?.parentIds || [];

      result.set(entry.id, this.rowToEntry(
        entry,
        tags,
        prov ? {
          entry_id: entry.id,
          lineage_depth: prov.lineageDepth,
          confidence: prov.confidence,
          relevance: prov.relevance,
          l_score: prov.lScore ?? null
        } : undefined,
        parentIds
      ));
    }

    return result;
  }

  // ==========================================
  // CAUSAL RELATIONS
  // ==========================================

  storeCausalRelation(relation: CausalRelation): void {
    const insertRelation = this.db.prepare(`
      INSERT INTO causal_relations (id, type, strength, metadata, created_at, ttl, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const insertSource = this.db.prepare(`
      INSERT INTO causal_sources (relation_id, entry_id) VALUES (?, ?)
    `);

    const insertTarget = this.db.prepare(`
      INSERT INTO causal_targets (relation_id, entry_id) VALUES (?, ?)
    `);

    const transaction = this.db.transaction(() => {
      insertRelation.run(
        relation.id,
        relation.type,
        relation.strength,
        relation.metadata ? JSON.stringify(relation.metadata) : null,
        relation.createdAt.toISOString(),
        relation.ttl ?? null,
        relation.expiresAt ? relation.expiresAt.toISOString() : null
      );

      for (const sourceId of relation.sourceIds) {
        insertSource.run(relation.id, sourceId);
      }

      for (const targetId of relation.targetIds) {
        insertTarget.run(relation.id, targetId);
      }
    });

    transaction();
  }

  getCausalRelation(id: string): CausalRelation | null {
    const row = this.db.prepare('SELECT * FROM causal_relations WHERE id = ?').get(id) as CausalRelationRow | undefined;
    if (!row) return null;

    const sources = this.db.prepare('SELECT entry_id FROM causal_sources WHERE relation_id = ?').all(id) as { entry_id: string }[];
    const targets = this.db.prepare('SELECT entry_id FROM causal_targets WHERE relation_id = ?').all(id) as { entry_id: string }[];

    return {
      id: row.id,
      type: row.type as CausalRelationType,
      sourceIds: sources.map(s => s.entry_id),
      targetIds: targets.map(t => t.entry_id),
      strength: row.strength,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      createdAt: new Date(row.created_at),
      ttl: row.ttl ?? undefined,
      expiresAt: row.expires_at ? new Date(row.expires_at) : undefined
    };
  }

  getCausalRelationsForEntry(entryId: string, direction: 'forward' | 'backward' | 'both'): CausalRelation[] {
    // OPTIMIZED: Single UNION query with DISTINCT to avoid double N+1 and O(N²) dedup
    let query: string;

    if (direction === 'forward') {
      query = `
        SELECT DISTINCT r.id, r.type, r.strength, r.metadata, r.created_at, r.ttl, r.expires_at
        FROM causal_relations r
        JOIN causal_sources s ON r.id = s.relation_id
        WHERE s.entry_id = ?
      `;
    } else if (direction === 'backward') {
      query = `
        SELECT DISTINCT r.id, r.type, r.strength, r.metadata, r.created_at, r.ttl, r.expires_at
        FROM causal_relations r
        JOIN causal_targets t ON r.id = t.relation_id
        WHERE t.entry_id = ?
      `;
    } else {
      // 'both' - use UNION to deduplicate at SQL level (O(1) vs O(N²))
      query = `
        SELECT DISTINCT r.id, r.type, r.strength, r.metadata, r.created_at, r.ttl, r.expires_at
        FROM causal_relations r
        JOIN causal_sources s ON r.id = s.relation_id
        WHERE s.entry_id = ?
        UNION
        SELECT DISTINCT r.id, r.type, r.strength, r.metadata, r.created_at, r.ttl, r.expires_at
        FROM causal_relations r
        JOIN causal_targets t ON r.id = t.relation_id
        WHERE t.entry_id = ?
      `;
    }

    const params = direction === 'both' ? [entryId, entryId] : [entryId];
    const relationRows = this.db.prepare(query).all(...params) as CausalRelationRow[];

    if (relationRows.length === 0) return [];

    // Batch fetch all sources and targets for these relations
    const relationIds = relationRows.map(r => r.id);
    const placeholders = relationIds.map(() => '?').join(',');

    const allSources = this.db.prepare(`
      SELECT relation_id, entry_id FROM causal_sources WHERE relation_id IN (${placeholders})
    `).all(...relationIds) as { relation_id: string; entry_id: string }[];

    const allTargets = this.db.prepare(`
      SELECT relation_id, entry_id FROM causal_targets WHERE relation_id IN (${placeholders})
    `).all(...relationIds) as { relation_id: string; entry_id: string }[];

    // Build lookup maps
    const sourceMap = new Map<string, string[]>();
    const targetMap = new Map<string, string[]>();

    for (const s of allSources) {
      if (!sourceMap.has(s.relation_id)) sourceMap.set(s.relation_id, []);
      sourceMap.get(s.relation_id)!.push(s.entry_id);
    }

    for (const t of allTargets) {
      if (!targetMap.has(t.relation_id)) targetMap.set(t.relation_id, []);
      targetMap.get(t.relation_id)!.push(t.entry_id);
    }

    // Build relations from cached data
    return relationRows.map(row => ({
      id: row.id,
      type: row.type as CausalRelationType,
      sourceIds: sourceMap.get(row.id) || [],
      targetIds: targetMap.get(row.id) || [],
      strength: row.strength,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      createdAt: new Date(row.created_at),
      ttl: row.ttl ?? undefined,
      expiresAt: row.expires_at ? new Date(row.expires_at) : undefined
    }));
  }

  getAllCausalRelations(): CausalRelation[] {
    const rows = this.db.prepare('SELECT id FROM causal_relations').all() as { id: string }[];
    return rows.map(r => this.getCausalRelation(r.id)!).filter(Boolean);
  }

  /**
   * Get all non-expired causal relations
   * Returns relations where expires_at is NULL or in the future
   */
  getActiveCausalRelations(): CausalRelation[] {
    const now = new Date().toISOString();
    const rows = this.db.prepare(`
      SELECT id FROM causal_relations
      WHERE expires_at IS NULL OR expires_at > ?
    `).all(now) as { id: string }[];
    return rows.map(r => this.getCausalRelation(r.id)!).filter(Boolean);
  }

  /**
   * Delete expired causal relations
   * Returns the number of deleted relations
   */
  deleteExpiredCausalRelations(): number {
    const now = new Date().toISOString();

    // First get the IDs of expired relations for logging
    const expiredIds = this.db.prepare(`
      SELECT id FROM causal_relations
      WHERE expires_at IS NOT NULL AND expires_at <= ?
    `).all(now) as { id: string }[];

    if (expiredIds.length === 0) return 0;

    // Delete from junction tables first (CASCADE should handle this, but being explicit)
    const deleteSourcesStmt = this.db.prepare('DELETE FROM causal_sources WHERE relation_id = ?');
    const deleteTargetsStmt = this.db.prepare('DELETE FROM causal_targets WHERE relation_id = ?');
    const deleteRelationStmt = this.db.prepare('DELETE FROM causal_relations WHERE id = ?');

    const transaction = this.db.transaction(() => {
      for (const { id } of expiredIds) {
        deleteSourcesStmt.run(id);
        deleteTargetsStmt.run(id);
        deleteRelationStmt.run(id);
      }
    });

    transaction();
    return expiredIds.length;
  }

  /**
   * Get count of expired causal relations
   */
  getExpiredCausalRelationCount(): number {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      SELECT COUNT(*) as count FROM causal_relations
      WHERE expires_at IS NOT NULL AND expires_at <= ?
    `).get(now) as { count: number };
    return result.count;
  }

  /**
   * Get expired causal relations (for reporting before cleanup)
   */
  getExpiredCausalRelations(): CausalRelation[] {
    const now = new Date().toISOString();
    const rows = this.db.prepare(`
      SELECT id FROM causal_relations
      WHERE expires_at IS NOT NULL AND expires_at <= ?
    `).all(now) as { id: string }[];
    return rows.map(r => this.getCausalRelation(r.id)!).filter(Boolean);
  }

  // ==========================================
  // PATTERN TEMPLATES
  // ==========================================

  storePatternTemplate(template: PatternTemplate): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO pattern_templates (id, name, pattern, slots, priority, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      template.id,
      template.name,
      template.pattern,
      JSON.stringify(template.slots),
      template.priority,
      template.createdAt.toISOString()
    );
  }

  getPatternTemplate(id: string): PatternTemplate | null {
    const row = this.db.prepare('SELECT * FROM pattern_templates WHERE id = ?').get(id) as PatternTemplateRow | undefined;
    if (!row) return null;
    return this.rowToPatternTemplate(row);
  }

  getPatternTemplateByName(name: string): PatternTemplate | null {
    const row = this.db.prepare('SELECT * FROM pattern_templates WHERE name = ?').get(name) as PatternTemplateRow | undefined;
    if (!row) return null;
    return this.rowToPatternTemplate(row);
  }

  getAllPatternTemplates(): PatternTemplate[] {
    const rows = this.db.prepare('SELECT * FROM pattern_templates ORDER BY priority DESC').all() as PatternTemplateRow[];
    return rows.map(row => this.rowToPatternTemplate(row));
  }

  deletePatternTemplate(id: string): boolean {
    const result = this.db.prepare('DELETE FROM pattern_templates WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // ==========================================
  // PATTERN STATISTICS
  // ==========================================

  /**
   * Record a pattern use and whether it was successful
   */
  recordPatternUse(patternId: string, success: boolean): void {
    const now = new Date().toISOString();

    // Upsert pattern stats
    this.db.prepare(`
      INSERT INTO pattern_stats (pattern_id, use_count, success_count, last_used_at)
      VALUES (?, 1, ?, ?)
      ON CONFLICT(pattern_id) DO UPDATE SET
        use_count = use_count + 1,
        success_count = success_count + ?,
        last_used_at = ?
    `).run(patternId, success ? 1 : 0, now, success ? 1 : 0, now);
  }

  /**
   * Get statistics for a pattern
   */
  getPatternStats(patternId: string): PatternStatsRow | null {
    const row = this.db.prepare(`
      SELECT pattern_id, use_count, success_count, last_used_at,
             CASE WHEN use_count > 0 THEN CAST(success_count AS REAL) / use_count ELSE 0 END as success_rate
      FROM pattern_stats WHERE pattern_id = ?
    `).get(patternId) as PatternStatsRow | undefined;
    return row ?? null;
  }

  /**
   * Get all pattern statistics
   */
  getAllPatternStats(): PatternStatsRow[] {
    return this.db.prepare(`
      SELECT pattern_id, use_count, success_count, last_used_at,
             CASE WHEN use_count > 0 THEN CAST(success_count AS REAL) / use_count ELSE 0 END as success_rate
      FROM pattern_stats ORDER BY success_rate ASC
    `).all() as PatternStatsRow[];
  }

  /**
   * Get patterns that are candidates for pruning (low success rate, enough uses)
   */
  getPruneCandidatePatterns(threshold: number, minUses: number): Array<{
    pattern_id: string;
    name: string;
    use_count: number;
    success_rate: number;
  }> {
    return this.db.prepare(`
      SELECT ps.pattern_id, pt.name, ps.use_count,
             CAST(ps.success_count AS REAL) / ps.use_count as success_rate
      FROM pattern_stats ps
      JOIN pattern_templates pt ON ps.pattern_id = pt.id
      WHERE ps.use_count >= ?
        AND CAST(ps.success_count AS REAL) / ps.use_count < ?
      ORDER BY success_rate ASC
    `).all(minUses, threshold) as Array<{
      pattern_id: string;
      name: string;
      use_count: number;
      success_rate: number;
    }>;
  }

  // ==========================================
  // TAG QUERIES
  // ==========================================

  /**
   * Get entry IDs that have ALL of the specified tags
   * Uses GROUP BY + HAVING COUNT to ensure all tags are present
   */
  getEntryIdsByTags(tags: string[], matchAll: boolean = true): string[] {
    if (tags.length === 0) return [];
    const placeholders = tags.map(() => '?').join(',');

    if (matchAll) {
      // Require ALL tags to match
      const rows = this.db.prepare(`
        SELECT entry_id FROM memory_tags
        WHERE tag IN (${placeholders})
        GROUP BY entry_id
        HAVING COUNT(DISTINCT tag) = ?
      `).all(...tags, tags.length) as { entry_id: string }[];
      return rows.map(r => r.entry_id);
    } else {
      // ANY tag matches
      const rows = this.db.prepare(`
        SELECT DISTINCT entry_id FROM memory_tags WHERE tag IN (${placeholders})
      `).all(...tags) as { entry_id: string }[];
      return rows.map(r => r.entry_id);
    }
  }

  /**
   * Debug: List all unique tags in the database
   */
  getAllTags(): string[] {
    const rows = this.db.prepare(`
      SELECT DISTINCT tag FROM memory_tags ORDER BY tag
    `).all() as { tag: string }[];
    return rows.map(r => r.tag);
  }

  /**
   * Debug: Get entries by tag prefix (e.g., 'session:' to find all sessions)
   */
  getEntryIdsByTagPrefix(prefix: string): string[] {
    const rows = this.db.prepare(`
      SELECT DISTINCT entry_id FROM memory_tags WHERE tag LIKE ?
    `).all(`${prefix}%`) as { entry_id: string }[];
    return rows.map(r => r.entry_id);
  }

  /**
   * Get vector labels for entries that have ANY of the specified tags
   */
  getVectorLabelsByTags(tags: string[]): number[] {
    if (tags.length === 0) return [];
    const placeholders = tags.map(() => '?').join(',');
    const rows = this.db.prepare(`
      SELECT DISTINCT v.label
      FROM vector_mappings v
      JOIN memory_tags t ON v.entry_id = t.entry_id
      WHERE t.tag IN (${placeholders})
    `).all(...tags) as { label: number }[];
    return rows.map(r => r.label);
  }

  // ==========================================
  // STATISTICS
  // ==========================================

  getStats(): {
    totalEntries: number;
    vectorCount: number;
    causalRelations: number;
    patternTemplates: number;
    avgLScore: number;
    compressionTiers: Record<string, number>;
  } {
    const totalEntries = (this.db.prepare('SELECT COUNT(*) as count FROM memory_entries').get() as { count: number }).count;
    const vectorCount = (this.db.prepare('SELECT COUNT(*) as count FROM vector_mappings').get() as { count: number }).count;
    const causalRelations = (this.db.prepare('SELECT COUNT(*) as count FROM causal_relations').get() as { count: number }).count;
    const patternTemplates = (this.db.prepare('SELECT COUNT(*) as count FROM pattern_templates').get() as { count: number }).count;
    const avgLScore = (this.db.prepare('SELECT AVG(l_score) as avg FROM provenance WHERE l_score IS NOT NULL').get() as { avg: number | null }).avg ?? 0;
    const compressionTiers = this.getCompressionTierCounts();

    return { totalEntries, vectorCount, causalRelations, patternTemplates, avgLScore, compressionTiers };
  }

  // ==========================================
  // SYSTEM METADATA
  // ==========================================

  setMetadata(key: string, value: string): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO system_metadata (key, value, updated_at)
      VALUES (?, ?, ?)
    `).run(key, value, new Date().toISOString());
  }

  getMetadata(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM system_metadata WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  // ==========================================
  // HELPERS
  // ==========================================

  private rowToEntry(
    row: EntryRow,
    tags: string[],
    provRow: ProvenanceRow | undefined,
    parentIds: string[]
  ): MemoryEntry {
    return {
      id: row.id,
      content: row.content,
      metadata: {
        source: row.source as MemorySource,
        tags,
        importance: row.importance,
        context: row.context ? JSON.parse(row.context) : undefined,
        sessionId: row.session_id ?? undefined,
        agentId: row.agent_id ?? undefined
      },
      provenance: {
        parentIds,
        lineageDepth: provRow?.lineage_depth ?? 0,
        confidence: provRow?.confidence ?? 1.0,
        relevance: provRow?.relevance ?? 1.0,
        lScore: provRow?.l_score ?? undefined
      },
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }

  private rowToPatternTemplate(row: PatternTemplateRow): PatternTemplate {
    return {
      id: row.id,
      name: row.name,
      pattern: row.pattern,
      slots: JSON.parse(row.slots) as PatternSlot[],
      priority: row.priority,
      createdAt: new Date(row.created_at)
    };
  }

  // ==========================================
  // PENDING EMBEDDING OPERATIONS
  // ==========================================

  /**
   * Mark an entry as pending embedding (awaiting batch processing)
   */
  setPendingEmbedding(entryId: string, pending: boolean): void {
    this.db.prepare(`
      UPDATE memory_entries SET pending_embedding = ? WHERE id = ?
    `).run(pending ? 1 : 0, entryId);
  }

  /**
   * Get all entries that are pending embedding
   */
  getPendingEntries(): Array<{ id: string; content: string; label: number }> {
    return this.db.prepare(`
      SELECT m.id, m.content, v.label
      FROM memory_entries m
      JOIN vector_mappings v ON m.id = v.entry_id
      WHERE m.pending_embedding = 1
    `).all() as Array<{ id: string; content: string; label: number }>;
  }

  /**
   * Clear pending embedding flag for multiple entries
   */
  clearPendingEmbedding(entryIds: string[]): void {
    if (entryIds.length === 0) return;
    const placeholders = entryIds.map(() => '?').join(',');
    this.db.prepare(`
      UPDATE memory_entries SET pending_embedding = 0 WHERE id IN (${placeholders})
    `).run(...entryIds);
  }

  /**
   * Get count of pending embeddings
   */
  getPendingEmbeddingCount(): number {
    const result = this.db.prepare(`
      SELECT COUNT(*) as count FROM memory_entries WHERE pending_embedding = 1
    `).get() as { count: number };
    return result.count;
  }

  close(): void {
    this.db.close();
  }

  /**
   * Get raw database connection for advanced operations
   * Used by learning modules that need direct SQL access
   */
  getDb(): Database.Database {
    return this.db;
  }
}

// Row types for SQLite results
interface EntryRow {
  id: string;
  content: string;
  source: string;
  importance: number;
  session_id: string | null;
  agent_id: string | null;
  context: string | null;
  created_at: string;
  updated_at: string;
}

interface ProvenanceRow {
  entry_id: string;
  lineage_depth: number;
  confidence: number;
  relevance: number;
  l_score: number | null;
}

interface CausalRelationRow {
  id: string;
  type: string;
  strength: number;
  metadata: string | null;
  created_at: string;
  ttl: number | null;
  expires_at: string | null;
}

interface PatternTemplateRow {
  id: string;
  name: string;
  pattern: string;
  slots: string;
  priority: number;
  created_at: string;
}

interface PatternStatsRow {
  pattern_id: string;
  use_count: number;
  success_count: number;
  last_used_at: string | null;
  success_rate: number;
}

interface VectorAccessRow {
  label: number;
  access_count: number;
  last_accessed_at: string | null;
  compression_tier: string;
}
