/**
 * L-Score Calculator
 *
 * Implements the Lineage Score (L-Score) algorithm from the God Agent white paper.
 *
 * Formula: L-Score = geometric_mean(confidences) × average(relevances) / depth_factor
 *
 * Where:
 * - geometric_mean penalizes low confidence anywhere in the chain
 * - arithmetic_mean averages relevance across derivations
 * - depth_factor = decay^depth (default decay: 0.9)
 *
 * The L-Score provides a reliability metric for derived information,
 * helping prevent hallucination propagation.
 */

import type { LScoreParams, LScoreConfig } from './types.js';

export class LScoreCalculator {
  private config: LScoreConfig;

  constructor(config: LScoreConfig) {
    this.config = config;
  }

  /**
   * Calculate L-Score for a provenance chain
   */
  calculate(params: LScoreParams): number {
    const { confidences, relevances, depth, depthDecay } = params;
    const decay = depthDecay ?? this.config.depthDecay;

    // Root nodes have L-Score of 1.0 (original information)
    if (depth === 0 || confidences.length === 0) {
      return 1.0;
    }

    // Calculate geometric mean of confidences
    const geoMeanConfidence = this.geometricMean(confidences);

    // Calculate arithmetic mean of relevances
    const avgRelevance = this.arithmeticMean(relevances);

    // Calculate depth penalty
    const depthFactor = Math.pow(decay, depth);

    // Final L-Score calculation
    const lScore = (geoMeanConfidence * avgRelevance) / (1 / depthFactor);

    // Clamp to valid range
    return Math.max(this.config.minScore, Math.min(1.0, lScore));
  }

  /**
   * Calculate geometric mean (penalizes any low value in the chain)
   */
  private geometricMean(values: number[]): number {
    if (values.length === 0) return 1.0;

    // Use log-sum-exp for numerical stability
    const logSum = values.reduce((sum, v) => sum + Math.log(Math.max(v, 1e-10)), 0);
    return Math.exp(logSum / values.length);
  }

  /**
   * Calculate arithmetic mean
   */
  private arithmeticMean(values: number[]): number {
    if (values.length === 0) return 1.0;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }

  /**
   * Calculate incremental L-Score when adding a new derivation
   */
  calculateIncremental(
    parentLScore: number,
    newConfidence: number,
    newRelevance: number
  ): number {
    // Simplified incremental calculation
    const combined = parentLScore * newConfidence * newRelevance * this.config.depthDecay;
    return Math.max(this.config.minScore, Math.min(1.0, combined));
  }

  /**
   * Aggregate L-Scores from multiple parents (for merged/derived memories)
   */
  aggregateFromParents(parentLScores: number[]): number {
    if (parentLScores.length === 0) return 1.0;
    if (parentLScores.length === 1) return parentLScores[0];

    // Use harmonic mean - conservative aggregation that penalizes low scores
    const harmonicMean = parentLScores.length /
      parentLScores.reduce((sum, s) => sum + 1 / Math.max(s, 1e-10), 0);

    return Math.max(this.config.minScore, Math.min(1.0, harmonicMean));
  }

  /**
   * Check if L-Score meets reliability threshold
   */
  isReliable(lScore: number, threshold: number = 0.5): boolean {
    return lScore >= threshold;
  }

  /**
   * Get reliability category based on L-Score
   */
  getReliabilityCategory(lScore: number): 'high' | 'medium' | 'low' | 'unreliable' {
    if (lScore >= 0.8) return 'high';
    if (lScore >= 0.5) return 'medium';
    if (lScore >= 0.2) return 'low';
    return 'unreliable';
  }

  getConfig(): LScoreConfig {
    return { ...this.config };
  }
}
