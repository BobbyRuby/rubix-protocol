/**
 * Memory Compression Module
 *
 * Bidirectional compression for token-efficient memory storage.
 */

export * from './types.js';
export {
  MemoryCompressor,
  memoryCompressor,
  parseTokens,
  expandDotList,
  expandVerbs,
  expandList
} from './MemoryCompressor.js';
export { COMPRESSION_SCHEMAS } from './CompressionSchemas.js';

// Performance Optimizations (NEW - for parallel agent support)
export { AsyncWriteQueue } from './AsyncWriteQueue.js';
export { EmbeddingCache } from './EmbeddingCache.js';

// Automated Recall (centralized brain)
export {
  AutoRecall,
  getAutoRecall,
  initAutoRecall,
  type AutoRecallConfig,
  type RecalledMemory,
  type RecallResult
} from './AutoRecall.js';
