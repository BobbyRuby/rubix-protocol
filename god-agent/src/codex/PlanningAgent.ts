/**
 * PlanningAgent
 *
 * Claude interface specifically for planning conversations.
 * Uses memory-augmented context to enable unlimited planning sessions.
 * NOW WITH TOOL ACCESS: Can read files, search codebase, and fetch web content.
 */

import Anthropic from '@anthropic-ai/sdk';
import { promises as fs } from 'fs';
import path from 'path';
import { glob } from 'glob';
import type { ContainmentManager } from './ContainmentManager.js';
import { SelfKnowledgeInjector } from '../prompts/SelfKnowledgeInjector.js';

/**
 * Configuration for PlanningAgent
 */
export interface PlanningAgentConfig {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  codebaseRoot?: string;
}

/**
 * Plan document structure
 */
export interface PlanDocument {
  title: string;
  description: string;
  goals: string[];
  approach: string;
  components: PlanComponent[];
  considerations: string[];
  openQuestions: string[];
  estimatedComplexity: 'small' | 'medium' | 'large' | 'massive';
}

/**
 * Component within a plan
 */
export interface PlanComponent {
  name: string;
  description: string;
  dependencies: string[];
  subtasks: string[];
}

/**
 * Exchange in planning conversation
 */
export interface PlanningExchange {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  memoryId?: string;
}

/**
 * Tool definitions for planning mode
 */
const PLANNING_TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: 'read_file',
    description: 'Read a file from the filesystem. Use absolute paths or paths relative to the codebase root.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'File path to read' }
      },
      required: ['path']
    }
  },
  {
    name: 'glob_files',
    description: 'Find files matching a glob pattern (e.g., "**/*.ts", "src/**/*.js")',
    input_schema: {
      type: 'object' as const,
      properties: {
        pattern: { type: 'string', description: 'Glob pattern to match files' },
        cwd: { type: 'string', description: 'Optional directory to search in (defaults to codebase root)' }
      },
      required: ['pattern']
    }
  },
  {
    name: 'grep_search',
    description: 'Search file contents for a text pattern. Returns matching lines with file paths.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pattern: { type: 'string', description: 'Text or regex pattern to search for' },
        path: { type: 'string', description: 'Optional directory or file to search in' },
        filePattern: { type: 'string', description: 'Optional glob pattern to filter files (e.g., "*.ts")' }
      },
      required: ['pattern']
    }
  },
  {
    name: 'web_fetch',
    description: 'Fetch content from a URL. Returns the page text (HTML stripped for readability).',
    input_schema: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'URL to fetch' }
      },
      required: ['url']
    }
  },
  {
    name: 'list_directory',
    description: 'List files and directories in a path.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Directory path to list' }
      },
      required: ['path']
    }
  }
];

/**
 * System prompt for planning mode
 * Compressed format: efficient tokens, human-machine clarity preserved
 */
const RUBIX_IDENTITY = SelfKnowledgeInjector.getIdentity('planning_agent');
const PLANNING_SYSTEM_PROMPT = `${RUBIX_IDENTITY}

PLAN_AGENT
ROLE:planning_subsystem,perfect_memory,tool_access
GOAL:think_through_project_BEFORE_code,store_exchanges_in_memory

TOOLS:read_file,glob_files,grep_search,web_fetch,list_directory
USE_TOOLS_WHEN:user_asks_about_code,need_architecture_context,lookup_docs,explore_existing

APPROACH:
1.UNDERSTAND:ask_clarifying(1-2_questions),use_tools,explore_requirements,find_the_why
2.EXPLORE:suggest_approaches_with_tradeoffs,discuss_alternatives,share_considerations
3.BUILD_PLAN:summarize_decisions,track_open_questions,actionable_plan
4.STAY_IN_PLANNING:NO_code_writes,NO_execution,offer_summary_when_complete,wait_for_/execute

STYLE:collaborative,concise,use_questions,build_on_ideas,direct_about_tradeoffs,markdown

CONTEXT_RECEIVED:current_plan,relevant_past_exchanges,recent_conversation,key_decisions
RULE:reference_past_naturally,no_repeat_unless_asked`;

/**
 * PlanningAgent - Claude-powered planning conversations with tool access
 */
export class PlanningAgent {
  private client: Anthropic;
  private model: string;
  private maxTokens: number;
  private codebaseRoot: string;
  private containment?: ContainmentManager;

  constructor(config: PlanningAgentConfig) {
    if (!config.apiKey) {
      throw new Error('ANTHROPIC_API_KEY is required for planning');
    }

    this.client = new Anthropic({ apiKey: config.apiKey });
    this.model = config.model || 'claude-sonnet-4-20250514'; // Sonnet for speed in planning
    this.maxTokens = config.maxTokens || 4096;
    this.codebaseRoot = config.codebaseRoot || process.cwd();
  }

  /**
   * Set the ContainmentManager for permission checking
   */
  setContainment(containment: ContainmentManager): void {
    this.containment = containment;
    console.log('[PlanningAgent] ContainmentManager connected');
  }

  /**
   * Set the codebase root for file operations
   */
  setCodebaseRoot(root: string): void {
    this.codebaseRoot = root;
    console.log(`[PlanningAgent] Codebase root: ${root}`);
  }

  /**
   * Check if a path is allowed by containment
   */
  private checkAccess(filePath: string, operation: 'read' | 'write' = 'read'): boolean {
    if (!this.containment) {
      // No containment = allow all (development mode)
      return true;
    }
    const result = this.containment.checkPermission(filePath, operation);
    return result.allowed;
  }

  /**
   * Execute a tool call and return the result
   */
  private async executeToolCall(
    name: string,
    input: Record<string, unknown>
  ): Promise<string> {
    console.log(`[PlanningAgent] Tool call: ${name}`, input);

    try {
      switch (name) {
        case 'read_file': {
          const inputPath = input.path as string;
          const filePath = path.isAbsolute(inputPath)
            ? inputPath
            : path.resolve(this.codebaseRoot, inputPath);

          if (!this.checkAccess(filePath, 'read')) {
            return `Permission denied: Cannot read ${filePath}\n\nTo grant access, use the MCP tool: god_containment_session add "${path.dirname(filePath)}" read`;
          }

          try {
            const content = await fs.readFile(filePath, 'utf-8');
            // Truncate very large files
            if (content.length > 50000) {
              return `${content.slice(0, 50000)}\n\n... [truncated, file is ${content.length} chars]`;
            }
            return content;
          } catch (err) {
            const error = err as Error;
            return `Error reading file: ${error.message}`;
          }
        }

        case 'glob_files': {
          const pattern = input.pattern as string;
          const cwd = input.cwd
            ? path.resolve(this.codebaseRoot, input.cwd as string)
            : this.codebaseRoot;

          if (!this.checkAccess(cwd, 'read')) {
            return `Permission denied: Cannot search in ${cwd}`;
          }

          try {
            const files = await glob(pattern, {
              cwd,
              nodir: true,
              ignore: ['**/node_modules/**', '**/.git/**']
            });
            if (files.length === 0) {
              return `No files found matching "${pattern}" in ${cwd}`;
            }
            const result = files.slice(0, 100).join('\n');
            if (files.length > 100) {
              return `${result}\n\n... and ${files.length - 100} more files`;
            }
            return result;
          } catch (err) {
            const error = err as Error;
            return `Error searching files: ${error.message}`;
          }
        }

        case 'grep_search': {
          const pattern = input.pattern as string;
          const searchPath = input.path
            ? path.resolve(this.codebaseRoot, input.path as string)
            : this.codebaseRoot;
          const filePattern = (input.filePattern as string) || '**/*';

          if (!this.checkAccess(searchPath, 'read')) {
            return `Permission denied: Cannot search in ${searchPath}`;
          }

          try {
            // Find files matching the pattern
            const files = await glob(filePattern, {
              cwd: searchPath,
              nodir: true,
              ignore: ['**/node_modules/**', '**/.git/**', '**/*.lock']
            });

            const matches: string[] = [];
            const regex = new RegExp(pattern, 'gi');

            for (const file of files.slice(0, 50)) {
              try {
                const filePath = path.join(searchPath, file);
                const content = await fs.readFile(filePath, 'utf-8');
                const lines = content.split('\n');

                for (let i = 0; i < lines.length; i++) {
                  if (regex.test(lines[i])) {
                    matches.push(`${file}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
                    if (matches.length >= 50) break;
                  }
                }
                if (matches.length >= 50) break;
              } catch {
                // Skip files that can't be read
              }
            }

            if (matches.length === 0) {
              return `No matches found for "${pattern}"`;
            }
            return matches.join('\n');
          } catch (err) {
            const error = err as Error;
            return `Error searching: ${error.message}`;
          }
        }

        case 'web_fetch': {
          const url = input.url as string;

          try {
            const response = await fetch(url, {
              headers: {
                'User-Agent': 'RUBIX-PlanningAgent/1.0'
              }
            });

            if (!response.ok) {
              return `HTTP ${response.status}: ${response.statusText}`;
            }

            const contentType = response.headers.get('content-type') || '';
            let text = await response.text();

            // Strip HTML tags for readability
            if (contentType.includes('text/html')) {
              // Simple HTML to text conversion
              text = text
                .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                .replace(/<[^>]+>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            }

            // Truncate large responses
            if (text.length > 20000) {
              return `${text.slice(0, 20000)}\n\n... [truncated, response is ${text.length} chars]`;
            }
            return text;
          } catch (err) {
            const error = err as Error;
            return `Error fetching URL: ${error.message}`;
          }
        }

        case 'list_directory': {
          const dirPath = path.isAbsolute(input.path as string)
            ? input.path as string
            : path.resolve(this.codebaseRoot, input.path as string);

          if (!this.checkAccess(dirPath, 'read')) {
            return `Permission denied: Cannot list ${dirPath}`;
          }

          try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            const result = entries
              .slice(0, 100)
              .map(e => `${e.isDirectory() ? '[DIR]' : '[FILE]'} ${e.name}`)
              .join('\n');

            if (entries.length > 100) {
              return `${result}\n\n... and ${entries.length - 100} more entries`;
            }
            return result || '(empty directory)';
          } catch (err) {
            const error = err as Error;
            return `Error listing directory: ${error.message}`;
          }
        }

        default:
          return `Unknown tool: ${name}`;
      }
    } catch (err) {
      const error = err as Error;
      console.error(`[PlanningAgent] Tool error:`, error);
      return `Tool error: ${error.message}`;
    }
  }

  /**
   * Get a planning response from Claude (with tool support)
   */
  async respond(
    userMessage: string,
    context: {
      taskDescription: string;
      retrievedContext?: string;
      recentExchanges?: PlanningExchange[];
      currentPlan?: PlanDocument;
      decisions?: string[];
    }
  ): Promise<string> {
    // Build the context-rich prompt
    const contextPrompt = this.buildContextPrompt(context);

    const messages: Anthropic.Messages.MessageParam[] = [];

    // Add context as first user message if substantial
    if (contextPrompt.length > 100) {
      messages.push({
        role: 'user',
        content: `[CONTEXT FOR THIS PLANNING SESSION]\n\n${contextPrompt}\n\n---\n\n[USER MESSAGE]\n${userMessage}`
      });
    } else {
      messages.push({
        role: 'user',
        content: userMessage
      });
    }

    try {
      let response = await this.client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        system: PLANNING_SYSTEM_PROMPT,
        tools: PLANNING_TOOLS,
        messages
      });

      // Handle tool use loop - unlimited iterations for collaborative planning
      let iterations = 0;

      while (response.stop_reason === 'tool_use') {
        iterations++;
        console.log(`[PlanningAgent] Tool use iteration ${iterations}`);

        const toolUseBlocks = response.content.filter(
          (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use'
        );

        const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];

        for (const tool of toolUseBlocks) {
          const result = await this.executeToolCall(
            tool.name,
            tool.input as Record<string, unknown>
          );
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tool.id,
            content: result
          });
        }

        // Continue conversation with tool results
        messages.push({ role: 'assistant', content: response.content });
        messages.push({ role: 'user', content: toolResults });

        response = await this.client.messages.create({
          model: this.model,
          max_tokens: this.maxTokens,
          system: PLANNING_SYSTEM_PROMPT,
          tools: PLANNING_TOOLS,
          messages
        });
      }

      if (iterations > 0) {
        console.log(`[PlanningAgent] Completed ${iterations} tool iterations`);
      }

      // Extract final text response
      const textContent = response.content.find(
        (block): block is Anthropic.Messages.TextBlock => block.type === 'text'
      );

      if (!textContent) {
        throw new Error('No text response from Claude');
      }

      return textContent.text;
    } catch (error) {
      console.error('[PlanningAgent] Error:', error);
      throw error;
    }
  }

  /**
   * Start a new planning session
   */
  async startSession(taskDescription: string): Promise<string> {
    return this.respond(
      `I want to plan: ${taskDescription}\n\nPlease help me think through this. Ask me clarifying questions, suggest approaches, and help me develop a detailed plan before we execute anything.`,
      { taskDescription }
    );
  }

  /**
   * Generate or update the plan document from conversation
   */
  async generatePlanDocument(
    taskDescription: string,
    conversationSummary: string,
    previousPlan?: PlanDocument
  ): Promise<PlanDocument> {
    const prompt = previousPlan
      ? `Update this plan document based on our conversation:\n\nPREVIOUS PLAN:\n${JSON.stringify(previousPlan, null, 2)}\n\nCONVERSATION SUMMARY:\n${conversationSummary}`
      : `Generate a plan document from our conversation:\n\nTASK: ${taskDescription}\n\nCONVERSATION SUMMARY:\n${conversationSummary}`;

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 2048,
      system: `You are a technical planner. Generate a structured plan document in JSON format.

Output ONLY valid JSON matching this structure:
{
  "title": "Short title for the plan",
  "description": "One paragraph description",
  "goals": ["Goal 1", "Goal 2"],
  "approach": "Overall approach description",
  "components": [
    {
      "name": "Component name",
      "description": "What this component does",
      "dependencies": ["Other components it depends on"],
      "subtasks": ["Specific tasks to implement this"]
    }
  ],
  "considerations": ["Important considerations"],
  "openQuestions": ["Questions still to be resolved"],
  "estimatedComplexity": "small|medium|large|massive"
}

Be thorough but concise.`,
      messages: [{ role: 'user', content: prompt }]
    });

    const textContent = response.content.find(block => block.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text response for plan generation');
    }

    try {
      // Extract JSON from response (may have markdown code blocks)
      const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }
      return JSON.parse(jsonMatch[0]) as PlanDocument;
    } catch (parseError) {
      console.error('[PlanningAgent] Failed to parse plan document:', parseError);
      // Return a basic plan structure
      return {
        title: taskDescription.substring(0, 50),
        description: conversationSummary.substring(0, 200),
        goals: ['Complete the task as discussed'],
        approach: 'Follow the conversation decisions',
        components: [],
        considerations: [],
        openQuestions: [],
        estimatedComplexity: 'medium'
      };
    }
  }

  /**
   * Summarize an exchange for better retrieval
   */
  async summarizeForRetrieval(content: string): Promise<string> {
    // For short content, return as-is
    if (content.length < 200) {
      return content;
    }

    try {
      const response = await this.client.messages.create({
        model: 'claude-haiku-4-20250514', // Use Haiku for summaries (fast & cheap)
        max_tokens: 150,
        system: 'Summarize this planning exchange in 1-2 sentences. Focus on decisions, requirements, or key information.',
        messages: [{ role: 'user', content }]
      });

      const textContent = response.content.find(block => block.type === 'text');
      return textContent?.type === 'text' ? textContent.text : content.substring(0, 200);
    } catch {
      // Fallback to truncation
      return content.substring(0, 200) + '...';
    }
  }

  /**
   * Chat mode - conversational responses without plan generation
   * Used by ConversationSession before /rubixallize
   */
  async chat(context: string, userMessage: string): Promise<string> {
    const conversationIdentity = SelfKnowledgeInjector.getIdentity('conversation_agent');
    const conversationalPrompt = `${conversationIdentity}

CONV_AGENT
ROLE:conversational_interface,tool_access
HELPS:answer_code_questions,read_explore_files,research_docs,general_chat
TOOLS:read_file,glob_files,grep_search,web_fetch,list_directory
STYLE:friendly,conversational,proactive_tool_use

CONTEXT:
${context}`;

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        system: conversationalPrompt,
        tools: PLANNING_TOOLS,
        messages: [{ role: 'user', content: userMessage }]
      });

      // Handle tool use loop
      let currentResponse = response;
      let messages: Anthropic.Messages.MessageParam[] = [
        { role: 'user', content: userMessage }
      ];

      while (currentResponse.stop_reason === 'tool_use') {
        const toolUseBlocks = currentResponse.content.filter(
          (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use'
        );

        const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];

        for (const tool of toolUseBlocks) {
          const result = await this.executeToolCall(
            tool.name,
            tool.input as Record<string, unknown>
          );
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tool.id,
            content: result
          });
        }

        messages.push({ role: 'assistant', content: currentResponse.content });
        messages.push({ role: 'user', content: toolResults });

        currentResponse = await this.client.messages.create({
          model: this.model,
          max_tokens: this.maxTokens,
          system: conversationalPrompt,
          tools: PLANNING_TOOLS,
          messages
        });
      }

      // Extract final text response
      const textContent = currentResponse.content.find(
        (block): block is Anthropic.Messages.TextBlock => block.type === 'text'
      );

      if (!textContent) {
        throw new Error('No text response from Claude');
      }

      return textContent.text;
    } catch (error) {
      console.error('[PlanningAgent] Chat error:', error);
      throw error;
    }
  }

  /**
   * Synthesize a structured task description from conversation exchanges
   * Used when converting ConversationSession to PlanningSession
   */
  async synthesizeTaskDescription(exchanges: Array<{ role: string; content: string; timestamp: Date }>): Promise<string> {
    // Build conversation summary
    const conversationText = exchanges
      .map(e => `${e.role.toUpperCase()}: ${e.content}`)
      .join('\n\n');

    const prompt = `Analyze this conversation and extract a clear, structured task description.

The task description should:
1. Be 1-3 sentences
2. Capture the main goal or intent
3. Be specific enough to guide planning
4. Focus on WHAT needs to be done, not HOW

Conversation:
${conversationText}

Output ONLY the task description, nothing else.`;

    try {
      const response = await this.client.messages.create({
        model: 'claude-haiku-4-20250514', // Use Haiku for synthesis (fast & cheap)
        max_tokens: 200,
        system: 'You are a technical analyst. Extract clear task descriptions from conversations.',
        messages: [{ role: 'user', content: prompt }]
      });

      const textContent = response.content.find(block => block.type === 'text');
      if (!textContent || textContent.type !== 'text') {
        // Fallback: use first user message
        const firstUserMessage = exchanges.find(e => e.role === 'user');
        return firstUserMessage?.content.substring(0, 200) || 'Continue our conversation';
      }

      return textContent.text.trim();
    } catch (error) {
      console.error('[PlanningAgent] Task synthesis error:', error);
      // Fallback: use first user message
      const firstUserMessage = exchanges.find(e => e.role === 'user');
      return firstUserMessage?.content.substring(0, 200) || 'Continue our conversation';
    }
  }

  /**
   * Build context prompt from all available context
   */
  private buildContextPrompt(context: {
    taskDescription: string;
    retrievedContext?: string;
    recentExchanges?: PlanningExchange[];
    currentPlan?: PlanDocument;
    decisions?: string[];
  }): string {
    const parts: string[] = [];

    // Task description
    parts.push(`TASK: ${context.taskDescription}`);
    parts.push(`CODEBASE ROOT: ${this.codebaseRoot}`);

    // Current plan (if exists)
    if (context.currentPlan) {
      parts.push('\n=== CURRENT PLAN ===');
      parts.push(`Title: ${context.currentPlan.title}`);
      parts.push(`Approach: ${context.currentPlan.approach}`);
      if (context.currentPlan.goals.length > 0) {
        parts.push(`Goals: ${context.currentPlan.goals.join(', ')}`);
      }
      if (context.currentPlan.openQuestions.length > 0) {
        parts.push(`Open Questions: ${context.currentPlan.openQuestions.join(', ')}`);
      }
    }

    // Key decisions
    if (context.decisions && context.decisions.length > 0) {
      parts.push('\n=== KEY DECISIONS ===');
      context.decisions.forEach(d => parts.push(`- ${d}`));
    }

    // Retrieved context (semantically relevant past exchanges)
    if (context.retrievedContext) {
      parts.push('\n=== RELEVANT PAST CONTEXT ===');
      parts.push(context.retrievedContext);
    }

    // Recent exchanges for continuity
    if (context.recentExchanges && context.recentExchanges.length > 0) {
      parts.push('\n=== RECENT CONVERSATION ===');
      for (const ex of context.recentExchanges) {
        parts.push(`[${ex.role.toUpperCase()}] ${ex.content}`);
      }
    }

    return parts.join('\n');
  }
}

export default PlanningAgent;
