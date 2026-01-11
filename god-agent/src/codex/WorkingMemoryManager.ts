/**
 * WorkingMemoryManager
 *
 * Manages task-scoped memory during RUBIX execution.
 * Enables active memory engagement:
 * - Store working context (decisions, findings, failures)
 * - Query memory for relevant past learnings
 * - Build causal chains linking approaches to outcomes
 * - Summarize sessions for future reference
 */

import type { MemoryEngine } from '../core/MemoryEngine.js';
import { MemorySource, CausalRelationType } from '../core/types.js';

/**
 * Configuration for working memory session
 */
export interface WorkingMemoryConfig {
  /** Task ID used as session ID for isolation */
  sessionId: string;
  /** Codebase path */
  codebase: string;
  /** Task description */
  taskDescription: string;
}

/**
 * Result from memory queries
 */
export interface MemoryResult {
  id: string;
  content: string;
  score?: number;
}

/**
 * Contradiction result from shadow search
 */
export interface ContradictionResult {
  content: string;
  strength: number;
}

/**
 * Session statistics
 */
export interface SessionStats {
  entries: number;
  decisions: number;
  failures: number;
  approaches: number;
  findings: number;
}

/**
 * WorkingMemoryManager - Active memory for RUBIX tasks
 */
export class WorkingMemoryManager {
  private engine: MemoryEngine;
  private config: WorkingMemoryConfig;

  /** Track entries by subtask for scoped queries */
  private entryLog: Map<string, string[]> = new Map();

  /** Track entry types for stats */
  private typeCount: Map<string, number> = new Map();

  constructor(engine: MemoryEngine, config: WorkingMemoryConfig) {
    this.engine = engine;
    this.config = config;

    console.log(`[WorkingMemory] Session started: ${config.sessionId}`);
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  /**
   * Internal store method with common options
   */
  private async store(
    content: string,
    type: string,
    options: {
      confidence?: number;
      importance?: number;
      subtaskId?: string;
      parentIds?: string[];
    } = {}
  ): Promise<string> {
    const tags = [
      'codex',
      'working-memory',
      type,
      `task:${this.config.sessionId}`,
      `codebase:${this.config.codebase}`  // Track which codebase this entry belongs to
    ];

    if (options.subtaskId) {
      tags.push(`subtask:${options.subtaskId}`);
    }

    const entry = await this.engine.store(content, {
      tags,
      source: MemorySource.AGENT_INFERENCE,
      confidence: options.confidence ?? 0.8,
      importance: options.importance ?? 0.7,
      sessionId: this.config.sessionId,
      parentIds: options.parentIds
    });

    // Track by subtask
    if (options.subtaskId) {
      const existing = this.entryLog.get(options.subtaskId) || [];
      existing.push(entry.id);
      this.entryLog.set(options.subtaskId, existing);
    }

    // Track by type for stats
    const count = this.typeCount.get(type) || 0;
    this.typeCount.set(type, count + 1);

    console.log(`[WorkingMemory] Stored ${type}: ${content.substring(0, 80)}...`);

    return entry.id;
  }

  // ===========================================================================
  // STORAGE METHODS
  // ===========================================================================

  /**
   * Store research finding
   */
  async storeResearch(
    finding: string,
    confidence: number,
    subtaskId?: string
  ): Promise<string> {
    return this.store(
      `RESEARCH: ${finding}`,
      'research',
      { confidence, subtaskId, importance: 0.8 }
    );
  }

  /**
   * Store a decision with reasoning and alternatives considered
   */
  async storeDecision(
    decision: string,
    reasoning: string,
    alternatives: string[] = []
  ): Promise<string> {
    const content = [
      `DECISION: ${decision}`,
      `REASONING: ${reasoning}`,
      alternatives.length > 0 ? `ALTERNATIVES: ${alternatives.join(', ')}` : ''
    ].filter(Boolean).join('\n');

    return this.store(content, 'decision', { importance: 0.9 });
  }

  /**
   * Store a finding from analysis or tool output
   */
  async storeFinding(
    finding: string,
    source: string,
    subtaskId?: string
  ): Promise<string> {
    return this.store(
      `[${source}] ${finding}`,
      'finding',
      { subtaskId }
    );
  }

  /**
   * Store a failure with approach and optional root cause
   */
  async storeFailure(
    error: string,
    approach: string,
    rootCause?: string,
    subtaskId?: string
  ): Promise<string> {
    const content = [
      `FAILURE: ${error}`,
      `APPROACH: ${approach}`,
      rootCause ? `ROOT CAUSE: ${rootCause}` : ''
    ].filter(Boolean).join('\n');

    return this.store(
      content,
      'failure',
      { confidence: 0.95, importance: 0.95, subtaskId }
    );
  }

  /**
   * Store selected approach with reasoning
   */
  async storeApproach(
    approach: string,
    reasoning: string,
    subtaskId?: string
  ): Promise<string> {
    return this.store(
      `APPROACH: ${approach}\nWHY: ${reasoning}`,
      'approach',
      { subtaskId, importance: 0.8 }
    );
  }

  /**
   * Store context/state information
   */
  async storeContext(
    context: string,
    subtaskId?: string
  ): Promise<string> {
    return this.store(
      context,
      'context',
      { subtaskId, importance: 0.6 }
    );
  }

  /**
   * Store code generation result
   */
  async storeCodeGeneration(
    filesModified: string[],
    approach: string,
    summary: string,
    subtaskId?: string,
    parentId?: string
  ): Promise<string> {
    const content = [
      `CODE GENERATED: ${filesModified.length} files`,
      `FILES: ${filesModified.join(', ')}`,
      `APPROACH: ${approach}`,
      `SUMMARY: ${summary.substring(0, 500)}`
    ].join('\n');

    return this.store(
      content,
      'code-generation',
      {
        subtaskId,
        importance: 0.85,
        parentIds: parentId ? [parentId] : undefined
      }
    );
  }

  // ===========================================================================
  // QUERY METHODS
  // ===========================================================================

  /**
   * Get relevant context for current work
   */
  async getRelevantContext(
    query: string,
    limit: number = 10
  ): Promise<MemoryResult[]> {
    const results = await this.engine.query(query, {
      topK: limit,
      filters: {
        sessionId: this.config.sessionId,
        minImportance: 0.5
      },
      includeProvenance: true
    });

    console.log(`[WorkingMemory] Query "${query.substring(0, 40)}..." returned ${results.length} results`);

    return results.map(r => ({
      id: r.entry.id,
      content: r.entry.content,
      score: r.score
    }));
  }

  /**
   * Get failures for a specific subtask
   */
  async getFailuresForSubtask(subtaskId: string): Promise<MemoryResult[]> {
    const results = await this.engine.query('failure', {
      topK: 10,
      filters: {
        sessionId: this.config.sessionId,
        tags: ['failure']
      }
    });

    // Filter to entries tracked for this subtask
    const subtaskEntries = this.entryLog.get(subtaskId) || [];

    const filtered = results
      .filter(r => subtaskEntries.includes(r.entry.id))
      .map(r => ({ id: r.entry.id, content: r.entry.content }));

    console.log(`[WorkingMemory] Found ${filtered.length} failures for subtask ${subtaskId}`);

    return filtered;
  }

  /**
   * Get all failures in current session
   */
  async getAllFailures(): Promise<MemoryResult[]> {
    const results = await this.engine.query('failure', {
      topK: 20,
      filters: {
        sessionId: this.config.sessionId,
        tags: ['failure']
      }
    });

    return results.map(r => ({
      id: r.entry.id,
      content: r.entry.content,
      score: r.score
    }));
  }

  /**
   * Get the chain of decisions made in this session
   */
  async getDecisionChain(): Promise<MemoryResult[]> {
    const results = await this.engine.query('decision', {
      topK: 50,
      filters: {
        sessionId: this.config.sessionId,
        tags: ['decision']
      }
    });

    return results.map(r => ({
      id: r.entry.id,
      content: r.entry.content
    }));
  }

  /**
   * Find similar successful approaches from past sessions
   * (Cross-session learning with codebase verification)
   */
  async findSimilarApproaches(description: string): Promise<MemoryResult[]> {
    // Query across ALL sessions for successful approaches
    const results = await this.engine.query(
      `successful approach: ${description}`,
      {
        topK: 10,  // Get more to filter
        filters: {
          tags: ['codex', 'approach'],
          minImportance: 0.7
        }
      }
    );

    // Verify codebase - check if entries are from the same codebase
    const currentCodebase = this.config.codebase.toLowerCase();
    const verified: MemoryResult[] = [];
    const suspicious: MemoryResult[] = [];

    for (const r of results) {
      const entry = r.entry;
      const content = entry.content.toLowerCase();

      // Check if content references a different codebase path
      const hasOtherCodebase = this.detectCodebaseMismatch(content, currentCodebase);

      if (hasOtherCodebase) {
        suspicious.push({
          id: entry.id,
          content: entry.content,
          score: r.score
        });
      } else {
        verified.push({
          id: entry.id,
          content: entry.content,
          score: r.score
        });
      }
    }

    // Log warnings if suspicious entries found
    if (suspicious.length > 0) {
      console.log(`[WorkingMemory] ⚠️  Found ${suspicious.length} entries from different codebases - EXCLUDED`);
      for (const s of suspicious) {
        console.log(`[WorkingMemory]    - ${s.content.substring(0, 60)}...`);
      }
    }

    console.log(`[WorkingMemory] Found ${verified.length} verified similar approaches (same codebase)`);

    return verified.slice(0, 5);  // Return top 5 verified
  }

  /**
   * Detect if content references a different codebase
   */
  private detectCodebaseMismatch(content: string, currentCodebase: string): boolean {
    // Common codebase path patterns to check
    const pathPatterns = [
      /d:\\[a-z0-9_-]+\\/gi,           // Windows paths like D:\something\
      /\/[a-z0-9_-]+\/[a-z0-9_-]+\//gi, // Unix paths like /home/user/
      /codebase:\s*([^\s\n]+)/gi,      // Explicit codebase: tags
      /project:\s*([^\s\n]+)/gi        // Project: references
    ];

    for (const pattern of pathPatterns) {
      const matches = content.match(pattern);
      if (matches) {
        for (const match of matches) {
          const normalizedMatch = match.toLowerCase().replace(/\\/g, '/');
          const normalizedCurrent = currentCodebase.toLowerCase().replace(/\\/g, '/');

          // If we find a path that doesn't match our codebase, it's suspicious
          if (!normalizedCurrent.includes(normalizedMatch.replace(/[:/]/g, '')) &&
              !normalizedMatch.includes(normalizedCurrent.split('/').pop() || '')) {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Find contradictory evidence for a claim
   * Uses shadow search to find opposing viewpoints
   */
  async getContradictions(claim: string): Promise<ContradictionResult[]> {
    try {
      const results = await this.engine.shadowQuery(claim, {
        topK: 5,
        tags: [`task:${this.config.sessionId}`]
      });

      return results.contradictions.map(c => ({
        content: c.entry.content,
        strength: c.refutationStrength
      }));
    } catch {
      // Shadow search may not be available
      return [];
    }
  }

  /**
   * Get all context accumulated so far in the session
   */
  async getSessionContext(): Promise<MemoryResult[]> {
    const results = await this.engine.query('context findings decisions', {
      topK: 30,
      filters: {
        sessionId: this.config.sessionId
      }
    });

    return results.map(r => ({
      id: r.entry.id,
      content: r.entry.content,
      score: r.score
    }));
  }

  // ===========================================================================
  // CAUSAL METHODS
  // ===========================================================================

  /**
   * Link two entries with a causal relationship
   */
  async linkCause(
    sourceId: string,
    targetId: string,
    type: 'enables' | 'prevents' | 'causes' | 'triggers'
  ): Promise<void> {
    const relationType = {
      enables: CausalRelationType.ENABLES,
      prevents: CausalRelationType.PREVENTS,
      causes: CausalRelationType.CAUSES,
      triggers: CausalRelationType.TRIGGERS
    }[type];

    this.engine.addCausalRelation([sourceId], [targetId], relationType, 0.9);
    console.log(`[WorkingMemory] Linked ${type}: ${sourceId} → ${targetId}`);
  }

  /**
   * Find what caused a particular entry
   */
  async getWhatCausedThis(entryId: string): Promise<MemoryResult[]> {
    const causeIds = this.engine.findCauses(entryId, 3);
    const results: MemoryResult[] = [];

    for (const id of causeIds) {
      const entry = await this.engine.getEntry(id);
      if (entry) {
        results.push({ id, content: entry.content });
      }
    }

    return results;
  }

  /**
   * Find what effects an entry has
   */
  async getWhatThisCauses(entryId: string): Promise<MemoryResult[]> {
    const effectIds = this.engine.findEffects(entryId, 3);
    const results: MemoryResult[] = [];

    for (const id of effectIds) {
      const entry = await this.engine.getEntry(id);
      if (entry) {
        results.push({ id, content: entry.content });
      }
    }

    return results;
  }

  // ===========================================================================
  // SESSION METHODS
  // ===========================================================================

  /**
   * Get statistics for current session
   */
  getSessionStats(): SessionStats {
    return {
      entries: Array.from(this.entryLog.values()).flat().length,
      decisions: this.typeCount.get('decision') || 0,
      failures: this.typeCount.get('failure') || 0,
      approaches: this.typeCount.get('approach') || 0,
      findings: this.typeCount.get('finding') || 0
    };
  }

  /**
   * Generate a summary of the session
   */
  async summarizeSession(): Promise<string> {
    const decisions = await this.getDecisionChain();
    const stats = this.getSessionStats();

    const summary = [
      '═══════════════════════════════════════════════════════════',
      'TASK SESSION SUMMARY',
      '═══════════════════════════════════════════════════════════',
      `Task: ${this.config.taskDescription}`,
      `Codebase: ${this.config.codebase}`,
      `Session ID: ${this.config.sessionId}`,
      '',
      'STATISTICS:',
      `  Total Entries: ${stats.entries}`,
      `  Decisions: ${stats.decisions}`,
      `  Approaches: ${stats.approaches}`,
      `  Findings: ${stats.findings}`,
      `  Failures: ${stats.failures}`,
      '',
      'DECISION TRAIL:',
      ...decisions.slice(0, 10).map((d, i) =>
        `  ${i + 1}. ${d.content.split('\n')[0].replace('DECISION: ', '')}`
      ),
      decisions.length > 10 ? `  ... and ${decisions.length - 10} more decisions` : '',
      '═══════════════════════════════════════════════════════════'
    ].filter(Boolean).join('\n');

    console.log(`[WorkingMemory] Session summary generated (${stats.entries} entries)`);

    return summary;
  }

  /**
   * Store final session summary for future reference
   */
  async storeSessionSummary(success: boolean): Promise<string> {
    const summary = await this.summarizeSession();

    const entry = await this.engine.store(summary, {
      tags: [
        'codex',
        'task-complete',
        'session-summary',
        success ? 'success' : 'failure'
      ],
      source: MemorySource.AGENT_INFERENCE,
      importance: 0.9,
      confidence: 0.95
    });

    console.log(`[WorkingMemory] Session summary stored: ${entry.id}`);

    return entry.id;
  }

  /**
   * Format accumulated context for injection into prompts
   */
  formatContextForPrompt(
    context: MemoryResult[],
    failures: MemoryResult[] = []
  ): string {
    const parts: string[] = [];

    if (context.length > 0) {
      parts.push('=== RELEVANT CONTEXT FROM THIS TASK ===');
      for (const c of context.slice(0, 5)) {
        parts.push(`• ${c.content.split('\n')[0]}`);
      }
    }

    if (failures.length > 0) {
      parts.push('');
      parts.push('=== PREVIOUS FAILURES TO AVOID ===');
      for (const f of failures) {
        parts.push(`• ${f.content.split('\n')[0]}`);
      }
    }

    return parts.join('\n');
  }
}

export default WorkingMemoryManager;
