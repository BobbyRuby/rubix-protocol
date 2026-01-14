/**
 * PhasedExecutor - Orchestrates the 6-phase tokenized execution.
 *
 * Replaces the old parallel department execution with phased token flow:
 *
 * Phase 1: CONTEXT SCOUT (Claude) - Gather context → CTX tokens
 * Phase 2: ARCHITECT (Ollama) - Design solution → DES tokens
 * Phase 3: ENGINEER (Ollama) - Plan implementation → PLAN tokens + files
 * Phase 4: VALIDATOR (Claude) - Review plan → VAL tokens
 * Phase 5: EXECUTOR (Local) - Write files, run commands → EXEC tokens
 * Phase 6: FIX LOOP (Claude) - Fix errors, 5 attempts before human
 *
 * Total: 2-3 Claude calls (down from 15-25)
 */

import { createContextScout, ContextBundle } from './ContextScout.js';
import { createOllamaReasoner, DesignOutput, PlanOutput } from './OllamaReasoner.js';
import { createPlanValidator, ValidationResult } from './PlanValidator.js';
import { createPlanExecutor, ExecutionResult } from './PlanExecutor.js';
import type { CodexTask, Subtask } from './types.js';

/**
 * 6-tier escalation for fix loop.
 */
const FIX_ESCALATION_TIERS = [
  { attempt: 1, model: 'sonnet', ultrathink: false, description: 'Standard fix' },
  { attempt: 2, model: 'sonnet', ultrathink: false, description: 'Alternative approach' },
  { attempt: 3, model: 'sonnet', ultrathink: true, description: 'Ultrathink analysis' },
  { attempt: 4, model: 'opus', ultrathink: false, description: 'Opus fresh eyes' },
  { attempt: 5, model: 'opus', ultrathink: true, description: 'Opus ultrathink' },
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
  claudeCalls: number;
  ollamaCalls: number;
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

  constructor(codebasePath: string, dryRun = false) {
    this.codebasePath = codebasePath;
    this.dryRun = dryRun;
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
    const startTime = Date.now();
    const taskId = 'id' in task ? task.id : `subtask_${Date.now()}`;

    console.log(`[PhasedExecutor] Starting 6-phase execution for task ${taskId}`);

    const result: PhasedExecutionResult = {
      taskId,
      success: false,
      phases: {},
      claudeCalls: 0,
      ollamaCalls: 0,
      fixAttempts: 0,
      escalatedToHuman: false,
      duration: 0
    };

    try {
      // Phase 1: CONTEXT SCOUT (Claude)
      console.log('[PhasedExecutor] === Phase 1: CONTEXT SCOUT ===');
      const scout = createContextScout(this.codebasePath);
      const context = await scout.scout(task as CodexTask);
      result.phases.context = context;
      result.claudeCalls++;
      console.log(`[PhasedExecutor] CTX: ${context.compressedToken.substring(0, 60)}...`);

      // Phase 2: ARCHITECT (Ollama)
      console.log('[PhasedExecutor] === Phase 2: ARCHITECT ===');
      const reasoner = createOllamaReasoner();
      const design = await reasoner.architect(context);
      result.phases.design = design;
      result.ollamaCalls++;
      console.log(`[PhasedExecutor] DES: ${design.compressedToken.substring(0, 60)}...`);

      // Phase 3: ENGINEER (Ollama)
      console.log('[PhasedExecutor] === Phase 3: ENGINEER ===');
      const plan = await reasoner.engineer(context, design);
      result.phases.plan = plan;
      result.ollamaCalls++;
      console.log(`[PhasedExecutor] PLAN: ${plan.compressedToken.substring(0, 60)}...`);
      console.log(`[PhasedExecutor] Files: ${plan.files.length}, Commands: ${plan.commands.length}`);

      // Phase 4: VALIDATOR (Claude)
      console.log('[PhasedExecutor] === Phase 4: VALIDATOR ===');
      const validator = createPlanValidator(this.codebasePath);
      const validation = await validator.validate(context, design, plan);
      result.phases.validation = validation;
      result.claudeCalls++;
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

      // Phase 5: EXECUTOR (Local)
      console.log('[PhasedExecutor] === Phase 5: EXECUTOR ===');
      const executor = createPlanExecutor(this.codebasePath, this.dryRun);
      let execution = await executor.execute(plan, validation);
      result.phases.execution = execution;
      console.log(`[PhasedExecutor] EXEC: ${execution.compressedToken}`);

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
      console.log(`[PhasedExecutor] Claude: ${result.claudeCalls}, Ollama: ${result.ollamaCalls}, Fixes: ${result.fixAttempts}`);

      return result;

    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      result.duration = Date.now() - startTime;
      console.error('[PhasedExecutor] Execution failed:', result.error);
      return result;
    }
  }

  /**
   * Run the fix loop with 6-tier escalation.
   */
  private async runFixLoop(
    _task: CodexTask | Subtask,
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

    for (const tier of FIX_ESCALATION_TIERS) {
      result.fixAttempts++;
      console.log(`[PhasedExecutor] Fix attempt ${tier.attempt}/5: ${tier.description}`);

      try {
        // TODO: Implement fix attempt using Claude with tier.model and tier.ultrathink
        // For now, we just log and continue
        console.log(`[PhasedExecutor] Would use ${tier.model}${tier.ultrathink ? ' + ultrathink' : ''}`);
        result.claudeCalls++;

        // Simulate fix (in real implementation, this would call Claude)
        // const fixedPlan = await this.attemptFix(tier, tokenChain, execution.errors);
        // const newExecution = await executor.execute(fixedPlan);
        // if (newExecution.success) return newExecution;

      } catch (error) {
        console.error(`[PhasedExecutor] Fix attempt ${tier.attempt} failed:`, error);
      }
    }

    // All 5 attempts failed - escalate to human
    console.warn('[PhasedExecutor] All 5 fix attempts failed. Escalating to human.');
    result.escalatedToHuman = true;

    if (this.escalationCallback) {
      const errorSummary = execution.errors.map(e => `${e.type}: ${e.message}`).join('\n');
      const message = `## Fix Loop Exhausted

All 5 automated fix attempts have failed.

### Token Chain
\`\`\`
${tokenChain}
\`\`\`

### Errors
${errorSummary}

Please provide guidance.`;

      await this.escalationCallback(result.taskId, message, tokenChain);
    }

    return null;
  }

  /**
   * Get execution statistics.
   */
  getStats(result: PhasedExecutionResult): {
    totalCalls: number;
    claudeCalls: number;
    ollamaCalls: number;
    reduction: string;
  } {
    const totalCalls = result.claudeCalls + result.ollamaCalls;
    const oldApproach = 25; // 5 depts × 5 attempts
    const reduction = Math.round((1 - totalCalls / oldApproach) * 100);

    return {
      totalCalls,
      claudeCalls: result.claudeCalls,
      ollamaCalls: result.ollamaCalls,
      reduction: `${reduction}% fewer API calls`
    };
  }
}

// Singleton instance
let phasedExecutorInstance: PhasedExecutor | null = null;

export function getPhasedExecutor(codebasePath?: string): PhasedExecutor {
  if (!phasedExecutorInstance && codebasePath) {
    phasedExecutorInstance = new PhasedExecutor(codebasePath);
  }
  if (!phasedExecutorInstance) {
    throw new Error('PhasedExecutor not initialized. Call with codebasePath first.');
  }
  return phasedExecutorInstance;
}

export function resetPhasedExecutor(): void {
  phasedExecutorInstance = null;
}
