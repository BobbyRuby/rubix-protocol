/**
 * PhasedExecutor - Orchestrates the 6-phase tokenized execution.
 *
 * COST-BASED MODEL ROUTING:
 *
 * Phase 1: CONTEXT SCOUT - Gather context → CTX tokens
 *          Model: Based on complexity (Haiku/Sonnet/Opus)
 *
 * Phase 2: ARCHITECT (API Opus) - Design solution + classify complexity → DES tokens
 *          Model: Always Opus (determines complexity for routing)
 *
 * Phase 3: ENGINEER - Plan implementation → PLAN tokens + files
 *          - Low complexity: Single Haiku engineer
 *          - Medium complexity: Single Sonnet engineer
 *          - High complexity: Parallel Opus engineers (based on dependency graph)
 *
 * Phase 4: VALIDATOR - Review plan → VAL tokens
 *          Model: Based on complexity (Haiku/Sonnet/Opus)
 *
 * Phase 5: EXECUTOR (Local) - Write files, run commands → EXEC tokens
 * Phase 6: FIX LOOP (API) - Fix errors, escalating model strategy
 *
 * Key Design:
 * - All Claude calls use Anthropic API directly - no CLI spawning
 * - ARCHITECT (Opus) classifies complexity and outputs dependency graph
 * - ModelSelector routes to appropriate model based on complexity
 * - ParallelEngineer handles high-complexity tasks with dependency-ordered execution
 * - Fix loop escalates: Sonnet (fast) → Sonnet+think → Opus (fresh eyes) → Opus+think
 */

import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'crypto';
import { createContextScout, ContextBundle } from './ContextScout.js';
import { createClaudeReasoner, DesignOutput, PlanOutput } from './ClaudeReasoner.js';
import { detectSkills, loadPolyglotContext } from './SkillDetector.js';
import { createPlanValidator, ValidationResult } from './PlanValidator.js';
import { createPlanExecutor, ExecutionResult } from './PlanExecutor.js';
import { getCodexLogger, resetCodexLogger } from './Logger.js';
import { getModelSelector, type TaskComplexity } from './ModelSelector.js';
import { ParallelEngineer } from './ParallelEngineer.js';
import type { CodexTask, Subtask } from './types.js';
import type { MemoryEngine } from '../core/MemoryEngine.js';
import { MemorySource, CausalRelationType } from '../core/types.js';
import type { CommunicationManager } from '../communication/CommunicationManager.js';

/**
 * Fix loop escalation tiers - All use API.
 *
 * Strategy:
 * 1-2: API Sonnet (fast, cheap)
 * 3: API Sonnet + extended thinking
 * 4: API Opus (fresh perspective)
 * 5: API Opus + extended thinking
 */
const FIX_ESCALATION_TIERS = [
  { attempt: 1, model: 'sonnet', ultrathink: false, budgetTokens: 0, description: 'API Sonnet - standard fix' },
  { attempt: 2, model: 'sonnet', ultrathink: false, budgetTokens: 0, description: 'API Sonnet - alternative approach' },
  { attempt: 3, model: 'sonnet', ultrathink: true, budgetTokens: 8000, description: 'API Sonnet + extended thinking' },
  { attempt: 4, model: 'opus', ultrathink: false, budgetTokens: 0, description: 'API Opus - fresh eyes' },
  { attempt: 5, model: 'opus', ultrathink: true, budgetTokens: 16000, description: 'API Opus + extended thinking' },
] as const;

/**
 * Full execution result from all phases.
 */
export interface PhasedExecutionResult {
  taskId: string;
  success: boolean;
  phases: {
    context?: ContextBundle;
    design?: DesignOutput;
    plan?: PlanOutput;
    validation?: ValidationResult;
    execution?: ExecutionResult;
  };
  /** Claude API calls total */
  apiCalls: number;
  fixAttempts: number;
  escalatedToHuman: boolean;
  error?: string;
  duration: number;
  /** Validation issues that couldn't be fixed (non-blocking report) */
  validationReport?: {
    issues: string[];
    unfixedBlockers: string[];
    requiredMods: Array<{ path: string; change: string }>;
  };
}

/**
 * Escalation callback for human intervention.
 */
export type HumanEscalationCallback = (
  taskId: string,
  message: string,
  tokenChain: string
) => Promise<{ answer: string }>;

/**
 * PhasedExecutor orchestrates the 6-phase execution.
 */
export class PhasedExecutor {
  private codebasePath: string;
  private escalationCallback?: HumanEscalationCallback;
  private dryRun: boolean;
  private engine?: MemoryEngine;
  private apiClient: Anthropic | null = null;
  private sonnetModel = 'claude-sonnet-4-20250514';
  private opusModel = 'claude-opus-4-20250514';
  private comms?: CommunicationManager;
  private abortController: AbortController | null = null;

  constructor(codebasePath: string, dryRun = false, engine?: MemoryEngine, comms?: CommunicationManager) {
    this.codebasePath = codebasePath;
    this.dryRun = dryRun;
    this.engine = engine;
    this.comms = comms;

    // Initialize API client for all Claude calls
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      this.apiClient = new Anthropic({ apiKey });
      console.log('[PhasedExecutor] API client initialized');
      console.log(`[PhasedExecutor] Sonnet model: ${this.sonnetModel}`);
      console.log(`[PhasedExecutor] Opus model: ${this.opusModel}`);
    } else {
      console.warn('[PhasedExecutor] No ANTHROPIC_API_KEY - phases will fail');
    }
  }

  /**
   * Set memory engine for learning integration.
   */
  setMemoryEngine(engine: MemoryEngine): void {
    this.engine = engine;
  }

  /**
   * Set communication manager for mid-execution escalation.
   */
  setCommunicationManager(comms: CommunicationManager): void {
    this.comms = comms;
  }

  /**
   * Abort the current execution gracefully.
   */
  abort(): void {
    if (this.abortController) {
      console.log('[PhasedExecutor] Abort requested');
      this.abortController.abort();
    }
  }

  /**
   * Check if currently executing.
   */
  isExecuting(): boolean {
    return this.abortController !== null;
  }

  /**
   * Check if aborted and throw if so.
   */
  private checkAborted(): void {
    if (this.abortController?.signal.aborted) {
      throw new Error('Execution aborted by user');
    }
  }

  /**
   * Escalate to user via CommunicationManager or callback.
   */
  private async escalateToUser(
    taskId: string,
    title: string,
    context: string,
    type: 'clarification' | 'decision' | 'blocked' | 'approval' = 'blocked'
  ): Promise<string | null> {
    // Try CommunicationManager first (Telegram etc.)
    if (this.comms) {
      const options = [
        { label: 'Continue', description: 'Keep trying' },
        { label: 'Abort', description: 'Stop execution' },
        { label: 'Guide', description: 'Provide guidance' }
      ];

      const escalation = {
        id: randomUUID(),
        taskId,
        type,
        title,
        context,
        options,
        blocking: true,
        createdAt: new Date()
      };

      const response = await this.comms.escalate(escalation);
      return response?.response || response?.selectedOption || null;
    }

    // Fall back to callback if no comms
    if (this.escalationCallback) {
      const result = await this.escalationCallback(taskId, context, '');
      return result.answer;
    }

    return null;
  }

  /**
   * Record execution for learning (Sona trajectories + causal relations).
   */
  private async recordLearning(
    task: CodexTask | Subtask,
    result: PhasedExecutionResult
  ): Promise<void> {
    if (!this.engine) {
      console.log('[PhasedExecutor] No memory engine - skipping learning integration');
      return;
    }

    try {
      // Get description from task (CodexTask has description, Subtask has type)
      const description = 'description' in task
        ? task.description
        : (task as Subtask).type;

      // Store execution summary in memory
      const executionSummary = [
        `PHASED_EXECUTION: ${result.success ? 'SUCCESS' : 'FAILURE'}`,
        `task: ${description}`,
        `duration: ${result.duration}ms`,
        `api_calls: ${result.apiCalls}`,
        `fix_attempts: ${result.fixAttempts}`,
        result.error ? `error: ${result.error}` : null,
        result.phases.context ? `ctx: ${result.phases.context.compressedToken.substring(0, 100)}` : null,
        result.phases.plan ? `plan_files: ${result.phases.plan.files.length}` : null
      ].filter(Boolean).join('\n');

      // Store in memory for future reference
      const entry = await this.engine.store(executionSummary, {
        source: MemorySource.AGENT_INFERENCE,
        tags: [
          'phased_execution',
          result.success ? 'success' : 'failure',
          'codex'
        ],
        importance: result.success ? 0.6 : 0.8 // Failures are more important to remember
      });

      console.log(`[PhasedExecutor] Stored execution in memory: ${entry.id}`);

      // Provide learning feedback via trajectory
      const quality = result.success
        ? 1.0
        : result.fixAttempts > 0
          ? 0.1 + (0.2 * (5 - result.fixAttempts) / 5)
          : 0.2;

      await this.engine.provideFeedback(
        entry.id,
        quality,
        'phased_execution'
      );

      console.log(`[PhasedExecutor] Recorded learning feedback: quality=${quality.toFixed(2)}`);

      // For failures, record causal relation (failure → error)
      if (!result.success && result.error) {
        const errorEntry = await this.engine.store(
          `ERROR: ${result.error}\nTASK: ${description}\nPHASE: ${this.determineFailurePhase(result)}`,
          {
            source: MemorySource.TOOL_OUTPUT,
            tags: ['error', 'phased_execution', 'failure_cause'],
            importance: 0.9
          }
        );

        await this.engine.addCausalRelation(
          [entry.id],
          [errorEntry.id],
          CausalRelationType.CAUSES,
          0.8
        );

        console.log(`[PhasedExecutor] Recorded causal relation: execution → error`);
      }
    } catch (error) {
      console.error('[PhasedExecutor] Learning integration error:', error);
    }
  }

  /**
   * Determine which phase failed.
   */
  private determineFailurePhase(result: PhasedExecutionResult): string {
    if (!result.phases.context) return 'context_scout';
    if (!result.phases.design) return 'architect';
    if (!result.phases.plan) return 'engineer';
    if (!result.phases.validation) return 'validator';
    if (!result.phases.execution) return 'executor';
    if (result.fixAttempts > 0) return 'fix_loop';
    return 'unknown';
  }

  /**
   * Set callback for human escalation (after 5 fix attempts).
   */
  setEscalationCallback(callback: HumanEscalationCallback): void {
    this.escalationCallback = callback;
  }

  /**
   * Execute a task through all 6 phases.
   */
  async execute(task: CodexTask | Subtask): Promise<PhasedExecutionResult> {
    // Create abort controller for this execution
    this.abortController = new AbortController();

    const startTime = Date.now();
    const taskId = 'id' in task ? task.id : `subtask_${Date.now()}`;
    const logger = getCodexLogger();

    // Get task description for logging
    const taskDesc = 'description' in task ? task.description : (task as Subtask).type;

    console.log(`[PhasedExecutor] Starting 6-phase execution for task ${taskId}`);
    console.log(`[PhasedExecutor] Using full API approach: Opus (thinking) + Sonnet (doing)`);

    // Log execution start
    logger.logResponse(
      'PHASED_START',
      `Task: ${taskDesc}\nCodebase: ${this.codebasePath}\nDryRun: ${this.dryRun}`,
      JSON.stringify({
        taskId,
        taskDescription: taskDesc,
        codebasePath: this.codebasePath,
        dryRun: this.dryRun,
        startTime: new Date().toISOString()
      }, null, 2),
      0
    );

    const result: PhasedExecutionResult = {
      taskId,
      success: false,
      phases: {},
      apiCalls: 0,
      fixAttempts: 0,
      escalatedToHuman: false,
      duration: 0
    };

    try {
      // === SKILL DETECTION & POLYGLOT LOADING ===
      let polyglotContext = '';
      const taskDesc = 'description' in task ? task.description : '';
      const taskSpec = 'specification' in task ? (task as CodexTask).specification || '' : '';
      const combinedText = `${taskDesc} ${taskSpec}`;

      if (this.engine && combinedText.trim()) {
        const skills = detectSkills(combinedText);
        if (skills.length > 0) {
          console.log(`[PhasedExecutor] Detected skills: ${skills.join(', ')}`);
          const polyglotResult = await loadPolyglotContext(this.engine, skills);
          polyglotContext = polyglotResult.context;
          if (polyglotContext) {
            console.log(`[PhasedExecutor] Loaded ${polyglotResult.entriesFound} polyglot entries (${polyglotContext.length} chars)`);
          }
        } else {
          console.log('[PhasedExecutor] No skills detected in task description');
        }
      }

      // Phase 1: CONTEXT SCOUT (API Sonnet)
      console.log('[PhasedExecutor] === Phase 1: CONTEXT SCOUT (API Sonnet) ===');
      const scout = createContextScout(
        this.codebasePath,
        polyglotContext,
        process.env.ANTHROPIC_API_KEY,
        this.engine
      );
      const context = await scout.scout(task as CodexTask);
      result.phases.context = context;
      result.apiCalls++;
      console.log(`[PhasedExecutor] CTX: ${context.compressedToken.substring(0, 60)}...`);

      // Log Phase 1 completion
      logger.logResponse(
        'PHASE_1_COMPLETE',
        `Task: ${taskDesc}`,
        JSON.stringify({
          phase: 'CONTEXT_SCOUT',
          compressedToken: context.compressedToken,
          relevantFiles: context.research.relevantFiles.length,
          memoryResults: context.research.memoryResults.length,
          dependencies: Object.keys(context.research.dependencies).length,
          patterns: context.research.patterns.existingPatterns
        }, null, 2),
        context.research.relevantFiles.length,
        context.research.relevantFiles.map(f => ({ path: f.path, action: 'analyzed' })),
        'context_scout'
      );

      // Check for abort after Phase 1
      this.checkAborted();

      // Phase 2: ARCHITECT (API Opus)
      console.log('[PhasedExecutor] === Phase 2: ARCHITECT (API Opus) ===');
      const reasoner = createClaudeReasoner({
        codebasePath: this.codebasePath,
        apiKey: process.env.ANTHROPIC_API_KEY
      });
      const design = await reasoner.architect(context);
      result.phases.design = design;
      result.apiCalls++;
      console.log(`[PhasedExecutor] DES: ${design.compressedToken.substring(0, 60)}...`);

      // Log Phase 2 completion
      logger.logResponse(
        'PHASE_2_COMPLETE',
        `Context: ${context.compressedToken.substring(0, 200)}`,
        JSON.stringify({
          phase: 'ARCHITECT',
          compressedToken: design.compressedToken,
          componentsCount: design.components.length,
          components: design.components,
          modelsCount: design.models.length,
          models: design.models,
          directoriesCount: design.directories.length,
          directories: design.directories,
          apisCount: design.apis.length,
          apis: design.apis,
          notes: design.notes
        }, null, 2),
        design.components.length,
        design.components.map(c => ({ path: c, action: 'designed' })),
        'architect'
      );

      // Check for abort after Phase 2
      this.checkAborted();

      // Phase 3: ENGINEER (complexity-based model selection)
      console.log('[PhasedExecutor] === Phase 3: ENGINEER ===');

      const modelSelector = getModelSelector();
      const complexity: TaskComplexity = design.complexity || 'medium';
      let plan: PlanOutput;

      // High complexity with multiple components → parallel Opus engineers
      if (complexity === 'high' && design.componentDependencies && design.componentDependencies.length > 1) {
        console.log(`[PhasedExecutor] High complexity (${design.componentDependencies.length} components) → Parallel Opus engineers`);
        const engineerModel = modelSelector.selectForPhase('engineer', 'high');

        const parallelEngineer = new ParallelEngineer(
          process.env.ANTHROPIC_API_KEY!,
          engineerModel
        );

        plan = await parallelEngineer.executeInOrder(context, design);

        // If parallel returned no files (fallback case), use single engineer
        if (plan.files.length === 0) {
          console.log('[PhasedExecutor] Parallel engineer returned no files, falling back to single engineer');
          plan = await reasoner.engineer(context, design);
        }
      } else {
        // Low/medium complexity → single engineer with appropriate model
        const engineerModel = modelSelector.selectForPhase('engineer', complexity);
        const modelName = modelSelector.getModelName(engineerModel);
        console.log(`[PhasedExecutor] ${complexity} complexity → Single ${modelName} engineer`);

        // Create reasoner with selected model
        const complexityReasoner = createClaudeReasoner({
          codebasePath: this.codebasePath,
          apiKey: process.env.ANTHROPIC_API_KEY,
          apiModel: engineerModel,
          architectModel: modelSelector.selectForPhase('architect', complexity)
        });

        plan = await complexityReasoner.engineer(context, design);
      }

      result.phases.plan = plan;
      result.apiCalls++;
      console.log(`[PhasedExecutor] PLAN: ${plan.compressedToken.substring(0, 60)}...`);
      console.log(`[PhasedExecutor] Files: ${plan.files.length}, Commands: ${plan.commands.length}`);

      // Log Phase 3 completion
      logger.logResponse(
        'PHASE_3_COMPLETE',
        `Design: ${design.compressedToken.substring(0, 200)}`,
        JSON.stringify({
          phase: 'ENGINEER',
          compressedToken: plan.compressedToken,
          filesCount: plan.files.length,
          commandsCount: plan.commands.length,
          operationsCount: plan.operations.length,
          files: plan.files.map(f => ({ path: f.path, action: f.action, contentLength: f.content.length })),
          commands: plan.commands
        }, null, 2),
        plan.files.length,
        plan.files.map(f => ({ path: f.path, action: f.action })),
        'engineer'
      );

      // Check for abort after Phase 3
      this.checkAborted();

      // Phase 4: VALIDATOR (complexity-based model)
      const validatorModel = modelSelector.selectForPhase('validator', complexity);
      const validatorModelName = modelSelector.getModelName(validatorModel);
      console.log(`[PhasedExecutor] === Phase 4: VALIDATOR (${validatorModelName}) ===`);
      const validator = createPlanValidator(
        this.codebasePath,
        process.env.ANTHROPIC_API_KEY,
        this.engine,
        validatorModel
      );
      const validation = await validator.validate(context, design, plan);
      result.phases.validation = validation;
      result.apiCalls++;
      console.log(`[PhasedExecutor] VAL: ${validation.compressedToken.substring(0, 60)}...`);

      // Log Phase 4 completion
      logger.logResponse(
        'PHASE_4_COMPLETE',
        `Plan: ${plan.compressedToken.substring(0, 200)}`,
        JSON.stringify({
          phase: 'VALIDATOR',
          compressedToken: validation.compressedToken,
          approved: validation.approved,
          testsRequired: validation.tests,
          securityIssues: validation.securityIssues,
          performanceIssues: validation.performanceIssues,
          requiredModifications: validation.requiredMods,
          blockers: validation.blockers
        }, null, 2),
        0,
        validation.requiredMods.map(m => ({ path: m.path, action: 'requires_modification' })),
        'validator'
      );

      if (!validation.approved) {
        console.warn('[PhasedExecutor] Validation rejected plan');

        // If blockers or required modifications exist, try to fix them via the fix loop
        if (validation.blockers.length > 0 || validation.requiredMods.length > 0) {
          console.log(`[PhasedExecutor] Validation issues: ${validation.blockers.join(', ')}`);
          console.log(`[PhasedExecutor] Required mods: ${validation.requiredMods.length}`);

          // Create a synthetic "failed execution" to trigger fix loop
          const syntheticExecution: ExecutionResult = {
            success: false,
            filesWritten: 0,
            filesModified: 0,
            filesDeleted: 0,
            commandsRun: 0,
            errors: [
              ...validation.blockers.map(b => ({
                type: 'file' as const,
                operation: 'validation',
                path: 'plan',
                message: `Validation blocker: ${b}`
              })),
              ...validation.requiredMods.map(m => ({
                type: 'file' as const,
                operation: 'validation',
                path: m.path,
                message: `Required modification: ${m.change}`
              }))
            ],
            compressedToken: `EXEC|ok:0|val_blockers:${validation.blockers.length}|req_mods:${validation.requiredMods.length}`
          };

          // Run fix loop to address validation issues
          console.log('[PhasedExecutor] === Phase 6: FIX LOOP (validation issues) ===');
          const fixResult = await this.runFixLoop(
            task,
            context,
            design,
            plan,
            syntheticExecution,
            result,
            validation.blockers  // Pass blockers to fix loop
          );

          if (fixResult && fixResult.success) {
            result.phases.execution = fixResult;
            result.success = true;
            result.duration = Date.now() - startTime;
            await this.recordLearning(task, result);
            return result;
          }

          // Fix loop failed - capture issues in report but DO NOT block execution
          result.validationReport = {
            issues: [...validation.securityIssues, ...validation.performanceIssues],
            unfixedBlockers: validation.blockers,
            requiredMods: validation.requiredMods
          };
          console.warn('[PhasedExecutor] Validation issues could not be fixed - continuing with execution');
          console.warn(`[PhasedExecutor] Review required: ${validation.blockers.join(', ')}`);
          // DO NOT return - fall through to Phase 5
        }
      }

      // Check for abort after Phase 4
      this.checkAborted();

      // Phase 5: EXECUTOR (Local)
      console.log('[PhasedExecutor] === Phase 5: EXECUTOR (Local) ===');
      const executor = createPlanExecutor(this.codebasePath, this.dryRun);
      let execution = await executor.execute(plan, validation);
      result.phases.execution = execution;
      console.log(`[PhasedExecutor] EXEC: ${execution.compressedToken}`);

      // Log Phase 5 completion
      logger.logResponse(
        'PHASE_5_COMPLETE',
        `Files: ${plan.files.map(f => f.path).join(', ')}`,
        JSON.stringify({
          phase: 'EXECUTOR',
          compressedToken: execution.compressedToken,
          success: execution.success,
          filesWritten: execution.filesWritten,
          filesModified: execution.filesModified,
          filesDeleted: execution.filesDeleted,
          commandsRun: execution.commandsRun,
          errors: execution.errors
        }, null, 2),
        execution.filesWritten + execution.filesModified,
        plan.files.map(f => ({ path: f.path, action: f.action })),
        'executor'
      );

      // Check for abort after Phase 5
      this.checkAborted();

      // Phase 6: FIX LOOP (if needed)
      if (!execution.success) {
        console.log('[PhasedExecutor] === Phase 6: FIX LOOP ===');
        const fixResult = await this.runFixLoop(task, context, design, plan, execution, result);
        if (fixResult) {
          result.phases.execution = fixResult;
          execution = fixResult;
        }
      }

      result.success = execution.success;
      result.duration = Date.now() - startTime;

      console.log(`[PhasedExecutor] Completed in ${result.duration}ms`);
      console.log(`[PhasedExecutor] API calls: ${result.apiCalls}, Fixes: ${result.fixAttempts}`);

      // Log execution completion
      logger.logResponse(
        'PHASED_COMPLETE',
        `Task: ${taskDesc}`,
        JSON.stringify({
          taskId,
          success: result.success,
          duration: result.duration,
          apiCalls: result.apiCalls,
          fixAttempts: result.fixAttempts,
          escalatedToHuman: result.escalatedToHuman,
          phases: {
            context: !!result.phases.context,
            design: !!result.phases.design,
            plan: !!result.phases.plan,
            validation: !!result.phases.validation,
            execution: !!result.phases.execution
          },
          filesCreated: result.phases.execution?.filesWritten || 0,
          filesModified: result.phases.execution?.filesModified || 0,
          errors: result.phases.execution?.errors || []
        }, null, 2),
        (result.phases.execution?.filesWritten || 0) + (result.phases.execution?.filesModified || 0)
      );

      // Write session summary
      resetCodexLogger();

      // === LEARNING INTEGRATION ===
      await this.recordLearning(task, result);

      return result;

    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      result.duration = Date.now() - startTime;
      console.error('[PhasedExecutor] Execution failed:', result.error);

      await this.recordLearning(task, result);

      return result;
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Run the fix loop with escalating model strategy.
   *
   * Tiers (all API):
   * 1-2: API Sonnet (fast, cheap)
   * 3: API Sonnet + extended thinking
   * 4: API Opus (fresh perspective)
   * 5: API Opus + extended thinking
   */
  private async runFixLoop(
    _task: CodexTask | Subtask,
    context: ContextBundle,
    design: DesignOutput,
    plan: PlanOutput,
    execution: ExecutionResult,
    result: PhasedExecutionResult,
    validationBlockers?: string[]  // Optional validation blockers for fix context
  ): Promise<ExecutionResult | null> {
    const tokenChain = [
      context.compressedToken,
      design.compressedToken,
      plan.compressedToken,
      execution.compressedToken
    ].join('\n');

    const errorSummary = execution.errors.map(e => `${e.type}: ${e.message}`).join('\n');

    // Track files that have been successfully written (for partial success handling)
    const successfulFiles = new Set<string>();
    const failedFiles = new Set<string>();

    // Categorize initial state from execution errors
    for (const file of plan.files) {
      const hasError = execution.errors.some(e => e.type === 'file' && e.path === file.path);
      if (hasError) {
        failedFiles.add(file.path);
      } else if (execution.filesWritten > 0 || execution.filesModified > 0) {
        // File was likely written successfully
        successfulFiles.add(file.path);
      }
    }

    console.log(`[PhasedExecutor] Partial success: ${successfulFiles.size} succeeded, ${failedFiles.size} failed`);

    const logger = getCodexLogger();

    for (const tier of FIX_ESCALATION_TIERS) {
      result.fixAttempts++;
      console.log(`[PhasedExecutor] Fix attempt ${tier.attempt}/5: ${tier.description}`);

      // Log fix loop iteration start
      logger.logResponse(
        `FIX_LOOP_ATTEMPT_${tier.attempt}`,
        `Errors: ${errorSummary}\nBlockers: ${validationBlockers?.join(', ') || 'none'}`,
        JSON.stringify({
          attempt: tier.attempt,
          model: tier.model,
          ultrathink: tier.ultrathink,
          budgetTokens: tier.budgetTokens,
          description: tier.description,
          successfulFiles: Array.from(successfulFiles),
          failedFiles: Array.from(failedFiles),
          errors: errorSummary
        }, null, 2),
        failedFiles.size,
        undefined,
        'fix_loop'
      );

      try {
        const fixResponse = await this.executeApiFix(
          tokenChain,
          errorSummary,
          tier.model as 'sonnet' | 'opus',
          tier.ultrathink,
          tier.budgetTokens,
          validationBlockers,
          Array.from(successfulFiles),  // Pass successful files to prompt
          Array.from(failedFiles)        // Pass failed files to prompt
        );
        result.apiCalls++;

        // Parse the fix response for new file operations
        const fixedPlan = this.parseFixResponse(fixResponse, plan);

        // Log fix response received
        logger.logResponse(
          `FIX_LOOP_RESPONSE_${tier.attempt}`,
          `Model: ${tier.model}`,
          JSON.stringify({
            attempt: tier.attempt,
            responseLength: fixResponse.length,
            filesParsed: fixedPlan.files.length,
            parsedFiles: fixedPlan.files.map(f => ({ path: f.path, action: f.action }))
          }, null, 2) + '\n\n=== RAW FIX RESPONSE ===\n' + fixResponse,
          fixedPlan.files.length,
          fixedPlan.files.map(f => ({ path: f.path, action: f.action })),
          'fix_loop'
        );

        // Filter to only include files that actually failed or are new fixes
        // Don't regenerate already successful files unless Claude specifically provides a fix
        const filteredFiles = fixedPlan.files.filter(f =>
          failedFiles.has(f.path) || !successfulFiles.has(f.path)
        );

        if (filteredFiles.length > 0) {
          const filteredPlan: PlanOutput = {
            ...fixedPlan,
            files: filteredFiles
          };

          console.log(`[PhasedExecutor] Executing ${filteredFiles.length} file fixes (skipping ${fixedPlan.files.length - filteredFiles.length} already successful)`);

          // Re-execute with the filtered plan
          const executor = createPlanExecutor(this.codebasePath, this.dryRun);
          const newExecution = await executor.execute(filteredPlan, result.phases.validation!);

          if (newExecution.success) {
            console.log(`[PhasedExecutor] Fix successful at tier ${tier.attempt}!`);

            // Log successful fix
            logger.logResponse(
              `FIX_LOOP_SUCCESS_${tier.attempt}`,
              `Tier ${tier.attempt} succeeded`,
              JSON.stringify({
                attempt: tier.attempt,
                model: tier.model,
                filesFixed: filteredFiles.length,
                files: filteredFiles.map(f => f.path)
              }, null, 2),
              filteredFiles.length,
              filteredFiles.map(f => ({ path: f.path, action: 'fixed' })),
              'fix_loop'
            );

            // Store successful fix in memory for learning
            if (this.engine) {
              await this.engine.store(
                `FIX_SUCCESS tier:${tier.attempt} model:${tier.model} task:${context.description.substring(0, 100)} error:${errorSummary.substring(0, 100)}`,
                {
                  source: MemorySource.AGENT_INFERENCE,
                  tags: ['fix_success', `tier_${tier.attempt}`, tier.model],
                  importance: 0.8
                }
              );
            }

            return newExecution;
          }

          // Log failed fix attempt
          logger.logResponse(
            `FIX_LOOP_FAILED_${tier.attempt}`,
            `Tier ${tier.attempt} failed`,
            JSON.stringify({
              attempt: tier.attempt,
              model: tier.model,
              errors: newExecution.errors
            }, null, 2),
            0,
            undefined,
            'fix_loop',
            newExecution.errors.map(e => e.message).join('; ')
          );

          // Update tracking for next iteration
          for (const file of filteredFiles) {
            const fileHasError = newExecution.errors.some(e => e.type === 'file' && e.path === file.path);
            if (!fileHasError) {
              successfulFiles.add(file.path);
              failedFiles.delete(file.path);
            }
          }

          // Update error for next iteration
          execution = newExecution;
        }

      } catch (error) {
        console.error(`[PhasedExecutor] Fix attempt ${tier.attempt} failed:`, error);

        // Log error
        logger.logResponse(
          `FIX_LOOP_ERROR_${tier.attempt}`,
          `Tier ${tier.attempt} threw exception`,
          JSON.stringify({
            attempt: tier.attempt,
            model: tier.model,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2),
          0,
          undefined,
          'fix_loop',
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    // All 5 attempts failed - escalate to human
    console.warn('[PhasedExecutor] All 5 fix attempts failed. Escalating to human.');
    result.escalatedToHuman = true;

    const escalationContext = `All 5 automated fix attempts have failed.

### Errors
${errorSummary}

### Attempts Made
${FIX_ESCALATION_TIERS.map(t => `${t.attempt}. ${t.description}`).join('\n')}`;

    const response = await this.escalateToUser(
      result.taskId,
      '## Fix Loop Exhausted',
      escalationContext,
      'blocked'
    );

    if (response?.toLowerCase().includes('abort')) {
      console.log('[PhasedExecutor] User requested abort');
      return null;
    }

    return null;
  }

  /**
   * Execute fix via API (Sonnet or Opus).
   */
  private async executeApiFix(
    tokenChain: string,
    errors: string,
    model: 'sonnet' | 'opus',
    ultrathink: boolean,
    budgetTokens: number,
    validationBlockers?: string[],
    successfulFiles?: string[],
    failedFiles?: string[]
  ): Promise<string> {
    if (!this.apiClient) {
      throw new Error('API client not initialized - missing ANTHROPIC_API_KEY');
    }

    const modelId = model === 'opus' ? this.opusModel : this.sonnetModel;
    const prompt = this.buildFixPrompt(tokenChain, errors, ultrathink, validationBlockers, successfulFiles, failedFiles);

    console.log(`[PhasedExecutor] Executing API ${model} fix (${modelId})${ultrathink ? ' with extended thinking' : ''}...`);

    const baseParams = {
      model: modelId,
      max_tokens: 8192,
      messages: [
        { role: 'user' as const, content: prompt }
      ]
    };

    let response;
    if (ultrathink && budgetTokens >= 1024) {
      response = await this.apiClient.messages.create({
        ...baseParams,
        thinking: {
          type: 'enabled',
          budget_tokens: budgetTokens
        }
      }, {
        headers: {
          'anthropic-beta': 'interleaved-thinking-2025-05-14'
        }
      });
    } else {
      response = await this.apiClient.messages.create(baseParams);
    }

    const textBlock = response.content.find(block => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No text response from API');
    }

    console.log(`[PhasedExecutor] API ${model} fix completed: ${textBlock.text.length} chars`);
    console.log(`[PhasedExecutor] Usage: ${response.usage?.input_tokens || 0} in, ${response.usage?.output_tokens || 0} out`);

    return textBlock.text;
  }

  /**
   * Build fix prompt.
   */
  private buildFixPrompt(
    tokenChain: string,
    errors: string,
    ultrathink: boolean,
    validationBlockers?: string[],
    successfulFiles?: string[],
    failedFiles?: string[]
  ): string {
    // Include validation blockers section if present
    const blockersSection = validationBlockers?.length
      ? `
## VALIDATION BLOCKERS
The following issues were identified by the validator and MUST be addressed in your fix:
${validationBlockers.map(b => `- ${b}`).join('\n')}

These blockers typically require:
- Input validation and sanitization
- Error handling improvements
- Security hardening
- Type safety improvements
`
      : '';

    // Include partial success information if available
    const partialSuccessSection = (successfulFiles?.length || failedFiles?.length)
      ? `
## PARTIAL SUCCESS STATUS
${successfulFiles?.length ? `**Successfully written files (DO NOT regenerate):**\n${successfulFiles.map(f => `- ✓ ${f}`).join('\n')}` : ''}
${failedFiles?.length ? `\n**Failed files (MUST fix):**\n${failedFiles.map(f => `- ✗ ${f}`).join('\n')}` : ''}

IMPORTANT: Only provide fixes for files that FAILED. Do not regenerate files that were already written successfully.
`
      : '';

    return `# FIX - Error Recovery Phase

## Your Role
You are the FIXER. The execution failed and you need to fix the errors.
${ultrathink ? 'Take your time to think deeply about the root cause.' : ''}
${blockersSection}${partialSuccessSection}
## Token Chain (Context)
${tokenChain}

## Errors to Fix
${errors}

## Required Output

Analyze the errors and provide fixed file contents ONLY for files that failed:

<file path="path/to/file.ts" action="modify">
// Complete fixed code here
</file>

Provide COMPLETE file contents. No placeholders.`;
  }

  /**
   * Parse fix response for file operations.
   */
  private parseFixResponse(response: string, originalPlan: PlanOutput): PlanOutput {
    const fixedPlan: PlanOutput = {
      ...originalPlan,
      files: []
    };

    // Parse file blocks from response - flexible pattern that handles any attribute order
    const fileMatches = response.matchAll(/<file\s+([^>]+)>([\s\S]*?)<\/file>/g);
    for (const match of fileMatches) {
      const attrs = match[1];
      const pathMatch = attrs.match(/path="([^"]+)"/);
      const actionMatch = attrs.match(/action="([^"]+)"/);
      if (pathMatch) {
        fixedPlan.files.push({
          path: pathMatch[1],
          action: (actionMatch?.[1] || 'modify') as 'create' | 'modify' | 'delete',
          content: match[2].trim()
        });
      }
    }

    // Debug logging if no files were found but response contains file-like content
    if (fixedPlan.files.length === 0 && response.includes('<file')) {
      console.log(`[PhasedExecutor] WARNING: Response contains '<file' but no files parsed.`);
      console.log(`[PhasedExecutor] Raw file tags found: ${(response.match(/<file[^>]*>/g) || []).join(', ')}`);
    }

    return fixedPlan;
  }

  /**
   * Get execution statistics.
   */
  getStats(result: PhasedExecutionResult): {
    totalCalls: number;
    apiCalls: number;
    reduction: string;
  } {
    const oldApproach = 25; // 5 depts × 5 attempts
    const reduction = Math.round((1 - result.apiCalls / oldApproach) * 100);

    return {
      totalCalls: result.apiCalls,
      apiCalls: result.apiCalls,
      reduction: `${reduction}% fewer API calls`
    };
  }
}

// Singleton instance
let phasedExecutorInstance: PhasedExecutor | null = null;

export function getPhasedExecutor(
  codebasePath?: string,
  engine?: MemoryEngine,
  comms?: CommunicationManager
): PhasedExecutor {
  if (!phasedExecutorInstance && codebasePath) {
    phasedExecutorInstance = new PhasedExecutor(codebasePath, false, engine, comms);
  }
  if (!phasedExecutorInstance) {
    throw new Error('PhasedExecutor not initialized. Call with codebasePath first.');
  }
  // Ensure engine is always wired up if provided
  if (engine) {
    phasedExecutorInstance.setMemoryEngine(engine);
  }
  // Ensure comms is always wired up if provided
  if (comms) {
    phasedExecutorInstance.setCommunicationManager(comms);
  }
  return phasedExecutorInstance;
}

export function resetPhasedExecutor(): void {
  phasedExecutorInstance = null;
}
