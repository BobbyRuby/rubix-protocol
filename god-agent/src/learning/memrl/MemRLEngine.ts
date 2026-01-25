/**
 * MemRL Engine
 *
 * Memory Reinforcement Learning engine implementing the two-phase retrieval
 * system from the paper "MemRL: Self-Evolving Agents via Runtime Reinforcement
 * Learning on Episodic Memory".
 *
 * Key features:
 * - Phase A: Similarity-based filtering with threshold delta
 * - Phase B: Utility-aware ranking with composite score
 * - EMA Q-value updates: Q_new = Q_old + alpha(reward - Q_old)
 * - Convergence guarantees from the paper
 *
 * Integrates at the core level alongside Sona pattern-level learning.
 */

import { randomUUID } from 'crypto';
import type { SQLiteStorage } from '../../storage/SQLiteStorage.js';
import type { VectorDB } from '../../vector/VectorDB.js';
import type {
  MemRLConfig,
  PhaseACandidate,
  PhaseBResult,
  MemRLQueryResult,
  MemRLFeedback,
  MemRLFeedbackResult,
  MemRLStats
} from './types.js';
import { DEFAULT_MEMRL_CONFIG } from './types.js';

export class MemRLEngine {
  private config: MemRLConfig;
  private storage: SQLiteStorage;
  private initialized: boolean = false;

  constructor(
    storage: SQLiteStorage,
    _vectorDb: VectorDB, // Kept in signature for consistent API with other engines
    config?: Partial<MemRLConfig>
  ) {
    this.storage = storage;
    this.config = { ...DEFAULT_MEMRL_CONFIG, ...config };
  }

  /**
   * Initialize the MemRL engine
   */
  initialize(): void {
    if (this.initialized) return;
    // Schema migrations are handled by SQLiteStorage
    this.initialized = true;
    console.log('[MemRL] Initialized with config:', {
      delta: this.config.delta,
      lambda: this.config.lambda,
      alpha: this.config.alpha
    });
  }

  /**
   * Check if MemRL is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Get current configuration
   */
  getConfig(): MemRLConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<MemRLConfig>): MemRLConfig {
    this.config = { ...this.config, ...updates };
    return this.getConfig();
  }

  /**
   * Phase A: Filter candidates by similarity threshold
   *
   * From the paper: "Phase A implements analogical transfer through semantic recall"
   * Filters entries where similarity < delta
   */
  phaseAFilter(
    vectorResults: Array<{ label: number; score: number }>,
    delta: number
  ): Array<{ label: number; similarity: number }> {
    return vectorResults
      .filter(vr => vr.score >= delta)
      .map(vr => ({ label: vr.label, similarity: vr.score }));
  }

  /**
   * Phase B: Utility-aware ranking with composite scoring
   *
   * From the paper:
   * score = (1 - lambda) * sim_normalized + lambda * Q_normalized
   *
   * Uses z-score normalization within the candidate pool as recommended.
   */
  phaseBRank(
    candidates: PhaseACandidate[],
    lambda: number,
    topK: number
  ): PhaseBResult[] {
    if (candidates.length === 0) return [];

    // Calculate statistics for z-score normalization
    const similarities = candidates.map(c => c.similarity);
    const qValues = candidates.map(c => c.qValue);

    const simMean = similarities.reduce((a, b) => a + b, 0) / similarities.length;
    const qMean = qValues.reduce((a, b) => a + b, 0) / qValues.length;

    const simStd = Math.sqrt(
      similarities.reduce((sum, s) => sum + Math.pow(s - simMean, 2), 0) / similarities.length
    ) || 1; // Prevent division by zero

    const qStd = Math.sqrt(
      qValues.reduce((sum, q) => sum + Math.pow(q - qMean, 2), 0) / qValues.length
    ) || 1;

    // Calculate composite scores with z-score normalization
    const scored = candidates.map(c => {
      const simNorm = (c.similarity - simMean) / simStd;
      const qNorm = (c.qValue - qMean) / qStd;

      // Composite score formula from the paper
      const compositeScore = (1 - lambda) * simNorm + lambda * qNorm;

      return {
        entryId: c.entryId,
        similarity: c.similarity,
        qValue: c.qValue,
        compositeScore,
        rank: 0
      };
    });

    // Sort by composite score (descending)
    scored.sort((a, b) => b.compositeScore - a.compositeScore);

    // Take top K and assign ranks
    return scored.slice(0, topK).map((r, i) => ({
      ...r,
      rank: i + 1
    }));
  }

  /**
   * Two-phase retrieval with utility-aware scoring
   *
   * This is the core MemRL query method that:
   * 1. Takes vector search results
   * 2. Applies Phase A filtering (similarity threshold)
   * 3. Enriches with Q-values
   * 4. Applies Phase B ranking (composite score)
   * 5. Stores query for feedback tracking
   */
  processVectorResults(
    queryText: string,
    vectorResults: Array<{ label: number; score: number }>,
    topK: number,
    options?: { delta?: number; lambda?: number }
  ): MemRLQueryResult {
    const delta = options?.delta ?? this.config.delta;
    const lambda = options?.lambda ?? this.config.lambda;

    // Phase A: Filter by similarity threshold
    const phaseACandidates = this.phaseAFilter(vectorResults, delta);

    if (phaseACandidates.length === 0) {
      // No candidates passed Phase A threshold
      const queryId = randomUUID();
      this.storage.storeMemRLQuery(queryId, queryText, [], [], [], delta, lambda);
      return {
        queryId,
        phaseACandidates: 0,
        results: [],
        lambda,
        delta
      };
    }

    // Resolve labels to entry IDs and get Q-values
    const candidates: PhaseACandidate[] = [];
    const entryIds: string[] = [];

    for (const pc of phaseACandidates) {
      const entryId = this.storage.getEntryIdByLabel(pc.label);
      if (!entryId) continue;

      entryIds.push(entryId);
      candidates.push({
        entryId,
        similarity: pc.similarity,
        qValue: 0.5 // Placeholder, will be filled in batch
      });
    }

    // Batch fetch Q-values for efficiency
    const qValues = this.storage.getQValuesBatch(entryIds);
    for (const candidate of candidates) {
      candidate.qValue = qValues.get(candidate.entryId) ?? 0.5;
    }

    // Phase B: Utility-aware ranking
    const results = this.phaseBRank(candidates, lambda, topK);

    // Generate query ID and store for feedback tracking
    const queryId = randomUUID();
    this.storage.storeMemRLQuery(
      queryId,
      queryText,
      results.map(r => r.entryId),
      results.map(r => r.similarity),
      results.map(r => r.qValue),
      delta,
      lambda
    );

    return {
      queryId,
      phaseACandidates: phaseACandidates.length,
      results,
      lambda,
      delta
    };
  }

  /**
   * Provide feedback for a query to update Q-values
   *
   * Uses EMA update rule from the paper:
   * Q_new = Q_old + alpha * (reward - Q_old)
   *
   * Convergence guarantee: Converges exponentially at rate (1-alpha)^t
   * Variance bound: alpha / (2 - alpha) * sigma^2
   */
  provideFeedback(feedback: MemRLFeedback): MemRLFeedbackResult {
    const queryData = this.storage.getMemRLQuery(feedback.queryId);

    if (!queryData) {
      return {
        success: false,
        entriesUpdated: 0,
        avgQChange: 0,
        message: `Query not found: ${feedback.queryId}`
      };
    }

    if (queryData.hasFeedback) {
      return {
        success: false,
        entriesUpdated: 0,
        avgQChange: 0,
        message: `Feedback already provided for query: ${feedback.queryId}`
      };
    }

    // Build update list
    const updates: Array<{ entryId: string; reward: number }> = [];
    for (const entryId of queryData.entryIds) {
      const reward = feedback.entryRewards?.get(entryId) ?? feedback.globalReward;
      updates.push({ entryId, reward });
    }

    // Batch update Q-values
    const oldQValues = this.storage.getQValuesBatch(queryData.entryIds);
    const entriesUpdated = this.storage.updateQValuesBatch(updates, this.config.alpha);

    // Calculate average Q change
    let totalQChange = 0;
    for (const { entryId, reward } of updates) {
      const oldQ = oldQValues.get(entryId) ?? 0.5;
      const expectedNewQ = oldQ + this.config.alpha * (reward - oldQ);
      totalQChange += Math.abs(expectedNewQ - oldQ);
    }
    const avgQChange = entriesUpdated > 0 ? totalQChange / entriesUpdated : 0;

    // Mark query as having feedback
    this.storage.markMemRLQueryFeedback(feedback.queryId);

    return {
      success: true,
      entriesUpdated,
      avgQChange,
      message: `Updated ${entriesUpdated} Q-values with avg change of ${avgQChange.toFixed(4)}`
    };
  }

  /**
   * Get Q-value for a specific entry
   */
  getQValue(entryId: string): number {
    return this.storage.getQValue(entryId);
  }

  /**
   * Get Q-values for multiple entries
   */
  getQValuesBatch(entryIds: string[]): Map<string, number> {
    return this.storage.getQValuesBatch(entryIds);
  }

  /**
   * Get MemRL statistics
   */
  getStats(): MemRLStats {
    const qStats = this.storage.getQValueStats();
    const queryStats = this.storage.getMemRLQueryStats();

    const feedbackRate = queryStats.totalQueries > 0
      ? queryStats.queriesWithFeedback / queryStats.totalQueries
      : 0;

    return {
      totalEntries: qStats.totalEntries,
      entriesWithQUpdates: qStats.entriesWithUpdates,
      avgQValue: qStats.avgQValue,
      qValueDistribution: qStats.distribution,
      totalQueries: queryStats.totalQueries,
      queriesWithFeedback: queryStats.queriesWithFeedback,
      feedbackRate,
      config: this.getConfig()
    };
  }

  /**
   * Apply Q-value decay to all entries (optional feature)
   *
   * This can help prevent stale Q-values from dominating.
   * Decays all Q-values toward the neutral value (0.5).
   */
  decayQValues(_decayRate: number = 0.01): number {
    // This would require a custom SQL update
    // For now, we don't implement automatic decay
    // Users can manually adjust via feedback
    console.log('[MemRL] Q-value decay not yet implemented');
    return 0;
  }

  /**
   * Get entries with highest Q-values
   */
  getTopQValueEntries(limit: number = 10): Array<{ entryId: string; qValue: number }> {
    const rows = this.storage.getDb().prepare(`
      SELECT id, q_value FROM memory_entries
      WHERE q_value IS NOT NULL
      ORDER BY q_value DESC
      LIMIT ?
    `).all(limit) as Array<{ id: string; q_value: number }>;

    return rows.map(r => ({ entryId: r.id, qValue: r.q_value }));
  }

  /**
   * Get entries with lowest Q-values (candidates for review/pruning)
   */
  getLowQValueEntries(threshold: number = 0.3, limit: number = 10): Array<{ entryId: string; qValue: number }> {
    const rows = this.storage.getDb().prepare(`
      SELECT id, q_value FROM memory_entries
      WHERE q_value IS NOT NULL AND q_value < ?
      ORDER BY q_value ASC
      LIMIT ?
    `).all(threshold, limit) as Array<{ id: string; q_value: number }>;

    return rows.map(r => ({ entryId: r.id, qValue: r.q_value }));
  }
}
