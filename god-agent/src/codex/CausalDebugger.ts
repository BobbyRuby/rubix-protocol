/**
 * CausalDebugger
 *
 * Tracks failure chains using god-agent's causal links.
 * Connects: failure → root cause → attempted fix → outcome
 * Helps RUBIX understand WHY things failed, not just WHAT failed.
 */

import type { MemoryEngine } from '../core/MemoryEngine.js';
import type { CausalMemory } from '../causal/CausalMemory.js';
import { CausalRelationType } from '../core/types.js';
import type {
  Subtask,
  SubtaskAttempt,
  CodexTask,
  SimilarFailure
} from './types.js';

/**
 * A node in the failure chain
 */
export interface FailureNode {
  id: string;
  type: 'failure' | 'cause' | 'fix' | 'outcome';
  description: string;
  timestamp: Date;
  metadata: Record<string, unknown>;
}

/**
 * A causal chain from failure to resolution
 */
export interface CausalChain {
  id: string;
  taskId: string;
  subtaskId: string;
  nodes: FailureNode[];
  relationships: Array<{
    from: string;
    to: string;
    type: 'causes' | 'enables' | 'prevents' | 'triggers';
    strength: number;
  }>;
  resolved: boolean;
  resolution?: string;
}

/**
 * Debug insight generated from causal analysis
 */
export interface DebugInsight {
  category: 'pattern' | 'root_cause' | 'prevention' | 'similar_fix';
  confidence: number;
  description: string;
  evidence: string[];
  suggestedAction?: string;
}

/**
 * CausalDebugger - Track and analyze failure chains
 */
export class CausalDebugger {
  private engine: MemoryEngine;
  private causal: CausalMemory | undefined;
  private activeChains: Map<string, CausalChain> = new Map();

  constructor(engine: MemoryEngine, causal?: CausalMemory) {
    this.engine = engine;
    this.causal = causal;
  }

  /**
   * Set causal memory (for late binding)
   */
  setCausalMemory(causal: CausalMemory): void {
    this.causal = causal;
  }

  /**
   * Start tracking a new failure chain
   */
  async startChain(
    task: CodexTask,
    subtask: Subtask,
    attempt: SubtaskAttempt
  ): Promise<CausalChain> {
    const chainId = `chain_${Date.now()}_${subtask.id.slice(0, 8)}`;

    // Create the initial failure node
    const failureNode: FailureNode = {
      id: `failure_${chainId}`,
      type: 'failure',
      description: attempt.error || 'Unknown error',
      timestamp: new Date(),
      metadata: {
        taskId: task.id,
        subtaskId: subtask.id,
        subtaskType: subtask.type,
        approach: attempt.approach,
        attemptNumber: attempt.attemptNumber,
        consoleErrors: attempt.consoleErrors || []
      }
    };

    const chain: CausalChain = {
      id: chainId,
      taskId: task.id,
      subtaskId: subtask.id,
      nodes: [failureNode],
      relationships: [],
      resolved: false
    };

    this.activeChains.set(chainId, chain);

    // Store in memory for persistence
    await this.storeChainEvent(chain, 'started');

    // Try to identify initial cause
    await this.identifyRootCause(chain, attempt);

    return chain;
  }

  /**
   * Add a fix attempt to the chain
   */
  async addFixAttempt(
    chainId: string,
    approach: string,
    description: string
  ): Promise<void> {
    const chain = this.activeChains.get(chainId);
    if (!chain) return;

    const fixNode: FailureNode = {
      id: `fix_${Date.now()}`,
      type: 'fix',
      description: `Fix attempt: ${approach} - ${description}`,
      timestamp: new Date(),
      metadata: { approach }
    };

    chain.nodes.push(fixNode);

    // Link fix to the most recent failure or cause
    const lastNode = this.findLastRelevantNode(chain);
    if (lastNode) {
      chain.relationships.push({
        from: lastNode.id,
        to: fixNode.id,
        type: 'triggers',
        strength: 0.8
      });

      // Create causal link in god-agent if available
      this.createCausalLink(lastNode.id, fixNode.id, 'triggers');
    }
  }

  /**
   * Record the outcome of a fix attempt
   */
  async recordOutcome(
    chainId: string,
    success: boolean,
    description: string
  ): Promise<void> {
    const chain = this.activeChains.get(chainId);
    if (!chain) return;

    const outcomeNode: FailureNode = {
      id: `outcome_${Date.now()}`,
      type: 'outcome',
      description,
      timestamp: new Date(),
      metadata: { success }
    };

    chain.nodes.push(outcomeNode);

    // Link outcome to the last fix
    const lastFix = chain.nodes
      .filter(n => n.type === 'fix')
      .pop();

    if (lastFix) {
      chain.relationships.push({
        from: lastFix.id,
        to: outcomeNode.id,
        type: success ? 'enables' : 'prevents',
        strength: success ? 0.9 : 0.7
      });

      this.createCausalLink(
        lastFix.id,
        outcomeNode.id,
        success ? 'enables' : 'prevents'
      );
    }

    if (success) {
      chain.resolved = true;
      chain.resolution = description;
      await this.storeChainEvent(chain, 'resolved');
      await this.learnFromResolution(chain);
    }
  }

  /**
   * Get insights for debugging a failure
   */
  async getInsights(
    subtask: Subtask,
    error: string,
    previousAttempts: SubtaskAttempt[]
  ): Promise<DebugInsight[]> {
    const insights: DebugInsight[] = [];

    // 1. Look for similar failure patterns
    const similarFailures = await this.findSimilarFailures(
      subtask.description,
      error
    );

    for (const failure of similarFailures) {
      if (failure.resolution) {
        insights.push({
          category: 'similar_fix',
          confidence: failure.similarity,
          description: `Similar failure was resolved with: ${failure.resolution}`,
          evidence: [failure.error],
          suggestedAction: failure.resolution
        });
      }
    }

    // 2. Analyze error pattern for root cause
    const rootCause = this.analyzeRootCause(error, previousAttempts);
    if (rootCause) {
      insights.push(rootCause);
    }

    // 3. Look for prevention patterns
    const preventionInsights = await this.findPreventionPatterns(
      subtask.type,
      error
    );
    insights.push(...preventionInsights);

    // 4. Check for repeating patterns across attempts
    const repeatPattern = this.detectRepeatPattern(previousAttempts);
    if (repeatPattern) {
      insights.push(repeatPattern);
    }

    // Sort by confidence
    insights.sort((a, b) => b.confidence - a.confidence);

    return insights;
  }

  /**
   * Get the full causal chain for a subtask
   */
  getChainForSubtask(subtaskId: string): CausalChain | undefined {
    for (const chain of this.activeChains.values()) {
      if (chain.subtaskId === subtaskId) {
        return chain;
      }
    }
    return undefined;
  }

  /**
   * Close a chain without resolution (escalated or abandoned)
   */
  async closeChain(chainId: string, reason: string): Promise<void> {
    const chain = this.activeChains.get(chainId);
    if (!chain) return;

    chain.resolution = `Closed: ${reason}`;
    await this.storeChainEvent(chain, 'closed');
    this.activeChains.delete(chainId);
  }

  /**
   * Identify root cause from error and context
   */
  private async identifyRootCause(
    chain: CausalChain,
    attempt: SubtaskAttempt
  ): Promise<void> {
    const error = attempt.error?.toLowerCase() || '';
    const consoleErrors = (attempt.consoleErrors || []).join('\n').toLowerCase();
    const allErrors = `${error}\n${consoleErrors}`;

    // Pattern matching for common root causes
    let causeDescription: string | undefined;

    if (allErrors.includes('undefined') || allErrors.includes('null') ||
        allErrors.includes('cannot read property')) {
      causeDescription = 'Null/undefined reference - data not properly initialized or missing null checks';
    } else if (allErrors.includes('type') && (allErrors.includes('mismatch') ||
               allErrors.includes('not assignable') || allErrors.includes('ts2'))) {
      causeDescription = 'Type mismatch - interface or type definition does not match usage';
    } else if (allErrors.includes('import') || allErrors.includes('module') ||
               allErrors.includes('cannot find')) {
      causeDescription = 'Module resolution - missing import, wrong path, or missing dependency';
    } else if (allErrors.includes('syntax') || allErrors.includes('unexpected token')) {
      causeDescription = 'Syntax error - malformed code, missing brackets or quotes';
    } else if (allErrors.includes('timeout')) {
      causeDescription = 'Operation timeout - slow process or infinite loop';
    } else if (allErrors.includes('connection') || allErrors.includes('network') ||
               allErrors.includes('econnrefused')) {
      causeDescription = 'Connection failure - service unavailable or network issue';
    }

    if (causeDescription) {
      const causeNode: FailureNode = {
        id: `cause_${Date.now()}`,
        type: 'cause',
        description: causeDescription,
        timestamp: new Date(),
        metadata: {
          identifiedFrom: 'pattern_matching',
          errorSnippet: error.slice(0, 200)
        }
      };

      chain.nodes.push(causeNode);

      // Link failure to cause
      const failureNode = chain.nodes.find(n => n.type === 'failure');
      if (failureNode) {
        chain.relationships.push({
          from: failureNode.id,
          to: causeNode.id,
          type: 'causes',
          strength: 0.7
        });

        this.createCausalLink(failureNode.id, causeNode.id, 'causes');
      }
    }
  }

  /**
   * Find similar failures from memory
   */
  private async findSimilarFailures(
    description: string,
    error: string
  ): Promise<SimilarFailure[]> {
    try {
      const results = await this.engine.query(
        `failure chain: ${error} task: ${description}`,
        {
          topK: 5,
          filters: {
            tags: ['codex', 'causal', 'failure'],
            minImportance: 0.5
          }
        }
      );

      return results.map(r => ({
        id: r.entry.id,
        description: r.entry.content.slice(0, 200),
        error: this.extractField(r.entry.content, 'Error') || 'Unknown error',
        resolution: this.extractField(r.entry.content, 'Resolution'),
        similarity: r.score
      }));
    } catch {
      return [];
    }
  }

  /**
   * Analyze error for root cause insight
   */
  private analyzeRootCause(
    error: string,
    previousAttempts: SubtaskAttempt[]
  ): DebugInsight | undefined {
    const errorLower = error.toLowerCase();
    const evidence: string[] = [error];

    // Check if previous attempts had same root cause
    for (const attempt of previousAttempts) {
      if (attempt.error) {
        evidence.push(attempt.error);
      }
    }

    // Common root cause patterns
    if (errorLower.includes('undefined') && previousAttempts.length > 1) {
      return {
        category: 'root_cause',
        confidence: 0.8,
        description: 'Persistent undefined error suggests missing data initialization or async timing issue',
        evidence,
        suggestedAction: 'Add initialization checks and verify async operations complete before data access'
      };
    }

    if (errorLower.includes('type') && previousAttempts.length > 1) {
      return {
        category: 'root_cause',
        confidence: 0.75,
        description: 'Recurring type errors suggest fundamental interface mismatch',
        evidence,
        suggestedAction: 'Review and align type definitions with actual data structures'
      };
    }

    return undefined;
  }

  /**
   * Find prevention patterns from past successes
   */
  private async findPreventionPatterns(
    subtaskType: string,
    error: string
  ): Promise<DebugInsight[]> {
    const insights: DebugInsight[] = [];

    try {
      const results = await this.engine.query(
        `prevention pattern for ${subtaskType} avoiding ${error}`,
        {
          topK: 3,
          filters: {
            tags: ['codex', 'prevention', 'success'],
            minImportance: 0.6
          }
        }
      );

      for (const result of results) {
        const pattern = this.extractField(result.entry.content, 'Pattern');
        if (pattern) {
          insights.push({
            category: 'prevention',
            confidence: result.score * 0.8,
            description: `Prevention pattern: ${pattern}`,
            evidence: [result.entry.content.slice(0, 150)],
            suggestedAction: this.extractField(result.entry.content, 'Action')
          });
        }
      }
    } catch {
      // Return empty on error
    }

    return insights;
  }

  /**
   * Detect repeating patterns in attempts
   */
  private detectRepeatPattern(attempts: SubtaskAttempt[]): DebugInsight | undefined {
    if (attempts.length < 2) return undefined;

    // Check for same error type recurring
    const errorTypes = new Map<string, number>();

    for (const attempt of attempts) {
      const errorType = this.categorizeError(attempt.error || '');
      errorTypes.set(errorType, (errorTypes.get(errorType) || 0) + 1);
    }

    for (const [errorType, count] of errorTypes) {
      if (count >= 2 && errorType !== 'unknown') {
        return {
          category: 'pattern',
          confidence: 0.85,
          description: `Same error type (${errorType}) occurring ${count} times suggests a fundamental issue`,
          evidence: attempts.map(a => a.error || 'no error'),
          suggestedAction: `Stop retrying similar approaches. The ${errorType} error needs a different strategy.`
        };
      }
    }

    return undefined;
  }

  /**
   * Store chain event in memory
   */
  private async storeChainEvent(
    chain: CausalChain,
    event: 'started' | 'resolved' | 'closed'
  ): Promise<void> {
    try {
      const nodes = chain.nodes.map(n => `${n.type}: ${n.description}`).join('\n');
      const content = `Causal Chain ${event}:
Task: ${chain.taskId}
Subtask: ${chain.subtaskId}
Chain ID: ${chain.id}
Nodes:
${nodes}
Resolution: ${chain.resolution || 'pending'}`;

      await this.engine.store(content, {
        tags: ['codex', 'causal', event, chain.resolved ? 'resolved' : 'pending'],
        importance: chain.resolved ? 0.8 : 0.6
      });
    } catch {
      // Ignore storage errors
    }
  }

  /**
   * Learn from a successful resolution
   */
  private async learnFromResolution(chain: CausalChain): Promise<void> {
    if (!chain.resolved) return;

    // Extract the fix that worked
    const fixes = chain.nodes.filter(n => n.type === 'fix');
    const successfulFix = fixes[fixes.length - 1];
    const failure = chain.nodes.find(n => n.type === 'failure');
    const cause = chain.nodes.find(n => n.type === 'cause');

    if (!failure || !successfulFix) return;

    try {
      const content = `Resolution Pattern:
Error: ${failure.description}
Root Cause: ${cause?.description || 'Unknown'}
Fix: ${successfulFix.description}
Resolution: ${chain.resolution}
Pattern: ${(successfulFix.metadata.approach as string) || 'general'}
Action: Apply similar fix for ${cause?.description || 'this type of error'}`;

      await this.engine.store(content, {
        tags: ['codex', 'prevention', 'success', 'learned'],
        importance: 0.85
      });

      // Create causal link for future reference
      if (cause && this.causal) {
        this.createCausalLink(
          cause.id,
          successfulFix.id,
          'enables',
          0.9
        );
      }
    } catch {
      // Ignore storage errors
    }
  }

  /**
   * Create causal link in god-agent
   */
  private createCausalLink(
    fromId: string,
    toId: string,
    type: 'causes' | 'enables' | 'prevents' | 'triggers',
    strength: number = 0.7
  ): void {
    if (!this.causal) return;

    try {
      // Map string type to CausalRelationType enum
      const relationType = {
        'causes': CausalRelationType.CAUSES,
        'enables': CausalRelationType.ENABLES,
        'prevents': CausalRelationType.PREVENTS,
        'triggers': CausalRelationType.TRIGGERS
      }[type];

      this.causal.addRelation([fromId], [toId], relationType, strength);
    } catch {
      // Ignore causal errors
    }
  }

  /**
   * Find last relevant node in chain
   */
  private findLastRelevantNode(chain: CausalChain): FailureNode | undefined {
    const relevant = chain.nodes.filter(n =>
      n.type === 'failure' || n.type === 'cause'
    );
    return relevant[relevant.length - 1];
  }

  /**
   * Extract field from content
   */
  private extractField(content: string, field: string): string | undefined {
    const regex = new RegExp(`${field}: ([^\\n]+)`);
    const match = content.match(regex);
    return match ? match[1] : undefined;
  }

  /**
   * Categorize error type
   */
  private categorizeError(error: string): string {
    const errorLower = error.toLowerCase();

    if (errorLower.includes('type') || errorLower.includes('ts2')) return 'type';
    if (errorLower.includes('undefined') || errorLower.includes('null')) return 'null_reference';
    if (errorLower.includes('syntax')) return 'syntax';
    if (errorLower.includes('import') || errorLower.includes('module')) return 'module';
    if (errorLower.includes('test') || errorLower.includes('assert')) return 'test';
    if (errorLower.includes('timeout')) return 'timeout';
    if (errorLower.includes('connection') || errorLower.includes('network')) return 'network';

    return 'unknown';
  }

  /**
   * Get statistics about tracked chains
   */
  getStats(): {
    activeChains: number;
    resolvedCount: number;
    avgNodesPerChain: number;
  } {
    let resolvedCount = 0;
    let totalNodes = 0;

    for (const chain of this.activeChains.values()) {
      if (chain.resolved) resolvedCount++;
      totalNodes += chain.nodes.length;
    }

    return {
      activeChains: this.activeChains.size,
      resolvedCount,
      avgNodesPerChain: this.activeChains.size > 0
        ? totalNodes / this.activeChains.size
        : 0
    };
  }
}

export default CausalDebugger;
