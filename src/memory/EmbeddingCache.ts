/**
 * EmbeddingCache - LRU cache for embeddings with batch support
 *
 * Provides efficient caching and batch processing for text embeddings
 * to minimize API calls and improve performance.
 */

import OpenAI from 'openai';
import crypto from 'crypto';

export interface CacheEntry {
  embedding: number[];
  timestamp: number;
  accessCount: number;
}

export interface EmbeddingCacheOptions {
  maxSize?: number;
  ttl?: number; // Time to live in milliseconds
  model?: string;
  batchSize?: number; // Max texts per API call
}

export interface CacheStats {
  size: number;
  maxSize: number;
  hits: number;
  misses: number;
  hitRate: number;
  totalRequests: number;
  evictions: number;
}

export class EmbeddingCache {
  private cache: Map<string, CacheEntry>;
  private maxSize: number;
  private ttl: number;
  private model: string;
  private batchSize: number;
  private openai: OpenAI | null;

  // Statistics
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(openai?: OpenAI, options: EmbeddingCacheOptions = {}) {
    this.openai = openai || null;
    this.cache = new Map();
    this.maxSize = options.maxSize ?? 1000;
    this.ttl = options.ttl ?? 24 * 60 * 60 * 1000; // 24 hours default
    this.model = options.model ?? 'text-embedding-3-small';
    this.batchSize = options.batchSize ?? 100; // OpenAI limit is 2048
  }

  /**
   * Initialize or replace OpenAI client
   */
  setOpenAI(openai: OpenAI): void {
    this.openai = openai;
  }

  /**
   * Get OpenAI client, initializing from env if needed
   */
  private getOpenAI(): OpenAI {
    if (!this.openai) {
      this.openai = new OpenAI();
    }
    return this.openai;
  }

  /**
   * Get embedding from cache or compute
   * Single text version - use batchEmbed for multiple texts
   */
  async getEmbedding(text: string): Promise<number[]> {
    const key = this.generateKey(text);

    // Check cache
    const cached = this.cache.get(key);
    if (cached && !this.isExpired(cached)) {
      this.hits++;
      cached.accessCount++;
      cached.timestamp = Date.now(); // Update for LRU
      return cached.embedding;
    }

    // Cache miss - compute embedding
    this.misses++;

    const response = await this.getOpenAI().embeddings.create({
      input: text,
      model: this.model
    });

    const embedding = response.data[0].embedding;
    this.set(key, embedding);

    return embedding;
  }

  /**
   * Batch embed multiple texts efficiently
   * Checks cache first, then makes minimal API calls
   */
  async batchEmbed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    // Generate keys and check cache
    const keys = texts.map(t => this.generateKey(t));
    const results: (number[] | null)[] = new Array(texts.length).fill(null);
    const uncachedIndices: number[] = [];

    for (let i = 0; i < texts.length; i++) {
      const cached = this.cache.get(keys[i]);

      if (cached && !this.isExpired(cached)) {
        this.hits++;
        cached.accessCount++;
        cached.timestamp = Date.now();
        results[i] = cached.embedding;
      } else {
        this.misses++;
        uncachedIndices.push(i);
      }
    }

    // Compute embeddings for uncached texts
    if (uncachedIndices.length > 0) {
      const uncachedTexts = uncachedIndices.map(i => texts[i]);
      const embeddings = await this.computeBatchEmbeddings(uncachedTexts);

      // Cache and assign results
      for (let i = 0; i < uncachedIndices.length; i++) {
        const idx = uncachedIndices[i];
        const embedding = embeddings[i];
        const key = keys[idx];

        this.set(key, embedding);
        results[idx] = embedding;
      }
    }

    return results as number[][];
  }

  /**
   * Compute embeddings for multiple texts using batch API calls
   * Splits into chunks if needed to respect API limits
   */
  private async computeBatchEmbeddings(texts: string[]): Promise<number[][]> {
    const embeddings: number[][] = [];

    // Process in batches
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);

      const response = await this.getOpenAI().embeddings.create({
        input: batch,
        model: this.model
      });

      // Extract embeddings in order
      const batchEmbeddings = response.data
        .sort((a, b) => a.index - b.index)
        .map(item => item.embedding);

      embeddings.push(...batchEmbeddings);
    }

    return embeddings;
  }

  /**
   * Set embedding in cache with LRU eviction
   */
  private set(key: string, embedding: number[]): void {
    // Evict if needed before adding
    this.evictIfNeeded();

    this.cache.set(key, {
      embedding,
      timestamp: Date.now(),
      accessCount: 1
    });
  }

  /**
   * LRU eviction - removes least recently used entry
   */
  private evictIfNeeded(): void {
    if (this.cache.size >= this.maxSize) {
      // Find least recently used entry
      let oldestKey: string | null = null;
      let oldestTime = Infinity;

      for (const [key, entry] of this.cache.entries()) {
        if (entry.timestamp < oldestTime) {
          oldestTime = entry.timestamp;
          oldestKey = key;
        }
      }

      if (oldestKey) {
        this.cache.delete(oldestKey);
        this.evictions++;
      }
    }
  }

  /**
   * Check if cache entry has expired
   */
  private isExpired(entry: CacheEntry): boolean {
    return Date.now() - entry.timestamp > this.ttl;
  }

  /**
   * Generate cache key from text
   * Uses hash for consistent key generation
   */
  private generateKey(text: string): string {
    return crypto
      .createHash('sha256')
      .update(text)
      .update(this.model) // Include model in key
      .digest('hex');
  }

  /**
   * Clear expired entries from cache
   */
  pruneExpired(): number {
    let pruned = 0;
    const now = Date.now();

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.ttl) {
        this.cache.delete(key);
        pruned++;
      }
    }

    return pruned;
  }

  /**
   * Clear all entries from cache
   */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const totalRequests = this.hits + this.misses;
    const hitRate = totalRequests > 0 ? this.hits / totalRequests : 0;

    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRate: Math.round(hitRate * 10000) / 100, // Percentage with 2 decimals
      totalRequests,
      evictions: this.evictions
    };
  }

  /**
   * Get all cache keys (for debugging)
   */
  getKeys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Check if text is cached
   */
  has(text: string): boolean {
    const key = this.generateKey(text);
    const entry = this.cache.get(key);
    return entry !== undefined && !this.isExpired(entry);
  }

  /**
   * Pre-warm cache with known texts
   * Useful for initialization
   */
  async preload(texts: string[]): Promise<void> {
    await this.batchEmbed(texts);
  }

  /**
   * Alias for preload - pre-warm cache with common queries
   */
  async prewarm(texts: string[]): Promise<void> {
    await this.preload(texts);
  }

  /**
   * Export cache to JSON for persistence
   */
  export(): Record<string, { embedding: number[]; timestamp: number; accessCount: number }> {
    const exported: Record<string, CacheEntry> = {};

    for (const [key, entry] of this.cache.entries()) {
      if (!this.isExpired(entry)) {
        exported[key] = entry;
      }
    }

    return exported;
  }

  /**
   * Import cache from JSON
   */
  import(data: Record<string, { embedding: number[]; timestamp: number; accessCount: number }>): void {
    this.cache.clear();

    for (const [key, entry] of Object.entries(data)) {
      if (!this.isExpired(entry)) {
        this.cache.set(key, entry);
      }
    }
  }

  /**
   * Get size of cache in memory (approximate)
   */
  getMemorySize(): number {
    let size = 0;

    for (const entry of this.cache.values()) {
      // Approximate: each float is 8 bytes + overhead
      size += entry.embedding.length * 8 + 100; // 100 bytes overhead
    }

    return size;
  }
}
