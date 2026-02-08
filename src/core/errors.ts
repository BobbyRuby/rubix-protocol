/**
 * Custom Error Classes for God Agent
 */

/**
 * Error thrown when content's L-Score is below the configured threshold
 */
export class ProvenanceThresholdError extends Error {
  public readonly lScore: number;
  public readonly threshold: number;

  constructor(lScore: number, threshold: number) {
    super(
      `L-Score ${lScore.toFixed(4)} is below threshold ${threshold.toFixed(4)}. ` +
      `Content rejected to prevent low-confidence information from polluting memory.`
    );
    this.name = 'ProvenanceThresholdError';
    this.lScore = lScore;
    this.threshold = threshold;

    // Maintains proper stack trace for where error was thrown (only in V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ProvenanceThresholdError);
    }
  }
}

/**
 * Error thrown when pattern pruning fails
 */
export class PatternPruneError extends Error {
  public readonly patternId: string;
  public readonly reason: string;

  constructor(patternId: string, reason: string) {
    super(`Failed to prune pattern ${patternId}: ${reason}`);
    this.name = 'PatternPruneError';
    this.patternId = patternId;
    this.reason = reason;
  }
}

/**
 * Error thrown when learning drift exceeds critical threshold
 */
export class LearningDriftError extends Error {
  public readonly drift: number;
  public readonly threshold: number;

  constructor(drift: number, threshold: number) {
    super(
      `Learning drift ${drift.toFixed(4)} exceeds critical threshold ${threshold.toFixed(4)}. ` +
      `Consider rolling back to a previous checkpoint.`
    );
    this.name = 'LearningDriftError';
    this.drift = drift;
    this.threshold = threshold;
  }
}
