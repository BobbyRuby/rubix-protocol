/**
 * HNSW Test and Benchmark Script
 *
 * Tests:
 * 1. Basic add/search functionality
 * 2. Dimension validation
 * 3. L2 normalization
 * 4. Serialization/deserialization
 * 5. Performance comparison vs brute-force
 */

import { HNSWIndex } from './HNSWIndex.js';

const DIMENSIONS = 768;
const NUM_VECTORS = 1000;
const K = 10;

// Generate random normalized vector
function randomVector(dim: number): number[] {
  const vec = Array.from({ length: dim }, () => Math.random() - 0.5);
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  return vec.map(v => v / norm);
}

// Brute-force search for comparison
function bruteForceSearch(
  vectors: Map<number, number[]>,
  query: number[],
  k: number
): Array<{ id: number; distance: number }> {
  const results: Array<{ id: number; distance: number }> = [];

  for (const [id, vec] of vectors) {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < vec.length; i++) {
      dot += query[i] * vec[i];
      normA += query[i] * query[i];
      normB += vec[i] * vec[i];
    }
    const similarity = dot / (Math.sqrt(normA) * Math.sqrt(normB));
    const distance = 1 - similarity;
    results.push({ id, distance });
  }

  return results.sort((a, b) => a.distance - b.distance).slice(0, k);
}

async function runTests() {
  console.log('='.repeat(60));
  console.log('HNSW Implementation Test Suite');
  console.log('='.repeat(60));
  console.log('');

  // Test 1: Basic functionality
  console.log('Test 1: Basic Add/Search');
  console.log('-'.repeat(40));

  const index = new HNSWIndex({ dimensions: DIMENSIONS });

  // Add vectors
  const vectors = new Map<number, number[]>();
  for (let i = 0; i < NUM_VECTORS; i++) {
    const vec = randomVector(DIMENSIONS);
    vectors.set(i, vec);
    index.add(i, vec);
  }

  console.log(`  Added ${NUM_VECTORS} vectors`);
  console.log(`  Index count: ${index.getCount()}`);
  console.log(`  PASS: ${index.getCount() === NUM_VECTORS ? '✓' : '✗'}`);
  console.log('');

  // Test 2: Search accuracy
  console.log('Test 2: Search Accuracy');
  console.log('-'.repeat(40));

  const queryVec = randomVector(DIMENSIONS);
  const hnswResults = index.search(queryVec, K);
  const bruteResults = bruteForceSearch(vectors, queryVec, K);

  // Check overlap (HNSW is approximate, so may not be 100% identical)
  const hnswIds = new Set(hnswResults.map(r => r.label));
  const bruteIds = new Set(bruteResults.map(r => r.id));
  let overlap = 0;
  for (const id of hnswIds) {
    if (bruteIds.has(id)) overlap++;
  }

  const recallRate = (overlap / K) * 100;
  console.log(`  HNSW top-${K}: ${Array.from(hnswIds).slice(0, 5).join(', ')}...`);
  console.log(`  Brute top-${K}: ${Array.from(bruteIds).slice(0, 5).join(', ')}...`);
  console.log(`  Recall@${K}: ${recallRate.toFixed(1)}%`);
  console.log(`  PASS: ${recallRate >= 70 ? '✓' : '✗'} (≥70% recall)`);
  console.log('');

  // Test 3: Dimension validation
  console.log('Test 3: Dimension Validation');
  console.log('-'.repeat(40));

  try {
    index.add(9999, randomVector(512)); // Wrong dimensions
    console.log('  FAIL: Should have thrown error');
  } catch (e: unknown) {
    const error = e as Error;
    console.log(`  Caught expected error: ${error.message.substring(0, 50)}...`);
    console.log('  PASS: ✓');
  }
  console.log('');

  // Test 4: Serialization
  console.log('Test 4: Serialization/Deserialization');
  console.log('-'.repeat(40));

  const serialized = index.serialize();
  const restored = HNSWIndex.deserialize(serialized as {
    config: { dimensions: number; maxElements: number; M: number; efConstruction: number; efSearch: number; mL: number };
    entryPoint: number | null;
    maxLevel: number;
    nodes: Array<{ id: number; vector: number[]; maxLayer: number; neighbors: Array<[number, number[]]> }>;
  });

  console.log(`  Original count: ${index.getCount()}`);
  console.log(`  Restored count: ${restored.getCount()}`);

  // Search restored index
  const restoredResults = restored.search(queryVec, K);
  const restoredIds = new Set(restoredResults.map(r => r.label));
  let restoredOverlap = 0;
  for (const id of hnswIds) {
    if (restoredIds.has(id)) restoredOverlap++;
  }

  console.log(`  Results match: ${restoredOverlap}/${K}`);
  console.log(`  PASS: ${restoredOverlap === K ? '✓' : '✗'}`);
  console.log('');

  // Test 5: Performance benchmark
  console.log('Test 5: Performance Benchmark');
  console.log('-'.repeat(40));

  const numQueries = 100;
  const testQueries = Array.from({ length: numQueries }, () => randomVector(DIMENSIONS));

  // HNSW benchmark
  const hnswStart = performance.now();
  for (const q of testQueries) {
    index.search(q, K);
  }
  const hnswTime = performance.now() - hnswStart;

  // Brute-force benchmark
  const bruteStart = performance.now();
  for (const q of testQueries) {
    bruteForceSearch(vectors, q, K);
  }
  const bruteTime = performance.now() - bruteStart;

  const speedup = bruteTime / hnswTime;

  console.log(`  HNSW: ${hnswTime.toFixed(2)}ms for ${numQueries} queries`);
  console.log(`  Brute: ${bruteTime.toFixed(2)}ms for ${numQueries} queries`);
  console.log(`  Speedup: ${speedup.toFixed(1)}x`);
  console.log(`  PASS: ${speedup > 1 ? '✓' : '✗'} (HNSW faster)`);
  console.log('');

  // Test 6: Delete operation
  console.log('Test 6: Delete Operation');
  console.log('-'.repeat(40));

  const countBefore = index.getCount();
  const deleted = index.delete(0);
  const countAfter = index.getCount();

  console.log(`  Count before: ${countBefore}`);
  console.log(`  Deleted label 0: ${deleted}`);
  console.log(`  Count after: ${countAfter}`);
  console.log(`  PASS: ${deleted && countAfter === countBefore - 1 ? '✓' : '✗'}`);
  console.log('');

  // Stats
  console.log('Index Statistics:');
  console.log('-'.repeat(40));
  const stats = index.getStats();
  console.log(`  Node count: ${stats.nodeCount}`);
  console.log(`  Max level: ${stats.maxLevel}`);
  console.log(`  Avg connections: ${stats.avgConnections.toFixed(2)}`);
  console.log(`  M: ${stats.M}`);
  console.log(`  efSearch: ${stats.efSearch}`);
  console.log(`  efConstruction: ${stats.efConstruction}`);
  console.log('');

  console.log('='.repeat(60));
  console.log('All tests completed!');
  console.log('='.repeat(60));
}

runTests().catch(console.error);
