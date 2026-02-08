/**
 * RubixOrchestrator - The Head of Operations
 *
 * Coordinates the 5 Department Heads:
 * - RESEARCHER: Understanding the problem
 * - ARCHITECT: Designing the solution
 * - ENGINEER: Building the code
 * - VALIDATOR: Testing the code
 * - GUARDIAN: Ensuring quality
 *
 * Claude acts as the orchestrator, delegating to departments
 * and synthesizing their results.
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  DepartmentType,
  RubixTask,
  RubixPlan,
  RubixPhase,
  RubixResult,
  DepartmentReport,
  Artifact
} from './types.js';
import { DepartmentHead } from './DepartmentHead.js';
import { Researcher } from './departments/Researcher.js';
import { Architect } from './departments/Architect.js';
import { Engineer } from './departments/Engineer.js';
import { Validator } from './departments/Validator.js';
import { Guardian } from './departments/Guardian.js';
import { PLAN_EXEC } from '../prompts/templates.js';

export interface RubixConfig {
  apiKey: string;
  model?: string;
  maxSubAgentsPerDepartment?: number;
  codebaseRoot: string;
}

export class RubixOrchestrator {
  private client: Anthropic;
  private model: string;
  private departments: Map<DepartmentType, DepartmentHead>;
  private codebaseRoot: string;
  private currentTask: RubixTask | null = null;

  constructor(config: RubixConfig) {
    this.client = new Anthropic({ apiKey: config.apiKey });
    this.model = config.model || 'claude-sonnet-4-20250514';
    this.codebaseRoot = config.codebaseRoot;

    const maxSubAgents = config.maxSubAgentsPerDepartment || 5;
    const departmentConfig = {
      apiKey: config.apiKey,
      maxSubAgents,
      model: this.model
    };

    // Initialize all 5 department heads
    this.departments = new Map<DepartmentType, DepartmentHead>();
    this.departments.set('researcher', new Researcher(departmentConfig));
    this.departments.set('architect', new Architect(departmentConfig));
    this.departments.set('engineer', new Engineer(departmentConfig));
    this.departments.set('validator', new Validator(departmentConfig));
    this.departments.set('guardian', new Guardian(departmentConfig));

    console.log('[RubixOrchestrator] Initialized with 5 department heads');
  }

  /**
   * Execute a task through the department head system
   */
  async execute(task: RubixTask): Promise<RubixResult> {
    const startTime = Date.now();
    this.currentTask = task;

    console.log(`[RubixOrchestrator] Starting task: ${task.description}`);

    try {
      // Phase 1: Create execution plan
      const plan = await this.createPlan(task);
      console.log(`[RubixOrchestrator] Plan created with ${plan.phases.length} phases`);

      // Phase 2: Execute plan through departments
      const departmentReports: DepartmentReport[] = [];
      const allArtifacts: Artifact[] = [];

      for (const phase of plan.phases) {
        console.log(`[RubixOrchestrator] Executing phase ${phase.order}: ${phase.description}`);

        // Execute departments in this phase in parallel
        const phaseResults = await this.executePhase(phase, task, allArtifacts);
        departmentReports.push(...phaseResults);

        // Collect artifacts
        for (const report of phaseResults) {
          allArtifacts.push(...report.artifacts);
        }

        // Check for blocking failures
        const blockingFailure = phaseResults.find(r =>
          !r.success && r.issues?.some(i => i.includes('[BLOCKING]'))
        );

        if (blockingFailure) {
          console.log(`[RubixOrchestrator] Blocking failure in ${blockingFailure.department}`);
          return {
            taskId: task.id,
            success: false,
            summary: `Blocked by ${blockingFailure.department}: ${blockingFailure.issues?.[0]}`,
            departmentReports,
            artifacts: allArtifacts,
            totalDurationMs: Date.now() - startTime
          };
        }
      }

      // Phase 3: Synthesize final result
      const result = await this.synthesizeResult(task, departmentReports, allArtifacts);
      result.totalDurationMs = Date.now() - startTime;

      console.log(`[RubixOrchestrator] Task completed in ${result.totalDurationMs}ms`);
      return result;

    } catch (error) {
      console.error('[RubixOrchestrator] Error:', error);
      return {
        taskId: task.id,
        success: false,
        summary: `Orchestration failed: ${(error as Error).message}`,
        departmentReports: [],
        artifacts: [],
        totalDurationMs: Date.now() - startTime
      };
    } finally {
      this.currentTask = null;
    }
  }

  /**
   * Create an execution plan for the task
   */
  private async createPlan(task: RubixTask): Promise<RubixPlan> {
    // Compressed prompt - pure function, zero fluff
    const prompt = PLAN_EXEC(task.description, task.codebase || this.codebaseRoot);

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: prompt
      }]
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          taskId: task.id,
          phases: parsed.phases as RubixPhase[],
          estimatedComplexity: parsed.estimatedComplexity || 'medium'
        };
      } catch {
        // Fall through to default
      }
    }

    // Default plan
    return {
      taskId: task.id,
      phases: [
        { order: 1, departments: ['researcher'], description: 'Understand the codebase and requirements' },
        { order: 2, departments: ['architect'], description: 'Design the solution' },
        { order: 3, departments: ['engineer'], description: 'Implement the code' },
        { order: 4, departments: ['validator', 'guardian'], description: 'Verify and validate' }
      ],
      estimatedComplexity: 'medium'
    };
  }

  /**
   * Execute a phase (departments run in parallel)
   */
  private async executePhase(
    phase: RubixPhase,
    task: RubixTask,
    previousArtifacts: Artifact[]
  ): Promise<DepartmentReport[]> {
    // Build context from previous artifacts
    const context = this.buildContext(task, previousArtifacts);

    // Execute all departments in this phase in parallel
    const promises = phase.departments.map(deptType => {
      const department = this.departments.get(deptType);
      if (!department) {
        throw new Error(`Unknown department: ${deptType}`);
      }
      return department.execute(task.description, context);
    });

    return Promise.all(promises);
  }

  /**
   * Build context string from task and artifacts
   */
  private buildContext(task: RubixTask, artifacts: Artifact[]): string {
    const parts: string[] = [
      `## Task\n${task.description}`,
      `## Specification\n${task.specification || 'None'}`,
      `## Codebase Root\n${task.codebase || this.codebaseRoot}`
    ];

    // Add relevant artifacts as context
    const designs = artifacts.filter(a => a.type === 'design');
    if (designs.length > 0) {
      parts.push(`## Designs\n${designs.map(d => d.content).join('\n\n')}`);
    }

    const files = artifacts.filter(a => a.type === 'file');
    if (files.length > 0) {
      parts.push(`## Created Files\n${files.map(f => `- ${f.path}`).join('\n')}`);
    }

    return parts.join('\n\n');
  }

  /**
   * Synthesize final result from department reports
   */
  private async synthesizeResult(
    task: RubixTask,
    reports: DepartmentReport[],
    artifacts: Artifact[]
  ): Promise<RubixResult> {
    const allSuccess = reports.every(r => r.success);
    const allIssues = reports.flatMap(r => r.issues || []);

    // Count artifacts by type
    const fileCount = artifacts.filter(a => a.type === 'file').length;
    const testCount = artifacts.filter(a => a.type === 'test').length;
    const reviewCount = artifacts.filter(a => a.type === 'review').length;

    const summary = allSuccess
      ? `Task completed successfully. Created ${fileCount} files, ${testCount} tests. ${reviewCount} reviews passed.`
      : `Task completed with issues: ${allIssues.slice(0, 3).join('; ')}`;

    return {
      taskId: task.id,
      success: allSuccess,
      summary,
      departmentReports: reports,
      artifacts,
      totalDurationMs: 0 // Will be set by execute()
    };
  }

  /**
   * Get current task status
   */
  getStatus(): { active: boolean; taskId?: string; description?: string } {
    if (this.currentTask) {
      return {
        active: true,
        taskId: this.currentTask.id,
        description: this.currentTask.description
      };
    }
    return { active: false };
  }

  /**
   * Get a specific department head
   */
  getDepartment(type: DepartmentType): DepartmentHead | undefined {
    return this.departments.get(type);
  }
}
