/**
 * OllamaReasoner - Phases 2-3: Pure reasoning with Ollama.
 *
 * Phase 2 (ARCHITECT): Takes CTX tokens, outputs DES tokens
 * Phase 3 (ENGINEER): Takes CTX+DES tokens, outputs PLAN tokens + file contents
 *
 * No tools needed - pure reasoning over compressed context.
 * Falls back to Claude if context exceeds 32K tokens.
 */

import { getTokenRouter } from './TokenRouter.js';
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
 * OllamaReasoner handles pure reasoning phases.
 */
export class OllamaReasoner {
  private router = getTokenRouter();

  /**
   * Phase 2: ARCHITECT - Design the solution.
   */
  async architect(context: ContextBundle): Promise<DesignOutput> {
    console.log(`[OllamaReasoner] Phase 2: ARCHITECT for task ${context.taskId}`);

    const prompt = this.buildArchitectPrompt(context);
    const routeInfo = this.router.getRouteDecision(context.compressedToken);

    console.log(`[OllamaReasoner] ${routeInfo.reason}`);

    const response = await this.reason(prompt, context.compressedToken);
    return this.parseArchitectOutput(response);
  }

  /**
   * Phase 3: ENGINEER - Plan the implementation.
   */
  async engineer(context: ContextBundle, design: DesignOutput): Promise<PlanOutput> {
    console.log(`[OllamaReasoner] Phase 3: ENGINEER for task ${context.taskId}`);

    const combinedContext = `${context.compressedToken}\n${design.compressedToken}`;
    const prompt = this.buildEngineerPrompt(context, design);
    const routeInfo = this.router.getRouteDecision(combinedContext);

    console.log(`[OllamaReasoner] ${routeInfo.reason}`);

    const response = await this.reason(prompt, combinedContext);
    return this.parseEngineerOutput(response);
  }

  /**
   * Execute reasoning via TokenRouter.
   */
  private async reason(prompt: string, context: string): Promise<string> {
    const result = await this.router.route(
      context,
      prompt,
      async () => {
        // Claude fallback - would use SubAgentSpawner
        throw new Error('Claude fallback not implemented in OllamaReasoner');
      }
    );

    console.log(`[OllamaReasoner] Used ${result.provider} (${result.tokenCount} tokens)`);
    return result.response.content;
  }

  /**
   * Build ARCHITECT prompt.
   */
  private buildArchitectPrompt(context: ContextBundle): string {
    return `# ARCHITECT - Design Phase

## Your Role
You are the ARCHITECT. Design the solution structure based on the research context.
DO NOT write code. Only design components, models, and structure.

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
   * Build ENGINEER prompt.
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

    console.log(`[OllamaReasoner] Generated DES token: ${result.compressedToken.substring(0, 80)}...`);

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

    console.log(`[OllamaReasoner] Generated PLAN token: ${result.compressedToken.substring(0, 80)}...`);
    console.log(`[OllamaReasoner] Files to create: ${result.files.length}`);

    return result;
  }
}

// Factory function
export function createOllamaReasoner(): OllamaReasoner {
  return new OllamaReasoner();
}
