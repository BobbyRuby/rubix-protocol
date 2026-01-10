/**
 * AlternativesFinder
 *
 * Uses shadow search to find alternative approaches when stuck.
 * The idea: if approach A failed, search for approaches that are
 * semantically opposite to A - these might work where A didn't.
 */

import type { MemoryEngine } from '../core/MemoryEngine.js';
import type { ShadowSearch } from '../adversarial/ShadowSearch.js';
import type { VectorDB } from '../vector/VectorDB.js';
import type { EmbeddingService } from '../vector/EmbeddingService.js';
import type { SQLiteStorage } from '../storage/SQLiteStorage.js';
import type { ProvenanceStore } from '../provenance/ProvenanceStore.js';
import type {
  Subtask,
  SubtaskAttempt,
  SimilarFailure
} from './types.js';

/**
 * Alternative approach suggestion
 */
export interface AlternativeApproach {
  id: string;
  approach: string;
  rationale: string;
  confidence: number;
  source: 'shadow' | 'memory' | 'pattern' | 'inferred';
  contradictsAttempt?: string;
}

/**
 * Alternatives search options
 */
export interface AlternativesOptions {
  maxResults?: number;
  minConfidence?: number;
  excludeAttempts?: SubtaskAttempt[];
  includeInferred?: boolean;
}

/**
 * AlternativesFinder - Find different approaches using shadow search
 */
export class AlternativesFinder {
  private engine: MemoryEngine;
  private shadow: ShadowSearch | undefined;
  private vectorDb: VectorDB | undefined;
  private embeddings: EmbeddingService | undefined;
  private storage: SQLiteStorage | undefined;
  private provenance: ProvenanceStore | undefined;

  constructor(
    engine: MemoryEngine,
    shadow?: ShadowSearch,
    vectorDb?: VectorDB,
    embeddings?: EmbeddingService,
    storage?: SQLiteStorage,
    provenance?: ProvenanceStore
  ) {
    this.engine = engine;
    this.shadow = shadow;
    this.vectorDb = vectorDb;
    this.embeddings = embeddings;
    this.storage = storage;
    this.provenance = provenance;
  }

  /**
   * Set shadow search components (for late binding)
   */
  setShadowSearch(
    shadow: ShadowSearch,
    vectorDb: VectorDB,
    embeddings: EmbeddingService,
    storage: SQLiteStorage,
    provenance: ProvenanceStore
  ): void {
    this.shadow = shadow;
    this.vectorDb = vectorDb;
    this.embeddings = embeddings;
    this.storage = storage;
    this.provenance = provenance;
  }

  /**
   * Find alternative approaches for a stuck subtask
   */
  async findAlternatives(
    subtask: Subtask,
    failedAttempts: SubtaskAttempt[],
    options: AlternativesOptions = {}
  ): Promise<AlternativeApproach[]> {
    const alternatives: AlternativeApproach[] = [];
    const maxResults = options.maxResults ?? 5;
    const minConfidence = options.minConfidence ?? 0.3;

    // 1. Try shadow search for semantic opposites
    if (this.canUseShadowSearch()) {
      const shadowAlternatives = await this.findShadowAlternatives(
        subtask,
        failedAttempts
      );
      alternatives.push(...shadowAlternatives);
    }

    // 2. Query memory for successful approaches on similar tasks
    const memoryAlternatives = await this.findMemoryAlternatives(
      subtask,
      failedAttempts
    );
    alternatives.push(...memoryAlternatives);

    // 3. Infer alternatives based on error patterns
    if (options.includeInferred !== false) {
      const inferredAlternatives = this.inferAlternatives(
        subtask,
        failedAttempts
      );
      alternatives.push(...inferredAlternatives);
    }

    // Deduplicate by approach similarity
    const deduped = this.deduplicateAlternatives(alternatives);

    // Filter by confidence and exclude already-tried approaches
    const filtered = deduped.filter(alt => {
      if (alt.confidence < minConfidence) return false;
      if (this.wasAlreadyTried(alt.approach, failedAttempts)) return false;
      return true;
    });

    // Sort by confidence
    filtered.sort((a, b) => b.confidence - a.confidence);

    return filtered.slice(0, maxResults);
  }

  /**
   * Find alternatives using shadow search (semantic opposites)
   */
  private async findShadowAlternatives(
    subtask: Subtask,
    failedAttempts: SubtaskAttempt[]
  ): Promise<AlternativeApproach[]> {
    if (!this.shadow || !this.vectorDb || !this.embeddings || !this.storage || !this.provenance) {
      return [];
    }

    const alternatives: AlternativeApproach[] = [];

    // For each failed attempt, find contradicting approaches
    for (const attempt of failedAttempts.slice(-2)) { // Last 2 attempts
      try {
        const query = `Failed approach: ${attempt.approach} for ${subtask.type}: ${subtask.description}`;

        const contradictions = await this.shadow.findContradictions(
          query,
          this.vectorDb,
          this.embeddings,
          this.storage,
          this.provenance,
          { topK: 3, threshold: 0.4 }
        );

        for (const contradiction of contradictions) {
          const approach = this.extractApproachFromContradiction(contradiction.entry.content);
          if (approach) {
            alternatives.push({
              id: contradiction.entry.id,
              approach,
              rationale: `Opposite of failed approach: "${attempt.approach}"`,
              confidence: contradiction.refutationStrength * 0.8,
              source: 'shadow',
              contradictsAttempt: attempt.approach
            });
          }
        }
      } catch {
        // Continue with other attempts
      }
    }

    return alternatives;
  }

  /**
   * Find alternatives from memory (successful patterns)
   */
  private async findMemoryAlternatives(
    subtask: Subtask,
    failedAttempts: SubtaskAttempt[]
  ): Promise<AlternativeApproach[]> {
    const alternatives: AlternativeApproach[] = [];

    try {
      // Query for successful approaches on similar tasks
      const results = await this.engine.query(
        `successful ${subtask.type} approach different from: ${failedAttempts.map(a => a.approach).join(', ')}`,
        {
          topK: 5,
          filters: {
            tags: ['codex', 'success', subtask.type],
            minImportance: 0.5
          }
        }
      );

      for (const result of results) {
        const approach = this.extractApproachFromContent(result.entry.content);
        if (approach) {
          alternatives.push({
            id: result.entry.id,
            approach,
            rationale: 'Successful approach from similar task',
            confidence: result.score * 0.9,
            source: 'memory'
          });
        }
      }

    } catch {
      // Return empty on error
    }

    return alternatives;
  }

  /**
   * Infer alternatives based on error patterns
   */
  private inferAlternatives(
    subtask: Subtask,
    failedAttempts: SubtaskAttempt[]
  ): AlternativeApproach[] {
    const alternatives: AlternativeApproach[] = [];
    const lastAttempt = failedAttempts[failedAttempts.length - 1];
    const error = lastAttempt?.error?.toLowerCase() || '';

    // Error-specific alternative suggestions
    if (error.includes('type') || error.includes('typescript')) {
      alternatives.push({
        id: 'infer-type-1',
        approach: 'Use more explicit type annotations and avoid any/unknown',
        rationale: 'Type errors often need explicit typing',
        confidence: 0.6,
        source: 'inferred'
      });
      alternatives.push({
        id: 'infer-type-2',
        approach: 'Check interface definitions and ensure proper imports',
        rationale: 'Type mismatches often come from wrong imports',
        confidence: 0.5,
        source: 'inferred'
      });
    }

    if (error.includes('undefined') || error.includes('null') || error.includes('cannot read')) {
      alternatives.push({
        id: 'infer-null-1',
        approach: 'Add null checks and optional chaining (?.)',
        rationale: 'Null errors need defensive programming',
        confidence: 0.7,
        source: 'inferred'
      });
      alternatives.push({
        id: 'infer-null-2',
        approach: 'Ensure data is properly initialized before use',
        rationale: 'Undefined errors often mean missing initialization',
        confidence: 0.6,
        source: 'inferred'
      });
    }

    if (error.includes('timeout') || error.includes('timed out')) {
      alternatives.push({
        id: 'infer-timeout-1',
        approach: 'Break operation into smaller chunks with progress tracking',
        rationale: 'Timeouts often mean operations are too large',
        confidence: 0.65,
        source: 'inferred'
      });
      alternatives.push({
        id: 'infer-timeout-2',
        approach: 'Add caching or memoization to avoid repeated work',
        rationale: 'Slow operations can be optimized with caching',
        confidence: 0.5,
        source: 'inferred'
      });
    }

    if (error.includes('test') || error.includes('assertion') || error.includes('expect')) {
      alternatives.push({
        id: 'infer-test-1',
        approach: 'Verify test expectations match actual implementation behavior',
        rationale: 'Test failures often mean misunderstood requirements',
        confidence: 0.6,
        source: 'inferred'
      });
      alternatives.push({
        id: 'infer-test-2',
        approach: 'Check test data setup and mocking configuration',
        rationale: 'Tests can fail due to incorrect fixtures',
        confidence: 0.55,
        source: 'inferred'
      });
    }

    if (error.includes('import') || error.includes('module') || error.includes('require')) {
      alternatives.push({
        id: 'infer-import-1',
        approach: 'Check module paths and ensure dependencies are installed',
        rationale: 'Import errors usually mean missing or wrong paths',
        confidence: 0.7,
        source: 'inferred'
      });
    }

    // Subtask type-specific alternatives
    if (subtask.type === 'code' && alternatives.length === 0) {
      alternatives.push({
        id: 'infer-code-1',
        approach: 'Start with a simpler implementation and add complexity incrementally',
        rationale: 'Complex implementations fail more often',
        confidence: 0.5,
        source: 'inferred'
      });
    }

    if (subtask.type === 'integrate' && alternatives.length === 0) {
      alternatives.push({
        id: 'infer-integrate-1',
        approach: 'Test integration points individually before combining',
        rationale: 'Integration issues are easier to find in isolation',
        confidence: 0.55,
        source: 'inferred'
      });
    }

    return alternatives;
  }

  /**
   * Extract approach from contradiction content
   */
  private extractApproachFromContradiction(content: string): string | undefined {
    // Try to extract a useful approach from the contradicting content
    const approachMatch = content.match(/Approach: ([^\n]+)/i);
    if (approachMatch) return approachMatch[1];

    // Try to extract from "New Approach" pattern
    const newApproachMatch = content.match(/New Approach: ([^\n]+)/i);
    if (newApproachMatch) return newApproachMatch[1];

    // Use first sentence as approach if it's actionable
    const firstSentence = content.split(/[.!?]/)[0]?.trim();
    if (firstSentence && firstSentence.length > 20 && firstSentence.length < 200) {
      return firstSentence;
    }

    return undefined;
  }

  /**
   * Extract approach from content
   */
  private extractApproachFromContent(content: string): string | undefined {
    const match = content.match(/Approach: ([^\n]+)/);
    return match ? match[1] : undefined;
  }

  /**
   * Check if shadow search is available
   */
  private canUseShadowSearch(): boolean {
    return !!(this.shadow && this.vectorDb && this.embeddings && this.storage && this.provenance);
  }

  /**
   * Check if approach was already tried
   */
  private wasAlreadyTried(approach: string, attempts: SubtaskAttempt[]): boolean {
    const approachLower = approach.toLowerCase();
    return attempts.some(a => {
      const attemptLower = a.approach.toLowerCase();
      return approachLower.includes(attemptLower) ||
             attemptLower.includes(approachLower) ||
             this.similarityScore(approachLower, attemptLower) > 0.7;
    });
  }

  /**
   * Calculate simple similarity score between two strings
   */
  private similarityScore(a: string, b: string): number {
    const wordsA = new Set(a.split(/\s+/));
    const wordsB = new Set(b.split(/\s+/));

    const intersection = [...wordsA].filter(w => wordsB.has(w));
    const union = new Set([...wordsA, ...wordsB]);

    return intersection.length / union.size;
  }

  /**
   * Deduplicate alternatives by similarity
   */
  private deduplicateAlternatives(alternatives: AlternativeApproach[]): AlternativeApproach[] {
    const unique: AlternativeApproach[] = [];

    for (const alt of alternatives) {
      const isDupe = unique.some(u =>
        this.similarityScore(u.approach.toLowerCase(), alt.approach.toLowerCase()) > 0.6
      );

      if (!isDupe) {
        unique.push(alt);
      }
    }

    return unique;
  }

  /**
   * Get counter-examples for an approach (what NOT to do)
   */
  async getCounterExamples(
    subtask: Subtask,
    proposedApproach: string
  ): Promise<Array<{ warning: string; reason: string }>> {
    const warnings: Array<{ warning: string; reason: string }> = [];

    try {
      // Query for failures with similar approaches
      const results = await this.engine.query(
        `failure with approach: ${proposedApproach} for ${subtask.type}`,
        {
          topK: 3,
          filters: {
            tags: ['codex', 'failure'],
            minImportance: 0.4
          }
        }
      );

      for (const result of results) {
        const error = this.extractErrorFromContent(result.entry.content);
        if (error) {
          warnings.push({
            warning: `Similar approach failed: ${error}`,
            reason: `Based on past failure with similar ${subtask.type} task`
          });
        }
      }

    } catch {
      // Return empty on error
    }

    return warnings;
  }

  /**
   * Extract error from content
   */
  private extractErrorFromContent(content: string): string | undefined {
    const match = content.match(/Error: ([^\n]+)/);
    return match ? match[1] : undefined;
  }

  /**
   * Rank alternatives based on similar failures
   */
  async rankByAvoidingPastFailures(
    alternatives: AlternativeApproach[],
    similarFailures: SimilarFailure[]
  ): Promise<AlternativeApproach[]> {
    // Boost alternatives that explicitly avoid past failure patterns
    for (const alt of alternatives) {
      for (const failure of similarFailures) {
        // If alternative mentions avoiding the failure pattern, boost confidence
        if (failure.resolution &&
            alt.approach.toLowerCase().includes(failure.resolution.toLowerCase())) {
          alt.confidence = Math.min(1.0, alt.confidence * 1.2);
          alt.rationale += ` (matches resolution for similar failure)`;
        }

        // If alternative is similar to what failed, reduce confidence
        if (this.similarityScore(alt.approach.toLowerCase(), failure.error.toLowerCase()) > 0.4) {
          alt.confidence *= 0.7;
        }
      }
    }

    // Re-sort by confidence
    alternatives.sort((a, b) => b.confidence - a.confidence);

    return alternatives;
  }
}

export default AlternativesFinder;
