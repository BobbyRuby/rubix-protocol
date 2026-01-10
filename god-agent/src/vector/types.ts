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
  efConstruction: number;
  efSearch: number;
  M: number;
  spaceName: 'l2' | 'ip' | 'cosine';
  indexPath: string;
}

export interface EmbeddingServiceConfig {
  provider: 'openai' | 'local';
  model: string;
  dimensions: number;
  apiKey?: string;
  batchSize: number;
}

export interface EmbeddingResult {
  embedding: Float32Array;
  tokensUsed: number;
}

export interface BatchEmbeddingResult {
  embeddings: Float32Array[];
  totalTokensUsed: number;
}
