/**
 * HNSW Scaling Benchmark
 *
 * Tests performance at different vector counts to show the crossover point
 * where HNSW becomes faster than brute-force.
 */

import { HNSWIndex } from './HNSWIndex.js';

const DIMENSIONS = 768;
const K = 10;

function randomVector(dim: number): number[] {
  const vec = Array.from({ length: dim }, () => Math.random() - 0.5);
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  return vec.map(v => v / norm);
}

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

async function benchmark() {
  console.log('='.repeat(70));
  console.log('HNSW vs Brute-Force Scaling Benchmark');
  console.log('='.repeat(70));
  console.log('');
  console.log('Testing at different vector counts to find crossover point...');
  console.log('');

  const vectorCounts = [100, 500, 1000, 2000, 5000, 10000];
  const numQueries = 50;

  console.log('| Vectors | HNSW (ms) | Brute (ms) | Speedup | Winner |');
  console.log('|---------|-----------|------------|---------|--------|');

  for (const numVectors of vectorCounts) {
    // Build index and vector map
    const index = new HNSWIndex({ dimensions: DIMENSIONS });
    const vectors = new Map<number, number[]>();

    for (let i = 0; i < numVectors; i++) {
      const vec = randomVector(DIMENSIONS);
      vectors.set(i, vec);
      index.add(i, vec);
    }

    // Generate test queries
    const testQueries = Array.from({ length: numQueries }, () => randomVector(DIMENSIONS));

    // HNSW benchmark
    const hnswStart = performance.now();
    for (const q of testQueries) {
      index.search(q, K);
    }
    const hnswTime = performance.now() - hnswStart;
    const hnswAvg = hnswTime / numQueries;

    // Brute-force benchmark
    const bruteStart = performance.now();
    for (const q of testQueries) {
      bruteForceSearch(vectors, q, K);
    }
    const bruteTime = performance.now() - bruteStart;
    const bruteAvg = bruteTime / numQueries;

    const speedup = bruteTime / hnswTime;
    const winner = speedup > 1 ? 'HNSW' : 'Brute';

    console.log(
      `| ${numVectors.toString().padStart(7)} | ` +
      `${hnswAvg.toFixed(2).padStart(9)} | ` +
      `${bruteAvg.toFixed(2).padStart(10)} | ` +
      `${speedup.toFixed(2).padStart(7)}x | ` +
      `${winner.padStart(6)} |`
    );
  }

  console.log('');
  console.log('Legend:');
  console.log('  - Times shown are average per-query in milliseconds');
  console.log('  - Speedup > 1.0 means HNSW is faster');
  console.log('  - HNSW benefits increase with more vectors (O(log n) vs O(n))');
  console.log('');
  console.log('='.repeat(70));
}

benchmark().catch(console.error);
