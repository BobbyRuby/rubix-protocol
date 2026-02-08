/**
 * Sona Learning Engine
 *
 * Trajectory-based continuous learning system that improves retrieval
 * quality over time by tracking which patterns lead to successful outcomes.
 *
 * Key features:
 * - Trajectory tracking: query → patterns → route → outcome
 * - LoRA-style weights: efficient delta weights on base similarity
 * - EWC++ regularization: prevents catastrophic forgetting
 * - Weight drift detection: monitors for learning instability
 * - Auto-pruning: removes consistently failing patterns
 * - Auto-boosting: enhances consistently successful patterns
 *
 * Usage:
 *   const sona = new SonaEngine(storage, config);
 *   const trajectoryId = sona.createTrajectory(query, matchedIds, scores);
 *   // ... user evaluates results ...
 *   sona.provideFeedback(trajectoryId, 0.85); // 85% success
 */

import type { SQLiteStorage } from '../storage/SQLiteStorage.js';
import { TrajectoryStore } from './TrajectoryStore.js';
import { WeightManager } from './WeightManager.js';
import { EWCRegularizer } from './EWCRegularizer.js';
import type {
  SonaConfig,
  Trajectory,
  FeedbackResult,
  DriftMetrics,
  LearningStats,
  TrackedQueryResult
} from './types.js';

const DEFAULT_CONFIG: SonaConfig = {
  learningRate: 0.01,
  lambda: 0.5,
  driftThreshold: 0.3,
  criticalDriftThreshold: 0.5,
  minUsesForUpdate: 3,
  pruneThreshold: 0.4,
  pruneMinUses: 100,
  boostMultiplier: 1.2,
  boostThreshold: 0.8
};

export class SonaEngine {
  private config: SonaConfig;
  private trajectories: TrajectoryStore;
  private weights: WeightManager;
  private ewc: EWCRegularizer;
  private initialized: boolean = false;

  constructor(storage: SQLiteStorage, config?: Partial<SonaConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.trajectories = new TrajectoryStore(storage);
    this.weights = new WeightManager(storage);
    this.ewc = new EWCRegularizer(this.weights, {
      lambda: this.config.lambda,
      driftAlertThreshold: this.config.driftThreshold,
      driftCriticalThreshold: this.config.criticalDriftThreshold
    });
  }

  /**
   * Initialize the learning engine
   */
  initialize(): void {
    if (this.initialized) return;

    this.trajectories.initialize();
    this.weights.initialize();

    this.initialized = true;
  }

  /**
   * Create a trajectory for a query
   * Call this when performing a query to track what patterns matched
   */
  createTrajectory(
    query: string,
    matchedIds: string[],
    matchScores: number[],
    queryEmbedding?: Float32Array,
    route?: string
  ): string {
    this.ensureInitialized();

    const trajectory = this.trajectories.createTrajectory(
      query,
      matchedIds,
      matchScores,
      queryEmbedding,
      route
    );

    return trajectory.id;
  }

  /**
   * Provide feedback for a trajectory
   *
   * This is the main learning entry point. Call this after evaluating
   * how useful the query results were.
   */
  async provideFeedback(
    trajectoryId: string,
    quality: number,
    route?: string
  ): Promise<FeedbackResult> {
    this.ensureInitialized();

    // Get the trajectory
    const trajectory = this.trajectories.getTrajectory(trajectoryId);
    if (!trajectory) {
      return {
        success: false,
        weightsUpdated: 0,
        driftScore: 0,
        driftStatus: 'ok',
        message: `Trajectory not found: ${trajectoryId}`
      };
    }

    // Store the feedback
    this.trajectories.storeFeedback(trajectoryId, quality, route);

    // Update weights for each matched pattern
    let weightsUpdated = 0;
    const isSuccess = quality >= 0.5;

    for (let i = 0; i < trajectory.matchedIds.length; i++) {
      const patternId = trajectory.matchedIds[i];
      const matchScore = trajectory.matchScores[i];

      // Record use
      this.weights.recordUse(patternId, isSuccess);

      // Calculate gradient based on quality and match score
      // Higher quality + higher match score = positive gradient
      // Lower quality = negative gradient
      const gradient = (quality - 0.5) * matchScore * this.config.learningRate;

      // Apply EWC-regularized update
      this.ewc.applyRegularizedUpdate(patternId, gradient);

      // Update importance based on gradient magnitude
      this.ewc.updateImportance(patternId, gradient);

      weightsUpdated++;
    }

    // Check drift
    const drift = this.ewc.calculateDrift();

    // Handle critical drift
    if (drift.shouldRollback) {
      const checkpoint = this.weights.getLatestCheckpoint();
      if (checkpoint) {
        this.weights.restoreFromCheckpoint(checkpoint.id);
        return {
          success: true,
          weightsUpdated,
          driftScore: drift.drift,
          driftStatus: 'critical',
          message: `Critical drift detected (${drift.drift.toFixed(4)}). Rolled back to checkpoint.`
        };
      }
    }

    // Create checkpoint if drift is approaching threshold
    if (drift.status === 'alert') {
      this.weights.createCheckpoint(drift.drift);
    }

    return {
      success: true,
      weightsUpdated,
      driftScore: drift.drift,
      driftStatus: drift.status,
      message: `Feedback processed. ${weightsUpdated} weights updated.`
    };
  }

  /**
   * Apply weights to adjust retrieval scores
   *
   * Call this after getting raw similarity scores to factor in learned weights.
   */
  applyWeights(
    results: Array<{ entryId: string; score: number }>
  ): TrackedQueryResult {
    this.ensureInitialized();

    const adjustedResults = results.map(r => {
      const weight = this.weights.getWeight(r.entryId);

      // Apply weight as multiplicative factor
      // weight = 0.5 is neutral, >0.5 boosts, <0.5 dampens
      const weightFactor = 0.5 + weight; // Range: [0.5, 1.5]
      const adjustedScore = r.score * weightFactor;

      return {
        entryId: r.entryId,
        score: r.score,
        adjustedScore,
        weight
      };
    });

    // Re-sort by adjusted score
    adjustedResults.sort((a, b) => b.adjustedScore - a.adjustedScore);

    // Create trajectory for this query (without embedding for now)
    const trajectoryId = this.createTrajectory(
      '', // Query text will be set by caller
      adjustedResults.map(r => r.entryId),
      adjustedResults.map(r => r.score)
    );

    return {
      trajectoryId,
      results: adjustedResults
    };
  }

  /**
   * Check and perform auto-pruning of low-success patterns
   */
  autoPrune(): { pruned: number; patterns: string[] } {
    this.ensureInitialized();

    const candidates = this.weights.getPruneCandidates(
      this.config.pruneThreshold,
      this.config.pruneMinUses
    );

    const pruned: string[] = [];
    for (const pw of candidates) {
      this.weights.deletePattern(pw.patternId);
      pruned.push(pw.patternId);
    }

    return { pruned: pruned.length, patterns: pruned };
  }

  /**
   * Check and perform auto-boosting of high-success patterns
   */
  autoBoost(): { boosted: number; patterns: string[] } {
    this.ensureInitialized();

    const candidates = this.weights.getBoostCandidates(
      this.config.boostThreshold,
      this.config.minUsesForUpdate
    );

    const boosted: string[] = [];
    for (const pw of candidates) {
      const boostedWeight = Math.min(1.0, pw.weight * this.config.boostMultiplier);
      this.weights.updateWeight(pw.patternId, boostedWeight);
      boosted.push(pw.patternId);
    }

    return { boosted: boosted.length, patterns: boosted };
  }

  /**
   * Get current drift metrics
   */
  checkDrift(): DriftMetrics {
    this.ensureInitialized();
    return this.ewc.calculateDrift();
  }

  /**
   * Create a checkpoint of current weights
   */
  createCheckpoint(): string {
    this.ensureInitialized();
    const drift = this.ewc.calculateDrift();
    return this.weights.createCheckpoint(drift.drift);
  }

  /**
   * Rollback to a specific checkpoint
   */
  rollback(checkpointId: string): boolean {
    this.ensureInitialized();
    return this.weights.restoreFromCheckpoint(checkpointId);
  }

  /**
   * Rollback to most recent checkpoint
   */
  rollbackToLatest(): boolean {
    this.ensureInitialized();
    const checkpoint = this.weights.getLatestCheckpoint();
    if (!checkpoint) return false;
    return this.weights.restoreFromCheckpoint(checkpoint.id);
  }

  /**
   * Get learning statistics
   */
  getStats(): LearningStats {
    this.ensureInitialized();

    const trajectoryStats = this.trajectories.getStats();
    const weightStats = this.weights.getStats();
    const drift = this.ewc.calculateDrift();

    // Get pruning/boosting stats
    const pruneCandidates = this.weights.getPruneCandidates(
      this.config.pruneThreshold,
      this.config.pruneMinUses
    );
    const boostCandidates = this.weights.getBoostCandidates(
      this.config.boostThreshold,
      this.config.minUsesForUpdate
    );

    return {
      totalTrajectories: trajectoryStats.total,
      trajectoriesWithFeedback: trajectoryStats.withFeedback,
      trackedPatterns: weightStats.totalPatterns,
      avgWeight: weightStats.avgWeight,
      avgSuccessRate: weightStats.avgSuccessRate,
      currentDrift: drift.drift,
      prunedPatterns: pruneCandidates.length,
      boostedPatterns: boostCandidates.length
    };
  }

  /**
   * Get a specific trajectory
   */
  getTrajectory(id: string): Trajectory | null {
    this.ensureInitialized();
    return this.trajectories.getTrajectory(id);
  }

  /**
   * Get trajectories pending feedback
   */
  getPendingFeedback(limit: number = 10): Trajectory[] {
    this.ensureInitialized();
    return this.trajectories.getPendingFeedback(limit);
  }

  /**
   * Get weight for a specific pattern
   */
  getPatternWeight(patternId: string): number {
    this.ensureInitialized();
    return this.weights.getWeight(patternId);
  }

  /**
   * Recalibrate baseline (call after significant learning)
   */
  recalibrateBaseline(): void {
    this.ensureInitialized();
    this.weights.captureBaseline();
    this.ewc.recalibrateImportance();
  }

  /**
   * Cleanup old trajectories
   */
  cleanup(olderThanDays: number = 30): number {
    this.ensureInitialized();
    return this.trajectories.cleanup(olderThanDays);
  }

  /**
   * Get current configuration
   */
  getConfig(): SonaConfig {
    return { ...this.config };
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      this.initialize();
    }
  }
}
