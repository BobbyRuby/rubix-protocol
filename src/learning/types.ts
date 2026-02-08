/**
 * Sona Learning Engine Types
 *
 * Type definitions for the trajectory-based continuous learning system.
 * Sona tracks query→patterns→route→outcome chains and updates weights
 * to improve retrieval quality over time.
 */

/**
 * A trajectory tracks the full path from query to outcome
 */
export interface Trajectory {
  /** Unique trajectory ID */
  id: string;
  /** Original query text */
  query: string;
  /** Query embedding (768-dim) */
  queryEmbedding?: Float32Array;
  /** IDs of patterns/entries that matched */
  matchedIds: string[];
  /** Similarity scores for each match */
  matchScores: number[];
  /** Reasoning route taken (e.g., 'pattern_match', 'causal_forward') */
  route?: string;
  /** When the trajectory was created */
  createdAt: Date;
  /** Whether feedback has been provided */
  hasFeedback: boolean;
}

/**
 * Feedback for a trajectory
 */
export interface TrajectoryFeedback {
  /** Trajectory ID this feedback is for */
  trajectoryId: string;
  /** Quality score 0-1 (how successful was this trajectory?) */
  quality: number;
  /** Optional reasoning route categorization */
  route?: string;
  /** When feedback was provided */
  createdAt: Date;
  /** Optional notes */
  notes?: string;
}

/**
 * Weight entry for a pattern/entry
 */
export interface PatternWeight {
  /** Pattern or entry ID */
  patternId: string;
  /** Current weight (affects retrieval ranking) */
  weight: number;
  /** Fisher importance for EWC++ (how critical is this weight?) */
  importance: number;
  /** Number of times this pattern was used */
  useCount: number;
  /** Number of successful uses */
  successCount: number;
  /** Computed success rate */
  successRate: number;
  /** Last update timestamp */
  updatedAt: Date;
}

/**
 * Configuration for Sona Learning Engine
 */
export interface SonaConfig {
  /** Learning rate for weight updates (default: 0.01) */
  learningRate: number;
  /** EWC++ regularization strength (default: 0.5) */
  lambda: number;
  /** Drift detection threshold (default: 0.3) */
  driftThreshold: number;
  /** Critical drift threshold for rollback (default: 0.5) */
  criticalDriftThreshold: number;
  /** Minimum uses before weight adjustments (default: 3) */
  minUsesForUpdate: number;
  /** Success rate threshold for pruning (default: 0.4) */
  pruneThreshold: number;
  /** Minimum uses before pruning consideration (default: 100) */
  pruneMinUses: number;
  /** Boost multiplier for high-success patterns (default: 1.2) */
  boostMultiplier: number;
  /** Success rate threshold for boosting (default: 0.8) */
  boostThreshold: number;
}

/**
 * Result of providing feedback
 */
export interface FeedbackResult {
  /** Whether feedback was successfully processed */
  success: boolean;
  /** Number of weights updated */
  weightsUpdated: number;
  /** Current drift score */
  driftScore: number;
  /** Drift status */
  driftStatus: 'ok' | 'alert' | 'critical';
  /** Message */
  message: string;
}

/**
 * Drift metrics from weight monitoring
 */
export interface DriftMetrics {
  /** Current drift score (0-1) */
  drift: number;
  /** Configured threshold */
  threshold: number;
  /** Status based on thresholds */
  status: 'ok' | 'alert' | 'critical';
  /** Whether rollback is recommended */
  shouldRollback: boolean;
}

/**
 * Learning statistics
 */
export interface LearningStats {
  /** Total trajectories created */
  totalTrajectories: number;
  /** Trajectories with feedback */
  trajectoriesWithFeedback: number;
  /** Total patterns being tracked */
  trackedPatterns: number;
  /** Average pattern weight */
  avgWeight: number;
  /** Average success rate */
  avgSuccessRate: number;
  /** Current drift score */
  currentDrift: number;
  /** Patterns pruned (success rate too low) */
  prunedPatterns: number;
  /** Patterns boosted (success rate high) */
  boostedPatterns: number;
}

/**
 * Query result enhanced with trajectory tracking
 */
export interface TrackedQueryResult {
  /** Trajectory ID for this query */
  trajectoryId: string;
  /** Original results */
  results: Array<{
    entryId: string;
    score: number;
    adjustedScore: number; // Score after weight adjustment
    weight: number;
  }>;
}

/**
 * Weight checkpoint for rollback
 */
export interface WeightCheckpoint {
  /** Checkpoint ID */
  id: string;
  /** When checkpoint was created */
  createdAt: Date;
  /** Serialized weights */
  weights: Map<string, PatternWeight>;
  /** Drift score at checkpoint time */
  driftScore: number;
}
