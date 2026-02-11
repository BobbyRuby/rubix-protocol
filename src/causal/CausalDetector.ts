/**
 * Causal Detector
 *
 * Automatically detects and creates causal relations when memories are stored.
 * Analyzes tags, content, and context to infer relationships between entries.
 */

import type { MemoryEntry, CausalRelation, CausalRelationType, QueryResult } from '../core/types.js';
import { CausalRelationType as CRT } from '../core/types.js';

/** Minimal engine interface to avoid circular dependency */
export interface CausalDetectorEngine {
  query(text: string, options: { topK?: number; minScore?: number; filters?: { tags?: string[]; tagMatchAll?: boolean } }): Promise<QueryResult[]>;
  addCausalRelation(
    sourceIds: string[],
    targetIds: string[],
    type: CausalRelationType,
    strength?: number,
    options?: { metadata?: Record<string, unknown> }
  ): CausalRelation;
  getEntry(id: string): MemoryEntry | null;
}

export interface CausalDetectorResult {
  relations: CausalRelation[];
  strategies: string[];
}

/** Tags that indicate a bug fix */
const BUG_FIX_TAGS = new Set([
  'bugfix', 'bug_fix', 'fix', 'hotfix', 'resolution', 'patch',
  'bug-fix', 'fixed', 'resolved'
]);


/** Tags that indicate implementation work */
const IMPL_TAGS = new Set([
  'implementation', 'dev_feature', 'feature', 'dev', 'development',
  'coding', 'built', 'implemented'
]);

/** Minimum semantic similarity to consider entries related */
const MIN_SIMILARITY = 0.55;

/** Minimum similarity for strong causal links */
const STRONG_SIMILARITY = 0.7;

export class CausalDetector {
  private engine: CausalDetectorEngine;

  constructor(engine: CausalDetectorEngine) {
    this.engine = engine;
  }

  /**
   * Detect and create causal relations for a newly stored entry.
   * Called automatically after store() completes.
   */
  async detectAndLink(
    newEntryId: string,
    tags: string[],
    content: string
  ): Promise<CausalDetectorResult> {
    const result: CausalDetectorResult = { relations: [], strategies: [] };
    const tagSet = new Set(tags.map(t => t.toLowerCase()));

    try {
      // Strategy 1: Bug→Fix detection
      if (this.hasBugFixTags(tagSet)) {
        const links = await this.detectBugFixLinks(newEntryId, content);
        result.relations.push(...links);
        if (links.length > 0) result.strategies.push('bug→fix');
      }

      // Strategy 2: Error→Resolution detection
      if (tagSet.has('resolution') || tagSet.has('resolved')) {
        const links = await this.detectErrorResolutionLinks(newEntryId, content);
        result.relations.push(...links);
        if (links.length > 0) result.strategies.push('error→resolution');
      }

      // Strategy 3: Architecture→Implementation detection
      if (this.hasImplTags(tagSet)) {
        const links = await this.detectArchImplLinks(newEntryId, content, tags);
        result.relations.push(...links);
        if (links.length > 0) result.strategies.push('arch→impl');
      }

      // Strategy 4: Cross-instance dependency detection
      const instanceLinks = await this.detectCrossInstanceLinks(newEntryId, content, tags);
      result.relations.push(...instanceLinks);
      if (instanceLinks.length > 0) result.strategies.push('cross-instance');
    } catch (err) {
      // Non-critical: log but don't fail the store
      console.error('[CausalDetector] Error during detection:', err);
    }

    return result;
  }

  /**
   * Detect causal relations for a session store with structured data.
   * Has richer context (decisions, patterns, filesChanged) for better detection.
   */
  async detectAndLinkSession(
    sessionEntryId: string,
    context: {
      decisions?: string[];
      patterns?: string[];
      filesChanged?: string[];
      tags: string[];
      content: string;
    }
  ): Promise<CausalDetectorResult> {
    const result: CausalDetectorResult = { relations: [], strategies: [] };

    try {
      // Strategy 5: Session predecessor chain (overlapping files)
      if (context.filesChanged?.length) {
        const links = await this.detectSessionChain(sessionEntryId, context.filesChanged, context.content);
        result.relations.push(...links);
        if (links.length > 0) result.strategies.push('session-chain');
      }

      // Also run standard detection strategies
      const standardResult = await this.detectAndLink(
        sessionEntryId,
        context.tags,
        context.content
      );
      result.relations.push(...standardResult.relations);
      result.strategies.push(...standardResult.strategies);
    } catch (err) {
      console.error('[CausalDetector] Error during session detection:', err);
    }

    return result;
  }

  // ===========================================
  // Detection Strategies
  // ===========================================

  /**
   * Strategy 1: Find related bug/error entries for a new fix entry.
   * New fix → `causes` ← related bug
   * (Bug causes the fix to exist)
   */
  private async detectBugFixLinks(fixEntryId: string, fixContent: string): Promise<CausalRelation[]> {
    const relations: CausalRelation[] = [];

    // Search for related bug/error entries
    const results = await this.engine.query(fixContent, {
      topK: 5,
      minScore: MIN_SIMILARITY,
      filters: {
        tags: ['bug', 'error', 'error_pattern', 'failure', 'issue', 'broken', 'defect'],
        tagMatchAll: false
      }
    });

    for (const r of results) {
      if (r.entry.id === fixEntryId) continue; // Skip self
      if (r.score < MIN_SIMILARITY) continue;

      const strength = Math.min(0.95, 0.7 + (r.score - MIN_SIMILARITY) * 0.5);
      try {
        const relation = this.engine.addCausalRelation(
          [r.entry.id], [fixEntryId],
          CRT.CAUSES,
          strength,
          { metadata: { autoDetected: true, strategy: 'bug→fix', similarity: r.score } }
        );
        relations.push(relation);
      } catch (err) {
        console.error('[CausalDetector] Failed to create bug→fix link:', err);
      }
    }

    return relations;
  }

  /**
   * Strategy 2: Find error patterns that triggered a resolution.
   * Error pattern → `triggers` → resolution
   */
  private async detectErrorResolutionLinks(resolutionEntryId: string, content: string): Promise<CausalRelation[]> {
    const relations: CausalRelation[] = [];

    const results = await this.engine.query(content, {
      topK: 3,
      minScore: MIN_SIMILARITY,
      filters: {
        tags: ['error_pattern', 'error', 'failure'],
        tagMatchAll: false
      }
    });

    for (const r of results) {
      if (r.entry.id === resolutionEntryId) continue;
      if (r.score < MIN_SIMILARITY) continue;

      const strength = Math.min(0.9, 0.65 + (r.score - MIN_SIMILARITY) * 0.5);
      try {
        const relation = this.engine.addCausalRelation(
          [r.entry.id], [resolutionEntryId],
          CRT.TRIGGERS,
          strength,
          { metadata: { autoDetected: true, strategy: 'error→resolution', similarity: r.score } }
        );
        relations.push(relation);
      } catch (err) {
        console.error('[CausalDetector] Failed to create error→resolution link:', err);
      }
    }

    return relations;
  }

  /**
   * Strategy 3: Find architecture insights that enabled an implementation.
   * Architecture insight → `enables` → implementation
   */
  private async detectArchImplLinks(implEntryId: string, content: string, tags: string[]): Promise<CausalRelation[]> {
    const relations: CausalRelation[] = [];

    // Find related arch insights
    const results = await this.engine.query(content, {
      topK: 3,
      minScore: 0.6,
      filters: {
        tags: ['arch_insight', 'architecture', 'design', 'design_decision', 'system_design'],
        tagMatchAll: false
      }
    });

    for (const r of results) {
      if (r.entry.id === implEntryId) continue;
      if (r.score < 0.6) continue;

      // Check tag overlap for stronger signal
      const entryTags = new Set(r.entry.metadata.tags.map((t: string) => t.toLowerCase()));
      const sharedSubsystem = tags.some(t =>
        !IMPL_TAGS.has(t.toLowerCase()) &&
        !BUG_FIX_TAGS.has(t.toLowerCase()) &&
        t !== 'session' &&
        !t.match(/^\d{4}-\d{2}-\d{2}$/) &&
        !t.startsWith('instance_') &&
        entryTags.has(t.toLowerCase())
      );

      if (r.score >= STRONG_SIMILARITY || sharedSubsystem) {
        const strength = sharedSubsystem ? 0.8 : 0.75;
        try {
          const relation = this.engine.addCausalRelation(
            [r.entry.id], [implEntryId],
            CRT.ENABLES,
            strength,
            { metadata: { autoDetected: true, strategy: 'arch→impl', similarity: r.score, sharedSubsystem } }
          );
          relations.push(relation);
        } catch (err) {
          console.error('[CausalDetector] Failed to create arch→impl link:', err);
        }
      }
    }

    return relations;
  }

  /**
   * Strategy 4: Detect cross-instance dependencies.
   * If content mentions another instance's work, create `enables` link.
   */
  private async detectCrossInstanceLinks(entryId: string, content: string, tags: string[]): Promise<CausalRelation[]> {
    const relations: CausalRelation[] = [];

    // Check if content mentions another instance
    const instanceMentions = content.match(/instance[_\s](\d+)/gi);
    if (!instanceMentions) return relations;

    // Find our instance from tags
    const ourInstance = tags.find(t => t.match(/^instance_\d+$/));
    if (!ourInstance) return relations;

    // Extract mentioned instances that aren't ours
    const mentionedInstances = new Set<string>();
    for (const mention of instanceMentions) {
      const num = mention.match(/(\d+)/)?.[1];
      if (num) {
        const tag = `instance_${num}`;
        if (tag !== ourInstance) {
          mentionedInstances.add(tag);
        }
      }
    }

    // Search for recent entries from mentioned instances
    for (const instanceTag of mentionedInstances) {
      const results = await this.engine.query(content, {
        topK: 2,
        minScore: MIN_SIMILARITY,
        filters: {
          tags: [instanceTag],
          tagMatchAll: true
        }
      });

      for (const r of results) {
        if (r.entry.id === entryId) continue;
        if (r.score < MIN_SIMILARITY) continue;

        try {
          const relation = this.engine.addCausalRelation(
            [r.entry.id], [entryId],
            CRT.ENABLES,
            0.8,
            { metadata: { autoDetected: true, strategy: 'cross-instance', fromInstance: instanceTag, similarity: r.score } }
          );
          relations.push(relation);
        } catch (err) {
          console.error('[CausalDetector] Failed to create cross-instance link:', err);
        }
      }
    }

    return relations;
  }

  /**
   * Strategy 5: Detect session predecessor chains via overlapping files.
   * Previous session → `precedes` → new session
   */
  private async detectSessionChain(
    sessionEntryId: string,
    filesChanged: string[],
    content: string
  ): Promise<CausalRelation[]> {
    const relations: CausalRelation[] = [];

    // Search for previous sessions
    const results = await this.engine.query(content, {
      topK: 5,
      minScore: 0.4,
      filters: {
        tags: ['session'],
        tagMatchAll: true
      }
    });

    for (const r of results) {
      if (r.entry.id === sessionEntryId) continue;

      // Check for overlapping files
      const entryContent = r.entry.content;
      const overlapping = filesChanged.filter(f => entryContent.includes(f));

      if (overlapping.length > 0) {
        const strength = Math.min(0.9, 0.5 + overlapping.length * 0.1);
        try {
          const relation = this.engine.addCausalRelation(
            [r.entry.id], [sessionEntryId],
            CRT.PRECEDES,
            strength,
            { metadata: { autoDetected: true, strategy: 'session-chain', overlappingFiles: overlapping } }
          );
          relations.push(relation);
        } catch (err) {
          console.error('[CausalDetector] Failed to create session-chain link:', err);
        }
      }
    }

    return relations;
  }

  // ===========================================
  // Utility Methods
  // ===========================================

  private hasBugFixTags(tags: Set<string>): boolean {
    for (const t of tags) {
      if (BUG_FIX_TAGS.has(t)) return true;
    }
    return false;
  }

  private hasImplTags(tags: Set<string>): boolean {
    for (const t of tags) {
      if (IMPL_TAGS.has(t)) return true;
    }
    return false;
  }
}
