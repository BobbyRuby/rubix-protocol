/**
 * Provenance Store
 *
 * Manages provenance tracking, lineage chains, and L-Score calculations.
 * Works with SQLiteStorage for persistence.
 */

import { LScoreCalculator } from './LScoreCalculator.js';
import type { SQLiteStorage } from '../storage/SQLiteStorage.js';
import type { ProvenanceInfo } from '../core/types.js';
import type { LineageNode, ProvenanceChain, ProvenanceStoreConfig, LineageTraceResult } from './types.js';

export class ProvenanceStore {
  private storage: SQLiteStorage;
  private lScoreCalc: LScoreCalculator;
  private lineageCache: Map<string, LineageNode> = new Map();

  constructor(storage: SQLiteStorage, config: ProvenanceStoreConfig) {
    this.storage = storage;
    this.lScoreCalc = new LScoreCalculator(config.lScoreConfig);
  }

  /**
   * Calculate and store L-Score for an entry
   */
  calculateAndStoreLScore(entryId: string): number {
    const provenance = this.storage.getProvenance(entryId);
    if (!provenance) {
      return 1.0; // Root entry
    }

    const lScore = this.calculateLScoreForEntry(entryId, provenance);
    this.storage.updateLScore(entryId, lScore);

    return lScore;
  }

  /**
   * Calculate L-Score by traversing the provenance chain
   */
  private calculateLScoreForEntry(_entryId: string, provenance: ProvenanceInfo): number {
    if (provenance.parentIds.length === 0) {
      return 1.0; // Root entry
    }

    // Collect confidence and relevance values from the chain
    const confidences: number[] = [provenance.confidence];
    const relevances: number[] = [provenance.relevance];

    // Traverse parent chain
    for (const parentId of provenance.parentIds) {
      const parentProv = this.storage.getProvenance(parentId);
      if (parentProv) {
        confidences.push(parentProv.confidence);
        relevances.push(parentProv.relevance);
      }
    }

    return this.lScoreCalc.calculate({
      confidences,
      relevances,
      depth: provenance.lineageDepth
    });
  }

  /**
   * Trace lineage chain from an entry to its roots
   * OPTIMIZED: Uses recursive CTE + batch fetching instead of N+1 queries
   */
  traceLineage(entryId: string, maxDepth: number = 10): ProvenanceChain {
    // STEP 1: Use recursive CTE to get all entry IDs in lineage (single query)
    const lineageIds = this.storage.getLineageEntryIds(entryId, maxDepth);
    if (lineageIds.length === 0) {
      return {
        rootId: entryId,
        nodes: new Map(),
        maxDepth: 0,
        aggregateLScore: 1.0
      };
    }

    // STEP 2: Batch fetch all provenance and entries (2-3 queries total vs N+1)
    const provenanceMap = this.storage.getBatchProvenance(lineageIds);
    const entryMap = this.storage.getBatchEntries(lineageIds);

    // STEP 3: Build lineage tree from cached data
    const nodes = new Map<string, LineageNode>();
    let maxFoundDepth = 0;

    // Build nodes map using memoization to avoid redundant traversal
    const buildNode = (id: string, depth: number): LineageNode | null => {
      if (depth > maxDepth) return null;
      if (nodes.has(id)) return nodes.get(id)!;

      const provenance = provenanceMap.get(id);
      const entry = entryMap.get(id);
      if (!provenance || !entry) return null;

      // Build children first (parents in lineage tree)
      const children: LineageNode[] = [];
      for (const parentId of provenance.parentIds) {
        const childNode = buildNode(parentId, depth + 1);
        if (childNode) {
          children.push(childNode);
        }
      }

      const lScore = provenance.lScore ?? this.calculateLScoreForEntry(id, provenance);

      const node: LineageNode = {
        entryId: id,
        depth,
        confidence: provenance.confidence,
        relevance: provenance.relevance,
        lScore,
        children
      };

      nodes.set(id, node);
      maxFoundDepth = Math.max(maxFoundDepth, depth);

      return node;
    };

    buildNode(entryId, 0);

    // Calculate aggregate L-Score for the chain
    const allLScores = Array.from(nodes.values()).map(n => n.lScore);
    const aggregateLScore = allLScores.length > 0
      ? this.lScoreCalc.aggregateFromParents(allLScores)
      : 1.0;

    return {
      rootId: entryId,
      nodes,
      maxDepth: maxFoundDepth,
      aggregateLScore
    };
  }

  /**
   * Get flattened lineage trace for an entry
   */
  getLineageTrace(entryId: string, maxDepth: number = 10): LineageTraceResult {
    const provenance = this.storage.getProvenance(entryId);
    if (!provenance) {
      return {
        entryId,
        depth: 0,
        lScore: 1.0,
        parentChain: []
      };
    }

    const parentChain: Array<{ id: string; confidence: number; relevance: number }> = [];

    const collectParents = (id: string, depth: number): void => {
      if (depth > maxDepth) return;

      const prov = this.storage.getProvenance(id);
      if (!prov) return;

      for (const parentId of prov.parentIds) {
        const parentProv = this.storage.getProvenance(parentId);
        if (parentProv) {
          parentChain.push({
            id: parentId,
            confidence: parentProv.confidence,
            relevance: parentProv.relevance
          });
          collectParents(parentId, depth + 1);
        }
      }
    };

    collectParents(entryId, 0);

    const lScore = provenance.lScore ?? this.calculateLScoreForEntry(entryId, provenance);

    return {
      entryId,
      depth: provenance.lineageDepth,
      lScore,
      parentChain
    };
  }

  /**
   * Get all descendants of an entry (entries derived from it)
   */
  getDescendants(entryId: string, maxDepth: number = 10): string[] {
    const descendants: string[] = [];
    const visited = new Set<string>();

    const traverse = (id: string, depth: number): void => {
      if (depth > maxDepth) return;
      if (visited.has(id)) return;
      visited.add(id);

      const childIds = this.storage.getChildIds(id);
      for (const childId of childIds) {
        descendants.push(childId);
        traverse(childId, depth + 1);
      }
    };

    traverse(entryId, 0);
    return descendants;
  }

  /**
   * Recalculate L-Scores for an entry and all its descendants
   */
  propagateLScoreUpdate(entryId: string): void {
    // Recalculate for the entry
    this.calculateAndStoreLScore(entryId);

    // Propagate to all descendants
    const descendants = this.getDescendants(entryId);
    for (const descendantId of descendants) {
      this.calculateAndStoreLScore(descendantId);
    }
  }

  /**
   * Check if an entry has reliable provenance
   */
  isReliable(entryId: string, threshold: number = 0.5): boolean {
    const provenance = this.storage.getProvenance(entryId);
    if (!provenance) return true; // Root entries are reliable

    const lScore = provenance.lScore ?? this.calculateLScoreForEntry(entryId, provenance);
    return this.lScoreCalc.isReliable(lScore, threshold);
  }

  /**
   * Get reliability category for an entry
   */
  getReliabilityCategory(entryId: string): 'high' | 'medium' | 'low' | 'unreliable' {
    const provenance = this.storage.getProvenance(entryId);
    if (!provenance) return 'high'; // Root entries have high reliability

    const lScore = provenance.lScore ?? this.calculateLScoreForEntry(entryId, provenance);
    return this.lScoreCalc.getReliabilityCategory(lScore);
  }

  getLScoreCalculator(): LScoreCalculator {
    return this.lScoreCalc;
  }

  clearCache(): void {
    this.lineageCache.clear();
  }
}
