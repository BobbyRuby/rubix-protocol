/**
 * MemoryDistillationService
 *
 * Proactively reviews stored memories to extract generalizable lessons.
 * Goes beyond reactive learning (Reflexion, Sona) to periodically distill
 * insights from accumulated knowledge.
 *
 * Key Features:
 * - Success pattern extraction: "When facing X, approach Y works because Z"
 * - Failure-to-fix chains: "Error X is typically caused by Y, fix with Z"
 * - Cross-domain insights: Transferable principles across different contexts
 * - Scheduled weekly distillation aligned with Curiosity cycle
 * - Budget-controlled token usage
 * - Provenance-tracked insights linked to source memories
 */

import Anthropic from '@anthropic-ai/sdk';
import { v4 as uuidv4 } from 'uuid';
import type Database from 'better-sqlite3';
import cronParser from 'cron-parser';
import type { MemoryEngine } from '../core/MemoryEngine.js';
import { MemorySource, CausalRelationType } from '../core/types.js';
import type { SonaEngine } from '../learning/SonaEngine.js';
import {
  type DistillationConfig,
  type DistilledInsight,
  type DistillationResult,
  type DistillationStats,
  type DistillationType,
  type InsightQuery,
  type InsightQueryResult,
  type MemoryInput,
  type MemoryCluster,
  type FailureFixChain,
  type DistillationRun,
  type ManualDistillationOptions,
  DEFAULT_DISTILLATION_CONFIG
} from './types.js';

/**
 * MemoryDistillationService - Extract lessons from accumulated memories
 */
export class MemoryDistillationService {
  private engine: MemoryEngine;
  private db: Database.Database;
  private sona: SonaEngine | null;
  private anthropic: Anthropic | null = null;
  private config: DistillationConfig;
  private isRunning: boolean = false;
  private currentRunId: string | null = null;

  // Scheduling state
  private schedulerInterval: NodeJS.Timeout | null = null;
  private nextScheduledRun: Date | null = null;
  private isSchedulerRunning: boolean = false;

  constructor(
    engine: MemoryEngine,
    sona?: SonaEngine,
    anthropicApiKey?: string,
    config?: Partial<DistillationConfig>
  ) {
    this.engine = engine;
    this.db = engine.getStorage().getDb();
    this.sona = sona ?? null;
    this.config = { ...DEFAULT_DISTILLATION_CONFIG, ...config };

    // Initialize Anthropic client
    const apiKey = anthropicApiKey || process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      this.anthropic = new Anthropic({ apiKey });
      console.log('[MemoryDistillation] Initialized with Claude API');
    } else {
      console.warn('[MemoryDistillation] No API key - distillation disabled');
    }

    this.initializeSchema();
  }

  /**
   * Initialize database schema for distillation tracking
   */
  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS distillation_runs (
        id TEXT PRIMARY KEY,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        status TEXT NOT NULL DEFAULT 'running',
        tokens_used INTEGER NOT NULL DEFAULT 0,
        insights_count INTEGER NOT NULL DEFAULT 0,
        memories_processed INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        config TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_distillation_runs_started
        ON distillation_runs(started_at DESC);

      CREATE TABLE IF NOT EXISTS distillation_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  /**
   * Run distillation process
   * Can be called manually or scheduled
   */
  async runDistillation(options?: ManualDistillationOptions): Promise<DistillationResult> {
    if (this.isRunning) {
      return {
        success: false,
        startedAt: new Date(),
        completedAt: new Date(),
        durationMs: 0,
        tokensUsed: 0,
        insights: [],
        byType: this.initTypeCount(),
        memoriesProcessed: 0,
        errors: ['Distillation already running'],
        budgetExhausted: false
      };
    }

    if (!this.anthropic) {
      return {
        success: false,
        startedAt: new Date(),
        completedAt: new Date(),
        durationMs: 0,
        tokensUsed: 0,
        insights: [],
        byType: this.initTypeCount(),
        memoriesProcessed: 0,
        errors: ['No Anthropic API key configured'],
        budgetExhausted: false
      };
    }

    this.isRunning = true;
    const startedAt = new Date();
    const runId = uuidv4();
    this.currentRunId = runId;

    // Merge options with config
    const effectiveConfig = { ...this.config };
    if (options?.types) effectiveConfig.distillationTypes = options.types;
    if (options?.lookbackDays) effectiveConfig.lookbackDays = options.lookbackDays;
    if (options?.maxTokens) effectiveConfig.maxTokensPerRun = options.maxTokens;

    // Create run record
    this.db.prepare(`
      INSERT INTO distillation_runs (id, started_at, status, config)
      VALUES (?, ?, 'running', ?)
    `).run(runId, startedAt.toISOString(), JSON.stringify(effectiveConfig));

    const result: DistillationResult = {
      success: true,
      startedAt,
      completedAt: new Date(),
      durationMs: 0,
      tokensUsed: 0,
      insights: [],
      byType: this.initTypeCount(),
      memoriesProcessed: 0,
      errors: [],
      budgetExhausted: false
    };

    try {
      console.log(`[MemoryDistillation] Starting run ${runId}`);
      console.log(`[MemoryDistillation] Types: ${effectiveConfig.distillationTypes.join(', ')}`);
      console.log(`[MemoryDistillation] Lookback: ${effectiveConfig.lookbackDays} days`);

      let tokensRemaining = effectiveConfig.maxTokensPerRun;

      // Run each distillation type
      for (const type of effectiveConfig.distillationTypes) {
        if (tokensRemaining <= 0) {
          result.budgetExhausted = true;
          break;
        }

        try {
          console.log(`[MemoryDistillation] Running ${type} extraction...`);

          let insights: DistilledInsight[] = [];
          let memoriesProcessed = 0;

          switch (type) {
            case 'success_pattern':
              ({ insights, memoriesProcessed } = await this.extractSuccessPatterns(
                effectiveConfig,
                tokensRemaining,
                options?.dryRun ?? false
              ));
              break;

            case 'failure_fix':
              ({ insights, memoriesProcessed } = await this.extractFailureFixChains(
                effectiveConfig,
                tokensRemaining,
                options?.dryRun ?? false
              ));
              break;

            case 'cross_domain':
              ({ insights, memoriesProcessed } = await this.extractCrossDomainInsights(
                effectiveConfig,
                tokensRemaining,
                options?.dryRun ?? false
              ));
              break;

            // Deferred types
            case 'contradiction':
            case 'consolidation':
              console.log(`[MemoryDistillation] ${type} extraction deferred`);
              continue;
          }

          // Update totals
          const typeTokens = insights.reduce((sum, i) => sum + i.tokensUsed, 0);
          tokensRemaining -= typeTokens;
          result.tokensUsed += typeTokens;
          result.insights.push(...insights);
          result.byType[type] = insights.length;
          result.memoriesProcessed += memoriesProcessed;

          console.log(`[MemoryDistillation] ${type}: ${insights.length} insights, ${typeTokens} tokens`);

        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          result.errors.push(`${type}: ${errorMsg}`);
          console.error(`[MemoryDistillation] Error in ${type}:`, error);
        }
      }

      result.success = result.errors.length === 0;
      result.completedAt = new Date();
      result.durationMs = result.completedAt.getTime() - startedAt.getTime();

      // Update run record
      this.db.prepare(`
        UPDATE distillation_runs
        SET completed_at = ?, status = ?, tokens_used = ?,
            insights_count = ?, memories_processed = ?, error = ?
        WHERE id = ?
      `).run(
        result.completedAt.toISOString(),
        result.success ? 'completed' : 'failed',
        result.tokensUsed,
        result.insights.length,
        result.memoriesProcessed,
        result.errors.length > 0 ? result.errors.join('; ') : null,
        runId
      );

      // Update last run timestamp
      this.db.prepare(`
        INSERT OR REPLACE INTO distillation_meta (key, value) VALUES ('last_run_at', ?)
      `).run(result.completedAt.toISOString());

      console.log(`[MemoryDistillation] Run ${runId} completed:`);
      console.log(`  - Insights: ${result.insights.length}`);
      console.log(`  - Tokens: ${result.tokensUsed}`);
      console.log(`  - Duration: ${result.durationMs}ms`);

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      result.success = false;
      result.errors.push(errorMsg);
      result.completedAt = new Date();
      result.durationMs = result.completedAt.getTime() - startedAt.getTime();

      // Update run record as failed
      this.db.prepare(`
        UPDATE distillation_runs
        SET completed_at = ?, status = 'failed', error = ?
        WHERE id = ?
      `).run(result.completedAt.toISOString(), errorMsg, runId);

      console.error(`[MemoryDistillation] Run ${runId} failed:`, error);

    } finally {
      this.isRunning = false;
      this.currentRunId = null;
    }

    return result;
  }

  /**
   * Extract success patterns from memories
   */
  private async extractSuccessPatterns(
    config: DistillationConfig,
    maxTokens: number,
    dryRun: boolean
  ): Promise<{ insights: DistilledInsight[]; memoriesProcessed: number }> {
    const insights: DistilledInsight[] = [];
    let tokensUsed = 0;

    // Find success-related memories from the lookback period
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - config.lookbackDays);

    const successMemories = await this.findSuccessMemories(cutoffDate);
    if (successMemories.length < 2) {
      console.log('[MemoryDistillation] Not enough success memories for pattern extraction');
      return { insights: [], memoriesProcessed: 0 };
    }

    // Cluster similar success memories
    const clusters = await this.clusterMemories(successMemories, 3);
    console.log(`[MemoryDistillation] Found ${clusters.length} success clusters`);

    for (const cluster of clusters) {
      if (tokensUsed >= maxTokens) break;
      if (cluster.memories.length < 2) continue;

      const prompt = this.buildSuccessPatternPrompt(cluster);
      const insight = await this.generateInsight(prompt, cluster, 'success_pattern', config);

      if (insight && insight.confidence >= config.minConfidence) {
        tokensUsed += insight.tokensUsed;

        if (!dryRun) {
          await this.storeInsight(insight);
        }

        insights.push(insight);
      }
    }

    return { insights, memoriesProcessed: successMemories.length };
  }

  /**
   * Extract failure→fix chains
   */
  private async extractFailureFixChains(
    config: DistillationConfig,
    maxTokens: number,
    dryRun: boolean
  ): Promise<{ insights: DistilledInsight[]; memoriesProcessed: number }> {
    const insights: DistilledInsight[] = [];
    let tokensUsed = 0;

    // Find failure→resolution pairs via causal relations
    const chains = await this.findFailureFixChains(config.lookbackDays);
    if (chains.length === 0) {
      console.log('[MemoryDistillation] No failure→fix chains found');
      return { insights: [], memoriesProcessed: 0 };
    }

    console.log(`[MemoryDistillation] Found ${chains.length} failure→fix chains`);

    for (const chain of chains) {
      if (tokensUsed >= maxTokens) break;

      const prompt = this.buildFailureFixPrompt(chain);
      const insight = await this.generateInsight(
        prompt,
        { memories: [], commonTags: [], theme: chain.errorType, cohesion: chain.causalStrength, id: chain.failureId },
        'failure_fix',
        config,
        [chain.failureId, chain.resolutionId]
      );

      if (insight && insight.confidence >= config.minConfidence) {
        tokensUsed += insight.tokensUsed;

        if (!dryRun) {
          await this.storeInsight(insight);
        }

        insights.push(insight);
      }
    }

    return { insights, memoriesProcessed: chains.length * 2 };
  }

  /**
   * Extract cross-domain insights
   */
  private async extractCrossDomainInsights(
    config: DistillationConfig,
    maxTokens: number,
    dryRun: boolean
  ): Promise<{ insights: DistilledInsight[]; memoriesProcessed: number }> {
    const insights: DistilledInsight[] = [];
    let tokensUsed = 0;

    // Find memories with high-value patterns from different domains
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - config.lookbackDays);

    const patternMemories = await this.findPatternMemories(cutoffDate);
    if (patternMemories.length < 3) {
      console.log('[MemoryDistillation] Not enough pattern memories for cross-domain extraction');
      return { insights: [], memoriesProcessed: 0 };
    }

    // Group by domain/tag and find cross-cutting patterns
    const domains = this.groupByDomain(patternMemories);
    const domainPairs = this.findCrossDomainPairs(domains);

    console.log(`[MemoryDistillation] Found ${domainPairs.length} cross-domain pairs`);

    for (const pair of domainPairs.slice(0, 5)) { // Limit to 5 pairs
      if (tokensUsed >= maxTokens) break;

      const prompt = this.buildCrossDomainPrompt(pair.domain1, pair.memories1, pair.domain2, pair.memories2);
      const sourceIds = [...pair.memories1, ...pair.memories2].map(m => m.id);
      const insight = await this.generateInsight(
        prompt,
        { memories: [...pair.memories1, ...pair.memories2], commonTags: [], theme: 'cross_domain', cohesion: 0.5, id: uuidv4() },
        'cross_domain',
        config,
        sourceIds
      );

      if (insight && insight.confidence >= config.minConfidence) {
        tokensUsed += insight.tokensUsed;

        if (!dryRun) {
          await this.storeInsight(insight);
        }

        insights.push(insight);
      }
    }

    return { insights, memoriesProcessed: patternMemories.length };
  }

  /**
   * Generate an insight using Claude
   */
  private async generateInsight(
    prompt: string,
    cluster: MemoryCluster,
    type: DistillationType,
    config: DistillationConfig,
    sourceIds?: string[]
  ): Promise<DistilledInsight | null> {
    if (!this.anthropic) return null;

    try {
      let response;
      if (config.enableExtendedThinking && config.thinkingBudget >= 1024) {
        response = await this.anthropic.messages.create({
          model: config.model,
          max_tokens: config.maxResponseTokens,
          thinking: {
            type: 'enabled',
            budget_tokens: config.thinkingBudget
          },
          messages: [{ role: 'user', content: prompt }]
        }, {
          headers: {
            'anthropic-beta': 'interleaved-thinking-2025-05-14'
          }
        });
      } else {
        response = await this.anthropic.messages.create({
          model: config.model,
          max_tokens: config.maxResponseTokens,
          messages: [{ role: 'user', content: prompt }]
        });
      }

      const textBlock = response.content.find(block => block.type === 'text');
      if (!textBlock || textBlock.type !== 'text') {
        return null;
      }

      const tokensUsed = (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);
      return this.parseInsightResponse(textBlock.text, type, cluster, tokensUsed, config.model, sourceIds);

    } catch (error) {
      console.error('[MemoryDistillation] Claude API error:', error);
      return null;
    }
  }

  /**
   * Parse Claude's response into a DistilledInsight
   */
  private parseInsightResponse(
    response: string,
    type: DistillationType,
    cluster: MemoryCluster,
    tokensUsed: number,
    model: string,
    sourceIds?: string[]
  ): DistilledInsight | null {
    // Extract sections from response
    const pattern = this.extractSection(response, 'pattern');
    const lesson = this.extractSection(response, 'lesson') || this.extractSection(response, 'insight');
    const contexts = this.extractSection(response, 'when_to_apply') || this.extractSection(response, 'contexts');
    const caveats = this.extractSection(response, 'caveats');
    const confidenceStr = this.extractSection(response, 'confidence') || '0.5';

    if (!lesson) {
      return null;
    }

    const confidence = Math.max(0, Math.min(1, parseFloat(confidenceStr) || 0.5));
    const memoryIds = sourceIds || cluster.memories.map(m => m.id);

    return {
      id: uuidv4(),
      type,
      insight: lesson.trim(),
      pattern: pattern?.trim(),
      applicableContexts: contexts ? contexts.split(/[,\n]/).map(s => s.trim()).filter(Boolean) : [cluster.theme],
      caveats: caveats ? caveats.split(/[,\n]/).map(s => s.trim()).filter(Boolean) : undefined,
      confidence,
      sourceMemoryIds: memoryIds,
      tags: [
        'distilled_insight',
        `type:${type}`,
        ...cluster.commonTags.slice(0, 5)
      ],
      createdAt: new Date(),
      tokensUsed,
      model
    };
  }

  /**
   * Store a distilled insight in memory
   */
  private async storeInsight(insight: DistilledInsight): Promise<string> {
    const content = this.buildInsightContent(insight);

    const entry = await this.engine.store(content, {
      tags: insight.tags,
      source: MemorySource.AGENT_INFERENCE,
      importance: 0.9, // Distilled insights are high value
      confidence: insight.confidence,
      parentIds: insight.sourceMemoryIds
    });

    // Create causal relations to source memories
    for (const sourceId of insight.sourceMemoryIds) {
      try {
        this.engine.addCausalRelation(
          [sourceId],
          [entry.id],
          CausalRelationType.ENABLES,
          0.8,
          { metadata: { type: 'distillation_source' } }
        );
      } catch {
        // Continue if relation creation fails
      }
    }

    // Update Sona weights if available
    if (this.sona && insight.confidence >= 0.8) {
      try {
        const trajectoryId = this.sona.createTrajectory(
          `distilled:${insight.type}:${insight.insight.substring(0, 50)}`,
          [entry.id],
          [1.0],
          undefined,
          'distillation'
        );
        await this.sona.provideFeedback(trajectoryId, 0.85);
      } catch {
        // Sona update is optional
      }
    }

    console.log(`[MemoryDistillation] Stored insight ${entry.id}: ${insight.insight.substring(0, 50)}...`);
    return entry.id;
  }

  /**
   * Query for relevant distilled insights
   */
  async queryInsights(query: InsightQuery): Promise<InsightQueryResult> {
    const topK = query.topK ?? 10;
    const minSimilarity = query.minSimilarity ?? 0.5;

    // Build search query
    let searchQuery = query.query;
    if (query.type) {
      searchQuery = `${searchQuery} type:${query.type}`;
    }

    // Build tag filters
    const tags: string[] = ['distilled_insight'];
    if (query.type) {
      tags.push(`type:${query.type}`);
    }
    if (query.tags) {
      tags.push(...query.tags);
    }

    // Query memory
    const results = await this.engine.query(searchQuery, {
      topK: topK * 2,
      minScore: minSimilarity,
      filters: { tags }
    });

    // Parse insights from results
    const insights: Array<{ insight: DistilledInsight; similarity: number }> = [];
    const lessons = new Set<string>();
    const patterns = new Set<string>();
    const caveats = new Set<string>();

    for (const result of results) {
      const parsed = this.parseStoredInsight(result.entry.id, result.entry.content);
      if (parsed) {
        if (query.minConfidence && parsed.confidence < query.minConfidence) {
          continue;
        }

        insights.push({
          insight: parsed,
          similarity: result.score
        });

        lessons.add(parsed.insight);
        if (parsed.pattern) patterns.add(parsed.pattern);
        if (parsed.caveats) parsed.caveats.forEach(c => caveats.add(c));

        if (insights.length >= topK) break;
      }
    }

    return {
      insights,
      applicableLessons: Array.from(lessons).slice(0, 5),
      relevantPatterns: Array.from(patterns).slice(0, 5),
      relevantCaveats: Array.from(caveats).slice(0, 5)
    };
  }

  /**
   * Get distillation statistics
   */
  async getStats(): Promise<DistillationStats> {
    // Get run statistics
    const runs = this.db.prepare(`
      SELECT COUNT(*) as total_runs,
             SUM(tokens_used) as total_tokens,
             SUM(insights_count) as total_insights
      FROM distillation_runs
      WHERE status = 'completed'
    `).get() as { total_runs: number; total_tokens: number; total_insights: number };

    // Get last run
    const lastRun = this.db.prepare(`
      SELECT * FROM distillation_runs
      ORDER BY started_at DESC
      LIMIT 1
    `).get() as DistillationRun | undefined;

    // Get insight counts by type
    const typeResults = await this.engine.query('distilled_insight', {
      topK: 1000,
      filters: { tags: ['distilled_insight'] }
    });

    const byType: Record<DistillationType, number> = this.initTypeCount();
    let totalConfidence = 0;
    const insightCounts = new Map<string, number>();

    for (const result of typeResults) {
      const insight = this.parseStoredInsight(result.entry.id, result.entry.content);
      if (insight) {
        byType[insight.type]++;
        totalConfidence += insight.confidence;

        const count = insightCounts.get(insight.insight) || 0;
        insightCounts.set(insight.insight, count + 1);
      }
    }

    // Top insights
    const topInsights = Array.from(insightCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([insight, references]) => ({ insight: insight.substring(0, 100), references }));

    // Count pending memories
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.lookbackDays);
    const lastRunAt = lastRun?.completedAt ? new Date(lastRun.completedAt) : cutoffDate;

    const pendingResults = await this.engine.query('success OR resolution OR pattern', {
      topK: 100,
      filters: {
        dateRange: { start: lastRunAt, end: new Date() }
      }
    });

    return {
      totalRuns: runs?.total_runs || 0,
      totalInsights: runs?.total_insights || 0,
      byType,
      avgConfidence: typeResults.length > 0 ? totalConfidence / typeResults.length : 0,
      totalTokensUsed: runs?.total_tokens || 0,
      avgTokensPerRun: runs?.total_runs > 0 ? Math.round((runs?.total_tokens || 0) / runs.total_runs) : 0,
      lastRunAt: lastRun?.completedAt ? new Date(lastRun.completedAt) : undefined,
      lastRunResult: lastRun?.status === 'completed' ? 'success' : lastRun?.status === 'failed' ? 'failed' : undefined,
      topInsights,
      pendingMemories: pendingResults.length
    };
  }

  /**
   * Get configuration
   */
  getConfig(): DistillationConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<DistillationConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  /**
   * Check if distillation is currently running
   */
  isDistillationRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Get the ID of the currently running distillation run
   */
  getCurrentRunId(): string | null {
    return this.currentRunId;
  }

  // ===========================================
  // Scheduling Methods
  // ===========================================

  /**
   * Start the scheduled distillation daemon
   * Checks every hour if it's time to run based on cron schedule
   */
  startScheduled(): void {
    if (this.isSchedulerRunning) {
      console.log('[MemoryDistillation] Scheduler already running');
      return;
    }

    if (!this.config.enabled) {
      console.log('[MemoryDistillation] Scheduled distillation disabled');
      return;
    }

    this.isSchedulerRunning = true;
    this.updateNextScheduledRun();

    console.log(`[MemoryDistillation] Scheduler started with schedule: ${this.config.schedule}`);
    console.log(`[MemoryDistillation] Next run: ${this.nextScheduledRun?.toISOString()}`);

    // Check every hour if it's time to run
    this.schedulerInterval = setInterval(async () => {
      await this.checkAndRunScheduled();
    }, 60 * 60 * 1000); // 1 hour

    // Also check immediately in case we're past due
    this.checkAndRunScheduled().catch(err => {
      console.error('[MemoryDistillation] Initial check failed:', err);
    });
  }

  /**
   * Stop the scheduled distillation daemon
   */
  stopScheduled(): void {
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = null;
    }

    this.isSchedulerRunning = false;
    this.nextScheduledRun = null;

    console.log('[MemoryDistillation] Scheduler stopped');
  }

  /**
   * Check if scheduler is running
   */
  isScheduledRunning(): boolean {
    return this.isSchedulerRunning;
  }

  /**
   * Get the next scheduled run time
   */
  getNextScheduledRun(): Date | null {
    return this.nextScheduledRun;
  }

  /**
   * Check if it's time to run and trigger distillation if so
   */
  private async checkAndRunScheduled(): Promise<void> {
    if (!this.isSchedulerRunning || !this.nextScheduledRun) {
      return;
    }

    const now = new Date();
    if (now >= this.nextScheduledRun) {
      console.log('[MemoryDistillation] Scheduled run triggered');

      try {
        await this.runDistillation();
      } catch (error) {
        console.error('[MemoryDistillation] Scheduled run failed:', error);
      }

      // Update next run time
      this.updateNextScheduledRun();
      console.log(`[MemoryDistillation] Next scheduled run: ${this.nextScheduledRun?.toISOString()}`);
    }
  }

  /**
   * Calculate and update the next scheduled run time based on cron pattern
   */
  private updateNextScheduledRun(): void {
    try {
      const interval = cronParser.parseExpression(this.config.schedule, {
        currentDate: new Date()
      });

      this.nextScheduledRun = interval.next().toDate();
    } catch (error) {
      console.error('[MemoryDistillation] Invalid cron schedule:', error);
      // Fall back to weekly Sunday 3am
      const next = new Date();
      next.setDate(next.getDate() + ((7 - next.getDay()) % 7 || 7)); // Next Sunday
      next.setHours(3, 0, 0, 0);
      this.nextScheduledRun = next;
    }
  }

  // ===========================================
  // Private Helper Methods
  // ===========================================

  private initTypeCount(): Record<DistillationType, number> {
    return {
      success_pattern: 0,
      failure_fix: 0,
      cross_domain: 0,
      contradiction: 0,
      consolidation: 0
    };
  }

  private extractSection(response: string, section: string): string | undefined {
    const regex = new RegExp(`<${section}>([\\s\\S]*?)</${section}>`, 'i');
    const match = response.match(regex);
    return match ? match[1].trim() : undefined;
  }

  private async findSuccessMemories(since: Date): Promise<MemoryInput[]> {
    const results = await this.engine.query('success resolution completed working', {
      topK: 100,
      filters: {
        tags: ['success'],
        tagMatchAll: false,
        dateRange: { start: since, end: new Date() }
      }
    });

    // Also find resolution memories
    const resolutions = await this.engine.query('resolution fixed resolved', {
      topK: 50,
      filters: {
        tags: ['resolution'],
        tagMatchAll: false,
        dateRange: { start: since, end: new Date() }
      }
    });

    const all = [...results, ...resolutions];
    const seen = new Set<string>();

    return all
      .filter(r => {
        if (seen.has(r.entry.id)) return false;
        seen.add(r.entry.id);
        return true;
      })
      .map(r => ({
        id: r.entry.id,
        content: r.entry.content,
        tags: r.entry.metadata.tags,
        importance: r.entry.metadata.importance,
        createdAt: r.entry.createdAt
      }));
  }

  private async findFailureFixChains(lookbackDays: number): Promise<FailureFixChain[]> {
    const chains: FailureFixChain[] = [];

    // Calculate cutoff date for lookback
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

    // Find failures that have resolutions
    const failures = await this.engine.query('failure error', {
      topK: 50,
      filters: {
        tags: ['failure'],
        dateRange: { start: cutoffDate, end: new Date() }
      }
    });

    for (const failure of failures) {
      // Look for causal relations to resolutions
      try {
        const paths = this.engine.findCausalPaths(failure.entry.id, '', 3);

        for (const path of paths) {
          // Find resolution in path
          for (const nodeId of path.nodes) {
            if (nodeId === failure.entry.id) continue;

            const entry = this.engine.getEntry(nodeId);
            if (entry && entry.metadata.tags.includes('resolution')) {
              // Extract error type from failure
              const errorTypeMatch = failure.entry.content.match(/Error Type:\s*(\w+)/i);
              const errorType = errorTypeMatch ? errorTypeMatch[1] : 'unknown';

              chains.push({
                failureId: failure.entry.id,
                failureContent: failure.entry.content,
                errorType,
                resolutionId: entry.id,
                resolutionContent: entry.content,
                causalStrength: path.totalStrength
              });
              break;
            }
          }
        }
      } catch {
        // Skip if path finding fails
      }
    }

    return chains.slice(0, 20); // Limit to 20 chains
  }

  private async findPatternMemories(since: Date): Promise<MemoryInput[]> {
    const results = await this.engine.query('pattern approach strategy solution', {
      topK: 100,
      filters: {
        dateRange: { start: since, end: new Date() },
        minImportance: 0.6
      }
    });

    return results.map(r => ({
      id: r.entry.id,
      content: r.entry.content,
      tags: r.entry.metadata.tags,
      importance: r.entry.metadata.importance,
      createdAt: r.entry.createdAt
    }));
  }

  private async clusterMemories(memories: MemoryInput[], minSize: number): Promise<MemoryCluster[]> {
    // Simple clustering by common tags
    const tagClusters = new Map<string, MemoryInput[]>();

    for (const memory of memories) {
      const relevantTags = memory.tags.filter(t =>
        !t.startsWith('type:') &&
        !t.startsWith('error:') &&
        t !== 'success' &&
        t !== 'resolution'
      );

      for (const tag of relevantTags.slice(0, 3)) {
        const existing = tagClusters.get(tag) || [];
        existing.push(memory);
        tagClusters.set(tag, existing);
      }
    }

    const clusters: MemoryCluster[] = [];

    for (const [tag, mems] of tagClusters) {
      if (mems.length >= minSize) {
        clusters.push({
          id: uuidv4(),
          memories: mems.slice(0, 10), // Limit cluster size
          commonTags: [tag],
          theme: tag,
          cohesion: 0.7
        });
      }
    }

    return clusters;
  }

  private groupByDomain(memories: MemoryInput[]): Map<string, MemoryInput[]> {
    const domains = new Map<string, MemoryInput[]>();

    for (const memory of memories) {
      // Use first non-generic tag as domain
      const domain = memory.tags.find(t =>
        !t.startsWith('type:') &&
        !t.startsWith('error:') &&
        t !== 'success' &&
        t !== 'resolution' &&
        t !== 'pattern'
      ) || 'general';

      const existing = domains.get(domain) || [];
      existing.push(memory);
      domains.set(domain, existing);
    }

    return domains;
  }

  private findCrossDomainPairs(
    domains: Map<string, MemoryInput[]>
  ): Array<{ domain1: string; memories1: MemoryInput[]; domain2: string; memories2: MemoryInput[] }> {
    const pairs: Array<{ domain1: string; memories1: MemoryInput[]; domain2: string; memories2: MemoryInput[] }> = [];
    const domainList = Array.from(domains.entries()).filter(([, mems]) => mems.length >= 2);

    for (let i = 0; i < domainList.length; i++) {
      for (let j = i + 1; j < domainList.length; j++) {
        const [domain1, memories1] = domainList[i];
        const [domain2, memories2] = domainList[j];

        pairs.push({
          domain1,
          memories1: memories1.slice(0, 5),
          domain2,
          memories2: memories2.slice(0, 5)
        });
      }
    }

    return pairs;
  }

  private buildSuccessPatternPrompt(cluster: MemoryCluster): string {
    const memoriesText = cluster.memories
      .map((m, i) => `Memory ${i + 1}:\n${m.content.substring(0, 500)}`)
      .join('\n\n');

    return `# Success Pattern Extraction

You are analyzing successful approaches to extract generalizable patterns.

## Related Success Memories (Theme: ${cluster.theme})

${memoriesText}

## Your Analysis

Extract a generalizable pattern from these successes. Focus on WHAT worked and WHY.

Provide your analysis in this exact format:

<pattern>
[Describe the common pattern: "When facing X, approach Y works because Z"]
</pattern>

<lesson>
[A generalizable principle that could help in similar situations.
Make it actionable and concrete.]
</lesson>

<when_to_apply>
[List contexts where this pattern applies, separated by commas]
</when_to_apply>

<caveats>
[When does this NOT apply? What are the limitations?]
</caveats>

<confidence>
[0.0 to 1.0 - how confident are you in this pattern?]
</confidence>`;
  }

  private buildFailureFixPrompt(chain: FailureFixChain): string {
    return `# Failure→Fix Chain Analysis

You are analyzing a failure and its successful resolution to extract lessons.

## Failure

${chain.failureContent.substring(0, 800)}

## Resolution

${chain.resolutionContent.substring(0, 800)}

## Your Analysis

Extract a generalizable lesson from this failure→resolution chain.
Focus on: Why did it fail? What fixed it? How to prevent similar failures?

Provide your analysis in this exact format:

<pattern>
[The pattern: "Error X is typically caused by Y, fix with Z"]
</pattern>

<lesson>
[Generalizable principle for avoiding or fixing this type of failure]
</lesson>

<when_to_apply>
[Contexts where this lesson applies]
</when_to_apply>

<caveats>
[When might this fix NOT work? Edge cases?]
</caveats>

<confidence>
[0.0 to 1.0 - how confident are you?]
</confidence>`;
  }

  private buildCrossDomainPrompt(
    domain1: string,
    memories1: MemoryInput[],
    domain2: string,
    memories2: MemoryInput[]
  ): string {
    const mems1Text = memories1.map((m, i) => `${i + 1}. ${m.content.substring(0, 300)}`).join('\n');
    const mems2Text = memories2.map((m, i) => `${i + 1}. ${m.content.substring(0, 300)}`).join('\n');

    return `# Cross-Domain Insight Extraction

You are looking for transferable principles that apply across different domains.

## Domain 1: ${domain1}

${mems1Text}

## Domain 2: ${domain2}

${mems2Text}

## Your Analysis

Find common patterns or principles that transfer between these domains.
Example: "Retry with backoff works for both API calls AND database connections"

Provide your analysis in this exact format:

<insight>
[The transferable principle that works in both domains]
</insight>

<pattern>
[The common pattern: "X works in context Y for the same reason it works in context Z"]
</pattern>

<when_to_apply>
[Both domains, and potentially other domains where this might apply]
</when_to_apply>

<caveats>
[When does this cross-domain insight NOT transfer?]
</caveats>

<confidence>
[0.0 to 1.0 - how confident that this transfers across domains?]
</confidence>`;
  }

  private buildInsightContent(insight: DistilledInsight): string {
    const parts = [
      `DISTILLED INSIGHT (${insight.type})`,
      '',
      `LESSON: ${insight.insight}`,
      ''
    ];

    if (insight.pattern) {
      parts.push(`PATTERN: ${insight.pattern}`, '');
    }

    parts.push(`APPLIES TO: ${insight.applicableContexts.join(', ')}`, '');

    if (insight.caveats && insight.caveats.length > 0) {
      parts.push(`CAVEATS: ${insight.caveats.join('; ')}`, '');
    }

    parts.push(
      `Confidence: ${insight.confidence}`,
      `Sources: ${insight.sourceMemoryIds.length} memories`,
      `Generated: ${insight.createdAt.toISOString()}`,
      `Tokens: ${insight.tokensUsed}`
    );

    return parts.join('\n');
  }

  private parseStoredInsight(id: string, content: string): DistilledInsight | null {
    try {
      const lines = content.split('\n');

      // Extract type from first line
      const typeMatch = lines[0].match(/\((\w+)\)/);
      const type = (typeMatch ? typeMatch[1] : 'success_pattern') as DistillationType;

      // Extract sections
      const lessonMatch = content.match(/LESSON:\s*([\s\S]*?)(?=\n\n|PATTERN:|APPLIES TO:|$)/);
      const patternMatch = content.match(/PATTERN:\s*([\s\S]*?)(?=\n\n|APPLIES TO:|CAVEATS:|$)/);
      const appliesMatch = content.match(/APPLIES TO:\s*(.+)/);
      const caveatsMatch = content.match(/CAVEATS:\s*(.+)/);
      const confidenceMatch = content.match(/Confidence:\s*([\d.]+)/);
      // Note: Sources count is in content but sourceMemoryIds aren't reconstructible
      const tokensMatch = content.match(/Tokens:\s*(\d+)/);
      const dateMatch = content.match(/Generated:\s*(.+)/);

      if (!lessonMatch) return null;

      return {
        id,
        type,
        insight: lessonMatch[1].trim(),
        pattern: patternMatch ? patternMatch[1].trim() : undefined,
        applicableContexts: appliesMatch ? appliesMatch[1].split(',').map(s => s.trim()) : [],
        caveats: caveatsMatch ? caveatsMatch[1].split(';').map(s => s.trim()) : undefined,
        confidence: confidenceMatch ? parseFloat(confidenceMatch[1]) : 0.5,
        sourceMemoryIds: [], // Can't reconstruct from content
        tags: ['distilled_insight', `type:${type}`],
        createdAt: dateMatch ? new Date(dateMatch[1]) : new Date(),
        tokensUsed: tokensMatch ? parseInt(tokensMatch[1], 10) : 0,
        model: 'unknown'
      };
    } catch {
      return null;
    }
  }
}

export default MemoryDistillationService;
