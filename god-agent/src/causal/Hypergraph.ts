/**
 * Hypergraph
 *
 * In-memory hypergraph data structure for causal relationships.
 * A hypergraph allows edges (hyperedges) to connect multiple nodes,
 * representing complex multi-source or multi-target causation.
 */

import type { CausalRelationType } from '../core/types.js';
import type {
  HyperedgeData,
  CausalNode,
  CausalPath,
  CausalQuery,
  CausalTraversalResult,
  CausalGraphStats,
  CausalExportFormat
} from './types.js';

export class Hypergraph {
  private nodes: Map<string, CausalNode> = new Map();
  private edges: Map<string, HyperedgeData> = new Map();

  /**
   * Add a node to the hypergraph
   */
  addNode(id: string): void {
    if (!this.nodes.has(id)) {
      this.nodes.set(id, {
        id,
        outgoingEdges: new Set(),
        incomingEdges: new Set()
      });
    }
  }

  /**
   * Add a hyperedge connecting source nodes to target nodes
   */
  addEdge(
    id: string,
    type: CausalRelationType,
    sourceNodeIds: string[],
    targetNodeIds: string[],
    strength: number,
    metadata?: Record<string, unknown>
  ): void {
    // Ensure all nodes exist
    for (const nodeId of [...sourceNodeIds, ...targetNodeIds]) {
      this.addNode(nodeId);
    }

    const edge: HyperedgeData = {
      id,
      type,
      sourceNodeIds: new Set(sourceNodeIds),
      targetNodeIds: new Set(targetNodeIds),
      strength,
      metadata,
      createdAt: new Date()
    };

    this.edges.set(id, edge);

    // Update node references
    for (const sourceId of sourceNodeIds) {
      this.nodes.get(sourceId)!.outgoingEdges.add(id);
    }

    for (const targetId of targetNodeIds) {
      this.nodes.get(targetId)!.incomingEdges.add(id);
    }
  }

  /**
   * Remove an edge from the hypergraph
   */
  removeEdge(id: string): boolean {
    const edge = this.edges.get(id);
    if (!edge) return false;

    // Update node references
    for (const sourceId of edge.sourceNodeIds) {
      const node = this.nodes.get(sourceId);
      if (node) node.outgoingEdges.delete(id);
    }

    for (const targetId of edge.targetNodeIds) {
      const node = this.nodes.get(targetId);
      if (node) node.incomingEdges.delete(id);
    }

    this.edges.delete(id);
    return true;
  }

  /**
   * Get a node by ID
   */
  getNode(id: string): CausalNode | undefined {
    return this.nodes.get(id);
  }

  /**
   * Get an edge by ID
   */
  getEdge(id: string): HyperedgeData | undefined {
    return this.edges.get(id);
  }

  /**
   * Traverse the hypergraph following causal relationships
   */
  traverse(query: CausalQuery): CausalTraversalResult {
    const paths: CausalPath[] = [];
    const visitedNodes = new Set<string>();
    const visitedEdges = new Set<string>();
    const maxDepth = query.maxDepth ?? 10;

    const dfs = (
      nodeId: string,
      currentPath: string[],
      currentEdges: string[],
      currentStrength: number,
      relationTypes: CausalRelationType[],
      depth: number
    ): void => {
      if (depth > maxDepth) return;

      visitedNodes.add(nodeId);
      const node = this.nodes.get(nodeId);
      if (!node) return;

      // Get relevant edges based on direction
      let edgeIds: Set<string>;
      if (query.direction === 'forward') {
        edgeIds = node.outgoingEdges;
      } else if (query.direction === 'backward') {
        edgeIds = node.incomingEdges;
      } else {
        edgeIds = new Set([...node.outgoingEdges, ...node.incomingEdges]);
      }

      for (const edgeId of edgeIds) {
        const edge = this.edges.get(edgeId);
        if (!edge) continue;

        // Apply filters
        if (query.relationTypes && !query.relationTypes.includes(edge.type)) {
          continue;
        }
        if (query.minStrength !== undefined && edge.strength < query.minStrength) {
          continue;
        }

        visitedEdges.add(edgeId);

        // Get next nodes based on direction
        let nextNodeIds: string[];
        if (query.direction === 'forward') {
          nextNodeIds = Array.from(edge.targetNodeIds);
        } else if (query.direction === 'backward') {
          nextNodeIds = Array.from(edge.sourceNodeIds);
        } else {
          nextNodeIds = [
            ...Array.from(edge.sourceNodeIds),
            ...Array.from(edge.targetNodeIds)
          ].filter(id => id !== nodeId);
        }

        for (const nextId of nextNodeIds) {
          if (currentPath.includes(nextId)) continue; // Avoid cycles

          const newPath = [...currentPath, nextId];
          const newEdges = [...currentEdges, edgeId];
          const newStrength = currentStrength * edge.strength;
          const newTypes = [...relationTypes, edge.type];

          // Record path
          paths.push({
            nodes: newPath,
            edges: newEdges,
            totalStrength: newStrength,
            relationTypes: newTypes
          });

          // Continue traversal
          dfs(nextId, newPath, newEdges, newStrength, newTypes, depth + 1);
        }
      }
    };

    // Start traversal from each start node
    for (const startId of query.startNodeIds) {
      dfs(startId, [startId], [], 1.0, [], 0);
    }

    return { paths, visitedNodes, visitedEdges };
  }

  /**
   * Find all paths between two nodes
   */
  findPaths(sourceId: string, targetId: string, maxDepth: number = 10): CausalPath[] {
    const result = this.traverse({
      startNodeIds: [sourceId],
      direction: 'forward',
      maxDepth
    });

    return result.paths.filter(path =>
      path.nodes[path.nodes.length - 1] === targetId
    );
  }

  /**
   * Get statistics about the hypergraph
   */
  getStats(): CausalGraphStats {
    const relationTypeCounts = new Map<CausalRelationType, number>();

    let totalOutDegree = 0;
    let totalInDegree = 0;

    for (const node of this.nodes.values()) {
      totalOutDegree += node.outgoingEdges.size;
      totalInDegree += node.incomingEdges.size;
    }

    for (const edge of this.edges.values()) {
      const count = relationTypeCounts.get(edge.type) ?? 0;
      relationTypeCounts.set(edge.type, count + 1);
    }

    const nodeCount = this.nodes.size;

    return {
      nodeCount,
      edgeCount: this.edges.size,
      avgOutDegree: nodeCount > 0 ? totalOutDegree / nodeCount : 0,
      avgInDegree: nodeCount > 0 ? totalInDegree / nodeCount : 0,
      relationTypeCounts
    };
  }

  /**
   * Export the hypergraph for visualization
   */
  export(): CausalExportFormat {
    const nodes = Array.from(this.nodes.values()).map(node => ({
      id: node.id,
      outDegree: node.outgoingEdges.size,
      inDegree: node.incomingEdges.size
    }));

    const edges = Array.from(this.edges.values()).map(edge => ({
      id: edge.id,
      type: edge.type,
      sources: Array.from(edge.sourceNodeIds),
      targets: Array.from(edge.targetNodeIds),
      strength: edge.strength
    }));

    return { nodes, edges };
  }

  /**
   * Export to Mermaid diagram format
   */
  toMermaid(): string {
    const lines: string[] = ['graph LR'];

    for (const edge of this.edges.values()) {
      const sources = Array.from(edge.sourceNodeIds);
      const targets = Array.from(edge.targetNodeIds);

      for (const source of sources) {
        for (const target of targets) {
          const label = `${edge.type}(${edge.strength.toFixed(2)})`;
          lines.push(`    ${source} -->|${label}| ${target}`);
        }
      }
    }

    return lines.join('\n');
  }

  /**
   * Clear all nodes and edges
   */
  clear(): void {
    this.nodes.clear();
    this.edges.clear();
  }

  /**
   * Get node count
   */
  getNodeCount(): number {
    return this.nodes.size;
  }

  /**
   * Get edge count
   */
  getEdgeCount(): number {
    return this.edges.size;
  }
}
