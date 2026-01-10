/**
 * GNN Enhancement Module
 *
 * Graph Neural Network enhancement for embeddings using structural context.
 */

export {
  DEFAULT_EGO_CONFIG,
  DEFAULT_MESSAGE_CONFIG,
  DEFAULT_ENHANCEMENT_CONFIG,
  type EgoNode,
  type EgoEdge,
  type EgoGraph,
  type EgoGraphConfig,
  type MessagePassingConfig,
  type EnhancementConfig,
  type EnhancementResult,
  type BatchEnhancementResult,
  type GNNStats,
  type AttentionWeights
} from './types.js';

export { EgoGraphExtractor } from './EgoGraphExtractor.js';
export { MessagePassing } from './MessagePassing.js';
export { EnhancementLayer } from './EnhancementLayer.js';
