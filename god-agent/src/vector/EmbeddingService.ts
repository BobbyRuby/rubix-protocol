/**
 * Embedding Service
 *
 * Generates vector embeddings using OpenAI's text-embedding-3-small model.
 * Supports batch processing for efficiency.
 */

import OpenAI from 'openai';
import type { EmbeddingServiceConfig, EmbeddingResult, BatchEmbeddingResult } from './types.js';

export class EmbeddingService {
  private client: OpenAI;
  private config: EmbeddingServiceConfig;

  constructor(config: EmbeddingServiceConfig) {
    this.config = config;

    if (config.provider === 'openai') {
      if (!config.apiKey) {
        throw new Error('OpenAI API key is required for OpenAI provider');
      }
      this.client = new OpenAI({ apiKey: config.apiKey });
    } else {
      throw new Error(`Unsupported embedding provider: ${config.provider}`);
    }
  }

  async embed(text: string): Promise<EmbeddingResult> {
    const response = await this.client.embeddings.create({
      model: this.config.model,
      input: text,
      dimensions: this.config.dimensions
    });

    const embedding = new Float32Array(response.data[0].embedding);
    return {
      embedding,
      tokensUsed: response.usage.total_tokens
    };
  }

  async embedBatch(texts: string[]): Promise<BatchEmbeddingResult> {
    if (texts.length === 0) {
      return { embeddings: [], totalTokensUsed: 0 };
    }

    const embeddings: Float32Array[] = [];
    let totalTokensUsed = 0;

    // Process in batches
    for (let i = 0; i < texts.length; i += this.config.batchSize) {
      const batch = texts.slice(i, i + this.config.batchSize);

      const response = await this.client.embeddings.create({
        model: this.config.model,
        input: batch,
        dimensions: this.config.dimensions
      });

      for (const data of response.data) {
        embeddings.push(new Float32Array(data.embedding));
      }

      totalTokensUsed += response.usage.total_tokens;
    }

    return { embeddings, totalTokensUsed };
  }

  getDimensions(): number {
    return this.config.dimensions;
  }

  getModel(): string {
    return this.config.model;
  }
}
