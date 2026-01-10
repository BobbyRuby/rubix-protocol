/**
 * Causal Types
 *
 * Type definitions for the causal memory hypergraph system.
 */

import type { CausalRelationType } from '../core/types.js';

export interface HyperedgeData {
  id: string;
  type: CausalRelationType;
  sourceNodeIds: Set<string>;
  targetNodeIds: Set<string>;
  strength: number;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export interface CausalNode {
  id: string;
  outgoingEdges: Set<string>; // Hyperedge IDs where this node is a source
  incomingEdges: Set<string>; // Hyperedge IDs where this node is a target
}

export interface CausalPath {
  nodes: string[];
  edges: string[];
  totalStrength: number;
  relationTypes: CausalRelationType[];
}

export interface CausalQuery {
  startNodeIds: string[];
  direction: 'forward' | 'backward' | 'both';
  maxDepth?: number;
  relationTypes?: CausalRelationType[];
  minStrength?: number;
}

export interface CausalTraversalResult {
  paths: CausalPath[];
  visitedNodes: Set<string>;
  visitedEdges: Set<string>;
}

export interface CausalGraphStats {
  nodeCount: number;
  edgeCount: number;
  avgOutDegree: number;
  avgInDegree: number;
  relationTypeCounts: Map<CausalRelationType, number>;
}

export interface CausalExportFormat {
  nodes: Array<{
    id: string;
    outDegree: number;
    inDegree: number;
  }>;
  edges: Array<{
    id: string;
    type: CausalRelationType;
    sources: string[];
    targets: string[];
    strength: number;
  }>;
}
