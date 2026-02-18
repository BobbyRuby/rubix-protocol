/**
 * Pure TypeScript HNSW (Hierarchical Navigable Small World) Implementation
 *
 * A graph-based approximate nearest neighbor search algorithm that achieves
 * O(log n) search complexity instead of O(n) brute-force.
 *
 * Key concepts:
 * - Multi-layer graph where higher layers are sparser (fewer nodes)
 * - Search starts at top layer, greedily descends to bottom
 * - Each node has M connections per layer to nearest neighbors
 *
 * Performance: ~10-50x faster than brute-force for 10k+ vectors
 *
 * Based on: "Efficient and robust approximate nearest neighbor search using
 * Hierarchical Navigable Small World graphs" (Malkov & Yashunin, 2016)
 */

import type { VectorSearchResult } from './types.js';

interface HNSWNode {
  id: number;
  vector: number[];
  neighbors: Map<number, Set<number>>; // layer -> Set of neighbor IDs
  maxLayer: number;
}

interface HNSWConfig {
  dimensions: number;
  maxElements: number;
  M: number;           // Max connections per layer (default: 16)
  efConstruction: number; // Search width during build (default: 200)
  efSearch: number;    // Search width during query (default: 50)
  mL: number;          // Level multiplier (default: 1/ln(M))
}

export class HNSWIndex {
  private config: HNSWConfig;
  private nodes: Map<number, HNSWNode> = new Map();
  private entryPoint: number | null = null;
  private maxLevel: number = 0;
  // Note: labelCounter reserved for future use (auto-increment labels)

  constructor(config: Partial<HNSWConfig> & { dimensions: number }) {
    this.config = {
      dimensions: config.dimensions,
      maxElements: config.maxElements ?? 100000,
      M: config.M ?? 16,
      efConstruction: config.efConstruction ?? 200,
      efSearch: config.efSearch ?? 50,
      mL: config.mL ?? 1 / Math.log(config.M ?? 16),
    };
  }

  /**
   * Add a vector to the index
   */
  add(label: number, vector: number[] | Float32Array): void {
    const vec = Array.isArray(vector) ? vector : Array.from(vector);

    // Validate dimensions
    if (vec.length !== this.config.dimensions) {
      throw new Error(
        `Vector dimension mismatch: expected ${this.config.dimensions}, got ${vec.length}`
      );
    }

    // Check capacity
    if (this.nodes.size >= this.config.maxElements) {
      throw new Error(`Index is full (max ${this.config.maxElements} elements)`);
    }

    // Determine random level for this node
    const nodeLevel = this.getRandomLevel();

    const newNode: HNSWNode = {
      id: label,
      vector: vec,
      neighbors: new Map(),
      maxLayer: nodeLevel,
    };

    // Initialize neighbor sets for each layer
    for (let layer = 0; layer <= nodeLevel; layer++) {
      newNode.neighbors.set(layer, new Set());
    }

    // First node is entry point
    if (this.entryPoint === null) {
      this.entryPoint = label;
      this.maxLevel = nodeLevel;
      this.nodes.set(label, newNode);
      return;
    }

    // Find entry point for insertion
    let currNode = this.entryPoint;

    // Traverse from top layer down to nodeLevel + 1
    for (let layer = this.maxLevel; layer > nodeLevel; layer--) {
      currNode = this.searchLayer(vec, currNode, 1, layer)[0].id;
    }

    // Insert at layers nodeLevel down to 0
    for (let layer = Math.min(nodeLevel, this.maxLevel); layer >= 0; layer--) {
      const candidates = this.searchLayer(vec, currNode, this.config.efConstruction, layer);

      // Select M best neighbors
      const neighbors = this.selectNeighbors(vec, candidates, this.config.M);

      // Connect new node to neighbors
      for (const neighbor of neighbors) {
        newNode.neighbors.get(layer)!.add(neighbor.id);

        // Bidirectional connection
        const neighborNode = this.nodes.get(neighbor.id)!;
        if (neighborNode.neighbors.has(layer)) {
          neighborNode.neighbors.get(layer)!.add(label);

          // Prune if too many connections
          if (neighborNode.neighbors.get(layer)!.size > this.config.M * 2) {
            this.pruneConnections(neighborNode, layer);
          }
        }
      }

      if (candidates.length > 0) {
        currNode = candidates[0].id;
      }
    }

    this.nodes.set(label, newNode);

    // Update entry point if new node has higher level
    if (nodeLevel > this.maxLevel) {
      this.maxLevel = nodeLevel;
      this.entryPoint = label;
    }
  }

  /**
   * Search for k nearest neighbors
   */
  search(query: number[] | Float32Array, k: number): VectorSearchResult[] {
    if (this.entryPoint === null || this.nodes.size === 0) {
      return [];
    }

    const queryVec = Array.isArray(query) ? query : Array.from(query);

    // Validate dimensions
    if (queryVec.length !== this.config.dimensions) {
      throw new Error(
        `Query dimension mismatch: expected ${this.config.dimensions}, got ${queryVec.length}`
      );
    }

    let currNode = this.entryPoint;

    // Traverse from top layer to layer 1
    for (let layer = this.maxLevel; layer > 0; layer--) {
      const nearest = this.searchLayer(queryVec, currNode, 1, layer);
      if (nearest.length > 0) {
        currNode = nearest[0].id;
      }
    }

    // Search layer 0 with efSearch candidates
    const candidates = this.searchLayer(queryVec, currNode, Math.max(this.config.efSearch, k), 0);

    // Return top k results
    return candidates.slice(0, k).map(c => ({
      id: '', // Will be resolved by caller
      label: c.id,
      distance: c.distance,
      score: 1 - c.distance, // Convert distance to similarity score
    }));
  }

  /**
   * Search within a single layer using greedy best-first search
   */
  private searchLayer(
    query: number[],
    entryId: number,
    ef: number,
    layer: number
  ): Array<{ id: number; distance: number }> {
    const visited = new Set<number>([entryId]);
    const entryNode = this.nodes.get(entryId)!;
    const entryDist = this.cosineDistance(query, entryNode.vector);

    // Min-heap for candidates (closest first)
    const candidates: Array<{ id: number; distance: number }> = [
      { id: entryId, distance: entryDist }
    ];

    // Max-heap for results (furthest first for pruning)
    const results: Array<{ id: number; distance: number }> = [
      { id: entryId, distance: entryDist }
    ];

    while (candidates.length > 0) {
      // Get closest candidate
      candidates.sort((a, b) => a.distance - b.distance);
      const current = candidates.shift()!;

      // Get furthest result
      results.sort((a, b) => b.distance - a.distance);
      const furthestResult = results[0];

      // Stop if closest candidate is further than furthest result
      if (current.distance > furthestResult.distance) {
        break;
      }

      // Explore neighbors
      const currentNode = this.nodes.get(current.id);
      if (!currentNode || !currentNode.neighbors.has(layer)) {
        continue;
      }

      for (const neighborId of currentNode.neighbors.get(layer)!) {
        if (visited.has(neighborId)) continue;
        visited.add(neighborId);

        const neighborNode = this.nodes.get(neighborId);
        if (!neighborNode) continue;

        const neighborDist = this.cosineDistance(query, neighborNode.vector);

        // Add to results if better than furthest or we have room
        if (results.length < ef || neighborDist < results[0].distance) {
          candidates.push({ id: neighborId, distance: neighborDist });
          results.push({ id: neighborId, distance: neighborDist });

          // Keep only ef best results
          if (results.length > ef) {
            results.sort((a, b) => b.distance - a.distance);
            results.shift();
          }
        }
      }
    }

    // Return sorted by distance (ascending)
    return results.sort((a, b) => a.distance - b.distance);
  }

  /**
   * Select best M neighbors from candidates
   */
  private selectNeighbors(
    _query: number[],
    candidates: Array<{ id: number; distance: number }>,
    M: number
  ): Array<{ id: number; distance: number }> {
    // Simple selection: take M closest
    return candidates.slice(0, M);
  }

  /**
   * Prune connections to keep only M best
   */
  private pruneConnections(node: HNSWNode, layer: number): void {
    const neighbors = node.neighbors.get(layer);
    if (!neighbors || neighbors.size <= this.config.M) return;

    // Calculate distances to all neighbors
    const distances: Array<{ id: number; distance: number }> = [];
    for (const neighborId of neighbors) {
      const neighborNode = this.nodes.get(neighborId);
      if (neighborNode) {
        distances.push({
          id: neighborId,
          distance: this.cosineDistance(node.vector, neighborNode.vector),
        });
      }
    }

    // Keep only M closest
    distances.sort((a, b) => a.distance - b.distance);
    const toKeep = new Set(distances.slice(0, this.config.M).map(d => d.id));

    // Remove excess connections
    for (const neighborId of neighbors) {
      if (!toKeep.has(neighborId)) {
        neighbors.delete(neighborId);
        // Also remove reverse connection
        const neighborNode = this.nodes.get(neighborId);
        if (neighborNode?.neighbors.has(layer)) {
          neighborNode.neighbors.get(layer)!.delete(node.id);
        }
      }
    }
  }

  /**
   * Calculate random level for new node
   * Higher levels are exponentially less likely
   */
  private getRandomLevel(): number {
    let level = 0;
    while (Math.random() < Math.exp(-level * this.config.mL) && level < 16) {
      level++;
    }
    return level;
  }

  /**
   * Cosine distance (1 - cosine similarity)
   */
  private cosineDistance(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    if (magnitude === 0) return 1; // Maximum distance for zero vectors

    const similarity = dotProduct / magnitude;
    return 1 - similarity;
  }

  /**
   * Delete a vector by label
   */
  delete(label: number): boolean {
    const node = this.nodes.get(label);
    if (!node) return false;

    // Remove connections from all neighbors
    for (const [layer, neighbors] of node.neighbors) {
      for (const neighborId of neighbors) {
        const neighborNode = this.nodes.get(neighborId);
        if (neighborNode?.neighbors.has(layer)) {
          neighborNode.neighbors.get(layer)!.delete(label);
        }
      }
    }

    this.nodes.delete(label);

    // Update entry point if needed
    if (this.entryPoint === label) {
      if (this.nodes.size > 0) {
        // Find new entry point (any node at highest level)
        let maxLevel = -1;
        let newEntry: number | null = null;
        for (const [id, n] of this.nodes) {
          if (n.maxLayer > maxLevel) {
            maxLevel = n.maxLayer;
            newEntry = id;
          }
        }
        this.entryPoint = newEntry;
        this.maxLevel = maxLevel;
      } else {
        this.entryPoint = null;
        this.maxLevel = 0;
      }
    }

    return true;
  }

  /**
   * Check if label exists
   */
  has(label: number): boolean {
    return this.nodes.has(label);
  }

  /**
   * Retrieve stored vector by label
   */
  getVector(label: number): number[] | null {
    const node = this.nodes.get(label);
    return node ? node.vector : null;
  }

  /**
   * Get vector count
   */
  getCount(): number {
    return this.nodes.size;
  }

  /**
   * Clear all vectors
   */
  clear(): void {
    this.nodes.clear();
    this.entryPoint = null;
    this.maxLevel = 0;
  }

  /**
   * Set efSearch parameter
   */
  setEfSearch(ef: number): void {
    this.config.efSearch = ef;
  }

  /**
   * Get index statistics
   */
  getStats(): {
    nodeCount: number;
    maxLevel: number;
    avgConnections: number;
    dimensions: number;
    M: number;
    efSearch: number;
    efConstruction: number;
  } {
    let totalConnections = 0;
    for (const node of this.nodes.values()) {
      for (const neighbors of node.neighbors.values()) {
        totalConnections += neighbors.size;
      }
    }

    return {
      nodeCount: this.nodes.size,
      maxLevel: this.maxLevel,
      avgConnections: this.nodes.size > 0 ? totalConnections / this.nodes.size : 0,
      dimensions: this.config.dimensions,
      M: this.config.M,
      efSearch: this.config.efSearch,
      efConstruction: this.config.efConstruction,
    };
  }

  /**
   * Serialize index to JSON-compatible format
   */
  serialize(): object {
    const serializedNodes: Array<{
      id: number;
      vector: number[];
      maxLayer: number;
      neighbors: Array<[number, number[]]>;
    }> = [];

    for (const [_id, node] of this.nodes) {
      const neighbors: Array<[number, number[]]> = [];
      for (const [layer, neighborSet] of node.neighbors) {
        neighbors.push([layer, Array.from(neighborSet)]);
      }
      serializedNodes.push({
        id: node.id,
        vector: node.vector,
        maxLayer: node.maxLayer,
        neighbors,
      });
    }

    return {
      config: this.config,
      entryPoint: this.entryPoint,
      maxLevel: this.maxLevel,
      nodes: serializedNodes,
    };
  }

  /**
   * Deserialize index from JSON
   */
  static deserialize(data: {
    config: HNSWConfig;
    entryPoint: number | null;
    maxLevel: number;
    nodes: Array<{
      id: number;
      vector: number[];
      maxLayer: number;
      neighbors: Array<[number, number[]]>;
    }>;
  }): HNSWIndex {
    const index = new HNSWIndex(data.config);
    index.entryPoint = data.entryPoint;
    index.maxLevel = data.maxLevel;

    for (const nodeData of data.nodes) {
      const neighbors = new Map<number, Set<number>>();
      for (const [layer, neighborIds] of nodeData.neighbors) {
        neighbors.set(layer, new Set(neighborIds));
      }

      index.nodes.set(nodeData.id, {
        id: nodeData.id,
        vector: nodeData.vector,
        maxLayer: nodeData.maxLayer,
        neighbors,
      });
    }

    return index;
  }
}
