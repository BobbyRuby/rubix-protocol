/**
 * GNN Enhancement Layer Types
 *
 * Type definitions for the Graph Neural Network enhancement system.
 * GNN uses the causal/provenance graph to enhance embeddings by
 * incorporating structural context from connected nodes.
 *
 * The enhancement process:
 * 1. Extract ego graph (2-hop neighborhood) around a node
 * 2. Aggregate neighbor embeddings via message passing
 * 3. Project 768-dim → 1024-dim for richer representation
 *
 * Expected improvement: 15-30% better retrieval recall
 */

/**
 * A node in the ego graph with its embedding and edge weight
 */
export interface EgoNode {
  /** Entry ID */
  id: string;
  /** Distance from center node (0 = center, 1 = 1-hop, 2 = 2-hop) */
  hopDistance: number;
  /** Edge weight to parent (for message passing) */
  edgeWeight: number;
  /** Node embedding (768-dim) */
  embedding?: Float32Array;
  /** Relation type to parent node */
  relationType?: string;
}

/**
 * Edge in the ego graph
 */
export interface EgoEdge {
  /** Source node ID */
  sourceId: string;
  /** Target node ID */
  targetId: string;
  /** Edge weight (relation strength) */
  weight: number;
  /** Relation type (causes, enables, etc.) */
  relationType: string;
}

/**
 * Ego graph centered on a specific node
 */
export interface EgoGraph {
  /** Center node ID */
  centerId: string;
  /** Center node embedding */
  centerEmbedding: Float32Array;
  /** All nodes in the ego graph (including center) */
  nodes: EgoNode[];
  /** All edges in the ego graph */
  edges: EgoEdge[];
  /** Max hop distance in this graph */
  maxHops: number;
  /** Total number of neighbors */
  neighborCount: number;
}

/**
 * Configuration for ego graph extraction
 */
export interface EgoGraphConfig {
  /** Maximum hops from center (default: 2) */
  maxHops: number;
  /** Maximum neighbors per hop (default: 50) */
  maxNeighborsPerHop: number;
  /** Whether to include provenance links (default: true) */
  includeProvenance: boolean;
  /** Whether to include causal links (default: true) */
  includeCausal: boolean;
  /** Minimum edge weight to include (default: 0.0) */
  minEdgeWeight: number;
}

/**
 * Default ego graph configuration
 */
export const DEFAULT_EGO_CONFIG: EgoGraphConfig = {
  maxHops: 2,
  maxNeighborsPerHop: 50,
  includeProvenance: true,
  includeCausal: true,
  minEdgeWeight: 0.0
};

/**
 * Message passing configuration
 */
export interface MessagePassingConfig {
  /** Aggregation method */
  aggregation: 'mean' | 'sum' | 'max' | 'attention';
  /** Whether to normalize aggregated messages */
  normalize: boolean;
  /** Weight for self-loop (center node contribution) */
  selfLoopWeight: number;
  /** Decay factor for distant neighbors (applied per hop) */
  distanceDecay: number;
}

/**
 * Default message passing configuration
 */
export const DEFAULT_MESSAGE_CONFIG: MessagePassingConfig = {
  aggregation: 'mean',
  normalize: true,
  selfLoopWeight: 0.5,
  distanceDecay: 0.7
};

/**
 * Enhancement layer configuration
 */
export interface EnhancementConfig {
  /** Input dimensions (768 for standard embeddings) */
  inputDim: number;
  /** Output dimensions (1024 for enhanced embeddings) */
  outputDim: number;
  /** Hidden dimensions for transformation (default: 512) */
  hiddenDim: number;
  /** Activation function */
  activation: 'relu' | 'gelu' | 'tanh' | 'none';
  /** Dropout rate for regularization (0-1) */
  dropout: number;
  /** Whether to use residual connection */
  residual: boolean;
}

/**
 * Default enhancement configuration
 */
export const DEFAULT_ENHANCEMENT_CONFIG: EnhancementConfig = {
  inputDim: 768,
  outputDim: 1024,
  hiddenDim: 512,
  activation: 'relu',
  dropout: 0.1,
  residual: true
};

/**
 * Result of GNN enhancement
 */
export interface EnhancementResult {
  /** Original entry ID */
  entryId: string;
  /** Original embedding (768-dim) */
  originalEmbedding: Float32Array;
  /** Enhanced embedding (1024-dim) */
  enhancedEmbedding: Float32Array;
  /** Number of neighbors used in enhancement */
  neighborsUsed: number;
  /** Aggregation weights applied to neighbors */
  neighborWeights: Map<string, number>;
  /** Processing time in ms */
  processingTimeMs: number;
}

/**
 * Batch enhancement result
 */
export interface BatchEnhancementResult {
  /** Individual results */
  results: EnhancementResult[];
  /** Total processing time */
  totalTimeMs: number;
  /** Average neighbors per entry */
  avgNeighbors: number;
}

/**
 * GNN statistics
 */
export interface GNNStats {
  /** Total enhancements performed */
  enhancementsPerformed: number;
  /** Average neighbors per enhancement */
  avgNeighborsUsed: number;
  /** Average processing time per enhancement (ms) */
  avgProcessingTimeMs: number;
  /** Cache hit rate (if caching enabled) */
  cacheHitRate: number;
}

/**
 * Attention weights for attention-based aggregation
 */
export interface AttentionWeights {
  /** Query weights (768 × attention_dim) */
  queryWeights: Float32Array;
  /** Key weights (768 × attention_dim) */
  keyWeights: Float32Array;
  /** Attention dimension */
  attentionDim: number;
}
