/**
 * CodeGenerator
 *
 * Generates code using Claude Code CLI (Max subscription) with API fallback.
 * Primary: Spawns claude CLI → uses your Max subscription (Opus)
 * Fallback: When quota exhausted → direct Anthropic API
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
import { ClaudeCodeExecutor } from './ClaudeCodeExecutor.js';
import { SelfKnowledgeInjector } from '../prompts/SelfKnowledgeInjector.js';
import type { CommunicationManager } from '../communication/CommunicationManager.js';

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
  /** Whether CLI quota was exhausted (triggers API fallback) */
  quotaExhausted?: boolean;
  /** Whether CLI is unavailable */
  cliUnavailable?: boolean;
  /** Whether model was downgraded from Opus (triggers API fallback) */
  modelDowngraded?: boolean;
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
  apiKey?: string;  // Optional now - only needed for API fallback
  model?: string;
  maxTokens?: number;
  codebaseRoot: string;
  /** Extended thinking (ultrathink) configuration */
  extendedThinking?: ExtendedThinkingConfig;
  /** Execution mode: 'cli-first' (default), 'api-only', or 'cli-only' */
  executionMode?: 'cli-first' | 'api-only' | 'cli-only';
  /** CLI model preference: opus (default), sonnet, haiku */
  cliModel?: 'opus' | 'sonnet' | 'haiku';
  /** CLI timeout in ms (default: 5 minutes) */
  cliTimeout?: number;
}

/**
 * CodeGenerator - Claude-powered code generation
 *
 * Execution priority:
 * 1. Claude Code CLI (uses Max subscription - Opus by default)
 * 2. Anthropic API (fallback when quota exhausted)
 */
export class CodeGenerator {
  private client: Anthropic | null = null;
  private config: CodeGeneratorConfig;
  private model: string;
  private containment: ContainmentManager | undefined;
  private wolfram: WolframManager | undefined;
  private cliExecutor: ClaudeCodeExecutor;
  private executionMode: 'cli-first' | 'api-only' | 'cli-only';
  private useApiFallback = false;

  constructor(config: CodeGeneratorConfig) {
    this.config = config;
    this.model = config.model || 'claude-opus-4-5-20251101';
    this.executionMode = config.executionMode || 'cli-first';

    // Initialize CLI executor
    this.cliExecutor = new ClaudeCodeExecutor({
      cwd: config.codebaseRoot,
      model: config.cliModel || 'opus',
      timeout: config.cliTimeout || 5 * 60 * 1000,
      allowEdits: true
    });

    // Initialize API client only if key provided and mode allows API
    if (config.apiKey && this.executionMode !== 'cli-only') {
      this.client = new Anthropic({ apiKey: config.apiKey });
      console.log('[CodeGenerator] API fallback enabled');
    } else if (this.executionMode === 'api-only') {
      if (!config.apiKey) {
        throw new Error('ANTHROPIC_API_KEY is required for api-only mode');
      }
      this.client = new Anthropic({ apiKey: config.apiKey });
    }

    console.log(`[CodeGenerator] Execution mode: ${this.executionMode}`);
    console.log(`[CodeGenerator] CLI model: ${config.cliModel || 'opus'}`);
  }

  /**
   * Set CommunicationManager for routing permission requests to Telegram
   */
  setComms(comms: CommunicationManager): void {
    this.cliExecutor.setComms(comms);
    console.log('[CodeGenerator] CommunicationManager wired for permission routing');
  }

  /**
   * Generate code for a subtask
   * @param request The code generation request
   * @param thinkingBudget Optional thinking budget for ultrathink mode (tokens)
   */
  async generate(request: CodeGenRequest, thinkingBudget?: number): Promise<CodeGenResult> {
    const { task, subtask, attempt, codebaseContext, previousAttempts } = request;

    // Build prompts
    const prompt = this.buildPrompt(task, subtask, attempt, codebaseContext, previousAttempts);
    const systemPrompt = this.getSystemPrompt();

    // Determine execution path
    const shouldTryCli = this.executionMode !== 'api-only' && !this.useApiFallback;
    const canFallbackToApi = this.executionMode === 'cli-first' && this.client !== null;

    // Try CLI first (uses Max subscription)
    if (shouldTryCli) {
      console.log('[CodeGenerator] Attempting Claude Code CLI (Max subscription)...');
      const cliResult = await this.executeViaCli(task, prompt, systemPrompt);

      if (cliResult.success) {
        console.log('[CodeGenerator] CLI execution successful');
        return cliResult;
      }

      // Check if we should fall back to API
      if (cliResult.quotaExhausted && canFallbackToApi) {
        console.log('[CodeGenerator] Quota exhausted - falling back to API');
        this.useApiFallback = true;
      } else if (cliResult.modelDowngraded && canFallbackToApi) {
        console.log('[CodeGenerator] Model downgraded from Opus - falling back to API (user wants Opus only)');
        this.useApiFallback = true;
      } else if (cliResult.cliUnavailable && canFallbackToApi) {
        console.log('[CodeGenerator] CLI unavailable - falling back to API');
        this.useApiFallback = true;
      } else if (this.executionMode === 'cli-only') {
        // CLI-only mode - don't fall back
        return cliResult;
      } else if (!canFallbackToApi) {
        // No API fallback available
        return cliResult;
      }
      // For other errors in cli-first mode, try API
    }

    // API execution (fallback or api-only mode)
    if (!this.client) {
      return {
        success: false,
        filesCreated: [],
        filesModified: [],
        output: '',
        error: 'No API client available and CLI failed'
      };
    }

    console.log('[CodeGenerator] Executing via Anthropic API...');
    return this.executeViaApi(request, thinkingBudget);
  }

  /**
   * Execute via Claude Code CLI
   */
  private async executeViaCli(task: CodexTask, prompt: string, systemPrompt: string): Promise<CodeGenResult> {
    try {
      // Use the task's codebase if provided
      const codebaseRoot = task.codebase || this.config.codebaseRoot;

      // Update CLI executor cwd if different
      const cliExecutor = new ClaudeCodeExecutor({
        cwd: codebaseRoot,
        model: this.config.cliModel || 'opus',
        timeout: this.config.cliTimeout || 5 * 60 * 1000,
        allowEdits: true
      });

      // Execute via CLI
      const result = await cliExecutor.execute(prompt, systemPrompt);

      return {
        success: result.success,
        filesCreated: result.filesCreated,
        filesModified: result.filesModified,
        output: result.output,
        error: result.error,
        quotaExhausted: result.quotaExhausted,
        cliUnavailable: result.cliUnavailable,
        modelDowngraded: result.modelDowngraded
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
   * Execute via Anthropic API (original implementation)
   */
  private async executeViaApi(request: CodeGenRequest, thinkingBudget?: number): Promise<CodeGenResult> {
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
    if (!this.client) {
      throw new Error('API client not initialized');
    }

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
   * Get system prompt for code generation (compressed)
   */
  private getSystemPrompt(): string {
    // RUBIX identity + compressed generation prompt
    const identity = SelfKnowledgeInjector.getIdentity('code_generator');
    return `${identity}

GEN
ROLE:implement,ship,complete_code
RULES:no_placeholders,no_todos,full_files,strict_types,error_handling
OUT:<file path="..." action="create|modify">complete_code</file>
STYLE:follow_codebase_patterns,all_imports,self_documenting`;
  }

  /**
   * Build the generation prompt (compressed)
   */
  private buildPrompt(
    task: CodexTask,
    subtask: Subtask,
    attempt: SubtaskAttempt,
    codebaseContext: string,
    previousAttempts?: SubtaskAttempt[]
  ): string {
    // Compressed prompt format
    let prompt = `TASK:${task.description.slice(0, 500)}`;

    if (task.specification) {
      prompt += `\nSPEC:${task.specification.slice(0, 500)}`;
    }

    if (task.constraints && task.constraints.length > 0) {
      prompt += `\nCONSTRAINTS:${task.constraints.slice(0, 5).join(',')}`;
    }

    prompt += `\nSUBTASK:${subtask.type}|${subtask.description.slice(0, 200)}`;
    prompt += `\nATTEMPT:${attempt.attemptNumber}|${attempt.approach.slice(0, 100)}`;
    prompt += `\nCTX:${codebaseContext.slice(0, 2000)}`;

    // Include previous failures compactly
    if (previousAttempts && previousAttempts.length > 0) {
      const failures = previousAttempts
        .filter(p => p.error)
        .map(p => `${p.attemptNumber}:${p.error?.slice(0, 100)}`)
        .join('|');
      if (failures) {
        prompt += `\nPREV_FAIL:${failures}`;
      }
    }

    prompt += `\n→<file path="" action="create|modify">code</file>`;

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

    // Try CLI first for design
    if (this.executionMode !== 'api-only' && !this.useApiFallback) {
      const designPrompt = `DESIGN
TASK:${task.description.slice(0, 500)}
SUBTASK:${subtask.description.slice(0, 300)}
CTX:${codebaseContext.slice(0, 1500)}
→{architecture,data_models,components,integrations,risks}`;

      const cliResult = await this.executeViaCli(task, designPrompt, 'ARCHITECT\nROLE:design,structure,interfaces\n→markdown_doc');
      if (cliResult.success || this.executionMode === 'cli-only') {
        return cliResult;
      }
    }

    if (!this.client) {
      return {
        success: false,
        filesCreated: [],
        filesModified: [],
        output: '',
        error: 'No API client available'
      };
    }

    try {
      // Compressed design prompt
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: `DESIGN
TASK:${task.description.slice(0, 500)}
SUBTASK:${subtask.description.slice(0, 300)}
CTX:${codebaseContext.slice(0, 1500)}
→{architecture,data_models,components,integrations,risks}`
          }
        ],
        system: 'ARCHITECT\nROLE:design,structure,interfaces\n→markdown_doc'
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

    // Try CLI first for research
    if (this.executionMode !== 'api-only' && !this.useApiFallback) {
      const researchPrompt = `RESEARCH
TASK:${task.description.slice(0, 500)}
GOAL:${subtask.description.slice(0, 300)}
CTX:${codebaseContext.slice(0, 1500)}
→{patterns:[],files_to_modify:[],deps:[],conflicts:[],recommended_approach:""}`;

      const cliResult = await this.executeViaCli(task, researchPrompt, 'ANALYZE\nROLE:discover,map,patterns\n→specific_file_paths,code_patterns');
      if (cliResult.success || this.executionMode === 'cli-only') {
        return cliResult;
      }
    }

    if (!this.client) {
      return {
        success: false,
        filesCreated: [],
        filesModified: [],
        output: '',
        error: 'No API client available'
      };
    }

    try {
      // Compressed research prompt
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: `RESEARCH
TASK:${task.description.slice(0, 500)}
GOAL:${subtask.description.slice(0, 300)}
CTX:${codebaseContext.slice(0, 1500)}
→{patterns:[],files_to_modify:[],deps:[],conflicts:[],recommended_approach:""}`
          }
        ],
        system: 'ANALYZE\nROLE:discover,map,patterns\n→specific_file_paths,code_patterns'
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

  // ===========================================================================
  // Execution Mode Management
  // ===========================================================================

  /**
   * Get current execution status
   */
  getExecutionStatus(): {
    mode: 'cli-first' | 'api-only' | 'cli-only';
    usingApiFallback: boolean;
    cliStatus: {
      cliAvailable: boolean | null;
      consecutiveQuotaErrors: number;
      inQuotaCooldown: boolean;
    };
    apiAvailable: boolean;
  } {
    return {
      mode: this.executionMode,
      usingApiFallback: this.useApiFallback,
      cliStatus: this.cliExecutor.getStatus(),
      apiAvailable: this.client !== null
    };
  }

  /**
   * Reset API fallback - try CLI again
   */
  resetApiFallback(): void {
    this.useApiFallback = false;
    this.cliExecutor.resetQuotaTracking();
    console.log('[CodeGenerator] Reset API fallback - will try CLI again');
  }

  /**
   * Force API fallback mode (skip CLI)
   */
  forceApiFallback(): void {
    if (this.client) {
      this.useApiFallback = true;
      console.log('[CodeGenerator] Forced API fallback mode');
    } else {
      console.warn('[CodeGenerator] Cannot force API fallback - no API client');
    }
  }

  /**
   * Set execution mode at runtime
   */
  setExecutionMode(mode: 'cli-first' | 'api-only' | 'cli-only'): void {
    if (mode === 'api-only' && !this.client) {
      throw new Error('Cannot set api-only mode without API key');
    }
    this.executionMode = mode;
    console.log(`[CodeGenerator] Execution mode set to: ${mode}`);
  }

  /**
   * Check if CLI is available
   */
  async isCliAvailable(): Promise<boolean> {
    return this.cliExecutor.checkCliAvailable();
  }
}

export default CodeGenerator;
