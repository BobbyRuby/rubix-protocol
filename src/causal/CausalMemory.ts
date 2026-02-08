/**
 * Causal Memory
 *
 * High-level API for managing causal relationships between memory entries.
 * Combines the Hypergraph with persistent SQLite storage.
 */

import { Hypergraph } from './Hypergraph.js';
import type { SQLiteStorage } from '../storage/SQLiteStorage.js';
import type { CausalRelation, CausalRelationType } from '../core/types.js';
import type { CausalPath, CausalQuery, CausalTraversalResult, CausalGraphStats, CausalExportFormat } from './types.js';
import { v4 as uuidv4 } from 'uuid';

export class CausalMemory {
  private storage: SQLiteStorage;
  private graph: Hypergraph;
  private initialized: boolean = false;

  constructor(storage: SQLiteStorage) {
    this.storage = storage;
    this.graph = new Hypergraph();
  }

  /**
   * Initialize the causal memory by loading existing relations from storage
   * Only loads non-expired relations (those with no expiration or future expiration)
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Load only active (non-expired) causal relations from storage into the hypergraph
    const relations = this.storage.getActiveCausalRelations();
    for (const relation of relations) {
      this.graph.addEdge(
        relation.id,
        relation.type,
        relation.sourceIds,
        relation.targetIds,
        relation.strength,
        relation.metadata
      );
    }

    this.initialized = true;
  }

  /**
   * Add a causal relationship between memory entries
   *
   * @param sourceIds - Entry IDs that are the source of the causal relation
   * @param targetIds - Entry IDs that are the target of the causal relation
   * @param type - Type of causal relationship
   * @param strength - Strength of the relationship (0.0 - 1.0)
   * @param options - Optional parameters including TTL and metadata
   */
  addRelation(
    sourceIds: string[],
    targetIds: string[],
    type: CausalRelationType,
    strength: number = 0.8,
    options?: {
      metadata?: Record<string, unknown>;
      /** Time-to-live in milliseconds. Relation expires after this duration. */
      ttl?: number;
    }
  ): CausalRelation {
    const now = new Date();

    // Calculate expiration time if TTL is specified
    const expiresAt = options?.ttl
      ? new Date(now.getTime() + options.ttl)
      : undefined;

    const relation: CausalRelation = {
      id: uuidv4(),
      type,
      sourceIds,
      targetIds,
      strength,
      metadata: options?.metadata,
      createdAt: now,
      ttl: options?.ttl,
      expiresAt
    };

    // Store in SQLite
    this.storage.storeCausalRelation(relation);

    // Add to in-memory hypergraph
    this.graph.addEdge(
      relation.id,
      relation.type,
      relation.sourceIds,
      relation.targetIds,
      relation.strength,
      relation.metadata
    );

    return relation;
  }

  /**
   * Get a causal relation by ID
   */
  getRelation(id: string): CausalRelation | null {
    return this.storage.getCausalRelation(id);
  }

  /**
   * Find causal relationships for a memory entry
   */
  getRelationsForEntry(
    entryId: string,
    direction: 'forward' | 'backward' | 'both' = 'both'
  ): CausalRelation[] {
    return this.storage.getCausalRelationsForEntry(entryId, direction);
  }

  /**
   * Traverse causal relationships from starting entries
   */
  traverse(query: CausalQuery): CausalTraversalResult {
    return this.graph.traverse(query);
  }

  /**
   * Find all causal paths between two entries
   */
  findPaths(sourceId: string, targetId: string, maxDepth: number = 10): CausalPath[] {
    return this.graph.findPaths(sourceId, targetId, maxDepth);
  }

  /**
   * Find entries that are caused by a given entry (forward causation)
   */
  findEffects(entryId: string, maxDepth: number = 5): string[] {
    const result = this.graph.traverse({
      startNodeIds: [entryId],
      direction: 'forward',
      maxDepth
    });

    const effects = new Set<string>();
    for (const path of result.paths) {
      for (const nodeId of path.nodes) {
        if (nodeId !== entryId) {
          effects.add(nodeId);
        }
      }
    }

    return Array.from(effects);
  }

  /**
   * Find entries that cause a given entry (backward causation)
   */
  findCauses(entryId: string, maxDepth: number = 5): string[] {
    const result = this.graph.traverse({
      startNodeIds: [entryId],
      direction: 'backward',
      maxDepth
    });

    const causes = new Set<string>();
    for (const path of result.paths) {
      for (const nodeId of path.nodes) {
        if (nodeId !== entryId) {
          causes.add(nodeId);
        }
      }
    }

    return Array.from(causes);
  }

  /**
   * Calculate causal strength between two entries
   */
  getCausalStrength(sourceId: string, targetId: string): number {
    const paths = this.findPaths(sourceId, targetId);
    if (paths.length === 0) return 0;

    // Return the maximum strength path
    return Math.max(...paths.map(p => p.totalStrength));
  }

  /**
   * Check if there's a causal path between two entries
   */
  hasCausalPath(sourceId: string, targetId: string, maxDepth: number = 10): boolean {
    const paths = this.findPaths(sourceId, targetId, maxDepth);
    return paths.length > 0;
  }

  /**
   * Get statistics about the causal graph
   */
  getStats(): CausalGraphStats {
    return this.graph.getStats();
  }

  /**
   * Export the causal graph for visualization
   */
  export(): CausalExportFormat {
    return this.graph.export();
  }

  /**
   * Export to Mermaid diagram format
   */
  toMermaid(): string {
    return this.graph.toMermaid();
  }

  /**
   * Get all causal relations
   */
  getAllRelations(): CausalRelation[] {
    return this.storage.getAllCausalRelations();
  }

  /**
   * Reload the graph from storage (useful after external modifications)
   */
  async reload(): Promise<void> {
    this.graph.clear();
    this.initialized = false;
    await this.initialize();
  }

  /**
   * Get only active (non-expired) causal relations
   */
  getActiveRelations(): CausalRelation[] {
    return this.storage.getActiveCausalRelations();
  }

  /**
   * Get expired causal relations (for inspection before cleanup)
   */
  getExpiredRelations(): CausalRelation[] {
    return this.storage.getExpiredCausalRelations();
  }

  /**
   * Get count of expired relations
   */
  getExpiredCount(): number {
    return this.storage.getExpiredCausalRelationCount();
  }

  /**
   * Clean up expired causal relations
   *
   * Removes relations from both SQLite storage and the in-memory hypergraph.
   * Market correlations are regime-dependent, so temporal relations naturally expire.
   *
   * @returns Object containing count of cleaned relations and their IDs
   */
  cleanupExpired(): { cleaned: number; relationIds: string[] } {
    // Get expired relations before deleting (for reporting)
    const expiredRelations = this.storage.getExpiredCausalRelations();
    const relationIds = expiredRelations.map(r => r.id);

    if (relationIds.length === 0) {
      return { cleaned: 0, relationIds: [] };
    }

    // Remove from in-memory hypergraph
    for (const id of relationIds) {
      this.graph.removeEdge(id);
    }

    // Delete from SQLite storage
    const deleted = this.storage.deleteExpiredCausalRelations();

    return { cleaned: deleted, relationIds };
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}
