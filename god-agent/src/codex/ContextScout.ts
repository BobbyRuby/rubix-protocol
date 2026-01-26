/**
 * ContextScout - Phase 1: Gather context and analyze with Claude API or Ollama.
 *
 * API-based approach (no CLI):
 * - Gathers files via glob patterns
 * - Reads key files directly
 * - Queries god-agent memory for relevant patterns
 * - Sends pre-gathered context to Claude Sonnet or Ollama for analysis
 *
 * Outputs: CTX token string for Phase 2 (Architect)
 */

import Anthropic from '@anthropic-ai/sdk';
import { glob } from 'glob';
import fs from 'fs/promises';
import path from 'path';
import { COMPRESSION_SCHEMAS } from '../memory/CompressionSchemas.js';
import { getCodexLogger } from './Logger.js';
import { OllamaEngineerProvider } from './EngineerProvider.js';
import type { CodexTask } from './types.js';
import type { MemoryEngine } from '../core/MemoryEngine.js';

/**
 * Research results from context scouting.
 */
export interface ResearchResult {
  relevantFiles: Array<{ path: string; summary: string }>;
  memoryResults: Array<{ id: string; content: string; score: number }>;
  dependencies: Record<string, string>;
  patterns: {
    existingPatterns: string[];
    codeStyle: string;
  };
}

/**
 * Context bundle for inter-phase communication.
 */
export interface ContextBundle {
  taskId: string;
  description: string;
  specification?: string;  // Detailed plan/specification from PlanningSession
  codebaseRoot: string;    // Project root directory for ARCHITECT
  research: ResearchResult;
  compressedToken: string;  // CTX|...|...
}

/**
 * File content gathered from codebase.
 */
interface GatheredFile {
  path: string;
  content: string;
}

/**
 * Memory result from query.
 */
interface MemoryMatch {
  id: string;
  content: string;
  score: number;
}

/**
 * ContextScout gathers all context needed for subsequent phases.
 * Uses API calls instead of CLI for reliability.
 * Supports both Claude API and Ollama for cost optimization.
 */
export class ContextScout {
  private codebasePath: string;
  private polyglotContext: string;
  private apiClient: Anthropic | null = null;
  private apiModel: string;
  private memoryEngine: MemoryEngine | null = null;
  private useOllama: boolean = false;
  private ollamaProvider: OllamaEngineerProvider | null = null;

  constructor(
    codebasePath: string,
    polyglotContext = '',
    apiKey?: string,
    memoryEngine?: MemoryEngine,
    apiModel?: string
  ) {
    this.codebasePath = codebasePath;
    this.polyglotContext = polyglotContext;
    this.memoryEngine = memoryEngine || null;

    // Check if we should use Ollama instead of Claude
    this.useOllama = apiModel === 'OLLAMA';

    if (this.useOllama) {
      // Initialize Ollama provider
      const endpoint = process.env.OLLAMA_ENDPOINT || 'https://ollama.com/api';
      const model = process.env.OLLAMA_MODEL || 'qwen3-coder:480b-cloud';
      const ollamaApiKey = process.env.OLLAMA_API_KEY;
      const timeout = parseInt(process.env.OLLAMA_TIMEOUT || '120000', 10);

      this.ollamaProvider = new OllamaEngineerProvider(endpoint, model, ollamaApiKey, timeout);
      this.apiModel = model;
      console.log(`[ContextScout] Ollama provider initialized (model: ${this.apiModel}, endpoint: ${endpoint})`);
    } else {
      // Use Claude API
      this.apiModel = apiModel || 'claude-sonnet-4-20250514';

      // Initialize API client
      const key = apiKey || process.env.ANTHROPIC_API_KEY;
      if (key) {
        this.apiClient = new Anthropic({ apiKey: key });
        console.log(`[ContextScout] Claude API client initialized (model: ${this.apiModel})`);
      } else {
        console.warn('[ContextScout] No ANTHROPIC_API_KEY - context scouting will fail');
      }
    }
  }

  /**
   * Scout context for a task using API + pre-gathered context.
   */
  async scout(task: CodexTask): Promise<ContextBundle> {
    console.log(`[ContextScout] Phase 1: Scouting context for task ${task.id}`);
    const logger = getCodexLogger();

    // Log scout start
    logger.logResponse(
      'CONTEXT_SCOUT_START',
      `Task: ${task.description}`,
      JSON.stringify({
        taskId: task.id,
        description: task.description,
        specification: task.specification || null,
        codebasePath: this.codebasePath,
        hasPolyglotContext: !!this.polyglotContext
      }, null, 2),
      0,
      undefined,
      'context_scout'
    );

    // 1. Gather context ourselves (no Claude tools needed)
    const { files, memoryResults } = await this.gatherContext(task);
    console.log(`[ContextScout] Gathered ${files.length} files, ${memoryResults.length} memory matches`);

    // Log gathered context
    logger.logResponse(
      'CONTEXT_SCOUT_GATHERED',
      `Files: ${files.length}, Memory: ${memoryResults.length}`,
      JSON.stringify({
        filesGathered: files.length,
        filesList: files.map(f => ({ path: f.path, contentLength: f.content.length })),
        memoryMatches: memoryResults.length,
        memoryResults: memoryResults.map(m => ({ id: m.id, score: m.score, contentPreview: m.content.substring(0, 100) }))
      }, null, 2),
      files.length,
      files.map(f => ({ path: f.path, action: 'gathered' })),
      'context_scout'
    );

    // 2. Build prompt WITH pre-gathered context injected
    const prompt = this.buildScoutPrompt(task, files, memoryResults);

    // 3. Single API call to analyze
    const apiOutput = await this.executeApi(prompt);

    // Log API response
    logger.logResponse(
      'CONTEXT_SCOUT_API_RESPONSE',
      prompt,
      apiOutput,
      0,
      undefined,
      'context_scout'
    );

    // 4. Parse and format results
    const research = this.parseResearchOutput(apiOutput);

    // Log parsed research
    logger.logResponse(
      'CONTEXT_SCOUT_PARSED',
      `Parsed research output`,
      JSON.stringify({
        relevantFilesCount: research.relevantFiles.length,
        relevantFiles: research.relevantFiles,
        memoryResultsCount: research.memoryResults.length,
        dependenciesCount: Object.keys(research.dependencies).length,
        dependencies: research.dependencies,
        patterns: research.patterns
      }, null, 2),
      research.relevantFiles.length,
      research.relevantFiles.map(f => ({ path: f.path, action: 'relevant' })),
      'context_scout'
    );

    // Compress to CTX token
    const ctxInput = this.formatForCompression(task, research);
    const compressedToken = COMPRESSION_SCHEMAS.context_bundle.encode(ctxInput);

    console.log(`[ContextScout] Generated CTX token: ${compressedToken.substring(0, 100)}...`);

    // Log final CTX token
    logger.logResponse(
      'CONTEXT_SCOUT_COMPLETE',
      `CTX token generated`,
      JSON.stringify({
        taskId: task.id,
        compressedToken,
        tokenLength: compressedToken.length
      }, null, 2),
      research.relevantFiles.length,
      research.relevantFiles.map(f => ({ path: f.path, action: 'analyzed' })),
      'context_scout'
    );

    return {
      taskId: task.id,
      description: task.description,
      specification: task.specification,  // Pass through detailed plan
      codebaseRoot: this.codebasePath,    // Project root for ARCHITECT
      research,
      compressedToken
    };
  }

  /**
   * Gather context from codebase and memory.
   */
  private async gatherContext(task: CodexTask): Promise<{
    files: GatheredFile[];
    memoryResults: MemoryMatch[];
  }> {
    // Glob for relevant files
    const patterns = [
      '**/*.ts',
      '**/*.tsx',
      '**/*.js',
      '**/*.jsx',
      '**/*.php',
      '**/*.blade.php',
      '**/*.py',
      '**/*.go',
      '**/*.rs',
      '**/*.java',
      '**/*.vue',
      '**/*.svelte'
    ];

    const ignorePatterns = [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.git/**',
      '**/vendor/**',
      '**/__pycache__/**',
      '**/target/**',
      '**/coverage/**'
    ];

    let allFiles: string[] = [];

    try {
      for (const pattern of patterns) {
        const matches = await glob(pattern, {
          cwd: this.codebasePath,
          ignore: ignorePatterns,
          nodir: true,
          absolute: false
        });
        allFiles.push(...matches);
      }
    } catch (error) {
      console.error('[ContextScout] Glob error:', error);
    }

    // Dedupe and limit to top 20 files (prioritize by path relevance to task)
    allFiles = [...new Set(allFiles)];
    // Use BOTH description AND specification for keyword extraction
    const combinedText = `${task.description} ${task.specification || ''}`;
    const taskKeywords = combinedText.toLowerCase().split(/\s+/);

    // Score files by relevance to task
    const scoredFiles = allFiles.map(f => {
      const lowerPath = f.toLowerCase();
      let score = 0;
      for (const keyword of taskKeywords) {
        if (keyword.length > 2 && lowerPath.includes(keyword)) {
          score += 10;
        }
      }
      // Prefer shorter paths (core files)
      score -= f.split('/').length;
      return { path: f, score };
    });

    scoredFiles.sort((a, b) => b.score - a.score);
    const topFiles = scoredFiles.slice(0, 20).map(f => f.path);

    // OPTIMIZED: Read file contents in parallel with concurrency limit
    const CONCURRENCY = 10;
    const files: GatheredFile[] = [];

    // Process files in concurrent batches
    for (let i = 0; i < topFiles.length; i += CONCURRENCY) {
      const batch = topFiles.slice(i, i + CONCURRENCY);

      const batchResults = await Promise.all(
        batch.map(async (filePath) => {
          try {
            const fullPath = path.join(this.codebasePath, filePath);
            const content = await fs.readFile(fullPath, 'utf-8');
            // Truncate large files
            const truncated = content.length > 2000
              ? content.substring(0, 2000) + '\n// ... truncated ...'
              : content;
            return { path: filePath, content: truncated };
          } catch (error) {
            // Skip files that can't be read
            console.log(`[ContextScout] Skipping unreadable file: ${filePath}`);
            return null;
          }
        })
      );

      // Collect successful reads
      for (const result of batchResults) {
        if (result) files.push(result);
      }
    }

    // Query memory for relevant patterns
    // Use specification for memory query if available (more detailed context = better matches)
    let memoryResults: MemoryMatch[] = [];
    if (this.memoryEngine) {
      try {
        const queryText = task.specification || task.description;
        const queryResults = await this.memoryEngine.query(queryText, {
          topK: 5,
          minScore: 0.3
        });
        memoryResults = queryResults.map(r => ({
          id: r.entry.id,
          content: r.entry.content.substring(0, 500),
          score: r.score
        }));
      } catch (error) {
        console.error('[ContextScout] Memory query error:', error);
      }
    }

    return { files, memoryResults };
  }

  /**
   * Build the scout prompt with pre-gathered context.
   */
  private buildScoutPrompt(
    task: CodexTask,
    files: GatheredFile[],
    memoryResults: MemoryMatch[]
  ): string {
    // Inject polyglot context at the top if available
    const polyglotSection = this.polyglotContext
      ? `## POLYGLOT KNOWLEDGE (auto-loaded)\n${this.polyglotContext}\n\n---\n\n`
      : '';

    // Format file contents
    const filesSection = files.length > 0
      ? files.map(f => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``).join('\n\n')
      : '(No files gathered)';

    // Format memory results
    const memorySection = memoryResults.length > 0
      ? memoryResults.map(m => `- ID: ${m.id.substring(0, 8)}, Score: ${m.score.toFixed(2)}, Content: ${m.content.substring(0, 200)}...`).join('\n')
      : '(No memory matches)';

    return `# CONTEXT SCOUT - Research Phase

${polyglotSection}## Your Role
You are the RESEARCHER. Analyze the provided context and report findings.
DO NOT implement anything. Only research and report findings.

## Task
${task.description}

${task.specification ? `## Specification\n${task.specification}\n` : ''}

## CODEBASE FILES (pre-gathered)
${filesSection}

## MEMORY MATCHES (pre-queried)
${memorySection}

## Output Format
Analyze the provided context and output your findings in this exact format:

### RELEVANT_FILES
- path/to/file1.ts: Brief description of relevance
- path/to/file2.ts: Brief description of relevance

### MEMORY_MATCHES
- ID: abc12345, Score: 0.85, Content: Brief relevant content summary
- ID: def67890, Score: 0.72, Content: Brief relevant content summary

### DEPENDENCIES
- package-name: version or description
- another-package: version or description

### CODE_PATTERNS
- Style: camelCase | snake_case
- Testing: vitest | jest | mocha | none
- Structure: flat | nested | modular

### RECOMMENDATIONS
Brief notes on approach and key considerations (max 100 words).

Provide your analysis now.`;
  }

  /**
   * Execute API with the scout prompt (Claude or Ollama).
   */
  private async executeApi(prompt: string): Promise<string> {
    // Route to Ollama if configured
    if (this.useOllama && this.ollamaProvider) {
      console.log(`[ContextScout] Executing Ollama (${this.apiModel})...`);
      const engineerFn = this.ollamaProvider.createEngineer();
      const response = await engineerFn(prompt);
      console.log(`[ContextScout] Ollama completed: ${response.length} chars`);
      return response;
    }

    // Use Claude API
    if (!this.apiClient) {
      throw new Error('[ContextScout] API client not initialized - missing ANTHROPIC_API_KEY');
    }

    console.log(`[ContextScout] Executing Claude API (${this.apiModel})...`);

    const response = await this.apiClient.messages.create({
      model: this.apiModel,
      max_tokens: 4096,
      messages: [
        { role: 'user', content: prompt }
      ]
    });

    // Extract text from response
    const textBlock = response.content.find(block => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('[ContextScout] No text response from Claude API');
    }

    console.log(`[ContextScout] Claude API completed: ${textBlock.text.length} chars`);
    console.log(`[ContextScout] Usage: ${response.usage?.input_tokens || 0} in, ${response.usage?.output_tokens || 0} out`);

    return textBlock.text;
  }

  /**
   * Parse research output from Claude API.
   */
  private parseResearchOutput(output: string): ResearchResult {
    const result: ResearchResult = {
      relevantFiles: [],
      memoryResults: [],
      dependencies: {},
      patterns: {
        existingPatterns: [],
        codeStyle: 'ts.strict'
      }
    };

    // Parse RELEVANT_FILES section
    const filesMatch = output.match(/### RELEVANT_FILES\n([\s\S]*?)(?=###|$)/);
    if (filesMatch) {
      const fileLines = filesMatch[1].trim().split('\n');
      for (const line of fileLines) {
        const match = line.match(/^-\s*([\w/.]+):\s*(.+)$/);
        if (match) {
          result.relevantFiles.push({ path: match[1], summary: match[2] });
        }
      }
    }

    // Parse MEMORY_MATCHES section
    const memMatch = output.match(/### MEMORY_MATCHES\n([\s\S]*?)(?=###|$)/);
    if (memMatch) {
      const memLines = memMatch[1].trim().split('\n');
      for (const line of memLines) {
        const match = line.match(/ID:\s*(\w+),\s*Score:\s*([\d.]+),\s*Content:\s*(.+)/);
        if (match) {
          result.memoryResults.push({
            id: match[1],
            score: parseFloat(match[2]),
            content: match[3]
          });
        }
      }
    }

    // Parse DEPENDENCIES section
    const depsMatch = output.match(/### DEPENDENCIES\n([\s\S]*?)(?=###|$)/);
    if (depsMatch) {
      const depLines = depsMatch[1].trim().split('\n');
      for (const line of depLines) {
        const match = line.match(/^-\s*([\w@/-]+):\s*(.+)$/);
        if (match) {
          result.dependencies[match[1]] = match[2];
        }
      }
    }

    // Parse CODE_PATTERNS section
    const patternsMatch = output.match(/### CODE_PATTERNS\n([\s\S]*?)(?=###|$)/);
    if (patternsMatch) {
      const patternLines = patternsMatch[1].trim().split('\n');
      for (const line of patternLines) {
        const styleMatch = line.match(/Style:\s*(\w+)/i);
        if (styleMatch) {
          result.patterns.codeStyle = styleMatch[1].toLowerCase().includes('snake')
            ? 'ts.strict'
            : 'ts.loose';
        }
        const testMatch = line.match(/Testing:\s*(\w+)/i);
        if (testMatch) {
          result.patterns.existingPatterns.push(testMatch[1].toLowerCase());
        }
        const structMatch = line.match(/Structure:\s*(\w+)/i);
        if (structMatch) {
          result.patterns.existingPatterns.push(structMatch[1].toLowerCase());
        }
      }
    }

    return result;
  }

  /**
   * Format research results for compression.
   */
  private formatForCompression(task: CodexTask, research: ResearchResult): string {
    const parts: string[] = [];

    parts.push(`task: ${task.id}`);
    parts.push(`description: ${task.description}`);

    if (research.relevantFiles.length > 0) {
      const files = research.relevantFiles.map(f => f.path).join(', ');
      parts.push(`files: ${files}`);
    }

    if (research.memoryResults.length > 0) {
      const memIds = research.memoryResults.map(m => m.id.substring(0, 8)).join(', ');
      parts.push(`memory: ${memIds}`);
    }

    const deps = Object.keys(research.dependencies).join(', ');
    if (deps) {
      parts.push(`dependencies: ${deps}`);
    }

    if (research.patterns.existingPatterns.length > 0) {
      parts.push(`patterns: ${research.patterns.existingPatterns.join(', ')}`);
    }

    parts.push(`style: ${research.patterns.codeStyle}`);

    return parts.join('\n');
  }
}

// Factory function
export function createContextScout(
  codebasePath: string,
  polyglotContext = '',
  apiKey?: string,
  memoryEngine?: MemoryEngine,
  apiModel?: string
): ContextScout {
  return new ContextScout(codebasePath, polyglotContext, apiKey, memoryEngine, apiModel);
}
