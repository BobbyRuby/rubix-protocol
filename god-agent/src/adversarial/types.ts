/**
 * Adversarial Search Types
 *
 * Type definitions for shadow vector search and contradiction detection.
 */

import type { MemoryEntry } from '../core/types.js';

/**
 * Types of contradictions that shadow search can detect
 */
export type ContradictionType =
  | 'direct_negation'      // Direct opposite claim
  | 'counterargument'      // Argument against the claim
  | 'falsification'        // Evidence that disproves the claim
  | 'alternative'          // Alternative explanation/view
  | 'exception';           // Exception to a general rule

/**
 * A detected contradiction from shadow search
 */
export interface Contradiction {
  /** The memory entry that contradicts the query */
  entry: MemoryEntry;
  /** How strongly this contradicts (0-1, higher = stronger refutation) */
  refutationStrength: number;
  /** Type of contradiction */
  contradictionType: ContradictionType;
  /** L-Score of the contradicting entry (if available) */
  lScore?: number;
  /** Similarity to shadow vector (internal metric) */
  shadowSimilarity: number;
}

/**
 * Options for shadow search
 */
export interface ShadowSearchOptions {
  /** Minimum refutation strength to include (default: 0.5) */
  threshold?: number;
  /** Maximum number of contradictions to return (default: 10) */
  topK?: number;
  /** Type of contradiction to search for (default: all types) */
  contradictionType?: ContradictionType;
  /** Include L-Score in results */
  includeProvenance?: boolean;
  /** Filter by tags */
  tags?: string[];
  /** Minimum importance of contradicting entries */
  minImportance?: number;
}

/**
 * Result of shadow search query
 */
export interface ShadowSearchResult {
  /** Original query text */
  query: string;
  /** Contradictions found */
  contradictions: Contradiction[];
  /** Number of contradictions found */
  count: number;
  /** Credibility score: support / (support + contradiction) */
  credibility: number;
  /** Support weight (from normal search) */
  supportWeight: number;
  /** Contradiction weight (from shadow search) */
  contradictionWeight: number;
}

/**
 * Configuration for ShadowSearch
 */
export interface ShadowSearchConfig {
  /** Default threshold for refutation strength */
  defaultThreshold: number;
  /** Default number of results */
  defaultTopK: number;
  /** Weight multiplier for L-Score in credibility calculation */
  lScoreWeight: number;
}
