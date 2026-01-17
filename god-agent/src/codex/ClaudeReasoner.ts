/**
 * ClaudeReasoner - Phases 2-3: Hybrid reasoning with Claude.
 *
 * Phase 2 (ARCHITECT): CLI Opus - Complex reasoning, MCP access, stores decisions
 * Phase 3 (ENGINEER): API Sonnet - Fast implementation planning, ephemeral
 *
 * Replaces OllamaReasoner entirely - Claude only, no third-party providers.
 */

import Anthropic from '@anthropic-ai/sdk';
import { spawn } from 'child_process';
import { COMPRESSION_SCHEMAS } from '../memory/CompressionSchemas.js';
import type { ContextBundle } from './ContextScout.js';

/**
 * Design output from Phase 2 (ARCHITECT).
 */
export interface DesignOutput {
  components: string[];
  models: string[];
  directories: string[];
  apis: string[];
  notes: string;
  compressedToken: string;  // DES|...|...
}

/**
 * File content to be created/modified.
 */
export interface FileContent {
  path: string;
  action: 'create' | 'modify' | 'delete';
  content: string;
}

/**
 * Plan output from Phase 3 (ENGINEER).
 */
export interface PlanOutput {
  department: 'eng' | 'val' | 'gua';
  operations: Array<{ action: 'C' | 'M' | 'D'; path: string }>;
  commands: string[];
  confidence: number;
  notes: string;
  files: FileContent[];
  compressedToken: string;  // PLAN|...|...
}

/**
 * Configuration for ClaudeReasoner
 */
export interface ClaudeReasonerConfig {
  /** Anthropic API key for Sonnet calls */
  apiKey?: string;
  /** Codebase path for CLI execution */
  codebasePath: string;
  /** CLI timeout in ms (default: 5 minutes) */
  cliTimeout?: number;
  /** API model for implementation (default: claude-sonnet-4-20250514) */
  apiModel?: string;
}

/**
 * ClaudeReasoner handles reasoning phases with Claude hybrid approach.
 *
 * Key design:
 * - CLI (Opus) for thinking: complex reasoning, MCP access, stores decisions
 * - API (Sonnet) for doing: fast implementation planning, ephemeral
 */
export class ClaudeReasoner {
  private apiClient: Anthropic | null = null;
  private apiModel: string;
  private codebasePath: string;
  private cliTimeout: number;

  constructor(config: ClaudeReasonerConfig) {
    this.codebasePath = config.codebasePath;
    this.cliTimeout = config.cliTimeout || 5 * 60 * 1000; // 5 minutes
    this.apiModel = config.apiModel || 'claude-sonnet-4-20250514';

    // Initialize API client for Sonnet calls (Phase 3)
    const apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      this.apiClient = new Anthropic({ apiKey });
      console.log('[ClaudeReasoner] API client initialized for Sonnet calls');
    } else {
      console.warn('[ClaudeReasoner] No ANTHROPIC_API_KEY - Phase 3 will use CLI fallback');
    }
  }

  /**
   * Phase 2: ARCHITECT - Design the solution using CLI Opus.
   *
   * Uses CLI (Opus) because:
   * - Complex reasoning required
   * - Has MCP access for memory queries
   * - Decisions should be stored for learning
   */
  async architect(context: ContextBundle): Promise<DesignOutput> {
    console.log(`[ClaudeReasoner] Phase 2: ARCHITECT (CLI Opus) for task ${context.taskId}`);

    const prompt = this.buildArchitectPrompt(context);

    try {
      const response = await this.executeCliOpus(prompt);
      return this.parseArchitectOutput(response);
    } catch (error) {
      console.error('[ClaudeReasoner] CLI Opus failed:', error);
      throw error;
    }
  }

  /**
   * Phase 3: ENGINEER - Plan the implementation using API Sonnet.
   *
   * Uses API (Sonnet) because:
   * - Implementation planning is straightforward
   * - Speed matters - Sonnet is faster than CLI
   * - No MCP access needed - context already gathered
   * - Ephemeral - doesn't need to store
   */
  async engineer(context: ContextBundle, design: DesignOutput): Promise<PlanOutput> {
    console.log(`[ClaudeReasoner] Phase 3: ENGINEER (API Sonnet) for task ${context.taskId}`);

    const prompt = this.buildEngineerPrompt(context, design);

    // Prefer API Sonnet for speed
    if (this.apiClient) {
      try {
        const response = await this.executeApiSonnet(prompt);
        return this.parseEngineerOutput(response);
      } catch (error) {
        console.error('[ClaudeReasoner] API Sonnet failed, falling back to CLI:', error);
        // Fall through to CLI fallback
      }
    }

    // Fallback to CLI if API unavailable
    console.log('[ClaudeReasoner] Using CLI fallback for ENGINEER phase');
    const response = await this.executeCliOpus(prompt);
    return this.parseEngineerOutput(response);
  }

  /**
   * Execute prompt via Claude Code CLI (Opus).
   */
  private async executeCliOpus(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = [
        '-p', prompt,
        '--model', 'opus',
        '--allowedTools', 'Read,Glob,Grep,mcp__rubix__god_query,mcp__rubix__god_store'
      ];

      console.log('[ClaudeReasoner] Executing Claude Code CLI (Opus)...');

      const child = spawn('claude', args, {
        cwd: this.codebasePath,
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env
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
          console.log(`[ClaudeReasoner] CLI Opus completed: ${stdout.length} chars`);
          resolve(stdout);
        } else {
          console.error('[ClaudeReasoner] CLI stderr:', stderr);
          reject(new Error(`Claude CLI exited with code ${code}: ${stderr}`));
        }
      });

      child.on('error', (error) => {
        if (resolved) return;
        resolved = true;
        reject(new Error(`Failed to spawn Claude CLI: ${error.message}`));
      });

      setTimeout(() => {
        if (resolved) return;
        resolved = true;
        child.kill('SIGTERM');
        reject(new Error(`Claude CLI timed out after ${this.cliTimeout}ms`));
      }, this.cliTimeout);
    });
  }

  /**
   * Execute prompt via Anthropic API (Sonnet).
   */
  private async executeApiSonnet(prompt: string): Promise<string> {
    if (!this.apiClient) {
      throw new Error('API client not initialized');
    }

    console.log(`[ClaudeReasoner] Executing API Sonnet (${this.apiModel})...`);

    const response = await this.apiClient.messages.create({
      model: this.apiModel,
      max_tokens: 8192,
      messages: [
        { role: 'user', content: prompt }
      ]
    });

    // Extract text from response
    const textBlock = response.content.find(block => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No text response from Claude API');
    }

    console.log(`[ClaudeReasoner] API Sonnet completed: ${textBlock.text.length} chars`);
    console.log(`[ClaudeReasoner] Usage: ${response.usage?.input_tokens || 0} in, ${response.usage?.output_tokens || 0} out`);

    return textBlock.text;
  }

  /**
   * Build ARCHITECT prompt for Phase 2.
   */
  private buildArchitectPrompt(context: ContextBundle): string {
    return `# ARCHITECT - Design Phase

## Your Role
You are the ARCHITECT. Design the solution structure based on the research context.
DO NOT write code. Only design components, models, and structure.

## MEMORY RECALL (Do this FIRST)
Before designing, query memory for relevant context:
- mcp__rubix__god_query "architecture patterns ${context.description.substring(0, 50)}"
- mcp__rubix__god_query "similar implementations"
- mcp__rubix__god_query "past design decisions"

Use memory to inform your architecture. Learn from past successes and failures.

## Context (Compressed)
${context.compressedToken}

## Task
${context.description}

## Required Output
Design the solution with:

### COMPONENTS
List the components/classes/services to create:
- ComponentName: Brief purpose

### MODELS
List the data models/types:
- ModelName: Brief description

### DIRECTORIES
List directories to create/use:
- path/to/dir/

### APIS
List API endpoints/functions:
- endpointName: Brief purpose

### NOTES
Brief design notes (max 50 words).

Output ONLY the structured sections above. No explanations.`;
  }

  /**
   * Build ENGINEER prompt for Phase 3.
   */
  private buildEngineerPrompt(context: ContextBundle, design: DesignOutput): string {
    return `# ENGINEER - Implementation Phase

## Your Role
You are the ENGINEER. Create the implementation plan and file contents.
Write complete, working code for each file.

## Context (Compressed)
${context.compressedToken}

## Design (Compressed)
${design.compressedToken}

## Task
${context.description}

## Required Output

### OPERATIONS
List file operations:
- CREATE: path/to/file.ts
- MODIFY: path/to/existing.ts
- DELETE: path/to/old.ts

### COMMANDS
Shell commands to run after:
- npm test
- npm run build

### CONFIDENCE
Rate your confidence (0.0 to 1.0): 0.85

### NOTES
Brief implementation notes.

### FILES
For each file, provide complete content:

<file path="src/path/to/file.ts" action="create">
// Complete TypeScript code here
</file>

<file path="src/path/to/other.ts" action="modify">
// Complete modified code here
</file>

Provide COMPLETE file contents. No placeholders or TODOs.`;
  }

  /**
   * Parse ARCHITECT output to DesignOutput.
   */
  private parseArchitectOutput(output: string): DesignOutput {
    const result: DesignOutput = {
      components: [],
      models: [],
      directories: [],
      apis: [],
      notes: '',
      compressedToken: ''
    };

    // Parse COMPONENTS
    const compsMatch = output.match(/### COMPONENTS\n([\s\S]*?)(?=###|$)/);
    if (compsMatch) {
      for (const match of compsMatch[1].matchAll(/^-\s*(\w+):/gm)) {
        result.components.push(match[1]);
      }
    }

    // Parse MODELS
    const modelsMatch = output.match(/### MODELS\n([\s\S]*?)(?=###|$)/);
    if (modelsMatch) {
      for (const match of modelsMatch[1].matchAll(/^-\s*(\w+):/gm)) {
        result.models.push(match[1]);
      }
    }

    // Parse DIRECTORIES
    const dirsMatch = output.match(/### DIRECTORIES\n([\s\S]*?)(?=###|$)/);
    if (dirsMatch) {
      for (const match of dirsMatch[1].matchAll(/^-\s*([\w/]+)/gm)) {
        result.directories.push(match[1]);
      }
    }

    // Parse APIS
    const apisMatch = output.match(/### APIS\n([\s\S]*?)(?=###|$)/);
    if (apisMatch) {
      for (const match of apisMatch[1].matchAll(/^-\s*(\w+):/gm)) {
        result.apis.push(match[1]);
      }
    }

    // Parse NOTES
    const notesMatch = output.match(/### NOTES\n([\s\S]*?)(?=###|$)/);
    if (notesMatch) {
      result.notes = notesMatch[1].trim().substring(0, 100);
    }

    // Compress to DES token
    const desInput = [
      `comps: ${result.components.join(', ')}`,
      `models: ${result.models.join(', ')}`,
      `files: ${result.directories.join(', ')}`,
      `apis: ${result.apis.join(', ')}`,
      `notes: ${result.notes}`
    ].join('\n');

    result.compressedToken = COMPRESSION_SCHEMAS.design.encode(desInput);

    console.log(`[ClaudeReasoner] Generated DES token: ${result.compressedToken.substring(0, 80)}...`);

    return result;
  }

  /**
   * Parse ENGINEER output to PlanOutput.
   */
  private parseEngineerOutput(output: string): PlanOutput {
    const result: PlanOutput = {
      department: 'eng',
      operations: [],
      commands: [],
      confidence: 0.8,
      notes: '',
      files: [],
      compressedToken: ''
    };

    // Parse OPERATIONS
    const opsMatch = output.match(/### OPERATIONS\n([\s\S]*?)(?=###|$)/);
    if (opsMatch) {
      for (const match of opsMatch[1].matchAll(/^-\s*(CREATE|MODIFY|DELETE):\s*([\w/.]+)/gim)) {
        const action = match[1][0].toUpperCase() as 'C' | 'M' | 'D';
        result.operations.push({ action, path: match[2] });
      }
    }

    // Parse COMMANDS
    const cmdsMatch = output.match(/### COMMANDS\n([\s\S]*?)(?=###|$)/);
    if (cmdsMatch) {
      for (const match of cmdsMatch[1].matchAll(/^-\s*(.+)$/gm)) {
        result.commands.push(match[1].trim());
      }
    }

    // Parse CONFIDENCE
    const confMatch = output.match(/### CONFIDENCE\n[^\d]*([\d.]+)/);
    if (confMatch) {
      result.confidence = parseFloat(confMatch[1]);
    }

    // Parse NOTES
    const notesMatch = output.match(/### NOTES\n([\s\S]*?)(?=###|<file|$)/);
    if (notesMatch) {
      result.notes = notesMatch[1].trim().substring(0, 100);
    }

    // Parse FILES
    const fileMatches = output.matchAll(/<file\s+path="([^"]+)"\s+action="([^"]+)">\n([\s\S]*?)<\/file>/g);
    for (const match of fileMatches) {
      result.files.push({
        path: match[1],
        action: match[2] as 'create' | 'modify' | 'delete',
        content: match[3].trim()
      });
    }

    // Compress to PLAN token
    const planInput = [
      `department: ${result.department}`,
      result.operations.map(op => `${op.action === 'C' ? 'create' : op.action === 'M' ? 'modify' : 'delete'}: ${op.path}`).join('\n'),
      result.commands.map(c => `command: ${c}`).join('\n'),
      `confidence: ${result.confidence}`,
      `notes: ${result.notes}`
    ].join('\n');

    result.compressedToken = COMPRESSION_SCHEMAS.exec_plan.encode(planInput);

    console.log(`[ClaudeReasoner] Generated PLAN token: ${result.compressedToken.substring(0, 80)}...`);
    console.log(`[ClaudeReasoner] Files to create: ${result.files.length}`);

    return result;
  }
}

// Factory function
export function createClaudeReasoner(config: ClaudeReasonerConfig): ClaudeReasoner {
  return new ClaudeReasoner(config);
}

// Default factory with environment configuration
export function createDefaultClaudeReasoner(codebasePath: string): ClaudeReasoner {
  return new ClaudeReasoner({
    codebasePath,
    apiKey: process.env.ANTHROPIC_API_KEY
  });
}
