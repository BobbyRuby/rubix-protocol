/**
 * Memory Distillation Types
 *
 * Type definitions for the Memory Distillation System.
 * Enables proactive extraction of lessons from stored experiences -
 * successes, failures, patterns, and accumulated knowledge.
 */

/**
 * Types of distillation that can be performed
 */
export type DistillationType =
  | 'success_pattern'      // Extract patterns from successful approaches
  | 'failure_fix'          // Extract failure→resolution chains
  | 'cross_domain'         // Find transferable principles across domains
  | 'contradiction'        // Resolve conflicting memories
  | 'consolidation';       // Consolidate many small memories into fewer comprehensive ones

/**
 * Configuration for the distillation service
 */
export interface DistillationConfig {
  /** Enable/disable the distillation service */
  enabled: boolean;
  /** Cron pattern for scheduled distillation (default: "0 3 * * 0" = Sunday 3am) */
  schedule: string;
  /** Maximum tokens per distillation run (default: 100000) */
  maxTokensPerRun: number;
  /** Minimum confidence threshold for storing insights (default: 0.7) */
  minConfidence: number;
  /** How many days back to look for memories (default: 7) */
  lookbackDays: number;
  /** Which distillation types to run */
  distillationTypes: DistillationType[];
  /** Model to use for insight extraction */
  model: string;
  /** Maximum tokens for Claude response */
  maxResponseTokens: number;
  /** Enable extended thinking for complex analysis */
  enableExtendedThinking: boolean;
  /** Extended thinking budget tokens */
  thinkingBudget: number;
}

/**
 * Default configuration
 */
export const DEFAULT_DISTILLATION_CONFIG: DistillationConfig = {
  enabled: true,
  schedule: '0 3 * * 0', // Sunday 3am
  maxTokensPerRun: 100000,
  minConfidence: 0.7,
  lookbackDays: 7,
  distillationTypes: ['success_pattern', 'failure_fix'],
  model: 'claude-sonnet-4-20250514',
  maxResponseTokens: 4096,
  enableExtendedThinking: true,
  thinkingBudget: 8192
};

/**
 * A distilled insight extracted from memories
 */
export interface DistilledInsight {
  /** Unique identifier */
  id: string;
  /** Type of distillation that produced this insight */
  type: DistillationType;
  /** The extracted lesson/insight */
  insight: string;
  /** Pattern observed (for success_pattern type) */
  pattern?: string;
  /** When this applies */
  applicableContexts: string[];
  /** When this does NOT apply (caveats) */
  caveats?: string[];
  /** Confidence in this insight (0-1) */
  confidence: number;
  /** IDs of source memories this was distilled from */
  sourceMemoryIds: string[];
  /** Tags for categorization */
  tags: string[];
  /** When this insight was created */
  createdAt: Date;
  /** Tokens used to generate this insight */
  tokensUsed: number;
  /** Model used for generation */
  model: string;
}

/**
 * Result of a distillation run
 */
export interface DistillationResult {
  /** Whether the distillation run was successful */
  success: boolean;
  /** When the run started */
  startedAt: Date;
  /** When the run completed */
  completedAt: Date;
  /** Duration in milliseconds */
  durationMs: number;
  /** Total tokens used */
  tokensUsed: number;
  /** Insights extracted */
  insights: DistilledInsight[];
  /** Breakdown by type */
  byType: Record<DistillationType, number>;
  /** Memories processed */
  memoriesProcessed: number;
  /** Any errors encountered */
  errors: string[];
  /** Whether budget was exhausted */
  budgetExhausted: boolean;
}

/**
 * Statistics about the distillation system
 */
export interface DistillationStats {
  /** Total distillation runs */
  totalRuns: number;
  /** Total insights extracted */
  totalInsights: number;
  /** Insights by type */
  byType: Record<DistillationType, number>;
  /** Average confidence score */
  avgConfidence: number;
  /** Total tokens used across all runs */
  totalTokensUsed: number;
  /** Average tokens per run */
  avgTokensPerRun: number;
  /** Last run timestamp */
  lastRunAt?: Date;
  /** Last run result */
  lastRunResult?: 'success' | 'partial' | 'failed';
  /** Top insights (most referenced) */
  topInsights: Array<{ insight: string; references: number }>;
  /** Memories processed since last run */
  pendingMemories: number;
}

/**
 * Query parameters for searching distilled insights
 */
export interface InsightQuery {
  /** Semantic search query */
  query: string;
  /** Number of results to return */
  topK?: number;
  /** Minimum similarity score */
  minSimilarity?: number;
  /** Filter by insight type */
  type?: DistillationType;
  /** Minimum confidence threshold */
  minConfidence?: number;
  /** Filter by tags */
  tags?: string[];
}

/**
 * Result of an insight query
 */
export interface InsightQueryResult {
  /** Matching insights with similarity scores */
  insights: Array<{
    insight: DistilledInsight;
    similarity: number;
  }>;
  /** Applicable lessons for the query context */
  applicableLessons: string[];
  /** Patterns that might apply */
  relevantPatterns: string[];
  /** Caveats to be aware of */
  relevantCaveats: string[];
}

/**
 * Input for a single memory to be distilled
 */
export interface MemoryInput {
  /** Memory ID */
  id: string;
  /** Memory content */
  content: string;
  /** Memory tags */
  tags: string[];
  /** Memory importance */
  importance: number;
  /** Memory creation date */
  createdAt: Date;
}

/**
 * Cluster of related memories for pattern extraction
 */
export interface MemoryCluster {
  /** Cluster ID */
  id: string;
  /** Memories in this cluster */
  memories: MemoryInput[];
  /** Common tags */
  commonTags: string[];
  /** Cluster theme/topic */
  theme: string;
  /** Average similarity between members */
  cohesion: number;
}

/**
 * A failure→fix chain for extraction
 */
export interface FailureFixChain {
  /** Failure memory ID */
  failureId: string;
  /** Failure content */
  failureContent: string;
  /** Error type */
  errorType: string;
  /** Resolution memory ID */
  resolutionId: string;
  /** Resolution content */
  resolutionContent: string;
  /** Causal strength between failure and resolution */
  causalStrength: number;
}

/**
 * A run record stored in the database
 */
export interface DistillationRun {
  /** Run ID */
  id: string;
  /** When the run started */
  startedAt: Date;
  /** When the run completed */
  completedAt?: Date;
  /** Run status */
  status: 'running' | 'completed' | 'failed';
  /** Tokens used */
  tokensUsed: number;
  /** Insights extracted (count) */
  insightsCount: number;
  /** Memories processed */
  memoriesProcessed: number;
  /** Error message if failed */
  error?: string;
  /** Configuration used for this run */
  config: DistillationConfig;
}

/**
 * Options for manual distillation trigger
 */
export interface ManualDistillationOptions {
  /** Override distillation types to run */
  types?: DistillationType[];
  /** Override lookback days */
  lookbackDays?: number;
  /** Override max tokens */
  maxTokens?: number;
  /** Force run even if recent run exists */
  force?: boolean;
  /** Dry run - don't store insights */
  dryRun?: boolean;
}
