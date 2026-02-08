/**
 * ContextBuilder
 *
 * Builds context from god-agent memory for scheduled task execution.
 * Supports loading specific memory IDs or running queries for fresh context.
 */

import type { MemoryEngine } from '../core/MemoryEngine.js';
import type { ScheduledTask, TaskContext } from './types.js';

/**
 * Configuration for ContextBuilder
 */
export interface ContextBuilderConfig {
  /** Maximum number of memories to include (default: 10) */
  maxMemories: number;
  /** Maximum total context length in characters (default: 8000) */
  maxContextLength: number;
  /** Include memory metadata in context (default: true) */
  includeMetadata: boolean;
  /** Include L-Score in context (default: false) */
  includeLScore: boolean;
  /** Separator between memory entries (default: '\n---\n') */
  separator: string;
}

/**
 * Default configuration
 */
export const DEFAULT_CONTEXT_BUILDER_CONFIG: ContextBuilderConfig = {
  maxMemories: 10,
  maxContextLength: 8000,
  includeMetadata: true,
  includeLScore: false,
  separator: '\n---\n'
};

export class ContextBuilder {
  private config: ContextBuilderConfig;

  constructor(config: Partial<ContextBuilderConfig> = {}) {
    this.config = { ...DEFAULT_CONTEXT_BUILDER_CONFIG, ...config };
  }

  /**
   * Build context for a scheduled task
   */
  async build(task: ScheduledTask, engine: MemoryEngine): Promise<TaskContext> {
    const memories: TaskContext['memories'] = [];

    // Load specific memory IDs if provided
    if (task.contextIds && task.contextIds.length > 0) {
      for (const id of task.contextIds.slice(0, this.config.maxMemories)) {
        try {
          const entry = await engine.getEntry(id);
          if (entry) {
            memories.push({
              id: entry.id,
              content: entry.content,
              tags: entry.metadata.tags,
              importance: entry.metadata.importance
            });
          }
        } catch {
          // Entry not found or error, skip
        }
      }
    }

    // Run context query if provided and we have room for more
    if (task.contextQuery && memories.length < this.config.maxMemories) {
      try {
        const remaining = this.config.maxMemories - memories.length;
        const results = await engine.query(task.contextQuery, { topK: remaining });

        for (const result of results) {
          // Avoid duplicates
          if (!memories.find(m => m.id === result.entry.id)) {
            memories.push({
              id: result.entry.id,
              content: result.entry.content,
              tags: result.entry.metadata.tags,
              importance: result.entry.metadata.importance
            });
          }
        }
      } catch {
        // Query failed, continue with what we have
      }
    }

    // Format context
    const formattedContext = this.formatContext(memories);

    return { memories, formattedContext };
  }

  /**
   * Format memories into a context string
   */
  private formatContext(memories: TaskContext['memories']): string {
    if (memories.length === 0) {
      return '[No context available]';
    }

    const parts: string[] = [];
    let totalLength = 0;

    for (const memory of memories) {
      const formatted = this.formatMemory(memory);

      // Check if adding this would exceed max length
      if (totalLength + formatted.length + this.config.separator.length > this.config.maxContextLength) {
        // Add truncation notice
        parts.push('[Additional context truncated due to length]');
        break;
      }

      parts.push(formatted);
      totalLength += formatted.length + this.config.separator.length;
    }

    return parts.join(this.config.separator);
  }

  /**
   * Format a single memory entry
   */
  private formatMemory(memory: TaskContext['memories'][0]): string {
    const lines: string[] = [];

    if (this.config.includeMetadata) {
      const metadata: string[] = [];
      if (memory.tags && memory.tags.length > 0) {
        metadata.push(`Tags: ${memory.tags.join(', ')}`);
      }
      if (memory.importance !== undefined) {
        metadata.push(`Importance: ${memory.importance.toFixed(2)}`);
      }
      if (metadata.length > 0) {
        lines.push(`[${metadata.join(' | ')}]`);
      }
    }

    lines.push(memory.content);

    return lines.join('\n');
  }

  /**
   * Build prompt with context inserted
   */
  buildPrompt(task: ScheduledTask, context: TaskContext): string {
    let prompt = task.promptTemplate;

    // Replace {context} placeholder with formatted context
    if (prompt.includes('{context}')) {
      prompt = prompt.replace('{context}', context.formattedContext);
    } else {
      // Append context if no placeholder
      prompt = `${prompt}\n\nContext:\n${context.formattedContext}`;
    }

    return prompt;
  }

  /**
   * Build a minimal context summary for logging
   */
  buildContextSummary(context: TaskContext): string {
    const count = context.memories.length;
    const ids = context.memories.map(m => m.id.substring(0, 8)).join(', ');
    const length = context.formattedContext.length;

    return `${count} memories (${ids}), ${length} chars`;
  }
}
