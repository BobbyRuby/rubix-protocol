/**
 * Vector Database with sqlite-vec
 *
 * ACID-safe vector storage and KNN search using sqlite-vec extension.
 * Replaces the previous JSON/HNSW implementation with crash-proof SQLite storage.
 *
 * Features:
 * - sqlite-vec based nearest neighbor search (cosine distance)
 * - 768-dimension validation (embedding boundary assertion)
 * - L2-normalization validation and auto-correction
 * - ACID persistence via SQLite WAL (no manual save/load)
 * - Auto-migration from legacy vectors.hnsw JSON files
 */

import { existsSync, readFileSync, renameSync } from 'fs';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import type { VectorDBConfig, VectorSearchResult } from './types.js';

// L2 norm tolerance for validation (vectors should be unit length)
const L2_NORM_TOLERANCE = 0.01;

export class VectorDB {
  private config: VectorDBConfig;
  private db: Database.Database;
  private initialized: boolean = false;

  // Cached prepared statements
  private stmtInsert!: Database.Statement;
  private stmtSearch!: Database.Statement;
  private stmtDelete!: Database.Statement;
  private stmtHas!: Database.Statement;
  private stmtGetVector!: Database.Statement;
  private stmtCount!: Database.Statement;

  constructor(config: VectorDBConfig, db?: Database.Database) {
    this.config = config;
    if (db) {
      this.db = db;
    } else {
      // Standalone mode — create in-memory DB (for tests)
      this.db = new Database(':memory:');
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Load sqlite-vec extension
    sqliteVec.load(this.db);

    // Create virtual table for vector storage
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_vectors
      USING vec0(embedding float[${this.config.dimensions}] distance_metric=cosine)
    `);

    // Prepare cached statements
    this.prepareStatements();

    this.initialized = true;
  }

  private prepareStatements(): void {
    this.stmtInsert = this.db.prepare(
      'INSERT INTO vec_vectors(rowid, embedding) VALUES (?, ?)'
    );
    this.stmtSearch = this.db.prepare(
      'SELECT rowid, distance FROM vec_vectors WHERE embedding MATCH ? AND k = ? ORDER BY distance'
    );
    this.stmtDelete = this.db.prepare(
      'DELETE FROM vec_vectors WHERE rowid = ?'
    );
    this.stmtHas = this.db.prepare(
      'SELECT 1 FROM vec_vectors WHERE rowid = ?'
    );
    this.stmtGetVector = this.db.prepare(
      'SELECT embedding FROM vec_vectors WHERE rowid = ?'
    );
    this.stmtCount = this.db.prepare(
      'SELECT count(*) as cnt FROM vec_vectors'
    );
  }

  /**
   * Validate vector dimensions (768-dim assertion at ingestion boundary)
   */
  private assertDimensions(vector: Float32Array | number[]): void {
    if (vector.length !== this.config.dimensions) {
      throw new Error(
        `Vector dimension mismatch: expected ${this.config.dimensions}, got ${vector.length}. ` +
        `Ensure embeddings are ${this.config.dimensions}-dimensional.`
      );
    }
  }

  /**
   * Validate L2 normalization (vectors should be unit length for cosine similarity)
   */
  private validateL2Norm(vector: Float32Array | number[]): { isValid: boolean; norm: number } {
    let sumSquares = 0;
    for (let i = 0; i < vector.length; i++) {
      sumSquares += vector[i] * vector[i];
    }
    const norm = Math.sqrt(sumSquares);
    const isValid = Math.abs(norm - 1.0) <= L2_NORM_TOLERANCE;
    return { isValid, norm };
  }

  /**
   * Normalize a vector to unit length, returning Float32Array
   */
  private normalizeVector(vector: Float32Array | number[]): Float32Array {
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

  /**
   * Convert Float32Array to Buffer for sqlite-vec BLOB storage
   */
  private float32ToBuffer(arr: Float32Array): Buffer {
    return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
  }

  add(label: number, vector: Float32Array): void {
    if (!this.initialized) {
      throw new Error('VectorDB not initialized. Call initialize() first.');
    }

    this.assertDimensions(vector);

    const { isValid } = this.validateL2Norm(vector);
    const normalized = isValid ? vector : this.normalizeVector(vector);

    this.stmtInsert.run(BigInt(label), this.float32ToBuffer(normalized));
  }

  search(vector: Float32Array, k: number): VectorSearchResult[] {
    if (!this.initialized) {
      throw new Error('VectorDB not initialized. Call initialize() first.');
    }

    this.assertDimensions(vector);

    const normalized = this.normalizeVector(vector);
    const rows = this.stmtSearch.all(this.float32ToBuffer(normalized), k) as Array<{ rowid: number | bigint; distance: number }>;

    return rows.map(r => ({
      id: '',  // Resolved by caller using vector_mappings
      label: Number(r.rowid),
      distance: r.distance,
      score: 1 - r.distance
    }));
  }

  delete(label: number): boolean {
    if (!this.initialized) return false;

    const result = this.stmtDelete.run(BigInt(label));
    return result.changes > 0;
  }

  update(label: number, vector: Float32Array): boolean {
    if (!this.initialized) {
      throw new Error('VectorDB not initialized. Call initialize() first.');
    }

    this.assertDimensions(vector);

    if (!this.has(label)) {
      return false;
    }

    const { isValid } = this.validateL2Norm(vector);
    const normalized = isValid ? vector : this.normalizeVector(vector);

    // sqlite-vec doesn't support in-place update; delete + re-insert
    this.stmtDelete.run(BigInt(label));
    this.stmtInsert.run(BigInt(label), this.float32ToBuffer(normalized));
    return true;
  }

  has(label: number): boolean {
    if (!this.initialized) return false;
    const row = this.stmtHas.get(BigInt(label));
    return row !== undefined;
  }

  getVector(label: number): Float32Array | null {
    if (!this.initialized) return null;

    const row = this.stmtGetVector.get(BigInt(label)) as { embedding: Buffer } | undefined;
    if (!row) return null;

    // Convert Buffer back to Float32Array
    const buf = row.embedding;
    return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  }

  getCount(): number {
    if (!this.initialized) return 0;
    const row = this.stmtCount.get() as { cnt: number };
    return row.cnt;
  }

  getMaxElements(): number {
    return this.config.maxElements;
  }

  getDimensions(): number {
    return this.config.dimensions;
  }

  clear(): void {
    if (!this.initialized) return;

    this.db.exec('DROP TABLE IF EXISTS vec_vectors');
    this.db.exec(`
      CREATE VIRTUAL TABLE vec_vectors
      USING vec0(embedding float[${this.config.dimensions}] distance_metric=cosine)
    `);
    this.prepareStatements();
  }

  // No-ops: sqlite-vec auto-persists via SQLite WAL
  async save(): Promise<void> { /* no-op */ }
  async load(): Promise<void> { /* no-op */ }
  setEfSearch(_ef: number): void { /* no-op */ }

  isUsingHNSW(): boolean {
    return false;
  }

  getStats(): {
    currentCount: number;
    maxElements: number;
    dimensions: number;
    searchMode: 'sqlite-vec';
  } {
    return {
      currentCount: this.getCount(),
      maxElements: this.config.maxElements,
      dimensions: this.config.dimensions,
      searchMode: 'sqlite-vec'
    };
  }

  /**
   * Migrate vectors from legacy vectors.hnsw JSON file.
   * Called once during initialize() if the file exists.
   */
  migrateFromHNSW(hnswPath: string): { migrated: number; skipped: boolean } {
    if (!existsSync(hnswPath)) {
      return { migrated: 0, skipped: true };
    }

    // If vec_vectors already has data, skip migration and just rename the file
    const existing = this.getCount();
    if (existing > 0) {
      console.log(`[VectorDB] vec_vectors already has ${existing} vectors, skipping HNSW migration`);
      try {
        renameSync(hnswPath, hnswPath + '.migrated');
      } catch { /* ignore rename errors */ }
      return { migrated: 0, skipped: true };
    }

    let content: string;
    try {
      content = readFileSync(hnswPath, 'utf-8').trim();
      if (!content) {
        console.warn('[VectorDB] HNSW file is empty, skipping migration');
        try { renameSync(hnswPath, hnswPath + '.migrated'); } catch { /* ignore */ }
        return { migrated: 0, skipped: true };
      }
    } catch (err) {
      console.warn('[VectorDB] Failed to read HNSW file, skipping migration:', err);
      return { migrated: 0, skipped: true };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      console.warn('[VectorDB] HNSW file is corrupted JSON, skipping migration:', err);
      try { renameSync(hnswPath, hnswPath + '.corrupted'); } catch { /* ignore */ }
      return { migrated: 0, skipped: true };
    }

    // Extract vectors from all 3 legacy formats
    const vectors: Array<{ label: number; vector: number[] }> = [];

    if (Array.isArray(parsed)) {
      // Legacy brute-force format: [{label, vector}]
      for (const item of parsed as Array<{ label: number; vector: number[] }>) {
        if (item.label !== undefined && Array.isArray(item.vector)) {
          vectors.push(item);
        }
      }
    } else if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      if (obj.type === 'hnsw' && obj.data && typeof obj.data === 'object') {
        // HNSW serialized format: {type:'hnsw', data:{nodes:[{id, vector}]}}
        const data = obj.data as Record<string, unknown>;
        if (Array.isArray(data.nodes)) {
          for (const node of data.nodes as Array<{ id: number; vector: number[] }>) {
            if (node.id !== undefined && Array.isArray(node.vector)) {
              vectors.push({ label: node.id, vector: node.vector });
            }
          }
        }
      } else if (obj.type === 'brute-force' && Array.isArray(obj.data)) {
        // Brute-force wrapped: {type:'brute-force', data:[{label, vector}]}
        for (const item of obj.data as Array<{ label: number; vector: number[] }>) {
          if (item.label !== undefined && Array.isArray(item.vector)) {
            vectors.push(item);
          }
        }
      }
    }

    if (vectors.length === 0) {
      console.log('[VectorDB] No vectors found in HNSW file');
      try { renameSync(hnswPath, hnswPath + '.migrated'); } catch { /* ignore */ }
      return { migrated: 0, skipped: true };
    }

    console.log(`[VectorDB] Migrating ${vectors.length} vectors from HNSW to sqlite-vec...`);

    // Batch INSERT in a transaction
    let migrated = 0;
    const insertTxn = this.db.transaction(() => {
      for (const { label, vector } of vectors) {
        if (vector.length !== this.config.dimensions) {
          console.warn(`[VectorDB] Skipping vector ${label}: dimension mismatch (${vector.length} != ${this.config.dimensions})`);
          continue;
        }
        const f32 = new Float32Array(vector);
        const normalized = this.normalizeVector(f32);
        try {
          this.stmtInsert.run(BigInt(label), this.float32ToBuffer(normalized));
          migrated++;
        } catch (err) {
          console.warn(`[VectorDB] Failed to migrate vector ${label}:`, err);
        }
      }
    });
    insertTxn();

    console.log(`[VectorDB] Migration complete: ${migrated}/${vectors.length} vectors migrated`);

    // Rename the old file
    try {
      renameSync(hnswPath, hnswPath + '.migrated');
      console.log(`[VectorDB] Renamed ${hnswPath} → ${hnswPath}.migrated`);
    } catch { /* ignore rename errors */ }

    return { migrated, skipped: false };
  }
}
