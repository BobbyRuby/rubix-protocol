/**
 * Reflexion Types
 *
 * Type definitions for the Verbal Reflexion System.
 * Enables Claude-generated "why did this fail" reasoning
 * beyond template-based pattern matching.
 */

/**
 * A reflection on a failure - the core unit of verbal reflexion.
 * Contains Claude-generated analysis of WHY something failed.
 */
export interface Reflection {
  /** Unique identifier for this reflection */
  id: string;
  /** ID of the failure this reflection analyzes */
  failureId: string;
  /** Task ID the failure belongs to */
  taskId: string;
  /** Subtask ID the failure belongs to */
  subtaskId: string;
  /** Claude-generated root cause analysis */
  whyItFailed: string;
  /** Abstracted cause category for pattern matching */
  rootCause: RootCauseCategory;
  /** Custom root cause description if category is 'other' */
  rootCauseDetail?: string;
  /** Generalizable lesson learned */
  lesson: string;
  /** Recommended approach for next time */
  nextTimeApproach: string;
  /** Confidence in the reflection (0-1) */
  confidence: number;
  /** When the reflection was generated */
  generatedAt: Date;
  /** Tokens used to generate this reflection */
  tokensUsed: number;
  /** Model used for generation */
  model: string;
}

/**
 * Root cause categories for pattern matching
 */
export type RootCauseCategory =
  | 'misunderstood_requirements'
  | 'missing_context'
  | 'wrong_approach'
  | 'dependency_issue'
  | 'type_mismatch'
  | 'integration_failure'
  | 'test_logic_error'
  | 'environment_issue'
  | 'race_condition'
  | 'resource_exhaustion'
  | 'api_misuse'
  | 'security_violation'
  | 'other';

/**
 * Query parameters for searching reflections
 */
export interface ReflectionQuery {
  /** Semantic search query */
  query: string;
  /** Number of results to return */
  topK?: number;
  /** Minimum similarity score */
  minSimilarity?: number;
  /** Filter by root cause category */
  rootCause?: RootCauseCategory;
  /** Filter by task ID */
  taskId?: string;
  /** Include only high-confidence reflections */
  highConfidenceOnly?: boolean;
}

/**
 * Result of a reflection query
 */
export interface ReflectionQueryResult {
  /** Matching reflections with similarity scores */
  reflections: Array<{
    reflection: Reflection;
    similarity: number;
  }>;
  /** Extracted lessons applicable to the query context */
  applicableLessons: string[];
  /** Approaches to consider based on past reflections */
  suggestedApproaches: string[];
  /** Approaches that failed in similar situations */
  approachesToAvoid: string[];
}

/**
 * Context for generating a reflection
 */
export interface ReflectionContext {
  /** The failure to reflect on */
  failure: FailureInput;
  /** Task description for context */
  taskDescription: string;
  /** Subtask description */
  subtaskDescription: string;
  /** Previous attempts (if any) */
  previousAttempts?: AttemptSummary[];
  /** Related code files */
  relevantCode?: string;
  /** Error stack trace */
  stackTrace?: string;
  /** Console output */
  consoleOutput?: string[];
}

/**
 * Input for creating a reflection from a failure
 */
export interface FailureInput {
  /** Failure ID */
  id: string;
  /** Task ID */
  taskId: string;
  /** Subtask ID */
  subtaskId: string;
  /** Attempt number */
  attemptNumber: number;
  /** Approach that was tried */
  approach: string;
  /** Error message */
  error: string;
  /** Error type classification */
  errorType: string;
  /** Console errors */
  consoleErrors?: string[];
  /** Screenshot path */
  screenshot?: string;
  /** Context description */
  context: string;
}

/**
 * Summary of a previous attempt
 */
export interface AttemptSummary {
  attemptNumber: number;
  approach: string;
  error: string;
  outcome: 'failed' | 'partial' | 'blocked';
}

/**
 * Statistics about the reflexion system
 */
export interface ReflexionStats {
  /** Total reflections stored */
  totalReflections: number;
  /** Reflections by root cause category */
  byRootCause: Record<RootCauseCategory, number>;
  /** Average confidence score */
  avgConfidence: number;
  /** Total tokens used for reflections */
  totalTokensUsed: number;
  /** Most common lessons */
  topLessons: Array<{ lesson: string; count: number }>;
  /** Resolution rate (reflections that led to successful retry) */
  resolutionRate: number;
}

/**
 * Configuration for the ReflexionService
 */
export interface ReflexionConfig {
  /** Model to use for reflection generation */
  model: string;
  /** Maximum tokens for reflection response */
  maxTokens: number;
  /** Minimum confidence to store reflection */
  minConfidence: number;
  /** Enable extended thinking for complex failures */
  enableExtendedThinking: boolean;
  /** Extended thinking budget tokens */
  thinkingBudget: number;
  /** Cache reflections for faster lookup */
  enableCache: boolean;
  /** Cache TTL in milliseconds */
  cacheTtlMs: number;
}

/**
 * Default configuration
 */
export const DEFAULT_REFLEXION_CONFIG: ReflexionConfig = {
  model: 'claude-sonnet-4-20250514',
  maxTokens: 2048,
  minConfidence: 0.5,
  enableExtendedThinking: true,
  thinkingBudget: 4096,
  enableCache: true,
  cacheTtlMs: 3600000 // 1 hour
};
