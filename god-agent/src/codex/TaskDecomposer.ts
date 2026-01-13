/**
 * TaskDecomposer
 *
 * Breaks high-level tasks into executable subtasks with dependencies.
 * Uses Claude API for intelligent decomposition and ambiguity detection.
 */

import { randomUUID } from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import type { MemoryEngine } from '../core/MemoryEngine.js';
import type { VerificationStep } from '../playwright/types.js';
import { getCodexLLMConfig } from '../core/config.js';
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
import { SelfKnowledgeInjector } from '../prompts/SelfKnowledgeInjector.js';

/**
 * Decomposition prompt template (compressed)
 */
const DECOMPOSE_PROMPT = `DECOMPOSE
TYPES:research,design,code,test,integrate,verify,review
RULES:independent,testable,ordered_deps,one_session
→{subtasks:[{type,description,dependencies:[],verification:[]}],estimatedComplexity:low|medium|high,ambiguities:[{description,critical:bool,possibleInterpretations:[],suggestedQuestion}]}`;

/**
 * TaskDecomposer - Break tasks into subtasks using Claude API
 */
export class TaskDecomposer {
  private engine: MemoryEngine;
  private client: Anthropic | null = null;
  private model: string;
  private useClaudeAPI: boolean = false;

  constructor(engine: MemoryEngine) {
    this.engine = engine;

    // Initialize Claude client if API key is available
    const llmConfig = getCodexLLMConfig();
    this.model = llmConfig.model ?? 'claude-opus-4-5-20251101';

    if (llmConfig.apiKey) {
      this.client = new Anthropic({ apiKey: llmConfig.apiKey });
      this.useClaudeAPI = true;
      console.log(`[TaskDecomposer] Claude API enabled (model: ${this.model})`);
    } else {
      console.warn('[TaskDecomposer] ANTHROPIC_API_KEY not set - using rule-based decomposition');
    }
  }

  /**
   * Decompose a task into subtasks
   */
  async decompose(request: DecomposeRequest): Promise<DecomposeResult & { needsClarification?: boolean; clarificationText?: string }> {
    const { task, codebaseContext } = request;

    // Perform decomposition (Claude API if available, otherwise rule-based)
    const decomposition = await this.performDecomposition(task, codebaseContext);

    // If Claude needs clarification, return early with the questions
    if (decomposition.needsClarification) {
      console.log(`[TaskDecomposer] Returning clarification request to caller`);
      return {
        ...decomposition,
        dependencies: { nodes: [], edges: [], executionOrder: [] }
      };
    }

    // Build dependency graph
    const dependencies = this.buildDependencyGraph(decomposition.subtasks);

    // Store the decomposition pattern in memory (only if we got actual subtasks)
    if (decomposition.subtasks.length > 0) {
      await this.storeDecompositionPattern(task, decomposition);
    }

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
   * Perform the actual decomposition using Claude API or fallback to rule-based
   */
  private async performDecomposition(
    task: CodexTask,
    codebaseContext?: string
  ): Promise<Omit<DecomposeResult, 'dependencies'> & { needsClarification?: boolean; clarificationText?: string }> {
    // Use Claude API if available
    if (this.useClaudeAPI && this.client) {
      return this.performClaudeDecomposition(task, codebaseContext);
    }

    // Fall back to rule-based decomposition
    return this.performRuleBasedDecomposition(task);
  }

  /**
   * Decompose using Claude API for intelligent task breakdown
   */
  private async performClaudeDecomposition(
    task: CodexTask,
    codebaseContext?: string
  ): Promise<Omit<DecomposeResult, 'dependencies'> & { needsClarification?: boolean; clarificationText?: string }> {
    console.log(`[TaskDecomposer] Calling Claude API for task decomposition`);

    try {
      // Build prompt with task details and codebase context
      const prompt = this.buildDecomposePrompt(
        task,
        codebaseContext || 'No codebase context provided.',
        undefined,
        await this.findSimilarDecompositions(task.description)
      );

      // RUBIX identity + compressed system prompt
      const identity = SelfKnowledgeInjector.getIdentity('task_decomposer');
      const response = await this.client!.messages.create({
        model: this.model,
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
        system: `${identity}

DECOMPOSE_AGENT
ROLE:architect,break_tasks,order_deps
OUT_SCHEMA:{subtasks:[{type,description,dependencies:[]}],estimatedComplexity:low|medium|high,ambiguities:[{description,critical,possibleInterpretations:[],suggestedQuestion}]}
CLARIFY_SCHEMA:{needsClarification:true,questions:[],reason:""}
RULE:json_only,no_prose`
      });

      const textContent = response.content.find(block => block.type === 'text');
      if (!textContent || textContent.type !== 'text') {
        console.warn('[TaskDecomposer] No text response from Claude, falling back to rule-based');
        return this.performRuleBasedDecomposition(task);
      }

      console.log(`[TaskDecomposer] Claude response length: ${textContent.text.length} chars`);

      // Parse JSON response
      const parsed = this.parseClaudeResponse(textContent.text, task);
      if (!parsed) {
        console.warn('[TaskDecomposer] Failed to parse Claude response, falling back to rule-based');
        return this.performRuleBasedDecomposition(task);
      }

      return parsed;

    } catch (error) {
      console.error('[TaskDecomposer] Claude API error:', error);
      console.warn('[TaskDecomposer] Falling back to rule-based decomposition');
      return this.performRuleBasedDecomposition(task);
    }
  }

  /**
   * Parse Claude's JSON response into DecomposeResult
   */
  private parseClaudeResponse(
    text: string,
    task: CodexTask
  ): (Omit<DecomposeResult, 'dependencies'> & { needsClarification?: boolean; clarificationText?: string }) | null {
    try {
      // Try to extract JSON from the response (handle markdown code blocks)
      let jsonStr = text.trim();

      // Remove markdown code block if present
      const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1].trim();
      }

      const parsed = JSON.parse(jsonStr);

      // Check if Claude is asking for clarification
      if (parsed.needsClarification) {
        const questions = parsed.questions || [];
        const reason = parsed.reason || 'Additional information needed';
        const clarificationText = `${reason}\n\nQuestions:\n${questions.map((q: string, i: number) => `${i + 1}. ${q}`).join('\n')}`;

        console.log(`[TaskDecomposer] Claude needs clarification: ${questions.length} questions`);

        return {
          subtasks: [],
          estimatedComplexity: 'medium',
          ambiguities: questions.map((q: string) => ({
            id: randomUUID(),
            description: q,
            critical: true,
            possibleInterpretations: [],
            suggestedQuestion: q
          })),
          needsClarification: true,
          clarificationText
        };
      }

      // Validate and convert subtasks
      if (!parsed.subtasks || !Array.isArray(parsed.subtasks)) {
        console.warn('[TaskDecomposer] Invalid subtasks in response');
        return null;
      }

      const subtasks: Subtask[] = parsed.subtasks.map((st: any, index: number) => {
        // Map dependencies from string descriptions to actual IDs
        // For now, use sequential dependencies based on order
        const previousIds = index > 0 ? [parsed.subtasks[index - 1]?.id].filter(Boolean) : [];

        return this.createSubtask(
          task.id,
          this.validateSubtaskType(st.type),
          st.description || `Subtask ${index + 1}`,
          previousIds,
          index
        );
      });

      // Re-map dependencies now that we have actual IDs
      for (let i = 0; i < subtasks.length; i++) {
        const originalDeps = parsed.subtasks[i]?.dependencies || [];
        if (Array.isArray(originalDeps) && originalDeps.length > 0) {
          // Map numeric indices to actual subtask IDs
          subtasks[i].dependencies = originalDeps
            .map((dep: number | string) => {
              if (typeof dep === 'number' && dep >= 0 && dep < subtasks.length) {
                return subtasks[dep].id;
              }
              return null;
            })
            .filter(Boolean) as string[];
        } else if (i > 0) {
          // Default: depend on previous subtask
          subtasks[i].dependencies = [subtasks[i - 1].id];
        }
      }

      // Parse ambiguities
      const ambiguities: Ambiguity[] = (parsed.ambiguities || []).map((amb: any) => ({
        id: randomUUID(),
        description: amb.description || 'Unknown ambiguity',
        critical: amb.critical ?? false,
        possibleInterpretations: amb.possibleInterpretations || [],
        suggestedQuestion: amb.suggestedQuestion || amb.description
      }));

      // Validate complexity
      const validComplexities = ['low', 'medium', 'high'];
      const estimatedComplexity = validComplexities.includes(parsed.estimatedComplexity)
        ? parsed.estimatedComplexity as 'low' | 'medium' | 'high'
        : 'medium';

      console.log(`[TaskDecomposer] Parsed ${subtasks.length} subtasks, ${ambiguities.length} ambiguities, complexity: ${estimatedComplexity}`);

      return {
        subtasks,
        estimatedComplexity,
        ambiguities
      };

    } catch (error) {
      console.error('[TaskDecomposer] JSON parse error:', error);
      return null;
    }
  }

  /**
   * Validate subtask type string
   */
  private validateSubtaskType(type: string): SubtaskType {
    const validTypes: SubtaskType[] = ['research', 'design', 'code', 'test', 'integrate', 'verify', 'review'];
    const normalized = (type || 'code').toLowerCase() as SubtaskType;
    return validTypes.includes(normalized) ? normalized : 'code';
  }

  /**
   * Rule-based decomposition fallback (original implementation)
   */
  private performRuleBasedDecomposition(
    task: CodexTask
  ): Omit<DecomposeResult, 'dependencies'> {
    console.log('[TaskDecomposer] Using rule-based decomposition');

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
