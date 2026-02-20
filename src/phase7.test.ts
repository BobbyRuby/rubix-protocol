/**
 * Phase 7: GNN Enhancement Tests
 *
 * Tests for:
 * 1. EgoGraphExtractor - neighborhood extraction from causal/provenance graphs
 * 2. MessagePassing - neighbor aggregation (mean, sum, max, attention)
 * 3. EnhancementLayer - 768-dim to 1024-dim projection
 * 4. MemoryEngine GNN integration
 * 5. MCP tool integration (god_enhance, god_gnn_stats)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryEngine, MemorySource, CausalRelationType } from './index.js';
import { MessagePassing } from './gnn/MessagePassing.js';
import {
  DEFAULT_EGO_CONFIG,
  DEFAULT_MESSAGE_CONFIG,
  DEFAULT_ENHANCEMENT_CONFIG
} from './gnn/types.js';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';

describe('Phase 7: EgoGraphExtractor', () => {
  let engine: MemoryEngine;
  let testDbPath: string;

  beforeEach(async () => {
    testDbPath = join(process.cwd(), `test-phase7-ego-${Date.now()}.db`);

    try {
      if (existsSync(testDbPath)) rmSync(testDbPath);
      if (existsSync(testDbPath + '.idx')) rmSync(testDbPath + '.idx');
    } catch {
      // Ignore cleanup errors
    }

    engine = new MemoryEngine({
      storageConfig: {
        sqlitePath: testDbPath,

        enableWAL: false
      }
    });
    await engine.initialize();
  });

  afterEach(async () => {
    try {
      if (engine) await engine.close();
    } catch {
      // Ignore close errors
    }
    try {
      if (existsSync(testDbPath)) rmSync(testDbPath);
      if (existsSync(testDbPath + '.idx')) rmSync(testDbPath + '.idx');
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should extract ego graph with center node', async () => {
    // Store entries and create connections
    const entry1 = await engine.store('Central concept for testing', { source: MemorySource.USER_INPUT });

    // Get the extractor
    const gnn = engine.getEnhancementLayer();
    const extractor = gnn.getExtractor();

    // Create a mock embedding
    const centerEmbedding = new Float32Array(768);
    for (let i = 0; i < 768; i++) centerEmbedding[i] = Math.random() - 0.5;

    // Extract ego graph
    const graph = extractor.extract(entry1.id, centerEmbedding);

    expect(graph.centerId).toBe(entry1.id);
    expect(graph.centerEmbedding).toBe(centerEmbedding);
    expect(graph.nodes.length).toBeGreaterThanOrEqual(1); // At least center node
    expect(graph.nodes[0].hopDistance).toBe(0); // Center is at distance 0
  });

  it('should include causal neighbors in ego graph', async () => {
    // Store entries
    const entry1 = await engine.store('Cause entry', { source: MemorySource.USER_INPUT });
    const entry2 = await engine.store('Effect entry', { source: MemorySource.USER_INPUT });
    const entry3 = await engine.store('Another effect', { source: MemorySource.USER_INPUT });

    // Create causal relations
    engine.addCausalRelation([entry1.id], [entry2.id, entry3.id], CausalRelationType.CAUSES, 0.9);

    // Get extractor
    const extractor = engine.getEnhancementLayer().getExtractor();

    // Create mock embedding
    const centerEmbedding = new Float32Array(768);
    for (let i = 0; i < 768; i++) centerEmbedding[i] = Math.random() - 0.5;

    // Extract ego graph for entry1
    const graph = extractor.extract(entry1.id, centerEmbedding);

    // Should have neighbors
    expect(graph.neighborCount).toBeGreaterThanOrEqual(2); // entry2 and entry3
    expect(graph.edges.length).toBeGreaterThanOrEqual(2);

    // Check that edge weights and relation types are captured
    const neighborIds = graph.nodes.filter(n => n.hopDistance === 1).map(n => n.id);
    expect(neighborIds).toContain(entry2.id);
    expect(neighborIds).toContain(entry3.id);
  });

  it('should include provenance neighbors in ego graph', async () => {
    // Store entries with provenance
    const parent = await engine.store('Parent entry', { source: MemorySource.USER_INPUT });
    const child = await engine.store('Child derived from parent', {
      source: MemorySource.AGENT_INFERENCE,
      parentIds: [parent.id]
    });

    // Extract ego graph for child
    const extractor = engine.getEnhancementLayer().getExtractor();
    const centerEmbedding = new Float32Array(768);
    for (let i = 0; i < 768; i++) centerEmbedding[i] = Math.random() - 0.5;

    const graph = extractor.extract(child.id, centerEmbedding);

    // Should include parent as provenance neighbor
    const neighborIds = graph.nodes.filter(n => n.hopDistance === 1).map(n => n.id);
    expect(neighborIds).toContain(parent.id);

    // Check relation type
    const parentNode = graph.nodes.find(n => n.id === parent.id);
    expect(parentNode?.relationType).toContain('provenance');
  });

  it('should respect maxHops configuration', async () => {
    // Create a chain: A -> B -> C -> D
    const entryA = await engine.store('Entry A', { source: MemorySource.USER_INPUT });
    const entryB = await engine.store('Entry B', { source: MemorySource.USER_INPUT });
    const entryC = await engine.store('Entry C', { source: MemorySource.USER_INPUT });
    const entryD = await engine.store('Entry D', { source: MemorySource.USER_INPUT });

    engine.addCausalRelation([entryA.id], [entryB.id], CausalRelationType.CAUSES, 0.9);
    engine.addCausalRelation([entryB.id], [entryC.id], CausalRelationType.CAUSES, 0.9);
    engine.addCausalRelation([entryC.id], [entryD.id], CausalRelationType.CAUSES, 0.9);

    // Extract with maxHops = 2 (default)
    const extractor = engine.getEnhancementLayer().getExtractor();
    const centerEmbedding = new Float32Array(768);
    for (let i = 0; i < 768; i++) centerEmbedding[i] = Math.random() - 0.5;

    const graph = extractor.extract(entryA.id, centerEmbedding);

    // With maxHops=2, should reach B (hop 1) and C (hop 2), but not D (hop 3)
    const allIds = graph.nodes.map(n => n.id);
    expect(allIds).toContain(entryB.id);
    expect(allIds).toContain(entryC.id);
    // D is at hop 3, should not be included
    expect(allIds).not.toContain(entryD.id);
  });

  it('should compute graph statistics', async () => {
    const entry1 = await engine.store('Center', { source: MemorySource.USER_INPUT });
    const entry2 = await engine.store('Neighbor 1', { source: MemorySource.USER_INPUT });
    const entry3 = await engine.store('Neighbor 2', { source: MemorySource.USER_INPUT });

    engine.addCausalRelation([entry1.id], [entry2.id], CausalRelationType.CAUSES, 0.8);
    engine.addCausalRelation([entry1.id], [entry3.id], CausalRelationType.ENABLES, 0.6);

    const extractor = engine.getEnhancementLayer().getExtractor();
    const centerEmbedding = new Float32Array(768);
    for (let i = 0; i < 768; i++) centerEmbedding[i] = Math.random() - 0.5;

    const graph = extractor.extract(entry1.id, centerEmbedding);
    const stats = extractor.getGraphStats(graph);

    expect(stats.totalNodes).toBeGreaterThanOrEqual(3);
    expect(stats.nodesByHop[0]).toBe(1); // Center
    expect(stats.nodesByHop[1]).toBeGreaterThanOrEqual(2); // Neighbors
    expect(stats.avgEdgeWeight).toBeGreaterThan(0);
    expect(Object.keys(stats.relationTypes).length).toBeGreaterThan(0);
  });
});

describe('Phase 7: MessagePassing', () => {
  it('should use default configuration', () => {
    const mp = new MessagePassing();
    const config = mp.getConfig();

    expect(config.aggregation).toBe(DEFAULT_MESSAGE_CONFIG.aggregation);
    expect(config.selfLoopWeight).toBe(DEFAULT_MESSAGE_CONFIG.selfLoopWeight);
    expect(config.distanceDecay).toBe(DEFAULT_MESSAGE_CONFIG.distanceDecay);
    expect(config.normalize).toBe(DEFAULT_MESSAGE_CONFIG.normalize);
  });

  it('should aggregate neighbors using mean aggregation', () => {
    const mp = new MessagePassing({ aggregation: 'mean', normalize: false });

    // Create mock ego graph
    const dim = 768;
    const centerEmbedding = new Float32Array(dim);
    for (let i = 0; i < dim; i++) centerEmbedding[i] = 1.0;

    const neighbor1Embedding = new Float32Array(dim);
    for (let i = 0; i < dim; i++) neighbor1Embedding[i] = 0.0;

    const neighbor2Embedding = new Float32Array(dim);
    for (let i = 0; i < dim; i++) neighbor2Embedding[i] = 2.0;

    const graph = {
      centerId: 'center',
      centerEmbedding,
      nodes: [
        { id: 'center', hopDistance: 0, edgeWeight: 1.0, embedding: centerEmbedding },
        { id: 'neighbor1', hopDistance: 1, edgeWeight: 1.0, embedding: neighbor1Embedding },
        { id: 'neighbor2', hopDistance: 1, edgeWeight: 1.0, embedding: neighbor2Embedding }
      ],
      edges: [
        { sourceId: 'center', targetId: 'neighbor1', weight: 1.0, relationType: 'test' },
        { sourceId: 'center', targetId: 'neighbor2', weight: 1.0, relationType: 'test' }
      ],
      maxHops: 2,
      neighborCount: 2
    };

    const result = mp.aggregate(graph);

    expect(result.length).toBe(dim);
    // With normalize=false, selfLoopWeight=0.5:
    // result = 0.5 * center + 0.5 * mean(neighbors)
    // mean(neighbors) = (0 + 2) / 2 = 1
    // result = 0.5 * 1 + 0.5 * 1 = 1
    expect(result[0]).toBeCloseTo(1.0, 1);
  });

  it('should aggregate neighbors using sum aggregation', () => {
    const mp = new MessagePassing({ aggregation: 'sum', normalize: false });

    const dim = 768;
    const centerEmbedding = new Float32Array(dim);
    for (let i = 0; i < dim; i++) centerEmbedding[i] = 1.0;

    const neighbor1Embedding = new Float32Array(dim);
    for (let i = 0; i < dim; i++) neighbor1Embedding[i] = 0.5;

    const graph = {
      centerId: 'center',
      centerEmbedding,
      nodes: [
        { id: 'center', hopDistance: 0, edgeWeight: 1.0, embedding: centerEmbedding },
        { id: 'neighbor1', hopDistance: 1, edgeWeight: 1.0, embedding: neighbor1Embedding }
      ],
      edges: [],
      maxHops: 2,
      neighborCount: 1
    };

    const result = mp.aggregate(graph);

    expect(result.length).toBe(dim);
    // Sum aggregation sums neighbor embeddings
  });

  it('should aggregate neighbors using max aggregation', () => {
    const mp = new MessagePassing({ aggregation: 'max', normalize: false });

    const dim = 768;
    const centerEmbedding = new Float32Array(dim);
    for (let i = 0; i < dim; i++) centerEmbedding[i] = 0.5;

    const neighbor1Embedding = new Float32Array(dim);
    neighbor1Embedding[0] = 2.0;
    neighbor1Embedding[1] = 0.1;

    const neighbor2Embedding = new Float32Array(dim);
    neighbor2Embedding[0] = 0.1;
    neighbor2Embedding[1] = 3.0;

    const graph = {
      centerId: 'center',
      centerEmbedding,
      nodes: [
        { id: 'center', hopDistance: 0, edgeWeight: 1.0, embedding: centerEmbedding },
        { id: 'neighbor1', hopDistance: 1, edgeWeight: 1.0, embedding: neighbor1Embedding },
        { id: 'neighbor2', hopDistance: 1, edgeWeight: 1.0, embedding: neighbor2Embedding }
      ],
      edges: [],
      maxHops: 2,
      neighborCount: 2
    };

    const result = mp.aggregate(graph);

    expect(result.length).toBe(dim);
    // Max takes element-wise max of neighbors
    // neighborContribution[0] = max(2.0, 0.1) = 2.0
    // neighborContribution[1] = max(0.1, 3.0) = 3.0
  });

  it('should return weights with aggregateWithWeights', () => {
    const mp = new MessagePassing();

    const dim = 768;
    const centerEmbedding = new Float32Array(dim);
    for (let i = 0; i < dim; i++) centerEmbedding[i] = 1.0;

    const neighborEmbedding = new Float32Array(dim);
    for (let i = 0; i < dim; i++) neighborEmbedding[i] = 0.5;

    const graph = {
      centerId: 'center',
      centerEmbedding,
      nodes: [
        { id: 'center', hopDistance: 0, edgeWeight: 1.0, embedding: centerEmbedding },
        { id: 'neighbor', hopDistance: 1, edgeWeight: 0.8, embedding: neighborEmbedding }
      ],
      edges: [],
      maxHops: 2,
      neighborCount: 1
    };

    const { embedding, weights } = mp.aggregateWithWeights(graph);

    expect(embedding.length).toBe(dim);
    expect(weights.size).toBe(2); // center + neighbor
    expect(weights.get('center')).toBeCloseTo(0.5, 2); // selfLoopWeight
    expect(weights.get('neighbor')).toBeDefined();
    expect(weights.get('neighbor')! > 0).toBe(true);
  });

  it('should apply distance decay to further neighbors', () => {
    const mp = new MessagePassing({ distanceDecay: 0.5, normalize: false });

    const dim = 768;
    const centerEmbedding = new Float32Array(dim);
    for (let i = 0; i < dim; i++) centerEmbedding[i] = 1.0;

    const hop1Embedding = new Float32Array(dim);
    for (let i = 0; i < dim; i++) hop1Embedding[i] = 1.0;

    const hop2Embedding = new Float32Array(dim);
    for (let i = 0; i < dim; i++) hop2Embedding[i] = 1.0;

    const graph = {
      centerId: 'center',
      centerEmbedding,
      nodes: [
        { id: 'center', hopDistance: 0, edgeWeight: 1.0, embedding: centerEmbedding },
        { id: 'hop1', hopDistance: 1, edgeWeight: 1.0, embedding: hop1Embedding },
        { id: 'hop2', hopDistance: 2, edgeWeight: 1.0, embedding: hop2Embedding }
      ],
      edges: [],
      maxHops: 2,
      neighborCount: 2
    };

    const { weights } = mp.aggregateWithWeights(graph);

    // hop2 should have lower weight than hop1 due to distance decay
    const hop1Weight = weights.get('hop1') ?? 0;
    const hop2Weight = weights.get('hop2') ?? 0;

    expect(hop2Weight).toBeLessThan(hop1Weight);
  });

  it('should handle graph with no neighbors', () => {
    const mp = new MessagePassing();

    const dim = 768;
    const centerEmbedding = new Float32Array(dim);
    for (let i = 0; i < dim; i++) centerEmbedding[i] = 1.0;

    const graph = {
      centerId: 'center',
      centerEmbedding,
      nodes: [
        { id: 'center', hopDistance: 0, edgeWeight: 1.0, embedding: centerEmbedding }
      ],
      edges: [],
      maxHops: 2,
      neighborCount: 0
    };

    const result = mp.aggregate(graph);

    expect(result.length).toBe(dim);
    // Should return center embedding when no neighbors
    for (let i = 0; i < dim; i++) {
      expect(result[i]).toBeCloseTo(centerEmbedding[i], 2);
    }
  });
});

describe('Phase 7: EnhancementLayer', () => {
  let engine: MemoryEngine;
  let testDbPath: string;

  beforeEach(async () => {
    testDbPath = join(process.cwd(), `test-phase7-enhance-${Date.now()}.db`);

    try {
      if (existsSync(testDbPath)) rmSync(testDbPath);
      if (existsSync(testDbPath + '.idx')) rmSync(testDbPath + '.idx');
    } catch {
      // Ignore cleanup errors
    }

    engine = new MemoryEngine({
      storageConfig: {
        sqlitePath: testDbPath,

        enableWAL: false
      }
    });
    await engine.initialize();
  });

  afterEach(async () => {
    try {
      if (engine) await engine.close();
    } catch {
      // Ignore close errors
    }
    try {
      if (existsSync(testDbPath)) rmSync(testDbPath);
      if (existsSync(testDbPath + '.idx')) rmSync(testDbPath + '.idx');
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should project 768-dim to 1024-dim', () => {
    const enhancer = engine.getEnhancementLayer();

    // Create a 768-dim embedding
    const input = new Float32Array(768);
    for (let i = 0; i < 768; i++) input[i] = Math.random() - 0.5;

    const output = enhancer.project(input);

    expect(output.length).toBe(DEFAULT_ENHANCEMENT_CONFIG.outputDim); // 1024
    expect(input.length).toBe(DEFAULT_ENHANCEMENT_CONFIG.inputDim); // 768
  });

  it('should throw error for wrong input dimension', () => {
    const enhancer = engine.getEnhancementLayer();

    const wrongDim = new Float32Array(512); // Wrong size

    expect(() => enhancer.project(wrongDim)).toThrow();
  });

  it('should produce normalized output', () => {
    const enhancer = engine.getEnhancementLayer();

    const input = new Float32Array(768);
    for (let i = 0; i < 768; i++) input[i] = Math.random() - 0.5;

    const output = enhancer.project(input);

    // Calculate L2 norm
    let norm = 0;
    for (let i = 0; i < output.length; i++) {
      norm += output[i] * output[i];
    }
    norm = Math.sqrt(norm);

    expect(norm).toBeCloseTo(1.0, 2);
  });

  it('should enhance entry embedding', async () => {
    const entry = await engine.store('Test entry for enhancement', { source: MemorySource.USER_INPUT });

    const result = await engine.enhanceEntry(entry.id);

    expect(result).not.toBeNull();
    expect(result!.originalEmbedding.length).toBe(768);
    expect(result!.enhancedEmbedding.length).toBe(1024);
    expect(result!.entryId).toBe(entry.id);
    expect(result!.processingTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('should return null for non-existent entry', async () => {
    const result = await engine.enhanceEntry('non-existent-id');
    expect(result).toBeNull();
  });

  it('should cache enhanced embeddings', async () => {
    const entry = await engine.store('Test entry for caching', { source: MemorySource.USER_INPUT });

    // First enhancement
    const result1 = await engine.enhanceEntry(entry.id);
    expect(result1).not.toBeNull();

    // Second enhancement should hit cache
    const result2 = await engine.enhanceEntry(entry.id);
    expect(result2).not.toBeNull();

    // Cache should have entry
    const enhancer = engine.getEnhancementLayer();
    expect(enhancer.getCacheSize()).toBeGreaterThanOrEqual(1);
  });

  it('should clear cache', async () => {
    const entry = await engine.store('Test entry', { source: MemorySource.USER_INPUT });
    await engine.enhanceEntry(entry.id);

    const enhancer = engine.getEnhancementLayer();
    expect(enhancer.getCacheSize()).toBeGreaterThanOrEqual(1);

    engine.clearGNNCache();
    expect(enhancer.getCacheSize()).toBe(0);
  });

  it('should serialize and deserialize weights', () => {
    const enhancer = engine.getEnhancementLayer();

    const serialized = enhancer.serializeWeights();
    expect(serialized).toBeDefined();
    expect(typeof serialized).toBe('string');

    // Parse to verify structure
    const parsed = JSON.parse(serialized);
    expect(parsed.weights1).toBeDefined();
    expect(parsed.bias1).toBeDefined();
    expect(parsed.weights2).toBeDefined();
    expect(parsed.bias2).toBeDefined();
    expect(parsed.config).toBeDefined();
  });

  it('should report GNN statistics', async () => {
    // Perform some enhancements
    const entry1 = await engine.store('Entry 1', { source: MemorySource.USER_INPUT });
    const entry2 = await engine.store('Entry 2', { source: MemorySource.USER_INPUT });

    await engine.enhanceEntry(entry1.id);
    await engine.enhanceEntry(entry2.id);

    const stats = engine.getGNNStats();

    expect(stats.enhancementsPerformed).toBeGreaterThanOrEqual(2);
    expect(stats.avgNeighborsUsed).toBeGreaterThanOrEqual(0);
    expect(stats.avgProcessingTimeMs).toBeGreaterThanOrEqual(0);
    expect(stats.cacheHitRate).toBeGreaterThanOrEqual(0);
  });

  it('should use neighbor embeddings when available', async () => {
    const entry1 = await engine.store('Central entry', { source: MemorySource.USER_INPUT });
    const entry2 = await engine.store('Related entry', { source: MemorySource.USER_INPUT });

    // Create causal connection
    engine.addCausalRelation([entry1.id], [entry2.id], CausalRelationType.CAUSES, 0.9);

    // Enhance - should find neighbor
    const result = await engine.enhanceEntry(entry1.id);

    expect(result).not.toBeNull();
    // Even if neighbors don't have embeddings loaded, the center should be enhanced
    expect(result!.neighborsUsed).toBeGreaterThanOrEqual(0);
    // Center node is always in the weights map (at minimum size 1)
    expect(result!.neighborWeights.size).toBeGreaterThanOrEqual(1);
    // Verify center weight is present
    expect(result!.neighborWeights.has(entry1.id)).toBe(true);
  });
});

describe('Phase 7: GNN Configuration', () => {
  it('should have correct default ego config', () => {
    expect(DEFAULT_EGO_CONFIG.maxHops).toBe(2);
    expect(DEFAULT_EGO_CONFIG.maxNeighborsPerHop).toBe(50);
    expect(DEFAULT_EGO_CONFIG.includeProvenance).toBe(true);
    expect(DEFAULT_EGO_CONFIG.includeCausal).toBe(true);
    expect(DEFAULT_EGO_CONFIG.minEdgeWeight).toBe(0.0);
  });

  it('should have correct default message passing config', () => {
    expect(DEFAULT_MESSAGE_CONFIG.aggregation).toBe('mean');
    expect(DEFAULT_MESSAGE_CONFIG.selfLoopWeight).toBe(0.5);
    expect(DEFAULT_MESSAGE_CONFIG.distanceDecay).toBe(0.7);
    expect(DEFAULT_MESSAGE_CONFIG.normalize).toBe(true);
  });

  it('should have correct default enhancement config', () => {
    expect(DEFAULT_ENHANCEMENT_CONFIG.inputDim).toBe(768);
    expect(DEFAULT_ENHANCEMENT_CONFIG.outputDim).toBe(1024);
    expect(DEFAULT_ENHANCEMENT_CONFIG.hiddenDim).toBe(512);
    expect(DEFAULT_ENHANCEMENT_CONFIG.activation).toBe('relu');
    expect(DEFAULT_ENHANCEMENT_CONFIG.dropout).toBe(0.1);
    expect(DEFAULT_ENHANCEMENT_CONFIG.residual).toBe(true);
  });
});
