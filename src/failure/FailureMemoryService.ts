/**
 * FailureMemoryService
 *
 * Service for recording, querying, and learning from failures.
 * Integrates with god-agent memory for persistence and semantic search,
 * causal memory for linking failures to causes and fixes,
 * and Sona for continuous learning from failure patterns.
 */

import { v4 as uuidv4 } from 'uuid';
import type { MemoryEngine } from '../core/MemoryEngine.js';
import type { SonaEngine } from '../learning/SonaEngine.js';
import type { CausalMemory } from '../causal/CausalMemory.js';
import { MemorySource, CausalRelationType } from '../core/types.js';
import type {
  FailureMemory,
  FailurePattern,
  FailureQueryResult,
  FailureCausalLink,
  FailureStats,
  RecordFailureInput,
  QueryFailuresInput,
  RecordResolutionInput,
  FeedbackQuality
} from './types.js';

/**
 * Configuration for FailureMemoryService
 */
export interface FailureMemoryServiceConfig {
  /** Maximum failures to return in queries */
  maxQueryResults: number;
  /** Minimum similarity score for failure matching */
  minSimilarityScore: number;
  /** Days after which resolved failures can be pruned */
  pruneAfterDays: number;
  /** Default feedback quality for failures (low) */
  defaultFailureFeedbackQuality: FeedbackQuality;
  /** Default feedback quality for resolutions (high) */
  defaultResolutionFeedbackQuality: FeedbackQuality;
}

const DEFAULT_CONFIG: FailureMemoryServiceConfig = {
  maxQueryResults: 10,
  minSimilarityScore: 0.5,
  pruneAfterDays: 30,
  defaultFailureFeedbackQuality: 0.2,
  defaultResolutionFeedbackQuality: 0.8
};

/**
 * FailureMemoryService - Record, query, and learn from failures
 */
export class FailureMemoryService {
  private engine: MemoryEngine;
  private sona: SonaEngine | null;
  private causal: CausalMemory | null;
  private config: FailureMemoryServiceConfig;
  private patternCache: Map<string, FailurePattern>;

  constructor(
    engine: MemoryEngine,
    sona?: SonaEngine,
    causal?: CausalMemory,
    config?: Partial<FailureMemoryServiceConfig>
  ) {
    this.engine = engine;
    this.sona = sona ?? null;
    this.causal = causal ?? null;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.patternCache = new Map();
  }

  /**
   * Record a failure in god-agent memory
   *
   * Stores the failure with appropriate tags for later retrieval
   * and optionally sends low-quality feedback to Sona.
   */
  async recordFailure(input: RecordFailureInput): Promise<FailureMemory> {
    const id = uuidv4();
    const timestamp = new Date();

    // Create the failure memory object
    const failure: FailureMemory = {
      id,
      taskId: input.taskId,
      subtaskId: input.subtaskId,
      attemptNumber: input.attemptNumber,
      approach: input.approach,
      error: input.error,
      errorType: input.errorType,
      consoleErrors: input.consoleErrors,
      screenshot: input.screenshot,
      stackTrace: input.stackTrace,
      context: input.context,
      timestamp,
      resolved: false
    };

    // Build content for storage
    const content = this.buildFailureContent(failure);

    // Build tags for categorization
    const tags = this.buildFailureTags(input.errorType, input.subtaskType);

    // Store in god-agent memory
    const entry = await this.engine.store(content, {
      tags,
      source: MemorySource.AGENT_INFERENCE,
      importance: 0.7, // Failures are important to remember
      confidence: 0.9
    });

    // Update the failure ID to match the memory entry
    failure.id = entry.id;

    // Update pattern cache
    await this.updatePatternCache(failure);

    // Create trajectory for Sona learning
    if (this.sona) {
      try {
        const trajectoryId = this.sona.createTrajectory(
          `failure:${input.error}`,
          [entry.id],
          [1.0],
          undefined,
          'failure_recording'
        );

        // Provide low-quality feedback for failures
        await this.sona.provideFeedback(
          trajectoryId,
          this.config.defaultFailureFeedbackQuality
        );
      } catch {
        // Sona feedback is optional, don't fail on errors
      }
    }

    return failure;
  }

  /**
   * Query for similar past failures using semantic search
   */
  async queryFailures(input: QueryFailuresInput): Promise<FailureQueryResult> {
    const topK = input.topK ?? this.config.maxQueryResults;
    const minScore = input.minScore ?? this.config.minSimilarityScore;

    // Build search query
    const searchQuery = input.context
      ? `failure: ${input.error} context: ${input.context}`
      : `failure: ${input.error}`;

    // Query god-agent memory
    const results = await this.engine.query(searchQuery, {
      topK,
      minScore,
      filters: {
        tags: ['failure', 'codex']
      }
    });

    // Parse results into FailureMemory objects
    const similarFailures: FailureMemory[] = [];
    const avoidances = new Set<string>();
    const recommendations = new Set<string>();

    for (const result of results) {
      const failure = this.parseFailureFromContent(result.entry.id, result.entry.content);
      if (failure) {
        similarFailures.push(failure);

        // Collect failed approaches to avoid
        avoidances.add(failure.approach);

        // Collect successful resolutions as recommendations
        if (failure.resolved && failure.resolutionApproach) {
          recommendations.add(failure.resolutionApproach);
        }
      }
    }

    // Also check pattern cache for additional recommendations
    const errorSignature = this.normalizeError(input.error);
    const pattern = this.patternCache.get(errorSignature);
    if (pattern) {
      pattern.failedApproaches.forEach(a => avoidances.add(a));
      pattern.successfulFixes.forEach(a => recommendations.add(a));
    }

    return {
      similarFailures,
      suggestedAvoidances: Array.from(avoidances),
      recommendedApproaches: Array.from(recommendations)
    };
  }

  /**
   * Get approaches to avoid for a given subtask type
   */
  async getAvoidances(subtaskType: string): Promise<string[]> {
    const results = await this.engine.query(`failed approach for ${subtaskType}`, {
      topK: 20,
      filters: {
        tags: ['failure', 'codex', `subtask:${subtaskType}`]
      }
    });

    const avoidances = new Set<string>();

    for (const result of results) {
      const failure = this.parseFailureFromContent(result.entry.id, result.entry.content);
      if (failure && !failure.resolved) {
        avoidances.add(failure.approach);
      }
    }

    return Array.from(avoidances);
  }

  /**
   * Record a successful resolution for a failure
   */
  async recordResolution(input: RecordResolutionInput): Promise<boolean> {
    const { failureId, approach } = input;

    // Get the original failure entry
    const entry = this.engine.getEntry(failureId);
    if (!entry) {
      return false;
    }

    // Parse the existing failure
    const failure = this.parseFailureFromContent(failureId, entry.content);
    if (!failure) {
      return false;
    }

    // Update the failure as resolved
    failure.resolved = true;
    failure.resolutionApproach = approach;

    // Build updated content
    const updatedContent = this.buildFailureContent(failure);

    // Update in memory
    await this.engine.updateEntry(failureId, {
      content: updatedContent
    });

    // Update pattern cache with successful fix
    const errorSignature = this.normalizeError(failure.error);
    const pattern = this.patternCache.get(errorSignature);
    if (pattern) {
      if (!pattern.successfulFixes.includes(approach)) {
        pattern.successfulFixes.push(approach);
      }
    }

    // Store the resolution as a separate memory for learning
    const resolutionContent = `Resolution for failure:
Error: ${failure.error}
Error Type: ${failure.errorType}
Failed Approach: ${failure.approach}
Successful Resolution: ${approach}
Context: ${failure.context}`;

    const resolutionEntry = await this.engine.store(resolutionContent, {
      tags: ['resolution', 'codex', 'success', `error:${failure.errorType}`],
      source: MemorySource.AGENT_INFERENCE,
      importance: 0.9, // Resolutions are very valuable
      confidence: 0.95,
      parentIds: [failureId]
    });

    // Provide high-quality feedback to Sona for the resolution
    if (this.sona) {
      try {
        const trajectoryId = this.sona.createTrajectory(
          `resolution:${failure.error}`,
          [resolutionEntry.id],
          [1.0],
          undefined,
          'failure_resolution'
        );

        await this.sona.provideFeedback(
          trajectoryId,
          this.config.defaultResolutionFeedbackQuality
        );
      } catch {
        // Sona feedback is optional
      }
    }

    return true;
  }

  /**
   * Create causal links between failure, root cause, and fix
   */
  async createCausalLink(
    failureId: string,
    rootCauseId: string,
    fixId: string
  ): Promise<FailureCausalLink | null> {
    if (!this.causal) {
      // Fall back to engine's causal methods if available
      try {
        // Link failure to root cause
        this.engine.addCausalRelation(
          [failureId],
          [rootCauseId],
          CausalRelationType.CAUSES,
          0.8
        );

        // Link root cause to fix
        this.engine.addCausalRelation(
          [rootCauseId],
          [fixId],
          CausalRelationType.ENABLES,
          0.9
        );

        return {
          failureId,
          rootCauseId,
          fixId,
          strength: 0.85,
          createdAt: new Date()
        };
      } catch {
        return null;
      }
    }

    try {
      // Link failure to root cause (failure causes need for fix)
      this.causal.addRelation(
        [failureId],
        [rootCauseId],
        CausalRelationType.CAUSES,
        0.8,
        { metadata: { type: 'failure_cause' } }
      );

      // Link root cause to fix (understanding cause enables fix)
      this.causal.addRelation(
        [rootCauseId],
        [fixId],
        CausalRelationType.ENABLES,
        0.9,
        { metadata: { type: 'cause_fix' } }
      );

      // Direct link from failure to fix
      this.causal.addRelation(
        [failureId],
        [fixId],
        CausalRelationType.TRIGGERS,
        0.7,
        { metadata: { type: 'failure_resolution' } }
      );

      return {
        failureId,
        rootCauseId,
        fixId,
        strength: 0.85,
        createdAt: new Date()
      };
    } catch {
      return null;
    }
  }

  /**
   * Provide feedback to Sona for a failure
   * Quality should be 0.1-0.3 for failures
   */
  async provideSonaFeedback(failureId: string, quality: FeedbackQuality): Promise<boolean> {
    if (!this.sona) {
      return false;
    }

    // Validate quality is in failure range
    if (quality < 0 || quality > 1) {
      return false;
    }

    try {
      const trajectoryId = this.sona.createTrajectory(
        `feedback:${failureId}`,
        [failureId],
        [1.0],
        undefined,
        'failure_feedback'
      );

      await this.sona.provideFeedback(trajectoryId, quality);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Prune old resolved failures to manage memory
   */
  async pruneResolvedFailures(): Promise<{ pruned: number; ids: string[] }> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.pruneAfterDays);

    // Query for old resolved failures
    const results = await this.engine.query('resolved failure', {
      topK: 100,
      filters: {
        tags: ['failure', 'codex'],
        dateRange: {
          start: new Date(0),
          end: cutoffDate
        }
      }
    });

    const prunedIds: string[] = [];

    for (const result of results) {
      const failure = this.parseFailureFromContent(result.entry.id, result.entry.content);
      if (failure?.resolved) {
        const success = this.engine.deleteEntry(result.entry.id);
        if (success) {
          prunedIds.push(result.entry.id);
        }
      }
    }

    return { pruned: prunedIds.length, ids: prunedIds };
  }

  /**
   * Get failure statistics
   */
  async getStats(): Promise<FailureStats> {
    // Query all failures
    const allFailures = await this.engine.query('failure codex', {
      topK: 1000,
      filters: {
        tags: ['failure', 'codex']
      }
    });

    let totalFailures = 0;
    let resolvedFailures = 0;
    const errorTypeBreakdown: Record<string, number> = {};
    const failuresBySubtaskType: Record<string, number> = {};

    for (const result of allFailures) {
      const failure = this.parseFailureFromContent(result.entry.id, result.entry.content);
      if (failure) {
        totalFailures++;
        if (failure.resolved) {
          resolvedFailures++;
        }

        // Count by error type
        errorTypeBreakdown[failure.errorType] = (errorTypeBreakdown[failure.errorType] || 0) + 1;
      }

      // Count by subtask type from tags
      const subtaskTag = result.entry.metadata.tags.find((t: string) => t.startsWith('subtask:'));
      if (subtaskTag) {
        const subtaskType = subtaskTag.replace('subtask:', '');
        failuresBySubtaskType[subtaskType] = (failuresBySubtaskType[subtaskType] || 0) + 1;
      }
    }

    return {
      totalFailures,
      resolvedFailures,
      unresolvedFailures: totalFailures - resolvedFailures,
      uniquePatterns: this.patternCache.size,
      errorTypeBreakdown,
      failuresBySubtaskType
    };
  }

  // ==========================================
  // Private Helper Methods
  // ==========================================

  /**
   * Build content string for storage
   */
  private buildFailureContent(failure: FailureMemory): string {
    const parts = [
      `Failure Record:`,
      `Task ID: ${failure.taskId}`,
      `Subtask ID: ${failure.subtaskId}`,
      `Attempt: ${failure.attemptNumber}`,
      `Error Type: ${failure.errorType}`,
      `Error: ${failure.error}`,
      `Approach: ${failure.approach}`,
      `Context: ${failure.context}`,
      `Resolved: ${failure.resolved}`
    ];

    if (failure.consoleErrors?.length) {
      parts.push(`Console Errors: ${failure.consoleErrors.join('; ')}`);
    }

    if (failure.stackTrace) {
      parts.push(`Stack Trace: ${failure.stackTrace.substring(0, 500)}`);
    }

    if (failure.screenshot) {
      parts.push(`Screenshot: ${failure.screenshot}`);
    }

    if (failure.resolved && failure.resolutionApproach) {
      parts.push(`Resolution: ${failure.resolutionApproach}`);
    }

    return parts.join('\n');
  }

  /**
   * Build tags for failure categorization
   */
  private buildFailureTags(errorType: string, subtaskType: string): string[] {
    return [
      'failure',
      'codex',
      `error:${errorType}`,
      `subtask:${subtaskType}`
    ];
  }

  /**
   * Parse failure from stored content
   */
  private parseFailureFromContent(id: string, content: string): FailureMemory | null {
    try {
      const lines = content.split('\n');
      const failure: Partial<FailureMemory> = { id };

      for (const line of lines) {
        const [key, ...valueParts] = line.split(': ');
        const value = valueParts.join(': ');

        switch (key) {
          case 'Task ID':
            failure.taskId = value;
            break;
          case 'Subtask ID':
            failure.subtaskId = value;
            break;
          case 'Attempt':
            failure.attemptNumber = parseInt(value, 10);
            break;
          case 'Error Type':
            failure.errorType = value;
            break;
          case 'Error':
            failure.error = value;
            break;
          case 'Approach':
            failure.approach = value;
            break;
          case 'Context':
            failure.context = value;
            break;
          case 'Resolved':
            failure.resolved = value === 'true';
            break;
          case 'Resolution':
            failure.resolutionApproach = value;
            break;
          case 'Console Errors':
            failure.consoleErrors = value.split('; ');
            break;
          case 'Stack Trace':
            failure.stackTrace = value;
            break;
          case 'Screenshot':
            failure.screenshot = value;
            break;
        }
      }

      // Validate required fields
      if (failure.taskId && failure.subtaskId && failure.error && failure.approach) {
        failure.timestamp = failure.timestamp ?? new Date();
        return failure as FailureMemory;
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Normalize error message for pattern matching
   */
  private normalizeError(error: string): string {
    return error
      .toLowerCase()
      .replace(/\d+/g, 'N') // Replace numbers with N
      .replace(/['"][^'"]+['"]/g, 'STR') // Replace strings with STR
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 100);
  }

  /**
   * Update pattern cache with new failure
   */
  private async updatePatternCache(failure: FailureMemory): Promise<void> {
    const signature = this.normalizeError(failure.error);

    let pattern = this.patternCache.get(signature);
    if (!pattern) {
      pattern = {
        id: uuidv4(),
        errorSignature: signature,
        occurrences: 0,
        successfulFixes: [],
        failedApproaches: [],
        lastSeen: new Date()
      };
      this.patternCache.set(signature, pattern);
    }

    pattern.occurrences++;
    pattern.lastSeen = new Date();

    if (!pattern.failedApproaches.includes(failure.approach)) {
      pattern.failedApproaches.push(failure.approach);
    }
  }
}

export default FailureMemoryService;
