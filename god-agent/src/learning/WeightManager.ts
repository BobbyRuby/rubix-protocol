/**
 * Weight Manager
 *
 * Manages LoRA-style weights for patterns/entries.
 * Weights adjust retrieval ranking based on historical success.
 *
 * LoRA-style means:
 * - Small delta weights on top of base similarity scores
 * - Efficient storage (only store non-default weights)
 * - Gradual updates based on feedback
 */

import type { SQLiteStorage } from '../storage/SQLiteStorage.js';
import type { PatternWeight, WeightCheckpoint } from './types.js';

const DEFAULT_WEIGHT = 0.5;
const DEFAULT_IMPORTANCE = 0.0;

export class WeightManager {
  private storage: SQLiteStorage;
  private initialized: boolean = false;
  private baselineWeights: Map<string, number> | null = null;

  constructor(storage: SQLiteStorage) {
    this.storage = storage;
  }

  /**
   * Initialize weight tables
   */
  initialize(): void {
    if (this.initialized) return;

    const db = this.storage.getDb();

    // Create pattern weights table
    db.exec(`
      CREATE TABLE IF NOT EXISTS pattern_weights (
        pattern_id TEXT PRIMARY KEY,
        weight REAL DEFAULT ${DEFAULT_WEIGHT},
        importance REAL DEFAULT ${DEFAULT_IMPORTANCE},
        use_count INTEGER DEFAULT 0,
        success_count INTEGER DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create weight checkpoints table
    db.exec(`
      CREATE TABLE IF NOT EXISTS weight_checkpoints (
        id TEXT PRIMARY KEY,
        weights_json TEXT NOT NULL,
        drift_score REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create indices
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_weights_weight ON pattern_weights(weight);
      CREATE INDEX IF NOT EXISTS idx_checkpoints_created ON weight_checkpoints(created_at);
    `);

    this.initialized = true;

    // Initialize baseline if not set
    if (!this.baselineWeights) {
      this.captureBaseline();
    }
  }

  /**
   * Get weight for a pattern (returns default if not tracked)
   */
  getWeight(patternId: string): number {
    this.ensureInitialized();

    const db = this.storage.getDb();
    const stmt = db.prepare('SELECT weight FROM pattern_weights WHERE pattern_id = ?');
    const row = stmt.get(patternId) as { weight: number } | undefined;

    return row?.weight ?? DEFAULT_WEIGHT;
  }

  /**
   * Get full weight entry for a pattern
   */
  getPatternWeight(patternId: string): PatternWeight | null {
    this.ensureInitialized();

    const db = this.storage.getDb();
    const stmt = db.prepare('SELECT * FROM pattern_weights WHERE pattern_id = ?');
    const row = stmt.get(patternId) as {
      pattern_id: string;
      weight: number;
      importance: number;
      use_count: number;
      success_count: number;
      updated_at: string;
    } | undefined;

    if (!row) return null;

    return {
      patternId: row.pattern_id,
      weight: row.weight,
      importance: row.importance,
      useCount: row.use_count,
      successCount: row.success_count,
      successRate: row.use_count > 0 ? row.success_count / row.use_count : 0,
      updatedAt: new Date(row.updated_at)
    };
  }

  /**
   * Update weight for a pattern
   */
  updateWeight(patternId: string, newWeight: number): void {
    this.ensureInitialized();

    const db = this.storage.getDb();
    const now = new Date().toISOString();

    // Clamp weight to [0, 1]
    const clampedWeight = Math.max(0, Math.min(1, newWeight));

    const stmt = db.prepare(`
      INSERT INTO pattern_weights (pattern_id, weight, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(pattern_id) DO UPDATE SET
        weight = excluded.weight,
        updated_at = excluded.updated_at
    `);
    stmt.run(patternId, clampedWeight, now);
  }

  /**
   * Update importance for a pattern (EWC++ Fisher information)
   */
  updateImportance(patternId: string, importance: number): void {
    this.ensureInitialized();

    const db = this.storage.getDb();
    const now = new Date().toISOString();

    const stmt = db.prepare(`
      INSERT INTO pattern_weights (pattern_id, importance, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(pattern_id) DO UPDATE SET
        importance = excluded.importance,
        updated_at = excluded.updated_at
    `);
    stmt.run(patternId, importance, now);
  }

  /**
   * Record a use of a pattern (success or not)
   */
  recordUse(patternId: string, success: boolean): void {
    this.ensureInitialized();

    const db = this.storage.getDb();
    const now = new Date().toISOString();

    // Ensure pattern exists
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO pattern_weights (pattern_id, updated_at)
      VALUES (?, ?)
    `);
    insertStmt.run(patternId, now);

    // Update counts
    if (success) {
      const updateStmt = db.prepare(`
        UPDATE pattern_weights
        SET use_count = use_count + 1,
            success_count = success_count + 1,
            updated_at = ?
        WHERE pattern_id = ?
      `);
      updateStmt.run(now, patternId);
    } else {
      const updateStmt = db.prepare(`
        UPDATE pattern_weights
        SET use_count = use_count + 1,
            updated_at = ?
        WHERE pattern_id = ?
      `);
      updateStmt.run(now, patternId);
    }
  }

  /**
   * Get all weights as a map
   */
  getAllWeights(): Map<string, PatternWeight> {
    this.ensureInitialized();

    const db = this.storage.getDb();
    const stmt = db.prepare('SELECT * FROM pattern_weights');
    const rows = stmt.all() as Array<{
      pattern_id: string;
      weight: number;
      importance: number;
      use_count: number;
      success_count: number;
      updated_at: string;
    }>;

    const weights = new Map<string, PatternWeight>();
    for (const row of rows) {
      weights.set(row.pattern_id, {
        patternId: row.pattern_id,
        weight: row.weight,
        importance: row.importance,
        useCount: row.use_count,
        successCount: row.success_count,
        successRate: row.use_count > 0 ? row.success_count / row.use_count : 0,
        updatedAt: new Date(row.updated_at)
      });
    }

    return weights;
  }

  /**
   * Get all weights as a vector (for drift calculation)
   */
  getAllAsVector(): number[] {
    const weights = this.getAllWeights();
    return Array.from(weights.values()).map(w => w.weight);
  }

  /**
   * Capture current weights as baseline
   */
  captureBaseline(): void {
    this.ensureInitialized();

    const weights = this.getAllWeights();
    this.baselineWeights = new Map();
    for (const [id, pw] of weights) {
      this.baselineWeights.set(id, pw.weight);
    }
  }

  /**
   * Get baseline weights
   */
  getBaseline(): number[] {
    if (!this.baselineWeights || this.baselineWeights.size === 0) {
      return [DEFAULT_WEIGHT]; // Default if no baseline
    }
    return Array.from(this.baselineWeights.values());
  }

  /**
   * Create a checkpoint of current weights
   */
  createCheckpoint(driftScore: number = 0): string {
    this.ensureInitialized();

    const id = `checkpoint_${Date.now()}`;
    const weights = this.getAllWeights();
    const weightsJson = JSON.stringify(Array.from(weights.entries()));

    const db = this.storage.getDb();
    const stmt = db.prepare(`
      INSERT INTO weight_checkpoints (id, weights_json, drift_score, created_at)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(id, weightsJson, driftScore, new Date().toISOString());

    return id;
  }

  /**
   * Restore weights from checkpoint
   */
  restoreFromCheckpoint(checkpointId: string): boolean {
    this.ensureInitialized();

    const db = this.storage.getDb();
    const stmt = db.prepare('SELECT weights_json FROM weight_checkpoints WHERE id = ?');
    const row = stmt.get(checkpointId) as { weights_json: string } | undefined;

    if (!row) return false;

    const entries = JSON.parse(row.weights_json) as Array<[string, PatternWeight]>;

    // Clear current weights
    db.exec('DELETE FROM pattern_weights');

    // Restore from checkpoint
    const insertStmt = db.prepare(`
      INSERT INTO pattern_weights (pattern_id, weight, importance, use_count, success_count, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const [_, pw] of entries) {
      insertStmt.run(
        pw.patternId,
        pw.weight,
        pw.importance,
        pw.useCount,
        pw.successCount,
        pw.updatedAt.toString()
      );
    }

    return true;
  }

  /**
   * Get most recent checkpoint
   */
  getLatestCheckpoint(): WeightCheckpoint | null {
    this.ensureInitialized();

    const db = this.storage.getDb();
    const stmt = db.prepare(`
      SELECT * FROM weight_checkpoints ORDER BY created_at DESC LIMIT 1
    `);
    const row = stmt.get() as {
      id: string;
      weights_json: string;
      drift_score: number;
      created_at: string;
    } | undefined;

    if (!row) return null;

    const entries = JSON.parse(row.weights_json) as Array<[string, PatternWeight]>;
    const weights = new Map<string, PatternWeight>();
    for (const [id, pw] of entries) {
      weights.set(id, pw);
    }

    return {
      id: row.id,
      createdAt: new Date(row.created_at),
      weights,
      driftScore: row.drift_score
    };
  }

  /**
   * Get patterns that should be pruned (low success rate)
   */
  getPruneCandidates(threshold: number, minUses: number): PatternWeight[] {
    this.ensureInitialized();

    const db = this.storage.getDb();
    const stmt = db.prepare(`
      SELECT * FROM pattern_weights
      WHERE use_count >= ?
        AND CAST(success_count AS REAL) / use_count < ?
    `);
    const rows = stmt.all(minUses, threshold) as Array<{
      pattern_id: string;
      weight: number;
      importance: number;
      use_count: number;
      success_count: number;
      updated_at: string;
    }>;

    return rows.map(row => ({
      patternId: row.pattern_id,
      weight: row.weight,
      importance: row.importance,
      useCount: row.use_count,
      successCount: row.success_count,
      successRate: row.use_count > 0 ? row.success_count / row.use_count : 0,
      updatedAt: new Date(row.updated_at)
    }));
  }

  /**
   * Get patterns that should be boosted (high success rate)
   */
  getBoostCandidates(threshold: number, minUses: number): PatternWeight[] {
    this.ensureInitialized();

    const db = this.storage.getDb();
    const stmt = db.prepare(`
      SELECT * FROM pattern_weights
      WHERE use_count >= ?
        AND CAST(success_count AS REAL) / use_count >= ?
    `);
    const rows = stmt.all(minUses, threshold) as Array<{
      pattern_id: string;
      weight: number;
      importance: number;
      use_count: number;
      success_count: number;
      updated_at: string;
    }>;

    return rows.map(row => ({
      patternId: row.pattern_id,
      weight: row.weight,
      importance: row.importance,
      useCount: row.use_count,
      successCount: row.success_count,
      successRate: row.use_count > 0 ? row.success_count / row.use_count : 0,
      updatedAt: new Date(row.updated_at)
    }));
  }

  /**
   * Delete a pattern weight (for pruning)
   */
  deletePattern(patternId: string): boolean {
    this.ensureInitialized();

    const db = this.storage.getDb();
    const stmt = db.prepare('DELETE FROM pattern_weights WHERE pattern_id = ?');
    const result = stmt.run(patternId);

    return result.changes > 0;
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalPatterns: number;
    avgWeight: number;
    avgSuccessRate: number;
    checkpointCount: number;
  } {
    this.ensureInitialized();

    const db = this.storage.getDb();

    const countStmt = db.prepare('SELECT COUNT(*) as count FROM pattern_weights');
    const totalPatterns = (countStmt.get() as { count: number }).count;

    const avgWeightStmt = db.prepare('SELECT AVG(weight) as avg FROM pattern_weights');
    const avgWeight = (avgWeightStmt.get() as { avg: number | null }).avg ?? DEFAULT_WEIGHT;

    const avgSuccessStmt = db.prepare(`
      SELECT AVG(CAST(success_count AS REAL) / NULLIF(use_count, 0)) as avg
      FROM pattern_weights WHERE use_count > 0
    `);
    const avgSuccessRate = (avgSuccessStmt.get() as { avg: number | null }).avg ?? 0;

    const checkpointStmt = db.prepare('SELECT COUNT(*) as count FROM weight_checkpoints');
    const checkpointCount = (checkpointStmt.get() as { count: number }).count;

    return {
      totalPatterns,
      avgWeight,
      avgSuccessRate,
      checkpointCount
    };
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      this.initialize();
    }
  }
}
