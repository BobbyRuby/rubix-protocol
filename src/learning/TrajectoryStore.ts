/**
 * Trajectory Store
 *
 * Persists trajectories (query→patterns→outcome chains) for learning.
 * Uses SQLite for storage.
 */

import { v4 as uuidv4 } from 'uuid';
import type { SQLiteStorage } from '../storage/SQLiteStorage.js';
import type { Trajectory, TrajectoryFeedback } from './types.js';

export class TrajectoryStore {
  private storage: SQLiteStorage;
  private initialized: boolean = false;

  constructor(storage: SQLiteStorage) {
    this.storage = storage;
  }

  /**
   * Initialize trajectory tables
   */
  initialize(): void {
    if (this.initialized) return;

    const db = this.storage.getDb();

    // Create trajectories table
    db.exec(`
      CREATE TABLE IF NOT EXISTS trajectories (
        id TEXT PRIMARY KEY,
        query TEXT NOT NULL,
        query_embedding BLOB,
        matched_ids TEXT NOT NULL,
        match_scores TEXT NOT NULL,
        route TEXT,
        has_feedback INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create feedback table
    db.exec(`
      CREATE TABLE IF NOT EXISTS trajectory_feedback (
        id TEXT PRIMARY KEY,
        trajectory_id TEXT NOT NULL,
        quality REAL NOT NULL,
        route TEXT,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (trajectory_id) REFERENCES trajectories(id)
      )
    `);

    // Create indices
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_trajectories_created_at ON trajectories(created_at);
      CREATE INDEX IF NOT EXISTS idx_trajectories_has_feedback ON trajectories(has_feedback);
      CREATE INDEX IF NOT EXISTS idx_feedback_trajectory_id ON trajectory_feedback(trajectory_id);
    `);

    this.initialized = true;
  }

  /**
   * Create a new trajectory
   */
  createTrajectory(
    query: string,
    matchedIds: string[],
    matchScores: number[],
    queryEmbedding?: Float32Array,
    route?: string
  ): Trajectory {
    this.ensureInitialized();

    const id = uuidv4();
    const now = new Date();

    const db = this.storage.getDb();
    const stmt = db.prepare(`
      INSERT INTO trajectories (id, query, query_embedding, matched_ids, match_scores, route, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      query,
      queryEmbedding ? Buffer.from(queryEmbedding.buffer) : null,
      JSON.stringify(matchedIds),
      JSON.stringify(matchScores),
      route ?? null,
      now.toISOString()
    );

    return {
      id,
      query,
      queryEmbedding,
      matchedIds,
      matchScores,
      route,
      createdAt: now,
      hasFeedback: false
    };
  }

  /**
   * Get a trajectory by ID
   */
  getTrajectory(id: string): Trajectory | null {
    this.ensureInitialized();

    const db = this.storage.getDb();
    const stmt = db.prepare('SELECT * FROM trajectories WHERE id = ?');
    const row = stmt.get(id) as {
      id: string;
      query: string;
      query_embedding: Buffer | null;
      matched_ids: string;
      match_scores: string;
      route: string | null;
      has_feedback: number;
      created_at: string;
    } | undefined;

    if (!row) return null;

    return {
      id: row.id,
      query: row.query,
      queryEmbedding: row.query_embedding
        ? new Float32Array(row.query_embedding.buffer.slice(
            row.query_embedding.byteOffset,
            row.query_embedding.byteOffset + row.query_embedding.byteLength
          ))
        : undefined,
      matchedIds: JSON.parse(row.matched_ids),
      matchScores: JSON.parse(row.match_scores),
      route: row.route ?? undefined,
      createdAt: new Date(row.created_at),
      hasFeedback: row.has_feedback === 1
    };
  }

  /**
   * Store feedback for a trajectory
   */
  storeFeedback(
    trajectoryId: string,
    quality: number,
    route?: string,
    notes?: string
  ): TrajectoryFeedback {
    this.ensureInitialized();

    const id = uuidv4();
    const now = new Date();

    const db = this.storage.getDb();

    // Insert feedback
    const insertStmt = db.prepare(`
      INSERT INTO trajectory_feedback (id, trajectory_id, quality, route, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insertStmt.run(id, trajectoryId, quality, route ?? null, notes ?? null, now.toISOString());

    // Update trajectory has_feedback flag
    const updateStmt = db.prepare('UPDATE trajectories SET has_feedback = 1 WHERE id = ?');
    updateStmt.run(trajectoryId);

    return {
      trajectoryId,
      quality,
      route,
      createdAt: now,
      notes
    };
  }

  /**
   * Get feedback for a trajectory
   */
  getFeedback(trajectoryId: string): TrajectoryFeedback[] {
    this.ensureInitialized();

    const db = this.storage.getDb();
    const stmt = db.prepare(`
      SELECT * FROM trajectory_feedback WHERE trajectory_id = ? ORDER BY created_at DESC
    `);
    const rows = stmt.all(trajectoryId) as Array<{
      id: string;
      trajectory_id: string;
      quality: number;
      route: string | null;
      notes: string | null;
      created_at: string;
    }>;

    return rows.map(row => ({
      trajectoryId: row.trajectory_id,
      quality: row.quality,
      route: row.route ?? undefined,
      notes: row.notes ?? undefined,
      createdAt: new Date(row.created_at)
    }));
  }

  /**
   * Get recent trajectories without feedback
   */
  getPendingFeedback(limit: number = 10): Trajectory[] {
    this.ensureInitialized();

    const db = this.storage.getDb();
    const stmt = db.prepare(`
      SELECT * FROM trajectories
      WHERE has_feedback = 0
      ORDER BY created_at DESC
      LIMIT ?
    `);
    const rows = stmt.all(limit) as Array<{
      id: string;
      query: string;
      query_embedding: Buffer | null;
      matched_ids: string;
      match_scores: string;
      route: string | null;
      has_feedback: number;
      created_at: string;
    }>;

    return rows.map(row => ({
      id: row.id,
      query: row.query,
      queryEmbedding: row.query_embedding
        ? new Float32Array(row.query_embedding.buffer.slice(
            row.query_embedding.byteOffset,
            row.query_embedding.byteOffset + row.query_embedding.byteLength
          ))
        : undefined,
      matchedIds: JSON.parse(row.matched_ids),
      matchScores: JSON.parse(row.match_scores),
      route: row.route ?? undefined,
      createdAt: new Date(row.created_at),
      hasFeedback: false
    }));
  }

  /**
   * Get statistics
   */
  getStats(): { total: number; withFeedback: number; avgQuality: number } {
    this.ensureInitialized();

    const db = this.storage.getDb();

    const totalStmt = db.prepare('SELECT COUNT(*) as count FROM trajectories');
    const total = (totalStmt.get() as { count: number }).count;

    const feedbackStmt = db.prepare('SELECT COUNT(*) as count FROM trajectories WHERE has_feedback = 1');
    const withFeedback = (feedbackStmt.get() as { count: number }).count;

    const avgStmt = db.prepare('SELECT AVG(quality) as avg FROM trajectory_feedback');
    const avgQuality = (avgStmt.get() as { avg: number | null }).avg ?? 0;

    return { total, withFeedback, avgQuality };
  }

  /**
   * Delete old trajectories (cleanup)
   */
  cleanup(olderThanDays: number = 30): number {
    this.ensureInitialized();

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - olderThanDays);

    const db = this.storage.getDb();

    // Delete old feedback first (foreign key)
    const deleteFeedbackStmt = db.prepare(`
      DELETE FROM trajectory_feedback
      WHERE trajectory_id IN (
        SELECT id FROM trajectories WHERE created_at < ?
      )
    `);
    deleteFeedbackStmt.run(cutoff.toISOString());

    // Delete old trajectories
    const deleteTrajectoryStmt = db.prepare('DELETE FROM trajectories WHERE created_at < ?');
    const result = deleteTrajectoryStmt.run(cutoff.toISOString());

    return result.changes;
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      this.initialize();
    }
  }
}
