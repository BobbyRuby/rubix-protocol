/**
 * ContextScout - Phase 1: Claude gathers context with tools.
 *
 * Uses Claude Code CLI to:
 * - Glob/Read files in codebase
 * - Query god-agent memory for relevant patterns
 * - Analyze dependencies
 * - Identify code patterns and style
 *
 * Outputs: CTX token string for Phase 2 (Architect)
 */

import { spawn } from 'child_process';
import { COMPRESSION_SCHEMAS } from '../memory/CompressionSchemas.js';
import type { CodexTask } from './types.js';

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
  research: ResearchResult;
  compressedToken: string;  // CTX|...|...
}

/**
 * ContextScout gathers all context needed for subsequent phases.
 */
export class ContextScout {
  private codebasePath: string;
  private polyglotContext: string;
  private cliTimeout: number;

  constructor(codebasePath: string, polyglotContext = '', cliTimeout = 0) {
    this.codebasePath = codebasePath;
    this.polyglotContext = polyglotContext;
    this.cliTimeout = cliTimeout; // 0 = no timeout
  }

  /**
   * Scout context for a task using Claude Code CLI.
   * This is the only Claude call in the happy path (besides validation).
   */
  async scout(task: CodexTask): Promise<ContextBundle> {
    console.log(`[ContextScout] Phase 1: Scouting context for task ${task.id}`);

    const prompt = this.buildScoutPrompt(task);
    const cliOutput = await this.executeClaudeCLI(prompt);
    const research = this.parseResearchOutput(cliOutput);

    // Compress to CTX token
    const ctxInput = this.formatForCompression(task, research);
    const compressedToken = COMPRESSION_SCHEMAS.context_bundle.encode(ctxInput);

    console.log(`[ContextScout] Generated CTX token: ${compressedToken.substring(0, 100)}...`);

    return {
      taskId: task.id,
      description: task.description,
      research,
      compressedToken
    };
  }

  /**
   * Build the scout prompt for Claude Code CLI.
   */
  private buildScoutPrompt(task: CodexTask): string {
    // Inject polyglot context at the top if available
    const polyglotSection = this.polyglotContext
      ? `${this.polyglotContext}\n\n---\n\n`
      : '';

    return `# CONTEXT SCOUT - Research Phase
${polyglotSection}
## Your Role
You are the RESEARCHER. Your job is to gather all context needed for implementing this task.
DO NOT implement anything. Only research and report findings.

## Task
${task.description}

${task.specification ? `## Specification\n${task.specification}\n` : ''}

## Required Actions
1. Use Glob to find relevant files matching the task (*.ts, *.tsx, etc.)
2. Use Read to examine key files and understand patterns
3. Use god_query to check memory for related patterns or previous implementations
4. Identify:
   - Which files need to be created/modified
   - What dependencies are used
   - Code style (snake_case vs camelCase, test framework, etc.)
   - Related memory entries

## Output Format
Provide your findings in this exact format:

### RELEVANT_FILES
- path/to/file1.ts: Brief description
- path/to/file2.ts: Brief description

### MEMORY_MATCHES
- ID: abc12345, Score: 0.85, Content: ...
- ID: def67890, Score: 0.72, Content: ...

### DEPENDENCIES
- express: ^4.18.0
- pg: ^8.0.0

### CODE_PATTERNS
- Style: snake_case | camelCase
- Testing: vitest | jest | mocha
- Structure: flat | nested

### RECOMMENDATIONS
Brief notes on approach.

Begin your research now.`;
  }

  /**
   * Execute Claude Code CLI with the scout prompt.
   */
  private async executeClaudeCLI(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = [
        '-p', prompt,
        '--dangerously-skip-permissions',
        '--allowedTools', 'Read,Glob,Grep,mcp__rubix__god_query'
      ];

      console.log('[ContextScout] Executing Claude Code CLI...');

      const child = spawn('claude', args, {
        cwd: this.codebasePath,
        shell: false,                    // Direct execution (not through cmd.exe)
        windowsHide: true,               // No console window on Windows
        stdio: ['pipe', 'pipe', 'pipe'], // Explicit pipe configuration
        env: process.env                 // Full environment inheritance
      });

      let stdout = '';
      let stderr = '';
      let resolved = false;

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (resolved) return;
        resolved = true;
        if (code === 0) {
          resolve(stdout);
        } else {
          console.error('[ContextScout] CLI stderr:', stderr);
          reject(new Error(`Claude CLI exited with code ${code}: ${stderr}`));
        }
      });

      child.on('error', (error) => {
        if (resolved) return;
        resolved = true;
        reject(new Error(`Failed to spawn Claude CLI: ${error.message}`));
      });

      // Manual timeout (only if cliTimeout > 0, otherwise run until completion)
      if (this.cliTimeout > 0) {
        setTimeout(() => {
          if (resolved) return;
          resolved = true;
          child.kill('SIGTERM');
          reject(new Error(`Claude CLI timed out after ${this.cliTimeout}ms`));
        }, this.cliTimeout);
      }
    });
  }

  /**
   * Parse research output from Claude CLI.
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
        const match = line.match(/^-\s*(\w+):\s*(.+)$/);
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
export function createContextScout(codebasePath: string, polyglotContext = '', cliTimeout = 0): ContextScout {
  return new ContextScout(codebasePath, polyglotContext, cliTimeout);
}
