/**
 * AsyncWriteQueue - Non-blocking write queue for database operations
 *
 * Provides asynchronous, batched database writes to prevent blocking
 * the main thread during heavy write operations.
 */

// Generic database interface for flexibility
export interface DatabaseAdapter {
  run(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}

export interface WriteOperation {
  type: 'insert' | 'update' | 'delete';
  table: string;
  data: Record<string, any>;
  id?: string;
}

export interface AsyncWriteQueueOptions {
  batchSize?: number;
  flushInterval?: number;
  maxQueueSize?: number;
}

export class AsyncWriteQueue {
  private queue: WriteOperation[] = [];
  private processing = false;
  private db: DatabaseAdapter;
  private batchSize: number;
  private flushInterval: number;
  private maxQueueSize: number;
  private flushTimer?: NodeJS.Timeout;
  private writeCount = 0;
  private errorCount = 0;

  constructor(
    db: DatabaseAdapter,
    options: AsyncWriteQueueOptions = {}
  ) {
    this.db = db;
    this.batchSize = options.batchSize ?? 10;
    this.flushInterval = options.flushInterval ?? 1000; // 1 second
    this.maxQueueSize = options.maxQueueSize ?? 1000;

    // Start periodic flush timer
    this.startFlushTimer();
  }

  /**
   * Non-blocking write - returns immediately
   * Adds operation to queue and schedules processing
   */
  write(operation: WriteOperation): void {
    // Check queue size limit
    if (this.queue.length >= this.maxQueueSize) {
      console.warn(`AsyncWriteQueue: Queue size limit reached (${this.maxQueueSize}), forcing flush`);
      void this.flush();
    }

    this.queue.push(operation);
    this.scheduleProcess();
  }

  /**
   * Convenience method for insert operations
   */
  insert(table: string, data: Record<string, any>): void {
    this.write({
      type: 'insert',
      table,
      data
    });
  }

  /**
   * Convenience method for update operations
   */
  update(table: string, id: string, data: Record<string, any>): void {
    this.write({
      type: 'update',
      table,
      id,
      data
    });
  }

  /**
   * Convenience method for delete operations
   */
  delete(table: string, id: string): void {
    this.write({
      type: 'delete',
      table,
      id,
      data: {}
    });
  }

  /**
   * Schedule background processing if not already running
   */
  private scheduleProcess(): void {
    if (!this.processing && this.queue.length > 0) {
      // Use setImmediate for non-blocking scheduling
      setImmediate(() => {
        void this.processQueue();
      });
    }
  }

  /**
   * Background batch processing
   * Processes queue in batches using database transactions
   */
  private async processQueue(): Promise<void> {
    if (this.processing) return;

    this.processing = true;

    try {
      while (this.queue.length > 0) {
        const batch = this.queue.splice(0, this.batchSize);

        await this.processBatch(batch);
      }
    } catch (error) {
      console.error('AsyncWriteQueue: Error processing queue:', error);
      this.errorCount++;
    } finally {
      this.processing = false;
    }
  }

  /**
   * Process a single batch of operations within a transaction
   */
  private async processBatch(batch: WriteOperation[]): Promise<void> {
    try {
      // Execute batch in a transaction for atomicity and performance
      await this.db.transaction(async () => {
        for (const op of batch) {
          await this.executeOperation(op);
        }
      });

      this.writeCount += batch.length;
    } catch (error) {
      console.error('AsyncWriteQueue: Error processing batch:', error);
      this.errorCount++;

      // Re-queue failed operations (simple retry strategy)
      this.queue.unshift(...batch);

      // Prevent infinite retry loop
      if (this.errorCount > 10) {
        console.error('AsyncWriteQueue: Too many errors, clearing queue');
        this.queue = [];
        this.errorCount = 0;
      }
    }
  }

  /**
   * Execute a single write operation
   */
  private async executeOperation(op: WriteOperation): Promise<void> {
    switch (op.type) {
      case 'insert':
        await this.executeInsert(op);
        break;
      case 'update':
        await this.executeUpdate(op);
        break;
      case 'delete':
        await this.executeDelete(op);
        break;
      default:
        throw new Error(`Unknown operation type: ${(op as any).type}`);
    }
  }

  /**
   * Execute insert operation
   */
  private async executeInsert(op: WriteOperation): Promise<void> {
    const columns = Object.keys(op.data);
    const placeholders = columns.map(() => '?').join(', ');
    const values = columns.map(col => op.data[col]);

    const sql = `INSERT INTO ${op.table} (${columns.join(', ')}) VALUES (${placeholders})`;

    await this.db.run(sql, values);
  }

  /**
   * Execute update operation
   */
  private async executeUpdate(op: WriteOperation): Promise<void> {
    if (!op.id) {
      throw new Error('Update operation requires an id');
    }

    const columns = Object.keys(op.data);
    const setClause = columns.map(col => `${col} = ?`).join(', ');
    const values = [...columns.map(col => op.data[col]), op.id];

    const sql = `UPDATE ${op.table} SET ${setClause} WHERE id = ?`;

    await this.db.run(sql, values);
  }

  /**
   * Execute delete operation
   */
  private async executeDelete(op: WriteOperation): Promise<void> {
    if (!op.id) {
      throw new Error('Delete operation requires an id');
    }

    const sql = `DELETE FROM ${op.table} WHERE id = ?`;

    await this.db.run(sql, [op.id]);
  }

  /**
   * Force flush all pending writes
   * Waits until all operations are completed
   */
  async flush(): Promise<void> {
    // Process any remaining items in queue
    await this.processQueue();

    // Wait for any in-flight processing to complete
    while (this.processing) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  /**
   * Start periodic flush timer
   */
  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      if (this.queue.length > 0 && !this.processing) {
        void this.processQueue();
      }
    }, this.flushInterval);
  }

  /**
   * Stop periodic flush timer and clean up
   */
  async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }

    // Flush any remaining operations
    await this.flush();
  }

  /**
   * Get queue statistics
   */
  getStats(): {
    queueSize: number;
    processing: boolean;
    totalWrites: number;
    errorCount: number;
  } {
    return {
      queueSize: this.queue.length,
      processing: this.processing,
      totalWrites: this.writeCount,
      errorCount: this.errorCount
    };
  }

  /**
   * Check if queue is idle (empty and not processing)
   */
  isIdle(): boolean {
    return this.queue.length === 0 && !this.processing;
  }

  /**
   * Clear the queue without processing
   * WARNING: This will discard pending operations
   */
  clear(): void {
    this.queue = [];
    this.errorCount = 0;
  }
}
