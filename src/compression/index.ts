/**
 * Compression Module
 *
 * 5-tier vector compression system for memory optimization.
 */

export {
  CompressionTier,
  TIER_THRESHOLDS,
  BYTES_PER_DIM,
  DEFAULT_TIER_CONFIG,
  type CompressedVector,
  type VectorAccessStats,
  type CompressionStats,
  type TierTransition,
  type TierManagerConfig,
  type PQConfig,
  type PQCodebook
} from './types.js';

export {
  ProductQuantizer,
  PQ8_CONFIG,
  PQ4_CONFIG
} from './ProductQuantizer.js';

export { TierManager } from './TierManager.js';
