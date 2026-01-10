/**
 * TaskDecomposer
 *
 * Breaks high-level tasks into executable subtasks with dependencies.
 * Detects ambiguities and generates verification steps for each subtask.
 */

import { randomUUID } from 'crypto';
import type { MemoryEngine } from '../core/MemoryEngine.js';
import type { VerificationStep } from '../playwright/types.js';
import {
  SubtaskStatus,
  type CodexTask,
  type Subtask,
  type SubtaskType,
  type DecomposeRequest,
  type DecomposeResult,
  type Ambiguity,
  type DependencyGraph
} from './types.js';

/**
 * Decomposition prompt template
 */
const DECOMPOSE_PROMPT = `You are decomposing a development task into subtasks.

Each subtask should be:
- Independently executable (doesn't depend on unfinished subtasks except explicit dependencies)
- Testable (clear success criteria)
- Small enough to complete in one focused session
- Ordered by dependencies

Subtask types:
- research: Understanding existing code, patterns, or requirements
- design: Planning architecture, schema, or API design
- code: Writing new code or modifying existing code
- test: Writing tests (unit, integration, e2e)
- integrate: Connecting components, wiring up dependencies
- verify: End-to-end verification of functionality
- review: Code review and quality checks

For each subtask, include:
1. Type (research/design/code/test/integrate/verify/review)
2. Clear description of what to do
3. Dependencies (IDs of subtasks that must complete first)
4. Verification steps (how to verify this subtask is complete)

Also identify:
- Ambiguities: Parts of the spec that are unclear or have multiple valid interpretations
- Critical decisions: Choices that need user input before proceeding

Return your response as JSON in this exact format:
{
  "subtasks": [
    {
      "type": "research",
      "description": "Understand existing data models and patterns",
      "dependencies": [],
      "verification": [
        { "type": "console_check", "description": "No errors during exploration" }
      ]
    }
  ],
  "estimatedComplexity": "medium",
  "ambiguities": [
    {
      "description": "Unclear whether to use REST or GraphQL for API",
      "critical": true,
      "possibleInterpretations": ["REST endpoints", "GraphQL schema"],
      "suggestedQuestion": "Should the API use REST or GraphQL?"
    }
  ]
}`;

/**
 * TaskDecomposer - Break tasks into subtasks
 */
export class TaskDecomposer {
  private engine: MemoryEngine;

  constructor(engine: MemoryEngine) {
    this.engine = engine;
  }

  /**
   * Decompose a task into subtasks
   */
  async decompose(request: DecomposeRequest): Promise<DecomposeResult> {
    const { task } = request;
    // Note: codebaseContext and existingPatterns will be used in production with Claude API

    // Query memory for similar past decompositions (for future LLM integration)
    await this.findSimilarDecompositions(task.description);

    // For now, use a rule-based decomposition
    // In production, this would call Claude API with buildDecomposePrompt()
    const decomposition = await this.performDecomposition(task);

    // Build dependency graph
    const dependencies = this.buildDependencyGraph(decomposition.subtasks);

    // Store the decomposition pattern in memory
    await this.storeDecompositionPattern(task, decomposition);

    return {
      ...decomposition,
      dependencies
    };
  }

  /**
   * Find similar past decompositions from memory
   */
  private async findSimilarDecompositions(description: string): Promise<string[]> {
    try {
      const results = await this.engine.query(
        `task decomposition: ${description}`,
        {
          topK: 3,
          filters: {
            tags: ['codex', 'decomposition'],
            minImportance: 0.5
          }
        }
      );

      return results.map(r => r.entry.content);
    } catch {
      return [];
    }
  }

  /**
   * Build the decomposition prompt for Claude API
   * Exposed publicly for debugging and future LLM integration
   */
  buildDecomposePrompt(
    task: CodexTask,
    codebaseContext: string,
    existingPatterns?: string[],
    similarTasks?: string[]
  ): string {
    let prompt = DECOMPOSE_PROMPT + '\n\n';

    prompt += `## Task\n${task.description}\n\n`;

    if (task.specification) {
      prompt += `## Specification\n${task.specification}\n\n`;
    }

    if (task.constraints && task.constraints.length > 0) {
      prompt += `## Constraints\n${task.constraints.map(c => `- ${c}`).join('\n')}\n\n`;
    }

    prompt += `## Codebase Context\n${codebaseContext}\n\n`;

    if (existingPatterns && existingPatterns.length > 0) {
      prompt += `## Existing Patterns in Codebase\n${existingPatterns.join('\n')}\n\n`;
    }

    if (similarTasks && similarTasks.length > 0) {
      prompt += `## Similar Past Tasks\n${similarTasks.join('\n---\n')}\n\n`;
    }

    return prompt;
  }

  /**
   * Perform the actual decomposition
   * In production, this would call Claude API
   */
  private async performDecomposition(
    task: CodexTask
  ): Promise<Omit<DecomposeResult, 'dependencies'>> {
    // Rule-based decomposition for common patterns
    const subtasks: Subtask[] = [];
    const ambiguities: Ambiguity[] = [];

    const description = task.description.toLowerCase();

    // Research phase
    subtasks.push(this.createSubtask(task.id, 'research',
      `Understand existing codebase structure and patterns relevant to: ${task.description}`,
      [], 0
    ));

    // Design phase (if building something new)
    if (description.includes('build') || description.includes('create') || description.includes('implement')) {
      subtasks.push(this.createSubtask(task.id, 'design',
        `Design the architecture and data model for: ${task.description}`,
        [subtasks[0].id], 1
      ));

      // Add ambiguity if design choices are needed
      if (description.includes('api') || description.includes('endpoint')) {
        ambiguities.push({
          id: randomUUID(),
          description: 'API design approach needs clarification',
          critical: false,
          possibleInterpretations: ['RESTful endpoints', 'GraphQL schema', 'RPC-style'],
          suggestedQuestion: 'What API style should be used?'
        });
      }
    }

    // Code phase
    const codeDeps = subtasks.length > 1 ? [subtasks[1].id] : [subtasks[0].id];
    subtasks.push(this.createSubtask(task.id, 'code',
      `Implement the core functionality for: ${task.description}`,
      codeDeps, subtasks.length
    ));

    // Test phase
    subtasks.push(this.createSubtask(task.id, 'test',
      `Write tests for the implemented functionality`,
      [subtasks[subtasks.length - 1].id], subtasks.length
    ));

    // Integration phase (if connecting to existing system)
    if (description.includes('integrate') || description.includes('connect') || description.includes('with')) {
      subtasks.push(this.createSubtask(task.id, 'integrate',
        `Integrate the new functionality with existing systems`,
        [subtasks[subtasks.length - 1].id], subtasks.length
      ));
    }

    // Verification phase
    subtasks.push(this.createSubtask(task.id, 'verify',
      `End-to-end verification of the complete implementation`,
      [subtasks[subtasks.length - 1].id], subtasks.length
    ));

    // Review phase
    subtasks.push(this.createSubtask(task.id, 'review',
      `Code review and quality check before completion`,
      [subtasks[subtasks.length - 1].id], subtasks.length
    ));

    // Estimate complexity
    const estimatedComplexity = this.estimateComplexity(task, subtasks);

    return {
      subtasks,
      estimatedComplexity,
      ambiguities
    };
  }

  /**
   * Create a subtask with default values
   */
  private createSubtask(
    taskId: string,
    type: SubtaskType,
    description: string,
    dependencies: string[],
    order: number
  ): Subtask {
    const id = randomUUID();

    return {
      id,
      taskId,
      type,
      description,
      dependencies,
      verification: this.getDefaultVerification(type),
      maxAttempts: 3,
      attempts: [],
      status: SubtaskStatus.PENDING,
      order,
      createdAt: new Date()
    };
  }

  /**
   * Get default verification steps for a subtask type
   */
  private getDefaultVerification(type: SubtaskType): VerificationStep[] {
    switch (type) {
      case 'research':
        return [{
          id: randomUUID(),
          type: 'console_check',
          description: 'No errors during codebase exploration',
          params: { noErrors: true },
          required: false
        }];

      case 'design':
        return [{
          id: randomUUID(),
          type: 'console_check',
          description: 'Design documented without errors',
          params: { noErrors: true },
          required: false
        }];

      case 'code':
        return [
          {
            id: randomUUID(),
            type: 'console_check',
            description: 'No compilation errors',
            params: { noErrors: true },
            required: true
          },
          {
            id: randomUUID(),
            type: 'test',
            description: 'Tests pass',
            params: { testFile: '**/*.test.ts' },
            required: true
          }
        ];

      case 'test':
        return [{
          id: randomUUID(),
          type: 'test',
          description: 'All tests pass',
          params: { testFile: '**/*.test.ts' },
          required: true
        }];

      case 'integrate':
        return [
          {
            id: randomUUID(),
            type: 'console_check',
            description: 'No integration errors',
            params: { noErrors: true },
            required: true
          },
          {
            id: randomUUID(),
            type: 'test',
            description: 'Integration tests pass',
            params: { testFile: '**/*.integration.test.ts' },
            required: false
          }
        ];

      case 'verify':
        return [
          {
            id: randomUUID(),
            type: 'screenshot',
            description: 'Capture verification screenshot',
            params: { fullPage: true, label: 'verification' },
            required: false
          },
          {
            id: randomUUID(),
            type: 'console_check',
            description: 'No console errors',
            params: { noErrors: true },
            required: true
          }
        ];

      case 'review':
        return [{
          id: randomUUID(),
          type: 'console_check',
          description: 'Lint and type checks pass',
          params: { noErrors: true, noWarnings: false },
          required: true
        }];

      default:
        return [];
    }
  }

  /**
   * Build dependency graph from subtasks
   */
  private buildDependencyGraph(subtasks: Subtask[]): DependencyGraph {
    const nodes = subtasks.map(s => s.id);
    const edges: Array<{ from: string; to: string }> = [];

    for (const subtask of subtasks) {
      for (const depId of subtask.dependencies) {
        edges.push({ from: depId, to: subtask.id });
      }
    }

    // Topological sort for execution order
    const executionOrder = this.topologicalSort(subtasks);

    return { nodes, edges, executionOrder };
  }

  /**
   * Topological sort for execution order
   */
  private topologicalSort(subtasks: Subtask[]): string[] {
    const sorted: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const subtaskMap = new Map(subtasks.map(s => [s.id, s]));

    const visit = (id: string) => {
      if (visited.has(id)) return;
      if (visiting.has(id)) {
        throw new Error(`Circular dependency detected at subtask ${id}`);
      }

      visiting.add(id);

      const subtask = subtaskMap.get(id);
      if (subtask) {
        for (const dep of subtask.dependencies) {
          visit(dep);
        }
      }

      visiting.delete(id);
      visited.add(id);
      sorted.push(id);
    };

    for (const subtask of subtasks) {
      visit(subtask.id);
    }

    return sorted;
  }

  /**
   * Estimate task complexity
   */
  private estimateComplexity(
    task: CodexTask,
    subtasks: Subtask[]
  ): 'low' | 'medium' | 'high' {
    const description = task.description.toLowerCase();

    // High complexity indicators
    const highComplexityKeywords = [
      'architecture', 'refactor', 'migrate', 'redesign',
      'security', 'authentication', 'authorization',
      'database', 'schema', 'migration'
    ];

    if (highComplexityKeywords.some(k => description.includes(k))) {
      return 'high';
    }

    // Medium complexity indicators
    if (subtasks.length > 5) {
      return 'medium';
    }

    // Low complexity for simple tasks
    if (subtasks.length <= 3 && !description.includes('api') && !description.includes('test')) {
      return 'low';
    }

    return 'medium';
  }

  /**
   * Store decomposition pattern in memory for learning
   */
  private async storeDecompositionPattern(
    task: CodexTask,
    decomposition: Omit<DecomposeResult, 'dependencies'>
  ): Promise<void> {
    try {
      const content = `Task Decomposition Pattern:
Task: ${task.description}
Complexity: ${decomposition.estimatedComplexity}
Subtasks: ${decomposition.subtasks.length}
Types: ${decomposition.subtasks.map(s => s.type).join(', ')}
Ambiguities: ${decomposition.ambiguities.length}`;

      await this.engine.store(content, {
        tags: ['codex', 'decomposition', `complexity:${decomposition.estimatedComplexity}`],
        importance: 0.6
      });
    } catch {
      // Ignore storage errors
    }
  }

  /**
   * Redecompose a task with additional context
   */
  async redecompose(
    task: CodexTask,
    additionalContext: string,
    resolvedAmbiguities: Record<string, string>
  ): Promise<DecomposeResult> {
    // Update task with resolved ambiguities
    const updatedTask = {
      ...task,
      specification: `${task.specification || ''}\n\nResolved clarifications:\n${
        Object.entries(resolvedAmbiguities)
          .map(([q, a]) => `Q: ${q}\nA: ${a}`)
          .join('\n\n')
      }`
    };

    return this.decompose({
      task: updatedTask,
      codebaseContext: additionalContext
    });
  }
}

export default TaskDecomposer;
