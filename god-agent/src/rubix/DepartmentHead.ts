/**
 * DepartmentHead - Base class for all RUBIX departments
 *
 * Each department head:
 * - Has a specialized role and expertise
 * - Manages a pool of sub-agents for parallel work
 * - Reports results back to the orchestrator (Claude)
 */

import Anthropic from '@anthropic-ai/sdk';
import { v4 as uuidv4 } from 'uuid';
import {
  DepartmentType,
  DepartmentConfig,
  SubAgentTask,
  SubAgentResult,
  DepartmentReport,
  Artifact
} from './types.js';

export abstract class DepartmentHead {
  protected type: DepartmentType;
  protected client: Anthropic;
  protected model: string;
  protected maxTokens: number;
  protected maxSubAgents: number;
  protected activeSubAgents: number = 0;

  constructor(config: DepartmentConfig) {
    this.type = config.type;
    this.maxSubAgents = config.maxSubAgents;
    this.model = config.model || 'claude-sonnet-4-20250514';
    this.maxTokens = config.maxTokens || 8192;
    this.client = new Anthropic({ apiKey: config.apiKey });
  }

  /**
   * Get the department's specialized system prompt
   */
  abstract getSystemPrompt(): string;

  /**
   * Get available tools for this department
   */
  abstract getTools(): Anthropic.Tool[];

  /**
   * Decompose work into sub-agent tasks
   */
  abstract decompose(
    instruction: string,
    context: string
  ): Promise<SubAgentTask[]>;

  /**
   * Execute the department's work
   */
  async execute(
    instruction: string,
    context: string
  ): Promise<DepartmentReport> {
    const startTime = Date.now();
    console.log(`[${this.type.toUpperCase()}] Starting department work`);

    try {
      // Decompose into sub-agent tasks
      const tasks = await this.decompose(instruction, context);
      console.log(`[${this.type.toUpperCase()}] Decomposed into ${tasks.length} sub-agent tasks`);

      // Execute sub-agents in parallel (respecting dependencies)
      const results = await this.executeSubAgents(tasks, context);

      // Synthesize results
      const report = await this.synthesize(instruction, results);
      report.durationMs = Date.now() - startTime;

      console.log(`[${this.type.toUpperCase()}] Completed in ${report.durationMs}ms`);
      return report;

    } catch (error) {
      console.error(`[${this.type.toUpperCase()}] Error:`, error);
      return {
        department: this.type,
        success: false,
        summary: `Department failed: ${(error as Error).message}`,
        subAgentResults: [],
        artifacts: [],
        issues: [(error as Error).message],
        durationMs: Date.now() - startTime
      };
    }
  }

  /**
   * Execute sub-agents with dependency-aware parallelization
   */
  protected async executeSubAgents(
    tasks: SubAgentTask[],
    context: string
  ): Promise<SubAgentResult[]> {
    const results: SubAgentResult[] = [];
    const completed = new Set<string>();
    const running = new Map<string, Promise<SubAgentResult>>();
    const pending = [...tasks];

    while (results.length < tasks.length) {
      // Find tasks ready to run (dependencies met)
      const ready = pending.filter(task =>
        !task.dependencies?.length ||
        task.dependencies.every(dep => completed.has(dep))
      );

      // Launch up to maxSubAgents
      const slots = this.maxSubAgents - running.size;
      for (const task of ready.slice(0, slots)) {
        const idx = pending.indexOf(task);
        if (idx >= 0) pending.splice(idx, 1);

        console.log(`[${this.type.toUpperCase()}] Launching sub-agent: ${task.type}`);
        const promise = this.executeSubAgent(task, context);
        running.set(task.id, promise);
      }

      if (running.size === 0 && pending.length > 0) {
        // Deadlock - dependencies can't be met
        console.warn(`[${this.type.toUpperCase()}] Deadlock detected, failing remaining tasks`);
        for (const task of pending) {
          results.push({
            taskId: task.id,
            success: false,
            output: 'Dependency deadlock',
            durationMs: 0
          });
        }
        break;
      }

      if (running.size > 0) {
        // Wait for next completion
        const result = await Promise.race(running.values());
        running.delete(result.taskId);
        results.push(result);
        completed.add(result.taskId);
      }
    }

    return results;
  }

  /**
   * Execute a single sub-agent task
   */
  protected async executeSubAgent(
    task: SubAgentTask,
    context: string
  ): Promise<SubAgentResult> {
    const startTime = Date.now();

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        system: this.getSystemPrompt(),
        tools: this.getTools(),
        messages: [{
          role: 'user',
          content: `## Task: ${task.type}\n\n${task.description}\n\n## Context\n${task.context}\n\n## Additional Context\n${context}`
        }]
      });

      // Process response and extract artifacts
      const { output, artifacts } = this.processResponse(response);

      return {
        taskId: task.id,
        success: true,
        output,
        artifacts,
        durationMs: Date.now() - startTime
      };

    } catch (error) {
      return {
        taskId: task.id,
        success: false,
        output: '',
        errors: [(error as Error).message],
        durationMs: Date.now() - startTime
      };
    }
  }

  /**
   * Process Claude response and extract artifacts
   */
  protected processResponse(response: Anthropic.Message): { output: string; artifacts: Artifact[] } {
    let output = '';
    const artifacts: Artifact[] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        output += block.text;

        // Extract file artifacts from response
        const fileMatches = block.text.matchAll(/<file path="([^"]+)"[^>]*>([\s\S]*?)<\/file>/g);
        for (const match of fileMatches) {
          artifacts.push({
            type: 'file',
            path: match[1],
            content: match[2].trim()
          });
        }
      }
    }

    return { output, artifacts };
  }

  /**
   * Synthesize sub-agent results into department report
   */
  protected async synthesize(
    _instruction: string,
    results: SubAgentResult[]
  ): Promise<DepartmentReport> {
    const allArtifacts = results.flatMap(r => r.artifacts || []);
    const allErrors = results.flatMap(r => r.errors || []);
    const successCount = results.filter(r => r.success).length;

    return {
      department: this.type,
      success: successCount === results.length,
      summary: `${successCount}/${results.length} sub-tasks completed successfully`,
      subAgentResults: results,
      artifacts: allArtifacts,
      issues: allErrors.length > 0 ? allErrors : undefined,
      durationMs: 0  // Will be set by execute()
    };
  }

  /**
   * Generate a unique task ID
   */
  protected generateTaskId(): string {
    return `${this.type}-${uuidv4().slice(0, 8)}`;
  }
}
