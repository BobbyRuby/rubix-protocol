/**
 * VALIDATOR Department Head
 *
 * "Does it work? What breaks it? Is it correct?"
 *
 * Responsible for testing and validating all code produced by ENGINEER.
 * Thinks adversarially - trying to break what was built.
 */

import Anthropic from '@anthropic-ai/sdk';
import { DepartmentHead } from '../DepartmentHead.js';
import {
  DepartmentConfig,
  SubAgentTask,
  ValidatorTask,
  Artifact
} from '../types.js';

export class Validator extends DepartmentHead {
  constructor(config: Omit<DepartmentConfig, 'type'>) {
    super({ ...config, type: 'validator' });
  }

  getSystemPrompt(): string {
    // Compressed prompt - pure function, zero fluff
    return `TEST
ROLE:verify,break,validate
SUB_AGENTS:unit_tester,integration_tester,edge_finder,type_validator
MINDSET:break_it|null|network_fail|race_conditions
OUT:<file path=".test.ts">tests</file>
→{tests:[{path,code}],coverage:{pass,fail,%},issues:[]}`;
  }

  getTools(): Anthropic.Tool[] {
    return [
      {
        name: 'read_file',
        description: 'Read source file to understand what to test',
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
        description: 'Write test file',
        input_schema: {
          type: 'object' as const,
          properties: {
            path: { type: 'string', description: 'Test file path' },
            content: { type: 'string', description: 'Test content' }
          },
          required: ['path', 'content']
        }
      },
      {
        name: 'glob_files',
        description: 'Find files to test',
        input_schema: {
          type: 'object' as const,
          properties: {
            pattern: { type: 'string', description: 'Glob pattern' }
          },
          required: ['pattern']
        }
      },
      {
        name: 'run_tests',
        description: 'Execute tests and get results',
        input_schema: {
          type: 'object' as const,
          properties: {
            testPath: { type: 'string', description: 'Path to test file or directory' },
            watch: { type: 'boolean', description: 'Run in watch mode' }
          },
          required: ['testPath']
        }
      },
      {
        name: 'analyze_coverage',
        description: 'Analyze test coverage',
        input_schema: {
          type: 'object' as const,
          properties: {
            path: { type: 'string', description: 'Path to analyze' }
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
        content: `DECOMPOSE_TEST
INSTRUCTION:${instruction.slice(0, 500)}
CTX:${context.slice(0, 1000)}
TYPES:unit_test,integration_test,edge_case,type_validation,behavior_check
RULE:1_task_per_source_file
→[{id,type,description,context,targetFile,deps:[]}]`
      }]
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\[[\s\S]*\]/);

    if (!jsonMatch) {
      return this.defaultDecomposition(instruction, context);
    }

    try {
      const tasks = JSON.parse(jsonMatch[0]) as ValidatorTask[];
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
        type: 'unit_test',
        description: `Write unit tests for: ${instruction}`,
        context
      },
      {
        id: this.generateTaskId(),
        type: 'edge_case',
        description: `Find edge cases for: ${instruction}`,
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

        // Extract test file artifacts
        const fileMatches = block.text.matchAll(/<file path="([^"]+)"[^>]*>([\s\S]*?)<\/file>/g);
        for (const match of fileMatches) {
          artifacts.push({
            type: 'test',
            path: match[1],
            content: match[2].trim()
          });
        }

        // Extract test reports
        const reportMatches = block.text.matchAll(/<report type="([^"]+)">([\s\S]*?)<\/report>/g);
        for (const match of reportMatches) {
          artifacts.push({
            type: 'report',
            content: match[2].trim(),
            metadata: { reportType: match[1] }
          });
        }
      }
    }

    return { output, artifacts };
  }
}
