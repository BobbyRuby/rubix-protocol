/**
 * TokenBudgetManager - Manage exploration budget
 *
 * Budget rules:
 * - 100K tokens per probe
 * - 5 probes per week
 * - 3:1 pattern (3 high-priority, then 1 moderate)
 *
 * User tasks are UNLIMITED - only autonomous exploration is budgeted.
 */

import type Database from 'better-sqlite3';
import type { MemoryEngine } from '../core/MemoryEngine.js';
import {
  ExplorationBudget,
  PrioritySlot,
  WeeklyStats,
  DEFAULT_BUDGET,
} from './types.js';

export class TokenBudgetManager {
  private db: Database.Database;
  private budget: ExplorationBudget;

  constructor(
    engine: MemoryEngine,
    tokensPerProbe: number = DEFAULT_BUDGET.tokensPerProbe,
    probesPerWeek: number = DEFAULT_BUDGET.probesPerWeek,
    highPriorityRatio: number = DEFAULT_BUDGET.highPriorityRatio
  ) {
    this.db = engine.getStorage().getDb();
    this.budget = {
      tokensPerProbe,
      probesPerWeek,
      highPriorityRatio,
      weeklyResetDay: 0, // Sunday
    };
    this.initializeSchema();
    this.ensureCurrentWeek();
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS exploration_budget (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        week_start TEXT NOT NULL,
        probes_used INTEGER NOT NULL DEFAULT 0,
        tokens_used INTEGER NOT NULL DEFAULT 0,
        pattern TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_budget_week ON exploration_budget(week_start);

      CREATE TABLE IF NOT EXISTS exploration_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        probe_id TEXT NOT NULL,
        tokens_used INTEGER NOT NULL,
        priority_slot TEXT NOT NULL,
        week_start TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  /**
   * Get the start of the current week (based on weeklyResetDay)
   */
  private getWeekStart(): string {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const daysToSubtract = (dayOfWeek - this.budget.weeklyResetDay + 7) % 7;

    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - daysToSubtract);
    weekStart.setHours(0, 0, 0, 0);

    return weekStart.toISOString().split('T')[0];
  }

  /**
   * Ensure we have a record for the current week
   */
  private ensureCurrentWeek(): void {
    const weekStart = this.getWeekStart();
    const now = new Date().toISOString();

    const existing = this.db.prepare(
      'SELECT id FROM exploration_budget WHERE week_start = ?'
    ).get(weekStart);

    if (!existing) {
      this.db.prepare(`
        INSERT INTO exploration_budget (week_start, probes_used, tokens_used, pattern, created_at, updated_at)
        VALUES (?, 0, 0, '[]', ?, ?)
      `).run(weekStart, now, now);
    }
  }

  /**
   * Get current week's budget record
   */
  private getCurrentWeekRecord(): { probes_used: number; tokens_used: number; pattern: string } {
    const weekStart = this.getWeekStart();
    this.ensureCurrentWeek();

    return this.db.prepare(
      'SELECT probes_used, tokens_used, pattern FROM exploration_budget WHERE week_start = ?'
    ).get(weekStart) as { probes_used: number; tokens_used: number; pattern: string };
  }

  /**
   * Check if we have probes remaining this week
   */
  canExplore(): boolean {
    const record = this.getCurrentWeekRecord();
    return record.probes_used < this.budget.probesPerWeek;
  }

  /**
   * Get remaining probe count
   */
  getRemainingProbes(): number {
    const record = this.getCurrentWeekRecord();
    return Math.max(0, this.budget.probesPerWeek - record.probes_used);
  }

  /**
   * Get current position in 3:1 cycle (0-3)
   * 0, 1, 2 = high priority slots
   * 3 = moderate priority slot
   */
  getCyclePosition(): number {
    const record = this.getCurrentWeekRecord();
    return record.probes_used % (this.budget.highPriorityRatio + 1);
  }

  /**
   * Should next probe be high or moderate priority?
   */
  getNextProbeType(): PrioritySlot {
    const position = this.getCyclePosition();
    return position < this.budget.highPriorityRatio ? 'high' : 'moderate';
  }

  /**
   * Record a completed exploration
   */
  recordExploration(probeId: string, tokensUsed: number, priority: PrioritySlot): void {
    const weekStart = this.getWeekStart();
    const now = new Date().toISOString();

    // Get current pattern
    const record = this.getCurrentWeekRecord();
    const pattern: PrioritySlot[] = JSON.parse(record.pattern);
    pattern.push(priority);

    // Update budget
    this.db.prepare(`
      UPDATE exploration_budget
      SET probes_used = probes_used + 1,
          tokens_used = tokens_used + ?,
          pattern = ?,
          updated_at = ?
      WHERE week_start = ?
    `).run(tokensUsed, JSON.stringify(pattern), now, weekStart);

    // Log the exploration
    this.db.prepare(`
      INSERT INTO exploration_log (probe_id, tokens_used, priority_slot, week_start, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(probeId, tokensUsed, priority, weekStart, now);

    console.log(`[TokenBudgetManager] Recorded exploration: ${tokensUsed} tokens, ${priority} priority`);
    console.log(`[TokenBudgetManager] Week status: ${record.probes_used + 1}/${this.budget.probesPerWeek} probes used`);
  }

  /**
   * Get weekly stats
   */
  getWeeklyStats(): WeeklyStats {
    const weekStart = this.getWeekStart();
    const record = this.getCurrentWeekRecord();
    const pattern: PrioritySlot[] = JSON.parse(record.pattern);

    return {
      weekStart: new Date(weekStart),
      probesUsed: record.probes_used,
      probesRemaining: this.getRemainingProbes(),
      tokensUsed: record.tokens_used,
      pattern,
      cyclePosition: this.getCyclePosition(),
    };
  }

  /**
   * Check if a specific token count can be afforded within the per-probe limit
   */
  canAffordTokens(estimatedTokens: number): boolean {
    return estimatedTokens <= this.budget.tokensPerProbe;
  }

  /**
   * Get budget configuration
   */
  getBudgetConfig(): ExplorationBudget {
    return { ...this.budget };
  }

  /**
   * Update budget configuration
   */
  updateBudget(updates: Partial<ExplorationBudget>): void {
    this.budget = { ...this.budget, ...updates };
  }

  /**
   * Get historical usage
   */
  getUsageHistory(weeks: number = 4): WeeklyStats[] {
    const rows = this.db.prepare(`
      SELECT week_start, probes_used, tokens_used, pattern
      FROM exploration_budget
      ORDER BY week_start DESC
      LIMIT ?
    `).all(weeks) as { week_start: string; probes_used: number; tokens_used: number; pattern: string }[];

    return rows.map(row => ({
      weekStart: new Date(row.week_start),
      probesUsed: row.probes_used,
      probesRemaining: this.budget.probesPerWeek - row.probes_used,
      tokensUsed: row.tokens_used,
      pattern: JSON.parse(row.pattern) as PrioritySlot[],
      cyclePosition: row.probes_used % (this.budget.highPriorityRatio + 1),
    }));
  }
}
