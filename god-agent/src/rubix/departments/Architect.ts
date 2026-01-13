/**
 * ARCHITECT Department Head
 *
 * "How should it be structured? What interfaces? What patterns?"
 *
 * Responsible for designing the solution structure, defining interfaces,
 * planning file organization, and making technology decisions.
 */

import Anthropic from '@anthropic-ai/sdk';
import { DepartmentHead } from '../DepartmentHead.js';
import {
  DepartmentConfig,
  SubAgentTask,
  ArchitectTask,
  Artifact
} from '../types.js';

export class Architect extends DepartmentHead {
  constructor(config: Omit<DepartmentConfig, 'type'>) {
    super({ ...config, type: 'architect' });
  }

  getSystemPrompt(): string {
    // Compressed prompt - pure function, zero fluff
    return `DESIGN
ROLE:structure,interfaces,data_models
SUB_AGENTS:structure_designer,interface_designer,data_modeler,module_planner
OUT:<design type="structure|interface|data-model|plan">content</design>
→{components:[{name,responsibility,interface}],dataflow:[],contracts:[]}`;
  }

  getTools(): Anthropic.Tool[] {
    return [
      {
        name: 'read_file',
        description: 'Read existing file for reference',
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
        description: 'Find files matching a pattern',
        input_schema: {
          type: 'object' as const,
          properties: {
            pattern: { type: 'string', description: 'Glob pattern' },
            cwd: { type: 'string', description: 'Base directory' }
          },
          required: ['pattern']
        }
      },
      {
        name: 'list_directory',
        description: 'List directory contents',
        input_schema: {
          type: 'object' as const,
          properties: {
            path: { type: 'string', description: 'Directory path' }
          },
          required: ['path']
        }
      },
      {
        name: 'create_design',
        description: 'Create a design artifact',
        input_schema: {
          type: 'object' as const,
          properties: {
            type: {
              type: 'string',
              enum: ['structure', 'interface', 'data-model', 'implementation-plan'],
              description: 'Type of design'
            },
            content: { type: 'string', description: 'Design content' }
          },
          required: ['type', 'content']
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
        content: `DECOMPOSE_DESIGN
INSTRUCTION:${instruction.slice(0, 500)}
CTX:${context.slice(0, 1000)}
TYPES:structure_design,interface_design,data_modeling,module_planning,tech_evaluation
→[{id,type,description,context,deps:[]}]
TARGET:3-5 parallel tasks`
      }]
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\[[\s\S]*\]/);

    if (!jsonMatch) {
      return this.defaultDecomposition(instruction, context);
    }

    try {
      const tasks = JSON.parse(jsonMatch[0]) as ArchitectTask[];
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
        type: 'structure_design',
        description: `Design file structure for: ${instruction}`,
        context
      },
      {
        id: this.generateTaskId(),
        type: 'interface_design',
        description: `Define interfaces and contracts for: ${instruction}`,
        context
      },
      {
        id: this.generateTaskId(),
        type: 'data_modeling',
        description: `Create data models for: ${instruction}`,
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

        // Extract design artifacts
        const designMatches = block.text.matchAll(/<design type="([^"]+)">([\s\S]*?)<\/design>/g);
        for (const match of designMatches) {
          artifacts.push({
            type: 'design',
            content: match[2].trim(),
            metadata: { designType: match[1] }
          });
        }

        // Also extract file artifacts
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
