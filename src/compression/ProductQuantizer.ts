/**
 * Product Quantizer
 *
 * Implements Product Quantization (PQ) for vector compression.
 * Splits high-dimensional vectors into subvectors and quantizes each independently.
 *
 * How it works:
 * 1. Split 768-dim vector into 96 subvectors of 8 dimensions each
 * 2. For each subvector, find the nearest centroid from a codebook
 * 3. Store only the centroid index (8 bits for PQ8, 4 bits for PQ4)
 *
 * Compression:
 * - Original: 768 × 4 bytes = 3,072 bytes
 * - PQ8: 96 bytes (96 subvectors × 8 bits = 96 bytes)
 * - PQ4: 48 bytes (96 subvectors × 4 bits = 48 bytes)
 */

import type { PQConfig, PQCodebook } from './types.js';

/**
 * Default PQ8 configuration (8-bit codes, 256 centroids)
 */
export const PQ8_CONFIG: PQConfig = {
  dimensions: 768,
  numSubvectors: 96,    // 768 / 96 = 8 dimensions per subvector
  numCentroids: 256,    // 2^8 = 256 centroids
  bitsPerCode: 8
};

/**
 * Default PQ4 configuration (4-bit codes, 16 centroids)
 */
export const PQ4_CONFIG: PQConfig = {
  dimensions: 768,
  numSubvectors: 96,    // 768 / 96 = 8 dimensions per subvector
  numCentroids: 16,     // 2^4 = 16 centroids
  bitsPerCode: 4
};

export class ProductQuantizer {
  private config: PQConfig;
  private codebook: PQCodebook | null = null;
  private subvectorDim: number;

  constructor(config: PQConfig = PQ8_CONFIG) {
    this.config = config;
    this.subvectorDim = config.dimensions / config.numSubvectors;

    if (config.dimensions % config.numSubvectors !== 0) {
      throw new Error(
        `Dimensions (${config.dimensions}) must be divisible by numSubvectors (${config.numSubvectors})`
      );
    }
  }

  /**
   * Train the quantizer on a set of vectors to build the codebook.
   * Uses k-means++ initialization for better centroid placement.
   */
  train(vectors: Float32Array[], maxIterations: number = 20): void {
    if (vectors.length < this.config.numCentroids) {
      throw new Error(
        `Need at least ${this.config.numCentroids} vectors to train, got ${vectors.length}`
      );
    }

    // Initialize centroids array: [numSubvectors][numCentroids][subvectorDim]
    const centroids: Float32Array[] = [];

    for (let sv = 0; sv < this.config.numSubvectors; sv++) {
      // Extract all subvectors for this position
      const subvectors: number[][] = vectors.map(v =>
        this.extractSubvector(v, sv)
      );

      // Train centroids for this subvector using k-means
      const svCentroids = this.kmeansCluster(subvectors, maxIterations);
      centroids.push(new Float32Array(svCentroids.flat()));
    }

    this.codebook = {
      config: this.config,
      centroids,
      trainedAt: new Date(),
      trainingSize: vectors.length
    };
  }

  /**
   * Initialize codebook with random centroids from the data
   * (Simpler alternative to full k-means training)
   */
  initializeRandom(vectors: Float32Array[]): void {
    if (vectors.length < this.config.numCentroids) {
      // If not enough vectors, duplicate some
      while (vectors.length < this.config.numCentroids) {
        vectors.push(vectors[vectors.length % vectors.length]);
      }
    }

    const centroids: Float32Array[] = [];

    for (let sv = 0; sv < this.config.numSubvectors; sv++) {
      // Sample random subvectors as initial centroids
      const indices = this.sampleIndices(vectors.length, this.config.numCentroids);
      const svCentroids: number[] = [];

      for (const idx of indices) {
        const subvec = this.extractSubvector(vectors[idx], sv);
        svCentroids.push(...subvec);
      }

      centroids.push(new Float32Array(svCentroids));
    }

    this.codebook = {
      config: this.config,
      centroids,
      trainedAt: new Date(),
      trainingSize: vectors.length
    };
  }

  /**
   * Encode a vector into PQ codes
   */
  encode(vector: Float32Array): Uint8Array {
    if (!this.codebook) {
      throw new Error('Quantizer not trained. Call train() or initializeRandom() first.');
    }

    if (vector.length !== this.config.dimensions) {
      throw new Error(`Vector dimension mismatch: expected ${this.config.dimensions}, got ${vector.length}`);
    }

    if (this.config.bitsPerCode === 8) {
      // PQ8: 1 byte per subvector
      const codes = new Uint8Array(this.config.numSubvectors);

      for (let sv = 0; sv < this.config.numSubvectors; sv++) {
        const subvec = this.extractSubvector(vector, sv);
        codes[sv] = this.findNearestCentroid(subvec, sv);
      }

      return codes;
    } else if (this.config.bitsPerCode === 4) {
      // PQ4: Pack 2 codes per byte
      const numBytes = Math.ceil(this.config.numSubvectors / 2);
      const codes = new Uint8Array(numBytes);

      for (let sv = 0; sv < this.config.numSubvectors; sv++) {
        const subvec = this.extractSubvector(vector, sv);
        const centroidIdx = this.findNearestCentroid(subvec, sv);

        const byteIdx = Math.floor(sv / 2);
        if (sv % 2 === 0) {
          // Low nibble
          codes[byteIdx] = (codes[byteIdx] & 0xF0) | (centroidIdx & 0x0F);
        } else {
          // High nibble
          codes[byteIdx] = (codes[byteIdx] & 0x0F) | ((centroidIdx & 0x0F) << 4);
        }
      }

      return codes;
    }

    throw new Error(`Unsupported bitsPerCode: ${this.config.bitsPerCode}`);
  }

  /**
   * Decode PQ codes back to an approximate vector
   */
  decode(codes: Uint8Array): Float32Array {
    if (!this.codebook) {
      throw new Error('Quantizer not trained. Call train() or initializeRandom() first.');
    }

    const vector = new Float32Array(this.config.dimensions);

    if (this.config.bitsPerCode === 8) {
      // PQ8: 1 byte per subvector
      for (let sv = 0; sv < this.config.numSubvectors; sv++) {
        const centroidIdx = codes[sv];
        const centroid = this.getCentroid(sv, centroidIdx);
        const offset = sv * this.subvectorDim;

        for (let d = 0; d < this.subvectorDim; d++) {
          vector[offset + d] = centroid[d];
        }
      }
    } else if (this.config.bitsPerCode === 4) {
      // PQ4: Unpack 2 codes per byte
      for (let sv = 0; sv < this.config.numSubvectors; sv++) {
        const byteIdx = Math.floor(sv / 2);
        let centroidIdx: number;

        if (sv % 2 === 0) {
          centroidIdx = codes[byteIdx] & 0x0F;
        } else {
          centroidIdx = (codes[byteIdx] >> 4) & 0x0F;
        }

        const centroid = this.getCentroid(sv, centroidIdx);
        const offset = sv * this.subvectorDim;

        for (let d = 0; d < this.subvectorDim; d++) {
          vector[offset + d] = centroid[d];
        }
      }
    }

    return vector;
  }

  /**
   * Compute asymmetric distance between a query vector and encoded vector.
   * This is more accurate than decoding first, as it uses the exact query.
   */
  asymmetricDistance(query: Float32Array, codes: Uint8Array): number {
    if (!this.codebook) {
      throw new Error('Quantizer not trained.');
    }

    let distance = 0;

    if (this.config.bitsPerCode === 8) {
      for (let sv = 0; sv < this.config.numSubvectors; sv++) {
        const querySubvec = this.extractSubvector(query, sv);
        const centroid = this.getCentroid(sv, codes[sv]);

        for (let d = 0; d < this.subvectorDim; d++) {
          const diff = querySubvec[d] - centroid[d];
          distance += diff * diff;
        }
      }
    } else if (this.config.bitsPerCode === 4) {
      for (let sv = 0; sv < this.config.numSubvectors; sv++) {
        const querySubvec = this.extractSubvector(query, sv);
        const byteIdx = Math.floor(sv / 2);
        const centroidIdx = sv % 2 === 0
          ? codes[byteIdx] & 0x0F
          : (codes[byteIdx] >> 4) & 0x0F;
        const centroid = this.getCentroid(sv, centroidIdx);

        for (let d = 0; d < this.subvectorDim; d++) {
          const diff = querySubvec[d] - centroid[d];
          distance += diff * diff;
        }
      }
    }

    return Math.sqrt(distance);
  }

  /**
   * Get the codebook for serialization
   */
  getCodebook(): PQCodebook | null {
    return this.codebook;
  }

  /**
   * Load a pre-trained codebook
   */
  loadCodebook(codebook: PQCodebook): void {
    if (codebook.config.dimensions !== this.config.dimensions) {
      throw new Error('Codebook dimensions mismatch');
    }
    this.codebook = codebook;
  }

  /**
   * Serialize codebook to JSON-compatible format
   */
  serializeCodebook(): string | null {
    if (!this.codebook) return null;

    return JSON.stringify({
      config: this.codebook.config,
      centroids: this.codebook.centroids.map(c => Array.from(c)),
      trainedAt: this.codebook.trainedAt.toISOString(),
      trainingSize: this.codebook.trainingSize
    });
  }

  /**
   * Deserialize codebook from JSON
   */
  static deserializeCodebook(json: string): PQCodebook {
    const parsed = JSON.parse(json);
    return {
      config: parsed.config,
      centroids: parsed.centroids.map((c: number[]) => new Float32Array(c)),
      trainedAt: new Date(parsed.trainedAt),
      trainingSize: parsed.trainingSize
    };
  }

  /**
   * Get compressed size in bytes for a single vector
   */
  getCompressedSize(): number {
    if (this.config.bitsPerCode === 8) {
      return this.config.numSubvectors; // 1 byte per subvector
    } else if (this.config.bitsPerCode === 4) {
      return Math.ceil(this.config.numSubvectors / 2); // 0.5 bytes per subvector
    }
    return this.config.numSubvectors * this.config.bitsPerCode / 8;
  }

  /**
   * Get compression ratio
   */
  getCompressionRatio(): number {
    const originalSize = this.config.dimensions * 4; // Float32
    return originalSize / this.getCompressedSize();
  }

  // ============ Private Methods ============

  private extractSubvector(vector: Float32Array, subvectorIdx: number): number[] {
    const start = subvectorIdx * this.subvectorDim;
    const end = start + this.subvectorDim;
    return Array.from(vector.slice(start, end));
  }

  private getCentroid(subvectorIdx: number, centroidIdx: number): number[] {
    if (!this.codebook) {
      throw new Error('Codebook not initialized');
    }

    const centroidData = this.codebook.centroids[subvectorIdx];
    const start = centroidIdx * this.subvectorDim;
    const end = start + this.subvectorDim;

    return Array.from(centroidData.slice(start, end));
  }

  private findNearestCentroid(subvector: number[], subvectorIdx: number): number {
    if (!this.codebook) {
      throw new Error('Codebook not initialized');
    }

    let minDist = Infinity;
    let nearestIdx = 0;

    for (let c = 0; c < this.config.numCentroids; c++) {
      const centroid = this.getCentroid(subvectorIdx, c);
      let dist = 0;

      for (let d = 0; d < this.subvectorDim; d++) {
        const diff = subvector[d] - centroid[d];
        dist += diff * diff;
      }

      if (dist < minDist) {
        minDist = dist;
        nearestIdx = c;
      }
    }

    return nearestIdx;
  }

  private sampleIndices(total: number, count: number): number[] {
    const indices: number[] = [];
    const used = new Set<number>();

    while (indices.length < count) {
      const idx = Math.floor(Math.random() * total);
      if (!used.has(idx)) {
        used.add(idx);
        indices.push(idx);
      }
    }

    return indices;
  }

  /**
   * K-means clustering for subvector centroids
   */
  private kmeansCluster(subvectors: number[][], maxIterations: number): number[][] {
    const k = this.config.numCentroids;
    const dim = this.subvectorDim;

    // Initialize centroids using k-means++ style
    const centroids: number[][] = [];
    const used = new Set<number>();

    // First centroid: random
    let firstIdx = Math.floor(Math.random() * subvectors.length);
    centroids.push([...subvectors[firstIdx]]);
    used.add(firstIdx);

    // Remaining centroids: weighted by distance to nearest existing centroid
    while (centroids.length < k) {
      let maxDist = -1;
      let maxIdx = 0;

      for (let i = 0; i < subvectors.length; i++) {
        if (used.has(i)) continue;

        // Find distance to nearest centroid
        let minDist = Infinity;
        for (const c of centroids) {
          let dist = 0;
          for (let d = 0; d < dim; d++) {
            const diff = subvectors[i][d] - c[d];
            dist += diff * diff;
          }
          minDist = Math.min(minDist, dist);
        }

        if (minDist > maxDist) {
          maxDist = minDist;
          maxIdx = i;
        }
      }

      centroids.push([...subvectors[maxIdx]]);
      used.add(maxIdx);
    }

    // Run k-means iterations
    const assignments = new Int32Array(subvectors.length);

    for (let iter = 0; iter < maxIterations; iter++) {
      // Assignment step
      for (let i = 0; i < subvectors.length; i++) {
        let minDist = Infinity;
        let minIdx = 0;

        for (let c = 0; c < k; c++) {
          let dist = 0;
          for (let d = 0; d < dim; d++) {
            const diff = subvectors[i][d] - centroids[c][d];
            dist += diff * diff;
          }
          if (dist < minDist) {
            minDist = dist;
            minIdx = c;
          }
        }

        assignments[i] = minIdx;
      }

      // Update step: compute new centroids
      const counts = new Float64Array(k);
      const sums = Array.from({ length: k }, () => new Float64Array(dim));

      for (let i = 0; i < subvectors.length; i++) {
        const c = assignments[i];
        counts[c]++;
        for (let d = 0; d < dim; d++) {
          sums[c][d] += subvectors[i][d];
        }
      }

      for (let c = 0; c < k; c++) {
        if (counts[c] > 0) {
          for (let d = 0; d < dim; d++) {
            centroids[c][d] = sums[c][d] / counts[c];
          }
        }
      }
    }

    return centroids;
  }
}
