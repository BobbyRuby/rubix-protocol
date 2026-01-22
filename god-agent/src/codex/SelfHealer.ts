/**
 * SelfHealer
 *
 * Analyzes failures and suggests alternative approaches.
 * Learns from past failures to avoid repeating the same mistakes.
 * Integrates with god-agent memory for pattern matching.
 * Uses CapabilitiesManager for enhanced error analysis.
 * Uses FailureMemoryService for failure learning (Stage 7).
 */

import type { MemoryEngine } from '../core/MemoryEngine.js';
import type { CapabilitiesManager } from '../capabilities/CapabilitiesManager.js';
import type { ParsedStackTrace, StackContext, GitHistoryEntry } from '../capabilities/types.js';
import { FailureMemoryService } from '../failure/FailureMemoryService.js';
import type { FailureQueryResult } from '../failure/types.js';
import type { ReflexionService, ReflectionContext } from '../reflexion/index.js';
import {
  type Subtask,
  type SubtaskAttempt,
  type HealingAnalysis,
  type SimilarFailure,
  type ExecutionContext
} from './types.js';

/**
 * Self-healing strategies
 */
type HealingStrategy =
  | 'retry_with_context'
  | 'simplify_approach'
  | 'try_alternative'
  | 'gather_more_context'
  | 'break_into_smaller_steps'
  | 'escalate';

/**
 * Error pattern classification
 */
interface ErrorPattern {
  type: 'syntax' | 'type' | 'runtime' | 'test' | 'integration' | 'timeout' | 'unknown';
  isTransient: boolean;
  suggestedStrategy: HealingStrategy;
}

/**
 * Enhanced error analysis result from capabilities
 */
interface EnhancedErrorAnalysis {
  stack?: ParsedStackTrace;
  context?: StackContext;
  recentChanges?: GitHistoryEntry[];
  diagnosticErrors?: Array<{ file: string; line: number; message: string }>;
  suggestions: string[];
}

/**
 * SelfHealer - Analyze failures and suggest alternatives
 */
export class SelfHealer {
  private engine: MemoryEngine;
  private capabilities: CapabilitiesManager | undefined;
  private failureService: FailureMemoryService;
  private reflexionService: ReflexionService | undefined;

  constructor(
    engine: MemoryEngine,
    capabilities?: CapabilitiesManager,
    reflexionService?: ReflexionService
  ) {
    this.engine = engine;
    this.capabilities = capabilities;
    this.reflexionService = reflexionService;
    this.failureService = new FailureMemoryService(engine);
  }

  /**
   * Set the failure memory service (for dependency injection)
   */
  setFailureService(service: FailureMemoryService): void {
    this.failureService = service;
  }

  /**
   * Get the failure memory service
   */
  getFailureService(): FailureMemoryService {
    return this.failureService;
  }

  /**
   * Set the reflexion service (for dependency injection)
   */
  setReflexionService(service: ReflexionService): void {
    this.reflexionService = service;
  }

  /**
   * Get the reflexion service
   */
  getReflexionService(): ReflexionService | undefined {
    return this.reflexionService;
  }

  /**
   * Analyze a failure and suggest a healing approach
   */
  async analyze(context: ExecutionContext): Promise<HealingAnalysis> {
    const { task, subtask, attempt, previousAttempts } = context;

    // Classify the error
    const errorPattern = this.classifyError(attempt.error || '', attempt.consoleErrors || []);

    // Query for similar failures using FailureMemoryService (Stage 7)
    const failureQueryResult = await this.queryFailureMemory(
      attempt.error || '',
      subtask.description
    );

    // Use capabilities for enhanced error analysis
    const enhancedAnalysis = await this.performEnhancedAnalysis(
      attempt.error || '',
      attempt.consoleErrors || []
    );

    // Apply lessons from past reflections (Verbal Reflexion)
    let reflexionLessons: string[] = [];
    if (this.reflexionService) {
      try {
        reflexionLessons = await this.reflexionService.applyLessons(
          task.description,
          subtask.description
        );
        if (reflexionLessons.length > 0) {
          enhancedAnalysis.suggestions.push(
            `Lessons from past reflections: ${reflexionLessons.slice(0, 3).join('; ')}`
          );
        }
      } catch {
        // Ignore reflexion errors
      }
    }

    // Generate verbal reflection for attempts > 1 (learn from failure)
    if (this.reflexionService && attempt.attemptNumber > 1) {
      try {
        const reflectionContext: ReflectionContext = {
          failure: {
            id: `${task.id}-${subtask.id}-${attempt.attemptNumber}`,
            taskId: task.id,
            subtaskId: subtask.id,
            attemptNumber: attempt.attemptNumber,
            approach: attempt.approach,
            error: attempt.error || 'Unknown error',
            errorType: errorPattern.type,
            consoleErrors: attempt.consoleErrors,
            context: subtask.description
          },
          taskDescription: task.description,
          subtaskDescription: subtask.description,
          previousAttempts: previousAttempts.map(a => ({
            attemptNumber: a.attemptNumber,
            approach: a.approach,
            error: a.error || 'Unknown error',
            outcome: 'failed' as const
          })),
          consoleOutput: attempt.consoleErrors
        };

        // Generate reflection asynchronously (don't block healing)
        this.reflexionService.generateReflection(reflectionContext).then(reflection => {
          if (reflection) {
            this.reflexionService!.storeReflection(reflection).catch(() => {});
          }
        }).catch(() => {});
      } catch {
        // Ignore reflexion errors
      }
    }

    // Check if this is a fundamental blocker
    if (this.isFundamentalBlocker(errorPattern, previousAttempts)) {
      return {
        isFundamentalBlocker: true,
        reason: this.getFundamentalBlockerReason(errorPattern, previousAttempts),
        newApproach: '',
        needsMoreContext: false,
        suggestedActions: [
          'Escalate to user for guidance',
          ...enhancedAnalysis.suggestions,
          ...failureQueryResult.recommendedApproaches.map(a => `Previously worked: ${a}`)
        ]
      };
    }

    // Find similar failures from memory (legacy method + new service)
    const similarFailures = await this.findSimilarFailures(
      subtask.description,
      attempt.error || ''
    );

    // Merge suggestions from failure memory service
    if (failureQueryResult.suggestedAvoidances.length > 0) {
      enhancedAnalysis.suggestions.push(
        `Avoid approaches that failed before: ${failureQueryResult.suggestedAvoidances.slice(0, 3).join(', ')}`
      );
    }
    if (failureQueryResult.recommendedApproaches.length > 0) {
      enhancedAnalysis.suggestions.push(
        `Recommended approaches: ${failureQueryResult.recommendedApproaches.slice(0, 3).join(', ')}`
      );
    }

    // Determine healing strategy, informed by enhanced analysis
    const strategy = this.selectStrategy(
      errorPattern,
      previousAttempts,
      similarFailures,
      enhancedAnalysis
    );

    // Generate new approach based on strategy
    const healingResult = await this.generateHealing(
      context,
      strategy,
      errorPattern,
      similarFailures,
      enhancedAnalysis
    );

    // Record this failure using FailureMemoryService (Stage 7)
    await this.recordFailureToService(context, errorPattern);

    // Also store with legacy method for backward compatibility
    await this.storeFailurePattern(context, errorPattern);

    return healingResult;
  }

  /**
   * Query failure memory for similar past failures (Stage 7)
   */
  private async queryFailureMemory(error: string, context: string): Promise<FailureQueryResult> {
    try {
      return await this.failureService.queryFailures({
        error,
        context,
        topK: 5,
        minScore: 0.5
      });
    } catch {
      // Return empty result on error
      return {
        similarFailures: [],
        suggestedAvoidances: [],
        recommendedApproaches: []
      };
    }
  }

  /**
   * Record failure to FailureMemoryService (Stage 7)
   */
  private async recordFailureToService(
    context: ExecutionContext,
    errorPattern: ErrorPattern
  ): Promise<void> {
    try {
      const { task, subtask, attempt } = context;

      await this.failureService.recordFailure({
        taskId: task.id,
        subtaskId: subtask.id,
        attemptNumber: attempt.attemptNumber,
        approach: attempt.approach,
        error: attempt.error || 'Unknown error',
        errorType: errorPattern.type,
        consoleErrors: attempt.consoleErrors,
        screenshot: attempt.screenshot,
        stackTrace: undefined, // Could extract from error
        context: subtask.description,
        subtaskType: subtask.type
      });
    } catch {
      // Ignore recording errors
    }
  }

  /**
   * Perform enhanced error analysis using capabilities
   */
  private async performEnhancedAnalysis(
    error: string,
    consoleErrors: string[]
  ): Promise<EnhancedErrorAnalysis> {
    const result: EnhancedErrorAnalysis = { suggestions: [] };

    if (!this.capabilities) {
      return result;
    }

    // Parse stack trace if available
    const errorWithStack = error.includes('at ') ? error : consoleErrors.find(e => e.includes('at '));
    if (errorWithStack) {
      try {
        result.stack = await this.capabilities.parseStackTrace(new Error(errorWithStack));

        // Get context for the first frame
        if (result.stack.frames.length > 0) {
          const firstFrame = result.stack.frames[0];
          try {
            result.context = await this.capabilities.getStackContext(
              firstFrame.file,
              firstFrame.line
            );
            result.suggestions.push(
              `Error in ${firstFrame.functionName} at ${firstFrame.file}:${firstFrame.line}`
            );
          } catch {
            // Context unavailable
          }

          // Get recent git changes for the file
          try {
            result.recentChanges = await this.capabilities.gitRecentChanges(firstFrame.file, { limit: 3 });
            if (result.recentChanges.length > 0) {
              const latestChange = result.recentChanges[0];
              result.suggestions.push(
                `Last modified by ${latestChange.author} on ${latestChange.date.toLocaleDateString()}: ${latestChange.message}`
              );
            }
          } catch {
            // Git history unavailable
          }
        }
      } catch {
        // Stack parsing failed
      }
    }

    // Get LSP diagnostics for related files
    try {
      const diagnostics = await this.capabilities.getDiagnostics();
      result.diagnosticErrors = [];
      for (const diag of diagnostics) {
        if (diag.errorCount > 0) {
          result.diagnosticErrors.push(
            ...diag.diagnostics
              .filter(d => d.severity === 'error')
              .map(d => ({
                file: diag.file,
                line: d.range.start.line,
                message: d.message
              }))
          );
        }
      }
      if (result.diagnosticErrors.length > 0) {
        result.suggestions.push(
          `Found ${result.diagnosticErrors.length} diagnostic errors in project`
        );
      }
    } catch {
      // LSP diagnostics unavailable
    }

    return result;
  }

  /**
   * Classify the error type
   */
  private classifyError(error: string, consoleErrors: string[]): ErrorPattern {
    const allErrors = [error, ...consoleErrors].join('\n').toLowerCase();

    // Syntax errors
    if (allErrors.includes('syntaxerror') || allErrors.includes('unexpected token')) {
      return {
        type: 'syntax',
        isTransient: false,
        suggestedStrategy: 'retry_with_context'
      };
    }

    // Type errors
    if (allErrors.includes('typeerror') || allErrors.includes('type mismatch') ||
        allErrors.includes('not assignable') || allErrors.includes('ts2')) {
      return {
        type: 'type',
        isTransient: false,
        suggestedStrategy: 'gather_more_context'
      };
    }

    // Test failures
    if (allErrors.includes('test failed') || allErrors.includes('assertion') ||
        allErrors.includes('expected') || allErrors.includes('toequal')) {
      return {
        type: 'test',
        isTransient: false,
        suggestedStrategy: 'try_alternative'
      };
    }

    // Integration errors
    if (allErrors.includes('connection') || allErrors.includes('network') ||
        allErrors.includes('econnrefused') || allErrors.includes('fetch')) {
      return {
        type: 'integration',
        isTransient: true,
        suggestedStrategy: 'retry_with_context'
      };
    }

    // Timeout
    if (allErrors.includes('timeout') || allErrors.includes('timed out')) {
      return {
        type: 'timeout',
        isTransient: true,
        suggestedStrategy: 'simplify_approach'
      };
    }

    // Runtime errors
    if (allErrors.includes('referenceerror') || allErrors.includes('undefined') ||
        allErrors.includes('null') || allErrors.includes('cannot read property')) {
      return {
        type: 'runtime',
        isTransient: false,
        suggestedStrategy: 'gather_more_context'
      };
    }

    return {
      type: 'unknown',
      isTransient: false,
      suggestedStrategy: 'try_alternative'
    };
  }

  /**
   * Check if this is a fundamental blocker
   */
  private isFundamentalBlocker(
    errorPattern: ErrorPattern,
    previousAttempts: SubtaskAttempt[]
  ): boolean {
    // Too many attempts with same error type
    const sameTypeAttempts = previousAttempts.filter(a =>
      this.classifyError(a.error || '', a.consoleErrors || []).type === errorPattern.type
    );

    if (sameTypeAttempts.length >= 2) {
      return true;
    }

    // Integration errors that persist are blockers
    if (errorPattern.type === 'integration' && previousAttempts.length >= 2) {
      return true;
    }

    return false;
  }

  /**
   * Get reason for fundamental blocker
   */
  private getFundamentalBlockerReason(
    errorPattern: ErrorPattern,
    previousAttempts: SubtaskAttempt[]
  ): string {
    switch (errorPattern.type) {
      case 'type':
        return 'Persistent type errors suggest a design issue that needs clarification';
      case 'integration':
        return 'Integration failures may indicate missing dependencies or configuration';
      case 'test':
        return 'Tests consistently failing may indicate misunderstood requirements';
      default:
        return `Same error type (${errorPattern.type}) after ${previousAttempts.length} attempts`;
    }
  }

  /**
   * Find similar failures from memory
   */
  private async findSimilarFailures(
    subtaskDescription: string,
    error: string
  ): Promise<SimilarFailure[]> {
    try {
      // Query for similar failures
      const results = await this.engine.query(
        `failure: ${error} task: ${subtaskDescription}`,
        {
          topK: 5,
          filters: {
            tags: ['codex', 'failure'],
            minImportance: 0.4
          }
        }
      );

      return results.map(r => ({
        id: r.entry.id,
        description: r.entry.content.substring(0, 200),
        error: this.extractErrorFromContent(r.entry.content),
        resolution: this.extractResolutionFromContent(r.entry.content),
        similarity: r.score
      }));
    } catch {
      return [];
    }
  }

  /**
   * Extract error from stored content
   */
  private extractErrorFromContent(content: string): string {
    const errorMatch = content.match(/Error: ([^\n]+)/);
    return errorMatch ? errorMatch[1] : '';
  }

  /**
   * Extract resolution from stored content
   */
  private extractResolutionFromContent(content: string): string | undefined {
    const resMatch = content.match(/Resolution: ([^\n]+)/);
    return resMatch ? resMatch[1] : undefined;
  }

  /**
   * Select the best healing strategy
   */
  private selectStrategy(
    errorPattern: ErrorPattern,
    previousAttempts: SubtaskAttempt[],
    similarFailures: SimilarFailure[],
    enhancedAnalysis?: EnhancedErrorAnalysis
  ): HealingStrategy {
    // If we have a similar failure with a resolution, try that
    const withResolution = similarFailures.find(f => f.resolution);
    if (withResolution && withResolution.similarity > 0.7) {
      return 'try_alternative';
    }

    // If enhanced analysis shows recent changes, those might be the cause
    if (enhancedAnalysis?.recentChanges && enhancedAnalysis.recentChanges.length > 0) {
      // If the error file was recently modified, retry with context about the change
      return 'retry_with_context';
    }

    // If we have diagnostic errors in related files, gather more context
    if (enhancedAnalysis?.diagnosticErrors && enhancedAnalysis.diagnosticErrors.length > 0) {
      return 'gather_more_context';
    }

    // If transient error and first attempt, retry
    if (errorPattern.isTransient && previousAttempts.length < 2) {
      return 'retry_with_context';
    }

    // If we've tried the same approach multiple times, simplify
    if (previousAttempts.length >= 2) {
      return 'simplify_approach';
    }

    // Default to the error pattern's suggested strategy
    return errorPattern.suggestedStrategy;
  }

  /**
   * Generate healing approach based on strategy
   */
  private async generateHealing(
    context: ExecutionContext,
    strategy: HealingStrategy,
    errorPattern: ErrorPattern,
    similarFailures: SimilarFailure[],
    enhancedAnalysis?: EnhancedErrorAnalysis
  ): Promise<HealingAnalysis> {
    const { subtask, attempt, previousAttempts } = context;

    // Build base suggested actions from enhanced analysis
    const enhancedSuggestions = enhancedAnalysis?.suggestions || [];

    switch (strategy) {
      case 'retry_with_context':
        return {
          isFundamentalBlocker: false,
          newApproach: this.generateRetryApproach(attempt, errorPattern, enhancedAnalysis),
          needsMoreContext: false,
          suggestedActions: [
            'Retry with explicit error handling',
            'Add more defensive checks',
            'Verify preconditions are met',
            ...enhancedSuggestions
          ],
          similarFailures
        };

      case 'simplify_approach':
        return {
          isFundamentalBlocker: false,
          newApproach: this.generateSimplifiedApproach(subtask, previousAttempts),
          needsMoreContext: false,
          suggestedActions: [
            'Break down into smaller steps',
            'Remove non-essential features',
            'Use a simpler implementation pattern',
            ...enhancedSuggestions
          ],
          similarFailures
        };

      case 'try_alternative':
        return {
          isFundamentalBlocker: false,
          newApproach: this.generateAlternativeApproach(subtask, previousAttempts, similarFailures),
          needsMoreContext: false,
          suggestedActions: [
            'Try a completely different approach',
            'Look at how similar functionality is implemented elsewhere',
            'Consider alternative libraries or patterns',
            ...enhancedSuggestions
          ],
          similarFailures
        };

      case 'gather_more_context':
        return {
          isFundamentalBlocker: false,
          newApproach: 'Gather more context before retrying',
          needsMoreContext: true,
          contextNeeded: this.identifyMissingContext(errorPattern, attempt, enhancedAnalysis),
          suggestedActions: [
            'Read related source files',
            'Check type definitions',
            'Understand the expected data flow',
            ...enhancedSuggestions
          ],
          similarFailures
        };

      case 'break_into_smaller_steps':
        return {
          isFundamentalBlocker: false,
          newApproach: this.generateBreakdownApproach(subtask),
          needsMoreContext: false,
          suggestedActions: [
            'Create intermediate checkpoints',
            'Verify each step independently',
            'Add logging for debugging',
            ...enhancedSuggestions
          ],
          similarFailures
        };

      default:
        return {
          isFundamentalBlocker: true,
          reason: 'Unable to determine a healing strategy',
          newApproach: '',
          needsMoreContext: false,
          suggestedActions: ['Escalate to user', ...enhancedSuggestions]
        };
    }
  }

  /**
   * Generate retry approach with error context
   */
  private generateRetryApproach(
    attempt: SubtaskAttempt,
    errorPattern: ErrorPattern,
    enhancedAnalysis?: EnhancedErrorAnalysis
  ): string {
    const errorContext = attempt.error || 'Unknown error';
    const parts: string[] = [];

    switch (errorPattern.type) {
      case 'syntax':
        parts.push(`Fix syntax error: ${errorContext}. Check for missing brackets, semicolons, or incorrect syntax.`);
        break;
      case 'type':
        parts.push(`Fix type error: ${errorContext}. Verify type annotations match actual data.`);
        break;
      case 'runtime':
        parts.push(`Fix runtime error: ${errorContext}. Add null checks and validate data before use.`);
        break;
      case 'integration':
        parts.push(`Retry integration: ${errorContext}. Verify service is available and credentials are correct.`);
        break;
      case 'timeout':
        parts.push(`Handle timeout: ${errorContext}. Increase timeout or optimize the operation.`);
        break;
      default:
        parts.push(`Retry with fix for: ${errorContext}`);
    }

    // Add enhanced context if available
    if (enhancedAnalysis) {
      if (enhancedAnalysis.stack?.frames[0]) {
        const frame = enhancedAnalysis.stack.frames[0];
        parts.push(`Error location: ${frame.file}:${frame.line} in ${frame.functionName}`);
      }
      if (enhancedAnalysis.recentChanges?.length) {
        const change = enhancedAnalysis.recentChanges[0];
        parts.push(`Recent change: "${change.message}" by ${change.author}`);
      }
    }

    return parts.join('\n');
  }

  /**
   * Generate simplified approach
   */
  private generateSimplifiedApproach(subtask: Subtask, previousAttempts: SubtaskAttempt[]): string {
    const approaches = previousAttempts.map(a => a.approach).join(', ');
    return `Simplify the approach for "${subtask.description}". Previous attempts tried: ${approaches}. Focus on the minimal implementation that satisfies the core requirement.`;
  }

  /**
   * Generate alternative approach
   */
  private generateAlternativeApproach(
    subtask: Subtask,
    previousAttempts: SubtaskAttempt[],
    similarFailures: SimilarFailure[]
  ): string {
    // Check if we have a resolution from similar failures
    const withResolution = similarFailures.find(f => f.resolution);
    if (withResolution) {
      return `Try approach from similar past failure: ${withResolution.resolution}`;
    }

    const avoidApproaches = previousAttempts.map(a => a.approach).join('; ');
    return `Find alternative approach for "${subtask.description}". Avoid: ${avoidApproaches}. Consider different patterns, libraries, or implementation strategies.`;
  }

  /**
   * Identify missing context
   */
  private identifyMissingContext(
    errorPattern: ErrorPattern,
    _attempt: SubtaskAttempt,
    enhancedAnalysis?: EnhancedErrorAnalysis
  ): string[] {
    const context: string[] = [];

    if (errorPattern.type === 'type') {
      context.push('Type definitions for related modules');
      context.push('Interface/type declarations');
    }

    if (errorPattern.type === 'runtime') {
      context.push('Data flow through the function');
      context.push('Possible null/undefined sources');
    }

    if (errorPattern.type === 'integration') {
      context.push('Service configuration');
      context.push('Environment variables');
      context.push('Network/connection requirements');
    }

    // Add context from enhanced analysis
    if (enhancedAnalysis) {
      // If we have a stack trace, suggest reading those files
      if (enhancedAnalysis.stack?.frames.length) {
        const files = [...new Set(enhancedAnalysis.stack.frames.map(f => f.file).filter(f => f !== 'unknown'))];
        if (files.length > 0) {
          context.push(`Files in stack trace: ${files.slice(0, 3).join(', ')}`);
        }
      }

      // If we have diagnostic errors, suggest checking those files
      if (enhancedAnalysis.diagnosticErrors?.length) {
        const errorFiles = [...new Set(enhancedAnalysis.diagnosticErrors.map(e => e.file))];
        if (errorFiles.length > 0) {
          context.push(`Files with diagnostic errors: ${errorFiles.slice(0, 3).join(', ')}`);
        }
      }
    }

    if (context.length === 0) {
      context.push('Related source code');
      context.push('Similar implementations in codebase');
    }

    return context;
  }

  /**
   * Generate breakdown approach
   */
  private generateBreakdownApproach(subtask: Subtask): string {
    return `Break "${subtask.description}" into smaller steps:
1. Set up prerequisites and validate inputs
2. Implement core logic with minimal dependencies
3. Add error handling and edge cases
4. Integrate with surrounding code
5. Verify each step works before proceeding`;
  }

  /**
   * Store failure pattern for learning
   */
  private async storeFailurePattern(
    context: ExecutionContext,
    errorPattern: ErrorPattern
  ): Promise<void> {
    try {
      const { subtask, attempt } = context;

      const content = `Failure Pattern:
Task: ${subtask.description}
Type: ${subtask.type}
Error Type: ${errorPattern.type}
Error: ${attempt.error || 'Unknown'}
Approach: ${attempt.approach}
Attempt: ${attempt.attemptNumber}
Console Errors: ${(attempt.consoleErrors || []).join('; ')}
Transient: ${errorPattern.isTransient}`;

      await this.engine.store(content, {
        tags: ['codex', 'failure', `error:${errorPattern.type}`, `subtask:${subtask.type}`],
        importance: 0.7
      });
    } catch {
      // Ignore storage errors
    }
  }

  /**
   * Record successful healing for learning
   * Creates causal links and provides positive feedback to Sona (Stage 7)
   */
  async recordSuccessfulHealing(
    context: ExecutionContext,
    healingApproach: string,
    failureId?: string
  ): Promise<void> {
    try {
      const { subtask, attempt } = context;

      const content = `Successful Healing:
Task: ${subtask.description}
Original Error: ${attempt.error || 'Unknown'}
Healing Approach: ${healingApproach}
Resolution: Successfully completed after healing`;

      const healingEntry = await this.engine.store(content, {
        tags: ['codex', 'healing', 'success'],
        importance: 0.8
      });

      // Record resolution in FailureMemoryService (Stage 7)
      if (failureId) {
        await this.failureService.recordResolution({
          failureId,
          approach: healingApproach
        });

        // Create causal link between failure and resolution
        // The root cause is implicitly the failure itself in simple cases
        await this.failureService.createCausalLink(
          failureId,
          failureId, // Root cause is the failure (could be enhanced to find actual root cause)
          healingEntry.id
        );

        // Provide positive feedback to Sona for the resolution
        await this.failureService.provideSonaFeedback(failureId, 0.8);
      }
    } catch {
      // Ignore storage errors
    }
  }

  /**
   * Record a failure resolution with explicit causal chain (Stage 7)
   */
  async recordResolutionWithCause(
    failureId: string,
    rootCauseDescription: string,
    fixApproach: string
  ): Promise<{ success: boolean; causalLinkCreated: boolean }> {
    try {
      // Store the root cause as a memory entry
      const rootCauseEntry = await this.engine.store(
        `Root Cause Analysis:\n${rootCauseDescription}`,
        {
          tags: ['codex', 'root_cause', 'analysis'],
          importance: 0.85,
          parentIds: [failureId]
        }
      );

      // Store the fix as a memory entry
      const fixEntry = await this.engine.store(
        `Fix Applied:\n${fixApproach}`,
        {
          tags: ['codex', 'fix', 'resolution'],
          importance: 0.9,
          parentIds: [rootCauseEntry.id]
        }
      );

      // Record resolution
      await this.failureService.recordResolution({
        failureId,
        approach: fixApproach
      });

      // Create causal chain: failure -> root cause -> fix
      const causalLink = await this.failureService.createCausalLink(
        failureId,
        rootCauseEntry.id,
        fixEntry.id
      );

      // Provide high-quality feedback to Sona
      await this.failureService.provideSonaFeedback(failureId, 0.85);

      return {
        success: true,
        causalLinkCreated: causalLink !== null
      };
    } catch {
      return {
        success: false,
        causalLinkCreated: false
      };
    }
  }

  /**
   * Get healing suggestions without executing
   */
  async getSuggestions(
    subtask: Subtask,
    error: string,
    consoleErrors: string[]
  ): Promise<string[]> {
    const errorPattern = this.classifyError(error, consoleErrors);
    const similarFailures = await this.findSimilarFailures(subtask.description, error);

    const suggestions: string[] = [];

    // Add error-specific suggestions
    switch (errorPattern.type) {
      case 'syntax':
        suggestions.push('Check for syntax errors in recent changes');
        suggestions.push('Verify all brackets and quotes are balanced');
        break;
      case 'type':
        suggestions.push('Review type annotations');
        suggestions.push('Check for implicit any types');
        break;
      case 'test':
        suggestions.push('Verify test expectations match actual behavior');
        suggestions.push('Check if test data is properly set up');
        break;
      case 'integration':
        suggestions.push('Verify external services are available');
        suggestions.push('Check environment configuration');
        break;
      case 'runtime':
        suggestions.push('Add null checks for potentially undefined values');
        suggestions.push('Verify data is properly initialized');
        break;
    }

    // Add suggestions from similar failures
    for (const failure of similarFailures.slice(0, 2)) {
      if (failure.resolution) {
        suggestions.push(`Similar issue resolved by: ${failure.resolution}`);
      }
    }

    return suggestions;
  }
}

export default SelfHealer;
