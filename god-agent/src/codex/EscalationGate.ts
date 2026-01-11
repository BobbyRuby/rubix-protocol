/**
 * EscalationGate
 *
 * Decides when to escalate to the user vs. continue autonomously.
 * The key to not annoying the user: only escalate when genuinely necessary.
 */

import { randomUUID } from 'crypto';
import type { MemoryEngine } from '../core/MemoryEngine.js';
import {
  type CodexTask,
  type Subtask,
  type Escalation,
  type EscalationDecision,
  type Assumption,
  type DecisionOption,
  type CodexConfig,
  type ChallengeContext,
  DEFAULT_RUBIX_CONFIG
} from './types.js';

/**
 * Situation types that may require escalation
 */
export type SituationType =
  | 'spec_ambiguity'
  | 'decision_needed'
  | 'blocked'
  | 'irreversible_action'
  | 'minor_ambiguity'
  | 'error'
  // Collaborative partner types
  | 'knowledge_gap'      // Agent needs information before proceeding
  | 'challenge_soft'     // Agent disagrees but can proceed with user acknowledgment
  | 'challenge_hard';    // Agent refuses to proceed without explicit override

/**
 * Situation context for escalation decision
 */
export interface Situation {
  type: SituationType;
  description: string;
  task: CodexTask;
  subtask?: Subtask;
  attempts?: number;
  errors?: string[];
  businessImpact?: 'high' | 'medium' | 'low';
  options?: DecisionOption[];
  /** Challenge context for collaborative partner challenges */
  challengeContext?: ChallengeContext;
}

/**
 * EscalationGate - Decide when to ask the human
 */
export class EscalationGate {
  private engine: MemoryEngine;
  private config: CodexConfig;
  private pendingEscalations: Map<string, Escalation> = new Map();

  constructor(engine: MemoryEngine, config: Partial<CodexConfig> = {}) {
    this.engine = engine;
    this.config = { ...DEFAULT_RUBIX_CONFIG, ...config };
  }

  /**
   * Decide whether to escalate a situation
   */
  async shouldEscalate(situation: Situation): Promise<EscalationDecision> {
    // Hard rules - always escalate
    if (this.mustEscalate(situation)) {
      return {
        shouldEscalate: true,
        type: this.getEscalationType(situation),
        reason: this.getEscalationReason(situation),
        canContinueWithAssumption: false
      };
    }

    // Check if we can make a reasonable assumption
    const assumption = await this.tryMakeAssumption(situation);
    if (assumption) {
      return {
        shouldEscalate: false,
        canContinueWithAssumption: true,
        assumption
      };
    }

    // Soft rules - try to handle ourselves
    if (this.canSelfResolve(situation)) {
      return {
        shouldEscalate: false,
        canContinueWithAssumption: false,
        reason: 'Can self-resolve'
      };
    }

    // Default: escalate if uncertain
    return {
      shouldEscalate: true,
      type: this.getEscalationType(situation),
      reason: 'Uncertain, seeking clarification',
      canContinueWithAssumption: false
    };
  }

  /**
   * Check if situation must be escalated (hard rules)
   */
  private mustEscalate(situation: Situation): boolean {
    // Critical spec ambiguity
    if (situation.type === 'spec_ambiguity' && situation.businessImpact === 'high') {
      return true;
    }

    // Blocked after max attempts
    if (situation.type === 'blocked' && situation.attempts !== undefined) {
      if (situation.attempts >= this.config.maxAttemptsBeforeEscalate) {
        return true;
      }
    }

    // Irreversible actions
    if (situation.type === 'irreversible_action') {
      return true;
    }

    // Decision required for items in requireApproval list
    if (situation.type === 'decision_needed') {
      const requiresApproval = this.config.requireApproval.some(
        item => situation.description.toLowerCase().includes(item.replace(/_/g, ' '))
      );
      if (requiresApproval) {
        return true;
      }
    }

    // === COLLABORATIVE PARTNER TYPES ===

    // Hard challenge - agent strongly disagrees, requires explicit override
    if (situation.type === 'challenge_hard') {
      return true;
    }

    // Critical knowledge gap - agent needs information to proceed safely
    if (situation.type === 'knowledge_gap' && situation.businessImpact === 'high') {
      return true;
    }

    return false;
  }

  /**
   * Check if situation can be self-resolved
   */
  private canSelfResolve(situation: Situation): boolean {
    // Minor ambiguities can be resolved with assumptions
    if (situation.type === 'minor_ambiguity') {
      return true;
    }

    // Errors with fewer than max attempts
    if (situation.type === 'error' && situation.attempts !== undefined) {
      if (situation.attempts < this.config.maxAttemptsBeforeEscalate) {
        return true;
      }
    }

    // Decisions in autonomous list
    if (situation.type === 'decision_needed') {
      const isAutonomous = this.config.autonomousDecisions.some(
        item => situation.description.toLowerCase().includes(item.replace(/_/g, ' '))
      );
      if (isAutonomous) {
        return true;
      }
    }

    // === COLLABORATIVE PARTNER TYPES ===

    // Soft challenge - agent has concerns but can proceed
    // (will log concerns and continue, but doesn't block)
    if (situation.type === 'challenge_soft') {
      // Log the challenge but allow self-resolution
      console.log(`[EscalationGate] Soft challenge logged: ${situation.description}`);
      if (situation.challengeContext) {
        console.log(`[EscalationGate] Credibility: ${situation.challengeContext.credibility.toFixed(2)}, L-Score: ${situation.challengeContext.lScore.toFixed(2)}`);
        console.log(`[EscalationGate] Recommendation: ${situation.challengeContext.recommendation}`);
      }
      return true;
    }

    // Non-critical knowledge gaps - can proceed with assumptions
    if (situation.type === 'knowledge_gap' && situation.businessImpact !== 'high') {
      return true;
    }

    return false;
  }

  /**
   * Try to make a reasonable assumption
   */
  private async tryMakeAssumption(situation: Situation): Promise<Assumption | undefined> {
    // Don't make assumptions for high-impact decisions
    if (situation.businessImpact === 'high') {
      return undefined;
    }

    // Query memory for similar past decisions
    const similarDecisions = await this.findSimilarDecisions(situation);

    if (similarDecisions.length > 0) {
      // Use the most common previous decision
      const assumption: Assumption = {
        id: randomUUID(),
        taskId: situation.task.id,
        description: `Assuming same approach as similar past decision: ${similarDecisions[0]}`,
        reasoning: `Based on ${similarDecisions.length} similar past decisions`,
        madeAt: new Date()
      };

      return assumption;
    }

    // For minor decisions, make a default assumption
    if (situation.type === 'minor_ambiguity' || this.canSelfResolve(situation)) {
      return this.createDefaultAssumption(situation);
    }

    return undefined;
  }

  /**
   * Find similar past decisions from memory
   */
  private async findSimilarDecisions(situation: Situation): Promise<string[]> {
    try {
      const results = await this.engine.query(
        `decision: ${situation.description}`,
        {
          topK: 3,
          filters: {
            tags: ['codex', 'decision'],
            minImportance: 0.6
          }
        }
      );

      return results.map(r => r.entry.content);
    } catch {
      return [];
    }
  }

  /**
   * Create a default assumption for a situation
   */
  private createDefaultAssumption(situation: Situation): Assumption {
    let description: string;
    let reasoning: string;

    switch (situation.type) {
      case 'minor_ambiguity':
        description = `Using standard approach for: ${situation.description}`;
        reasoning = 'Common pattern in similar situations';
        break;

      case 'decision_needed':
        description = `Choosing default option for: ${situation.description}`;
        reasoning = 'Selected most common/safe option';
        break;

      default:
        description = `Proceeding with standard approach: ${situation.description}`;
        reasoning = 'No blocking issues identified';
    }

    return {
      id: randomUUID(),
      taskId: situation.task.id,
      description,
      reasoning,
      madeAt: new Date()
    };
  }

  /**
   * Get escalation type for situation
   */
  private getEscalationType(situation: Situation): Escalation['type'] {
    switch (situation.type) {
      case 'spec_ambiguity':
      case 'minor_ambiguity':
        return 'clarification';
      case 'decision_needed':
        return 'decision';
      case 'blocked':
      case 'error':
        return 'blocked';
      case 'irreversible_action':
        return 'approval';
      default:
        return 'clarification';
    }
  }

  /**
   * Get reason for escalation
   */
  private getEscalationReason(situation: Situation): string {
    switch (situation.type) {
      case 'spec_ambiguity':
        return 'Specification has multiple valid interpretations';
      case 'decision_needed':
        return 'Decision requires business context';
      case 'blocked':
        return `Exhausted ${situation.attempts} attempts, need help`;
      case 'irreversible_action':
        return 'Action is irreversible, needs approval';
      case 'error':
        return 'Persistent error needs investigation';
      default:
        return 'Clarification needed';
    }
  }

  /**
   * Create an escalation
   */
  createEscalation(
    situation: Situation,
    decision: EscalationDecision
  ): Escalation {
    const escalation: Escalation = {
      id: randomUUID(),
      taskId: situation.task.id,
      subtaskId: situation.subtask?.id,
      type: decision.type || 'clarification',
      title: this.getEscalationTitle(situation),
      context: situation.description,
      blocking: this.isBlockingEscalation(situation),
      createdAt: new Date()
    };

    // Add questions for clarification
    if (escalation.type === 'clarification' && situation.type === 'spec_ambiguity') {
      escalation.questions = [situation.description];
    }

    // Add options for decisions
    if (escalation.type === 'decision' && situation.options) {
      escalation.options = situation.options;
    }

    // Add error context for blocked escalations
    if (escalation.type === 'blocked' && situation.errors) {
      escalation.errors = situation.errors;
      escalation.attemptsSummary = `Tried ${situation.attempts} approaches`;
    }

    this.pendingEscalations.set(escalation.id, escalation);

    return escalation;
  }

  /**
   * Get title for escalation
   */
  private getEscalationTitle(situation: Situation): string {
    switch (situation.type) {
      case 'spec_ambiguity':
        return 'RUBIX needs clarification';
      case 'decision_needed':
        return 'RUBIX needs a decision';
      case 'blocked':
        return 'RUBIX is stuck';
      case 'irreversible_action':
        return 'RUBIX needs approval';
      default:
        return 'RUBIX needs help';
    }
  }

  /**
   * Check if escalation is blocking
   */
  private isBlockingEscalation(situation: Situation): boolean {
    return situation.type === 'blocked' ||
           situation.type === 'irreversible_action' ||
           situation.businessImpact === 'high';
  }

  /**
   * Resolve an escalation
   */
  resolveEscalation(escalationId: string, resolution: string): Escalation | undefined {
    const escalation = this.pendingEscalations.get(escalationId);
    if (!escalation) {
      return undefined;
    }

    escalation.resolvedAt = new Date();
    escalation.resolution = resolution;

    this.pendingEscalations.delete(escalationId);

    // Store the resolution for future learning
    this.storeResolution(escalation).catch(() => {});

    return escalation;
  }

  /**
   * Store escalation resolution for learning
   */
  private async storeResolution(escalation: Escalation): Promise<void> {
    try {
      const content = `Escalation Resolution:
Type: ${escalation.type}
Context: ${escalation.context}
Resolution: ${escalation.resolution}
Duration: ${escalation.resolvedAt!.getTime() - escalation.createdAt.getTime()}ms`;

      await this.engine.store(content, {
        tags: ['codex', 'escalation', 'resolution', escalation.type],
        importance: 0.7
      });
    } catch {
      // Ignore storage errors
    }
  }

  /**
   * Get pending escalations for a task
   */
  getPendingEscalations(taskId: string): Escalation[] {
    return Array.from(this.pendingEscalations.values())
      .filter(e => e.taskId === taskId);
  }

  /**
   * Get all pending escalations
   */
  getAllPendingEscalations(): Escalation[] {
    return Array.from(this.pendingEscalations.values());
  }

  /**
   * Check if task has blocking escalations
   */
  hasBlockingEscalation(taskId: string): boolean {
    return this.getPendingEscalations(taskId).some(e => e.blocking);
  }

  /**
   * Create batch decisions request (for upfront questioning)
   */
  async createBatchDecisions(
    task: CodexTask,
    ambiguities: Array<{ description: string; critical: boolean; options?: DecisionOption[] }>
  ): Promise<Escalation | undefined> {
    // Only batch if configured
    if (!this.config.batchDecisions) {
      return undefined;
    }

    // Only batch critical decisions
    const criticalAmbiguities = ambiguities.filter(a => a.critical);
    if (criticalAmbiguities.length === 0) {
      return undefined;
    }

    const escalation: Escalation = {
      id: randomUUID(),
      taskId: task.id,
      type: 'clarification',
      title: `RUBIX: ${criticalAmbiguities.length} decision(s) needed before starting`,
      context: 'Before I begin, I need a few decisions:',
      questions: criticalAmbiguities.map(a => a.description),
      options: criticalAmbiguities.flatMap(a => a.options || []),
      blocking: true,
      createdAt: new Date()
    };

    this.pendingEscalations.set(escalation.id, escalation);

    return escalation;
  }

  /**
   * Format escalation for display
   */
  formatEscalation(escalation: Escalation): string {
    const lines: string[] = [];

    lines.push(`**${escalation.title}**`);
    lines.push('');

    if (escalation.subtaskId) {
      lines.push(`Subtask: Working on a specific step`);
    }

    lines.push(`Context: ${escalation.context}`);
    lines.push('');

    if (escalation.questions && escalation.questions.length > 0) {
      lines.push('Questions:');
      escalation.questions.forEach((q, i) => {
        lines.push(`${i + 1}. ${q}`);
      });
      lines.push('');
    }

    if (escalation.options && escalation.options.length > 0) {
      lines.push('Options:');
      escalation.options.forEach((o, i) => {
        lines.push(`${i + 1}. ${o.label} - ${o.description}${o.tradeoff ? ` (${o.tradeoff})` : ''}`);
      });
      lines.push('');
    }

    if (escalation.errors && escalation.errors.length > 0) {
      lines.push('Errors encountered:');
      escalation.errors.slice(0, 3).forEach(e => {
        lines.push(`- ${e}`);
      });
      lines.push('');
    }

    if (escalation.attemptsSummary) {
      lines.push(escalation.attemptsSummary);
    }

    return lines.join('\n');
  }
}

export default EscalationGate;
