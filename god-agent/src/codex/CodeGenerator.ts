/**
 * CodeGenerator
 *
 * Generates code using Claude API and manages file operations.
 * This is the execution engine that makes RUBIX actually write code.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { Message, ContentBlock } from '@anthropic-ai/sdk/resources/messages';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { Subtask, CodexTask, SubtaskAttempt } from './types.js';
import type { ExtendedThinkingConfig } from '../core/types.js';
import { ContainmentManager } from './ContainmentManager.js';
import type { WolframManager } from '../capabilities/wolfram/WolframManager.js';

const execAsync = promisify(exec);

/**
 * Code generation request
 */
export interface CodeGenRequest {
  task: CodexTask;
  subtask: Subtask;
  attempt: SubtaskAttempt;
  codebaseContext: string;
  existingFiles?: Map<string, string>;
  previousAttempts?: SubtaskAttempt[];
}

/**
 * Code generation result
 */
export interface CodeGenResult {
  success: boolean;
  filesCreated: string[];
  filesModified: string[];
  output: string;
  error?: string;
  tokensUsed?: number;
  /** Extended thinking content (if ultrathink was enabled) */
  thinkingContent?: string;
  /** Thinking tokens used (if ultrathink was enabled) */
  thinkingTokensUsed?: number;
}

/**
 * File operation from Claude's response
 */
interface FileOperation {
  action: 'create' | 'modify' | 'delete';
  path: string;
  content?: string;
  description: string;
}

/**
 * Configuration for CodeGenerator
 */
export interface CodeGeneratorConfig {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  codebaseRoot: string;
  /** Extended thinking (ultrathink) configuration */
  extendedThinking?: ExtendedThinkingConfig;
}

/**
 * CodeGenerator - Claude-powered code generation
 */
export class CodeGenerator {
  private client: Anthropic;
  private config: CodeGeneratorConfig;
  private model: string;
  private containment: ContainmentManager | undefined;
  private wolfram: WolframManager | undefined;

  constructor(config: CodeGeneratorConfig) {
    if (!config.apiKey) {
      throw new Error('ANTHROPIC_API_KEY is required for code generation');
    }

    this.config = config;
    this.model = config.model || 'claude-opus-4-5-20251101';
    this.client = new Anthropic({ apiKey: config.apiKey });
  }

  /**
   * Generate code for a subtask
   * @param request The code generation request
   * @param thinkingBudget Optional thinking budget for ultrathink mode (tokens)
   */
  async generate(request: CodeGenRequest, thinkingBudget?: number): Promise<CodeGenResult> {
    const { task, subtask, attempt, codebaseContext, previousAttempts } = request;

    try {
      // Build the prompt
      const prompt = this.buildPrompt(task, subtask, attempt, codebaseContext, previousAttempts);
      const systemPrompt = this.getSystemPrompt();

      // Get available tools (Wolfram, web search, etc.)
      const tools = this.getTools();
      if (tools.length > 0) {
        console.log(`[CodeGenerator] ${tools.length} tools available: ${tools.map(t => t.name).join(', ')}`);
      }

      // Log ultrathink status
      if (thinkingBudget) {
        console.log(`[CodeGenerator] Ultrathink enabled: ${thinkingBudget} token budget`);
      }

      // Build initial messages
      type MessageRole = 'user' | 'assistant';
      interface MessageContent {
        type: 'text' | 'tool_result' | 'tool_use';
        text?: string;
        tool_use_id?: string;
        content?: string;
        id?: string;
        name?: string;
        input?: Record<string, unknown>;
      }
      const messages: Array<{ role: MessageRole; content: string | MessageContent[] }> = [
        { role: 'user', content: prompt }
      ];

      // Accumulate thinking content across turns
      let allThinkingContent = '';
      let totalTokensUsed = 0;
      const MAX_TOOL_TURNS = 10; // Prevent infinite loops

      // Tool use loop - keep calling Claude until it provides a final response
      for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
        console.log(`[CodeGenerator] API turn ${turn + 1}/${MAX_TOOL_TURNS}`);

        // Call Claude API with tools
        const response = await this.callWithThinkingAndTools(
          messages,
          systemPrompt,
          tools,
          thinkingBudget
        );

        totalTokensUsed += response.usage.input_tokens + response.usage.output_tokens;

        // Extract thinking content
        const thinkingContent = this.extractThinkingContent(response);
        if (thinkingContent) {
          allThinkingContent += (allThinkingContent ? '\n\n---\n\n' : '') + thinkingContent;
          console.log(`[CodeGenerator] Extended thinking: ${thinkingContent.length} chars`);
        }

        // Check for tool use blocks
        const toolUseBlocks = response.content.filter(block => block.type === 'tool_use');

        if (toolUseBlocks.length > 0) {
          console.log(`[CodeGenerator] Claude requested ${toolUseBlocks.length} tool call(s)`);

          // Add assistant's response to messages
          messages.push({ role: 'assistant', content: response.content as MessageContent[] });

          // Execute each tool and collect results
          const toolResults: MessageContent[] = [];
          for (const toolBlock of toolUseBlocks) {
            if (toolBlock.type === 'tool_use') {
              const result = await this.executeTool(
                toolBlock.name,
                toolBlock.input as Record<string, unknown>
              );
              toolResults.push({
                type: 'tool_result',
                tool_use_id: toolBlock.id,
                content: result
              });
            }
          }

          // Add tool results to messages
          messages.push({ role: 'user', content: toolResults });

          // Continue loop for Claude to process results
          continue;
        }

        // No tool use - this is the final response
        // Find the text content block
        const textContent = response.content.find(block => block.type === 'text');
        if (!textContent || textContent.type !== 'text') {
          return {
            success: false,
            filesCreated: [],
            filesModified: [],
            output: 'Unexpected response type from Claude',
            error: 'No text response',
            thinkingContent: allThinkingContent || undefined
          };
        }

        // Log response for debugging
        console.log(`[CodeGenerator] Claude response length: ${textContent.text.length} chars`);
        console.log(`[CodeGenerator] Response preview: ${textContent.text.substring(0, 500)}...`);

        // Extract file operations from response
        const operations = this.parseFileOperations(textContent.text);
        console.log(`[CodeGenerator] Parsed ${operations.length} file operations`);

        if (operations.length === 0) {
          // Check if Claude is asking clarifying questions instead of generating code
          const clarificationPatterns = [
            /clarif(y|ying|ication)/i,
            /before (I |we )?(can )?(start|begin|proceed|implement)/i,
            /questions?.*:/i,
            /need(s)? (more |additional )?information/i,
            /please (confirm|specify|clarify)/i,
            /could you (please )?(confirm|specify|clarify)/i,
            /would you (like|prefer)/i
          ];

          const askedQuestions = clarificationPatterns.some(p => p.test(textContent.text));

          if (askedQuestions) {
            console.log('[CodeGenerator] Claude requested clarification instead of generating code');
            return {
              success: false,
              filesCreated: [],
              filesModified: [],
              output: textContent.text,
              error: 'CLARIFICATION_NEEDED',
              tokensUsed: totalTokensUsed,
              thinkingContent: allThinkingContent || undefined,
              thinkingTokensUsed: this.countThinkingTokens(response)
            };
          }

          // Log warning - expected files but got none
          console.warn(`[CodeGenerator] WARNING: No file operations found in response!`);
          console.warn(`[CodeGenerator] Looking for <file path="..." action="...">...</file> blocks`);

          // Check if response contains any file-like patterns we might be missing
          const hasFileTag = /<file[\s>]/i.test(textContent.text);
          const hasCodeBlock = /```[\w]*\n/.test(textContent.text);
          console.warn(`[CodeGenerator] Contains <file> tag: ${hasFileTag}, Contains code blocks: ${hasCodeBlock}`);

          // This is a FAILURE - we expected code but Claude didn't produce proper file operations
          // The response may contain code blocks but not in the expected format
          return {
            success: false,
            filesCreated: [],
            filesModified: [],
            output: textContent.text,
            error: hasFileTag || hasCodeBlock
              ? 'No file operations parsed - code found but format incorrect (expected <file path="..." action="create|modify">)'
              : 'No file operations generated - Claude did not produce code',
            tokensUsed: totalTokensUsed,
            thinkingContent: allThinkingContent || undefined,
            thinkingTokensUsed: this.countThinkingTokens(response)
          };
        }

        // Execute file operations - use task's codebase if provided, fall back to config
        const codebaseRoot = task.codebase || this.config.codebaseRoot;
        const { filesCreated, filesModified, errors } = await this.executeOperations(operations, codebaseRoot);

        if (errors.length > 0) {
          return {
            success: false,
            filesCreated,
            filesModified,
            output: `Partial success. Errors: ${errors.join('; ')}`,
            error: errors.join('; '),
            tokensUsed: totalTokensUsed,
            thinkingContent: allThinkingContent || undefined,
            thinkingTokensUsed: this.countThinkingTokens(response)
          };
        }

        return {
          success: true,
          filesCreated,
          filesModified,
          output: `Generated ${filesCreated.length} new files, modified ${filesModified.length} files`,
          tokensUsed: totalTokensUsed,
          thinkingContent: allThinkingContent || undefined,
          thinkingTokensUsed: this.countThinkingTokens(response)
        };
      }

      // If we reach here, we hit MAX_TOOL_TURNS
      return {
        success: false,
        filesCreated: [],
        filesModified: [],
        output: 'Max tool turns exceeded',
        error: 'Too many tool calls - possible infinite loop',
        tokensUsed: totalTokensUsed,
        thinkingContent: allThinkingContent || undefined
      };

    } catch (error) {
      return {
        success: false,
        filesCreated: [],
        filesModified: [],
        output: '',
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Call Claude API with tools and optional extended thinking
   * Used for the tool use loop where we need to pass multi-turn messages
   */
  private async callWithThinkingAndTools(
    messages: Array<{ role: 'user' | 'assistant'; content: unknown }>,
    systemPrompt: string,
    tools: Anthropic.Messages.Tool[],
    thinkingBudget?: number
  ): Promise<Message> {
    console.log(`[CodeGenerator] Calling Claude API with tools (model: ${this.model})`);
    console.log(`[CodeGenerator] Messages: ${messages.length}, Tools: ${tools.length}`);

    const baseParams = {
      model: this.model,
      max_tokens: this.config.maxTokens || 8192,
      messages: messages as Anthropic.Messages.MessageParam[],
      system: systemPrompt,
      tools: tools.length > 0 ? tools : undefined
    };

    try {
      let response: Message;

      if (thinkingBudget && thinkingBudget >= 1024) {
        // Use beta endpoint with extended thinking
        console.log(`[CodeGenerator] Using extended thinking with budget: ${thinkingBudget}`);
        response = await this.client.messages.create({
          ...baseParams,
          thinking: {
            type: 'enabled',
            budget_tokens: thinkingBudget
          }
        }, {
          headers: {
            'anthropic-beta': 'interleaved-thinking-2025-05-14'
          }
        });
      } else {
        // Standard call without thinking
        response = await this.client.messages.create(baseParams);
      }

      console.log(`[CodeGenerator] API call successful. Usage: ${response.usage.input_tokens} in, ${response.usage.output_tokens} out`);
      console.log(`[CodeGenerator] Stop reason: ${response.stop_reason}`);
      return response;
    } catch (error) {
      console.error(`[CodeGenerator] API call FAILED:`, error);
      throw error;
    }
  }

  /**
   * Extract thinking content from response
   */
  private extractThinkingContent(response: Message): string | undefined {
    const thinkingBlocks = response.content.filter(
      (block): block is ContentBlock & { type: 'thinking'; thinking: string } =>
        block.type === 'thinking'
    );

    if (thinkingBlocks.length === 0) return undefined;

    return thinkingBlocks.map(b => b.thinking).join('\n\n');
  }

  /**
   * Count thinking tokens from response (estimate)
   */
  private countThinkingTokens(response: Message): number {
    const thinking = this.extractThinkingContent(response);
    if (!thinking) return 0;
    // Rough estimate: ~4 chars per token
    return Math.ceil(thinking.length / 4);
  }

  /**
   * Get system prompt for code generation
   */
  private getSystemPrompt(): string {
    return `You are RUBIX, an autonomous code generation agent. Your job is to write production-quality code based on the task specification.

CRITICAL RULES:
1. Write COMPLETE, WORKING code - no placeholders, no TODOs, no "implement this"
2. Follow existing patterns in the codebase context provided
3. Use TypeScript with strict typing
4. Include proper error handling
5. Write clean, readable code with minimal comments (code should be self-documenting)

OUTPUT FORMAT:
For each file you need to create or modify, use this exact format:

<file path="relative/path/to/file.ts" action="create|modify">
// Complete file contents here
</file>

If modifying an existing file, include the COMPLETE new file contents, not just the changes.

IMPORTANT:
- Always output complete, runnable code
- Never use ellipsis (...) or "rest of code" comments
- Include all necessary imports
- Follow the existing code style from the context`;
  }

  /**
   * Build the generation prompt
   */
  private buildPrompt(
    task: CodexTask,
    subtask: Subtask,
    attempt: SubtaskAttempt,
    codebaseContext: string,
    previousAttempts?: SubtaskAttempt[]
  ): string {
    let prompt = `## Task
${task.description}

`;

    if (task.specification) {
      prompt += `## Specification
${task.specification}

`;
    }

    if (task.constraints && task.constraints.length > 0) {
      prompt += `## Constraints
${task.constraints.map(c => `- ${c}`).join('\n')}

`;
    }

    prompt += `## Current Subtask
Type: ${subtask.type}
Description: ${subtask.description}
Attempt: ${attempt.attemptNumber}
Approach: ${attempt.approach}

`;

    prompt += `## Codebase Context
${codebaseContext}

`;

    // Include previous attempt errors if retrying
    if (previousAttempts && previousAttempts.length > 0) {
      prompt += `## Previous Attempts (learn from these failures)
`;
      for (const prev of previousAttempts) {
        if (prev.error) {
          prompt += `Attempt ${prev.attemptNumber}: ${prev.approach}
Error: ${prev.error}
${prev.consoleErrors ? `Console Errors:\n${prev.consoleErrors.join('\n')}` : ''}

`;
        }
      }
    }

    prompt += `## Your Task
Generate the necessary code to complete this subtask. Output complete file contents using the <file> format specified in the system prompt.`;

    return prompt;
  }

  /**
   * Parse file operations from Claude's response
   * Supports multiple formats for flexibility
   */
  private parseFileOperations(text: string): FileOperation[] {
    const operations: FileOperation[] = [];

    // Format 1: <file path="..." action="...">...</file>
    const fileRegex1 = /<file\s+path="([^"]+)"\s+action="(create|modify)">([\s\S]*?)<\/file>/g;

    // Format 2: <file action="..." path="...">...</file> (reversed attributes)
    const fileRegex2 = /<file\s+action="(create|modify)"\s+path="([^"]+)">([\s\S]*?)<\/file>/g;

    // Format 3: More flexible - any attribute order with optional whitespace
    const fileRegex3 = /<file\s+(?:[^>]*?)path="([^"]+)"(?:[^>]*?)action="(create|modify)"(?:[^>]*?)>([\s\S]*?)<\/file>/gi;
    const fileRegex4 = /<file\s+(?:[^>]*?)action="(create|modify)"(?:[^>]*?)path="([^"]+)"(?:[^>]*?)>([\s\S]*?)<\/file>/gi;

    let match;

    // Try format 1: path first
    while ((match = fileRegex1.exec(text)) !== null) {
      operations.push({
        action: match[2] as 'create' | 'modify',
        path: match[1],
        content: match[3].trim(),
        description: `${match[2]} ${match[1]}`
      });
      console.log(`[CodeGenerator] Parsed file (format 1): ${match[2]} ${match[1]}`);
    }

    // If nothing found, try format 2: action first
    if (operations.length === 0) {
      while ((match = fileRegex2.exec(text)) !== null) {
        operations.push({
          action: match[1] as 'create' | 'modify',
          path: match[2],
          content: match[3].trim(),
          description: `${match[1]} ${match[2]}`
        });
        console.log(`[CodeGenerator] Parsed file (format 2): ${match[1]} ${match[2]}`);
      }
    }

    // If still nothing, try flexible formats
    if (operations.length === 0) {
      while ((match = fileRegex3.exec(text)) !== null) {
        operations.push({
          action: match[2] as 'create' | 'modify',
          path: match[1],
          content: match[3].trim(),
          description: `${match[2]} ${match[1]}`
        });
        console.log(`[CodeGenerator] Parsed file (format 3): ${match[2]} ${match[1]}`);
      }
    }

    if (operations.length === 0) {
      while ((match = fileRegex4.exec(text)) !== null) {
        operations.push({
          action: match[1] as 'create' | 'modify',
          path: match[2],
          content: match[3].trim(),
          description: `${match[1]} ${match[2]}`
        });
        console.log(`[CodeGenerator] Parsed file (format 4): ${match[1]} ${match[2]}`);
      }
    }

    return operations;
  }

  /**
   * Execute file operations
   * @param operations File operations to execute
   * @param codebaseRoot Root directory for file operations (from task or config)
   */
  private async executeOperations(operations: FileOperation[], codebaseRoot: string): Promise<{
    filesCreated: string[];
    filesModified: string[];
    errors: string[];
  }> {
    const filesCreated: string[] = [];
    const filesModified: string[] = [];
    const errors: string[] = [];

    console.log(`[CodeGenerator] Writing files to codebase: ${codebaseRoot}`);

    for (const op of operations) {
      try {
        const fullPath = join(codebaseRoot, op.path);
        const dir = dirname(fullPath);

        // === CONTAINMENT CHECK ===
        // Verify we have permission to write to this path
        if (this.containment) {
          const permission = this.containment.checkPermission(fullPath, 'write');
          if (!permission.allowed) {
            const msg = `Containment blocked ${op.action} to ${op.path}: ${permission.reason}`;
            console.warn(`[CodeGenerator] ${msg}`);
            errors.push(msg);
            continue; // Skip this operation
          }
          console.log(`[CodeGenerator] Containment: allowed ${op.action} to ${op.path}`);
        }

        // Ensure directory exists
        if (!existsSync(dir)) {
          await mkdir(dir, { recursive: true });
        }

        const fileExists = existsSync(fullPath);

        if (op.content !== undefined) {
          await writeFile(fullPath, op.content, 'utf-8');

          if (fileExists) {
            filesModified.push(op.path);
          } else {
            filesCreated.push(op.path);
          }
        }

        console.log(`[CodeGenerator] ${op.action}: ${op.path}`);

      } catch (error) {
        const msg = `Failed to ${op.action} ${op.path}: ${error instanceof Error ? error.message : error}`;
        errors.push(msg);
        console.error(`[CodeGenerator] ${msg}`);
      }
    }

    return { filesCreated, filesModified, errors };
  }

  /**
   * Read files from the codebase for context
   */
  async readFilesForContext(paths: string[]): Promise<Map<string, string>> {
    const files = new Map<string, string>();

    for (const path of paths) {
      try {
        const fullPath = join(this.config.codebaseRoot, path);
        if (existsSync(fullPath)) {
          const content = await readFile(fullPath, 'utf-8');
          files.set(path, content);
        }
      } catch {
        // Skip files that can't be read
      }
    }

    return files;
  }

  /**
   * Run build/lint/test verification
   */
  async verify(command: string): Promise<{ success: boolean; output: string; errors: string[] }> {
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: this.config.codebaseRoot,
        timeout: 120000 // 2 minute timeout
      });

      return {
        success: true,
        output: stdout,
        errors: stderr ? [stderr] : []
      };
    } catch (error) {
      const execError = error as { stdout?: string; stderr?: string; message: string };
      return {
        success: false,
        output: execError.stdout || '',
        errors: [execError.stderr || execError.message]
      };
    }
  }

  /**
   * Generate design document (for design subtasks)
   */
  async generateDesign(request: CodeGenRequest): Promise<CodeGenResult> {
    const { task, subtask, codebaseContext } = request;

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: `## Task
${task.description}

## Subtask
${subtask.description}

## Codebase Context
${codebaseContext}

Generate a design document for this task. Include:
1. Architecture overview
2. Data models/interfaces
3. Component breakdown
4. Integration points
5. Potential risks/considerations

Output as markdown.`
          }
        ],
        system: 'You are a senior software architect. Generate clear, actionable design documents.'
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        return {
          success: false,
          filesCreated: [],
          filesModified: [],
          output: 'Unexpected response',
          error: 'Non-text response'
        };
      }

      return {
        success: true,
        filesCreated: [],
        filesModified: [],
        output: content.text,
        tokensUsed: response.usage.input_tokens + response.usage.output_tokens
      };

    } catch (error) {
      return {
        success: false,
        filesCreated: [],
        filesModified: [],
        output: '',
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Research existing code (for research subtasks)
   */
  async analyzeCode(request: CodeGenRequest): Promise<CodeGenResult> {
    const { task, subtask, codebaseContext } = request;

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: `## Task
${task.description}

## Research Goal
${subtask.description}

## Codebase Context
${codebaseContext}

Analyze the codebase and provide:
1. Relevant existing patterns
2. Files that will need modification
3. Dependencies to consider
4. Potential conflicts or issues
5. Recommended approach

Be specific about file paths and code patterns.`
          }
        ],
        system: 'You are a code analyst. Provide detailed, actionable analysis of codebases.'
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        return {
          success: false,
          filesCreated: [],
          filesModified: [],
          output: 'Unexpected response',
          error: 'Non-text response'
        };
      }

      return {
        success: true,
        filesCreated: [],
        filesModified: [],
        output: content.text,
        tokensUsed: response.usage.input_tokens + response.usage.output_tokens
      };

    } catch (error) {
      return {
        success: false,
        filesCreated: [],
        filesModified: [],
        output: '',
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Set containment manager (for late binding)
   */
  setContainment(containment: ContainmentManager): void {
    this.containment = containment;
  }

  /**
   * Get the containment manager if available
   */
  getContainment(): ContainmentManager | undefined {
    return this.containment;
  }

  /**
   * Set Wolfram Alpha manager (for deterministic math)
   */
  setWolfram(wolfram: WolframManager): void {
    this.wolfram = wolfram;
  }

  /**
   * Get the Wolfram manager if available
   */
  getWolfram(): WolframManager | undefined {
    return this.wolfram;
  }

  // ===========================================================================
  // Tool Definitions for Claude (Wolfram + Web Search)
  // ===========================================================================

  /**
   * Get available tools for Claude to use during code generation
   */
  private getTools(): Anthropic.Messages.Tool[] {
    const tools: Anthropic.Messages.Tool[] = [];

    // Wolfram Alpha tools
    if (this.wolfram?.isConfigured()) {
      tools.push(
        {
          name: 'wolfram_query',
          description: 'Query Wolfram Alpha for any mathematical, scientific, or computational question. Use this to verify calculations, get formulas, convert units, solve equations, or look up mathematical/scientific facts. Returns deterministic, verified results. ALWAYS use this when you need to do math or verify numerical values.',
          input_schema: {
            type: 'object' as const,
            properties: {
              query: {
                type: 'string',
                description: 'The question or expression to compute (e.g., "15% of 500", "solve x^2 + 5x + 6 = 0", "100 miles to km", "compound interest formula", "factorial of 10")'
              }
            },
            required: ['query']
          }
        },
        {
          name: 'wolfram_calculate',
          description: 'Calculate a mathematical expression. Use this for arithmetic, percentages, roots, powers, or any numeric computation. Returns the exact result.',
          input_schema: {
            type: 'object' as const,
            properties: {
              expression: {
                type: 'string',
                description: 'The expression to calculate (e.g., "sqrt(144)", "15% of 500", "2^10", "1000 * (1 + 0.05/12)^120")'
              }
            },
            required: ['expression']
          }
        }
      );
    }

    // Web search tool (always available)
    tools.push({
      name: 'web_search',
      description: 'Search the web for information. Use this to verify facts, look up documentation, research libraries, check current best practices, or find examples. Use when you need external information beyond your training data.',
      input_schema: {
        type: 'object' as const,
        properties: {
          query: {
            type: 'string',
            description: 'The search query (e.g., "React 18 useEffect cleanup", "TypeScript strict mode configuration", "Node.js crypto createHash")'
          }
        },
        required: ['query']
      }
    });

    return tools;
  }

  /**
   * Execute a tool call and return the result
   */
  private async executeTool(name: string, input: Record<string, unknown>): Promise<string> {
    console.log(`[CodeGenerator] Executing tool: ${name}`, input);

    try {
      switch (name) {
        case 'wolfram_query': {
          if (!this.wolfram) return 'Wolfram Alpha not configured';
          const result = await this.wolfram.query(input.query as string);
          if (result.success) {
            const podsText = result.pods?.map(p => `${p.title}: ${p.plaintext}`).filter(Boolean).join('\n') || '';
            const response = `Result: ${result.result || 'See details below'}\n\n${podsText}`;
            console.log(`[CodeGenerator] Wolfram query result: ${result.result}`);
            return response;
          }
          return `Query failed: ${result.error}`;
        }

        case 'wolfram_calculate': {
          if (!this.wolfram) return 'Wolfram Alpha not configured';
          const calcResult = await this.wolfram.calculate(input.expression as string);
          console.log(`[CodeGenerator] Wolfram calculation: ${input.expression} = ${calcResult}`);
          return `${input.expression} = ${calcResult}`;
        }

        case 'web_search': {
          // Use fetch to call a simple web search API
          // For now, provide helpful guidance since we don't have direct web access
          const query = input.query as string;
          console.log(`[CodeGenerator] Web search requested: ${query}`);
          return `Web search for: "${query}"\n\nNote: Direct web search is not currently available during code generation. Consider:\n1. Using established patterns from the codebase context\n2. Following standard library documentation conventions\n3. Using well-known solutions for common problems\n\nIf this information is critical, you may need to ask the user for clarification.`;
        }

        default:
          return `Unknown tool: ${name}`;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[CodeGenerator] Tool execution error:`, error);
      return `Error executing ${name}: ${errorMsg}`;
    }
  }
}

export default CodeGenerator;
