/**
 * Failure Learning Types
 *
 * Type definitions for the failure memory system.
 * Tracks failures, patterns, and successful resolutions
 * to help RUBIX avoid repeating the same mistakes.
 */

/**
 * Individual failure memory entry
 * Stored in god-agent memory with failure tags
 */
export interface FailureMemory {
  /** Unique failure ID */
  id: string;
  /** Task this failure belongs to */
  taskId: string;
  /** Subtask this failure occurred in */
  subtaskId: string;
  /** Attempt number when failure occurred */
  attemptNumber: number;
  /** Approach that was tried */
  approach: string;
  /** Error message */
  error: string;
  /** Classified error type (syntax, type, runtime, test, integration, timeout, unknown) */
  errorType: string;
  /** Console errors captured during failure */
  consoleErrors?: string[];
  /** Screenshot path if captured */
  screenshot?: string;
  /** Full stack trace if available */
  stackTrace?: string;
  /** Contextual information about the failure */
  context: string;
  /** When the failure occurred */
  timestamp: Date;
  /** Whether this failure has been resolved */
  resolved: boolean;
  /** Approach that resolved this failure (if resolved) */
  resolutionApproach?: string;
}

/**
 * Pattern of recurring failures
 * Used to identify common issues and their fixes
 */
export interface FailurePattern {
  /** Unique pattern ID */
  id: string;
  /** Signature used to match similar errors (normalized error message) */
  errorSignature: string;
  /** Number of times this pattern has occurred */
  occurrences: number;
  /** Approaches that successfully fixed this pattern */
  successfulFixes: string[];
  /** Approaches that failed to fix this pattern */
  failedApproaches: string[];
  /** Last time this pattern was seen */
  lastSeen: Date;
}

/**
 * Result of querying failure memory
 */
export interface FailureQueryResult {
  /** Similar past failures found */
  similarFailures: FailureMemory[];
  /** Approaches to avoid based on past failures */
  suggestedAvoidances: string[];
  /** Approaches that worked for similar failures */
  recommendedApproaches: string[];
}

/**
 * Causal link between failure, root cause, and fix
 */
export interface FailureCausalLink {
  /** Failure memory ID */
  failureId: string;
  /** Root cause memory ID */
  rootCauseId: string;
  /** Fix memory ID */
  fixId: string;
  /** Strength of the causal relationship */
  strength: number;
  /** When the link was created */
  createdAt: Date;
}

/**
 * Failure statistics summary
 */
export interface FailureStats {
  /** Total failures recorded */
  totalFailures: number;
  /** Failures that have been resolved */
  resolvedFailures: number;
  /** Unresolved failures */
  unresolvedFailures: number;
  /** Number of unique error patterns */
  uniquePatterns: number;
  /** Most common error types */
  errorTypeBreakdown: Record<string, number>;
  /** Average resolution time (if tracked) */
  avgResolutionTimeMs?: number;
  /** Subtask types with most failures */
  failuresBySubtaskType: Record<string, number>;
}

/**
 * Input for recording a failure
 */
export interface RecordFailureInput {
  taskId: string;
  subtaskId: string;
  attemptNumber: number;
  approach: string;
  error: string;
  errorType: string;
  consoleErrors?: string[];
  screenshot?: string;
  stackTrace?: string;
  context: string;
  subtaskType: string;
}

/**
 * Input for querying failures
 */
export interface QueryFailuresInput {
  /** Error message to find similar failures for */
  error: string;
  /** Context to improve matching */
  context?: string;
  /** Maximum number of results */
  topK?: number;
  /** Minimum similarity score */
  minScore?: number;
}

/**
 * Input for recording a resolution
 */
export interface RecordResolutionInput {
  /** Failure ID that was resolved */
  failureId: string;
  /** Approach that resolved the failure */
  approach: string;
}

/**
 * Quality score for Sona feedback
 * Failures typically receive low scores (0.1-0.3)
 * Resolutions receive higher scores (0.7-0.9)
 */
export type FeedbackQuality = number;
