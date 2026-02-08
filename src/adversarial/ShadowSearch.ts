/**
 * Shadow Vector Search
 *
 * Finds contradictory evidence by searching with the inverted query vector.
 * While normal search finds supporting evidence, shadow search finds opposing viewpoints.
 *
 * The Math:
 *   Normal query:  v = [0.3, -0.2, 0.8, 0.1, ...]
 *   Shadow query:  Shadow(v) = v × -1 = [-0.3, 0.2, -0.8, -0.1, ...]
 *
 * Effect on similarity:
 *   - Document D supports query Q:     cosine(Q, D) ≈ +0.8  (similar)
 *   - Same document with Shadow(Q):    cosine(Shadow(Q), D) ≈ -0.8  (opposite)
 *
 * So searching with Shadow(Q) returns documents that REFUTE the original query!
 *
 * Use cases:
 *   1. Risk Assessment: Before entering a trade, find reasons it might fail
 *   2. Bias Detection: Ensure you're not only seeing confirming evidence
 *   3. Devil's Advocate: Automatically generate counter-arguments
 */

import type {
  Contradiction,
  ContradictionType,
  ShadowSearchOptions,
  ShadowSearchResult,
  ShadowSearchConfig
} from './types.js';
import type { VectorDB } from '../vector/VectorDB.js';
import type { EmbeddingService } from '../vector/EmbeddingService.js';
import type { SQLiteStorage } from '../storage/SQLiteStorage.js';
import type { ProvenanceStore } from '../provenance/ProvenanceStore.js';

const DEFAULT_CONFIG: ShadowSearchConfig = {
  defaultThreshold: 0.5,
  defaultTopK: 10,
  lScoreWeight: 1.0
};

export class ShadowSearch {
  private config: ShadowSearchConfig;

  constructor(config?: Partial<ShadowSearchConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Invert a vector for shadow search
   * Shadow(v) = v × -1
   */
  invert(vector: Float32Array): Float32Array {
    const inverted = new Float32Array(vector.length);
    for (let i = 0; i < vector.length; i++) {
      inverted[i] = -vector[i];
    }
    return inverted;
  }

  /**
   * Find contradictions to a query
   * @param precomputedEmbedding - Optional pre-computed embedding to avoid duplicate API calls
   */
  async findContradictions(
    query: string,
    vectorDb: VectorDB,
    embeddings: EmbeddingService,
    storage: SQLiteStorage,
    provenance: ProvenanceStore,
    options: ShadowSearchOptions = {},
    precomputedEmbedding?: Float32Array
  ): Promise<Contradiction[]> {
    const threshold = options.threshold ?? this.config.defaultThreshold;
    const topK = options.topK ?? this.config.defaultTopK;

    // Use pre-computed embedding if available, otherwise generate
    const embedding = precomputedEmbedding ?? (await embeddings.embed(query)).embedding;

    // Invert the embedding for shadow search
    const shadowVector = this.invert(embedding);

    // Search with shadow vector
    // Request more results to allow for filtering
    const searchLimit = topK * 3;
    const vectorResults = vectorDb.search(shadowVector, searchLimit);

    const contradictions: Contradiction[] = [];

    for (const vr of vectorResults) {
      // Shadow similarity is the raw score from shadow vector search
      const shadowSimilarity = vr.score;

      // Refutation strength is based on how similar the entry is to the shadow vector
      // Higher shadow similarity = stronger refutation
      const refutationStrength = shadowSimilarity;

      // Skip if below threshold
      if (refutationStrength < threshold) continue;

      // Get entry ID from label
      const entryId = storage.getEntryIdByLabel(vr.label);
      if (!entryId) continue;

      const entry = storage.getEntry(entryId);
      if (!entry) continue;

      // Apply filters
      if (options.tags && options.tags.length > 0) {
        const hasTag = options.tags.some(tag => entry.metadata.tags.includes(tag));
        if (!hasTag) continue;
      }

      if (options.minImportance !== undefined && entry.metadata.importance < options.minImportance) {
        continue;
      }

      // Get L-Score if requested
      let lScore: number | undefined;
      if (options.includeProvenance) {
        lScore = entry.provenance.lScore ?? provenance.calculateAndStoreLScore(entryId);
      }

      // Determine contradiction type based on content analysis
      // For now, use a simple heuristic based on refutation strength
      const contradictionType = this.classifyContradiction(refutationStrength);

      // Skip if filtering by contradiction type
      if (options.contradictionType && contradictionType !== options.contradictionType) {
        continue;
      }

      contradictions.push({
        entry,
        refutationStrength,
        contradictionType,
        lScore,
        shadowSimilarity
      });

      if (contradictions.length >= topK) break;
    }

    // Sort by refutation strength (strongest first)
    contradictions.sort((a, b) => b.refutationStrength - a.refutationStrength);

    return contradictions;
  }

  /**
   * Classify the type of contradiction based on refutation strength
   * This is a simple heuristic - could be enhanced with NLP analysis
   */
  private classifyContradiction(refutationStrength: number): ContradictionType {
    if (refutationStrength >= 0.8) {
      return 'direct_negation';
    } else if (refutationStrength >= 0.65) {
      return 'counterargument';
    } else if (refutationStrength >= 0.5) {
      return 'alternative';
    } else {
      return 'exception';
    }
  }

  /**
   * Calculate credibility score by comparing support vs contradictions
   *
   * credibility = supportWeight / (supportWeight + contradictionWeight)
   *
   * Where weights are similarity scores weighted by L-Score:
   *   weight = similarity × (lScore || 1)
   */
  calculateCredibility(
    supportResults: Array<{ score: number; lScore?: number }>,
    contradictions: Contradiction[]
  ): {
    credibility: number;
    supportWeight: number;
    contradictionWeight: number;
  } {
    // Calculate support weight
    const supportWeight = supportResults.reduce((sum, r) => {
      const lScoreMultiplier = r.lScore ?? 1.0;
      return sum + r.score * lScoreMultiplier * this.config.lScoreWeight;
    }, 0);

    // Calculate contradiction weight
    const contradictionWeight = contradictions.reduce((sum, c) => {
      const lScoreMultiplier = c.lScore ?? 1.0;
      return sum + c.refutationStrength * lScoreMultiplier * this.config.lScoreWeight;
    }, 0);

    // Calculate credibility (avoid division by zero)
    const total = supportWeight + contradictionWeight;
    const credibility = total > 0 ? supportWeight / total : 0.5;

    return {
      credibility,
      supportWeight,
      contradictionWeight
    };
  }

  /**
   * Perform full shadow search with credibility analysis
   */
  async search(
    query: string,
    vectorDb: VectorDB,
    embeddings: EmbeddingService,
    storage: SQLiteStorage,
    provenance: ProvenanceStore,
    options: ShadowSearchOptions = {}
  ): Promise<ShadowSearchResult> {
    const topK = options.topK ?? this.config.defaultTopK;

    // Get supporting evidence (normal search)
    const { embedding } = await embeddings.embed(query);
    const supportResults = vectorDb.search(embedding, topK);

    // Get contradicting evidence (shadow search) - pass embedding to avoid duplicate API call
    const contradictions = await this.findContradictions(
      query,
      vectorDb,
      embeddings,
      storage,
      provenance,
      options,
      embedding
    );

    // Map support results to include L-Score
    const supportWithLScore = supportResults.map(vr => {
      const entryId = storage.getEntryIdByLabel(vr.label);
      if (!entryId) return { score: vr.score };

      const entry = storage.getEntry(entryId);
      if (!entry) return { score: vr.score };

      const lScore = options.includeProvenance
        ? (entry.provenance.lScore ?? provenance.calculateAndStoreLScore(entryId))
        : undefined;

      return { score: vr.score, lScore };
    });

    // Calculate credibility
    const { credibility, supportWeight, contradictionWeight } = this.calculateCredibility(
      supportWithLScore,
      contradictions
    );

    return {
      query,
      contradictions,
      count: contradictions.length,
      credibility,
      supportWeight,
      contradictionWeight
    };
  }

  /**
   * Quick check if a claim has significant contradictions
   * Returns true if credibility is below threshold (default 0.5)
   */
  async isContested(
    query: string,
    vectorDb: VectorDB,
    embeddings: EmbeddingService,
    storage: SQLiteStorage,
    provenance: ProvenanceStore,
    credibilityThreshold: number = 0.5
  ): Promise<boolean> {
    const result = await this.search(
      query,
      vectorDb,
      embeddings,
      storage,
      provenance,
      { topK: 5, includeProvenance: true }
    );

    return result.credibility < credibilityThreshold;
  }
}
