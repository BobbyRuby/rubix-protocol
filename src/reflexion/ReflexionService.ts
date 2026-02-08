/**
 * ReflexionService
 *
 * Generates Claude-powered verbal explanations of WHY failures occurred.
 * Goes beyond template-based pattern matching to provide root cause analysis.
 *
 * Key Features:
 * - Claude-generated "why did this fail" reasoning
 * - Stores reflections linked to failures via provenance
 * - Semantic search for past reflections
 * - Extracts applicable lessons for current context
 */

import Anthropic from '@anthropic-ai/sdk';
import { v4 as uuidv4 } from 'uuid';
import type { MemoryEngine } from '../core/MemoryEngine.js';
import { MemorySource, CausalRelationType } from '../core/types.js';
import type {
  Reflection,
  ReflectionQuery,
  ReflectionQueryResult,
  ReflectionContext,
  ReflexionStats,
  ReflexionConfig,
  RootCauseCategory
} from './types.js';

/**
 * ReflexionService - Generate and manage verbal reflections on failures
 */
export class ReflexionService {
  private engine: MemoryEngine;
  private anthropic: Anthropic | null = null;
  private config: ReflexionConfig;
  private cache: Map<string, { reflection: Reflection; timestamp: number }>;

  constructor(
    engine: MemoryEngine,
    anthropicApiKey?: string,
    config?: Partial<ReflexionConfig>
  ) {
    this.engine = engine;
    this.config = {
      model: config?.model ?? 'claude-sonnet-4-20250514',
      maxTokens: config?.maxTokens ?? 2048,
      minConfidence: config?.minConfidence ?? 0.5,
      enableExtendedThinking: config?.enableExtendedThinking ?? true,
      thinkingBudget: config?.thinkingBudget ?? 4096,
      enableCache: config?.enableCache ?? true,
      cacheTtlMs: config?.cacheTtlMs ?? 3600000
    };
    this.cache = new Map();

    // Initialize Anthropic client
    const apiKey = anthropicApiKey || process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      this.anthropic = new Anthropic({ apiKey });
      console.log('[ReflexionService] Initialized with Claude API');
    } else {
      console.warn('[ReflexionService] No API key - reflection generation disabled');
    }
  }

  /**
   * Generate a reflection on a failure using Claude
   */
  async generateReflection(context: ReflectionContext): Promise<Reflection> {
    const startTime = Date.now();

    // Check cache first
    const cacheKey = `${context.failure.id}`;
    if (this.config.enableCache) {
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.config.cacheTtlMs) {
        console.log(`[ReflexionService] Returning cached reflection for ${context.failure.id}`);
        return cached.reflection;
      }
    }

    if (!this.anthropic) {
      // Return a minimal reflection if no API available
      return this.createMinimalReflection(context);
    }

    const prompt = this.buildReflectionPrompt(context);

    try {
      console.log(`[ReflexionService] Generating reflection for failure ${context.failure.id}`);

      let response;
      if (this.config.enableExtendedThinking && this.config.thinkingBudget >= 1024) {
        response = await this.anthropic.messages.create({
          model: this.config.model,
          max_tokens: this.config.maxTokens,
          thinking: {
            type: 'enabled',
            budget_tokens: this.config.thinkingBudget
          },
          messages: [{ role: 'user', content: prompt }]
        }, {
          headers: {
            'anthropic-beta': 'interleaved-thinking-2025-05-14'
          }
        });
      } else {
        response = await this.anthropic.messages.create({
          model: this.config.model,
          max_tokens: this.config.maxTokens,
          messages: [{ role: 'user', content: prompt }]
        });
      }

      const textBlock = response.content.find(block => block.type === 'text');
      if (!textBlock || textBlock.type !== 'text') {
        throw new Error('No text response from Claude');
      }

      const tokensUsed = (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);
      const reflection = this.parseReflectionResponse(textBlock.text, context, tokensUsed);

      // Cache the reflection
      if (this.config.enableCache) {
        this.cache.set(cacheKey, { reflection, timestamp: Date.now() });
      }

      console.log(`[ReflexionService] Generated reflection in ${Date.now() - startTime}ms`);
      console.log(`[ReflexionService] Root cause: ${reflection.rootCause}, Confidence: ${reflection.confidence}`);

      return reflection;

    } catch (error) {
      console.error('[ReflexionService] Failed to generate reflection:', error);
      return this.createMinimalReflection(context);
    }
  }

  /**
   * Store a reflection in memory with provenance linking
   */
  async storeReflection(reflection: Reflection): Promise<string> {
    // Build content for semantic search
    const content = this.buildReflectionContent(reflection);

    // Store in memory
    const entry = await this.engine.store(content, {
      tags: [
        'reflexion',
        'failure_analysis',
        `root_cause:${reflection.rootCause}`,
        `task:${reflection.taskId}`,
        reflection.confidence >= 0.8 ? 'high_confidence' : 'moderate_confidence'
      ],
      source: MemorySource.AGENT_INFERENCE,
      importance: 0.85, // Reflections are valuable learning
      confidence: reflection.confidence
    });

    // Create causal relation linking reflection to failure
    try {
      this.engine.addCausalRelation(
        [reflection.failureId],
        [entry.id],
        CausalRelationType.TRIGGERS,
        0.9,
        { metadata: { type: 'failure_reflection' } }
      );
      console.log(`[ReflexionService] Linked reflection ${entry.id} to failure ${reflection.failureId}`);
    } catch (error) {
      console.warn('[ReflexionService] Failed to create causal link:', error);
    }

    return entry.id;
  }

  /**
   * Query for similar past reflections
   */
  async queryReflections(query: ReflectionQuery): Promise<ReflectionQueryResult> {
    const topK = query.topK ?? 10;
    const minSimilarity = query.minSimilarity ?? 0.5;

    // Build search query
    const searchQuery = query.rootCause
      ? `${query.query} root_cause:${query.rootCause}`
      : query.query;

    // Build tag filters
    const tags: string[] = ['reflexion'];
    if (query.rootCause) {
      tags.push(`root_cause:${query.rootCause}`);
    }
    if (query.highConfidenceOnly) {
      tags.push('high_confidence');
    }
    if (query.taskId) {
      tags.push(`task:${query.taskId}`);
    }

    // Query memory
    const results = await this.engine.query(searchQuery, {
      topK: topK * 2, // Fetch more to filter
      minScore: minSimilarity,
      filters: { tags }
    });

    // Parse reflections from results
    const reflections: Array<{ reflection: Reflection; similarity: number }> = [];
    const lessons = new Set<string>();
    const approaches = new Set<string>();
    const avoidances = new Set<string>();

    for (const result of results) {
      const parsed = this.parseStoredReflection(result.entry.id, result.entry.content);
      if (parsed) {
        reflections.push({
          reflection: parsed,
          similarity: result.score
        });

        // Collect lessons and approaches
        if (parsed.lesson) {
          lessons.add(parsed.lesson);
        }
        if (parsed.nextTimeApproach) {
          approaches.add(parsed.nextTimeApproach);
        }
        // The original failed approach should be avoided
        if (parsed.whyItFailed) {
          const avoidPattern = this.extractAvoidanceFromReflection(parsed);
          if (avoidPattern) {
            avoidances.add(avoidPattern);
          }
        }

        if (reflections.length >= topK) break;
      }
    }

    return {
      reflections,
      applicableLessons: Array.from(lessons).slice(0, 5),
      suggestedApproaches: Array.from(approaches).slice(0, 5),
      approachesToAvoid: Array.from(avoidances).slice(0, 5)
    };
  }

  /**
   * Extract lessons applicable to a task context
   */
  async applyLessons(
    taskDescription: string,
    subtaskDescription: string
  ): Promise<string[]> {
    // Query for relevant reflections
    const query = `${taskDescription} ${subtaskDescription}`;
    const result = await this.queryReflections({
      query,
      topK: 10,
      minSimilarity: 0.6,
      highConfidenceOnly: true
    });

    // Combine lessons and format for use
    const lessons: string[] = [];

    if (result.applicableLessons.length > 0) {
      lessons.push(`LESSONS FROM PAST FAILURES:`);
      result.applicableLessons.forEach((lesson, i) => {
        lessons.push(`${i + 1}. ${lesson}`);
      });
    }

    if (result.approachesToAvoid.length > 0) {
      lessons.push(`\nAPPROACHES TO AVOID:`);
      result.approachesToAvoid.forEach((avoid, i) => {
        lessons.push(`${i + 1}. ${avoid}`);
      });
    }

    if (result.suggestedApproaches.length > 0) {
      lessons.push(`\nRECOMMENDED APPROACHES:`);
      result.suggestedApproaches.forEach((approach, i) => {
        lessons.push(`${i + 1}. ${approach}`);
      });
    }

    return lessons;
  }

  /**
   * Get statistics about the reflexion system
   */
  async getStats(): Promise<ReflexionStats> {
    // Query all reflections
    const results = await this.engine.query('reflexion failure_analysis', {
      topK: 1000,
      filters: { tags: ['reflexion'] }
    });

    const byRootCause: Record<RootCauseCategory, number> = {
      misunderstood_requirements: 0,
      missing_context: 0,
      wrong_approach: 0,
      dependency_issue: 0,
      type_mismatch: 0,
      integration_failure: 0,
      test_logic_error: 0,
      environment_issue: 0,
      race_condition: 0,
      resource_exhaustion: 0,
      api_misuse: 0,
      security_violation: 0,
      other: 0
    };

    let totalConfidence = 0;
    let totalTokens = 0;
    const lessonCounts = new Map<string, number>();

    for (const result of results) {
      const reflection = this.parseStoredReflection(result.entry.id, result.entry.content);
      if (reflection) {
        byRootCause[reflection.rootCause]++;
        totalConfidence += reflection.confidence;
        totalTokens += reflection.tokensUsed;

        if (reflection.lesson) {
          const count = lessonCounts.get(reflection.lesson) || 0;
          lessonCounts.set(reflection.lesson, count + 1);
        }
      }
    }

    // Sort lessons by count
    const topLessons = Array.from(lessonCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([lesson, count]) => ({ lesson, count }));

    return {
      totalReflections: results.length,
      byRootCause,
      avgConfidence: results.length > 0 ? totalConfidence / results.length : 0,
      totalTokensUsed: totalTokens,
      topLessons,
      resolutionRate: 0 // Would need to track resolutions
    };
  }

  /**
   * Build the prompt for reflection generation
   */
  private buildReflectionPrompt(context: ReflectionContext): string {
    const previousAttemptsSection = context.previousAttempts?.length
      ? `
## Previous Attempts
${context.previousAttempts.map(a => `- Attempt ${a.attemptNumber}: ${a.approach}
  Result: ${a.outcome}
  Error: ${a.error}`).join('\n')}`
      : '';

    const codeSection = context.relevantCode
      ? `
## Relevant Code
\`\`\`
${context.relevantCode.substring(0, 2000)}
\`\`\``
      : '';

    const stackSection = context.stackTrace
      ? `
## Stack Trace
\`\`\`
${context.stackTrace.substring(0, 1000)}
\`\`\``
      : '';

    const consoleSection = context.consoleOutput?.length
      ? `
## Console Output
${context.consoleOutput.slice(0, 10).join('\n')}`
      : '';

    return `# Failure Reflection Analysis

You are a senior software engineer analyzing a failure to understand WHY it happened.
Your goal is to provide deep root cause analysis, not just describe WHAT failed.

## Task Context
**Task:** ${context.taskDescription}
**Subtask:** ${context.subtaskDescription}

## Failure Details
**Attempt:** ${context.failure.attemptNumber}
**Approach Tried:** ${context.failure.approach}
**Error Type:** ${context.failure.errorType}
**Error Message:** ${context.failure.error}
**Context:** ${context.failure.context}
${previousAttemptsSection}${codeSection}${stackSection}${consoleSection}

## Your Analysis

Think deeply about this failure. Don't just repeat the error - explain WHY it happened.

Provide your analysis in this exact format:

<reflection>
<why_it_failed>
[Explain the root cause - WHY this happened, not just what the error was.
Be specific about the underlying misconception, missing knowledge, or flawed assumption.]
</why_it_failed>

<root_cause>
[Choose ONE: misunderstood_requirements | missing_context | wrong_approach | dependency_issue | type_mismatch | integration_failure | test_logic_error | environment_issue | race_condition | resource_exhaustion | api_misuse | security_violation | other]
</root_cause>

<root_cause_detail>
[If 'other', explain the specific category. Otherwise, brief clarification.]
</root_cause_detail>

<lesson>
[A generalizable lesson that applies beyond this specific case.
Write it as a principle that could help in similar situations.]
</lesson>

<next_time_approach>
[Specific, actionable recommendation for what to do differently next time.
Be concrete and practical.]
</next_time_approach>

<confidence>
[0.0 to 1.0 - how confident are you in this analysis?]
</confidence>
</reflection>`;
  }

  /**
   * Parse Claude's response into a Reflection object
   */
  private parseReflectionResponse(
    response: string,
    context: ReflectionContext,
    tokensUsed: number
  ): Reflection {
    const id = uuidv4();

    // Extract sections using regex
    const whyItFailed = this.extractSection(response, 'why_it_failed') ||
      'Unable to determine root cause';
    const rootCauseRaw = this.extractSection(response, 'root_cause') || 'other';
    const rootCauseDetail = this.extractSection(response, 'root_cause_detail');
    const lesson = this.extractSection(response, 'lesson') ||
      'Review similar failures for patterns';
    const nextTimeApproach = this.extractSection(response, 'next_time_approach') ||
      'Gather more context before attempting';
    const confidenceStr = this.extractSection(response, 'confidence') || '0.5';

    // Validate root cause category
    const validCategories: RootCauseCategory[] = [
      'misunderstood_requirements', 'missing_context', 'wrong_approach',
      'dependency_issue', 'type_mismatch', 'integration_failure',
      'test_logic_error', 'environment_issue', 'race_condition',
      'resource_exhaustion', 'api_misuse', 'security_violation', 'other'
    ];
    const rootCause: RootCauseCategory = validCategories.includes(rootCauseRaw as RootCauseCategory)
      ? rootCauseRaw as RootCauseCategory
      : 'other';

    const confidence = Math.max(0, Math.min(1, parseFloat(confidenceStr) || 0.5));

    return {
      id,
      failureId: context.failure.id,
      taskId: context.failure.taskId,
      subtaskId: context.failure.subtaskId,
      whyItFailed,
      rootCause,
      rootCauseDetail,
      lesson,
      nextTimeApproach,
      confidence,
      generatedAt: new Date(),
      tokensUsed,
      model: this.config.model
    };
  }

  /**
   * Extract a section from the reflection response
   */
  private extractSection(response: string, section: string): string | undefined {
    const regex = new RegExp(`<${section}>([\\s\\S]*?)</${section}>`, 'i');
    const match = response.match(regex);
    return match ? match[1].trim() : undefined;
  }

  /**
   * Build content string for storing reflection
   */
  private buildReflectionContent(reflection: Reflection): string {
    return `REFLECTION on Failure ${reflection.failureId}
Task: ${reflection.taskId}
Subtask: ${reflection.subtaskId}

WHY IT FAILED:
${reflection.whyItFailed}

ROOT CAUSE: ${reflection.rootCause}
${reflection.rootCauseDetail ? `Detail: ${reflection.rootCauseDetail}` : ''}

LESSON LEARNED:
${reflection.lesson}

NEXT TIME APPROACH:
${reflection.nextTimeApproach}

Confidence: ${reflection.confidence}
Generated: ${reflection.generatedAt.toISOString()}
Tokens: ${reflection.tokensUsed}`;
  }

  /**
   * Parse a stored reflection from content
   */
  private parseStoredReflection(id: string, content: string): Reflection | null {
    try {
      const lines = content.split('\n');

      // Extract failure ID from first line
      const failureMatch = lines[0].match(/Failure\s+(\S+)/);
      const failureId = failureMatch ? failureMatch[1] : '';

      // Extract task and subtask
      const taskMatch = content.match(/Task:\s*(\S+)/);
      const subtaskMatch = content.match(/Subtask:\s*(\S+)/);

      // Extract sections
      const whyMatch = content.match(/WHY IT FAILED:\s*([\s\S]*?)(?=\nROOT CAUSE:)/);
      const rootCauseMatch = content.match(/ROOT CAUSE:\s*(\w+)/);
      const detailMatch = content.match(/Detail:\s*(.+)/);
      const lessonMatch = content.match(/LESSON LEARNED:\s*([\s\S]*?)(?=\nNEXT TIME APPROACH:)/);
      const approachMatch = content.match(/NEXT TIME APPROACH:\s*([\s\S]*?)(?=\nConfidence:)/);
      const confidenceMatch = content.match(/Confidence:\s*([\d.]+)/);
      const tokensMatch = content.match(/Tokens:\s*(\d+)/);
      const dateMatch = content.match(/Generated:\s*(.+)/);

      if (!failureId || !whyMatch) {
        return null;
      }

      return {
        id,
        failureId,
        taskId: taskMatch ? taskMatch[1] : '',
        subtaskId: subtaskMatch ? subtaskMatch[1] : '',
        whyItFailed: whyMatch[1].trim(),
        rootCause: (rootCauseMatch ? rootCauseMatch[1] : 'other') as RootCauseCategory,
        rootCauseDetail: detailMatch ? detailMatch[1] : undefined,
        lesson: lessonMatch ? lessonMatch[1].trim() : '',
        nextTimeApproach: approachMatch ? approachMatch[1].trim() : '',
        confidence: confidenceMatch ? parseFloat(confidenceMatch[1]) : 0.5,
        generatedAt: dateMatch ? new Date(dateMatch[1]) : new Date(),
        tokensUsed: tokensMatch ? parseInt(tokensMatch[1], 10) : 0,
        model: this.config.model
      };
    } catch {
      return null;
    }
  }

  /**
   * Extract avoidance pattern from a reflection
   */
  private extractAvoidanceFromReflection(reflection: Reflection): string | null {
    // Extract key phrase from whyItFailed that indicates what to avoid
    const whyLower = reflection.whyItFailed.toLowerCase();

    if (whyLower.includes('without') || whyLower.includes('missed') || whyLower.includes('forgot')) {
      // "Without checking X" -> "Always check X"
      return `Avoid: ${reflection.whyItFailed.substring(0, 100)}`;
    }

    if (reflection.rootCause === 'wrong_approach') {
      return `Wrong approach pattern: ${reflection.lesson}`;
    }

    return null;
  }

  /**
   * Create a minimal reflection when API is unavailable
   */
  private createMinimalReflection(context: ReflectionContext): Reflection {
    return {
      id: uuidv4(),
      failureId: context.failure.id,
      taskId: context.failure.taskId,
      subtaskId: context.failure.subtaskId,
      whyItFailed: `Error: ${context.failure.error}`,
      rootCause: 'other',
      rootCauseDetail: context.failure.errorType,
      lesson: 'Review error details and retry with more context',
      nextTimeApproach: 'Gather more information before attempting',
      confidence: 0.3,
      generatedAt: new Date(),
      tokensUsed: 0,
      model: 'none'
    };
  }

  /**
   * Clear the reflection cache
   */
  clearCache(): void {
    this.cache.clear();
    console.log('[ReflexionService] Cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; ttlMs: number } {
    return {
      size: this.cache.size,
      ttlMs: this.config.cacheTtlMs
    };
  }
}

export default ReflexionService;
