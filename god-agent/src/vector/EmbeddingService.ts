/**
 * Embedding Service
 *
 * Generates vector embeddings using OpenAI's text-embedding-3-small model.
 * Supports batch processing for efficiency.
 *
 * Features:
 * - Configurable timeout (default 30s)
 * - Retry with exponential backoff (default 3 retries)
 * - Detailed error logging for debugging
 */

import OpenAI from 'openai';
import type { EmbeddingServiceConfig, EmbeddingResult, BatchEmbeddingResult } from './types.js';

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 1000;

export class EmbeddingService {
  private client: OpenAI;
  private config: EmbeddingServiceConfig;
  private timeoutMs: number;
  private maxRetries: number;
  private retryDelayMs: number;

  constructor(config: EmbeddingServiceConfig) {
    this.config = config;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryDelayMs = config.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

    if (config.provider === 'openai') {
      if (!config.apiKey) {
        throw new Error('OpenAI API key is required for OpenAI provider');
      }
      this.client = new OpenAI({
        apiKey: config.apiKey,
        timeout: this.timeoutMs,
        maxRetries: 0 // We handle retries ourselves for better control
      });
    } else {
      throw new Error(`Unsupported embedding provider: ${config.provider}`);
    }
  }

  async embed(text: string): Promise<EmbeddingResult> {
    return this.embedWithRetry(text);
  }

  private async embedWithRetry(text: string, attempt = 1): Promise<EmbeddingResult> {
    try {
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
    } catch (error) {
      const isRetryable = this.isRetryableError(error);

      if (isRetryable && attempt < this.maxRetries) {
        const delay = this.retryDelayMs * Math.pow(2, attempt - 1);
        console.warn(`[EmbeddingService] embed() retry ${attempt}/${this.maxRetries} after ${delay}ms:`, this.getErrorMessage(error));
        await this.sleep(delay);
        return this.embedWithRetry(text, attempt + 1);
      }

      console.error(`[EmbeddingService] embed() failed after ${attempt} attempt(s):`, error);
      throw error;
    }
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
      const batchNum = Math.floor(i / this.config.batchSize) + 1;
      const totalBatches = Math.ceil(texts.length / this.config.batchSize);

      try {
        const result = await this.embedBatchChunkWithRetry(batch, batchNum, totalBatches);
        embeddings.push(...result.embeddings);
        totalTokensUsed += result.tokensUsed;
      } catch (error) {
        console.error(`[EmbeddingService] Batch ${batchNum}/${totalBatches} failed:`, error);
        throw error;
      }
    }

    return { embeddings, totalTokensUsed };
  }

  private async embedBatchChunkWithRetry(
    batch: string[],
    batchNum: number,
    totalBatches: number,
    attempt = 1
  ): Promise<{ embeddings: Float32Array[]; tokensUsed: number }> {
    try {
      const response = await this.client.embeddings.create({
        model: this.config.model,
        input: batch,
        dimensions: this.config.dimensions
      });

      const embeddings: Float32Array[] = [];
      for (const data of response.data) {
        embeddings.push(new Float32Array(data.embedding));
      }

      return {
        embeddings,
        tokensUsed: response.usage.total_tokens
      };
    } catch (error) {
      const isRetryable = this.isRetryableError(error);

      if (isRetryable && attempt < this.maxRetries) {
        const delay = this.retryDelayMs * Math.pow(2, attempt - 1);
        console.warn(`[EmbeddingService] Batch ${batchNum}/${totalBatches} retry ${attempt}/${this.maxRetries} after ${delay}ms:`, this.getErrorMessage(error));
        await this.sleep(delay);
        return this.embedBatchChunkWithRetry(batch, batchNum, totalBatches, attempt + 1);
      }

      throw error;
    }
  }

  private isRetryableError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      // Retry on timeout, rate limit, or transient server errors
      return (
        message.includes('timeout') ||
        message.includes('econnreset') ||
        message.includes('enotfound') ||
        message.includes('rate limit') ||
        message.includes('429') ||
        message.includes('500') ||
        message.includes('502') ||
        message.includes('503') ||
        message.includes('504')
      );
    }
    return false;
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getDimensions(): number {
    return this.config.dimensions;
  }

  getModel(): string {
    return this.config.model;
  }
}
