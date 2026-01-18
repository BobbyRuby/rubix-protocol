/**
 * Enhancement Layer
 *
 * Projects aggregated embeddings from 768 dimensions to 1024 dimensions.
 * This richer representation captures both semantic content and structural context.
 *
 * Architecture:
 * Input (768) → Linear(768, 512) → Activation → Linear(512, 1024) → Output
 *
 * With residual connection (if enabled):
 * Output = Transform(Input) + Pad(Input, 1024)
 */

import type { SQLiteStorage } from '../storage/SQLiteStorage.js';
import type { CausalMemory } from '../causal/CausalMemory.js';
import type {
  EnhancementConfig,
  EnhancementResult,
  BatchEnhancementResult,
  GNNStats
} from './types.js';
import { DEFAULT_ENHANCEMENT_CONFIG } from './types.js';
import { EgoGraphExtractor } from './EgoGraphExtractor.js';
import { MessagePassing } from './MessagePassing.js';

/**
 * OPTIMIZED: Simple LRU cache with size limit to prevent memory leaks.
 * Uses Map's insertion order for LRU eviction.
 */
class LRUCache<K, V> {
  private cache: Map<K, V>;
  private maxSize: number;

  constructor(maxSize: number) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used) by re-inserting
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    // If key exists, delete first to update position
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Evict oldest (first) entry
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

export class EnhancementLayer {
  private config: EnhancementConfig;
  private extractor: EgoGraphExtractor;
  private messagePassing: MessagePassing;

  // Learned weights (initialized randomly, can be loaded from training)
  private weights1: Float32Array;  // inputDim × hiddenDim
  private bias1: Float32Array;     // hiddenDim
  private weights2: Float32Array;  // hiddenDim × outputDim
  private bias2: Float32Array;     // outputDim

  // Statistics
  private stats: GNNStats = {
    enhancementsPerformed: 0,
    avgNeighborsUsed: 0,
    avgProcessingTimeMs: 0,
    cacheHitRate: 0
  };

  // OPTIMIZED: LRU cache for enhanced embeddings with bounded size (prevents memory leaks)
  private static readonly MAX_CACHE_SIZE = 1000;
  private cache: LRUCache<string, Float32Array> = new LRUCache(EnhancementLayer.MAX_CACHE_SIZE);
  private cacheHits = 0;
  private cacheQueries = 0;

  constructor(
    storage: SQLiteStorage,
    causal: CausalMemory,
    config: Partial<EnhancementConfig> = {}
  ) {
    this.config = { ...DEFAULT_ENHANCEMENT_CONFIG, ...config };
    this.extractor = new EgoGraphExtractor(storage, causal);
    this.messagePassing = new MessagePassing();

    // Initialize weights
    this.weights1 = this.initializeWeights(
      this.config.inputDim,
      this.config.hiddenDim
    );
    this.bias1 = new Float32Array(this.config.hiddenDim);

    this.weights2 = this.initializeWeights(
      this.config.hiddenDim,
      this.config.outputDim
    );
    this.bias2 = new Float32Array(this.config.outputDim);
  }

  /**
   * Enhance a single embedding using GNN
   */
  enhance(
    entryId: string,
    embedding: Float32Array,
    embeddingLookup?: (id: string) => Float32Array | null
  ): EnhancementResult {
    const startTime = Date.now();
    this.cacheQueries++;

    // Check cache
    if (this.cache.has(entryId)) {
      this.cacheHits++;
      return {
        entryId,
        originalEmbedding: embedding,
        enhancedEmbedding: this.cache.get(entryId)!,
        neighborsUsed: 0,
        neighborWeights: new Map(),
        processingTimeMs: Date.now() - startTime
      };
    }

    // Extract ego graph
    const graph = this.extractor.extract(entryId, embedding);

    // Load neighbor embeddings if lookup provided
    if (embeddingLookup) {
      for (const node of graph.nodes) {
        if (node.hopDistance > 0 && !node.embedding) {
          const nodeEmbedding = embeddingLookup(node.id);
          if (nodeEmbedding) {
            node.embedding = nodeEmbedding;
          }
        }
      }
    }

    // Aggregate neighbors via message passing
    const { embedding: aggregated, weights } = this.messagePassing.aggregateWithWeights(graph);

    // Project to higher dimension
    const enhanced = this.project(aggregated);

    // Update statistics
    this.updateStats(graph.neighborCount, Date.now() - startTime);

    // Cache result
    this.cache.set(entryId, enhanced);

    return {
      entryId,
      originalEmbedding: embedding,
      enhancedEmbedding: enhanced,
      neighborsUsed: graph.neighborCount,
      neighborWeights: weights,
      processingTimeMs: Date.now() - startTime
    };
  }

  /**
   * Enhance multiple embeddings in batch
   */
  enhanceBatch(
    entries: Array<{ id: string; embedding: Float32Array }>,
    embeddingLookup?: (id: string) => Float32Array | null
  ): BatchEnhancementResult {
    const startTime = Date.now();
    const results: EnhancementResult[] = [];
    let totalNeighbors = 0;

    for (const entry of entries) {
      const result = this.enhance(entry.id, entry.embedding, embeddingLookup);
      results.push(result);
      totalNeighbors += result.neighborsUsed;
    }

    return {
      results,
      totalTimeMs: Date.now() - startTime,
      avgNeighbors: entries.length > 0 ? totalNeighbors / entries.length : 0
    };
  }

  /**
   * Get an enhanced embedding without the full result object
   */
  getEnhanced(
    entryId: string,
    embedding: Float32Array,
    embeddingLookup?: (id: string) => Float32Array | null
  ): Float32Array {
    return this.enhance(entryId, embedding, embeddingLookup).enhancedEmbedding;
  }

  /**
   * Project a 768-dim embedding to 1024-dim
   */
  project(embedding: Float32Array): Float32Array {
    const { inputDim, hiddenDim, outputDim } = this.config;

    // Validate input dimension
    if (embedding.length !== inputDim) {
      throw new Error(`Expected ${inputDim}-dim embedding, got ${embedding.length}`);
    }

    // First linear layer: inputDim → hiddenDim
    const hidden = new Float32Array(hiddenDim);
    for (let i = 0; i < hiddenDim; i++) {
      let sum = this.bias1[i];
      for (let j = 0; j < inputDim; j++) {
        sum += embedding[j] * this.weights1[j * hiddenDim + i];
      }
      hidden[i] = sum;
    }

    // Apply activation
    this.applyActivation(hidden);

    // Apply dropout (only during training, skip for inference)
    // if (this.training && this.config.dropout > 0) {
    //   this.applyDropout(hidden);
    // }

    // Second linear layer: hiddenDim → outputDim
    const output = new Float32Array(outputDim);
    for (let i = 0; i < outputDim; i++) {
      let sum = this.bias2[i];
      for (let j = 0; j < hiddenDim; j++) {
        sum += hidden[j] * this.weights2[j * outputDim + i];
      }
      output[i] = sum;
    }

    // Residual connection (if enabled)
    if (this.config.residual) {
      // Pad original embedding to output dimension and add
      for (let i = 0; i < inputDim && i < outputDim; i++) {
        output[i] += embedding[i];
      }
    }

    // Final normalization
    this.normalizeVector(output);

    return output;
  }

  /**
   * Get statistics
   */
  getStats(): GNNStats {
    return {
      ...this.stats,
      cacheHitRate: this.cacheQueries > 0 ? this.cacheHits / this.cacheQueries : 0
    };
  }

  /**
   * Clear the enhancement cache
   */
  clearCache(): void {
    this.cache.clear();
    this.cacheHits = 0;
    this.cacheQueries = 0;
  }

  /**
   * Get cache size
   */
  getCacheSize(): number {
    return this.cache.size;
  }

  /**
   * Get the extractor for direct access
   */
  getExtractor(): EgoGraphExtractor {
    return this.extractor;
  }

  /**
   * Get message passing component
   */
  getMessagePassing(): MessagePassing {
    return this.messagePassing;
  }

  /**
   * Serialize weights for persistence
   */
  serializeWeights(): string {
    return JSON.stringify({
      weights1: Array.from(this.weights1),
      bias1: Array.from(this.bias1),
      weights2: Array.from(this.weights2),
      bias2: Array.from(this.bias2),
      config: this.config
    });
  }

  /**
   * Load weights from serialized form
   */
  loadWeights(serialized: string): void {
    const data = JSON.parse(serialized);
    this.weights1 = new Float32Array(data.weights1);
    this.bias1 = new Float32Array(data.bias1);
    this.weights2 = new Float32Array(data.weights2);
    this.bias2 = new Float32Array(data.bias2);
    // Don't override config, just use loaded weights
  }

  /**
   * Get configuration
   */
  getConfig(): EnhancementConfig {
    return { ...this.config };
  }

  // ============ Private Methods ============

  /**
   * Initialize weights using Xavier initialization
   */
  private initializeWeights(inputSize: number, outputSize: number): Float32Array {
    const weights = new Float32Array(inputSize * outputSize);
    const scale = Math.sqrt(2.0 / (inputSize + outputSize));

    for (let i = 0; i < weights.length; i++) {
      weights[i] = (Math.random() - 0.5) * 2 * scale;
    }

    return weights;
  }

  /**
   * Apply activation function in place
   */
  private applyActivation(vector: Float32Array): void {
    switch (this.config.activation) {
      case 'relu':
        for (let i = 0; i < vector.length; i++) {
          vector[i] = Math.max(0, vector[i]);
        }
        break;

      case 'gelu':
        // GELU approximation: x * 0.5 * (1 + tanh(sqrt(2/π) * (x + 0.044715 * x^3)))
        const sqrt2OverPi = Math.sqrt(2 / Math.PI);
        for (let i = 0; i < vector.length; i++) {
          const x = vector[i];
          const x3 = x * x * x;
          vector[i] = x * 0.5 * (1 + Math.tanh(sqrt2OverPi * (x + 0.044715 * x3)));
        }
        break;

      case 'tanh':
        for (let i = 0; i < vector.length; i++) {
          vector[i] = Math.tanh(vector[i]);
        }
        break;

      case 'none':
      default:
        // No activation
        break;
    }
  }

  /**
   * Normalize vector to unit length
   */
  private normalizeVector(vector: Float32Array): void {
    let norm = 0;
    for (let i = 0; i < vector.length; i++) {
      norm += vector[i] * vector[i];
    }
    norm = Math.sqrt(norm);

    if (norm > 0) {
      for (let i = 0; i < vector.length; i++) {
        vector[i] /= norm;
      }
    }
  }

  /**
   * Update statistics
   */
  private updateStats(neighborsUsed: number, processingTimeMs: number): void {
    const n = this.stats.enhancementsPerformed;
    this.stats.enhancementsPerformed++;

    // Running average for neighbors
    this.stats.avgNeighborsUsed =
      (this.stats.avgNeighborsUsed * n + neighborsUsed) / (n + 1);

    // Running average for processing time
    this.stats.avgProcessingTimeMs =
      (this.stats.avgProcessingTimeMs * n + processingTimeMs) / (n + 1);
  }
}
