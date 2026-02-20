/**
 * Vector Types
 *
 * Type definitions for the vector storage and search system.
 */

export interface VectorEntry {
  id: string;
  vector: Float32Array;
  metadata?: Record<string, unknown>;
}

export interface VectorSearchResult {
  id: string;
  label: number;
  distance: number;
  score: number;
}

export interface VectorDBConfig {
  dimensions: number;
  maxElements: number;
}

export interface EmbeddingServiceConfig {
  provider: 'openai' | 'local';
  model: string;
  dimensions: number;
  apiKey?: string;
  batchSize: number;
  /** Timeout in milliseconds (default 30000) */
  timeoutMs?: number;
  /** Max retries on transient errors (default 3) */
  maxRetries?: number;
  /** Base delay between retries in ms (default 1000, uses exponential backoff) */
  retryDelayMs?: number;
}

export interface EmbeddingResult {
  embedding: Float32Array;
  tokensUsed: number;
}

export interface BatchEmbeddingResult {
  embeddings: Float32Array[];
  totalTokensUsed: number;
}
