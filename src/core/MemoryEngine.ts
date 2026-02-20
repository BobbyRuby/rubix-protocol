/**
 * Memory Engine
 *
 * Unified API facade for the God Agent memory system.
 * Coordinates vector search, provenance tracking, causal memory, and pattern matching.
 */

import { existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { v4 as uuidv4 } from 'uuid';

import { SQLiteStorage } from '../storage/SQLiteStorage.js';
import { VectorDB } from '../vector/VectorDB.js';
import { EmbeddingService } from '../vector/EmbeddingService.js';
import { EmbeddingQueue } from '../vector/EmbeddingQueue.js';
import { ProvenanceStore } from '../provenance/ProvenanceStore.js';
import { CausalMemory } from '../causal/CausalMemory.js';
import { CausalDetector } from '../causal/CausalDetector.js';
import type { CausalDetectorResult } from '../causal/CausalDetector.js';
import { PatternMatcher } from '../pattern/PatternMatcher.js';
import { ShadowSearch } from '../adversarial/ShadowSearch.js';
import { SonaEngine } from '../learning/SonaEngine.js';
import { MemRLEngine } from '../learning/memrl/index.js';
import { EnhancementLayer } from '../gnn/EnhancementLayer.js';
import { TinyDancer } from '../routing/TinyDancer.js';
import { getDefaultConfig, validateConfig, mergeConfig } from './config.js';
import { ProvenanceThresholdError } from './errors.js';
import { SYSTEM_TAGS } from './constants.js';

import { MemorySource } from './types.js';
import type {
  MemoryEngineConfig,
  MemoryEntry,
  StoreOptions,
  QueryOptions,
  QueryResult,
  CausalRelation,
  CausalRelationType,
  MemoryStats
} from './types.js';
import type { ProvenanceChain, LineageTraceResult } from '../provenance/types.js';
import type { CausalPath, CausalQuery, CausalTraversalResult } from '../causal/types.js';
import type { PatternMatch, PatternSlot } from '../pattern/types.js';
import type { ShadowSearchOptions, ShadowSearchResult } from '../adversarial/types.js';
import type { FeedbackResult, LearningStats, Trajectory } from '../learning/types.js';
import type { EnhancementResult, GNNStats } from '../gnn/types.js';
import type {
  RoutingDecision,
  QueryContext,
  RoutingStats,
  ReasoningRoute
} from '../routing/types.js';

/**
 * OPTIMIZED: Simple LRU cache with TTL for query results.
 * Prevents repeated database queries for the same query during task execution.
 */
class QueryCache {
  private cache: Map<string, { result: QueryResult[]; timestamp: number }>;
  private maxSize: number;
  private ttlMs: number;

  constructor(maxSize: number = 100, ttlMs: number = 60000) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  private generateKey(query: string, options: QueryOptions): string {
    return `${query}:${JSON.stringify(options)}`;
  }

  get(query: string, options: QueryOptions): QueryResult[] | null {
    const key = this.generateKey(query, options);
    const cached = this.cache.get(key);

    if (!cached) return null;

    // Check TTL
    if (Date.now() - cached.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, cached);

    return cached.result;
  }

  set(query: string, options: QueryOptions, result: QueryResult[]): void {
    const key = this.generateKey(query, options);

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

    this.cache.set(key, { result, timestamp: Date.now() });
  }

  invalidate(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

export class MemoryEngine {
  private config: MemoryEngineConfig;
  private storage: SQLiteStorage;
  private vectorDb: VectorDB;
  private embeddings: EmbeddingService;
  private provenance: ProvenanceStore;
  private causal: CausalMemory;
  private patterns: PatternMatcher;
  private shadowSearch: ShadowSearch;
  private sona: SonaEngine;
  private memrl: MemRLEngine;
  private gnn: EnhancementLayer;
  private router: TinyDancer;
  private embeddingQueue!: EmbeddingQueue;
  private flushThreshold: number = 10;
  private initialized: boolean = false;

  // OPTIMIZED: LRU query cache to prevent repeated queries during task execution
  private queryCache: QueryCache;

  // Auto-detect causal relations on store
  private causalDetector: CausalDetector;

  constructor(configOverrides?: Partial<MemoryEngineConfig>) {
    const defaultConfig = getDefaultConfig();
    this.config = configOverrides
      ? mergeConfig(defaultConfig, configOverrides)
      : defaultConfig;

    // Validate configuration
    const errors = validateConfig(this.config);
    if (errors.length > 0) {
      throw new Error(`Invalid configuration: ${errors.join(', ')}`);
    }

    // Ensure data directory exists
    if (!existsSync(this.config.dataDir)) {
      mkdirSync(this.config.dataDir, { recursive: true });
    }

    // Ensure parent directory for SQLite exists
    const sqliteDir = dirname(this.config.storageConfig.sqlitePath);
    if (!existsSync(sqliteDir)) {
      mkdirSync(sqliteDir, { recursive: true });
    }

    // Initialize components
    this.storage = new SQLiteStorage(this.config.storageConfig);

    this.vectorDb = new VectorDB(
      {
        dimensions: this.config.vectorDimensions,
        maxElements: this.config.vectorConfig.maxElements,
      },
      this.storage.getDb()
    );

    this.embeddings = new EmbeddingService({
      provider: this.config.embeddingConfig.provider,
      model: this.config.embeddingConfig.model,
      dimensions: this.config.embeddingConfig.dimensions,
      apiKey: this.config.embeddingConfig.apiKey,
      batchSize: this.config.embeddingConfig.batchSize ?? 100
    });

    // Initialize embedding queue for deferred batch processing
    this.embeddingQueue = new EmbeddingQueue(
      this.embeddings,
      this.vectorDb,
      { flushThreshold: this.flushThreshold, maxRetries: 3, retryDelayMs: 1000 }
    );

    this.provenance = new ProvenanceStore(this.storage, {
      lScoreConfig: this.config.lScoreConfig
    });

    this.causal = new CausalMemory(this.storage);

    this.patterns = new PatternMatcher(this.storage, {
      caseSensitive: false,
      minConfidence: 0.3,
      maxMatches: 10
    });

    this.shadowSearch = new ShadowSearch({
      defaultThreshold: 0.5,
      defaultTopK: 10,
      lScoreWeight: 1.0
    });

    this.sona = new SonaEngine(this.storage, {
      learningRate: 0.01,
      lambda: 0.5,
      driftThreshold: 0.3,
      criticalDriftThreshold: 0.5
    });

    // MemRL: Entry-level Q-value learning (complements Sona pattern-level learning)
    this.memrl = new MemRLEngine(this.storage, this.vectorDb, {
      delta: 0.3,   // Phase A similarity threshold
      lambda: 0.3,  // Exploration/exploitation balance (0=pure similarity, 1=pure Q-value)
      alpha: 0.1,   // EMA learning rate
      enabled: true
    });

    this.gnn = new EnhancementLayer(this.storage, this.causal, {
      inputDim: 768,
      outputDim: 1024,
      hiddenDim: 512,
      activation: 'relu',
      dropout: 0.1,
      residual: true
    });

    this.router = new TinyDancer({
      minConfidence: 0.6,
      useRuleBased: true,
      trackStats: true
    });

    // OPTIMIZED: Initialize query cache (100 entries, 60s TTL)
    this.queryCache = new QueryCache(100, 60000);

    // Initialize causal auto-detector (uses this engine for queries)
    this.causalDetector = new CausalDetector(this);
  }

  /**
   * Initialize the memory engine
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.vectorDb.initialize();

    // Auto-migrate from legacy vectors.hnsw if it exists
    const hnswPath = join(this.config.dataDir, 'vectors.hnsw');
    this.vectorDb.migrateFromHNSW(hnswPath);

    await this.causal.initialize();
    this.sona.initialize();
    this.memrl.initialize();

    // Start periodic flush (every 30 seconds)
    this.embeddingQueue.startPeriodicFlush(30000);

    // CRITICAL: Recover any pending embeddings from previous sessions
    // that were stored in SQLite but never got their embeddings generated
    await this.recoverPendingEmbeddings();

    this.initialized = true;
  }

  /**
   * Recover pending embeddings from previous sessions
   *
   * On startup, entries may exist in SQLite with pending_embedding=1
   * if the process ended before flush(). This re-queues them for embedding.
   */
  private async recoverPendingEmbeddings(): Promise<void> {
    const pending = this.storage.getPendingEntries();
    if (pending.length === 0) {
      return;
    }

    console.log(`[MemoryEngine] Recovering ${pending.length} pending embeddings from previous session...`);

    // Re-queue all pending entries
    for (const entry of pending) {
      this.embeddingQueue.queue(entry.id, entry.content, entry.label);
    }

    // Flush immediately to generate embeddings
    const result = await this.embeddingQueue.flush();

    if (result.processed > 0) {
      // Clear pending flags for successfully embedded entries
      const successIds = pending
        .filter(e => !result.failed.includes(e.id))
        .map(e => e.id);

      if (successIds.length > 0) {
        this.storage.clearPendingEmbedding(successIds);
      }

      console.log(`[MemoryEngine] Recovered ${result.processed} embeddings (${result.failed.length} failed)`);
    }

    if (result.failed.length > 0) {
      console.warn(`[MemoryEngine] Failed to recover embeddings for: ${result.failed.join(', ')}`);
    }
  }

  // ==========================================
  // STORE OPERATIONS
  // ==========================================

  /**
   * Store content in memory with embedding and provenance
   *
   * @throws {ProvenanceThresholdError} If L-Score is below threshold and enforcement is enabled
   */
  async store(content: string, options: StoreOptions = {}): Promise<MemoryEntry> {
    await this.ensureInitialized();

    const id = uuidv4();
    const now = new Date();

    // Calculate lineage depth and collect parent info for L-Score
    // NOTE: L-Score does NOT depend on embeddings - only provenance metadata
    const parentIds = options.parentIds ?? [];
    let lineageDepth = 0;
    const parentLScores: number[] = [];

    if (parentIds.length > 0) {
      for (const pid of parentIds) {
        const parent = this.storage.getEntry(pid);
        if (parent) {
          lineageDepth = Math.max(lineageDepth, parent.provenance.lineageDepth);
          parentLScores.push(parent.provenance.lScore ?? 1.0);
        }
      }
      lineageDepth += 1;
    }

    // Calculate L-Score BEFORE storing (to enforce threshold)
    const confidence = options.confidence ?? 1.0;
    const relevance = options.relevance ?? 1.0;
    let lScore: number;

    if (parentIds.length === 0) {
      // Root entry - L-Score is 1.0
      lScore = 1.0;
    } else {
      // Derived entry - calculate from parent L-Scores
      const lScoreCalc = this.provenance.getLScoreCalculator();
      const aggregatedParentLScore = lScoreCalc.aggregateFromParents(parentLScores);
      lScore = lScoreCalc.calculateIncremental(aggregatedParentLScore, confidence, relevance);
    }

    // Enforce L-Score threshold if enabled
    if (this.config.lScoreConfig.enforceThreshold) {
      const threshold = this.config.lScoreConfig.threshold;
      if (lScore < threshold) {
        throw new ProvenanceThresholdError(lScore, threshold);
      }
    }

    // Create memory entry WITHOUT embedding (deferred to batch processing)
    const entry: MemoryEntry = {
      id,
      content,
      embedding: new Float32Array(0), // Placeholder - will be populated on flush
      metadata: {
        source: options.source ?? MemorySource.USER_INPUT,
        tags: options.tags ?? [],
        importance: options.importance ?? 0.5,
        context: options.context,
        sessionId: options.sessionId,
        agentId: options.agentId
      },
      provenance: {
        parentIds,
        lineageDepth,
        confidence,
        relevance,
        lScore
      },
      createdAt: now,
      updatedAt: now
    };

    // Store in SQLite
    this.storage.storeEntry(entry);

    // OPTIMIZED: Invalidate query cache when data changes
    this.queryCache.invalidate();

    // Get vector label and queue for deferred batch embedding
    const label = this.storage.storeVectorMapping(id);
    this.embeddingQueue.queue(id, content, label);

    // Mark as pending embedding
    this.storage.setPendingEmbedding(id, true);

    // Update stored L-Score (for consistency with provenance store)
    this.storage.updateLScore(id, lScore);

    // Auto-flush if threshold reached
    if (this.embeddingQueue.pendingCount >= this.flushThreshold) {
      const result = await this.embeddingQueue.flush();
      if (result.processed > 0) {
        // Clear pending flags for successfully embedded entries
        const successIds = Array.from(this.embeddingQueue['pending'].keys()).filter(
          id => !result.failed.includes(id)
        );
        if (successIds.length > 0) {
          this.storage.clearPendingEmbedding(successIds);
        }
      }
    }

    // Auto-detect causal relations (non-blocking, non-critical)
    const tags = options.tags ?? [];
    if (tags.length > 0) {
      this.detectCausalRelationsAsync(entry.id, tags, content);
    }

    return entry;
  }

  /**
   * Run causal detection asynchronously without blocking store().
   * Errors are logged but never propagated.
   */
  private detectCausalRelationsAsync(entryId: string, tags: string[], content: string): void {
    this.causalDetector.detectAndLink(entryId, tags, content).then(result => {
      if (result.relations.length > 0) {
        console.log(
          `[CausalDetector] Auto-created ${result.relations.length} relation(s) via: ${result.strategies.join(', ')}`
        );
      }
    }).catch(err => {
      console.error('[CausalDetector] Async detection error:', err);
    });
  }

  /**
   * Get an entry by ID
   */
  getEntry(id: string): MemoryEntry | null {
    return this.storage.getEntry(id);
  }

  /**
   * Delete an entry
   */
  deleteEntry(id: string): boolean {
    const result = this.storage.deleteEntry(id);
    if (result) {
      // OPTIMIZED: Invalidate query cache when data changes
      this.queryCache.invalidate();
    }
    return result;
  }

  /**
   * Update an existing memory entry
   * If content changes, the embedding will be regenerated
   */
  async updateEntry(id: string, updates: {
    content?: string;
    tags?: string[];
    importance?: number;
    source?: MemorySource;
  }): Promise<MemoryEntry | null> {
    await this.ensureInitialized();

    const entry = this.storage.getEntry(id);
    if (!entry) return null;

    // If content changed, need to re-embed
    if (updates.content !== undefined && updates.content !== entry.content) {
      const { embedding } = await this.embeddings.embed(updates.content);

      // Update vector in index
      const label = this.storage.getVectorLabel(id);
      if (label !== null) {
        this.vectorDb.update(label, embedding);
      }
    }

    // Update in SQLite
    const success = this.storage.updateEntry(id, updates);
    if (!success) return null;

    // OPTIMIZED: Invalidate query cache when data changes
    this.queryCache.invalidate();

    return this.storage.getEntry(id);
  }

  // ==========================================
  // QUERY OPERATIONS
  // ==========================================

  /**
   * Query memory by semantic similarity
   */
  async query(text: string, options: QueryOptions = {}): Promise<QueryResult[]> {
    await this.ensureInitialized();

    // FLUSH pending embeddings before semantic search
    if (this.embeddingQueue.pendingCount > 0) {
      await this.embeddingQueue.flush();
    }

    // OPTIMIZED: Check cache first
    const cached = this.queryCache.get(text, options);
    if (cached) {
      return cached;
    }

    const topK = options.topK ?? 10;
    const minScore = options.minScore ?? 0.0;

    // Pre-filter by tags if specified (get candidate entry IDs)
    let tagCandidates: Set<string> | null = null;
    if (options.filters?.tags && options.filters.tags.length > 0) {
      // Use tagMatchAll option (default: true for AND logic, false for OR logic)
      const matchAll = options.filters.tagMatchAll ?? true;
      const taggedIds = this.storage.getEntryIdsByTags(options.filters.tags, matchAll);
      if (taggedIds.length === 0) {
        return []; // No entries have the requested tags
      }
      tagCandidates = new Set(taggedIds);
    }

    // Generate query embedding
    const { embedding } = await this.embeddings.embed(text);

    // Search vector index - fetch more candidates for MemRL Phase A/B ranking
    // MemRL needs more candidates to effectively apply Q-value re-ranking
    // Cap at 4096 — sqlite-vec KNN hard limit
    const searchLimit = Math.min(tagCandidates ? 4096 : Math.max(topK * 5, 50), 4096);
    const vectorResults = this.vectorDb.search(embedding, searchLimit);

    // ============================================
    // MemRL TWO-PHASE RETRIEVAL (if enabled)
    // ============================================
    if (this.memrl.isEnabled()) {
      return this.queryWithMemRL(text, vectorResults, tagCandidates, options, topK, minScore);
    }

    // ============================================
    // LEGACY: Simple similarity-based retrieval
    // ============================================
    const results: QueryResult[] = [];

    for (const vr of vectorResults) {
      if (vr.score < minScore) continue;

      // Get entry ID from label
      const entryId = this.storage.getEntryIdByLabel(vr.label);
      if (!entryId) continue;

      // Pre-filter by tags (skip if not in tag candidates)
      if (tagCandidates && !tagCandidates.has(entryId)) continue;

      const entry = this.storage.getEntry(entryId);
      if (!entry) continue;

      // Apply remaining filters (excluding tags - already handled above)
      if (options.filters) {
        if (!this.matchesFiltersExcludingTags(entry, options.filters)) continue;
      }

      // Get L-Score if requested
      let lScore: number | undefined;
      if (options.includeProvenance) {
        lScore = entry.provenance.lScore ?? this.provenance.calculateAndStoreLScore(entryId);
      }

      results.push({
        entry,
        score: vr.score,
        matchType: 'vector',
        lScore
      });

      if (results.length >= topK) break;
    }

    // FALLBACK: If tag filtering is specified but vector search returned too few results,
    // entries may exist by tags but have no embeddings (pending_embedding=1).
    // Fall back to SQLite-only retrieval for those entries.
    if (tagCandidates && results.length < topK) {
      const foundIds = new Set(results.map(r => r.entry.id));
      const missingIds = [...tagCandidates].filter(id => !foundIds.has(id));

      if (missingIds.length > 0) {
        console.log(`[MemoryEngine] Falling back to SQLite for ${missingIds.length} entries without embeddings`);

        for (const id of missingIds.slice(0, topK - results.length)) {
          const entry = this.storage.getEntry(id);
          if (!entry) continue;

          // Apply remaining filters
          if (options.filters && !this.matchesFiltersExcludingTags(entry, options.filters)) {
            continue;
          }

          // Get L-Score if requested
          let lScore: number | undefined;
          if (options.includeProvenance) {
            lScore = entry.provenance.lScore ?? this.provenance.calculateAndStoreLScore(id);
          }

          results.push({
            entry,
            score: 0.5, // Default score for tag-only matches
            matchType: 'tag-only' as const,
            lScore
          });
        }

        if (results.length > topK) {
          results.length = topK;
        }
      }
    }

    // OPTIMIZED: Cache the results for future queries
    this.queryCache.set(text, options, results);

    return results;
  }

  /**
   * MemRL-enhanced query with two-phase retrieval
   *
   * Phase A: Filter by similarity threshold (delta)
   * Phase B: Re-rank using composite score = (1-lambda)*similarity + lambda*Q-value
   */
  private async queryWithMemRL(
    text: string,
    vectorResults: Array<{ label: number; score: number; distance: number }>,
    tagCandidates: Set<string> | null,
    options: QueryOptions,
    topK: number,
    minScore: number
  ): Promise<QueryResult[]> {
    // Apply tag and metadata filtering BEFORE MemRL ranking
    const filteredResults: Array<{ label: number; score: number; entryId: string }> = [];

    for (const vr of vectorResults) {
      if (vr.score < minScore) continue;

      const entryId = this.storage.getEntryIdByLabel(vr.label);
      if (!entryId) continue;

      // Tag filtering
      if (tagCandidates && !tagCandidates.has(entryId)) continue;

      // Metadata filtering
      if (options.filters) {
        const entry = this.storage.getEntry(entryId);
        if (!entry || !this.matchesFiltersExcludingTags(entry, options.filters)) continue;
      }

      filteredResults.push({ label: vr.label, score: vr.score, entryId });
    }

    // FALLBACK: If no vector results but tag candidates exist,
    // entries may have tags but no embeddings yet. Fall back to SQLite.
    if (filteredResults.length === 0 && tagCandidates && tagCandidates.size > 0) {
      console.log(`[MemoryEngine] MemRL: No vector results, falling back to SQLite for ${tagCandidates.size} tag candidates`);
      return this.fallbackToSQLiteForTags(tagCandidates, options, topK);
    }

    if (filteredResults.length === 0) {
      return [];
    }

    // Use MemRL for Phase A + Phase B ranking
    const memrlResult = this.memrl.processVectorResults(
      text,
      filteredResults.map(r => ({ label: r.label, score: r.score })),
      topK
    );

    // Store the query ID for potential feedback (accessible via getLastMemRLQueryId)
    this._lastMemRLQueryId = memrlResult.queryId;

    // Convert MemRL results to QueryResult format
    const results: QueryResult[] = [];
    for (const mr of memrlResult.results) {
      const entry = this.storage.getEntry(mr.entryId);
      if (!entry) continue;

      let lScore: number | undefined;
      if (options.includeProvenance) {
        lScore = entry.provenance.lScore ?? this.provenance.calculateAndStoreLScore(mr.entryId);
      }

      results.push({
        entry,
        score: mr.compositeScore, // Use MemRL composite score
        matchType: 'vector',
        lScore
      });
    }

    // FALLBACK: If tag filtering but results < topK, some entries may lack embeddings
    if (tagCandidates && results.length < topK) {
      const foundIds = new Set(results.map(r => r.entry.id));
      const missingIds = [...tagCandidates].filter(id => !foundIds.has(id));

      if (missingIds.length > 0) {
        console.log(`[MemoryEngine] MemRL: Supplementing with ${missingIds.length} SQLite-only entries`);

        for (const id of missingIds.slice(0, topK - results.length)) {
          const entry = this.storage.getEntry(id);
          if (!entry) continue;

          if (options.filters && !this.matchesFiltersExcludingTags(entry, options.filters)) {
            continue;
          }

          let lScore: number | undefined;
          if (options.includeProvenance) {
            lScore = entry.provenance.lScore ?? this.provenance.calculateAndStoreLScore(id);
          }

          results.push({
            entry,
            score: 0.5,
            matchType: 'tag-only' as const,
            lScore
          });
        }
      }
    }

    // Cache the results
    this.queryCache.set(text, options, results);

    return results;
  }

  /**
   * Helper: Fall back to SQLite-only retrieval for tag candidates without embeddings
   */
  private fallbackToSQLiteForTags(
    tagCandidates: Set<string>,
    options: QueryOptions,
    topK: number
  ): QueryResult[] {
    const results: QueryResult[] = [];

    for (const id of tagCandidates) {
      const entry = this.storage.getEntry(id);
      if (!entry) continue;

      if (options.filters && !this.matchesFiltersExcludingTags(entry, options.filters)) {
        continue;
      }

      let lScore: number | undefined;
      if (options.includeProvenance) {
        lScore = entry.provenance.lScore ?? this.provenance.calculateAndStoreLScore(id);
      }

      results.push({
        entry,
        score: 0.5, // Default score for SQLite-only matches
        matchType: 'tag-only' as const,
        lScore
      });

      if (results.length >= topK) break;
    }

    // Cache the results
    this.queryCache.set('', options, results);

    return results;
  }

  // Track last MemRL query ID for feedback
  private _lastMemRLQueryId: string | null = null;

  /**
   * Get the query ID from the last MemRL-enhanced query
   * Use this with provideMemRLFeedback() to update Q-values
   */
  getLastMemRLQueryId(): string | null {
    return this._lastMemRLQueryId;
  }

  /**
   * Check if entry matches query filters (excluding tags - tags are pre-filtered via SQLite)
   */
  private matchesFiltersExcludingTags(entry: MemoryEntry, filters: QueryOptions['filters']): boolean {
    if (!filters) return true;

    if (filters.sources && !filters.sources.includes(entry.metadata.source)) {
      return false;
    }

    // Skip tag check - tags are pre-filtered in query()

    if (filters.dateRange) {
      const created = entry.createdAt;
      if (created < filters.dateRange.start || created > filters.dateRange.end) {
        return false;
      }
    }

    if (filters.minImportance !== undefined && entry.metadata.importance < filters.minImportance) {
      return false;
    }

    if (filters.sessionId && entry.metadata.sessionId !== filters.sessionId) {
      return false;
    }

    if (filters.agentId && entry.metadata.agentId !== filters.agentId) {
      return false;
    }

    return true;
  }

  // ==========================================
  // SHADOW SEARCH OPERATIONS
  // ==========================================

  /**
   * Search for contradictory evidence using shadow vectors
   *
   * This inverts the query embedding (v × -1) to find entries that
   * semantically oppose the query. Useful for:
   * - Risk assessment (find reasons a trade might fail)
   * - Bias detection (ensure not only seeing confirming evidence)
   * - Devil's advocate (generate counter-arguments)
   */
  async shadowQuery(
    text: string,
    options: ShadowSearchOptions = {}
  ): Promise<ShadowSearchResult> {
    await this.ensureInitialized();

    // FLUSH pending embeddings before shadow search
    if (this.embeddingQueue.pendingCount > 0) {
      await this.embeddingQueue.flush();
    }

    return this.shadowSearch.search(
      text,
      this.vectorDb,
      this.embeddings,
      this.storage,
      this.provenance,
      options
    );
  }

  /**
   * Quick check if a claim has significant contradictions
   * Returns true if credibility is below threshold (default 0.5)
   */
  async isContested(
    text: string,
    credibilityThreshold: number = 0.5
  ): Promise<boolean> {
    await this.ensureInitialized();

    return this.shadowSearch.isContested(
      text,
      this.vectorDb,
      this.embeddings,
      this.storage,
      this.provenance,
      credibilityThreshold
    );
  }

  // ==========================================
  // LEARNING OPERATIONS (SONA)
  // ==========================================

  /**
   * Query with learning support
   *
   * Same as query() but returns a trajectoryId for later feedback.
   * Call provideFeedback() with the trajectoryId to improve future results.
   */
  async queryWithLearning(
    text: string,
    options: QueryOptions = {}
  ): Promise<{ results: QueryResult[]; trajectoryId: string }> {
    await this.ensureInitialized();

    // Perform standard query
    const results = await this.query(text, options);

    // Create trajectory to track this query
    const matchedIds = results.map(r => r.entry.id);
    const matchScores = results.map(r => r.score);

    const trajectoryId = this.sona.createTrajectory(
      text,
      matchedIds,
      matchScores,
      undefined, // Could add embedding here
      'semantic_search'
    );

    return { results, trajectoryId };
  }

  /**
   * Provide feedback for a query trajectory
   *
   * Call this after evaluating how useful query results were.
   * Quality should be 0-1 (0 = useless, 1 = perfect results).
   */
  async provideFeedback(
    trajectoryId: string,
    quality: number,
    route?: string
  ): Promise<FeedbackResult> {
    await this.ensureInitialized();
    return this.sona.provideFeedback(trajectoryId, quality, route);
  }

  /**
   * Get learning statistics
   */
  getLearningStats(): LearningStats {
    return this.sona.getStats();
  }

  /**
   * Get pending feedback trajectories
   */
  getPendingFeedback(limit: number = 10): Trajectory[] {
    return this.sona.getPendingFeedback(limit);
  }

  /**
   * Get a specific trajectory
   */
  getTrajectory(id: string): Trajectory | null {
    return this.sona.getTrajectory(id);
  }

  /**
   * Check drift in learning weights
   */
  checkLearningDrift(): { drift: number; status: string } {
    const metrics = this.sona.checkDrift();
    return { drift: metrics.drift, status: metrics.status };
  }

  /**
   * Create a learning checkpoint
   */
  createLearningCheckpoint(): string {
    return this.sona.createCheckpoint();
  }

  /**
   * Rollback learning to latest checkpoint
   */
  rollbackLearning(): boolean {
    return this.sona.rollbackToLatest();
  }

  /**
   * Run auto-maintenance on learning weights
   * - Prunes consistently failing patterns
   * - Boosts consistently successful patterns
   */
  maintainLearning(): { pruned: number; boosted: number } {
    const pruneResult = this.sona.autoPrune();
    const boostResult = this.sona.autoBoost();
    return {
      pruned: pruneResult.pruned,
      boosted: boostResult.boosted
    };
  }

  // ==========================================
  // MEMRL Q-VALUE LEARNING
  // ==========================================

  /**
   * Provide feedback for a MemRL query to update Q-values
   *
   * Uses EMA update: Q_new = Q_old + alpha * (reward - Q_old)
   * This updates the Q-values for entries returned in the query.
   */
  async provideMemRLFeedback(
    queryId: string,
    reward: number,
    entryRewards?: Map<string, number>
  ): Promise<{ success: boolean; entriesUpdated: number; avgQChange: number; message: string }> {
    await this.ensureInitialized();
    return this.memrl.provideFeedback({
      queryId,
      globalReward: reward,
      entryRewards
    });
  }

  /**
   * Provide combined feedback for both MemRL (Q-values) and Sona (pattern weights)
   *
   * Call this after evaluating query results to update both learning systems.
   */
  async provideCombinedFeedback(
    queryId: string | null,
    trajectoryId: string | null,
    quality: number,
    route?: string
  ): Promise<{
    memrl: { entriesUpdated: number; avgQChange: number } | null;
    sona: { weightsUpdated: number; driftScore: number; driftStatus: string } | null;
  }> {
    await this.ensureInitialized();

    let memrlResult = null;
    let sonaResult = null;

    // Update MemRL Q-values if queryId provided
    if (queryId) {
      const result = await this.memrl.provideFeedback({
        queryId,
        globalReward: quality
      });
      if (result.success) {
        memrlResult = {
          entriesUpdated: result.entriesUpdated,
          avgQChange: result.avgQChange
        };
      }
    }

    // Update Sona pattern weights if trajectoryId provided
    if (trajectoryId) {
      const result = await this.sona.provideFeedback(trajectoryId, quality, route);
      if (result.success) {
        sonaResult = {
          weightsUpdated: result.weightsUpdated,
          driftScore: result.driftScore,
          driftStatus: result.driftStatus
        };
      }
    }

    return { memrl: memrlResult, sona: sonaResult };
  }

  /**
   * Get MemRL statistics
   */
  getMemRLStats(): {
    totalEntries: number;
    entriesWithQUpdates: number;
    avgQValue: number;
    qValueDistribution: { low: number; medium: number; high: number };
    totalQueries: number;
    queriesWithFeedback: number;
    feedbackRate: number;
    config: { delta: number; lambda: number; alpha: number; enabled: boolean };
  } {
    return this.memrl.getStats();
  }

  /**
   * Get the MemRL engine for direct access
   */
  getMemRLEngine(): MemRLEngine {
    return this.memrl;
  }

  /**
   * Update MemRL configuration
   */
  updateMemRLConfig(updates: { delta?: number; lambda?: number; alpha?: number; enabled?: boolean }): void {
    this.memrl.updateConfig(updates);
  }

  // ==========================================
  // PROVENANCE OPERATIONS
  // ==========================================

  /**
   * Trace provenance lineage for an entry
   */
  trace(id: string, maxDepth: number = 10): ProvenanceChain {
    return this.provenance.traceLineage(id, maxDepth);
  }

  /**
   * Get flattened lineage trace
   */
  getLineageTrace(id: string, maxDepth: number = 10): LineageTraceResult {
    return this.provenance.getLineageTrace(id, maxDepth);
  }

  /**
   * Check if an entry has reliable provenance
   */
  isReliable(id: string, threshold: number = 0.5): boolean {
    return this.provenance.isReliable(id, threshold);
  }

  /**
   * Get reliability category for an entry
   */
  getReliabilityCategory(id: string): 'high' | 'medium' | 'low' | 'unreliable' {
    return this.provenance.getReliabilityCategory(id);
  }

  // ==========================================
  // CAUSAL OPERATIONS
  // ==========================================

  /**
   * Add a causal relationship
   */
  addCausalRelation(
    sourceIds: string[],
    targetIds: string[],
    type: CausalRelationType,
    strength: number = 0.8,
    options?: {
      metadata?: Record<string, unknown>;
      /** Time-to-live in milliseconds. Relation expires after this duration. */
      ttl?: number;
    }
  ): CausalRelation {
    return this.causal.addRelation(sourceIds, targetIds, type, strength, options);
  }

  /**
   * Get causal relation by ID
   */
  getCausalRelation(id: string): CausalRelation | null {
    return this.causal.getRelation(id);
  }

  /**
   * Find causal relationships for an entry
   */
  getCausalRelationsForEntry(
    entryId: string,
    direction: 'forward' | 'backward' | 'both' = 'both'
  ): CausalRelation[] {
    return this.causal.getRelationsForEntry(entryId, direction);
  }

  /**
   * Traverse causal graph
   */
  traverseCausal(query: CausalQuery): CausalTraversalResult {
    return this.causal.traverse(query);
  }

  /**
   * Find causal paths between entries
   */
  findCausalPaths(sourceId: string, targetId: string, maxDepth: number = 10): CausalPath[] {
    return this.causal.findPaths(sourceId, targetId, maxDepth);
  }

  /**
   * Find effects of an entry
   */
  findEffects(entryId: string, maxDepth: number = 5): string[] {
    return this.causal.findEffects(entryId, maxDepth);
  }

  /**
   * Find causes of an entry
   */
  findCauses(entryId: string, maxDepth: number = 5): string[] {
    return this.causal.findCauses(entryId, maxDepth);
  }

  /**
   * Export causal graph as Mermaid diagram
   */
  causalToMermaid(): string {
    return this.causal.toMermaid();
  }

  /**
   * Get count of expired causal relations
   */
  getExpiredRelationCount(): number {
    return this.causal.getExpiredCount();
  }

  /**
   * Get expired causal relations (for inspection before cleanup)
   */
  getExpiredRelations(): CausalRelation[] {
    return this.causal.getExpiredRelations();
  }

  /**
   * Clean up expired causal relations
   *
   * Removes relations from both storage and in-memory graph.
   * Useful for maintaining fresh market correlations that naturally expire.
   *
   * @returns Object with count of cleaned relations and their IDs
   */
  cleanupExpiredRelations(): { cleaned: number; relationIds: string[] } {
    return this.causal.cleanupExpired();
  }

  /**
   * Detect causal relations for a session store with structured context.
   * Called from god_session_store handler after entry is stored.
   */
  async detectSessionCausalLinks(
    sessionEntryId: string,
    context: {
      decisions?: string[];
      patterns?: string[];
      filesChanged?: string[];
      tags: string[];
      content: string;
    }
  ): Promise<CausalDetectorResult> {
    return this.causalDetector.detectAndLinkSession(sessionEntryId, context);
  }

  // ==========================================
  // PATTERN OPERATIONS
  // ==========================================

  /**
   * Register a pattern template
   */
  registerPattern(
    name: string,
    pattern: string,
    slots: PatternSlot[],
    priority: number = 0
  ): void {
    this.patterns.registerTemplate(name, pattern, slots, priority);
  }

  /**
   * Match text against patterns
   */
  matchPatterns(text: string): PatternMatch[] {
    return this.patterns.match(text);
  }

  /**
   * Extract structured data using patterns
   */
  extractPatterns(text: string): Record<string, Record<string, string>> {
    return this.patterns.extract(text);
  }

  /**
   * Get the pattern matcher for direct access to pattern operations
   * Used for advanced pattern management like success tracking and pruning
   */
  getPatternMatcher(): PatternMatcher {
    return this.patterns;
  }

  /**
   * Get the storage layer for direct database access
   * Used by scheduler and other components that need direct SQLite access
   */
  getStorage(): SQLiteStorage {
    return this.storage;
  }

  getVectorDb(): VectorDB { return this.vectorDb; }
  getEmbeddingService(): EmbeddingService { return this.embeddings; }
  getShadowSearch(): ShadowSearch { return this.shadowSearch; }
  getProvenanceStore(): ProvenanceStore { return this.provenance; }

  // ==========================================
  // GNN ENHANCEMENT OPERATIONS
  // ==========================================

  /**
   * Enhance an entry's embedding using GNN (graph context)
   *
   * Uses the causal and provenance graph to enrich the embedding
   * with structural context from connected entries.
   *
   * @param entryId - The entry to enhance
   * @returns Enhanced embedding result (768-dim → 1024-dim)
   */
  async enhanceEntry(entryId: string): Promise<EnhancementResult | null> {
    await this.ensureInitialized();

    const entry = this.storage.getEntry(entryId);
    if (!entry) return null;

    // Get the embedding for this entry
    const label = this.storage.getVectorLabel(entryId);
    if (label === null) return null;

    // We need to get the embedding - generate it from content
    const { embedding } = await this.embeddings.embed(entry.content);

    // Create embedding lookup function for neighbors
    const embeddingLookup = (id: string): Float32Array | null => {
      const neighborLabel = this.storage.getVectorLabel(id);
      if (neighborLabel === null) return null;
      return this.vectorDb.getVector(neighborLabel);
    };

    return this.gnn.enhance(entryId, embedding, embeddingLookup);
  }

  /**
   * Get GNN-enhanced statistics
   */
  getGNNStats(): GNNStats {
    return this.gnn.getStats();
  }

  /**
   * Clear GNN enhancement cache
   */
  clearGNNCache(): void {
    this.gnn.clearCache();
  }

  /**
   * Get the enhancement layer for direct access
   */
  getEnhancementLayer(): EnhancementLayer {
    return this.gnn;
  }

  // ==========================================
  // ROUTING OPERATIONS (Tiny Dancer)
  // ==========================================

  /**
   * Route a query to the optimal reasoning strategy
   *
   * Uses Tiny Dancer to analyze the query and determine the best
   * reasoning approach (pattern match, causal, hybrid, etc.)
   *
   * @param query - The query text to route
   * @param options - Optional routing context
   * @returns Routing decision with selected route and confidence
   */
  routeQuery(
    query: string,
    options?: {
      preferredRoute?: ReasoningRoute;
      previousRoute?: ReasoningRoute;
      metadata?: Record<string, unknown>;
    }
  ): RoutingDecision {
    const context: QueryContext = {
      query,
      preferredRoute: options?.preferredRoute as ReasoningRoute | undefined,
      previousRoute: options?.previousRoute as ReasoningRoute | undefined,
      metadata: options?.metadata
    };

    return this.router.route(context);
  }

  /**
   * Record the result of executing a routed query
   *
   * Used to update circuit breaker state and improve routing over time.
   *
   * @param route - The route that was used
   * @param success - Whether execution was successful
   */
  recordRoutingResult(route: ReasoningRoute, success: boolean): void {
    this.router.recordResult(route, success);
  }

  /**
   * Get routing statistics
   */
  getRoutingStats(): RoutingStats {
    return this.router.getStats();
  }

  /**
   * Get circuit breaker status for all routes
   */
  getCircuitStatus(): ReturnType<TinyDancer['getCircuitStatus']> {
    return this.router.getCircuitStatus();
  }

  /**
   * Reset a circuit breaker for a specific route
   */
  resetCircuit(route: ReasoningRoute): void {
    this.router.getCircuitBreaker().reset(route);
  }

  /**
   * Reset all circuit breakers
   */
  resetAllCircuits(): void {
    this.router.getCircuitBreaker().resetAll();
  }

  /**
   * Check if a route can accept requests (circuit not open)
   */
  canUseRoute(route: ReasoningRoute): boolean {
    return this.router.getCircuitBreaker().canAttempt(route);
  }

  /**
   * Get the TinyDancer router for direct access
   */
  getRouter(): TinyDancer {
    return this.router;
  }

  // ==========================================
  // STATISTICS
  // ==========================================

  /**
   * Get memory system statistics
   */
  getStats(): MemoryStats {
    const storageStats = this.storage.getStats();

    return {
      totalEntries: storageStats.totalEntries,
      vectorCount: storageStats.vectorCount,
      causalRelations: storageStats.causalRelations,
      patternTemplates: storageStats.patternTemplates,
      avgLScore: storageStats.avgLScore,
      avgSearchLatency: 0, // Would need actual measurement
      dataSize: 0, // Would need file size calculation
      compressionTiers: storageStats.compressionTiers
    };
  }

  /**
   * Get compression statistics
   */
  getCompressionStats(): {
    vectorCount: number;
    tierDistribution: Record<string, number>;
    estimatedMemorySaved: number;
    maxAccessCount: number;
  } {
    const tierCounts = this.storage.getCompressionTierCounts();
    const vectorCount = this.storage.getStats().vectorCount;
    const maxAccessCount = this.storage.getMaxVectorAccessCount();

    // Calculate estimated memory saved
    // Base: 768 dims × 4 bytes = 3072 bytes per vector
    // Hot: 100%, Warm: 50%, Cool: 12.5%, Cold: 6.25%, Frozen: 3.125%
    const FULL_SIZE = 768 * 4;
    const TIER_RATIOS: Record<string, number> = {
      hot: 1.0,
      warm: 0.5,
      cool: 0.125,
      cold: 0.0625,
      frozen: 0.03125
    };

    let compressedSize = 0;
    let uncompressedSize = 0;

    for (const [tier, count] of Object.entries(tierCounts)) {
      uncompressedSize += count * FULL_SIZE;
      compressedSize += count * FULL_SIZE * (TIER_RATIOS[tier] ?? 1.0);
    }

    return {
      vectorCount,
      tierDistribution: tierCounts,
      estimatedMemorySaved: uncompressedSize - compressedSize,
      maxAccessCount
    };
  }

  /**
   * Record an access to a vector (for compression tier management)
   */
  recordVectorAccess(entryId: string): void {
    const label = this.storage.getVectorLabel(entryId);
    if (label !== null) {
      this.storage.recordVectorAccess(label);
    }
  }

  // ==========================================
  // LIFECYCLE
  // ==========================================

  /**
   * Assimilate to new codebase - wipe project data, keep system knowledge
   *
   * Preserves entries tagged with SYSTEM_TAGS (rubix:core, rubix:learning, etc.)
   * Deletes all other entries (project-specific context, tasks, conversations)
   *
   * @returns Count of deleted and preserved entries
   */
  async assimilate(): Promise<{ deleted: number; preserved: number }> {
    await this.ensureInitialized();

    console.log('[MemoryEngine] Starting assimilation...');
    console.log(`[MemoryEngine] Preserving tags: ${SYSTEM_TAGS.join(', ')}`);

    // Count entries to preserve
    const preserveIds = this.storage.getEntryIdsByTags([...SYSTEM_TAGS]);
    const preserved = preserveIds.length;

    console.log(`[MemoryEngine] Found ${preserved} entries to preserve`);

    // Delete non-system entries
    const deleted = this.storage.deleteEntriesExceptTags([...SYSTEM_TAGS]);

    console.log(`[MemoryEngine] Deleted ${deleted} project entries`);

    // Rebuild vector index to remove orphaned vectors
    if (deleted > 0) {
      console.log('[MemoryEngine] Rebuilding vector index...');
      // Re-initialize vector DB with remaining entries
      await this.rebuildVectorIndex();
    }

    console.log('[MemoryEngine] Assimilation complete');

    return { deleted, preserved };
  }

  /**
   * Rebuild vector index from remaining entries
   */
  private async rebuildVectorIndex(): Promise<void> {
    // Clear orphaned vector mappings from deleted entries
    const orphanedCount = this.storage.clearOrphanedVectorMappings();
    console.log(`[MemoryEngine] Cleared ${orphanedCount} orphaned vector mappings`);

    // Get all remaining entries directly from storage
    const allEntries = this.storage.getAllEntries();
    console.log(`[MemoryEngine] Rebuilding vector index for ${allEntries.length} entries`);

    // Clear remaining vector mappings for full rebuild
    this.storage.clearAllVectorMappings();

    // Create new VectorDB with proper config
    this.vectorDb = new VectorDB(
      {
        dimensions: this.config.vectorDimensions,
        maxElements: this.config.vectorConfig.maxElements,
      },
      this.storage.getDb()
    );
    await this.vectorDb.initialize();

    // Re-add vectors for remaining entries
    for (const entry of allEntries) {
      const { embedding } = await this.embeddings.embed(entry.content);
      const label = this.storage.storeVectorMapping(entry.id);
      this.vectorDb.add(label, embedding);
    }

    console.log('[MemoryEngine] Vector index rebuilt successfully');
  }

  /**
   * Ensure engine is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  /**
   * Flush all pending embeddings immediately
   *
   * Call this proactively before session save or at critical checkpoints
   * to ensure embeddings are persisted and entries become searchable.
   *
   * @returns Number of successfully processed embeddings
   */
  async flushPendingEmbeddings(): Promise<number> {
    await this.ensureInitialized();

    if (this.embeddingQueue.pendingCount === 0) {
      return 0;
    }

    console.log(`[MemoryEngine] Flushing ${this.embeddingQueue.pendingCount} pending embeddings...`);
    const result = await this.embeddingQueue.flush();

    return result.processed;
  }

  /**
   * Get count of pending embeddings
   */
  getPendingEmbeddingCount(): number {
    return this.embeddingQueue.pendingCount;
  }

  /**
   * Close the memory engine
   */
  async close(): Promise<void> {
    // Flush any pending embeddings before shutdown
    if (this.embeddingQueue.pendingCount > 0) {
      console.log(`[MemoryEngine] Flushing ${this.embeddingQueue.pendingCount} pending embeddings before close...`);
      await this.embeddingQueue.flush();
    }
    this.embeddingQueue.stopPeriodicFlush();

    this.storage.close();
    this.initialized = false;
  }

  /**
   * Get configuration
   */
  getConfig(): MemoryEngineConfig {
    return { ...this.config };
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}
