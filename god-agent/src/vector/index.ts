/**
 * Vector Module Exports
 */

export { VectorDB } from './VectorDB.js';
export { EmbeddingService } from './EmbeddingService.js';
export { EmbeddingQueue } from './EmbeddingQueue.js';
export type {
  VectorEntry,
  VectorSearchResult,
  VectorDBConfig,
  EmbeddingServiceConfig,
  EmbeddingResult,
  BatchEmbeddingResult
} from './types.js';
export type {
  PendingEntry,
  FlushResult,
  EmbeddingQueueConfig
} from './EmbeddingQueue.js';
