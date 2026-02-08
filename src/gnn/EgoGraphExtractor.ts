/**
 * Ego Graph Extractor
 *
 * Extracts the local neighborhood (ego graph) around a target node
 * from both the causal graph and provenance links.
 *
 * The ego graph includes:
 * - Center node (the target entry)
 * - 1-hop neighbors (directly connected via causal/provenance)
 * - 2-hop neighbors (connected to 1-hop neighbors)
 *
 * This neighborhood provides structural context for GNN enhancement.
 */

import type { SQLiteStorage } from '../storage/SQLiteStorage.js';
import type { CausalMemory } from '../causal/CausalMemory.js';
import type {
  EgoGraph,
  EgoNode,
  EgoEdge,
  EgoGraphConfig
} from './types.js';
import { DEFAULT_EGO_CONFIG } from './types.js';

export class EgoGraphExtractor {
  private storage: SQLiteStorage;
  private causal: CausalMemory;
  private config: EgoGraphConfig;

  constructor(
    storage: SQLiteStorage,
    causal: CausalMemory,
    config: Partial<EgoGraphConfig> = {}
  ) {
    this.storage = storage;
    this.causal = causal;
    this.config = { ...DEFAULT_EGO_CONFIG, ...config };
  }

  /**
   * Extract ego graph centered on a specific entry
   */
  extract(centerId: string, centerEmbedding: Float32Array): EgoGraph {
    const nodes: Map<string, EgoNode> = new Map();
    const edges: EgoEdge[] = [];
    const visited = new Set<string>();

    // Add center node
    nodes.set(centerId, {
      id: centerId,
      hopDistance: 0,
      edgeWeight: 1.0,
      embedding: centerEmbedding
    });
    visited.add(centerId);

    // BFS to extract neighbors
    let currentHopNodes = [centerId];

    for (let hop = 1; hop <= this.config.maxHops; hop++) {
      const nextHopNodes: string[] = [];
      let neighborsAdded = 0;

      for (const nodeId of currentHopNodes) {
        if (neighborsAdded >= this.config.maxNeighborsPerHop) break;

        // Get neighbors from causal graph
        if (this.config.includeCausal) {
          const causalNeighbors = this.getCausalNeighbors(nodeId);

          for (const neighbor of causalNeighbors) {
            if (visited.has(neighbor.id)) continue;
            if (neighbor.weight < this.config.minEdgeWeight) continue;
            if (neighborsAdded >= this.config.maxNeighborsPerHop) break;

            visited.add(neighbor.id);
            nodes.set(neighbor.id, {
              id: neighbor.id,
              hopDistance: hop,
              edgeWeight: neighbor.weight,
              relationType: neighbor.relationType
            });

            edges.push({
              sourceId: nodeId,
              targetId: neighbor.id,
              weight: neighbor.weight,
              relationType: neighbor.relationType
            });

            nextHopNodes.push(neighbor.id);
            neighborsAdded++;
          }
        }

        // Get neighbors from provenance graph
        if (this.config.includeProvenance) {
          const provNeighbors = this.getProvenanceNeighbors(nodeId);

          for (const neighbor of provNeighbors) {
            if (visited.has(neighbor.id)) continue;
            if (neighborsAdded >= this.config.maxNeighborsPerHop) break;

            visited.add(neighbor.id);
            nodes.set(neighbor.id, {
              id: neighbor.id,
              hopDistance: hop,
              edgeWeight: neighbor.weight,
              relationType: neighbor.relationType
            });

            edges.push({
              sourceId: nodeId,
              targetId: neighbor.id,
              weight: neighbor.weight,
              relationType: neighbor.relationType
            });

            nextHopNodes.push(neighbor.id);
            neighborsAdded++;
          }
        }
      }

      currentHopNodes = nextHopNodes;

      // Stop if no more neighbors
      if (currentHopNodes.length === 0) break;
    }

    return {
      centerId,
      centerEmbedding,
      nodes: Array.from(nodes.values()),
      edges,
      maxHops: this.config.maxHops,
      neighborCount: nodes.size - 1 // Exclude center
    };
  }

  /**
   * Extract ego graphs for multiple entries (batch processing)
   */
  extractBatch(
    entries: Array<{ id: string; embedding: Float32Array }>
  ): EgoGraph[] {
    return entries.map(entry => this.extract(entry.id, entry.embedding));
  }

  /**
   * Load embeddings for all nodes in an ego graph
   * Returns the ego graph with embeddings populated
   */
  async loadEmbeddings(
    graph: EgoGraph,
    embeddingLookup: (id: string) => Promise<Float32Array | null>
  ): Promise<EgoGraph> {
    const nodesWithEmbeddings = await Promise.all(
      graph.nodes.map(async node => {
        if (node.embedding) return node;

        const embedding = await embeddingLookup(node.id);
        return {
          ...node,
          embedding: embedding ?? undefined
        };
      })
    );

    return {
      ...graph,
      nodes: nodesWithEmbeddings
    };
  }

  /**
   * Get statistics about ego graph extraction
   */
  getGraphStats(graph: EgoGraph): {
    totalNodes: number;
    nodesByHop: Record<number, number>;
    avgEdgeWeight: number;
    relationTypes: Record<string, number>;
  } {
    const nodesByHop: Record<number, number> = {};
    const relationTypes: Record<string, number> = {};
    let totalWeight = 0;

    for (const node of graph.nodes) {
      nodesByHop[node.hopDistance] = (nodesByHop[node.hopDistance] ?? 0) + 1;
    }

    for (const edge of graph.edges) {
      totalWeight += edge.weight;
      relationTypes[edge.relationType] = (relationTypes[edge.relationType] ?? 0) + 1;
    }

    return {
      totalNodes: graph.nodes.length,
      nodesByHop,
      avgEdgeWeight: graph.edges.length > 0 ? totalWeight / graph.edges.length : 0,
      relationTypes
    };
  }

  // ============ Private Methods ============

  /**
   * Get neighbors from causal graph
   */
  private getCausalNeighbors(nodeId: string): Array<{
    id: string;
    weight: number;
    relationType: string;
  }> {
    const neighbors: Array<{ id: string; weight: number; relationType: string }> = [];

    // Get relations where this node is a source (forward direction)
    const forwardRelations = this.causal.getRelationsForEntry(nodeId, 'forward');
    for (const relation of forwardRelations) {
      for (const targetId of relation.targetIds) {
        if (targetId !== nodeId) {
          neighbors.push({
            id: targetId,
            weight: relation.strength,
            relationType: `${relation.type}_target`
          });
        }
      }
    }

    // Get relations where this node is a target (backward direction)
    const backwardRelations = this.causal.getRelationsForEntry(nodeId, 'backward');
    for (const relation of backwardRelations) {
      for (const sourceId of relation.sourceIds) {
        if (sourceId !== nodeId) {
          neighbors.push({
            id: sourceId,
            weight: relation.strength,
            relationType: `${relation.type}_source`
          });
        }
      }
    }

    return neighbors;
  }

  /**
   * Get neighbors from provenance graph
   */
  private getProvenanceNeighbors(nodeId: string): Array<{
    id: string;
    weight: number;
    relationType: string;
  }> {
    const neighbors: Array<{ id: string; weight: number; relationType: string }> = [];

    // Get parent entries (this entry is derived from them)
    const parentIds = this.storage.getParentIds(nodeId);
    for (const parentId of parentIds) {
      neighbors.push({
        id: parentId,
        weight: 0.8, // Provenance links have implicit high weight
        relationType: 'provenance_parent'
      });
    }

    // Get child entries (derived from this entry)
    const childIds = this.storage.getChildIds(nodeId);
    for (const childId of childIds) {
      neighbors.push({
        id: childId,
        weight: 0.8,
        relationType: 'provenance_child'
      });
    }

    return neighbors;
  }
}
