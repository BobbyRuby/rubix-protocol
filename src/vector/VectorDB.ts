/**
 * Vector Database with HNSW Search
 *
 * High-performance vector storage and search using HNSW (Hierarchical Navigable
 * Small World) algorithm. Achieves O(log n) search complexity compared to O(n)
 * brute-force, providing ~10-50x speedup for 10k+ vectors.
 *
 * Features:
 * - HNSW-based approximate nearest neighbor search
 * - 768-dimension validation (embedding boundary assertion)
 * - L2-normalization validation
 * - Automatic fallback to brute-force if HNSW fails
 * - JSON persistence (HNSW graph structure preserved)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { VectorDBConfig, VectorSearchResult } from './types.js';
import { HNSWIndex } from './HNSWIndex.js';

interface StoredVector {
  label: number;
  vector: number[];
}

// L2 norm tolerance for validation (vectors should be unit length)
const L2_NORM_TOLERANCE = 0.01;
const EXPECTED_DIMENSIONS = 768;

export class VectorDB {
  private config: VectorDBConfig;
  private hnswIndex: HNSWIndex | null = null;
  private bruteForceVectors: Map<number, number[]> = new Map(); // Fallback storage
  private useHNSW: boolean = true;
  private initialized: boolean = false;

  constructor(config: VectorDBConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Initialize HNSW index
      this.hnswIndex = new HNSWIndex({
        dimensions: this.config.dimensions,
        maxElements: this.config.maxElements,
        M: this.config.M,
        efConstruction: this.config.efConstruction,
        efSearch: this.config.efSearch,
      });

      // Load existing data if available
      if (existsSync(this.config.indexPath)) {
        await this.load();
      }

      this.useHNSW = true;
    } catch (error) {
      console.warn('HNSW initialization failed, falling back to brute-force:', error);
      this.useHNSW = false;

      // Load brute-force fallback data if available
      if (existsSync(this.config.indexPath)) {
        await this.loadBruteForce();
      }
    }

    this.initialized = true;
  }

  /**
   * Validate vector dimensions (768-dim assertion at ingestion boundary)
   */
  private assertDimensions(vector: Float32Array | number[]): void {
    if (vector.length !== this.config.dimensions) {
      throw new Error(
        `Vector dimension mismatch: expected ${this.config.dimensions}, got ${vector.length}. ` +
        `Ensure embeddings are ${EXPECTED_DIMENSIONS}-dimensional.`
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
   * Normalize a vector to unit length
   */
  private normalizeVector(vector: Float32Array | number[]): number[] {
    const arr = Array.isArray(vector) ? vector : Array.from(vector);
    let sumSquares = 0;
    for (let i = 0; i < arr.length; i++) {
      sumSquares += arr[i] * arr[i];
    }
    const norm = Math.sqrt(sumSquares);
    if (norm === 0) return arr;
    return arr.map(v => v / norm);
  }

  add(label: number, vector: Float32Array): void {
    if (!this.initialized) {
      throw new Error('VectorDB not initialized. Call initialize() first.');
    }

    // Validate dimensions (768-dim assertion)
    this.assertDimensions(vector);

    // Validate and optionally fix L2 normalization
    const { isValid } = this.validateL2Norm(vector);
    let normalizedVector: number[];

    if (!isValid) {
      // Auto-normalize if not already unit length
      normalizedVector = this.normalizeVector(vector);
    } else {
      normalizedVector = Array.from(vector);
    }

    if (this.useHNSW && this.hnswIndex) {
      try {
        this.hnswIndex.add(label, normalizedVector);
      } catch (error) {
        console.warn('HNSW add failed, using brute-force fallback:', error);
        this.bruteForceVectors.set(label, normalizedVector);
      }
    } else {
      this.bruteForceVectors.set(label, normalizedVector);
    }
  }

  search(vector: Float32Array, k: number): VectorSearchResult[] {
    if (!this.initialized) {
      throw new Error('VectorDB not initialized. Call initialize() first.');
    }

    // Validate dimensions
    this.assertDimensions(vector);

    // Normalize query vector
    const normalizedQuery = this.normalizeVector(vector);

    if (this.useHNSW && this.hnswIndex && this.hnswIndex.getCount() > 0) {
      try {
        const results = this.hnswIndex.search(normalizedQuery, k);
        return results.map(r => ({
          id: '', // Will be resolved by the caller using vector_mappings
          label: r.label,
          distance: r.distance,
          score: r.score
        }));
      } catch (error) {
        console.warn('HNSW search failed, using brute-force fallback:', error);
        return this.bruteForceSearch(normalizedQuery, k);
      }
    }

    // Brute-force fallback
    return this.bruteForceSearch(normalizedQuery, k);
  }

  private bruteForceSearch(queryVector: number[], k: number): VectorSearchResult[] {
    if (this.bruteForceVectors.size === 0) {
      return [];
    }

    const results: Array<{ label: number; distance: number; score: number }> = [];

    for (const [label, storedVector] of this.bruteForceVectors.entries()) {
      const score = this.cosineSimilarity(queryVector, storedVector);
      const distance = 1 - score;
      results.push({ label, distance, score });
    }

    results.sort((a, b) => b.score - a.score);
    const topK = results.slice(0, Math.min(k, results.length));

    return topK.map(r => ({
      id: '',
      label: r.label,
      distance: r.distance,
      score: r.score
    }));
  }

  /**
   * Retrieve a stored vector by its label
   */
  getVector(label: number): Float32Array | null {
    if (this.useHNSW && this.hnswIndex) {
      const vec = this.hnswIndex.getVector(label);
      if (vec) return new Float32Array(vec);
    }
    const bfVec = this.bruteForceVectors.get(label);
    if (bfVec) return new Float32Array(bfVec);
    return null;
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have same dimensions');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    if (magnitude === 0) return 0;

    return dotProduct / magnitude;
  }

  async save(): Promise<void> {
    if (!this.initialized) {
      throw new Error('VectorDB not initialized. Call initialize() first.');
    }

    const dir = dirname(this.config.indexPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    if (this.useHNSW && this.hnswIndex) {
      // Save HNSW index (preserves graph structure)
      const serialized = this.hnswIndex.serialize();
      writeFileSync(
        this.config.indexPath,
        JSON.stringify({
          type: 'hnsw',
          data: serialized
        })
      );
    } else {
      // Save brute-force data
      const data: StoredVector[] = [];
      for (const [label, vector] of this.bruteForceVectors.entries()) {
        data.push({ label, vector });
      }
      writeFileSync(
        this.config.indexPath,
        JSON.stringify({
          type: 'brute-force',
          data
        })
      );
    }
  }

  async load(): Promise<void> {
    if (!existsSync(this.config.indexPath)) {
      throw new Error(`Index file not found: ${this.config.indexPath}`);
    }

    const content = readFileSync(this.config.indexPath, 'utf-8').trim();
    if (!content) {
      // Empty file - treat as no data (will be recreated on next save)
      console.warn(`VectorDB: Index file is empty, will rebuild: ${this.config.indexPath}`);
      return;
    }
    const parsed = JSON.parse(content);

    // Handle legacy format (array of StoredVector)
    if (Array.isArray(parsed)) {
      // Legacy brute-force format - migrate to HNSW
      for (const item of parsed as StoredVector[]) {
        if (this.useHNSW && this.hnswIndex) {
          this.hnswIndex.add(item.label, item.vector);
        }
        this.bruteForceVectors.set(item.label, item.vector);
      }
      return;
    }

    // New format with type indicator
    if (parsed.type === 'hnsw' && this.hnswIndex) {
      this.hnswIndex = HNSWIndex.deserialize(parsed.data);
      this.useHNSW = true;
    } else if (parsed.type === 'brute-force' || !parsed.type) {
      // Brute-force or unknown format
      const data = parsed.data || parsed;
      if (Array.isArray(data)) {
        for (const item of data as StoredVector[]) {
          if (this.useHNSW && this.hnswIndex) {
            this.hnswIndex.add(item.label, item.vector);
          }
          this.bruteForceVectors.set(item.label, item.vector);
        }
      }
    }

    this.initialized = true;
  }

  private async loadBruteForce(): Promise<void> {
    if (!existsSync(this.config.indexPath)) {
      return;
    }

    const content = readFileSync(this.config.indexPath, 'utf-8').trim();
    if (!content) {
      console.warn(`VectorDB: Index file is empty, skipping brute-force load: ${this.config.indexPath}`);
      return;
    }
    const parsed = JSON.parse(content);

    // Handle both legacy and new formats
    const data = Array.isArray(parsed) ? parsed : (parsed.data || []);

    this.bruteForceVectors.clear();
    for (const item of data as StoredVector[]) {
      this.bruteForceVectors.set(item.label, item.vector);
    }
  }

  getCount(): number {
    if (this.useHNSW && this.hnswIndex) {
      return this.hnswIndex.getCount();
    }
    return this.bruteForceVectors.size;
  }

  getMaxElements(): number {
    return this.config.maxElements;
  }

  getDimensions(): number {
    return this.config.dimensions;
  }

  setEfSearch(ef: number): void {
    if (this.useHNSW && this.hnswIndex) {
      this.hnswIndex.setEfSearch(ef);
    }
  }

  getStats(): {
    currentCount: number;
    maxElements: number;
    dimensions: number;
    efSearch: number;
    M: number;
    spaceName: string;
    searchMode: 'hnsw' | 'brute-force';
    hnswStats?: {
      nodeCount: number;
      maxLevel: number;
      avgConnections: number;
    };
  } {
    const base = {
      currentCount: this.getCount(),
      maxElements: this.config.maxElements,
      dimensions: this.config.dimensions,
      efSearch: this.config.efSearch,
      M: this.config.M,
      spaceName: this.config.spaceName,
      searchMode: (this.useHNSW ? 'hnsw' : 'brute-force') as 'hnsw' | 'brute-force'
    };

    if (this.useHNSW && this.hnswIndex) {
      const hnswStats = this.hnswIndex.getStats();
      return {
        ...base,
        hnswStats: {
          nodeCount: hnswStats.nodeCount,
          maxLevel: hnswStats.maxLevel,
          avgConnections: hnswStats.avgConnections
        }
      };
    }

    return base;
  }

  delete(label: number): boolean {
    let deleted = false;

    if (this.useHNSW && this.hnswIndex) {
      deleted = this.hnswIndex.delete(label);
    }

    // Also delete from brute-force backup
    if (this.bruteForceVectors.has(label)) {
      this.bruteForceVectors.delete(label);
      deleted = true;
    }

    return deleted;
  }

  update(label: number, vector: Float32Array): boolean {
    if (!this.initialized) {
      throw new Error('VectorDB not initialized. Call initialize() first.');
    }

    // Validate dimensions
    this.assertDimensions(vector);

    // Normalize vector
    const { isValid } = this.validateL2Norm(vector);
    const normalizedVector = isValid ? Array.from(vector) : this.normalizeVector(vector);

    if (this.useHNSW && this.hnswIndex) {
      if (!this.hnswIndex.has(label)) {
        return false;
      }
      // HNSW doesn't support in-place update, so delete and re-add
      this.hnswIndex.delete(label);
      this.hnswIndex.add(label, normalizedVector);
    }

    // Update brute-force backup
    if (this.bruteForceVectors.has(label)) {
      this.bruteForceVectors.set(label, normalizedVector);
      return true;
    }

    return this.useHNSW && this.hnswIndex ? true : false;
  }

  has(label: number): boolean {
    if (this.useHNSW && this.hnswIndex) {
      return this.hnswIndex.has(label);
    }
    return this.bruteForceVectors.has(label);
  }

  clear(): void {
    if (this.useHNSW && this.hnswIndex) {
      this.hnswIndex.clear();
    }
    this.bruteForceVectors.clear();
  }

  /**
   * Check if HNSW is being used (vs brute-force fallback)
   */
  isUsingHNSW(): boolean {
    return this.useHNSW && this.hnswIndex !== null;
  }

  /**
   * Get the raw HNSW index for advanced operations
   */
  getHNSWIndex(): HNSWIndex | null {
    return this.hnswIndex;
  }
}
