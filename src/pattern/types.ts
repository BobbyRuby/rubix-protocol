/**
 * Pattern Types
 *
 * Type definitions for the pattern matching system.
 */

export interface PatternSlot {
  name: string;
  type: 'text' | 'entity' | 'date' | 'number' | 'any';
  required: boolean;
  validators?: string[];
}

export interface PatternTemplate {
  id: string;
  name: string;
  pattern: string;
  slots: PatternSlot[];
  priority: number;
  createdAt: Date;
}

export interface PatternMatch {
  templateId: string;
  templateName: string;
  confidence: number;
  bindings: Record<string, string>;
  matchedText: string;
  startIndex: number;
  endIndex: number;
}

export interface PatternMatcherConfig {
  caseSensitive: boolean;
  minConfidence: number;
  maxMatches: number;
  /** Success rate threshold below which patterns are pruned (default: 0.4) */
  pruneThreshold?: number;
  /** Minimum uses before a pattern can be pruned (default: 100) */
  pruneMinUses?: number;
}

export interface SlotValidationResult {
  valid: boolean;
  value: string;
  normalizedValue?: string;
  error?: string;
}

/**
 * Statistics for a pattern template
 */
export interface PatternStats {
  patternId: string;
  useCount: number;
  successCount: number;
  successRate: number;
  lastUsedAt?: Date;
}

/**
 * Result of pattern pruning operation
 */
export interface PruneResult {
  pruned: number;
  patterns: Array<{
    id: string;
    name: string;
    useCount: number;
    successRate: number;
  }>;
}
