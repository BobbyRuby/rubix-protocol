/**
 * CoreBrainConnector - Cross-Instance Memory Access
 *
 * Enables project instances to query a shared "core brain" memory for
 * accumulated skills, patterns, and cross-project knowledge.
 *
 * Architecture:
 * - Each project instance has its own isolated memory (local context)
 * - Optional core brain instance holds shared knowledge
 * - CoreBrainConnector creates a read-only MemoryEngine to core brain's SQLite DB
 * - SQLite WAL mode ensures safe concurrent reads
 *
 * Configuration:
 * - RUBIX_CORE_BRAIN_DATA_DIR: Path to core brain's data directory
 * - If not set, core brain is unavailable (graceful degradation)
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { MemoryEngine } from './MemoryEngine.js';
import type { MemoryEngineConfig } from './types.js';

export class CoreBrainConnector {
  private coreBrainDataDir: string | null;
  private coreBrainEngine: MemoryEngine | null = null;
  private availabilityChecked = false;
  private isAvailableCache = false;

  constructor(coreBrainDataDir?: string) {
    // Check environment variable if not provided
    this.coreBrainDataDir = coreBrainDataDir || process.env.RUBIX_CORE_BRAIN_DATA_DIR || null;
  }

  /**
   * Check if core brain is configured and available.
   * Caches result to avoid repeated file system checks.
   */
  async isAvailable(): Promise<boolean> {
    if (this.availabilityChecked) {
      return this.isAvailableCache;
    }

    this.availabilityChecked = true;

    // No configuration
    if (!this.coreBrainDataDir) {
      this.isAvailableCache = false;
      return false;
    }

    // Check if data directory exists
    const dbPath = join(this.coreBrainDataDir, 'memory.db');
    if (!existsSync(dbPath)) {
      console.warn(`[CoreBrainConnector] Core brain database not found: ${dbPath}`);
      this.isAvailableCache = false;
      return false;
    }

    // Try to initialize connection
    try {
      await this.getEngine();
      this.isAvailableCache = true;
      return true;
    } catch (error) {
      console.error('[CoreBrainConnector] Failed to connect to core brain:', error);
      this.isAvailableCache = false;
      return false;
    }
  }

  /**
   * Get the core brain MemoryEngine instance.
   * Creates a read-only connection if not already initialized.
   *
   * @throws Error if core brain not configured or unavailable
   */
  async getEngine(): Promise<MemoryEngine> {
    if (!this.coreBrainDataDir) {
      throw new Error('Core brain not configured. Set RUBIX_CORE_BRAIN_DATA_DIR environment variable.');
    }

    // Lazy initialization
    if (!this.coreBrainEngine) {
      console.log(`[CoreBrainConnector] Initializing connection to core brain: ${this.coreBrainDataDir}`);

      const config: Partial<MemoryEngineConfig> = {
        dataDir: this.coreBrainDataDir,
      };

      this.coreBrainEngine = new MemoryEngine(config);
      await this.coreBrainEngine.initialize();

      console.log('[CoreBrainConnector] Core brain connection established');
    }

    return this.coreBrainEngine;
  }

  /**
   * Get the core brain data directory path (for debugging).
   */
  getDataDir(): string | null {
    return this.coreBrainDataDir;
  }

  /**
   * Close the core brain connection.
   */
  async close(): Promise<void> {
    if (this.coreBrainEngine) {
      await this.coreBrainEngine.close();
      this.coreBrainEngine = null;
    }
  }
}
