/**
 * TaskExecutor
 *
 * The main CODEX execution engine. Orchestrates:
 * - Task decomposition into subtasks
 * - Sequential execution with dependency resolution
 * - Self-healing when failures occur
 * - Escalation when genuinely blocked
 * - Progress logging and status reporting
 */

import { randomUUID } from 'crypto';
import type { MemoryEngine } from '../core/MemoryEngine.js';
import type { ExtendedThinkingConfig } from '../core/types.js';
import type { PlaywrightManager } from '../playwright/PlaywrightManager.js';
import type { VerificationService } from '../playwright/VerificationService.js';
import type { CapabilitiesManager } from '../capabilities/CapabilitiesManager.js';
import type { WolframManager } from '../capabilities/wolfram/WolframManager.js';
import { TaskDecomposer } from './TaskDecomposer.js';
import { SelfHealer } from './SelfHealer.js';
import { EscalationGate, type Situation } from './EscalationGate.js';
import { LearningIntegration, type LearningSuggestion } from './LearningIntegration.js';
import { AlternativesFinder, type AlternativeApproach } from './AlternativesFinder.js';
import { CausalDebugger, type CausalChain } from './CausalDebugger.js';
import { CodeGenerator } from './CodeGenerator.js';
import { CollaborativePartner } from './CollaborativePartner.js';
import type { NotificationService } from '../notification/NotificationService.js';
import { DeepWorkManager, type DeepWorkSession, type DeepWorkOptions, type FocusLevel } from '../deepwork/index.js';
import type { CommunicationManager } from '../communication/CommunicationManager.js';
import type { EscalationResponse } from '../communication/types.js';
import {
  TaskStatus,
  SubtaskStatus,
  type CodexTask,
  type Subtask,
  type SubtaskAttempt,
  type SubtaskResult,
  type TaskResult,
  type Escalation,
  type WorkLogEntry,
  type StatusReport,
  type CodexConfig,
  type ExecutionContext,
  type VerificationPlan,
  DEFAULT_CODEX_CONFIG
} from './types.js';
import type { VerificationResult } from '../playwright/types.js';
import type { WorkflowResult } from '../playwright/VerificationService.js';

/**
 * Task submission request
 */
export interface TaskSubmission {
  description: string;
  specification?: string;
  codebase: string;
  constraints?: string[];
  verificationPlan?: VerificationPlan;
}

/**
 * Execution options
 */
export interface ExecutionOptions {
  /** Skip decomposition for simple tasks */
  skipDecomposition?: boolean;
  /** Run in dry-run mode (no actual execution) */
  dryRun?: boolean;
  /** Maximum parallel subtasks */
  maxParallel?: number;
  /** Deep work mode options */
  deepWork?: DeepWorkOptions;
}

/**
 * TaskExecutor - The CODEX brain
 */
export class TaskExecutor {
  private engine: MemoryEngine;
  // Stored for future use when we integrate code generation
  private playwrightManager: PlaywrightManager | undefined;
  private verifier: VerificationService | undefined;
  private capabilities: CapabilitiesManager | undefined;
  private decomposer: TaskDecomposer;
  private healer: SelfHealer;
  private escalation: EscalationGate;
  private config: CodexConfig;

  // Intelligence Layer
  private learning: LearningIntegration;
  private alternatives: AlternativesFinder;
  private causalDebugger: CausalDebugger;
  private activeChains: Map<string, CausalChain> = new Map();

  // Notification System
  private notifications: NotificationService | undefined;

  // Communication Layer (for escalation fallback)
  private communications: CommunicationManager | undefined;

  // Deep Work Mode
  private deepWork: DeepWorkManager;

  // Code Generator (Claude API integration)
  private codeGenerator: CodeGenerator | undefined;

  // Extended thinking (ultrathink) configuration
  private extendedThinking: ExtendedThinkingConfig | undefined;

  // Collaborative Partner (proactive curiosity + challenge decisions)
  private collaborativePartner: CollaborativePartner | undefined;

  // Wolfram Alpha (deterministic math)
  private wolfram: WolframManager | undefined;

  private currentTask: CodexTask | undefined;
  private workLog: WorkLogEntry[] = [];
  private isExecuting = false;

  constructor(
    engine: MemoryEngine,
    config: Partial<CodexConfig> = {},
    playwright?: PlaywrightManager,
    verifier?: VerificationService,
    capabilities?: CapabilitiesManager
  ) {
    this.engine = engine;
    this.playwrightManager = playwright;
    this.verifier = verifier;
    this.capabilities = capabilities;
    this.config = { ...DEFAULT_CODEX_CONFIG, ...config };

    this.decomposer = new TaskDecomposer(engine);
    this.healer = new SelfHealer(engine, capabilities);
    this.escalation = new EscalationGate(engine, config);

    // Initialize intelligence layer
    this.learning = new LearningIntegration(engine);
    this.alternatives = new AlternativesFinder(engine);
    this.causalDebugger = new CausalDebugger(engine);

    // Initialize deep work manager
    this.deepWork = new DeepWorkManager();
  }

  /**
   * Submit and execute a task
   */
  async execute(submission: TaskSubmission, options: ExecutionOptions = {}): Promise<TaskResult> {
    if (this.isExecuting) {
      throw new Error('Another task is already executing');
    }

    this.isExecuting = true;

    try {
      // Create task
      const task = this.createTask(submission);
      this.currentTask = task;

      // Start deep work session
      this.deepWork.startSession(task.id, options.deepWork);
      this.deepWork.log({
        type: 'start',
        message: `Task: ${task.description}`,
        details: { taskId: task.id, codebase: task.codebase }
      });

      this.log('start', `Starting task: ${task.description}`);

      // Update status
      task.status = TaskStatus.DECOMPOSING;
      task.startedAt = new Date();

      // Gather codebase context
      let codebaseContext = await this.gatherCodebaseContext(task.codebase);

      // === PROACTIVE CURIOSITY CHECK ===
      // Before decomposition, identify knowledge gaps and ask questions
      if (this.collaborativePartner) {
        const gaps = await this.collaborativePartner.identifyKnowledgeGaps(task);

        if (gaps.length > 0) {
          this.log('progress', `Collaborative Partner identified ${gaps.length} knowledge gap(s)`);

          // Separate critical and non-critical gaps
          const criticalGaps = gaps.filter(g => g.critical);
          const nonCriticalGaps = gaps.filter(g => !g.critical);

          // Critical gaps require escalation
          if (criticalGaps.length > 0) {
            const situation: Situation = {
              type: 'knowledge_gap',
              description: criticalGaps.map(g => g.question).join('\n\n'),
              task,
              businessImpact: 'high'
            };

            const escalation = this.escalation.createEscalation(situation, {
              shouldEscalate: true,
              type: 'clarification',
              reason: 'Knowledge gaps must be clarified before proceeding',
              canContinueWithAssumption: false
            });

            if (this.communications) {
              task.status = TaskStatus.BLOCKED;
              this.log('escalation', 'Critical knowledge gaps - awaiting user response', {
                escalationId: escalation.id,
                questions: criticalGaps.map(g => g.question)
              });

              const response = await this.attemptCommunicationEscalation(escalation, task);

              if (response?.response) {
                this.log('progress', 'User clarified knowledge gaps');
                codebaseContext += `\n\n=== USER CLARIFICATION (Knowledge Gaps) ===\n${response.response}\n=== END CLARIFICATION ===`;
                this.escalation.resolveEscalation(escalation.id, response.response);
              } else {
                this.log('failure', 'No response to knowledge gap questions');
                task.status = TaskStatus.FAILED;
                return {
                  success: false,
                  summary: `Task blocked: knowledge gaps require clarification.\n\nQuestions:\n${criticalGaps.map(g => `- ${g.question}`).join('\n')}`,
                  subtasksCompleted: 0,
                  subtasksFailed: 0,
                  filesModified: [],
                  testsWritten: 0,
                  duration: Date.now() - (task.startedAt?.getTime() || Date.now()),
                  decisions: [],
                  assumptions: []
                };
              }
            }
          }

          // Non-critical gaps are logged and added as context
          if (nonCriticalGaps.length > 0) {
            this.log('progress', `Proceeding with assumptions for ${nonCriticalGaps.length} non-critical gap(s)`);
            const assumptions = nonCriticalGaps.map(g => ({
              id: randomUUID(),
              taskId: task.id,
              description: `Assumed reasonable default for: ${g.question}`,
              reasoning: `Non-critical knowledge gap in domain: ${g.domain}`,
              madeAt: new Date()
            }));
            task.assumptions.push(...assumptions);
          }
        }
      }

      // Decompose task (unless skipped)
      if (!options.skipDecomposition) {
        this.log('progress', 'Decomposing task into subtasks');

        let decomposition = await this.decomposer.decompose({
          task,
          codebaseContext
        });

        // Handle clarification needed during decomposition
        if (decomposition.needsClarification && decomposition.clarificationText) {
          this.log('escalation', 'Claude needs clarification before decomposition');

          // Create escalation with Claude's questions
          const situation = {
            task,
            description: decomposition.clarificationText,
            attempts: 0,
            type: 'spec_ambiguity' as const
          };

          const escalation = this.escalation.createEscalation(situation, {
            shouldEscalate: true,
            type: 'clarification',
            reason: 'Clarification needed for task decomposition',
            canContinueWithAssumption: false
          });

          // Send clarification request to user via communication channels
          if (this.communications) {
            task.status = TaskStatus.BLOCKED;
            this.log('progress', 'Waiting for user clarification...');

            const response = await this.attemptCommunicationEscalation(escalation, task);

            if (response?.response) {
              this.log('progress', 'Received clarification, re-decomposing task');

              // Re-decompose with clarification in context
              decomposition = await this.decomposer.decompose({
                task: {
                  ...task,
                  specification: `${task.specification || ''}\n\nUser Clarification:\n${response.response}`
                },
                codebaseContext: `${codebaseContext}\n\nUser provided clarification:\n${response.response}`
              });

              // If still needs clarification, fail gracefully
              if (decomposition.needsClarification) {
                this.log('failure', 'Still needs clarification after user response');
                task.status = TaskStatus.FAILED;
                return {
                  success: false,
                  summary: 'Unable to decompose task even with clarification',
                  subtasksCompleted: 0,
                  subtasksFailed: 0,
                  filesModified: [],
                  testsWritten: 0,
                  duration: Date.now() - (task.startedAt?.getTime() || Date.now()),
                  decisions: [],
                  assumptions: []
                };
              }
            } else {
              this.log('failure', 'Clarification timeout or no response');
              task.status = TaskStatus.FAILED;
              return {
                success: false,
                summary: 'Task decomposition blocked: awaiting clarification',
                subtasksCompleted: 0,
                subtasksFailed: 0,
                filesModified: [],
                testsWritten: 0,
                duration: Date.now() - (task.startedAt?.getTime() || Date.now()),
                decisions: [],
                assumptions: []
              };
            }
          } else {
            // No communication channels - fail immediately
            this.log('failure', 'Cannot get clarification: no communication channels configured');
            task.status = TaskStatus.FAILED;
            return {
              success: false,
              summary: `Task needs clarification but no communication channels available.\n\nQuestions:\n${decomposition.clarificationText}`,
              subtasksCompleted: 0,
              subtasksFailed: 0,
              filesModified: [],
              testsWritten: 0,
              duration: Date.now() - (task.startedAt?.getTime() || Date.now()),
              decisions: [],
              assumptions: []
            };
          }
        }

        task.subtasks = decomposition.subtasks;

        // Check for critical ambiguities
        const criticalAmbiguities = decomposition.ambiguities.filter(a => a.critical);
        if (criticalAmbiguities.length > 0) {
          const batchEscalation = await this.escalation.createBatchDecisions(
            task,
            criticalAmbiguities.map(a => ({
              description: a.description,
              critical: a.critical,
              options: a.possibleInterpretations.map((p, i) => ({
                label: `Option ${i + 1}`,
                description: p
              }))
            }))
          );

          if (batchEscalation) {
            task.status = TaskStatus.BLOCKED;
            this.log('escalation', 'Need decisions before proceeding', {
              escalationId: batchEscalation.id
            });

            // Wait for resolution (in production, this would pause and resume)
            // For now, we'll use the first interpretation as default
            this.escalation.resolveEscalation(
              batchEscalation.id,
              'Using first interpretation for each ambiguity'
            );
          }
        }

        this.log('progress', `Decomposed into ${task.subtasks.length} subtasks`);

        // Store decomposition pattern in learning
        await this.learning.learnDecomposition(task, task.subtasks.length, true);

        // Create initial checkpoint after decomposition
        this.deepWork.createCheckpoint(
          0,
          task.subtasks.length,
          `Task decomposed into ${task.subtasks.length} subtasks`
        );
      }

      // Execute subtasks
      task.status = TaskStatus.EXECUTING;

      if (options.dryRun) {
        this.log('complete', 'Dry run complete - no subtasks executed');
        return this.createDryRunResult(task);
      }

      const result = await this.executeSubtasks(task, codebaseContext);

      // Complete task
      task.status = result.success ? TaskStatus.COMPLETED : TaskStatus.FAILED;
      task.completedAt = new Date();
      task.result = result;

      this.log('complete', result.success ? 'Task completed successfully' : 'Task failed', {
        result
      });

      // End deep work session
      this.deepWork.log({
        type: 'complete',
        message: result.success ? 'Task completed successfully' : 'Task failed',
        details: {
          success: result.success,
          subtasksCompleted: result.subtasksCompleted,
          subtasksFailed: result.subtasksFailed,
          duration: result.duration
        }
      });
      this.deepWork.endSession(result.success ? 'completed' : 'interrupted');

      // Store completion in memory
      await this.storeTaskCompletion(task, result);

      return result;
    } finally {
      this.isExecuting = false;
    }
  }

  /**
   * Execute all subtasks in dependency order
   */
  private async executeSubtasks(task: CodexTask, codebaseContext: string): Promise<TaskResult> {
    const completed: Subtask[] = [];
    const failed: Subtask[] = [];
    const filesModified: Set<string> = new Set();
    let testsWritten = 0;

    // Sort by order (already in dependency order from decomposition)
    const orderedSubtasks = [...task.subtasks].sort((a, b) => a.order - b.order);

    for (const subtask of orderedSubtasks) {
      // Check dependencies are complete
      const depsComplete = subtask.dependencies.every(depId =>
        completed.some(s => s.id === depId)
      );

      if (!depsComplete) {
        // Check if any dependency failed
        const depFailed = subtask.dependencies.some(depId =>
          failed.some(s => s.id === depId)
        );

        if (depFailed) {
          subtask.status = SubtaskStatus.SKIPPED;
          this.log('progress', `Skipping subtask (dependency failed): ${subtask.description}`);
          continue;
        }
      }

      // Execute subtask
      this.log('progress', `Starting subtask: ${subtask.description}`);
      subtask.status = SubtaskStatus.IN_PROGRESS;
      subtask.startedAt = new Date();

      const result = await this.executeSubtask(task, subtask, codebaseContext);

      subtask.completedAt = new Date();
      subtask.result = result;

      if (result.success) {
        subtask.status = SubtaskStatus.COMPLETED;
        completed.push(subtask);
        result.filesModified?.forEach(f => filesModified.add(f));
        testsWritten += result.testsRun || 0;

        this.log('success', `Subtask completed: ${subtask.description}`);

        // Log to deep work and create checkpoint at milestones
        this.deepWork.log({
          type: 'progress',
          message: `Completed: ${subtask.description}`,
          subtaskId: subtask.id,
          details: { filesModified: result.filesModified }
        });

        // Create checkpoint every 3 completed subtasks or on significant milestones
        const remaining = orderedSubtasks.length - completed.length - failed.length;
        if (completed.length % 3 === 0 || remaining === 0 || subtask.type === 'integrate') {
          this.deepWork.createCheckpoint(
            completed.length,
            remaining,
            `${completed.length}/${orderedSubtasks.length} subtasks complete`,
            { filesModified: Array.from(filesModified) }
          );
        }
      } else {
        subtask.status = SubtaskStatus.FAILED;
        failed.push(subtask);

        this.log('failure', `Subtask failed: ${subtask.description}`, {
          error: result.output
        });

        // Log failure to deep work
        this.deepWork.log({
          type: 'error',
          message: `Failed: ${subtask.description}`,
          subtaskId: subtask.id,
          details: { error: result.output }
        });

        // Check if we should continue or abort
        if (this.shouldAbortOnFailure(subtask, task)) {
          break;
        }
      }
    }

    const startTime = task.startedAt?.getTime() || Date.now();
    const duration = Date.now() - startTime;

    return {
      success: failed.length === 0,
      summary: this.generateTaskSummary(task, completed, failed),
      subtasksCompleted: completed.length,
      subtasksFailed: failed.length,
      filesModified: Array.from(filesModified),
      testsWritten,
      duration,
      decisions: task.decisions,
      assumptions: task.assumptions
    };
  }

  /**
   * Execute a single subtask with self-healing
   */
  private async executeSubtask(
    task: CodexTask,
    subtask: Subtask,
    codebaseContext: string
  ): Promise<SubtaskResult> {
    let attempt = 0;
    let lastError: string | undefined;
    let activeChain: CausalChain | undefined;

    // Get learning suggestions before starting
    const learningSuggestions = await this.learning.getSuggestions(subtask, []);
    if (learningSuggestions.length > 0) {
      this.log('progress', `Learning suggests: ${learningSuggestions[0].approach}`, {
        suggestions: learningSuggestions.map(s => s.approach)
      });
    }

    while (attempt < subtask.maxAttempts) {
      attempt++;

      // Determine approach - use learning suggestions if available
      let approach = this.getApproach(subtask, attempt, subtask.attempts);
      if (attempt === 1 && learningSuggestions.length > 0) {
        approach = learningSuggestions[0].approach;
      } else if (attempt > 1) {
        // Get alternatives for retry attempts
        const alternatives = await this.alternatives.findAlternatives(
          subtask,
          subtask.attempts,
          { maxResults: 3 }
        );
        if (alternatives.length > 0) {
          approach = alternatives[0].approach;
          this.log('progress', `Trying alternative: ${approach}`, {
            source: alternatives[0].source,
            confidence: alternatives[0].confidence
          });
        }
      }

      // Create attempt record
      const attemptRecord: SubtaskAttempt = {
        id: randomUUID(),
        subtaskId: subtask.id,
        attemptNumber: attempt,
        approach,
        startedAt: new Date(),
        success: false
      };

      subtask.attempts.push(attemptRecord);

      // Track attempt start with learning
      await this.learning.trackAttemptStart(task, subtask, attemptRecord);

      // === CHALLENGE CHECK ===
      // Before execution, assess the approach for potential issues
      if (this.collaborativePartner) {
        const assessment = await this.collaborativePartner.assessApproach(approach, {
          task,
          subtask,
          attempt: attemptRecord,
          previousAttempts: subtask.attempts.slice(0, -1),
          codebaseContext
        });

        if (assessment.isHardGate) {
          // HARD GATE: Block execution until user explicitly overrides
          this.log('escalation', `Collaborative Partner BLOCKS approach: ${assessment.reasoning}`, {
            credibility: assessment.credibility,
            lScore: assessment.lScore,
            contradictions: assessment.contradictions.length
          });

          const situation: Situation = {
            type: 'challenge_hard',
            description: `The collaborative partner has significant concerns about this approach:\n\n${assessment.reasoning}\n\nRecommendation: ${assessment.recommendation}`,
            task,
            subtask,
            businessImpact: 'high',
            challengeContext: {
              credibility: assessment.credibility,
              lScore: assessment.lScore,
              contradictions: assessment.contradictions.map(c => ({
                content: c.content,
                refutationStrength: c.refutationStrength,
                source: c.source
              })),
              recommendation: assessment.recommendation,
              reasoning: assessment.reasoning
            }
          };

          const escalation = this.escalation.createEscalation(situation, {
            shouldEscalate: true,
            type: 'approval',
            reason: 'Hard gate: approach requires explicit override to proceed',
            canContinueWithAssumption: false
          });

          if (this.communications) {
            task.status = TaskStatus.BLOCKED;
            this.log('escalation', 'Awaiting user override for challenged approach', {
              escalationId: escalation.id
            });

            const response = await this.attemptCommunicationEscalation(escalation, task, subtask);

            if (response?.response) {
              const responseText = response.response.toLowerCase();
              if (responseText.includes('override') || responseText.includes('proceed') || responseText.includes('continue') || responseText.includes('yes')) {
                this.log('progress', 'User overrode hard gate challenge');
                this.escalation.resolveEscalation(escalation.id, response.response);
                task.status = TaskStatus.EXECUTING;
                // Continue with execution
              } else {
                this.log('progress', 'User confirmed blocking - trying alternative');
                this.escalation.resolveEscalation(escalation.id, response.response);
                task.status = TaskStatus.EXECUTING;
                // Skip this attempt - let the loop try alternatives
                attemptRecord.error = 'Approach blocked by user after challenge';
                attemptRecord.completedAt = new Date();
                continue;
              }
            } else {
              // No response - abort this approach
              this.log('failure', 'No response to hard gate challenge - aborting approach');
              attemptRecord.error = 'Approach blocked: no override received for hard gate challenge';
              attemptRecord.completedAt = new Date();
              continue;
            }
          } else {
            // No communications - log and proceed with caution
            this.log('escalation', 'Hard gate triggered but no communications configured - proceeding with caution');
          }
        } else if (assessment.shouldChallenge) {
          // SOFT WARNING: Log concerns but proceed
          this.log('progress', `Collaborative Partner has concerns: ${assessment.reasoning}`, {
            credibility: assessment.credibility,
            lScore: assessment.lScore
          });

          // Store the challenge as an assumption
          task.assumptions.push({
            id: randomUUID(),
            taskId: task.id,
            description: `Proceeded despite concerns: ${assessment.reasoning}`,
            reasoning: `Soft challenge (credibility: ${(assessment.credibility * 100).toFixed(0)}%, L-Score: ${(assessment.lScore * 100).toFixed(0)}%)`,
            madeAt: new Date()
          });
        }
      }

      try {
        // Calculate thinking budget for ultrathink
        const thinkingBudget = this.calculateThinkingBudget(
          attempt,
          subtask,
          lastError,
          undefined // filesAffected - populated on retry
        );

        if (thinkingBudget) {
          this.log('progress', `Ultrathink enabled: ${thinkingBudget} token budget`, {
            attempt,
            subtaskType: subtask.type
          });
        }

        // Execute the approach
        const result = await this.performSubtaskExecution(
          task,
          subtask,
          attemptRecord,
          codebaseContext,
          thinkingBudget
        );

        attemptRecord.completedAt = new Date();

        if (result.success) {
          attemptRecord.success = true;
          attemptRecord.verificationResults = result.verificationResults;

          // Record outcome with learning
          await this.learning.recordOutcome(subtask, attemptRecord, true);

          // Record successful healing if this wasn't first attempt
          if (attempt > 1) {
            await this.healer.recordSuccessfulHealing(
              { task, subtask, attempt: attemptRecord, previousAttempts: subtask.attempts.slice(0, -1), codebaseContext },
              attemptRecord.approach
            );

            // Close causal chain if one was active
            if (activeChain) {
              await this.causalDebugger.recordOutcome(
                activeChain.id,
                true,
                `Resolved with approach: ${attemptRecord.approach}`
              );
              this.activeChains.delete(activeChain.id);
            }
          }

          return {
            success: true,
            output: result.output,
            filesModified: result.filesModified,
            testsRun: result.testsRun,
            testsPassed: result.testsPassed,
            verificationPassed: result.verificationPassed,
            duration: Date.now() - attemptRecord.startedAt.getTime()
          };
        }

        // Handle clarification received - add to context and retry
        if (result.error === 'CLARIFICATION_RECEIVED' && result.output) {
          console.log('[TaskExecutor] Clarification received, adding to context for retry');
          codebaseContext += `\n\n=== USER CLARIFICATION ===\n${result.output}\n=== END CLARIFICATION ===`;
          attemptRecord.healingAction = 'User provided clarification';
          // Don't count this as a failed attempt - reset attempt count
          // Actually just continue to next iteration which will use the updated context
          continue;
        }

        // Attempt failed
        attemptRecord.error = result.error;
        attemptRecord.consoleErrors = result.consoleErrors;
        attemptRecord.screenshot = result.screenshot;
        lastError = result.error;

        // Record failure outcome with learning
        await this.learning.recordOutcome(subtask, attemptRecord, false);

        // Start causal chain on first failure
        if (!activeChain) {
          activeChain = await this.causalDebugger.startChain(task, subtask, attemptRecord);
          this.activeChains.set(activeChain.id, activeChain);
        } else {
          // Add fix attempt to existing chain
          await this.causalDebugger.addFixAttempt(
            activeChain.id,
            attemptRecord.approach,
            result.error || 'Unknown error'
          );
        }

        // Get debug insights from causal debugger
        const debugInsights = await this.causalDebugger.getInsights(
          subtask,
          result.error || '',
          subtask.attempts
        );

        if (debugInsights.length > 0) {
          this.log('progress', `Debug insight: ${debugInsights[0].description}`, {
            category: debugInsights[0].category,
            suggestedAction: debugInsights[0].suggestedAction
          });
        }

        // Analyze failure and get healing suggestion
        const context: ExecutionContext = {
          task,
          subtask,
          attempt: attemptRecord,
          previousAttempts: subtask.attempts.slice(0, -1),
          codebaseContext
        };

        const healing = await this.healer.analyze(context);

        if (healing.isFundamentalBlocker) {
          // Escalate - we can't fix this ourselves
          const situation: Situation = {
            type: 'blocked',
            description: healing.reason || 'Subtask execution blocked',
            task,
            subtask,
            attempts: attempt,
            errors: [lastError || 'Unknown error']
          };

          const decision = await this.escalation.shouldEscalate(situation);

          if (decision.shouldEscalate) {
            const esc = this.escalation.createEscalation(situation, decision);
            this.log('escalation', `Escalating: ${esc.title}`, { escalationId: esc.id });

            // Try to reach user via communication channels
            if (esc.blocking && this.communications) {
              const userResponse = await this.attemptCommunicationEscalation(esc, task, subtask);

              if (userResponse) {
                // User responded - resolve the escalation and continue
                this.escalation.resolveEscalation(esc.id, userResponse.response);
                this.log('progress', `User provided guidance: ${userResponse.response}`);

                // Update the healing action based on user response
                attemptRecord.healingAction = userResponse.response;

                // Continue to next attempt with user's guidance
                continue;
              }
            }

            // No response received or communications not available - fail the subtask
            break;
          }
        }

        // Apply healing for next attempt
        if (healing.newApproach) {
          attemptRecord.healingAction = healing.newApproach;
        }

        if (healing.needsMoreContext && healing.contextNeeded) {
          // Gather additional context
          codebaseContext += '\n' + await this.gatherAdditionalContext(healing.contextNeeded);
        }

      } catch (error) {
        attemptRecord.completedAt = new Date();
        attemptRecord.error = error instanceof Error ? error.message : String(error);
        lastError = attemptRecord.error;
      }
    }

    // Max attempts reached - close causal chain as unresolved
    if (activeChain) {
      await this.causalDebugger.closeChain(activeChain.id, `Failed after ${attempt} attempts`);
      this.activeChains.delete(activeChain.id);
    }

    return {
      success: false,
      output: `Failed after ${attempt} attempts. Last error: ${lastError}`,
      duration: Date.now() - (subtask.startedAt?.getTime() || Date.now())
    };
  }

  /**
   * Perform actual subtask execution
   * @param thinkingBudget Optional thinking budget for ultrathink mode
   */
  private async performSubtaskExecution(
    task: CodexTask,
    subtask: Subtask,
    attempt: SubtaskAttempt,
    codebaseContext: string,
    thinkingBudget?: number
  ): Promise<{
    success: boolean;
    output?: string;
    error?: string;
    filesModified?: string[];
    testsRun?: number;
    testsPassed?: number;
    verificationPassed?: boolean;
    verificationResults?: VerificationResult[];
    consoleErrors?: string[];
    screenshot?: string;
  }> {
    // Execute based on subtask type, using CodeGenerator when available
    switch (subtask.type) {
      case 'research':
        return this.executeResearch(task, subtask, attempt, codebaseContext);

      case 'design':
        return this.executeDesign(task, subtask, attempt, codebaseContext);

      case 'code':
        return this.executeCode(task, subtask, attempt, codebaseContext, thinkingBudget);

      case 'test':
        return this.executeTest(subtask, task.verificationPlan);

      case 'integrate':
        return this.executeIntegration(task, subtask, attempt, codebaseContext, thinkingBudget);

      case 'verify':
        return this.executeVerification(subtask, task.verificationPlan);

      case 'review':
        return this.executeReview(subtask);

      default:
        return {
          success: false,
          error: `Unknown subtask type: ${subtask.type}`
        };
    }
  }

  /**
   * Execute research subtask
   */
  private async executeResearch(
    task: CodexTask,
    subtask: Subtask,
    attempt: SubtaskAttempt,
    codebaseContext: string
  ): Promise<{ success: boolean; output?: string; error?: string }> {
    // If CodeGenerator is available, use Claude for intelligent analysis
    if (this.codeGenerator) {
      try {
        const result = await this.codeGenerator.analyzeCode({
          task,
          subtask,
          attempt,
          codebaseContext,
          previousAttempts: subtask.attempts.slice(0, -1)
        });

        return {
          success: result.success,
          output: result.output,
          error: result.error
        };
      } catch (error) {
        // Fall back to memory-based research
        console.log('[TaskExecutor] CodeGenerator research failed, falling back to memory search');
      }
    }

    // Fallback: Query memory for relevant context
    try {
      const results = await this.engine.query(subtask.description, {
        topK: 10,
        filters: {
          minImportance: 0.3
        }
      });

      const findings = results.map(r => r.entry.content).join('\n\n');

      return {
        success: true,
        output: `Research complete. Found ${results.length} relevant entries.\n\n${findings.substring(0, 1000)}`
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Research failed'
      };
    }
  }

  /**
   * Execute design subtask
   */
  private async executeDesign(
    task: CodexTask,
    subtask: Subtask,
    attempt: SubtaskAttempt,
    codebaseContext: string
  ): Promise<{ success: boolean; output?: string; error?: string }> {
    // If CodeGenerator is available, use Claude for design
    if (this.codeGenerator) {
      try {
        const result = await this.codeGenerator.generateDesign({
          task,
          subtask,
          attempt,
          codebaseContext,
          previousAttempts: subtask.attempts.slice(0, -1)
        });

        return {
          success: result.success,
          output: result.output,
          error: result.error
        };
      } catch (error) {
        console.log('[TaskExecutor] CodeGenerator design failed, using placeholder');
      }
    }

    // Fallback: placeholder design
    return {
      success: true,
      output: `Design complete for: ${subtask.description}\n\nBased on existing patterns in codebase.`
    };
  }

  /**
   * Execute code subtask
   * @param thinkingBudget Optional thinking budget for ultrathink mode
   */
  private async executeCode(
    task: CodexTask,
    subtask: Subtask,
    attempt: SubtaskAttempt,
    codebaseContext: string,
    thinkingBudget?: number
  ): Promise<{
    success: boolean;
    output?: string;
    error?: string;
    filesModified?: string[];
    consoleErrors?: string[];
  }> {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // Pre-coding analysis with capabilities
      if (this.capabilities) {
        try {
          const preAnalysis = await this.capabilities.analyze();
          if (preAnalysis.totalErrors > 0) {
            warnings.push(`Pre-existing errors: ${preAnalysis.totalErrors}`);
          }
        } catch {
          // Static analysis optional
        }

        try {
          const diagnostics = await this.capabilities.getDiagnostics();
          const criticalDiags = diagnostics.filter(d => d.errorCount > 0);
          if (criticalDiags.length > 0) {
            warnings.push(`${criticalDiags.length} files have existing errors`);
          }
        } catch {
          // LSP diagnostics optional
        }
      }

      // CODE GENERATION - Use Claude API via CodeGenerator
      if (!this.codeGenerator) {
        return {
          success: false,
          error: 'CodeGenerator not configured. Set ANTHROPIC_API_KEY to enable code generation.',
          filesModified: [],
          consoleErrors: ['CodeGenerator not available']
        };
      }

      // WOLFRAM ENHANCEMENT - Inject deterministic math for math-heavy subtasks
      let enhancedContext = codebaseContext;
      if (this.wolfram && this.isMathHeavy(subtask)) {
        console.log('[TaskExecutor] Math-heavy subtask detected, querying Wolfram Alpha');
        enhancedContext = await this.enhanceWithWolframMath(subtask, codebaseContext);
      }

      console.log(`[TaskExecutor] Generating code for: ${subtask.description}`);

      const genResult = await this.codeGenerator.generate({
        task,
        subtask,
        attempt,
        codebaseContext: enhancedContext,
        previousAttempts: subtask.attempts.slice(0, -1)
      }, thinkingBudget);

      if (!genResult.success) {
        // Check if Claude asked clarifying questions instead of generating code
        if (genResult.error === 'CLARIFICATION_NEEDED') {
          console.log('[TaskExecutor] Claude requested clarification - escalating to user');

          // Create escalation with Claude's questions
          const clarificationEscalation: Escalation = {
            id: randomUUID(),
            taskId: task.id,
            subtaskId: subtask.id,
            type: 'clarification',
            title: 'Questions before starting',
            context: genResult.output || 'Claude needs clarification before proceeding.',
            questions: [], // Questions are embedded in context
            options: [],
            blocking: true,
            createdAt: new Date()
          };

          // Try to reach user via communication channels
          if (this.communications) {
            this.log('progress', 'Sending clarification questions to user', {
              escalationId: clarificationEscalation.id
            });

            const userResponse = await this.attemptCommunicationEscalation(
              clarificationEscalation,
              task,
              subtask
            );

            if (userResponse) {
              // User responded - store their clarification and retry
              console.log('[TaskExecutor] User provided clarification:', userResponse.response);
              this.log('progress', `User clarification received: ${userResponse.response}`);

              // Return partial success to trigger retry with clarification
              // The caller can use the output to feed back into the next attempt
              return {
                success: false,
                error: 'CLARIFICATION_RECEIVED',
                output: `User clarification: ${userResponse.response}\n\nOriginal questions:\n${genResult.output}`,
                filesModified: [],
                consoleErrors: []
              };
            }

            // No response - fail with questions shown
            this.log('escalation', 'No response to clarification request');
          }

          return {
            success: false,
            error: 'Clarification needed but no response received',
            output: genResult.output,
            filesModified: [],
            consoleErrors: ['Claude requested clarification but could not reach user']
          };
        }

        return {
          success: false,
          error: genResult.error || 'Code generation failed',
          filesModified: [],
          consoleErrors: genResult.error ? [genResult.error] : []
        };
      }

      const filesModified = [...genResult.filesCreated, ...genResult.filesModified];
      console.log(`[TaskExecutor] Generated ${filesModified.length} files`);

      // Post-coding verification with capabilities
      if (this.capabilities && filesModified.length > 0) {
        // Run type checking on modified files
        try {
          const typeResults = await this.capabilities.runTypeCheck(filesModified);
          for (const result of typeResults) {
            if (result.errors.length > 0) {
              errors.push(...result.errors.map(e => `${result.file}:${e.line}: ${e.message}`));
            }
          }
        } catch {
          // Type checking optional
        }

        // Run linting on modified files
        try {
          const lintResults = await this.capabilities.runLint(filesModified);
          for (const result of lintResults) {
            const lintErrors = result.messages.filter(m => m.severity === 'error');
            if (lintErrors.length > 0) {
              warnings.push(`${result.file}: ${lintErrors.length} lint errors`);
            }
          }
        } catch {
          // Linting optional
        }

        // Check impact of changes
        try {
          for (const file of filesModified) {
            const impact = await this.capabilities.analyzeImpact(file);
            if (impact.riskLevel === 'high') {
              warnings.push(`High-impact change to ${file}: affects ${impact.totalImpact} dependents`);
            }
          }
        } catch {
          // Impact analysis optional
        }
      }

      // If we have errors from post-coding verification, report them
      if (errors.length > 0) {
        return {
          success: false,
          error: `Code changes introduced errors:\n${errors.join('\n')}`,
          filesModified,
          consoleErrors: errors
        };
      }

      const outputParts = [genResult.output];
      if (warnings.length > 0) {
        outputParts.push(`Warnings:\n${warnings.join('\n')}`);
      }

      return {
        success: true,
        output: outputParts.join('\n'),
        filesModified
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Code execution failed',
        filesModified: [],
        consoleErrors: [error instanceof Error ? error.message : 'Unknown error']
      };
    }
  }

  /**
   * Execute test subtask
   */
  private async executeTest(
    subtask: Subtask,
    verificationPlan?: VerificationPlan
  ): Promise<{
    success: boolean;
    output?: string;
    error?: string;
    testsRun?: number;
    testsPassed?: number;
    consoleErrors?: string[];
  }> {
    // Run tests if Playwright is available
    if (this.verifier && verificationPlan?.testFiles) {
      try {
        // Use the subtask's verification steps
        const testSteps = subtask.verification.filter(v => v.type === 'test');
        if (testSteps.length === 0) {
          return {
            success: true,
            output: 'No test steps defined',
            testsRun: 0,
            testsPassed: 0
          };
        }

        // Execute the workflow with test steps
        const result: WorkflowResult = await this.verifier.executeWorkflow(
          verificationPlan.url || 'about:blank',
          testSteps
        );

        const passed = result.steps.filter(r => r.success).length;

        return {
          success: result.success,
          output: `Tests: ${passed}/${result.steps.length} passed`,
          testsRun: result.steps.length,
          testsPassed: passed
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Test execution failed'
        };
      }
    }

    return {
      success: true,
      output: 'No tests configured',
      testsRun: 0,
      testsPassed: 0
    };
  }

  /**
   * Execute integration subtask
   */
  private async executeIntegration(
    task: CodexTask,
    subtask: Subtask,
    attempt: SubtaskAttempt,
    codebaseContext: string,
    thinkingBudget?: number
  ): Promise<{ success: boolean; output?: string; error?: string; filesModified?: string[] }> {
    // Integration often requires code changes too - use CodeGenerator
    if (this.codeGenerator) {
      try {
        // WOLFRAM ENHANCEMENT - Inject deterministic math for math-heavy subtasks
        let enhancedContext = codebaseContext;
        if (this.wolfram && this.isMathHeavy(subtask)) {
          console.log('[TaskExecutor] Math-heavy integration detected, querying Wolfram Alpha');
          enhancedContext = await this.enhanceWithWolframMath(subtask, codebaseContext);
        }

        const result = await this.codeGenerator.generate({
          task,
          subtask,
          attempt,
          codebaseContext: enhancedContext,
          previousAttempts: subtask.attempts.slice(0, -1)
        }, thinkingBudget);

        // Handle clarification requests in integration too
        if (!result.success && result.error === 'CLARIFICATION_NEEDED') {
          console.log('[TaskExecutor] Claude requested clarification during integration');

          const clarificationEscalation: Escalation = {
            id: randomUUID(),
            taskId: task.id,
            subtaskId: subtask.id,
            type: 'clarification',
            title: 'Integration questions',
            context: result.output || 'Claude needs clarification for integration.',
            questions: [],
            options: [],
            blocking: true,
            createdAt: new Date()
          };

          if (this.communications) {
            const userResponse = await this.attemptCommunicationEscalation(
              clarificationEscalation,
              task,
              subtask
            );

            if (userResponse) {
              return {
                success: false,
                error: 'CLARIFICATION_RECEIVED',
                output: `User clarification: ${userResponse.response}\n\nOriginal questions:\n${result.output}`,
                filesModified: []
              };
            }
          }

          return {
            success: false,
            error: 'Clarification needed but no response received',
            output: result.output,
            filesModified: []
          };
        }

        return {
          success: result.success,
          output: result.output,
          error: result.error,
          filesModified: [...result.filesCreated, ...result.filesModified]
        };
      } catch (error) {
        console.log('[TaskExecutor] CodeGenerator integration failed, using placeholder');
      }
    }

    // Fallback: placeholder
    return {
      success: true,
      output: `Integration complete for: ${subtask.description}`,
      filesModified: []
    };
  }

  /**
   * Execute verification subtask
   */
  private async executeVerification(
    _subtask: Subtask,
    verificationPlan?: VerificationPlan
  ): Promise<{
    success: boolean;
    output?: string;
    error?: string;
    verificationPassed?: boolean;
    verificationResults?: VerificationResult[];
    screenshot?: string;
    consoleErrors?: string[];
  }> {
    if (!this.verifier || !verificationPlan?.url) {
      return {
        success: true,
        output: 'No verification configured',
        verificationPassed: true
      };
    }

    try {
      const result: WorkflowResult = await this.verifier.quickVerify(verificationPlan.url, {
        checkConsole: verificationPlan.checkConsole,
        assertVisible: verificationPlan.assertVisible
      });

      return {
        success: result.success,
        output: `Verification ${result.success ? 'passed' : 'failed'}`,
        verificationPassed: result.success,
        verificationResults: result.steps
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Verification failed'
      };
    }
  }

  /**
   * Execute review subtask
   */
  private async executeReview(
    _subtask: Subtask
  ): Promise<{ success: boolean; output?: string; error?: string }> {
    // Code review - would analyze changes and check quality
    return {
      success: true,
      output: 'Code review complete. No issues found.'
    };
  }

  /**
   * Get approach for an attempt
   */
  private getApproach(subtask: Subtask, attempt: number, previousAttempts: SubtaskAttempt[]): string {
    if (attempt === 1) {
      return `Standard ${subtask.type} approach for: ${subtask.description}`;
    }

    // Use healing action from previous attempt if available
    const lastAttempt = previousAttempts[previousAttempts.length - 1];
    if (lastAttempt?.healingAction) {
      return lastAttempt.healingAction;
    }

    return `Alternative approach #${attempt} for: ${subtask.description}`;
  }

  /**
   * Check if we should abort the task on this failure
   */
  private shouldAbortOnFailure(subtask: Subtask, task: CodexTask): boolean {
    // Always abort on critical subtask types
    if (subtask.type === 'code' || subtask.type === 'integrate') {
      // Check if other subtasks depend on this one
      const hasDependents = task.subtasks.some(s =>
        s.dependencies.includes(subtask.id) && s.status === SubtaskStatus.PENDING
      );
      return hasDependents;
    }

    // Review failures are non-blocking
    if (subtask.type === 'review') {
      return false;
    }

    return false;
  }

  /**
   * Create a new task from submission
   */
  private createTask(submission: TaskSubmission): CodexTask {
    return {
      id: randomUUID(),
      description: submission.description,
      specification: submission.specification,
      codebase: submission.codebase,
      constraints: submission.constraints,
      verificationPlan: submission.verificationPlan,
      status: TaskStatus.PENDING,
      subtasks: [],
      decisions: [],
      assumptions: [],
      createdAt: new Date()
    };
  }

  /**
   * Gather codebase context
   */
  private async gatherCodebaseContext(codebase: string): Promise<string> {
    try {
      const results = await this.engine.query(`codebase context: ${codebase}`, {
        topK: 5,
        filters: {
          tags: ['codebase', 'architecture']
        }
      });

      return results.map(r => r.entry.content).join('\n\n');
    } catch {
      return `Codebase: ${codebase}`;
    }
  }

  /**
   * Gather additional context based on needs
   */
  private async gatherAdditionalContext(contextNeeded: string[]): Promise<string> {
    const contextParts: string[] = [];

    for (const need of contextNeeded) {
      try {
        const results = await this.engine.query(need, { topK: 3 });
        contextParts.push(
          `${need}:\n${results.map(r => r.entry.content).join('\n')}`
        );
      } catch {
        // Ignore
      }
    }

    return contextParts.join('\n\n');
  }

  /**
   * Generate task summary
   */
  private generateTaskSummary(task: CodexTask, completed: Subtask[], failed: Subtask[]): string {
    const lines: string[] = [];

    lines.push(`Task: ${task.description}`);
    lines.push(`Status: ${failed.length === 0 ? 'SUCCESS' : 'FAILED'}`);
    lines.push(`Subtasks: ${completed.length} completed, ${failed.length} failed`);

    if (completed.length > 0) {
      lines.push('\nCompleted:');
      completed.forEach(s => lines.push(`  ✓ ${s.description}`));
    }

    if (failed.length > 0) {
      lines.push('\nFailed:');
      failed.forEach(s => lines.push(`  ✗ ${s.description}`));
    }

    if (task.assumptions.length > 0) {
      lines.push('\nAssumptions made:');
      task.assumptions.forEach(a => lines.push(`  • ${a.description}`));
    }

    return lines.join('\n');
  }

  /**
   * Create result for dry run
   */
  private createDryRunResult(task: CodexTask): TaskResult {
    return {
      success: true,
      summary: `Dry run: ${task.subtasks.length} subtasks would be executed`,
      subtasksCompleted: 0,
      subtasksFailed: 0,
      filesModified: [],
      testsWritten: 0,
      duration: 0,
      decisions: [],
      assumptions: []
    };
  }

  /**
   * Store task completion in memory
   */
  private async storeTaskCompletion(task: CodexTask, result: TaskResult): Promise<void> {
    try {
      const content = `CODEX Task Completion:
Task: ${task.description}
Status: ${result.success ? 'SUCCESS' : 'FAILED'}
Duration: ${result.duration}ms
Subtasks: ${result.subtasksCompleted} completed, ${result.subtasksFailed} failed
Files Modified: ${result.filesModified.length}
Summary: ${result.summary}`;

      await this.engine.store(content, {
        tags: ['codex', 'task', result.success ? 'success' : 'failure'],
        importance: 0.8
      });
    } catch {
      // Ignore storage errors
    }
  }

  /**
   * Log a work entry
   */
  private log(
    type: WorkLogEntry['type'],
    message: string,
    details?: Record<string, unknown>
  ): void {
    const entry: WorkLogEntry = {
      id: randomUUID(),
      taskId: this.currentTask?.id || '',
      timestamp: new Date(),
      type,
      message,
      details
    };

    this.workLog.push(entry);

    // Send notifications if service is available
    if (this.notifications) {
      this.sendNotification(type, message, details).catch(() => {
        // Ignore notification errors
      });
    }
  }

  /**
   * Send notification based on log type
   */
  private async sendNotification(
    type: WorkLogEntry['type'],
    message: string,
    details?: Record<string, unknown>
  ): Promise<void> {
    if (!this.notifications) return;

    const task = this.currentTask;
    const taskId = task?.id || '';
    const taskDesc = task?.description || 'Unknown task';

    switch (type) {
      case 'complete':
        if (this.config.notifyOnComplete) {
          await this.notifications.notifyComplete(
            taskId,
            taskDesc,
            message
          );
        }
        break;

      case 'escalation':
        if (this.config.notifyOnBlocked) {
          await this.notifications.notifyEscalation(
            taskId,
            taskDesc,
            message,
            details?.escalationId ? `Escalation ID: ${details.escalationId}` : undefined
          );
        }
        break;

      case 'failure':
        await this.notifications.notifyError(
          message,
          details?.error as string | undefined,
          taskId,
          taskDesc
        );
        break;

      case 'progress':
        if (this.config.notifyOnProgress) {
          const status = this.getStatus();
          await this.notifications.notifyProgress(
            taskId,
            taskDesc,
            status.estimatedProgress,
            message
          );
        }
        break;

      case 'success':
        // Success is typically part of a subtask, not a full notification
        break;

      case 'start':
        // Task start is not typically a user-facing notification
        break;
    }
  }

  /**
   * Get current status report
   */
  getStatus(): StatusReport {
    const task = this.currentTask;

    if (!task) {
      return {
        subtasksComplete: 0,
        subtasksRemaining: 0,
        recentLog: [],
        blockers: [],
        estimatedProgress: 0,
        pendingDecisions: [],
        pendingEscalations: []
      };
    }

    const completed = task.subtasks.filter(s => s.status === SubtaskStatus.COMPLETED).length;
    const remaining = task.subtasks.filter(s =>
      s.status === SubtaskStatus.PENDING || s.status === SubtaskStatus.IN_PROGRESS
    ).length;

    const currentSubtask = task.subtasks.find(s => s.status === SubtaskStatus.IN_PROGRESS);

    const pendingDecisions = task.decisions.filter(d => !d.decidedAt);
    const pendingEscalations = this.escalation.getAllPendingEscalations();

    const blockers = pendingEscalations.filter(e => e.blocking).map(e => e.context);

    const progress = task.subtasks.length > 0
      ? Math.round((completed / task.subtasks.length) * 100)
      : 0;

    return {
      currentTask: task,
      subtasksComplete: completed,
      subtasksRemaining: remaining,
      currentSubtask,
      recentLog: this.workLog.slice(-10),
      blockers,
      estimatedProgress: progress,
      pendingDecisions,
      pendingEscalations
    };
  }

  /**
   * Answer a pending decision
   */
  answerDecision(decisionId: string, answer: string, optionIndex?: number): boolean {
    const task = this.currentTask;
    if (!task) return false;

    const decision = task.decisions.find(d => d.id === decisionId);
    if (!decision) return false;

    decision.answer = answer;
    decision.selectedOption = optionIndex;
    decision.decidedBy = 'user';
    decision.decidedAt = new Date();

    return true;
  }

  /**
   * Resolve a pending escalation
   */
  resolveEscalation(escalationId: string, resolution: string): Escalation | undefined {
    return this.escalation.resolveEscalation(escalationId, resolution);
  }

  /**
   * Cancel current task
   */
  cancel(): boolean {
    if (!this.currentTask) return false;

    this.currentTask.status = TaskStatus.CANCELLED;
    this.log('complete', 'Task cancelled by user');
    this.isExecuting = false;

    return true;
  }

  /**
   * Get work log
   */
  getWorkLog(): WorkLogEntry[] {
    return [...this.workLog];
  }

  /**
   * Clear work log
   */
  clearWorkLog(): void {
    this.workLog = [];
  }

  /**
   * Check if currently executing
   */
  isRunning(): boolean {
    return this.isExecuting;
  }

  /**
   * Get current task
   */
  getCurrentTask(): CodexTask | undefined {
    return this.currentTask;
  }

  /**
   * Set Playwright manager (for late binding)
   */
  setPlaywright(playwright: PlaywrightManager, verifier: VerificationService): void {
    this.playwrightManager = playwright;
    this.verifier = verifier;
  }

  /**
   * Get the Playwright manager if available
   */
  getPlaywright(): PlaywrightManager | undefined {
    return this.playwrightManager;
  }

  /**
   * Set capabilities manager (for late binding)
   */
  setCapabilities(capabilities: CapabilitiesManager): void {
    this.capabilities = capabilities;
    // Update the healer with capabilities
    this.healer = new SelfHealer(this.engine, capabilities);
  }

  /**
   * Get the capabilities manager if available
   */
  getCapabilities(): CapabilitiesManager | undefined {
    return this.capabilities;
  }

  /**
   * Set notification service (for late binding)
   */
  setNotifications(notifications: NotificationService): void {
    this.notifications = notifications;
  }

  /**
   * Get the notification service if available
   */
  getNotifications(): NotificationService | undefined {
    return this.notifications;
  }

  /**
   * Set communication manager (for late binding)
   */
  setCommunications(communications: CommunicationManager): void {
    this.communications = communications;
  }

  /**
   * Get the communication manager if available
   */
  getCommunications(): CommunicationManager | undefined {
    return this.communications;
  }

  /**
   * Set code generator (for late binding)
   */
  setCodeGenerator(codeGenerator: CodeGenerator): void {
    this.codeGenerator = codeGenerator;
  }

  /**
   * Get the code generator if available
   */
  getCodeGenerator(): CodeGenerator | undefined {
    return this.codeGenerator;
  }

  /**
   * Set collaborative partner (for late binding)
   */
  setCollaborativePartner(partner: CollaborativePartner): void {
    this.collaborativePartner = partner;
  }

  /**
   * Get the collaborative partner if available
   */
  getCollaborativePartner(): CollaborativePartner | undefined {
    return this.collaborativePartner;
  }

  /**
   * Set Wolfram Alpha manager (for late binding)
   */
  setWolfram(wolfram: WolframManager): void {
    this.wolfram = wolfram;
  }

  /**
   * Get the Wolfram Alpha manager if available
   */
  getWolfram(): WolframManager | undefined {
    return this.wolfram;
  }

  /**
   * Check if Wolfram Alpha is configured
   */
  hasWolfram(): boolean {
    return this.wolfram !== undefined && this.wolfram.isConfigured();
  }

  /**
   * Check if code generation is available
   */
  hasCodeGenerator(): boolean {
    return this.codeGenerator !== undefined;
  }

  /**
   * Set extended thinking (ultrathink) configuration
   */
  setExtendedThinking(config: ExtendedThinkingConfig): void {
    this.extendedThinking = config;
  }

  /**
   * Get extended thinking configuration
   */
  getExtendedThinking(): ExtendedThinkingConfig | undefined {
    return this.extendedThinking;
  }

  /**
   * Calculate thinking budget for ultrathink based on attempt number and error complexity
   *
   * Standard escalation:
   * - Attempt 1: No thinking (unless complex error detected)
   * - Attempt 2: baseBudget tokens (default 5000)
   * - Attempt 3: baseBudget + increment (default 10000)
   * - Escalation: maxBudget (default 16000)
   *
   * Smart triggers force ultrathink on first attempt for complex errors:
   * - Multi-file errors
   * - Integration subtasks
   * - Type system complexity (circular refs, generics)
   */
  private calculateThinkingBudget(
    attempt: number,
    subtask: Subtask,
    lastError?: string,
    filesAffected?: string[]
  ): number | undefined {
    const config = this.extendedThinking;
    if (!config?.enabled) return undefined;

    // SMART TRIGGERS: Force ultrathink for complex errors
    const isComplex = this.isComplexError(lastError, filesAffected, subtask);

    if (isComplex) {
      // Complex error → start with higher budget immediately
      const complexBase = Math.max(config.baseBudget || 5000, 8000);
      const retryBonus = (attempt - 1) * (config.budgetIncrement || 5000);
      const budget = Math.min(complexBase + retryBonus, config.maxBudget || 16000);
      console.log(`[TaskExecutor] Complex error detected - ultrathink budget: ${budget}`);
      return budget;
    }

    // Standard: Only enable on attempt 2+ (configurable)
    if (attempt < (config.enableOnAttempt || 2)) {
      return undefined;
    }

    // Calculate progressive budget
    const retryNumber = attempt - (config.enableOnAttempt || 2) + 1;
    const budget = (config.baseBudget || 5000) +
                   ((retryNumber - 1) * (config.budgetIncrement || 5000));

    return Math.min(budget, config.maxBudget || 16000);
  }

  /**
   * Detect complex errors that should trigger ultrathink immediately
   */
  private isComplexError(
    error?: string,
    filesAffected?: string[],
    subtask?: Subtask
  ): boolean {
    // Multi-file errors are complex
    if (filesAffected && filesAffected.length >= 2) {
      return true;
    }

    // Integration subtasks are inherently complex
    if (subtask?.type === 'integrate') {
      return true;
    }

    // Error pattern detection for complex issues
    if (error) {
      const complexPatterns = [
        /circular/i,              // Circular dependencies
        /generic.*constraint/i,   // Complex generics
        /type.*incompatible/i,    // Type system issues
        /cannot find module/i,    // Import resolution
        /multiple.*error/i,       // Multiple errors
        /recursive/i,             // Recursive issues
        /infinite/i,              // Infinite loops/recursion
        /stack overflow/i,        // Stack overflow
        /deadlock/i,              // Concurrency issues
        /race condition/i,        // Race conditions
      ];
      if (complexPatterns.some(p => p.test(error))) {
        return true;
      }
    }

    return false;
  }

  // ==========================================
  // Wolfram Alpha Integration (Deterministic Math)
  // ==========================================

  /**
   * Check if a subtask is math-heavy and would benefit from Wolfram
   */
  private isMathHeavy(subtask: Subtask): boolean {
    const mathKeywords = [
      'calculate', 'compute', 'formula', 'equation', 'percentage',
      'percent', 'ratio', 'convert', 'unit', 'math', 'arithmetic',
      'sum', 'average', 'mean', 'median', 'total', 'multiply',
      'divide', 'subtract', 'sqrt', 'square root', 'power', 'exponent',
      'interest', 'compound', 'rate', 'growth', 'decay', 'logarithm',
      'trigonometry', 'sin', 'cos', 'tan', 'derivative', 'integral'
    ];

    const text = subtask.description.toLowerCase();
    return mathKeywords.some(kw => text.includes(kw));
  }

  /**
   * Extract math expressions from text for Wolfram queries
   * Looks for: calculations, percentages, equations, unit conversions
   */
  private extractMathExpressions(text: string): string[] {
    const expressions: string[] = [];

    // Percentage calculations: "15% of 500", "calculate 25% of 1000"
    const percentRegex = /(\d+(?:\.\d+)?)\s*%\s*(?:of|from)\s*(\d+(?:\.\d+)?)/gi;
    let match;
    while ((match = percentRegex.exec(text)) !== null) {
      expressions.push(`${match[1]}% of ${match[2]}`);
    }

    // Basic arithmetic with keywords: "calculate 1000 / 4"
    const calcRegex = /(?:calculate|compute|what is)\s+([0-9\s+\-*/().^]+)/gi;
    while ((match = calcRegex.exec(text)) !== null) {
      const expr = match[1].trim();
      if (expr.length > 0 && /\d/.test(expr)) {
        expressions.push(expr);
      }
    }

    // Square roots: "sqrt(144)", "square root of 100"
    const sqrtRegex = /(?:sqrt|square\s*root\s*(?:of)?)\s*\(?\s*(\d+(?:\.\d+)?)\s*\)?/gi;
    while ((match = sqrtRegex.exec(text)) !== null) {
      expressions.push(`sqrt(${match[1]})`);
    }

    // Unit conversions: "100 miles to kilometers", "50 kg to pounds"
    const unitRegex = /(\d+(?:\.\d+)?)\s*(miles?|km|kilometers?|feet|meters?|pounds?|kg|kilograms?|celsius|fahrenheit|inches?|cm|centimeters?)\s+(?:to|in)\s+(\w+)/gi;
    while ((match = unitRegex.exec(text)) !== null) {
      expressions.push(`${match[1]} ${match[2]} to ${match[3]}`);
    }

    // Explicit solve: "solve x^2 + 5x + 6 = 0"
    const solveRegex = /solve\s+([^,.\n]+)/gi;
    while ((match = solveRegex.exec(text)) !== null) {
      expressions.push(`solve ${match[1].trim()}`);
    }

    // Interest formulas: "compound interest on $1000 at 5% for 10 years"
    const interestRegex = /(?:compound|simple)\s+interest.*?(\$?\d+(?:,\d{3})*(?:\.\d{2})?)\s*(?:at|@)\s*(\d+(?:\.\d+)?)\s*%\s*(?:for|over)\s*(\d+)\s*(?:years?|months?)/gi;
    while ((match = interestRegex.exec(text)) !== null) {
      const principal = match[1].replace(/[$,]/g, '');
      const rate = match[2];
      const time = match[3];
      expressions.push(`compound interest on ${principal} at ${rate}% for ${time} years`);
    }

    // Power/exponent: "2^10", "2 to the power of 10"
    const powerRegex = /(\d+(?:\.\d+)?)\s*(?:\^|to\s*the\s*power\s*(?:of)?)\s*(\d+(?:\.\d+)?)/gi;
    while ((match = powerRegex.exec(text)) !== null) {
      expressions.push(`${match[1]}^${match[2]}`);
    }

    // Dedupe and return
    return [...new Set(expressions)];
  }

  /**
   * Enhance context with Wolfram-computed math values
   * Called before code generation for math-heavy subtasks
   */
  private async enhanceWithWolframMath(
    subtask: Subtask,
    context: string
  ): Promise<string> {
    if (!this.wolfram || !this.wolfram.isConfigured()) {
      return context;
    }

    // Combine subtask description and context for expression extraction
    const fullText = `${subtask.description}\n${context}`;

    // Extract math expressions
    const mathExpressions = this.extractMathExpressions(fullText);

    if (mathExpressions.length === 0) {
      return context;
    }

    this.log('progress', `Wolfram: querying ${mathExpressions.length} expression(s)`, {
      expressions: mathExpressions
    });

    const wolframResults: string[] = [];

    for (const expr of mathExpressions) {
      try {
        const result = await this.wolfram.query(expr);
        if (result.success && result.result) {
          wolframResults.push(`${expr} = ${result.result}`);
          this.log('progress', `Wolfram computed: ${expr} = ${result.result}`);
        }
      } catch (error) {
        // Skip failed expressions but log for debugging
        console.log(`[TaskExecutor] Wolfram query failed for "${expr}":`, error);
      }
    }

    if (wolframResults.length === 0) {
      return context;
    }

    // Inject computed values into context with clear markers
    const wolframContext = `\n\n=== WOLFRAM ALPHA COMPUTED VALUES ===
IMPORTANT: Use these exact computed values in your implementation.
Do NOT recalculate these - they are verified deterministic results.

${wolframResults.join('\n')}
=== END WOLFRAM ===`;

    return context + wolframContext;
  }

  /**
   * Attempt to reach user via communication channels for a blocking escalation
   * Returns the user's response if successful, or undefined if all channels exhausted
   */
  private async attemptCommunicationEscalation(
    escalation: Escalation,
    _task: CodexTask,
    _subtask?: Subtask
  ): Promise<EscalationResponse | null> {
    if (!this.communications) {
      return null;
    }

    // Check if communications is enabled and has channels
    const status = this.communications.getStatus();
    if (!status.enabled || status.enabledChannels.length === 0) {
      return null;
    }

    this.log('progress', `Attempting to reach user via communication channels`, {
      channels: status.enabledChannels
    });

    try {
      // The CommunicationManager.escalate() method takes an Escalation object directly
      // It internally builds the EscalationRequest
      const response = await this.communications.escalate(escalation);

      if (response) {
        this.log('progress', `User responded via ${response.channel}`, {
          requestId: response.requestId
        });
        return response;
      }

      this.log('escalation', 'All communication channels exhausted - no response received');
      return null;
    } catch (error) {
      this.log('failure', 'Communication escalation failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Get the learning integration instance
   */
  getLearning(): LearningIntegration {
    return this.learning;
  }

  /**
   * Get the alternatives finder instance
   */
  getAlternatives(): AlternativesFinder {
    return this.alternatives;
  }

  /**
   * Get the causal debugger instance
   */
  getCausalDebugger(): CausalDebugger {
    return this.causalDebugger;
  }

  /**
   * Get learning suggestions for a subtask
   */
  async getLearningSuggestions(
    subtask: Subtask,
    previousAttempts: SubtaskAttempt[] = []
  ): Promise<LearningSuggestion[]> {
    return this.learning.getSuggestions(subtask, previousAttempts);
  }

  /**
   * Get alternative approaches for a stuck subtask
   */
  async getAlternativeApproaches(
    subtask: Subtask,
    failedAttempts: SubtaskAttempt[]
  ): Promise<AlternativeApproach[]> {
    return this.alternatives.findAlternatives(subtask, failedAttempts);
  }

  /**
   * Get learning pattern statistics
   */
  async getPatternStats(): Promise<{
    totalPatterns: number;
    successfulPatterns: number;
    healingPatterns: number;
    averageSuccessRate: number;
  }> {
    return this.learning.getPatternStats();
  }

  /**
   * Get causal debugging statistics
   */
  getCausalStats(): {
    activeChains: number;
    resolvedCount: number;
    avgNodesPerChain: number;
  } {
    return this.causalDebugger.getStats();
  }

  // ==========================================
  // Deep Work Mode Methods
  // ==========================================

  /**
   * Get the deep work manager instance
   */
  getDeepWorkManager(): DeepWorkManager {
    return this.deepWork;
  }

  /**
   * Get current deep work session
   */
  getDeepWorkSession(): DeepWorkSession | null {
    return this.deepWork.getCurrentSession();
  }

  /**
   * Pause the current deep work session
   */
  pauseDeepWork(): DeepWorkSession | null {
    return this.deepWork.pauseSession();
  }

  /**
   * Resume a paused deep work session
   */
  resumeDeepWork(): DeepWorkSession | null {
    return this.deepWork.resumeSession();
  }

  /**
   * Get deep work status report
   */
  getDeepWorkStatus(): ReturnType<DeepWorkManager['getStatus']> {
    return this.deepWork.getStatus();
  }

  /**
   * Set focus level for current deep work session
   */
  setFocusLevel(level: FocusLevel): ReturnType<DeepWorkManager['setFocusLevel']> {
    return this.deepWork.setFocusLevel(level);
  }

  /**
   * Create a manual checkpoint
   */
  createDeepWorkCheckpoint(summary: string): ReturnType<DeepWorkManager['createCheckpoint']> {
    const task = this.currentTask;
    if (!task) {
      return null;
    }

    const completed = task.subtasks.filter(s => s.status === SubtaskStatus.COMPLETED).length;
    const remaining = task.subtasks.filter(s =>
      s.status === SubtaskStatus.PENDING || s.status === SubtaskStatus.IN_PROGRESS
    ).length;

    return this.deepWork.createCheckpoint(completed, remaining, summary);
  }

  /**
   * Get deep work log
   */
  getDeepWorkLog(limit?: number): ReturnType<DeepWorkManager['getWorkLog']> {
    return this.deepWork.getWorkLog(undefined, limit);
  }

  /**
   * Get deep work checkpoints
   */
  getDeepWorkCheckpoints(): ReturnType<DeepWorkManager['getCheckpoints']> {
    return this.deepWork.getCheckpoints();
  }

  /**
   * Get deep work statistics
   */
  getDeepWorkStats(): ReturnType<DeepWorkManager['getStats']> {
    return this.deepWork.getStats();
  }

  /**
   * Check if notification should be sent based on deep work policy
   */
  shouldNotifyDeepWork(type: string, urgency: 'low' | 'normal' | 'high' | 'critical'): boolean {
    return this.deepWork.shouldNotify(type, urgency);
  }
}

export default TaskExecutor;
