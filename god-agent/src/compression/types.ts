/**
 * Compression Types
 *
 * Type definitions for the 5-tier vector compression system.
 * Based on access frequency, vectors are compressed to save memory.
 *
 * Memory savings at each tier:
 * - HOT:    Float32 (3,072 bytes per 768-dim vector)
 * - WARM:   Float16 (1,536 bytes) - 2x compression
 * - COOL:   PQ8     (384 bytes)   - 8x compression
 * - COLD:   PQ4     (192 bytes)   - 16x compression
 * - FROZEN: Binary  (96 bytes)    - 32x compression
 */

/**
 * Compression tier based on access frequency
 */
export enum CompressionTier {
  /** Full precision Float32 - access frequency > 80% */
  HOT = 'hot',
  /** Half precision Float16 - access frequency 40-80% */
  WARM = 'warm',
  /** Product Quantization 8-bit - access frequency 10-40% */
  COOL = 'cool',
  /** Product Quantization 4-bit - access frequency 1-10% */
  COLD = 'cold',
  /** Binary quantization - access frequency < 1% */
  FROZEN = 'frozen'
}

/**
 * Tier thresholds for access frequency (percentage of max accesses)
 */
export const TIER_THRESHOLDS = {
  [CompressionTier.HOT]: 0.8,     // > 80%
  [CompressionTier.WARM]: 0.4,    // 40-80%
  [CompressionTier.COOL]: 0.1,    // 10-40%
  [CompressionTier.COLD]: 0.01,   // 1-10%
  [CompressionTier.FROZEN]: 0     // < 1%
} as const;

/**
 * Bytes per dimension at each tier
 */
export const BYTES_PER_DIM = {
  [CompressionTier.HOT]: 4,       // Float32 = 4 bytes
  [CompressionTier.WARM]: 2,      // Float16 = 2 bytes
  [CompressionTier.COOL]: 0.5,    // PQ8 = 4 bits avg (96 subvectors × 8 bits / 768 dims)
  [CompressionTier.COLD]: 0.25,   // PQ4 = 2 bits avg
  [CompressionTier.FROZEN]: 0.125 // Binary = 1 bit
} as const;

/**
 * Compressed vector representation
 */
export interface CompressedVector {
  /** The label/ID of the vector in the index */
  label: number;
  /** Current compression tier */
  tier: CompressionTier;
  /** Compressed data - format depends on tier */
  data: Uint8Array | Float32Array | Int8Array;
  /** Original vector hash for validation (optional) */
  hash?: string;
}

/**
 * Access statistics for a vector
 */
export interface VectorAccessStats {
  /** Vector label */
  label: number;
  /** Total access count */
  accessCount: number;
  /** Timestamp of last access */
  lastAccessedAt: Date;
  /** Current compression tier */
  tier: CompressionTier;
  /** Access frequency (0-1) relative to sliding window */
  frequency: number;
}

/**
 * Product Quantizer configuration
 */
export interface PQConfig {
  /** Number of dimensions (must divide evenly by numSubvectors) */
  dimensions: number;
  /** Number of subvectors to split into */
  numSubvectors: number;
  /** Number of centroids per subvector (256 for PQ8, 16 for PQ4) */
  numCentroids: number;
  /** Bits per code (8 for PQ8, 4 for PQ4) */
  bitsPerCode: number;
}

/**
 * Codebook for Product Quantization
 * Each subvector has numCentroids centroids of (dimensions/numSubvectors) length
 */
export interface PQCodebook {
  /** Configuration used to generate this codebook */
  config: PQConfig;
  /** Centroids: [numSubvectors][numCentroids][subvectorDim] */
  centroids: Float32Array[];
  /** When the codebook was trained */
  trainedAt: Date;
  /** Number of vectors used for training */
  trainingSize: number;
}

/**
 * Compression statistics
 */
export interface CompressionStats {
  /** Total number of vectors */
  totalVectors: number;
  /** Vectors per tier */
  vectorsPerTier: Record<CompressionTier, number>;
  /** Memory usage per tier (bytes) */
  memoryPerTier: Record<CompressionTier, number>;
  /** Total memory without compression (bytes) */
  uncompressedMemory: number;
  /** Total memory with compression (bytes) */
  compressedMemory: number;
  /** Compression ratio (uncompressed / compressed) */
  compressionRatio: number;
  /** Memory saved (bytes) */
  memorySaved: number;
  /** Memory saved percentage */
  memorySavedPercent: number;
}

/**
 * Tier transition result
 */
export interface TierTransition {
  /** Vector label */
  label: number;
  /** Previous tier */
  fromTier: CompressionTier;
  /** New tier */
  toTier: CompressionTier;
  /** Memory saved by this transition (bytes) */
  memorySaved: number;
}

/**
 * TierManager configuration
 */
export interface TierManagerConfig {
  /** Sliding window for access tracking (ms), default 24 hours */
  accessWindow: number;
  /** How often to re-evaluate tiers (ms), default 1 hour */
  evaluationInterval: number;
  /** Minimum vectors before compression kicks in */
  minVectorsForCompression: number;
  /** Whether to enable automatic tier transitions */
  autoTransition: boolean;
}

/**
 * Default TierManager configuration
 */
export const DEFAULT_TIER_CONFIG: TierManagerConfig = {
  accessWindow: 24 * 60 * 60 * 1000, // 24 hours
  evaluationInterval: 60 * 60 * 1000, // 1 hour
  minVectorsForCompression: 1000,
  autoTransition: true
};
