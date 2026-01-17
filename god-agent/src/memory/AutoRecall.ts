/**
 * AutoRecall - Automated Memory Recall Layer
 *
 * Makes the god-agent memory work as a centralized brain by automatically
 * recalling relevant memories BEFORE processing any request.
 *
 * With compressed memories (~4x compression), always-on recall is essentially free.
 */

import type { MemoryEngine } from '../core/MemoryEngine.js';
import type { QueryResult } from '../core/types.js';

// ==========================================
// TYPES
// ==========================================

export interface AutoRecallConfig {
  /** Enable/disable automated recall (default: true) */
  enabled: boolean;

  /** Number of memories to recall (default: 5) */
  topK: number;

  /** Minimum similarity score to include (default: 0.3) */
  minScore: number;

  /** Whether to decode compressed memories (default: false - keep compressed for efficiency) */
  expandCompressed: boolean;

  /** Tools that should NOT trigger recall (e.g., god_query, god_store) */
  excludeTools: string[];

  /** Log recall activity for debugging */
  debug: boolean;
}

export interface RecalledMemory {
  id: string;
  content: string;
  score: number;
  lScore?: number;
  tags: string[];
  source: string;
}

export interface RecallResult {
  memories: RecalledMemory[];
  context: string;
  recallTimeMs: number;
  skipped: boolean;
  skipReason?: string;
}

// ==========================================
// DEFAULT CONFIGURATION
// ==========================================

const DEFAULT_CONFIG: AutoRecallConfig = {
  enabled: true,
  topK: 5,
  minScore: 0.3,
  expandCompressed: false,
  excludeTools: [
    // Memory query tools - already searching
    'god_query',
    'god_query_expanded',
    'god_shadow_search',
    'god_self_query',

    // Memory storage tools - writing, not reading
    'god_store',
    'god_store_compressed',

    // Administrative tools - no context needed
    'god_stats',
    'god_checkpoint',
    'god_delete',
    'god_edit',
    'god_trace',
    'god_causal',
    'god_find_paths',
    'god_cleanup_expired',

    // Learning tools - internal operations
    'god_learn',
    'god_learning_stats',
    'god_prune_patterns',

    // Routing tools - decision-making, not content
    'god_route',
    'god_route_result',
    'god_routing_stats',
    'god_circuit_status',
    'god_reset_circuit',

    // GNN tools - internal operations
    'god_enhance',
    'god_enhance_batch',
    'god_gnn_stats',
    'god_clear_gnn_cache',

    // Scheduler tools - administrative
    'god_schedule',
    'god_trigger',
    'god_tasks',
    'god_pause',
    'god_resume',
    'god_cancel',
    'god_scheduler_stats',

    // Config tools - administrative
    'god_config_get',
    'god_config_set',
    'god_config_load',
    'god_config_save',
    'god_config_reset',

    // Notification tools - administrative
    'god_notify',
    'god_notify_slack',
    'god_notify_discord',
    'god_notify_preferences',
    'god_notify_test',
    'god_notify_history',

    // Containment tools - administrative
    'god_containment_check',
    'god_containment_config',
    'god_containment_add_rule',
    'god_containment_remove_rule',
    'god_containment_status',
    'god_containment_session',

    // Bootstrap/compression tools - administrative
    'god_bootstrap_status',
    'god_compression_stats',
    'god_recompress_all',

    // Communication tools - user interaction
    'god_comms_setup',
    'god_comms_escalate',

    // Curiosity/budget tools - internal
    'god_curiosity_list',
    'god_curiosity_explore',
    'god_budget_status',
    'god_budget_history',

    // Partner tools - configuration
    'god_partner_config',
    'god_partner_challenge',
    'god_partner_status',

    // Capabilities status - administrative
    'god_capabilities_status',
  ],
  debug: false,
};

// ==========================================
// AUTORECALL CLASS
// ==========================================

export class AutoRecall {
  private engine: MemoryEngine | null = null;
  private config: AutoRecallConfig;
  private lastRecallResult: RecallResult | null = null;

  constructor(config: Partial<AutoRecallConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Set the memory engine (called lazily when needed)
   */
  setEngine(engine: MemoryEngine): void {
    this.engine = engine;
  }

  /**
   * Update configuration
   */
  configure(config: Partial<AutoRecallConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): AutoRecallConfig {
    return { ...this.config };
  }

  /**
   * Check if a tool should trigger memory recall
   */
  shouldRecall(toolName: string): boolean {
    if (!this.config.enabled) return false;
    return !this.config.excludeTools.includes(toolName);
  }

  /**
   * Extract searchable context from tool name and arguments
   */
  extractContext(toolName: string, args: unknown): string {
    const parts: string[] = [];

    // Include tool name as a context signal (without god_ prefix)
    const cleanToolName = toolName.replace(/^god_/, '');
    parts.push(cleanToolName);

    // Extract relevant fields from args
    if (args && typeof args === 'object') {
      const a = args as Record<string, unknown>;

      // Query-like fields (highest priority)
      if (a.query && typeof a.query === 'string') {
        parts.push(a.query);
      }
      if (a.question && typeof a.question === 'string') {
        parts.push(a.question);
      }

      // Description fields
      if (a.description && typeof a.description === 'string') {
        parts.push(a.description);
      }
      if (a.specification && typeof a.specification === 'string') {
        // Truncate long specs
        parts.push(String(a.specification).slice(0, 500));
      }

      // Content fields (truncated)
      if (a.content && typeof a.content === 'string') {
        parts.push(String(a.content).slice(0, 300));
      }

      // File-related fields
      if (a.file && typeof a.file === 'string') {
        parts.push(`file:${a.file}`);
      }
      if (a.files && Array.isArray(a.files)) {
        for (const f of a.files.slice(0, 5)) {
          if (typeof f === 'string') parts.push(`file:${f}`);
        }
      }
      if (a.codebase && typeof a.codebase === 'string') {
        parts.push(`codebase:${a.codebase}`);
      }

      // Error/debugging fields
      if (a.error && typeof a.error === 'string') {
        parts.push(a.error);
      }
      if (a.approach && typeof a.approach === 'string') {
        parts.push(a.approach);
      }
      if (a.context && typeof a.context === 'string') {
        parts.push(String(a.context).slice(0, 300));
      }

      // Task-related fields
      if (a.taskId && typeof a.taskId === 'string') {
        parts.push(`task:${a.taskId}`);
      }
      if (a.subtaskId && typeof a.subtaskId === 'string') {
        parts.push(`subtask:${a.subtaskId}`);
      }

      // URL fields
      if (a.url && typeof a.url === 'string') {
        parts.push(`url:${a.url}`);
      }

      // Tags (useful for filtering)
      if (a.tags && Array.isArray(a.tags)) {
        for (const tag of a.tags.slice(0, 5)) {
          if (typeof tag === 'string') parts.push(`tag:${tag}`);
        }
      }

      // Title/name fields
      if (a.title && typeof a.title === 'string') {
        parts.push(a.title);
      }
      if (a.name && typeof a.name === 'string') {
        parts.push(a.name);
      }

      // Message field
      if (a.message && typeof a.message === 'string') {
        parts.push(String(a.message).slice(0, 300));
      }
    }

    return parts.join(' ').trim();
  }

  /**
   * Perform automated memory recall
   */
  async recall(toolName: string, args: unknown): Promise<RecallResult> {
    const startTime = Date.now();

    // Check if recall should be skipped
    if (!this.config.enabled) {
      return this.createSkippedResult('AutoRecall disabled', startTime);
    }

    if (!this.shouldRecall(toolName)) {
      return this.createSkippedResult(`Tool ${toolName} excluded from recall`, startTime);
    }

    if (!this.engine) {
      return this.createSkippedResult('MemoryEngine not initialized', startTime);
    }

    // Extract searchable context
    const context = this.extractContext(toolName, args);
    if (!context || context.length < 3) {
      return this.createSkippedResult('Insufficient context for recall', startTime);
    }

    try {
      // Query memory
      const results = await this.engine.query(context, {
        topK: this.config.topK,
        minScore: this.config.minScore,
        includeProvenance: true,
      });

      // Transform results
      const memories: RecalledMemory[] = results.map((r: QueryResult) => ({
        id: r.entry.id,
        content: r.entry.content,
        score: r.score,
        lScore: r.lScore,
        tags: r.entry.metadata.tags,
        source: r.entry.metadata.source,
      }));

      const result: RecallResult = {
        memories,
        context,
        recallTimeMs: Date.now() - startTime,
        skipped: false,
      };

      this.lastRecallResult = result;

      if (this.config.debug && memories.length > 0) {
        console.error(
          `[AutoRecall] ${toolName}: Found ${memories.length} memories in ${result.recallTimeMs}ms`
        );
      }

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (this.config.debug) {
        console.error(`[AutoRecall] Error: ${message}`);
      }
      return this.createSkippedResult(`Recall failed: ${message}`, startTime);
    }
  }

  /**
   * Get the last recall result (for debugging/inspection)
   */
  getLastRecallResult(): RecallResult | null {
    return this.lastRecallResult;
  }

  /**
   * Format recalled memories for injection into context
   */
  formatForContext(result: RecallResult): string {
    if (result.skipped || result.memories.length === 0) {
      return '';
    }

    const lines: string[] = ['[Recalled Memories]'];
    for (const mem of result.memories) {
      const scoreStr = `(score: ${mem.score.toFixed(2)}${mem.lScore ? `, L: ${mem.lScore.toFixed(2)}` : ''})`;
      lines.push(`- ${mem.content.slice(0, 200)}... ${scoreStr}`);
    }
    return lines.join('\n');
  }

  /**
   * Create a skipped result
   */
  private createSkippedResult(reason: string, startTime: number): RecallResult {
    return {
      memories: [],
      context: '',
      recallTimeMs: Date.now() - startTime,
      skipped: true,
      skipReason: reason,
    };
  }
}

// ==========================================
// SINGLETON INSTANCE
// ==========================================

let autoRecallInstance: AutoRecall | null = null;

export function getAutoRecall(): AutoRecall {
  if (!autoRecallInstance) {
    autoRecallInstance = new AutoRecall();
  }
  return autoRecallInstance;
}

export function initAutoRecall(config: Partial<AutoRecallConfig> = {}): AutoRecall {
  autoRecallInstance = new AutoRecall(config);
  return autoRecallInstance;
}
