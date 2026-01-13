/**
 * EmbeddingQueue
 *
 * Deferred batch embedding system to prevent blocking on OpenAI API calls.
 * Queues entries for later batch processing instead of embedding immediately.
 *
 * Flush triggers:
 * - Before any semantic search/query
 * - When pending count >= threshold (default 10)
 * - After task/subtask completion
 * - Before escalation
 * - Periodic flush (30s if pending > 0)
 */

import type { EmbeddingService } from './EmbeddingService.js';
import type { VectorDB } from './VectorDB.js';

export interface PendingEntry {
  id: string;
  content: string;
  label: number;
  queuedAt: Date;
}

export interface FlushResult {
  processed: number;
  failed: string[];
  tokensUsed: number;
  durationMs: number;
}

export interface EmbeddingQueueConfig {
  flushThreshold: number;
  maxRetries: number;
  retryDelayMs: number;
}

const DEFAULT_CONFIG: EmbeddingQueueConfig = {
  flushThreshold: 10,
  maxRetries: 3,
  retryDelayMs: 1000
};

export class EmbeddingQueue {
  private pending: Map<string, PendingEntry> = new Map();
  private embeddings: EmbeddingService;
  private vectorDb: VectorDB;
  private config: EmbeddingQueueConfig;
  private onFlushCallback?: (result: FlushResult) => void;
  private periodicFlushInterval?: ReturnType<typeof setInterval>;

  constructor(
    embeddings: EmbeddingService,
    vectorDb: VectorDB,
    config: Partial<EmbeddingQueueConfig> = {}
  ) {
    this.embeddings = embeddings;
    this.vectorDb = vectorDb;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Queue an entry for deferred embedding (non-blocking)
   */
  queue(id: string, content: string, label: number): void {
    this.pending.set(id, {
      id,
      content,
      label,
      queuedAt: new Date()
    });

    console.log(`[EmbeddingQueue] Queued entry ${id.substring(0, 8)}... (pending: ${this.pending.size})`);
  }

  /**
   * Check if an entry is pending embedding
   */
  hasPending(id: string): boolean {
    return this.pending.has(id);
  }

  /**
   * Get count of pending entries
   */
  get pendingCount(): number {
    return this.pending.size;
  }

  /**
   * Check if threshold reached and auto-flush if needed
   */
  async checkThreshold(): Promise<FlushResult | null> {
    if (this.pending.size >= this.config.flushThreshold) {
      console.log(`[EmbeddingQueue] Threshold reached (${this.pending.size}), auto-flushing...`);
      return this.flush();
    }
    return null;
  }

  /**
   * Process all pending embeddings as a batch
   */
  async flush(): Promise<FlushResult> {
    const startTime = Date.now();

    if (this.pending.size === 0) {
      return { processed: 0, failed: [], tokensUsed: 0, durationMs: 0 };
    }

    const entries = Array.from(this.pending.values());
    const texts = entries.map(e => e.content);
    const failed: string[] = [];
    let tokensUsed = 0;

    console.log(`[EmbeddingQueue] Flushing ${entries.length} pending entries...`);

    try {
      // Use batch embedding with retry
      const result = await this.embedBatchWithRetry(texts);
      tokensUsed = result.totalTokensUsed;

      // Add each embedding to vector DB
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const embedding = result.embeddings[i];

        if (embedding) {
          try {
            this.vectorDb.add(entry.label, embedding);
            this.pending.delete(entry.id);
          } catch (error) {
            console.error(`[EmbeddingQueue] Failed to add vector for ${entry.id}:`, error);
            failed.push(entry.id);
          }
        } else {
          failed.push(entry.id);
        }
      }

      // Persist vector index
      await this.vectorDb.save();

    } catch (error) {
      console.error('[EmbeddingQueue] Batch embedding failed:', error);
      // Mark all as failed
      entries.forEach(e => failed.push(e.id));
    }

    const durationMs = Date.now() - startTime;
    const processed = entries.length - failed.length;

    console.log(`[EmbeddingQueue] Flush complete: ${processed} processed, ${failed.length} failed, ${tokensUsed} tokens, ${durationMs}ms`);

    const result: FlushResult = { processed, failed, tokensUsed, durationMs };

    if (this.onFlushCallback) {
      this.onFlushCallback(result);
    }

    return result;
  }

  /**
   * Batch embed with retry logic
   */
  private async embedBatchWithRetry(
    texts: string[],
    attempt = 1
  ): Promise<{ embeddings: Float32Array[]; totalTokensUsed: number }> {
    try {
      return await this.embeddings.embedBatch(texts);
    } catch (error) {
      if (attempt < this.config.maxRetries) {
        const delay = this.config.retryDelayMs * Math.pow(2, attempt - 1); // Exponential backoff
        console.warn(`[EmbeddingQueue] Retry ${attempt}/${this.config.maxRetries} after ${delay}ms...`);
        await this.sleep(delay);
        return this.embedBatchWithRetry(texts, attempt + 1);
      }
      throw error;
    }
  }

  /**
   * Set callback for flush events
   */
  onFlush(callback: (result: FlushResult) => void): void {
    this.onFlushCallback = callback;
  }

  /**
   * Start periodic flush (every 30s if pending > 0)
   */
  startPeriodicFlush(intervalMs = 30000): void {
    if (this.periodicFlushInterval) {
      return; // Already running
    }

    this.periodicFlushInterval = setInterval(async () => {
      if (this.pending.size > 0) {
        console.log('[EmbeddingQueue] Periodic flush triggered');
        await this.flush();
      }
    }, intervalMs);

    console.log(`[EmbeddingQueue] Periodic flush started (every ${intervalMs}ms)`);
  }

  /**
   * Stop periodic flush
   */
  stopPeriodicFlush(): void {
    if (this.periodicFlushInterval) {
      clearInterval(this.periodicFlushInterval);
      this.periodicFlushInterval = undefined;
      console.log('[EmbeddingQueue] Periodic flush stopped');
    }
  }

  /**
   * Get queue statistics
   */
  getStats(): { pending: number; oldestMs: number | null } {
    if (this.pending.size === 0) {
      return { pending: 0, oldestMs: null };
    }

    const oldest = Array.from(this.pending.values())
      .reduce((min, e) => e.queuedAt < min.queuedAt ? e : min);

    return {
      pending: this.pending.size,
      oldestMs: Date.now() - oldest.queuedAt.getTime()
    };
  }

  /**
   * Clear all pending entries (use with caution)
   */
  clear(): number {
    const count = this.pending.size;
    this.pending.clear();
    console.log(`[EmbeddingQueue] Cleared ${count} pending entries`);
    return count;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
