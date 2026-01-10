/**
 * Tier Manager
 *
 * Manages the 5-tier compression lifecycle for vectors based on access frequency.
 * Vectors are automatically demoted to lower tiers as they are accessed less frequently.
 *
 * Tiers (hot → frozen = decreasing access frequency):
 * - HOT:    Float32, > 80% access frequency, full precision
 * - WARM:   Float16, 40-80% access frequency, 2x compression
 * - COOL:   PQ8, 10-40% access frequency, 8x compression
 * - COLD:   PQ4, 1-10% access frequency, 16x compression
 * - FROZEN: Binary, < 1% access frequency, 32x compression
 *
 * Note: Tier transitions are ONE-WAY (demotion only). Once compressed,
 * vectors are never promoted back because decompression loses information.
 */

import {
  CompressionTier,
  TIER_THRESHOLDS,
  BYTES_PER_DIM,
  type CompressedVector,
  type VectorAccessStats,
  type CompressionStats,
  type TierTransition,
  type TierManagerConfig,
  DEFAULT_TIER_CONFIG
} from './types.js';
import { ProductQuantizer, PQ8_CONFIG, PQ4_CONFIG } from './ProductQuantizer.js';

const DIMENSIONS = 768;

/**
 * Float16 conversion utilities
 */
function float32ToFloat16(value: number): number {
  // Simplified Float16 conversion (IEEE 754 half-precision)
  const floatView = new Float32Array(1);
  const int32View = new Int32Array(floatView.buffer);
  floatView[0] = value;
  const x = int32View[0];

  const sign = (x >>> 31) << 15;
  const exponent = ((x >>> 23) & 0xFF) - 127 + 15;
  const mantissa = (x >>> 13) & 0x3FF;

  if (exponent <= 0) {
    return sign; // Subnormal or zero
  } else if (exponent >= 31) {
    return sign | 0x7C00; // Infinity or NaN
  }

  return sign | (exponent << 10) | mantissa;
}

function float16ToFloat32(half: number): number {
  const sign = (half >>> 15) & 0x1;
  const exponent = (half >>> 10) & 0x1F;
  const mantissa = half & 0x3FF;

  let value: number;
  if (exponent === 0) {
    value = mantissa / 1024 * Math.pow(2, -14); // Subnormal
  } else if (exponent === 31) {
    value = mantissa === 0 ? Infinity : NaN;
  } else {
    value = (1 + mantissa / 1024) * Math.pow(2, exponent - 15);
  }

  return sign ? -value : value;
}

/**
 * Binary quantization utilities
 */
function toBinaryQuantized(vector: Float32Array): Uint8Array {
  // Each dimension becomes 1 bit: sign(value) -> 0 or 1
  const numBytes = Math.ceil(vector.length / 8);
  const binary = new Uint8Array(numBytes);

  for (let i = 0; i < vector.length; i++) {
    const byteIdx = Math.floor(i / 8);
    const bitIdx = i % 8;
    if (vector[i] > 0) {
      binary[byteIdx] |= (1 << bitIdx);
    }
  }

  return binary;
}

function fromBinaryQuantized(binary: Uint8Array, dimensions: number): Float32Array {
  // Binary can only preserve sign, so we use +1/-1 as approximation
  const vector = new Float32Array(dimensions);

  for (let i = 0; i < dimensions; i++) {
    const byteIdx = Math.floor(i / 8);
    const bitIdx = i % 8;
    vector[i] = (binary[byteIdx] & (1 << bitIdx)) ? 0.1 : -0.1;
  }

  // Normalize to unit length
  let norm = 0;
  for (let i = 0; i < dimensions; i++) {
    norm += vector[i] * vector[i];
  }
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < dimensions; i++) {
      vector[i] /= norm;
    }
  }

  return vector;
}

export class TierManager {
  private config: TierManagerConfig;
  private accessStats: Map<number, VectorAccessStats> = new Map();
  private compressedVectors: Map<number, CompressedVector> = new Map();
  private hotVectors: Map<number, Float32Array> = new Map();
  private pq8: ProductQuantizer;
  private pq4: ProductQuantizer;
  private maxAccesses: number = 0;
  private lastEvaluation: number = 0;

  constructor(config: Partial<TierManagerConfig> = {}) {
    this.config = { ...DEFAULT_TIER_CONFIG, ...config };
    this.pq8 = new ProductQuantizer(PQ8_CONFIG);
    this.pq4 = new ProductQuantizer(PQ4_CONFIG);
  }

  /**
   * Initialize quantizers with training data
   */
  async initializeQuantizers(vectors: Float32Array[]): Promise<void> {
    if (vectors.length >= 256) {
      // Use full k-means training if we have enough vectors
      this.pq8.train(vectors, 10);
      this.pq4.train(vectors, 10);
    } else if (vectors.length > 0) {
      // Use random initialization for small datasets
      this.pq8.initializeRandom(vectors);
      this.pq4.initializeRandom(vectors);
    }
  }

  /**
   * Add a new vector (starts in HOT tier)
   */
  addVector(label: number, vector: Float32Array): void {
    // Store in hot tier
    this.hotVectors.set(label, vector);

    // Initialize access stats
    const now = new Date();
    this.accessStats.set(label, {
      label,
      accessCount: 1,
      lastAccessedAt: now,
      tier: CompressionTier.HOT,
      frequency: 1.0
    });

    this.maxAccesses = Math.max(this.maxAccesses, 1);
  }

  /**
   * Record an access to a vector
   */
  recordAccess(label: number): void {
    const stats = this.accessStats.get(label);
    if (!stats) return;

    stats.accessCount++;
    stats.lastAccessedAt = new Date();
    this.maxAccesses = Math.max(this.maxAccesses, stats.accessCount);
  }

  /**
   * Get a vector (decompressing if necessary)
   */
  getVector(label: number): Float32Array | null {
    // Record access
    this.recordAccess(label);

    // Check hot tier first
    if (this.hotVectors.has(label)) {
      return this.hotVectors.get(label)!;
    }

    // Check compressed storage
    const compressed = this.compressedVectors.get(label);
    if (!compressed) {
      return null;
    }

    return this.decompress(compressed);
  }

  /**
   * Determine the appropriate tier for a vector based on access frequency
   */
  determineTier(label: number): CompressionTier {
    const stats = this.accessStats.get(label);
    if (!stats) {
      return CompressionTier.FROZEN; // Unknown vectors are frozen
    }

    // Calculate frequency relative to max
    const frequency = this.maxAccesses > 0 ? stats.accessCount / this.maxAccesses : 0;

    // Check against thresholds
    if (frequency > TIER_THRESHOLDS[CompressionTier.HOT]) {
      return CompressionTier.HOT;
    } else if (frequency > TIER_THRESHOLDS[CompressionTier.WARM]) {
      return CompressionTier.WARM;
    } else if (frequency > TIER_THRESHOLDS[CompressionTier.COOL]) {
      return CompressionTier.COOL;
    } else if (frequency > TIER_THRESHOLDS[CompressionTier.COLD]) {
      return CompressionTier.COLD;
    }
    return CompressionTier.FROZEN;
  }

  /**
   * Compress a vector to the target tier
   */
  compress(vector: Float32Array, tier: CompressionTier): CompressedVector {
    let data: Uint8Array | Float32Array;

    switch (tier) {
      case CompressionTier.HOT:
        // No compression
        data = new Float32Array(vector);
        break;

      case CompressionTier.WARM:
        // Float16 compression
        const float16 = new Uint16Array(vector.length);
        for (let i = 0; i < vector.length; i++) {
          float16[i] = float32ToFloat16(vector[i]);
        }
        data = new Uint8Array(float16.buffer);
        break;

      case CompressionTier.COOL:
        // PQ8 compression
        data = this.pq8.encode(vector);
        break;

      case CompressionTier.COLD:
        // PQ4 compression
        data = this.pq4.encode(vector);
        break;

      case CompressionTier.FROZEN:
        // Binary compression
        data = toBinaryQuantized(vector);
        break;

      default:
        throw new Error(`Unknown tier: ${tier}`);
    }

    return {
      label: 0, // Will be set by caller
      tier,
      data
    };
  }

  /**
   * Decompress a vector from its compressed representation
   */
  decompress(compressed: CompressedVector): Float32Array {
    switch (compressed.tier) {
      case CompressionTier.HOT:
        return compressed.data as Float32Array;

      case CompressionTier.WARM:
        const float16 = new Uint16Array((compressed.data as Uint8Array).buffer);
        const warm = new Float32Array(float16.length);
        for (let i = 0; i < float16.length; i++) {
          warm[i] = float16ToFloat32(float16[i]);
        }
        return warm;

      case CompressionTier.COOL:
        return this.pq8.decode(compressed.data as Uint8Array);

      case CompressionTier.COLD:
        return this.pq4.decode(compressed.data as Uint8Array);

      case CompressionTier.FROZEN:
        return fromBinaryQuantized(compressed.data as Uint8Array, DIMENSIONS);

      default:
        throw new Error(`Unknown tier: ${compressed.tier}`);
    }
  }

  /**
   * Evaluate and perform tier transitions for all vectors
   */
  evaluateTiers(): TierTransition[] {
    const now = Date.now();

    // Check if enough time has passed since last evaluation
    if (now - this.lastEvaluation < this.config.evaluationInterval) {
      return [];
    }
    this.lastEvaluation = now;

    // Need minimum vectors before compression
    const totalVectors = this.hotVectors.size + this.compressedVectors.size;
    if (totalVectors < this.config.minVectorsForCompression) {
      return [];
    }

    const transitions: TierTransition[] = [];

    // Evaluate each hot vector for demotion
    for (const [label, vector] of this.hotVectors.entries()) {
      const targetTier = this.determineTier(label);
      const stats = this.accessStats.get(label);
      const currentTier = stats?.tier ?? CompressionTier.HOT;

      // Only demote (never promote)
      if (this.tierOrder(targetTier) > this.tierOrder(currentTier)) {
        const memorySaved = this.calculateMemorySaved(currentTier, targetTier);

        if (this.config.autoTransition) {
          // Perform the transition
          const compressed = this.compress(vector, targetTier);
          compressed.label = label;
          this.compressedVectors.set(label, compressed);
          this.hotVectors.delete(label);

          if (stats) {
            stats.tier = targetTier;
          }
        }

        transitions.push({
          label,
          fromTier: currentTier,
          toTier: targetTier,
          memorySaved
        });
      }
    }

    // Evaluate compressed vectors for further demotion
    for (const [label, compressed] of this.compressedVectors.entries()) {
      const targetTier = this.determineTier(label);
      const currentTier = compressed.tier;

      if (this.tierOrder(targetTier) > this.tierOrder(currentTier)) {
        const memorySaved = this.calculateMemorySaved(currentTier, targetTier);

        if (this.config.autoTransition) {
          // Decompress and recompress to lower tier
          const vector = this.decompress(compressed);
          const recompressed = this.compress(vector, targetTier);
          recompressed.label = label;
          this.compressedVectors.set(label, recompressed);

          const stats = this.accessStats.get(label);
          if (stats) {
            stats.tier = targetTier;
          }
        }

        transitions.push({
          label,
          fromTier: currentTier,
          toTier: targetTier,
          memorySaved
        });
      }
    }

    return transitions;
  }

  /**
   * Get compression statistics
   */
  getStats(): CompressionStats {
    const vectorsPerTier: Record<CompressionTier, number> = {
      [CompressionTier.HOT]: 0,
      [CompressionTier.WARM]: 0,
      [CompressionTier.COOL]: 0,
      [CompressionTier.COLD]: 0,
      [CompressionTier.FROZEN]: 0
    };

    const memoryPerTier: Record<CompressionTier, number> = {
      [CompressionTier.HOT]: 0,
      [CompressionTier.WARM]: 0,
      [CompressionTier.COOL]: 0,
      [CompressionTier.COLD]: 0,
      [CompressionTier.FROZEN]: 0
    };

    // Count hot vectors
    vectorsPerTier[CompressionTier.HOT] = this.hotVectors.size;
    memoryPerTier[CompressionTier.HOT] = this.hotVectors.size * DIMENSIONS * BYTES_PER_DIM[CompressionTier.HOT];

    // Count compressed vectors
    for (const [, compressed] of this.compressedVectors) {
      vectorsPerTier[compressed.tier]++;
      memoryPerTier[compressed.tier] += compressed.data.byteLength;
    }

    const totalVectors = Object.values(vectorsPerTier).reduce((a, b) => a + b, 0);
    const uncompressedMemory = totalVectors * DIMENSIONS * 4; // Float32
    const compressedMemory = Object.values(memoryPerTier).reduce((a, b) => a + b, 0);
    const memorySaved = uncompressedMemory - compressedMemory;
    const compressionRatio = compressedMemory > 0 ? uncompressedMemory / compressedMemory : 1;
    const memorySavedPercent = uncompressedMemory > 0 ? (memorySaved / uncompressedMemory) * 100 : 0;

    return {
      totalVectors,
      vectorsPerTier,
      memoryPerTier,
      uncompressedMemory,
      compressedMemory,
      compressionRatio,
      memorySaved,
      memorySavedPercent
    };
  }

  /**
   * Get access stats for a specific vector
   */
  getAccessStats(label: number): VectorAccessStats | undefined {
    return this.accessStats.get(label);
  }

  /**
   * Get all access stats
   */
  getAllAccessStats(): VectorAccessStats[] {
    return Array.from(this.accessStats.values());
  }

  /**
   * Delete a vector from all tiers
   */
  deleteVector(label: number): boolean {
    let deleted = false;

    if (this.hotVectors.has(label)) {
      this.hotVectors.delete(label);
      deleted = true;
    }

    if (this.compressedVectors.has(label)) {
      this.compressedVectors.delete(label);
      deleted = true;
    }

    if (this.accessStats.has(label)) {
      this.accessStats.delete(label);
      deleted = true;
    }

    return deleted;
  }

  /**
   * Clear all vectors and reset state
   */
  clear(): void {
    this.hotVectors.clear();
    this.compressedVectors.clear();
    this.accessStats.clear();
    this.maxAccesses = 0;
    this.lastEvaluation = 0;
  }

  /**
   * Get the total number of vectors
   */
  getCount(): number {
    return this.hotVectors.size + this.compressedVectors.size;
  }

  /**
   * Check if quantizers have been initialized
   */
  isInitialized(): boolean {
    return this.pq8.getCodebook() !== null;
  }

  /**
   * Serialize the codebooks for persistence
   */
  serializeCodebooks(): { pq8: string | null; pq4: string | null } {
    return {
      pq8: this.pq8.serializeCodebook(),
      pq4: this.pq4.serializeCodebook()
    };
  }

  /**
   * Load serialized codebooks
   */
  loadCodebooks(serialized: { pq8: string | null; pq4: string | null }): void {
    if (serialized.pq8) {
      this.pq8.loadCodebook(ProductQuantizer.deserializeCodebook(serialized.pq8));
    }
    if (serialized.pq4) {
      this.pq4.loadCodebook(ProductQuantizer.deserializeCodebook(serialized.pq4));
    }
  }

  // ============ Private Methods ============

  private tierOrder(tier: CompressionTier): number {
    const order: Record<CompressionTier, number> = {
      [CompressionTier.HOT]: 0,
      [CompressionTier.WARM]: 1,
      [CompressionTier.COOL]: 2,
      [CompressionTier.COLD]: 3,
      [CompressionTier.FROZEN]: 4
    };
    return order[tier];
  }

  private calculateMemorySaved(fromTier: CompressionTier, toTier: CompressionTier): number {
    const fromBytes = DIMENSIONS * BYTES_PER_DIM[fromTier];
    const toBytes = DIMENSIONS * BYTES_PER_DIM[toTier];
    return fromBytes - toBytes;
  }
}
