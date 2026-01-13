/**
 * GUARDIAN Department Head
 *
 * "Is it safe? Is it fast? Is it maintainable?"
 *
 * The final quality gate. Responsible for security, performance,
 * code quality, and ensuring the code is production-ready.
 */

import Anthropic from '@anthropic-ai/sdk';
import { DepartmentHead } from '../DepartmentHead.js';
import {
  DepartmentConfig,
  SubAgentTask,
  GuardianTask,
  Artifact
} from '../types.js';

export class Guardian extends DepartmentHead {
  constructor(config: Omit<DepartmentConfig, 'type'>) {
    super({ ...config, type: 'guardian' });
  }

  getSystemPrompt(): string {
    // Compressed prompt - pure function, zero fluff
    return `GUARD
ROLE:security,performance,quality
CHECK:owasp_top10,injection,xss,auth,perf,memory,errors
SUB_AGENTS:security_scanner,perf_profiler,style_reviewer,resilience_checker
OUT:<review type="security|perf|quality" severity="crit|high|med|low">findings</review>
→{issues:[{severity,file,line,desc}],scores:{security,perf,quality},approved:bool}`;
  }

  getTools(): Anthropic.Tool[] {
    return [
      {
        name: 'read_file',
        description: 'Read file for security/quality analysis',
        input_schema: {
          type: 'object' as const,
          properties: {
            path: { type: 'string', description: 'File path' }
          },
          required: ['path']
        }
      },
      {
        name: 'glob_files',
        description: 'Find files to review',
        input_schema: {
          type: 'object' as const,
          properties: {
            pattern: { type: 'string', description: 'Glob pattern' }
          },
          required: ['pattern']
        }
      },
      {
        name: 'grep_search',
        description: 'Search for security anti-patterns',
        input_schema: {
          type: 'object' as const,
          properties: {
            pattern: { type: 'string', description: 'Regex pattern' },
            path: { type: 'string', description: 'Search path' }
          },
          required: ['pattern']
        }
      },
      {
        name: 'run_linter',
        description: 'Run linting tools',
        input_schema: {
          type: 'object' as const,
          properties: {
            path: { type: 'string', description: 'Path to lint' },
            tool: { type: 'string', enum: ['eslint', 'tsc', 'prettier'], description: 'Linter to use' }
          },
          required: ['path']
        }
      },
      {
        name: 'check_dependencies',
        description: 'Check for vulnerable dependencies',
        input_schema: {
          type: 'object' as const,
          properties: {
            packageFile: { type: 'string', description: 'Path to package.json' }
          },
          required: ['packageFile']
        }
      },
      {
        name: 'create_issue',
        description: 'Create an issue for tracking',
        input_schema: {
          type: 'object' as const,
          properties: {
            severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'], description: 'Issue severity' },
            category: { type: 'string', enum: ['security', 'performance', 'quality'], description: 'Issue category' },
            title: { type: 'string', description: 'Issue title' },
            description: { type: 'string', description: 'Issue description' },
            file: { type: 'string', description: 'Affected file' },
            line: { type: 'number', description: 'Line number' }
          },
          required: ['severity', 'category', 'title', 'description']
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
        content: `DECOMPOSE_GUARD
INSTRUCTION:${instruction.slice(0, 500)}
CTX:${context.slice(0, 1000)}
TYPES:security_scan,performance_analysis,code_review,resilience_check,standards_enforcement
→[{id,type,description,context,deps:[]}]`
      }]
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\[[\s\S]*\]/);

    if (!jsonMatch) {
      return this.defaultDecomposition(instruction, context);
    }

    try {
      const tasks = JSON.parse(jsonMatch[0]) as GuardianTask[];
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
        type: 'security_scan',
        description: `Security scan for: ${instruction}`,
        context
      },
      {
        id: this.generateTaskId(),
        type: 'performance_analysis',
        description: `Performance analysis for: ${instruction}`,
        context
      },
      {
        id: this.generateTaskId(),
        type: 'code_review',
        description: `Code quality review for: ${instruction}`,
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

        // Extract review artifacts
        const reviewMatches = block.text.matchAll(/<review type="([^"]+)"(?:\s+severity="([^"]+)")?>([\s\S]*?)<\/review>/g);
        for (const match of reviewMatches) {
          artifacts.push({
            type: 'review',
            content: match[3].trim(),
            metadata: {
              reviewType: match[1],
              severity: match[2] || 'info'
            }
          });
        }
      }
    }

    return { output, artifacts };
  }

  /**
   * Override synthesize to produce a comprehensive guardian report
   */
  protected async synthesize(
    instruction: string,
    results: import('../types.js').SubAgentResult[]
  ): Promise<import('../types.js').DepartmentReport> {
    const baseReport = await super.synthesize(instruction, results);

    // Extract all review artifacts and categorize issues
    const securityIssues: string[] = [];
    const performanceIssues: string[] = [];
    const qualityIssues: string[] = [];

    for (const artifact of baseReport.artifacts) {
      if (artifact.type === 'review' && artifact.metadata) {
        const severity = artifact.metadata.severity;
        const type = artifact.metadata.reviewType;

        if (severity === 'critical' || severity === 'high') {
          if (type === 'security') securityIssues.push(artifact.content);
          else if (type === 'performance') performanceIssues.push(artifact.content);
          else qualityIssues.push(artifact.content);
        }
      }
    }

    // Add blocking issues to report
    const blockingIssues = [...securityIssues];
    if (blockingIssues.length > 0) {
      baseReport.issues = baseReport.issues || [];
      baseReport.issues.push(...blockingIssues.map(i => `[BLOCKING] ${i.slice(0, 100)}`));
      baseReport.success = false;
    }

    baseReport.recommendations = [
      ...(performanceIssues.length > 0 ? ['Address performance issues before deployment'] : []),
      ...(qualityIssues.length > 0 ? ['Review code quality suggestions'] : [])
    ];

    return baseReport;
  }
}
