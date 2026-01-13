/**
 * RESEARCHER Department Head
 *
 * "What exists? What's possible? What's been tried?"
 *
 * Responsible for understanding the problem space, analyzing existing code,
 * finding patterns and precedents, and mapping the landscape before building.
 */

import Anthropic from '@anthropic-ai/sdk';
import { DepartmentHead } from '../DepartmentHead.js';
import {
  DepartmentConfig,
  SubAgentTask,
  ResearchTask
} from '../types.js';

export class Researcher extends DepartmentHead {
  constructor(config: Omit<DepartmentConfig, 'type'>) {
    super({ ...config, type: 'researcher' });
  }

  getSystemPrompt(): string {
    // Compressed prompt - pure function, zero fluff
    return `RESEARCH
ROLE:discover,analyze,map
SCAN:files,patterns,deps,conventions
SUB_AGENTS:file_analyzer,pattern_matcher,dep_grapher,doc_miner
→{overview:"",files:[],patterns:[],deps:{},recommendations:[],risks:[]}`;
  }

  getTools(): Anthropic.Tool[] {
    return [
      {
        name: 'read_file',
        description: 'Read the contents of a file',
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
        description: 'Find files matching a glob pattern',
        input_schema: {
          type: 'object' as const,
          properties: {
            pattern: { type: 'string', description: 'Glob pattern (e.g., "**/*.ts")' },
            cwd: { type: 'string', description: 'Directory to search from' }
          },
          required: ['pattern']
        }
      },
      {
        name: 'grep_search',
        description: 'Search for patterns in files',
        input_schema: {
          type: 'object' as const,
          properties: {
            pattern: { type: 'string', description: 'Regex pattern to search' },
            path: { type: 'string', description: 'Directory or file to search' },
            filePattern: { type: 'string', description: 'Glob to filter files' }
          },
          required: ['pattern']
        }
      },
      {
        name: 'list_directory',
        description: 'List contents of a directory',
        input_schema: {
          type: 'object' as const,
          properties: {
            path: { type: 'string', description: 'Directory path' }
          },
          required: ['path']
        }
      },
      {
        name: 'analyze_imports',
        description: 'Analyze import/export relationships in a file or directory',
        input_schema: {
          type: 'object' as const,
          properties: {
            path: { type: 'string', description: 'File or directory to analyze' }
          },
          required: ['path']
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
        content: `DECOMPOSE_RESEARCH
INSTRUCTION:${instruction.slice(0, 500)}
CTX:${context.slice(0, 1000)}
TYPES:file_analysis,pattern_detection,dependency_mapping,doc_mining,precedent_finding
→[{id,type,description,context,deps:[]}]
TARGET:3-5 parallel tasks`
      }]
    });

    // Parse the response
    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\[[\s\S]*\]/);

    if (!jsonMatch) {
      // Fallback to default decomposition
      return this.defaultDecomposition(instruction, context);
    }

    try {
      const tasks = JSON.parse(jsonMatch[0]) as ResearchTask[];
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
        type: 'file_analysis',
        description: `Analyze key files related to: ${instruction}`,
        context: context
      },
      {
        id: this.generateTaskId(),
        type: 'pattern_detection',
        description: `Find patterns and conventions relevant to: ${instruction}`,
        context: context
      },
      {
        id: this.generateTaskId(),
        type: 'dependency_mapping',
        description: `Map dependencies and relationships for: ${instruction}`,
        context: context
      }
    ];
  }
}
