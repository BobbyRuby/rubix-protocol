/**
 * PhasedExecutor - Orchestrates the 6-phase tokenized execution.
 *
 * CLAUDE HYBRID APPROACH (No Ollama):
 *
 * Phase 1: CONTEXT SCOUT (CLI Opus) - Gather context → CTX tokens
 * Phase 2: ARCHITECT (CLI Opus) - Design solution → DES tokens
 * Phase 3: ENGINEER (API Sonnet) - Plan implementation → PLAN tokens + files
 * Phase 4: VALIDATOR (API Sonnet) - Review plan → VAL tokens
 * Phase 5: EXECUTOR (Local) - Write files, run commands → EXEC tokens
 * Phase 6: FIX LOOP (API Sonnet → CLI Opus) - Fix errors, escalating model strategy
 *
 * Key Design:
 * - CLI Opus for thinking (phases 1-2): complex reasoning, MCP access, stores decisions
 * - API Sonnet for doing (phases 3-4): fast implementation, ephemeral
 * - Fix loop escalates: Sonnet (fast) → Sonnet+think → Opus (fresh eyes) → Opus+think
 */

import Anthropic from '@anthropic-ai/sdk';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { createContextScout, ContextBundle } from './ContextScout.js';
import { createDefaultClaudeReasoner, DesignOutput, PlanOutput } from './ClaudeReasoner.js';
import { detectSkills, loadPolyglotContext } from './SkillDetector.js';
import { createPlanValidator, ValidationResult } from './PlanValidator.js';
import { createPlanExecutor, ExecutionResult } from './PlanExecutor.js';
import type { CodexTask, Subtask } from './types.js';
import type { MemoryEngine } from '../core/MemoryEngine.js';
import { MemorySource, CausalRelationType } from '../core/types.js';
import type { CommunicationManager } from '../communication/CommunicationManager.js';

/**
 * Fix loop escalation tiers - Claude only, no Ollama.
 *
 * Strategy:
 * 1-2: API Sonnet (fast, cheap)
 * 3: API Sonnet + extended thinking
 * 4: CLI Opus (fresh perspective, MCP access)
 * 5: CLI Opus + ultrathink
 */
const FIX_ESCALATION_TIERS = [
  { attempt: 1, model: 'sonnet', useCli: false, ultrathink: false, budgetTokens: 0, description: 'API Sonnet - standard fix' },
  { attempt: 2, model: 'sonnet', useCli: false, ultrathink: false, budgetTokens: 0, description: 'API Sonnet - alternative approach' },
  { attempt: 3, model: 'sonnet', useCli: false, ultrathink: true, budgetTokens: 8000, description: 'API Sonnet + extended thinking' },
  { attempt: 4, model: 'opus', useCli: true, ultrathink: false, budgetTokens: 0, description: 'CLI Opus - fresh eyes' },
  { attempt: 5, model: 'opus', useCli: true, ultrathink: true, budgetTokens: 16000, description: 'CLI Opus + ultrathink' },
] as const;

/**
 * Turn limits by task complexity.
 *
 * - simple: Single file changes, typos, small fixes (3 turns)
 * - medium: Bug fixes, logic updates, function modifications (6 turns)
 * - complex: Refactoring, new features, multi-file, architecture (10 turns)
 */
const TURN_LIMITS = {
  simple: 3,
  medium: 6,
  complex: 10
} as const;

type TaskComplexity = keyof typeof TURN_LIMITS;

/**
 * Checkpoint state captured when turn limit is reached.
 * Used for continuation with context injection.
 */
interface ExecutionCheckpoint {
  taskId: string;
  turnsUsed: number;
  maxTurns: number;
  output: string;
  context: string;
  timestamp: Date;
  memoryEntryId?: string;  // ID in MemoryEngine for retrieval
}

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
  /** Claude CLI calls (Opus via Max subscription) */
  cliCalls: number;
  /** Claude API calls (Sonnet via direct API) */
  apiCalls: number;
  fixAttempts: number;
  escalatedToHuman: boolean;
  error?: string;
  duration: number;
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
  private apiModel = 'claude-sonnet-4-20250514';
  private cliTimeout = 0; // Disabled - run until completion (user can interrupt via AbortController)
  private comms?: CommunicationManager;
  private abortController: AbortController | null = null;
  private lastCheckpoint: ExecutionCheckpoint | null = null;

  constructor(codebasePath: string, dryRun = false, engine?: MemoryEngine, comms?: CommunicationManager) {
    this.codebasePath = codebasePath;
    this.dryRun = dryRun;
    this.engine = engine;
    this.comms = comms;

    // Initialize API client for Sonnet calls
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      this.apiClient = new Anthropic({ apiKey });
      console.log('[PhasedExecutor] API client initialized for Sonnet calls');
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
   * Assess task complexity to determine appropriate turn limit.
   *
   * Heuristics:
   * - simple: typo fix, rename, add comment, single file
   * - medium: bug fix, update logic, modify function (default)
   * - complex: refactor, new feature, multi-file, architecture
   */
  private assessComplexity(task: CodexTask | Subtask): TaskComplexity {
    const description = 'description' in task ? task.description : (task as Subtask).type;
    const desc = description.toLowerCase();

    // Simple: single file changes, typos, small fixes
    const simplePatterns = [
      /fix typo/i, /rename/i, /add comment/i, /update version/i,
      /simple/i, /quick/i, /one file/i, /single/i
    ];
    if (simplePatterns.some(p => p.test(desc))) return 'simple';

    // Complex: multi-file, refactoring, new features, architecture
    const complexPatterns = [
      /refactor/i, /new feature/i, /implement/i, /architect/i,
      /multiple files/i, /system/i, /integration/i, /complex/i
    ];
    if (complexPatterns.some(p => p.test(desc))) return 'complex';

    // Default to medium
    return 'medium';
  }

  /**
   * Save checkpoint to memory for persistence and learning.
   */
  private async saveCheckpointToMemory(checkpoint: ExecutionCheckpoint): Promise<string | undefined> {
    if (!this.engine) return undefined;

    try {
      const content = [
        `CHECKPOINT: Turn limit reached`,
        `task_id: ${checkpoint.taskId}`,
        `turns: ${checkpoint.turnsUsed}/${checkpoint.maxTurns}`,
        `timestamp: ${checkpoint.timestamp.toISOString()}`,
        `---`,
        `CONTEXT:`,
        checkpoint.context,
        `---`,
        `FULL_OUTPUT:`,
        checkpoint.output.substring(0, 2000) // Truncate for memory (full in notification)
      ].join('\n');

      const entry = await this.engine.store(content, {
        source: MemorySource.AGENT_INFERENCE,
        tags: ['checkpoint', 'turn_limit', 'phased_execution', checkpoint.taskId],
        importance: 0.7
      });

      console.log(`[PhasedExecutor] Checkpoint saved to memory: ${entry.id}`);
      return entry.id;
    } catch (error) {
      console.error('[PhasedExecutor] Failed to save checkpoint to memory:', error);
      return undefined;
    }
  }

  /**
   * Record iteration/continuation in memory for learning.
   */
  private async recordIterationToMemory(
    taskId: string,
    iterationNumber: number,
    decision: 'accept' | 'continue',
    checkpointId?: string
  ): Promise<void> {
    if (!this.engine) return;

    try {
      const content = [
        `ITERATION: ${iterationNumber}`,
        `task_id: ${taskId}`,
        `decision: ${decision}`,
        `checkpoint_id: ${checkpointId || 'none'}`,
        `timestamp: ${new Date().toISOString()}`
      ].join('\n');

      const entry = await this.engine.store(content, {
        source: MemorySource.AGENT_INFERENCE,
        tags: ['iteration', 'user_decision', 'phased_execution', taskId],
        importance: 0.6,
        parentIds: checkpointId ? [checkpointId] : undefined
      });

      // Create causal relation: checkpoint → decision
      if (checkpointId) {
        this.engine.addCausalRelation(
          [checkpointId],
          [entry.id],
          CausalRelationType.CAUSES,
          0.9
        );
      }

      console.log(`[PhasedExecutor] Iteration recorded in memory: ${entry.id}`);
    } catch (error) {
      console.error('[PhasedExecutor] Failed to record iteration:', error);
    }
  }

  /**
   * Extract key context from CLI output for continuation injection.
   */
  private extractContext(output: string): string {
    // Extract key context from CLI output for injection
    // Look for: files modified, errors found, decisions made
    const lines = output.split('\n');
    const contextLines = lines.filter(line =>
      line.includes('✓') ||           // Completed items
      line.includes('→') ||           // Actions taken
      line.includes('Error') ||       // Errors found
      line.includes('Modified') ||    // Files changed
      line.includes('Created')        // Files created
    );
    return contextLines.join('\n');
  }

  /**
   * Handle turn limit reached - save checkpoint and ask user what to do.
   */
  private async handleTurnLimitReached(
    taskId: string,
    output: string,
    turnsUsed: number,
    maxTurns: number,
    iterationNumber: number = 1
  ): Promise<'accept' | 'continue'> {
    // Save checkpoint to instance
    this.lastCheckpoint = {
      taskId,
      turnsUsed,
      maxTurns,
      output,
      context: this.extractContext(output),
      timestamp: new Date()
    };

    // Persist checkpoint to memory
    this.lastCheckpoint.memoryEntryId = await this.saveCheckpointToMemory(this.lastCheckpoint);

    // Notify user with FULL output
    const response = await this.escalateToUser(
      taskId,
      '⏱️ Turn Limit Reached',
      `Completed ${turnsUsed}/${maxTurns} turns (iteration ${iterationNumber}).\n\n` +
      `### Full Output\n\`\`\`\n${output}\n\`\`\`\n\n` +
      `What would you like to do?`,
      'decision'
    );

    const decision = (response?.toLowerCase().includes('keep') ||
                     response?.toLowerCase().includes('continue') ||
                     response?.toLowerCase().includes('think'))
      ? 'continue' : 'accept';

    // Record the user's decision in memory
    await this.recordIterationToMemory(
      taskId,
      iterationNumber,
      decision,
      this.lastCheckpoint.memoryEntryId
    );

    return decision;
  }

  /**
   * Escalate to user via CommunicationManager or callback.
   * Options are context-aware: Turn Limit gets Accept/Keep thinking,
   * other escalations get Continue/Abort/Guide.
   */
  private async escalateToUser(
    taskId: string,
    title: string,
    context: string,
    type: 'clarification' | 'decision' | 'blocked' | 'approval' = 'blocked'
  ): Promise<string | null> {
    // Try CommunicationManager first (Telegram etc.)
    if (this.comms) {
      // Determine options based on title/type
      const isTurnLimit = title.includes('Turn Limit');

      const options = isTurnLimit
        ? [
            { label: 'Accept', description: 'Use current progress as-is' },
            { label: 'Keep thinking', description: 'Continue with fresh turns + context' }
          ]
        : [
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
        `cli_calls: ${result.cliCalls}`,
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
      // Quality: 1.0 for success, 0.0-0.3 for failures based on how far we got
      const quality = result.success
        ? 1.0
        : result.fixAttempts > 0
          ? 0.1 + (0.2 * (5 - result.fixAttempts) / 5) // 0.1-0.3 based on fix attempts
          : 0.2; // Made it to execution phase but failed

      await this.engine.provideFeedback(
        entry.id,
        quality,
        'phased_execution'
      );

      console.log(`[PhasedExecutor] Recorded learning feedback: quality=${quality.toFixed(2)}`);

      // For failures, record causal relation (failure → error)
      if (!result.success && result.error) {
        // Store the error separately for causal linking
        const errorEntry = await this.engine.store(
          `ERROR: ${result.error}\nTASK: ${description}\nPHASE: ${this.determineFailurePhase(result)}`,
          {
            source: MemorySource.TOOL_OUTPUT,
            tags: ['error', 'phased_execution', 'failure_cause'],
            importance: 0.9
          }
        );

        // Create causal relation: task execution → caused → error
        this.engine.addCausalRelation(
          [entry.id],
          [errorEntry.id],
          CausalRelationType.CAUSES,
          0.8
        );

        console.log(`[PhasedExecutor] Recorded causal relation: execution → error`);
      }
    } catch (error) {
      // Don't fail execution due to learning errors
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

    console.log(`[PhasedExecutor] Starting 6-phase execution for task ${taskId}`);
    console.log(`[PhasedExecutor] Using Claude hybrid approach: CLI Opus (thinking) + API Sonnet (doing)`);

    const result: PhasedExecutionResult = {
      taskId,
      success: false,
      phases: {},
      cliCalls: 0,
      apiCalls: 0,
      fixAttempts: 0,
      escalatedToHuman: false,
      duration: 0
    };

    try {
      // === SKILL DETECTION & POLYGLOT LOADING ===
      // Detect skills from task description and load relevant polyglot knowledge
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

      // Phase 1: CONTEXT SCOUT (CLI Opus)
      console.log('[PhasedExecutor] === Phase 1: CONTEXT SCOUT (CLI Opus) ===');
      const scout = createContextScout(this.codebasePath, polyglotContext);
      const context = await scout.scout(task as CodexTask);
      result.phases.context = context;
      result.cliCalls++;
      console.log(`[PhasedExecutor] CTX: ${context.compressedToken.substring(0, 60)}...`);

      // Check for abort after Phase 1
      this.checkAborted();

      // Phase 2: ARCHITECT (CLI Opus)
      console.log('[PhasedExecutor] === Phase 2: ARCHITECT (CLI Opus) ===');
      const reasoner = createDefaultClaudeReasoner(this.codebasePath);
      const design = await reasoner.architect(context);
      result.phases.design = design;
      result.cliCalls++;
      console.log(`[PhasedExecutor] DES: ${design.compressedToken.substring(0, 60)}...`);

      // Check for abort after Phase 2
      this.checkAborted();

      // Phase 3: ENGINEER (API Sonnet)
      console.log('[PhasedExecutor] === Phase 3: ENGINEER (API Sonnet) ===');
      const plan = await reasoner.engineer(context, design);
      result.phases.plan = plan;
      result.apiCalls++; // Sonnet via API
      console.log(`[PhasedExecutor] PLAN: ${plan.compressedToken.substring(0, 60)}...`);
      console.log(`[PhasedExecutor] Files: ${plan.files.length}, Commands: ${plan.commands.length}`);

      // Check for abort after Phase 3
      this.checkAborted();

      // Phase 4: VALIDATOR (API Sonnet)
      console.log('[PhasedExecutor] === Phase 4: VALIDATOR (API Sonnet) ===');
      const validator = createPlanValidator(this.codebasePath);
      const validation = await validator.validate(context, design, plan);
      result.phases.validation = validation;
      result.apiCalls++; // Will be updated when we switch validator to API
      console.log(`[PhasedExecutor] VAL: ${validation.compressedToken.substring(0, 60)}...`);

      if (!validation.approved) {
        console.warn('[PhasedExecutor] Validation rejected plan');
        if (validation.blockers.length > 0) {
          // Immediate human escalation for blockers
          result.escalatedToHuman = true;
          result.error = `Blocked: ${validation.blockers.join(', ')}`;
          result.duration = Date.now() - startTime;
          return result;
        }
        // Continue with required modifications
      }

      // Check for abort after Phase 4
      this.checkAborted();

      // Phase 5: EXECUTOR (Local)
      console.log('[PhasedExecutor] === Phase 5: EXECUTOR (Local) ===');
      const executor = createPlanExecutor(this.codebasePath, this.dryRun);
      let execution = await executor.execute(plan, validation);
      result.phases.execution = execution;
      console.log(`[PhasedExecutor] EXEC: ${execution.compressedToken}`);

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
      console.log(`[PhasedExecutor] CLI: ${result.cliCalls}, API: ${result.apiCalls}, Fixes: ${result.fixAttempts}`);

      // === LEARNING INTEGRATION ===
      // Track this execution as a trajectory for Sona learning
      await this.recordLearning(task, result);

      return result;

    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      result.duration = Date.now() - startTime;
      console.error('[PhasedExecutor] Execution failed:', result.error);

      // Track failure for learning
      await this.recordLearning(task, result);

      return result;
    } finally {
      // Cleanup abort controller
      this.abortController = null;
    }
  }

  /**
   * Run the fix loop with escalating model strategy and turn limit handling.
   *
   * Tiers (Claude only):
   * 1-2: API Sonnet (fast, cheap)
   * 3: API Sonnet + extended thinking
   * 4: CLI Opus (fresh perspective, MCP access) with turn limits
   * 5: CLI Opus + ultrathink with turn limits
   *
   * When CLI reaches turn limit:
   * - Notifies user with full output
   * - User can "Accept" (use current) or "Keep thinking" (continue)
   * - Continuation injects previous context for fresh turn allocation
   */
  private async runFixLoop(
    task: CodexTask | Subtask,
    context: ContextBundle,
    design: DesignOutput,
    plan: PlanOutput,
    execution: ExecutionResult,
    result: PhasedExecutionResult
  ): Promise<ExecutionResult | null> {
    const tokenChain = [
      context.compressedToken,
      design.compressedToken,
      plan.compressedToken,
      execution.compressedToken
    ].join('\n');

    const errorSummary = execution.errors.map(e => `${e.type}: ${e.message}`).join('\n');

    // Assess task complexity for turn limits
    const complexity = this.assessComplexity(task);
    console.log(`[PhasedExecutor] Task complexity: ${complexity} (max ${TURN_LIMITS[complexity]} turns for CLI)`);

    // Track continuation context across iterations
    let continuationContext: string | undefined;
    let iterationNumber = 1;

    for (const tier of FIX_ESCALATION_TIERS) {
      result.fixAttempts++;
      console.log(`[PhasedExecutor] Fix attempt ${tier.attempt}/5: ${tier.description}`);

      try {
        let fixResponse: string;

        if (tier.useCli) {
          // CLI Opus with turn limits and optional continuation
          const { output, reachedLimit } = await this.executeCliOpusFix(
            tokenChain,
            errorSummary,
            tier.ultrathink,
            complexity,
            continuationContext
          );
          result.cliCalls++;

          if (reachedLimit) {
            // Turn limit reached - ask user what to do
            console.log(`[PhasedExecutor] Turn limit reached at tier ${tier.attempt}`);
            const decision = await this.handleTurnLimitReached(
              result.taskId,
              output,
              TURN_LIMITS[complexity],
              TURN_LIMITS[complexity],
              iterationNumber
            );

            if (decision === 'continue') {
              // Inject context and retry same tier (don't increment attempt)
              continuationContext = this.lastCheckpoint?.context;
              iterationNumber++;
              console.log(`[PhasedExecutor] User chose to continue thinking (iteration ${iterationNumber})...`);
              // Decrement fixAttempts since we're retrying same tier
              result.fixAttempts--;
              continue; // Retry with context
            }
            // 'accept' - use what we have
            fixResponse = output;
          } else {
            fixResponse = output;
            continuationContext = undefined; // Clear for next tier
          }
        } else {
          // API Sonnet for fast fixes (no turn limits)
          fixResponse = await this.executeApiSonnetFix(tokenChain, errorSummary, tier.ultrathink, tier.budgetTokens);
          result.apiCalls++;
          continuationContext = undefined; // Clear continuation for API calls
        }

        // Parse the fix response for new file operations
        const fixedPlan = this.parseFixResponse(fixResponse, plan);

        if (fixedPlan.files.length > 0) {
          // Re-execute with the fixed plan
          const executor = createPlanExecutor(this.codebasePath, this.dryRun);
          const newExecution = await executor.execute(fixedPlan, result.phases.validation!);

          if (newExecution.success) {
            console.log(`[PhasedExecutor] Fix successful at tier ${tier.attempt}!`);

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

          // Update error for next iteration
          execution = newExecution;
        }

      } catch (error) {
        console.error(`[PhasedExecutor] Fix attempt ${tier.attempt} failed:`, error);
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
      return null; // User wants to stop
    }

    // Otherwise continue or wait for guidance - but we've exhausted attempts
    return null;
  }

  /**
   * Check if CLI output indicates the task is complete (has file blocks).
   */
  private isOutputComplete(output: string): boolean {
    // Output is complete if it contains file blocks (the expected format)
    return output.includes('<file path=') && output.includes('</file>');
  }

  /**
   * Execute fix via CLI Opus with complexity-based turn limits.
   *
   * @param tokenChain - Token context chain from previous phases
   * @param errors - Error summary to fix
   * @param ultrathink - Enable extended thinking
   * @param complexity - Task complexity (determines max turns)
   * @param continuationContext - Context from previous run (for continuation)
   * @returns Object with output and whether turn limit was reached
   */
  private async executeCliOpusFix(
    tokenChain: string,
    errors: string,
    ultrathink: boolean,
    complexity: TaskComplexity = 'medium',
    continuationContext?: string
  ): Promise<{ output: string; reachedLimit: boolean }> {
    const maxTurns = TURN_LIMITS[complexity];

    return new Promise((resolve, reject) => {
      // Build prompt with optional continuation context
      let prompt = this.buildFixPrompt(tokenChain, errors, ultrathink);
      if (continuationContext) {
        prompt = `## CONTINUATION - Previous Progress\n${continuationContext}\n\n` +
                 `## Continue from here\n${prompt}`;
      }

      const args = [
        '-p', prompt,
        '--model', 'opus',
        '--max-turns', String(maxTurns),  // Enforce turn limit
        '--allowedTools', 'Read,Glob,Grep,mcp__rubix__god_query,mcp__rubix__god_failure_query'
      ];

      console.log(`[PhasedExecutor] CLI Opus fix with max-turns=${maxTurns} (${complexity})`);

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

      // Handle abort signal
      const abortHandler = () => {
        if (resolved) return;
        resolved = true;
        child.kill('SIGTERM');
        reject(new Error('Aborted by user'));
      };

      this.abortController?.signal.addEventListener('abort', abortHandler, { once: true });

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        this.abortController?.signal.removeEventListener('abort', abortHandler);
        if (resolved) return;
        resolved = true;

        if (code === 0 || code === null) {
          // Check if we hit the turn limit (code 0 but output indicates limit)
          const reachedLimit = stdout.includes('max turns') ||
                              stdout.includes('turn limit') ||
                              stdout.includes('Max turns reached') ||
                              (code === 0 && !this.isOutputComplete(stdout));

          resolve({ output: stdout, reachedLimit });
        } else {
          reject(new Error(`CLI exited with code ${code}: ${stderr}`));
        }
      });

      child.on('error', (error) => {
        this.abortController?.signal.removeEventListener('abort', abortHandler);
        if (resolved) return;
        resolved = true;
        reject(error);
      });

      // Only set timeout if configured (non-zero)
      if (this.cliTimeout > 0) {
        setTimeout(() => {
          if (resolved) return;
          resolved = true;
          child.kill('SIGTERM');
          reject(new Error('CLI fix timed out'));
        }, this.cliTimeout);
      }
    });
  }

  /**
   * Execute fix via API Sonnet.
   */
  private async executeApiSonnetFix(
    tokenChain: string,
    errors: string,
    ultrathink: boolean,
    budgetTokens: number
  ): Promise<string> {
    if (!this.apiClient) {
      throw new Error('API client not initialized');
    }

    const prompt = this.buildFixPrompt(tokenChain, errors, ultrathink);

    console.log(`[PhasedExecutor] Executing API Sonnet fix${ultrathink ? ' with extended thinking' : ''}...`);

    const baseParams = {
      model: this.apiModel,
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

    return textBlock.text;
  }

  /**
   * Build fix prompt.
   */
  private buildFixPrompt(tokenChain: string, errors: string, ultrathink: boolean): string {
    return `# FIX - Error Recovery Phase

## Your Role
You are the FIXER. The execution failed and you need to fix the errors.
${ultrathink ? 'Take your time to think deeply about the root cause.' : ''}

## MEMORY RECALL (Do this FIRST)
Query memory for similar past failures:
- mcp__rubix__god_failure_query "error: ${errors.substring(0, 100)}"
- mcp__rubix__god_query "fix patterns ${errors.substring(0, 50)}"

Learn from past failures. Don't repeat the same mistakes.

## Token Chain (Context)
${tokenChain}

## Errors to Fix
${errors}

## Required Output

Analyze the errors and provide fixed file contents:

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

    // Parse file blocks from response
    const fileMatches = response.matchAll(/<file\s+path="([^"]+)"\s+action="([^"]+)">\n([\s\S]*?)<\/file>/g);
    for (const match of fileMatches) {
      fixedPlan.files.push({
        path: match[1],
        action: match[2] as 'create' | 'modify' | 'delete',
        content: match[3].trim()
      });
    }

    return fixedPlan;
  }

  /**
   * Get execution statistics.
   */
  getStats(result: PhasedExecutionResult): {
    totalCalls: number;
    cliCalls: number;
    apiCalls: number;
    reduction: string;
  } {
    const totalCalls = result.cliCalls + result.apiCalls;
    const oldApproach = 25; // 5 depts × 5 attempts
    const reduction = Math.round((1 - totalCalls / oldApproach) * 100);

    return {
      totalCalls,
      cliCalls: result.cliCalls,
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
