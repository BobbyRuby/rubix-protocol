/**
 * ClaudeReasoner - Phases 2-3: API-based reasoning with Claude.
 *
 * Phase 2 (ARCHITECT): API Opus - Complex reasoning, stores decisions
 * Phase 3 (ENGINEER): API Sonnet - Fast implementation planning, ephemeral
 *
 * All calls use Anthropic API directly - no CLI dependency.
 */

import Anthropic from '@anthropic-ai/sdk';
import { COMPRESSION_SCHEMAS } from '../memory/CompressionSchemas.js';
import type { ContextBundle } from './ContextScout.js';
import { getCodexLogger } from './Logger.js';

/**
 * Component dependency for parallel engineering.
 */
export interface ComponentDependency {
  name: string;
  file: string;
  dependencies: string[];  // Names of components this depends on
}

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
  // Cost-based routing fields
  complexity: 'low' | 'medium' | 'high';
  componentDependencies: ComponentDependency[];
  // Task type classification (for documentation vs build tasks)
  taskType: 'document' | 'build' | 'modify';
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
  /** Anthropic API key for all calls */
  apiKey?: string;
  /** Codebase path for context */
  codebasePath: string;
  /** API model for implementation (default: claude-sonnet-4-20250514) */
  apiModel?: string;
  /** API model for architecture (default: claude-opus-4-20250514) */
  architectModel?: string;
}

/**
 * ClaudeReasoner handles reasoning phases with Claude API.
 *
 * Key design:
 * - API (Opus) for thinking: complex reasoning, architecture decisions
 * - API (Sonnet) for doing: fast implementation planning, ephemeral
 */
export class ClaudeReasoner {
  private apiClient: Anthropic | null = null;
  private apiModel: string;
  private architectModel: string;

  constructor(config: ClaudeReasonerConfig) {
    // codebasePath available via config if needed in future
    void config.codebasePath;
    this.apiModel = config.apiModel || 'claude-sonnet-4-20250514';
    this.architectModel = config.architectModel || 'claude-opus-4-20250514';

    // Initialize API client
    const apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      this.apiClient = new Anthropic({ apiKey });
      console.log('[ClaudeReasoner] API client initialized');
      console.log(`[ClaudeReasoner] Architect model: ${this.architectModel}`);
      console.log(`[ClaudeReasoner] Engineer model: ${this.apiModel}`);
    } else {
      console.warn('[ClaudeReasoner] No ANTHROPIC_API_KEY - reasoning phases will fail');
    }
  }

  /**
   * Phase 2: ARCHITECT - Design the solution using API Opus.
   *
   * Uses API (Opus) because:
   * - Complex reasoning required
   * - Architecture decisions need careful thought
   * - Opus has better reasoning capabilities
   */
  async architect(context: ContextBundle): Promise<DesignOutput> {
    console.log(`[ClaudeReasoner] Phase 2: ARCHITECT (API Opus) for task ${context.taskId}`);

    const prompt = this.buildArchitectPrompt(context);
    const logger = getCodexLogger();

    try {
      const response = await this.executeApiOpus(prompt);
      const result = this.parseArchitectOutput(response);

      // Log response for debugging
      logger.logResponse(
        'ARCHITECT',
        prompt,
        response,
        0, // No files in architect phase
        undefined,
        'architect'
      );

      return result;
    } catch (error) {
      logger.logResponse('ARCHITECT', prompt, '', 0, undefined, 'architect', String(error));
      console.error('[ClaudeReasoner] API Opus failed:', error);
      throw error;
    }
  }

  /**
   * Phase 3: ENGINEER - Plan the implementation using API Sonnet.
   *
   * Uses API (Sonnet) because:
   * - Implementation planning is straightforward
   * - Speed matters - Sonnet is faster than Opus
   * - Context already gathered - just need code generation
   */
  async engineer(context: ContextBundle, design: DesignOutput): Promise<PlanOutput> {
    console.log(`[ClaudeReasoner] Phase 3: ENGINEER (API Sonnet) for task ${context.taskId}`);

    const prompt = this.buildEngineerPrompt(context, design);
    const logger = getCodexLogger();

    try {
      const response = await this.executeApiSonnet(prompt);
      const result = this.parseEngineerOutput(response);

      // Log response for debugging
      logger.logResponse(
        'ENGINEER',
        prompt,
        response,
        result.files.length,
        result.files.map(f => ({ path: f.path, action: f.action })),
        'engineer'
      );

      // Log parsing failure if files expected but not found
      if (result.files.length === 0 && response.includes('<file')) {
        logger.logParsingFailure(response, 'ENGINEER phase - expected files but none parsed');
      }

      return result;
    } catch (error) {
      logger.logResponse('ENGINEER', prompt, '', 0, undefined, 'engineer', String(error));
      console.error('[ClaudeReasoner] API Sonnet failed:', error);
      throw error;
    }
  }

  /**
   * Execute prompt via Anthropic API (Opus) for architecture.
   */
  private async executeApiOpus(prompt: string): Promise<string> {
    if (!this.apiClient) {
      throw new Error('API client not initialized - missing ANTHROPIC_API_KEY');
    }

    console.log(`[ClaudeReasoner] Executing API Opus (${this.architectModel})...`);

    const response = await this.apiClient.messages.create({
      model: this.architectModel,
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

    console.log(`[ClaudeReasoner] API Opus completed: ${textBlock.text.length} chars`);
    console.log(`[ClaudeReasoner] Usage: ${response.usage?.input_tokens || 0} in, ${response.usage?.output_tokens || 0} out`);

    return textBlock.text;
  }

  /**
   * Execute prompt via Anthropic API (Sonnet) for implementation.
   */
  private async executeApiSonnet(prompt: string): Promise<string> {
    if (!this.apiClient) {
      throw new Error('API client not initialized - missing ANTHROPIC_API_KEY');
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

## CRITICAL: Task Type Interpretation
Before designing, classify the task type:

**DOCUMENTATION/ANALYSIS tasks** (keywords: "document", "analyze", "examine", "describe", "map", "list", "export", "generate report"):
- The OUTPUT should be markdown/text documentation
- DO NOT create code infrastructure, frameworks, or tools
- DO analyze the TARGET codebase/directory
- DO produce documentation files (*.md, *.txt, *.json)
- Example: "Document the API" → Output API.md, NOT "DocumentationTool.ts"

**BUILD/IMPLEMENTATION tasks** (keywords: "build", "create", "implement", "add feature", "fix bug"):
- The OUTPUT should be working code
- DO create necessary code components
- Example: "Build a login feature" → Output LoginService.ts, LoginController.ts

**When in doubt:**
- If task mentions "create documentation FOR X" → documentation task
- If task mentions "create a tool TO document" → build task
- If unclear → flag in NOTES and recommend clarification

## Project Root
${context.codebaseRoot}
ALL paths in your output MUST be RELATIVE to this root (e.g., "src/models/User.ts", NOT "/project/src/models/User.ts").

## Context (Compressed)
${context.compressedToken}

## Task
${context.description}

${context.specification ? `## Detailed Specification\n${context.specification}\n` : ''}
## Research Findings
${context.research.relevantFiles.length > 0
  ? `Files: ${context.research.relevantFiles.map(f => f.path).join(', ')}`
  : 'No relevant files identified'}

${context.research.patterns.existingPatterns.length > 0
  ? `Patterns: ${context.research.patterns.existingPatterns.join(', ')}`
  : 'No patterns identified'}

${Object.keys(context.research.dependencies).length > 0
  ? `Dependencies: ${Object.keys(context.research.dependencies).join(', ')}`
  : 'No dependencies identified'}

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

### TASK_TYPE
Classify the task type (REQUIRED - pick exactly one):
- document: Task requires analyzing existing code/project and producing documentation OUTPUT
- build: Task requires creating/modifying code components
- modify: Task requires changing existing code behavior

### COMPLEXITY
Rate the task complexity (REQUIRED - pick exactly one):
- low: Simple task, single file, no dependencies, straightforward logic
- medium: Multiple files, some dependencies, moderate logic
- high: Architecture changes, many interdependencies, security/auth/database, complex business logic

### COMPONENT_DEPENDENCIES
List components with their file paths and dependencies for parallel engineering.
Format each component as: ComponentName: path/to/file.ts, deps: [DependencyA, DependencyB]
Components with no dependencies: deps: []

Example:
- User: src/models/User.ts, deps: []
- AuthService: src/services/AuthService.ts, deps: [User]
- AuthController: src/controllers/AuthController.ts, deps: [AuthService]

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

${context.specification ? `## Detailed Specification\n${context.specification}\n` : ''}
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
      compressedToken: '',
      complexity: 'medium',  // Default to medium if not specified
      componentDependencies: [],
      taskType: 'build'  // Default to build if not specified
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

    // Parse TASK_TYPE
    const taskTypeMatch = output.match(/### TASK_TYPE\n[^-]*-?\s*(document|build|modify)/i);
    if (taskTypeMatch) {
      result.taskType = taskTypeMatch[1].toLowerCase() as 'document' | 'build' | 'modify';
    }
    console.log(`[ClaudeReasoner] Detected task type: ${result.taskType}`);

    // Parse COMPLEXITY
    const complexityMatch = output.match(/### COMPLEXITY\n[^-]*-?\s*(low|medium|high)/i);
    if (complexityMatch) {
      result.complexity = complexityMatch[1].toLowerCase() as 'low' | 'medium' | 'high';
    }
    console.log(`[ClaudeReasoner] Detected complexity: ${result.complexity}`);

    // Parse COMPONENT_DEPENDENCIES
    const depsMatch = output.match(/### COMPONENT_DEPENDENCIES\n([\s\S]*?)(?=###|$)/);
    if (depsMatch) {
      // Match format: - ComponentName: path/to/file.ts, deps: [Dep1, Dep2]
      // File path can contain: word chars, slashes, dots, hyphens, underscores
      const depRegex = /^-\s*(\w+):\s*([\w/.@-]+),\s*deps:\s*\[(.*?)\]/gm;
      for (const match of depsMatch[1].matchAll(depRegex)) {
        const dependencies = match[3].trim()
          ? match[3].split(',').map(d => d.trim()).filter(d => d.length > 0)
          : [];
        result.componentDependencies.push({
          name: match[1],
          file: match[2],
          dependencies
        });
      }
    }

    if (result.componentDependencies.length > 0) {
      console.log(`[ClaudeReasoner] Parsed ${result.componentDependencies.length} component dependencies:`);
      for (const dep of result.componentDependencies) {
        console.log(`  - ${dep.name}: ${dep.file} (deps: ${dep.dependencies.join(', ') || 'none'})`);
      }
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

    // Parse FILES - flexible pattern that handles any attribute order, whitespace, or line endings
    const fileMatches = output.matchAll(/<file\s+([^>]+)>([\s\S]*?)<\/file>/g);
    for (const match of fileMatches) {
      const attrs = match[1];
      const pathMatch = attrs.match(/path="([^"]+)"/);
      const actionMatch = attrs.match(/action="([^"]+)"/);
      if (pathMatch) {
        result.files.push({
          path: pathMatch[1],
          action: (actionMatch?.[1] || 'modify') as 'create' | 'modify' | 'delete',
          content: match[2].trim()
        });
      }
    }

    // Debug logging if no files were found but output contains file-like content
    if (result.files.length === 0 && output.includes('<file')) {
      console.log(`[ClaudeReasoner] WARNING: Output contains '<file' but no files parsed.`);
      console.log(`[ClaudeReasoner] Raw file tags found: ${(output.match(/<file[^>]*>/g) || []).join(', ')}`);
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
