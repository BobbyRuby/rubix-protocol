/**
 * CuriosityTracker - Track what RUBIX is curious about
 *
 * Records probes from:
 * - Failed tasks (priority 1.0)
 * - Low-confidence patterns (priority 0.7)
 * - Knowledge gaps (priority 0.5)
 * - Success confirmations (priority 0.2)
 */

import { v4 as uuidv4 } from 'uuid';
import type Database from 'better-sqlite3';
import type { MemoryEngine } from '../core/MemoryEngine.js';
import {
  CuriosityProbe,
  ProbeOrigin,
  ProbeStatus,
  ExplorationResult,
  calculatePriority,
} from './types.js';

export interface ExplorationHistoryEntry {
  probeId: string;
  domain: string;
  tokensUsed: number;
  success: boolean;
  exploredAt: Date;
}

export class CuriosityTracker {
  private db: Database.Database;
  private cycleCount: number = 0;

  constructor(engine: MemoryEngine) {
    this.db = engine.getStorage().getDb();
    this.initializeSchema();
    this.loadCycleCount();
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS curiosity_probes (
        id TEXT PRIMARY KEY,
        domain TEXT NOT NULL,
        question TEXT NOT NULL,
        origin TEXT NOT NULL,
        confidence REAL NOT NULL,
        novelty_score REAL NOT NULL,
        priority REAL NOT NULL,
        estimated_tokens INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        error_type TEXT,
        error_message TEXT,
        stack_trace TEXT,
        pattern_name TEXT,
        success_rate REAL,
        related_patterns TEXT,
        context TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_probes_status ON curiosity_probes(status);
      CREATE INDEX IF NOT EXISTS idx_probes_priority ON curiosity_probes(priority DESC);
      CREATE INDEX IF NOT EXISTS idx_probes_origin ON curiosity_probes(origin);

      CREATE TABLE IF NOT EXISTS curiosity_discoveries (
        id TEXT PRIMARY KEY,
        probe_id TEXT NOT NULL,
        success INTEGER NOT NULL,
        tokens_used INTEGER NOT NULL,
        findings TEXT NOT NULL,
        cause TEXT,
        fix TEXT,
        pattern_update TEXT,
        stored_facts TEXT,
        confidence REAL NOT NULL,
        duration_ms INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (probe_id) REFERENCES curiosity_probes(id)
      );

      CREATE TABLE IF NOT EXISTS curiosity_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  private loadCycleCount(): void {
    const row = this.db.prepare(
      'SELECT value FROM curiosity_meta WHERE key = ?'
    ).get('cycle_count') as { value: string } | undefined;

    this.cycleCount = row ? parseInt(row.value, 10) : 0;
  }

  private saveCycleCount(): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO curiosity_meta (key, value) VALUES (?, ?)
    `).run('cycle_count', String(this.cycleCount));
  }

  /**
   * Record something RUBIX is curious about
   */
  async recordCuriosity(
    probe: Omit<CuriosityProbe, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'priority'>
  ): Promise<string> {
    const id = uuidv4();
    const now = new Date().toISOString();
    const priority = calculatePriority(probe);

    this.db.prepare(`
      INSERT INTO curiosity_probes (
        id, domain, question, origin, confidence, novelty_score, priority,
        estimated_tokens, status, error_type, error_message, stack_trace,
        pattern_name, success_rate, related_patterns, context, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      probe.domain,
      probe.question,
      probe.origin,
      probe.confidence,
      probe.noveltyScore,
      priority,
      probe.estimatedTokens,
      'pending',
      probe.errorType || null,
      probe.errorMessage || null,
      probe.stackTrace || null,
      probe.patternName || null,
      probe.successRate || null,
      probe.relatedPatterns ? JSON.stringify(probe.relatedPatterns) : null,
      probe.context ? JSON.stringify(probe.context) : null,
      now,
      now
    );

    console.log(`[CuriosityTracker] Recorded probe: ${probe.origin}|${probe.domain} (priority: ${priority.toFixed(2)})`);
    return id;
  }

  /**
   * Get pending probes sorted by priority
   */
  async getPendingProbes(limit: number = 10): Promise<CuriosityProbe[]> {
    const rows = this.db.prepare(`
      SELECT * FROM curiosity_probes
      WHERE status = 'pending'
      ORDER BY priority DESC, created_at ASC
      LIMIT ?
    `).all(limit) as any[];

    return rows.map(this.rowToProbe);
  }

  /**
   * Get top failure probe (highest priority)
   */
  async getTopFailureProbe(): Promise<CuriosityProbe | null> {
    const row = this.db.prepare(`
      SELECT * FROM curiosity_probes
      WHERE status = 'pending' AND origin IN ('failure', 'low_confidence')
      ORDER BY priority DESC, created_at ASC
      LIMIT 1
    `).get() as any | undefined;

    return row ? this.rowToProbe(row) : null;
  }

  /**
   * Get a moderate priority probe (knowledge gap or success confirmation)
   */
  async getModerateProbe(): Promise<CuriosityProbe | null> {
    const row = this.db.prepare(`
      SELECT * FROM curiosity_probes
      WHERE status = 'pending' AND origin IN ('knowledge_gap', 'success_confirmation')
      ORDER BY priority DESC, created_at ASC
      LIMIT 1
    `).get() as any | undefined;

    return row ? this.rowToProbe(row) : null;
  }

  /**
   * Get exploration opportunities based on current cycle position
   */
  async getExplorationOpportunities(limit: number = 3): Promise<CuriosityProbe[]> {
    const allProbes = await this.getPendingProbes(limit * 2);
    if (allProbes.length === 0) return [];

    // Sort by priority (failures first)
    const sorted = allProbes.sort((a, b) => b.priority - a.priority);

    // Every Nth cycle, include one success confirmation probe
    const successConfirmRate = 5;
    if (this.cycleCount % successConfirmRate === 0) {
      const successProbe = sorted.find(p => p.origin === 'success_confirmation');
      if (successProbe) {
        const topProbes = sorted
          .filter(p => p.origin !== 'success_confirmation')
          .slice(0, limit - 1);
        return [...topProbes, successProbe];
      }
    }

    return sorted.slice(0, limit);
  }

  /**
   * Mark probe as being explored
   */
  async startExploring(probeId: string): Promise<void> {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE curiosity_probes SET status = 'exploring', updated_at = ? WHERE id = ?
    `).run(now, probeId);
  }

  /**
   * Record discovery from exploration
   */
  async recordDiscovery(probeId: string, result: Omit<ExplorationResult, 'probeId'>): Promise<void> {
    const id = uuidv4();
    const now = new Date().toISOString();

    // Insert discovery
    this.db.prepare(`
      INSERT INTO curiosity_discoveries (
        id, probe_id, success, tokens_used, findings, cause, fix,
        pattern_update, stored_facts, confidence, duration_ms, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      probeId,
      result.success ? 1 : 0,
      result.tokensUsed,
      result.findings,
      result.cause || null,
      result.fix || null,
      result.patternUpdate || null,
      JSON.stringify(result.storedFacts),
      result.confidence,
      result.durationMs,
      now
    );

    // Update probe status
    this.db.prepare(`
      UPDATE curiosity_probes SET status = 'resolved', updated_at = ? WHERE id = ?
    `).run(now, probeId);

    console.log(`[CuriosityTracker] Discovery recorded for probe ${probeId}: ${result.findings.slice(0, 50)}...`);
  }

  /**
   * Increment cycle count (called after each discovery cycle)
   */
  incrementCycle(): void {
    this.cycleCount++;
    this.saveCycleCount();
  }

  /**
   * Get current cycle count
   */
  getCycleCount(): number {
    return this.cycleCount;
  }

  /**
   * Get unexplored domains (domains with pending probes)
   */
  async getUnexploredDomains(): Promise<string[]> {
    const rows = this.db.prepare(`
      SELECT DISTINCT domain FROM curiosity_probes
      WHERE status = 'pending'
      ORDER BY domain
    `).all() as { domain: string }[];

    return rows.map(r => r.domain);
  }

  /**
   * Get probe by ID
   */
  async getProbe(probeId: string): Promise<CuriosityProbe | null> {
    const row = this.db.prepare(
      'SELECT * FROM curiosity_probes WHERE id = ?'
    ).get(probeId) as any | undefined;

    return row ? this.rowToProbe(row) : null;
  }

  /**
   * Get stats
   */
  async getStats(): Promise<{
    pending: number;
    exploring: number;
    resolved: number;
    byOrigin: Record<ProbeOrigin, number>;
  }> {
    const statusCounts = this.db.prepare(`
      SELECT status, COUNT(*) as count FROM curiosity_probes GROUP BY status
    `).all() as { status: string; count: number }[];

    const originCounts = this.db.prepare(`
      SELECT origin, COUNT(*) as count FROM curiosity_probes
      WHERE status = 'pending'
      GROUP BY origin
    `).all() as { origin: string; count: number }[];

    const stats = {
      pending: 0,
      exploring: 0,
      resolved: 0,
      byOrigin: {
        failure: 0,
        low_confidence: 0,
        knowledge_gap: 0,
        success_confirmation: 0,
      } as Record<ProbeOrigin, number>,
    };

    for (const row of statusCounts) {
      if (row.status === 'pending') stats.pending = row.count;
      if (row.status === 'exploring') stats.exploring = row.count;
      if (row.status === 'resolved') stats.resolved = row.count;
    }

    for (const row of originCounts) {
      stats.byOrigin[row.origin as ProbeOrigin] = row.count;
    }

    return stats;
  }

  /**
   * Get probes by status
   */
  async getProbesByStatus(status: ProbeStatus, limit: number = 10): Promise<CuriosityProbe[]> {
    const rows = this.db.prepare(`
      SELECT * FROM curiosity_probes
      WHERE status = ?
      ORDER BY priority DESC, created_at ASC
      LIMIT ?
    `).all(status, limit) as any[];

    return rows.map(this.rowToProbe);
  }

  /**
   * Get exploration history since a date
   */
  async getExplorationHistory(since: Date): Promise<ExplorationHistoryEntry[]> {
    const rows = this.db.prepare(`
      SELECT d.probe_id, p.domain, d.tokens_used, d.success, d.created_at
      FROM curiosity_discoveries d
      JOIN curiosity_probes p ON d.probe_id = p.id
      WHERE d.created_at >= ?
      ORDER BY d.created_at DESC
    `).all(since.toISOString()) as any[];

    return rows.map(row => ({
      probeId: row.probe_id,
      domain: row.domain,
      tokensUsed: row.tokens_used,
      success: row.success === 1,
      exploredAt: new Date(row.created_at),
    }));
  }

  /**
   * Convert database row to CuriosityProbe
   */
  private rowToProbe(row: any): CuriosityProbe {
    return {
      id: row.id,
      domain: row.domain,
      question: row.question,
      origin: row.origin as ProbeOrigin,
      confidence: row.confidence,
      noveltyScore: row.novelty_score,
      priority: row.priority,
      estimatedTokens: row.estimated_tokens,
      status: row.status as ProbeStatus,
      errorType: row.error_type || undefined,
      errorMessage: row.error_message || undefined,
      stackTrace: row.stack_trace || undefined,
      patternName: row.pattern_name || undefined,
      successRate: row.success_rate || undefined,
      relatedPatterns: row.related_patterns ? JSON.parse(row.related_patterns) : undefined,
      context: row.context ? JSON.parse(row.context) : undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}
