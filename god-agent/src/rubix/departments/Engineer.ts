/**
 * ENGINEER Department Head
 *
 * "Build it. Make it work. Ship the code."
 *
 * Responsible for implementing the actual code based on ARCHITECT's designs.
 * Highest parallelization potential - one sub-agent per file/module.
 */

import Anthropic from '@anthropic-ai/sdk';
import { DepartmentHead } from '../DepartmentHead.js';
import {
  DepartmentConfig,
  SubAgentTask,
  EngineerTask,
  Artifact
} from '../types.js';

export class Engineer extends DepartmentHead {
  constructor(config: Omit<DepartmentConfig, 'type'>) {
    super({ ...config, type: 'engineer' });
  }

  getSystemPrompt(): string {
    // Compressed prompt - pure function, zero fluff
    return `BUILD
ROLE:implement,code,ship
IN:design_spec
SUB_AGENTS:logic_builder,component_builder,algorithm_writer,integrator
OUT:<file path="" action="create|modify">full_code</file>
RULES:full_file,patterns,imports,errors,jsdoc
→{files:[{path,action,code}]}`;
  }

  getTools(): Anthropic.Tool[] {
    return [
      {
        name: 'read_file',
        description: 'Read a file for reference or modification',
        input_schema: {
          type: 'object' as const,
          properties: {
            path: { type: 'string', description: 'File path' }
          },
          required: ['path']
        }
      },
      {
        name: 'write_file',
        description: 'Write content to a file',
        input_schema: {
          type: 'object' as const,
          properties: {
            path: { type: 'string', description: 'File path' },
            content: { type: 'string', description: 'File content' }
          },
          required: ['path', 'content']
        }
      },
      {
        name: 'glob_files',
        description: 'Find files by pattern',
        input_schema: {
          type: 'object' as const,
          properties: {
            pattern: { type: 'string', description: 'Glob pattern' }
          },
          required: ['pattern']
        }
      },
      {
        name: 'run_command',
        description: 'Run a shell command (for builds, linting, etc)',
        input_schema: {
          type: 'object' as const,
          properties: {
            command: { type: 'string', description: 'Command to run' },
            cwd: { type: 'string', description: 'Working directory' }
          },
          required: ['command']
        }
      }
    ];
  }

  async decompose(instruction: string, context: string): Promise<SubAgentTask[]> {
    // Compressed decomposition prompt
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: `DECOMPOSE_BUILD
INSTRUCTION:${instruction.slice(0, 500)}
CTX:${context.slice(0, 1000)}
TYPES:logic_implementation,component_building,algorithm_writing,integration,refactoring
RULE:1_task_per_file,deps_ordered
→[{id,type,description,context,targetFile,deps:[]}]`
      }]
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\[[\s\S]*\]/);

    if (!jsonMatch) {
      return this.defaultDecomposition(instruction, context);
    }

    try {
      const tasks = JSON.parse(jsonMatch[0]) as EngineerTask[];
      return tasks.map(t => ({
        ...t,
        id: t.id || this.generateTaskId()
      }));
    } catch {
      return this.defaultDecomposition(instruction, context);
    }
  }

  private defaultDecomposition(instruction: string, context: string): SubAgentTask[] {
    return [
      {
        id: this.generateTaskId(),
        type: 'component_building',
        description: `Implement main component for: ${instruction}`,
        context
      }
    ];
  }

  protected processResponse(response: Anthropic.Message): { output: string; artifacts: Artifact[] } {
    let output = '';
    const artifacts: Artifact[] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        output += block.text;

        // Extract file artifacts
        const fileMatches = block.text.matchAll(/<file path="([^"]+)"[^>]*>([\s\S]*?)<\/file>/g);
        for (const match of fileMatches) {
          artifacts.push({
            type: 'file',
            path: match[1],
            content: match[2].trim()
          });
        }
      }
    }

    return { output, artifacts };
  }
}
