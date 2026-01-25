/**
 * MemRL Types
 *
 * Type definitions for the MemRL (Memory Reinforcement Learning) system.
 * Based on the paper "MemRL: Self-Evolving Agents via Runtime Reinforcement
 * Learning on Episodic Memory".
 *
 * Key concepts:
 * - Two-phase retrieval: Phase A (similarity filter) + Phase B (utility ranking)
 * - EMA Q-value updates: Q_new = Q_old + alpha(reward - Q_old)
 * - Exploration/exploitation balance via lambda parameter
 */

/**
 * MemRL configuration parameters
 */
export interface MemRLConfig {
  /** Phase A similarity threshold - entries below this are filtered out (default: 0.3) */
  delta: number;

  /** Exploration/exploitation balance (0=pure similarity, 1=pure Q-value) (default: 0.3) */
  lambda: number;

  /** EMA learning rate for Q-value updates (default: 0.1) */
  alpha: number;

  /** Minimum Q-value to prevent collapse (default: 0.1) */
  minQ: number;

  /** Maximum Q-value (default: 1.0) */
  maxQ: number;

  /** Whether MemRL is enabled (default: true) */
  enabled: boolean;
}

/**
 * Default MemRL configuration
 */
export const DEFAULT_MEMRL_CONFIG: MemRLConfig = {
  delta: 0.3,    // Conservative - allow most entries through Phase A
  lambda: 0.3,   // 70% similarity, 30% Q-value (conservative for cold start)
  alpha: 0.1,    // Moderate learning rate
  minQ: 0.1,     // Floor to prevent complete suppression
  maxQ: 1.0,     // Ceiling
  enabled: true
};

/**
 * Result from Phase A similarity filtering
 */
export interface PhaseACandidate {
  entryId: string;
  similarity: number;
  qValue: number;
}

/**
 * Result from Phase B utility-aware ranking
 */
export interface PhaseBResult {
  entryId: string;
  similarity: number;
  qValue: number;
  /** Composite score = (1-lambda)*sim_norm + lambda*Q_norm */
  compositeScore: number;
  /** Rank in final results (1-based) */
  rank: number;
}

/**
 * Complete MemRL query result
 */
export interface MemRLQueryResult {
  /** Unique query ID for feedback tracking */
  queryId: string;
  /** Number of candidates after Phase A filtering */
  phaseACandidates: number;
  /** Final ranked results after Phase B */
  results: PhaseBResult[];
  /** Lambda value used for this query */
  lambda: number;
  /** Delta threshold used for this query */
  delta: number;
}

/**
 * Feedback for updating Q-values
 */
export interface MemRLFeedback {
  /** Query ID from a previous MemRL query */
  queryId: string;
  /** Global reward signal (0-1) applied to all entries in query */
  globalReward: number;
  /** Optional per-entry rewards (overrides globalReward for specific entries) */
  entryRewards?: Map<string, number>;
}

/**
 * Result of providing feedback
 */
export interface MemRLFeedbackResult {
  success: boolean;
  entriesUpdated: number;
  avgQChange: number;
  message: string;
}

/**
 * MemRL statistics
 */
export interface MemRLStats {
  /** Total memory entries in system */
  totalEntries: number;
  /** Entries that have received Q-value updates */
  entriesWithQUpdates: number;
  /** Average Q-value across all entries */
  avgQValue: number;
  /** Q-value distribution */
  qValueDistribution: {
    low: number;    // Q < 0.4
    medium: number; // 0.4 <= Q < 0.7
    high: number;   // Q >= 0.7
  };
  /** Total MemRL queries executed */
  totalQueries: number;
  /** Queries that received feedback */
  queriesWithFeedback: number;
  /** Feedback rate */
  feedbackRate: number;
  /** Current configuration */
  config: MemRLConfig;
}

/**
 * Combined learning result (MemRL + Sona)
 */
export interface CombinedLearningResult {
  /** MemRL Q-value updates */
  memrl: {
    entriesUpdated: number;
    avgQChange: number;
  };
  /** Sona pattern weight updates */
  sona: {
    weightsUpdated: number;
    driftScore: number;
    driftStatus: 'ok' | 'alert' | 'critical';
  };
  success: boolean;
  message: string;
}
