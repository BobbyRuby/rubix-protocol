/**
 * Provenance Types
 *
 * Type definitions for lineage tracking and L-Score calculation.
 */

export interface LineageNode {
  entryId: string;
  depth: number;
  confidence: number;
  relevance: number;
  lScore: number;
  children: LineageNode[];
}

export interface ProvenanceChain {
  rootId: string;
  nodes: Map<string, LineageNode>;
  maxDepth: number;
  aggregateLScore: number;
}

export interface LScoreParams {
  confidences: number[];
  relevances: number[];
  depth: number;
  depthDecay?: number;
}

export interface LScoreConfig {
  depthDecay: number;
  minScore: number;
  threshold?: number;
  enforceThreshold?: boolean;
}

export interface ProvenanceStoreConfig {
  lScoreConfig: LScoreConfig;
}

export interface LineageTraceResult {
  entryId: string;
  depth: number;
  lScore: number;
  parentChain: Array<{
    id: string;
    confidence: number;
    relevance: number;
  }>;
}
