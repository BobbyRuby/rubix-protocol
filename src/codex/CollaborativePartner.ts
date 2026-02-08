/**
 * CollaborativePartner
 *
 * Orchestrates existing god-agent components to create collaborative partner behavior:
 * - Proactive Curiosity: Ask questions before executing
 * - Challenge Decisions: Use shadow search to find contradictions
 * - Confidence Gates: L-Score thresholds for warn/block
 * - Hard Gate on High-Risk: Require explicit override
 *
 * This wires together: ShadowSearch, L-Score, TinyDancer, EscalationGate, Sona
 */

import type { MemoryEngine } from '../core/MemoryEngine.js';
import type { CodexTask, Subtask, SubtaskAttempt } from './types.js';
import { ContainmentManager, type ContainmentConfig, type PermissionResult, type ModifyResult, DEFAULT_CONTAINMENT_CONFIG } from './ContainmentManager.js';

/**
 * Threshold configuration for challenge decisions
 */
export interface ChallengeThresholds {
  /** Credibility below this = HARD BLOCK (default: 0.3) */
  credibilityHardGate: number;
  /** Credibility below this = SOFT WARN (default: 0.5) */
  credibilityWarnGate: number;
  /** L-Score below this = HARD BLOCK (default: 0.2) */
  lScoreHardGate: number;
  /** L-Score below this = SOFT WARN (default: 0.5) */
  lScoreWarnGate: number;
}

/**
 * Behavior flags for collaborative partner
 */
export interface PartnerBehaviors {
  /** Ask questions before executing (default: true) */
  proactiveCuriosity: boolean;
  /** Use shadow search to find problems (default: true) */
  challengeDecisions: boolean;
  /** Require override for risky decisions (default: true) */
  hardGateHighRisk: boolean;
}

/**
 * Full collaborative partner configuration
 */
export interface CollaborativePartnerConfig {
  /** Enable collaborative partner features (default: true) */
  enabled: boolean;
  /** Challenge thresholds */
  thresholds: ChallengeThresholds;
  /** Behavior flags */
  behaviors: PartnerBehaviors;
  /** Containment configuration */
  containment: ContainmentConfig;
}

/**
 * Context for approach assessment
 */
export interface AssessmentContext {
  task: CodexTask;
  subtask?: Subtask;
  attempt?: SubtaskAttempt;
  previousAttempts?: SubtaskAttempt[];
  codebaseContext?: string;
}

/**
 * Contradiction found by shadow search
 */
export interface Contradiction {
  /** The contradicting content */
  content: string;
  /** How strongly this contradicts (0-1) */
  refutationStrength: number;
  /** Source of the contradiction */
  source: string;
  /** Entry ID for reference */
  entryId?: string;
}

/**
 * Result of approach assessment
 */
export interface PartnerAssessment {
  /** Whether the partner has concerns */
  shouldChallenge: boolean;
  /** Whether this is a hard gate (requires override) */
  isHardGate: boolean;
  /** Credibility score from shadow search (0-1) */
  credibility: number;
  /** L-Score of the approach (0-1) */
  lScore: number;
  /** Contradictions found */
  contradictions: Contradiction[];
  /** Partner's recommendation */
  recommendation: string;
  /** Reasoning for the assessment */
  reasoning: string;
}

/**
 * Knowledge gap identified before execution
 */
export interface KnowledgeGap {
  /** The question to ask */
  question: string;
  /** Whether this is critical (blocks execution) */
  critical: boolean;
  /** Domain of the gap (task_novelty, terminology, specification, etc.) */
  domain: string;
  /** Additional context */
  context?: string;
}

/**
 * Default configuration
 */
export const DEFAULT_COLLABORATIVE_PARTNER_CONFIG: CollaborativePartnerConfig = {
  enabled: true,
  thresholds: {
    credibilityHardGate: 0.3,
    credibilityWarnGate: 0.5,
    lScoreHardGate: 0.2,
    lScoreWarnGate: 0.5
  },
  behaviors: {
    proactiveCuriosity: true,
    challengeDecisions: true,
    hardGateHighRisk: true
  },
  containment: DEFAULT_CONTAINMENT_CONFIG
};

/**
 * CollaborativePartner - Orchestrates challenge and curiosity behaviors
 */
export class CollaborativePartner {
  private engine: MemoryEngine;
  private config: CollaborativePartnerConfig;
  private containment: ContainmentManager;

  constructor(engine: MemoryEngine, config: Partial<CollaborativePartnerConfig> = {}) {
    this.engine = engine;
    this.config = this.mergeConfig(DEFAULT_COLLABORATIVE_PARTNER_CONFIG, config);
    this.containment = new ContainmentManager(this.config.containment);
  }

  /**
   * Deep merge configuration
   */
  private mergeConfig(
    base: CollaborativePartnerConfig,
    override: Partial<CollaborativePartnerConfig>
  ): CollaborativePartnerConfig {
    return {
      enabled: override.enabled ?? base.enabled,
      thresholds: { ...base.thresholds, ...override.thresholds },
      behaviors: { ...base.behaviors, ...override.behaviors },
      containment: { ...base.containment, ...override.containment }
    };
  }

  /**
   * Assess an approach before execution
   *
   * Uses shadow search to find contradictions and L-Score to assess confidence.
   * Returns whether to challenge and at what level.
   */
  async assessApproach(approach: string, context: AssessmentContext): Promise<PartnerAssessment> {
    if (!this.config.enabled || !this.config.behaviors.challengeDecisions) {
      return {
        shouldChallenge: false,
        isHardGate: false,
        credibility: 1.0,
        lScore: 1.0,
        contradictions: [],
        recommendation: '',
        reasoning: 'Challenge behavior disabled'
      };
    }

    console.log(`[CollaborativePartner] Assessing approach: ${approach.substring(0, 100)}...`);

    // Step 1: Run shadow search to find contradictions
    let credibility = 1.0;
    let contradictions: Contradiction[] = [];

    try {
      const shadowResult = await this.engine.shadowQuery(approach, {
        topK: 5,
        includeProvenance: true,
        threshold: 0.4
      });

      credibility = shadowResult.credibility;
      contradictions = shadowResult.contradictions.map(c => ({
        content: c.entry.content.substring(0, 500),
        refutationStrength: c.refutationStrength,
        source: c.entry.metadata.source,
        entryId: c.entry.id
      }));

      console.log(`[CollaborativePartner] Shadow search: credibility=${credibility.toFixed(3)}, contradictions=${contradictions.length}`);
    } catch (error) {
      console.warn('[CollaborativePartner] Shadow search failed, assuming high credibility:', error);
    }

    // Step 2: Query memory for approach L-Score
    let lScore = 0.5; // Default if no matches

    try {
      const queryText = context.subtask
        ? `approach: ${approach} for ${context.subtask.description}`
        : `approach: ${approach}`;

      const queryResults = await this.engine.query(queryText, {
        topK: 5,
        includeProvenance: true
      });

      if (queryResults.length > 0) {
        // Average L-Score of relevant memories
        lScore = queryResults.reduce((sum, r) => sum + (r.lScore || 1), 0) / queryResults.length;
      }

      console.log(`[CollaborativePartner] Memory query: lScore=${lScore.toFixed(3)}, matches=${queryResults.length}`);
    } catch (error) {
      console.warn('[CollaborativePartner] Memory query failed:', error);
    }

    // Step 3: Determine challenge level
    const { thresholds } = this.config;

    const isHardGate = this.config.behaviors.hardGateHighRisk && (
      credibility < thresholds.credibilityHardGate ||
      lScore < thresholds.lScoreHardGate
    );

    const shouldChallenge = isHardGate || (
      credibility < thresholds.credibilityWarnGate ||
      lScore < thresholds.lScoreWarnGate
    );

    // Step 4: Generate recommendation if challenging
    let recommendation = '';
    let reasoning = '';

    if (shouldChallenge) {
      const reasons: string[] = [];

      if (credibility < thresholds.credibilityHardGate) {
        reasons.push(`Very low credibility (${(credibility * 100).toFixed(0)}%) - strong contradicting evidence exists`);
      } else if (credibility < thresholds.credibilityWarnGate) {
        reasons.push(`Low credibility (${(credibility * 100).toFixed(0)}%) - some contradicting evidence found`);
      }

      if (lScore < thresholds.lScoreHardGate) {
        reasons.push(`Very low confidence (${(lScore * 100).toFixed(0)}%) - unfamiliar approach`);
      } else if (lScore < thresholds.lScoreWarnGate) {
        reasons.push(`Low confidence (${(lScore * 100).toFixed(0)}%) - limited experience with this approach`);
      }

      reasoning = reasons.join('. ');

      if (contradictions.length > 0) {
        recommendation = `Consider alternative: ${contradictions[0].content.substring(0, 200)}...`;
      } else if (lScore < thresholds.lScoreWarnGate) {
        recommendation = 'Consider providing more context or confirming this approach.';
      }
    }

    const assessment: PartnerAssessment = {
      shouldChallenge,
      isHardGate,
      credibility,
      lScore,
      contradictions,
      recommendation,
      reasoning
    };

    console.log(`[CollaborativePartner] Assessment: challenge=${shouldChallenge}, hardGate=${isHardGate}`);

    return assessment;
  }

  /**
   * Identify knowledge gaps before task execution
   *
   * Checks memory for similar tasks and detects potential ambiguities.
   */
  async identifyKnowledgeGaps(task: CodexTask): Promise<KnowledgeGap[]> {
    if (!this.config.enabled || !this.config.behaviors.proactiveCuriosity) {
      return [];
    }

    console.log(`[CollaborativePartner] Identifying knowledge gaps for task: ${task.description.substring(0, 100)}...`);

    const gaps: KnowledgeGap[] = [];

    // Check 1: Task novelty - do we have experience with similar tasks?
    try {
      const similarTasks = await this.engine.query(`task: ${task.description}`, {
        topK: 5,
        includeProvenance: true
      });

      const highConfidenceMatches = similarTasks.filter(r => (r.lScore || 1) > 0.6);

      if (highConfidenceMatches.length === 0) {
        gaps.push({
          question: `I haven't done something exactly like this before. Can you confirm the expected outcome for: "${task.description}"?`,
          critical: false,
          domain: 'task_novelty',
          context: `Found ${similarTasks.length} potentially related memories, but none with high confidence.`
        });
      }
    } catch (error) {
      console.warn('[CollaborativePartner] Failed to check task novelty:', error);
    }

    // Check 2: Missing specification
    if (!task.specification && task.description.length < 100) {
      gaps.push({
        question: 'The task description is brief and no specification was provided. Would you like me to make reasonable assumptions, or should we discuss requirements first?',
        critical: false,
        domain: 'specification'
      });
    }

    // Check 3: Ambiguous terms detection
    const ambiguousTerms = this.detectAmbiguousTerms(task.description);
    for (const term of ambiguousTerms) {
      gaps.push({
        question: `When you say "${term.term}", what specifically do you mean? ${term.clarification}`,
        critical: term.critical,
        domain: 'terminology',
        context: term.context
      });
    }

    // Check 4: Scope ambiguity
    if (this.hasScopeAmbiguity(task.description)) {
      gaps.push({
        question: 'The scope of this task seems broad. Should I focus on a minimal implementation first, or go for a complete solution?',
        critical: false,
        domain: 'scope'
      });
    }

    // Check 5: Technology/approach ambiguity
    const techAmbiguity = this.detectTechAmbiguity(task.description);
    if (techAmbiguity) {
      gaps.push({
        question: techAmbiguity.question,
        critical: false,
        domain: 'technology',
        context: techAmbiguity.context
      });
    }

    console.log(`[CollaborativePartner] Found ${gaps.length} knowledge gaps`);

    return gaps;
  }

  /**
   * Check path permission via containment manager
   */
  checkPathPermission(path: string, operation: 'read' | 'write'): PermissionResult {
    return this.containment.checkPermission(path, operation);
  }

  /**
   * Add task-specific path override
   */
  addTaskOverride(taskId: string, path: string): void {
    this.containment.addTaskOverride(taskId, path);
  }

  /**
   * Check if task has path override
   */
  hasTaskOverride(taskId: string, path: string): boolean {
    return this.containment.hasTaskOverride(taskId, path);
  }

  /**
   * Clear task overrides
   */
  clearTaskOverrides(taskId: string): void {
    this.containment.clearTaskOverrides(taskId);
  }

  /**
   * Get current configuration
   */
  getConfig(): CollaborativePartnerConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   * Returns ModifyResult indicating success/failure
   * Security bounds enforced on sensitive settings
   */
  updateConfig(updates: Partial<CollaborativePartnerConfig>): ModifyResult {
    // Security: Cannot disable partner entirely via MCP
    if (updates.enabled === false) {
      console.log(`[Partner Audit] Blocked attempt to disable partner`);
      return {
        success: false,
        reason: 'Partner cannot be disabled via MCP tools'
      };
    }

    // Security: Cannot disable hard gate behavior via MCP
    if (updates.behaviors?.hardGateHighRisk === false) {
      console.log(`[Partner Audit] Blocked attempt to disable hard gate`);
      return {
        success: false,
        reason: 'Hard gate protection cannot be disabled via MCP tools'
      };
    }

    // Security: Bound threshold changes - hard gates cannot go below minimum
    const MIN_HARD_GATE = 0.1;  // Never allow lower than 10%
    if (updates.thresholds) {
      const credHard = updates.thresholds.credibilityHardGate;
      const lScoreHard = updates.thresholds.lScoreHardGate;

      if (credHard !== undefined && credHard < MIN_HARD_GATE) {
        console.log(`[Partner Audit] Blocked low credibilityHardGate: ${credHard}`);
        return {
          success: false,
          reason: `Credibility hard gate cannot be below ${MIN_HARD_GATE} (${MIN_HARD_GATE * 100}%)`
        };
      }

      if (lScoreHard !== undefined && lScoreHard < MIN_HARD_GATE) {
        console.log(`[Partner Audit] Blocked low lScoreHardGate: ${lScoreHard}`);
        return {
          success: false,
          reason: `L-Score hard gate cannot be below ${MIN_HARD_GATE} (${MIN_HARD_GATE * 100}%)`
        };
      }
    }

    // Apply valid updates
    this.config = this.mergeConfig(this.config, updates);

    // Forward containment updates (will enforce its own security)
    if (updates.containment) {
      const result = this.containment.updateConfig(updates.containment);
      if (!result.success) {
        return result;
      }
    }

    console.log(`[Partner Audit] Config updated successfully`);
    return { success: true };
  }

  /**
   * Get containment manager
   */
  getContainment(): ContainmentManager {
    return this.containment;
  }

  /**
   * Detect ambiguous terms in text
   */
  private detectAmbiguousTerms(text: string): Array<{
    term: string;
    clarification: string;
    critical: boolean;
    context?: string;
  }> {
    const ambiguousPatterns = [
      {
        pattern: /\b(simple|basic|easy)\b/i,
        term: '$1',
        clarification: 'What level of functionality do you need?',
        critical: false
      },
      {
        pattern: /\b(good|nice|proper)\b/i,
        term: '$1',
        clarification: 'What specific criteria should I optimize for?',
        critical: false
      },
      {
        pattern: /\b(fast|quick|performant)\b/i,
        term: '$1',
        clarification: 'Any specific performance targets?',
        critical: false
      },
      {
        pattern: /\b(secure|safe)\b/i,
        term: '$1',
        clarification: 'What security standards or threats should I consider?',
        critical: true,
        context: 'Security is a broad topic - specifics help me implement correctly'
      },
      {
        pattern: /\b(like|similar to)\s+(\w+)/i,
        term: '$2',
        clarification: 'Which aspects of $2 should I replicate?',
        critical: false
      },
      {
        pattern: /\b(etc|and so on|and more)\b/i,
        term: '$1',
        clarification: 'Can you list the specific items?',
        critical: false
      }
    ];

    const found: Array<{ term: string; clarification: string; critical: boolean; context?: string }> = [];

    for (const { pattern, term: _term, clarification, critical, context } of ambiguousPatterns) {
      const match = text.match(pattern);
      if (match) {
        found.push({
          term: match[0],
          clarification: clarification.replace('$1', match[1] || '').replace('$2', match[2] || ''),
          critical,
          context
        });
      }
    }

    return found.slice(0, 3); // Limit to 3 to avoid overwhelming
  }

  /**
   * Check if description has scope ambiguity
   */
  private hasScopeAmbiguity(description: string): boolean {
    const broadTerms = [
      /\bfull\b/i,
      /\bcomplete\b/i,
      /\bentire\b/i,
      /\ball\b/i,
      /\beverything\b/i,
      /\bwhole\b/i,
      /\bcomprehensive\b/i
    ];

    return broadTerms.some(pattern => pattern.test(description));
  }

  /**
   * Detect technology/approach ambiguity
   */
  private detectTechAmbiguity(description: string): { question: string; context: string } | null {
    const techPatterns = [
      {
        pattern: /\b(api|endpoint)/i,
        question: 'Should this be a REST API, GraphQL, or something else?',
        context: 'Different API styles have different tradeoffs'
      },
      {
        pattern: /\b(database|storage|persist)/i,
        question: 'Any preference for database type (SQL, NoSQL, file-based)?',
        context: 'Choice affects data modeling approach'
      },
      {
        pattern: /\b(auth|login|user)/i,
        question: 'What authentication method should I use (session, JWT, OAuth)?',
        context: 'Authentication is security-critical - want to get it right'
      },
      {
        pattern: /\b(test|testing)/i,
        question: 'What level of test coverage do you need (unit, integration, e2e)?',
        context: 'Testing strategy affects implementation approach'
      }
    ];

    for (const { pattern, question, context } of techPatterns) {
      if (pattern.test(description)) {
        return { question, context };
      }
    }

    return null;
  }
}

export default CollaborativePartner;
