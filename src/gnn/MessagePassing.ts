/**
 * Message Passing
 *
 * Implements message passing for GNN neighbor aggregation.
 * Aggregates information from neighboring nodes to enrich the center embedding.
 *
 * Aggregation formula:
 * h'_v = σ(W_self * h_v + W_neigh * AGG({h_u : u ∈ N(v)}))
 *
 * Where:
 * - h_v is the center node embedding
 * - N(v) is the neighborhood of v
 * - AGG is the aggregation function (mean, sum, max, or attention)
 * - σ is the activation function
 */

import type { EgoGraph, EgoNode, MessagePassingConfig, AttentionWeights } from './types.js';
import { DEFAULT_MESSAGE_CONFIG } from './types.js';

export class MessagePassing {
  private config: MessagePassingConfig;
  private attentionWeights: AttentionWeights | null = null;

  constructor(config: Partial<MessagePassingConfig> = {}) {
    this.config = { ...DEFAULT_MESSAGE_CONFIG, ...config };
  }

  /**
   * Aggregate neighbor embeddings using the configured method
   *
   * @param graph - The ego graph with embeddings loaded
   * @returns Aggregated embedding (same dimension as input)
   */
  aggregate(graph: EgoGraph): Float32Array {
    const dim = graph.centerEmbedding.length;
    const result = new Float32Array(dim);

    // Get neighbors with embeddings
    const neighbors = graph.nodes.filter(
      node => node.hopDistance > 0 && node.embedding
    );

    if (neighbors.length === 0) {
      // No neighbors - return center embedding scaled by self-loop weight
      for (let i = 0; i < dim; i++) {
        result[i] = graph.centerEmbedding[i];
      }
      return result;
    }

    // Calculate neighbor contribution based on aggregation method
    let neighborContribution: Float32Array;

    switch (this.config.aggregation) {
      case 'mean':
        neighborContribution = this.meanAggregation(neighbors, dim);
        break;
      case 'sum':
        neighborContribution = this.sumAggregation(neighbors, dim);
        break;
      case 'max':
        neighborContribution = this.maxAggregation(neighbors, dim);
        break;
      case 'attention':
        neighborContribution = this.attentionAggregation(graph.centerEmbedding, neighbors, dim);
        break;
      default:
        neighborContribution = this.meanAggregation(neighbors, dim);
    }

    // Combine center embedding with neighbor contribution
    const selfWeight = this.config.selfLoopWeight;
    const neighborWeight = 1 - selfWeight;

    for (let i = 0; i < dim; i++) {
      result[i] = selfWeight * graph.centerEmbedding[i] +
                  neighborWeight * neighborContribution[i];
    }

    // Normalize if configured
    if (this.config.normalize) {
      this.normalizeVector(result);
    }

    return result;
  }

  /**
   * Aggregate with explicit weight calculation for each neighbor
   * Returns both the aggregated embedding and the weights used
   */
  aggregateWithWeights(graph: EgoGraph): {
    embedding: Float32Array;
    weights: Map<string, number>;
  } {
    const dim = graph.centerEmbedding.length;
    const weights = new Map<string, number>();

    // Get neighbors with embeddings
    const neighbors = graph.nodes.filter(
      node => node.hopDistance > 0 && node.embedding
    );

    if (neighbors.length === 0) {
      weights.set(graph.centerId, 1.0);
      return {
        embedding: new Float32Array(graph.centerEmbedding),
        weights
      };
    }

    // Calculate weights for each neighbor
    const neighborWeights = this.calculateNeighborWeights(graph.centerEmbedding, neighbors);
    const totalWeight = Array.from(neighborWeights.values()).reduce((a, b) => a + b, 0);

    // Normalize weights
    const selfWeight = this.config.selfLoopWeight;
    const neighborScale = (1 - selfWeight) / (totalWeight || 1);

    weights.set(graph.centerId, selfWeight);
    for (const [id, weight] of neighborWeights) {
      weights.set(id, weight * neighborScale);
    }

    // Aggregate with calculated weights
    const result = new Float32Array(dim);

    // Self contribution
    for (let i = 0; i < dim; i++) {
      result[i] = selfWeight * graph.centerEmbedding[i];
    }

    // Neighbor contributions
    for (const neighbor of neighbors) {
      if (!neighbor.embedding) continue;
      const w = weights.get(neighbor.id) ?? 0;
      for (let i = 0; i < dim; i++) {
        result[i] += w * neighbor.embedding[i];
      }
    }

    if (this.config.normalize) {
      this.normalizeVector(result);
    }

    return { embedding: result, weights };
  }

  /**
   * Initialize attention weights (for attention-based aggregation)
   */
  initializeAttention(dim: number, attentionDim: number = 64): void {
    // Random initialization for attention weights
    const queryWeights = new Float32Array(dim * attentionDim);
    const keyWeights = new Float32Array(dim * attentionDim);

    // Xavier initialization
    const scale = Math.sqrt(2.0 / (dim + attentionDim));
    for (let i = 0; i < queryWeights.length; i++) {
      queryWeights[i] = (Math.random() - 0.5) * 2 * scale;
      keyWeights[i] = (Math.random() - 0.5) * 2 * scale;
    }

    this.attentionWeights = {
      queryWeights,
      keyWeights,
      attentionDim
    };
  }

  /**
   * Get configuration
   */
  getConfig(): MessagePassingConfig {
    return { ...this.config };
  }

  // ============ Private Methods ============

  /**
   * Mean aggregation: average of neighbor embeddings weighted by edge weight and distance
   */
  private meanAggregation(neighbors: EgoNode[], dim: number): Float32Array {
    const result = new Float32Array(dim);
    let totalWeight = 0;

    for (const neighbor of neighbors) {
      if (!neighbor.embedding) continue;

      // Apply distance decay
      const distanceWeight = Math.pow(this.config.distanceDecay, neighbor.hopDistance - 1);
      const weight = neighbor.edgeWeight * distanceWeight;
      totalWeight += weight;

      for (let i = 0; i < dim; i++) {
        result[i] += neighbor.embedding[i] * weight;
      }
    }

    // Normalize by total weight
    if (totalWeight > 0) {
      for (let i = 0; i < dim; i++) {
        result[i] /= totalWeight;
      }
    }

    return result;
  }

  /**
   * Sum aggregation: sum of neighbor embeddings weighted by edge weight
   */
  private sumAggregation(neighbors: EgoNode[], dim: number): Float32Array {
    const result = new Float32Array(dim);

    for (const neighbor of neighbors) {
      if (!neighbor.embedding) continue;

      const distanceWeight = Math.pow(this.config.distanceDecay, neighbor.hopDistance - 1);
      const weight = neighbor.edgeWeight * distanceWeight;

      for (let i = 0; i < dim; i++) {
        result[i] += neighbor.embedding[i] * weight;
      }
    }

    return result;
  }

  /**
   * Max aggregation: element-wise max of neighbor embeddings
   */
  private maxAggregation(neighbors: EgoNode[], dim: number): Float32Array {
    const result = new Float32Array(dim);

    // Initialize with very negative values
    for (let i = 0; i < dim; i++) {
      result[i] = -Infinity;
    }

    for (const neighbor of neighbors) {
      if (!neighbor.embedding) continue;

      for (let i = 0; i < dim; i++) {
        result[i] = Math.max(result[i], neighbor.embedding[i]);
      }
    }

    // Handle case where no neighbors had embeddings
    for (let i = 0; i < dim; i++) {
      if (result[i] === -Infinity) result[i] = 0;
    }

    return result;
  }

  /**
   * Attention-based aggregation: weighted by learned attention scores
   */
  private attentionAggregation(
    centerEmbedding: Float32Array,
    neighbors: EgoNode[],
    dim: number
  ): Float32Array {
    // If attention weights not initialized, use mean aggregation
    if (!this.attentionWeights) {
      return this.meanAggregation(neighbors, dim);
    }

    const { queryWeights, keyWeights, attentionDim } = this.attentionWeights;

    // Compute query vector for center
    const query = new Float32Array(attentionDim);
    for (let i = 0; i < attentionDim; i++) {
      for (let j = 0; j < dim; j++) {
        query[i] += centerEmbedding[j] * queryWeights[j * attentionDim + i];
      }
    }

    // Compute attention scores for each neighbor
    const scores: number[] = [];
    for (const neighbor of neighbors) {
      if (!neighbor.embedding) {
        scores.push(0);
        continue;
      }

      // Compute key vector for neighbor
      const key = new Float32Array(attentionDim);
      for (let i = 0; i < attentionDim; i++) {
        for (let j = 0; j < dim; j++) {
          key[i] += neighbor.embedding[j] * keyWeights[j * attentionDim + i];
        }
      }

      // Dot product of query and key
      let score = 0;
      for (let i = 0; i < attentionDim; i++) {
        score += query[i] * key[i];
      }

      // Scale by sqrt(d_k)
      score /= Math.sqrt(attentionDim);

      // Apply distance decay
      const distanceWeight = Math.pow(this.config.distanceDecay, neighbor.hopDistance - 1);
      score *= distanceWeight * neighbor.edgeWeight;

      scores.push(score);
    }

    // Softmax over scores
    const maxScore = Math.max(...scores);
    const expScores = scores.map(s => Math.exp(s - maxScore));
    const sumExp = expScores.reduce((a, b) => a + b, 0);
    const attentionWeights = expScores.map(e => e / sumExp);

    // Weighted sum of neighbor embeddings
    const result = new Float32Array(dim);
    for (let n = 0; n < neighbors.length; n++) {
      const neighbor = neighbors[n];
      if (!neighbor.embedding) continue;

      const weight = attentionWeights[n];
      for (let i = 0; i < dim; i++) {
        result[i] += neighbor.embedding[i] * weight;
      }
    }

    return result;
  }

  /**
   * Calculate weights for each neighbor
   */
  private calculateNeighborWeights(
    _centerEmbedding: Float32Array,
    neighbors: EgoNode[]
  ): Map<string, number> {
    const weights = new Map<string, number>();

    for (const neighbor of neighbors) {
      if (!neighbor.embedding) continue;

      // Weight based on edge weight and distance decay
      const distanceWeight = Math.pow(this.config.distanceDecay, neighbor.hopDistance - 1);
      const weight = neighbor.edgeWeight * distanceWeight;

      weights.set(neighbor.id, weight);
    }

    return weights;
  }

  /**
   * Normalize vector to unit length
   */
  private normalizeVector(vector: Float32Array): void {
    let norm = 0;
    for (let i = 0; i < vector.length; i++) {
      norm += vector[i] * vector[i];
    }
    norm = Math.sqrt(norm);

    if (norm > 0) {
      for (let i = 0; i < vector.length; i++) {
        vector[i] /= norm;
      }
    }
  }
}
