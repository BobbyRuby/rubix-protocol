/**
 * EWC++ Regularizer
 *
 * Elastic Weight Consolidation prevents "catastrophic forgetting" - when
 * learning new tasks destroys knowledge of old tasks.
 *
 * How it works:
 * - Track which weights are "important" for each task type
 * - When updating, penalize changes to important weights:
 *
 *   new_weight = old_weight + gradient / (1 + λ × importance)
 *
 *   High importance → small update (protected)
 *   Low importance  → normal update (adaptable)
 *
 * EWC++ Enhancement:
 * - Online Fisher information updates (no separate consolidation step)
 * - Exponential moving average of importance
 */

import type { WeightManager } from './WeightManager.js';
import type { DriftMetrics } from './types.js';

export interface EWCConfig {
  /** Regularization strength (higher = more protection) */
  lambda: number;
  /** Exponential decay for importance updates */
  importanceDecay: number;
  /** Drift threshold for alert */
  driftAlertThreshold: number;
  /** Drift threshold for critical (rollback) */
  driftCriticalThreshold: number;
}

const DEFAULT_CONFIG: EWCConfig = {
  lambda: 0.5,
  importanceDecay: 0.9,
  driftAlertThreshold: 0.3,
  driftCriticalThreshold: 0.5
};

export class EWCRegularizer {
  private config: EWCConfig;
  private weights: WeightManager;

  constructor(weights: WeightManager, config?: Partial<EWCConfig>) {
    this.weights = weights;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Apply EWC-regularized weight update
   *
   * new_weight = old_weight + gradient / (1 + λ × importance)
   */
  applyRegularizedUpdate(
    patternId: string,
    gradient: number
  ): { oldWeight: number; newWeight: number; importance: number } {
    const patternWeight = this.weights.getPatternWeight(patternId);

    const oldWeight = patternWeight?.weight ?? 0.5;
    const importance = patternWeight?.importance ?? 0;

    // EWC++ regularized update
    const regularizedGradient = gradient / (1 + this.config.lambda * importance);
    const newWeight = oldWeight + regularizedGradient;

    // Update the weight
    this.weights.updateWeight(patternId, newWeight);

    return { oldWeight, newWeight, importance };
  }

  /**
   * Update importance for a pattern based on quality feedback
   *
   * Uses exponential moving average:
   * importance_new = decay × importance_old + (1 - decay) × |gradient|
   */
  updateImportance(patternId: string, gradient: number): number {
    const patternWeight = this.weights.getPatternWeight(patternId);
    const oldImportance = patternWeight?.importance ?? 0;

    // EWC++ online update: EMA of gradient magnitude
    const newImportance = this.config.importanceDecay * oldImportance +
                          (1 - this.config.importanceDecay) * Math.abs(gradient);

    this.weights.updateImportance(patternId, newImportance);

    return newImportance;
  }

  /**
   * Calculate drift between current weights and baseline
   *
   * Drift = 1 - cosine_similarity(current, baseline)
   */
  calculateDrift(): DriftMetrics {
    const current = this.weights.getAllAsVector();
    const baseline = this.weights.getBaseline();

    // Handle edge cases
    if (current.length === 0 || baseline.length === 0) {
      return {
        drift: 0,
        threshold: this.config.driftAlertThreshold,
        status: 'ok',
        shouldRollback: false
      };
    }

    // Align vectors (pad shorter one with defaults)
    const maxLen = Math.max(current.length, baseline.length);
    const currentPadded = [...current];
    const baselinePadded = [...baseline];

    while (currentPadded.length < maxLen) currentPadded.push(0.5);
    while (baselinePadded.length < maxLen) baselinePadded.push(0.5);

    // Calculate cosine similarity
    const similarity = this.cosineSimilarity(currentPadded, baselinePadded);
    const drift = 1 - similarity;

    // Determine status
    let status: 'ok' | 'alert' | 'critical';
    let shouldRollback = false;

    if (drift >= this.config.driftCriticalThreshold) {
      status = 'critical';
      shouldRollback = true;
    } else if (drift >= this.config.driftAlertThreshold) {
      status = 'alert';
    } else {
      status = 'ok';
    }

    return {
      drift,
      threshold: this.config.driftAlertThreshold,
      status,
      shouldRollback
    };
  }

  /**
   * Get importance-weighted protection score for a pattern
   * Higher score = more protected from updates
   */
  getProtectionScore(patternId: string): number {
    const patternWeight = this.weights.getPatternWeight(patternId);
    if (!patternWeight) return 0;

    // Protection = importance × lambda
    return patternWeight.importance * this.config.lambda;
  }

  /**
   * Check if a pattern is highly protected (important for existing tasks)
   */
  isHighlyProtected(patternId: string, threshold: number = 0.5): boolean {
    return this.getProtectionScore(patternId) >= threshold;
  }

  /**
   * Get all highly protected patterns
   */
  getProtectedPatterns(threshold: number = 0.5): string[] {
    const allWeights = this.weights.getAllWeights();
    const protected_: string[] = [];

    for (const [patternId, pw] of allWeights) {
      if (pw.importance * this.config.lambda >= threshold) {
        protected_.push(patternId);
      }
    }

    return protected_;
  }

  /**
   * Recalibrate importance based on recent performance
   * Call this periodically to prevent importance from growing unbounded
   */
  recalibrateImportance(): number {
    const allWeights = this.weights.getAllWeights();

    if (allWeights.size === 0) return 0;

    // Calculate max importance for normalization
    let maxImportance = 0;
    for (const pw of allWeights.values()) {
      if (pw.importance > maxImportance) {
        maxImportance = pw.importance;
      }
    }

    // Normalize all importance values to [0, 1]
    if (maxImportance > 1) {
      let recalibrated = 0;
      for (const [patternId, pw] of allWeights) {
        const normalizedImportance = pw.importance / maxImportance;
        this.weights.updateImportance(patternId, normalizedImportance);
        recalibrated++;
      }
      return recalibrated;
    }

    return 0;
  }

  /**
   * Reset importance for all patterns (fresh start)
   */
  resetImportance(): void {
    const allWeights = this.weights.getAllWeights();
    for (const [patternId] of allWeights) {
      this.weights.updateImportance(patternId, 0);
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): EWCConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<EWCConfig>): void {
    this.config = { ...this.config, ...config };
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    if (magnitude === 0) return 0;

    return dotProduct / magnitude;
  }
}
