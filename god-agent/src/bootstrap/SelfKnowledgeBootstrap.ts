/**
 * SelfKnowledgeBootstrap - Embed RUBIX architecture as memories.
 *
 * Runs once on first init to store compressed self-knowledge.
 * RUBIX can then query itself to understand its own capabilities.
 */

import type { MemoryEngine } from '../core/MemoryEngine.js';
import type { SQLiteStorage } from '../storage/SQLiteStorage.js';
import { MemorySource } from '../core/types.js';
import { memoryCompressor } from '../memory/MemoryCompressor.js';
import { SELF_KNOWLEDGE } from './knowledge/index.js';

export interface BootstrapStats {
  entriesStored: number;
  totalTokensSaved: number;
  categories: Record<string, number>;
}

export class SelfKnowledgeBootstrap {
  private engine: MemoryEngine;
  private storage: SQLiteStorage;

  constructor(engine: MemoryEngine) {
    this.engine = engine;
    this.storage = engine.getStorage();
    this.initializeSchema();
  }

  /**
   * Initialize bootstrap tracking table.
   */
  private initializeSchema(): void {
    const db = this.storage.getDb();
    db.exec(`
      CREATE TABLE IF NOT EXISTS bootstrap_status (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
  }

  /**
   * Check if bootstrap has already run.
   */
  async hasBootstrapped(): Promise<boolean> {
    const db = this.storage.getDb();
    const row = db.prepare(
      'SELECT value FROM bootstrap_status WHERE key = ?'
    ).get('self_knowledge_v1') as { value: string } | undefined;

    return row?.value === 'complete';
  }

  /**
   * Mark bootstrap as complete.
   */
  private async markBootstrapped(): Promise<void> {
    const db = this.storage.getDb();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT OR REPLACE INTO bootstrap_status (key, value, updated_at)
      VALUES (?, ?, ?)
    `).run('self_knowledge_v1', 'complete', now);
  }

  /**
   * Run bootstrap to embed self-knowledge.
   */
  async bootstrap(): Promise<BootstrapStats> {
    // Check if already done
    if (await this.hasBootstrapped()) {
      console.log('[Bootstrap] Self-knowledge already embedded, skipping');
      return { entriesStored: 0, totalTokensSaved: 0, categories: {} };
    }

    console.log('[Bootstrap] Embedding RUBIX self-knowledge...');

    const stats: BootstrapStats = {
      entriesStored: 0,
      totalTokensSaved: 0,
      categories: {},
    };

    // Store each self-knowledge entry
    for (const entry of SELF_KNOWLEDGE) {
      try {
        // Store directly (already compressed)
        await this.engine.store(entry.compressed, {
          tags: ['rubix:self', `rubix:${entry.type}`],
          source: MemorySource.SYSTEM,
          importance: 0.9,
          context: {
            type: entry.type,
            expandable: true,
            bootstrapped: true,
          },
        });

        stats.entriesStored++;
        stats.categories[entry.type] = (stats.categories[entry.type] || 0) + 1;

        // Estimate tokens saved (compressed vs typical description)
        const estimatedOriginal = entry.compressed.length * 3; // Rough estimate
        stats.totalTokensSaved += Math.floor((estimatedOriginal - entry.compressed.length) / 4);
      } catch (error) {
        console.error(`[Bootstrap] Failed to store entry: ${error}`);
      }
    }

    // Mark as complete
    await this.markBootstrapped();

    console.log(`[Bootstrap] Stored ${stats.entriesStored} self-knowledge entries`);
    console.log(`[Bootstrap] Categories: ${JSON.stringify(stats.categories)}`);
    console.log(`[Bootstrap] Estimated tokens saved: ${stats.totalTokensSaved}`);

    return stats;
  }

  /**
   * Query self-knowledge with auto-expansion.
   */
  async querySelf(question: string, topK: number = 5): Promise<string[]> {
    const results = await this.engine.query(question, {
      filters: { tags: ['rubix:self'] },
      topK,
    });

    // Auto-expand compressed entries
    return results.map(r => {
      const context = r.entry.metadata.context as Record<string, unknown> | undefined;
      if (context?.expandable) {
        return memoryCompressor.autoDecode(r.entry.content);
      }
      return r.entry.content;
    });
  }

  /**
   * Get bootstrap status and stats.
   */
  async getStatus(): Promise<{
    bootstrapped: boolean;
    entriesCount: number;
    categories: Record<string, number>;
  }> {
    const bootstrapped = await this.hasBootstrapped();

    if (!bootstrapped) {
      return { bootstrapped: false, entriesCount: 0, categories: {} };
    }

    // Count entries by tag
    const results = await this.engine.query('rubix self knowledge', {
      filters: { tags: ['rubix:self'] },
      topK: 200,
    });

    const categories: Record<string, number> = {};
    for (const r of results) {
      const context = r.entry.metadata.context as Record<string, unknown> | undefined;
      const type = (context?.type as string) || 'unknown';
      categories[type] = (categories[type] || 0) + 1;
    }

    return {
      bootstrapped: true,
      entriesCount: results.length,
      categories,
    };
  }

  /**
   * Force re-bootstrap (clears existing and re-stores).
   */
  async rebootstrap(): Promise<BootstrapStats> {
    console.log('[Bootstrap] Force re-bootstrapping...');

    // Clear bootstrap status
    const db = this.storage.getDb();
    db.prepare('DELETE FROM bootstrap_status WHERE key = ?').run('self_knowledge_v1');

    // Note: We don't delete existing entries to preserve any user additions
    // The bootstrap will add new entries with same content (vector search will dedupe)

    return this.bootstrap();
  }
}
