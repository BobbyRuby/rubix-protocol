/**
 * LearningIntegration
 *
 * Connects CODEX with the Sona learning engine to:
 * - Track successful/failed patterns
 * - Learn from execution outcomes
 * - Adjust pattern weights based on results
 * - Query learned patterns for better approaches
 */

import type { MemoryEngine } from '../core/MemoryEngine.js';
import type { SonaEngine } from '../learning/SonaEngine.js';
import type { SQLiteStorage } from '../storage/SQLiteStorage.js';
import type {
  Subtask,
  SubtaskAttempt,
  CodexTask,
  HealingAnalysis
} from './types.js';

/**
 * Pattern type for CODEX learning
 */
export type CodexPatternType =
  | 'approach'        // How a subtask was approached
  | 'healing'         // How a failure was healed
  | 'decomposition'   // How a task was broken down
  | 'escalation'      // When escalation was needed
  | 'verification';   // What verification caught issues

/**
 * Learned pattern
 */
export interface LearnedPattern {
  id: string;
  type: CodexPatternType;
  description: string;
  context: string;
  successRate: number;
  useCount: number;
  lastUsed: Date;
  weight: number;
}

/**
 * Pattern feedback
 */
export interface PatternFeedback {
  patternId: string;
  success: boolean;
  quality: number;  // 0-1, how well did it work?
  context?: string;
  error?: string;
}

/**
 * Learning suggestion
 */
export interface LearningSuggestion {
  patternId: string;
  approach: string;
  confidence: number;
  basedOn: string;
  successRate: number;
}

/**
 * LearningIntegration - Bridge between CODEX and Sona
 */
export class LearningIntegration {
  private engine: MemoryEngine;
  private sona: SonaEngine | undefined;
  // Reserved for future pattern caching and storage operations
  private storage: SQLiteStorage | undefined;
  private patternCache: Map<string, LearnedPattern> = new Map();
  private activeTrajectories: Map<string, string> = new Map(); // subtaskId -> trajectoryId

  constructor(engine: MemoryEngine, sona?: SonaEngine, storage?: SQLiteStorage) {
    this.engine = engine;
    this.sona = sona;
    this.storage = storage;
  }

  /**
   * Set Sona engine (for late binding)
   */
  setSona(sona: SonaEngine, storage: SQLiteStorage): void {
    this.sona = sona;
    this.storage = storage;
  }

  /**
   * Get storage instance (for future use)
   */
  getStorage(): SQLiteStorage | undefined {
    return this.storage;
  }

  /**
   * Get pattern cache (for future use)
   */
  getPatternCache(): Map<string, LearnedPattern> {
    return this.patternCache;
  }

  /**
   * Track the start of a subtask attempt
   * Creates a trajectory for learning
   */
  async trackAttemptStart(
    task: CodexTask,
    subtask: Subtask,
    attempt: SubtaskAttempt
  ): Promise<string | undefined> {
    if (!this.sona) return undefined;

    try {
      // Store attempt context in memory for trajectory
      const context = this.buildAttemptContext(task, subtask, attempt);

      const entry = await this.engine.store(context, {
        tags: ['codex', 'attempt', 'active', subtask.type],
        importance: 0.6
      });

      // Track trajectory ID for later feedback
      this.activeTrajectories.set(subtask.id, entry.id);

      return entry.id;
    } catch {
      return undefined;
    }
  }

  /**
   * Record the outcome of a subtask attempt
   * Provides feedback to Sona for learning
   */
  async recordOutcome(
    subtask: Subtask,
    attempt: SubtaskAttempt,
    success: boolean,
    healingUsed?: string
  ): Promise<void> {
    if (!this.sona) return;

    const trajectoryId = this.activeTrajectories.get(subtask.id);
    if (!trajectoryId) return;

    try {
      // Calculate quality score based on outcome
      const quality = this.calculateQuality(attempt, success, healingUsed);

      // Provide feedback to Sona
      await this.sona.provideFeedback(
        trajectoryId,
        quality,
        `codex:${subtask.type}`
      );

      // Store the outcome pattern
      await this.storeOutcomePattern(subtask, attempt, success, quality);

      // Clean up trajectory tracking
      this.activeTrajectories.delete(subtask.id);
    } catch {
      // Ignore learning errors
    }
  }

  /**
   * Get suggestions for approaching a subtask
   * Queries learned patterns for best approaches
   */
  async getSuggestions(
    subtask: Subtask,
    previousAttempts: SubtaskAttempt[]
  ): Promise<LearningSuggestion[]> {
    const suggestions: LearningSuggestion[] = [];

    try {
      // Query for similar successful patterns
      const results = await this.engine.query(
        `successful approach for ${subtask.type}: ${subtask.description}`,
        {
          topK: 5,
          filters: {
            tags: ['codex', 'success', subtask.type],
            minImportance: 0.5
          }
        }
      );

      // Convert results to suggestions
      for (const result of results) {
        const approach = this.extractApproach(result.entry.content);
        if (approach && !this.wasAlreadyTried(approach, previousAttempts)) {
          suggestions.push({
            patternId: result.entry.id,
            approach,
            confidence: result.score,
            basedOn: 'Similar successful pattern',
            successRate: this.estimateSuccessRate(result.entry.content)
          });
        }
      }

      // Sort by confidence
      suggestions.sort((a, b) => b.confidence - a.confidence);

    } catch {
      // Return empty suggestions on error
    }

    return suggestions.slice(0, 3);
  }

  /**
   * Get healing suggestions based on learned patterns
   */
  async getHealingSuggestions(
    subtask: Subtask,
    error: string,
    previousAttempts: SubtaskAttempt[]
  ): Promise<LearningSuggestion[]> {
    const suggestions: LearningSuggestion[] = [];

    try {
      // Query for healing patterns that worked
      const results = await this.engine.query(
        `healing for error: ${error} in ${subtask.type}`,
        {
          topK: 5,
          filters: {
            tags: ['codex', 'healing', 'success'],
            minImportance: 0.6
          }
        }
      );

      for (const result of results) {
        const approach = this.extractHealingApproach(result.entry.content);
        if (approach && !this.wasAlreadyTried(approach, previousAttempts)) {
          suggestions.push({
            patternId: result.entry.id,
            approach,
            confidence: result.score * 0.9, // Slightly lower confidence for healing
            basedOn: 'Similar error healed successfully',
            successRate: this.estimateSuccessRate(result.entry.content)
          });
        }
      }

    } catch {
      // Return empty suggestions on error
    }

    return suggestions;
  }

  /**
   * Learn from a successful healing
   */
  async learnFromHealing(
    subtask: Subtask,
    originalError: string,
    healingApproach: string,
    analysis: HealingAnalysis
  ): Promise<void> {
    try {
      const content = `Healing Pattern:
Type: ${subtask.type}
Error: ${originalError}
Approach: ${healingApproach}
New Approach: ${analysis.newApproach}
Suggested Actions: ${analysis.suggestedActions.join('; ')}
Success: true`;

      await this.engine.store(content, {
        tags: ['codex', 'healing', 'success', subtask.type],
        importance: 0.8
      });

    } catch {
      // Ignore storage errors
    }
  }

  /**
   * Learn from a failed healing attempt
   */
  async learnFromFailedHealing(
    subtask: Subtask,
    originalError: string,
    healingApproach: string
  ): Promise<void> {
    try {
      const content = `Failed Healing Pattern:
Type: ${subtask.type}
Error: ${originalError}
Approach: ${healingApproach}
Success: false`;

      await this.engine.store(content, {
        tags: ['codex', 'healing', 'failure', subtask.type],
        importance: 0.5
      });

    } catch {
      // Ignore storage errors
    }
  }

  /**
   * Record decomposition pattern for learning
   */
  async learnDecomposition(
    task: CodexTask,
    subtaskCount: number,
    success: boolean
  ): Promise<void> {
    try {
      const content = `Decomposition Pattern:
Task: ${task.description}
Subtasks: ${subtaskCount}
Types: ${task.subtasks.map(s => s.type).join(', ')}
Success: ${success}`;

      await this.engine.store(content, {
        tags: ['codex', 'decomposition', success ? 'success' : 'failure'],
        importance: success ? 0.7 : 0.5
      });

    } catch {
      // Ignore storage errors
    }
  }

  /**
   * Get pattern statistics
   */
  async getPatternStats(): Promise<{
    totalPatterns: number;
    successfulPatterns: number;
    healingPatterns: number;
    averageSuccessRate: number;
  }> {
    try {
      const allPatterns = await this.engine.query('codex pattern', {
        topK: 100,
        filters: {
          tags: ['codex']
        }
      });

      const successfulPatterns = allPatterns.filter(r =>
        r.entry.content.includes('Success: true')
      );

      const healingPatterns = allPatterns.filter(r =>
        r.entry.metadata.tags?.includes('healing')
      );

      // Estimate average success rate
      let totalRate = 0;
      let rateCount = 0;
      for (const pattern of allPatterns) {
        const rate = this.estimateSuccessRate(pattern.entry.content);
        if (rate > 0) {
          totalRate += rate;
          rateCount++;
        }
      }

      return {
        totalPatterns: allPatterns.length,
        successfulPatterns: successfulPatterns.length,
        healingPatterns: healingPatterns.length,
        averageSuccessRate: rateCount > 0 ? totalRate / rateCount : 0
      };

    } catch {
      return {
        totalPatterns: 0,
        successfulPatterns: 0,
        healingPatterns: 0,
        averageSuccessRate: 0
      };
    }
  }

  /**
   * Build context string for an attempt
   */
  private buildAttemptContext(
    task: CodexTask,
    subtask: Subtask,
    attempt: SubtaskAttempt
  ): string {
    return `CODEX Attempt:
Task: ${task.description}
Subtask: ${subtask.description}
Type: ${subtask.type}
Attempt: ${attempt.attemptNumber}
Approach: ${attempt.approach}
Dependencies: ${subtask.dependencies.length}`;
  }

  /**
   * Calculate quality score for learning
   */
  private calculateQuality(
    attempt: SubtaskAttempt,
    success: boolean,
    healingUsed?: string
  ): number {
    if (!success) {
      // Failed attempts get low quality
      return 0.1 + (attempt.attemptNumber > 1 ? 0 : 0.1);
    }

    // Successful attempts
    let quality = 0.8;

    // First-attempt success is higher quality
    if (attempt.attemptNumber === 1) {
      quality = 0.95;
    }

    // If healing was needed, slightly lower
    if (healingUsed) {
      quality *= 0.9;
    }

    return quality;
  }

  /**
   * Store outcome pattern for future learning
   */
  private async storeOutcomePattern(
    subtask: Subtask,
    attempt: SubtaskAttempt,
    success: boolean,
    quality: number
  ): Promise<void> {
    const content = `Outcome Pattern:
Type: ${subtask.type}
Description: ${subtask.description}
Approach: ${attempt.approach}
Attempt: ${attempt.attemptNumber}
Success: ${success}
Quality: ${quality.toFixed(2)}
Error: ${attempt.error || 'none'}`;

    await this.engine.store(content, {
      tags: ['codex', 'outcome', subtask.type, success ? 'success' : 'failure'],
      importance: success ? 0.7 : 0.5
    });
  }

  /**
   * Extract approach from pattern content
   */
  private extractApproach(content: string): string | undefined {
    const match = content.match(/Approach: ([^\n]+)/);
    return match ? match[1] : undefined;
  }

  /**
   * Extract healing approach from pattern content
   */
  private extractHealingApproach(content: string): string | undefined {
    const match = content.match(/New Approach: ([^\n]+)/);
    return match ? match[1] : undefined;
  }

  /**
   * Check if an approach was already tried
   */
  private wasAlreadyTried(approach: string, attempts: SubtaskAttempt[]): boolean {
    return attempts.some(a =>
      a.approach.toLowerCase().includes(approach.toLowerCase()) ||
      approach.toLowerCase().includes(a.approach.toLowerCase())
    );
  }

  /**
   * Estimate success rate from pattern content
   */
  private estimateSuccessRate(content: string): number {
    if (content.includes('Success: true')) {
      const qualityMatch = content.match(/Quality: ([\d.]+)/);
      return qualityMatch ? parseFloat(qualityMatch[1]) : 0.8;
    }
    return 0;
  }
}

export default LearningIntegration;
