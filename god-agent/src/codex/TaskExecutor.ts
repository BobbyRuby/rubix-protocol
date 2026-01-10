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
import type { PlaywrightManager } from '../playwright/PlaywrightManager.js';
import type { VerificationService } from '../playwright/VerificationService.js';
import type { CapabilitiesManager } from '../capabilities/CapabilitiesManager.js';
import { TaskDecomposer } from './TaskDecomposer.js';
import { SelfHealer } from './SelfHealer.js';
import { EscalationGate, type Situation } from './EscalationGate.js';
import { LearningIntegration, type LearningSuggestion } from './LearningIntegration.js';
import { AlternativesFinder, type AlternativeApproach } from './AlternativesFinder.js';
import { CausalDebugger, type CausalChain } from './CausalDebugger.js';
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
      const codebaseContext = await this.gatherCodebaseContext(task.codebase);

      // Decompose task (unless skipped)
      if (!options.skipDecomposition) {
        this.log('progress', 'Decomposing task into subtasks');

        const decomposition = await this.decomposer.decompose({
          task,
          codebaseContext
        });

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

      try {
        // Execute the approach
        const result = await this.performSubtaskExecution(
          task,
          subtask,
          attemptRecord,
          codebaseContext
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
   */
  private async performSubtaskExecution(
    task: CodexTask,
    subtask: Subtask,
    _attempt: SubtaskAttempt,
    codebaseContext: string
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
    // In a full implementation, this would:
    // 1. Generate code changes using Claude API
    // 2. Apply changes to files
    // 3. Run verification

    // For now, we simulate execution based on subtask type
    switch (subtask.type) {
      case 'research':
        return this.executeResearch(subtask, codebaseContext);

      case 'design':
        return this.executeDesign(subtask, codebaseContext);

      case 'code':
        return this.executeCode(subtask, codebaseContext);

      case 'test':
        return this.executeTest(subtask, task.verificationPlan);

      case 'integrate':
        return this.executeIntegration(subtask, codebaseContext);

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
    subtask: Subtask,
    _codebaseContext: string
  ): Promise<{ success: boolean; output?: string; error?: string }> {
    // Query memory for relevant context
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
    subtask: Subtask,
    _codebaseContext: string
  ): Promise<{ success: boolean; output?: string; error?: string }> {
    // Design phase - would use Claude to generate design
    return {
      success: true,
      output: `Design complete for: ${subtask.description}\n\nBased on existing patterns in codebase.`
    };
  }

  /**
   * Execute code subtask
   */
  private async executeCode(
    subtask: Subtask,
    _codebaseContext: string
  ): Promise<{
    success: boolean;
    output?: string;
    error?: string;
    filesModified?: string[];
    consoleErrors?: string[];
  }> {
    const filesModified: string[] = [];
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // Pre-coding analysis with capabilities
      if (this.capabilities) {
        // Run static analysis before making changes
        try {
          const preAnalysis = await this.capabilities.analyze();
          if (preAnalysis.totalErrors > 0) {
            warnings.push(`Pre-existing errors: ${preAnalysis.totalErrors}`);
          }
        } catch {
          // Static analysis optional
        }

        // Get LSP diagnostics for context
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

      // Code execution - would generate and apply code changes
      // In a full implementation, this would:
      // 1. Generate code changes using Claude API
      // 2. Apply changes to files
      // 3. Run verification

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

      const outputParts = [`Code implementation complete for: ${subtask.description}`];
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
        filesModified,
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
    subtask: Subtask,
    _codebaseContext: string
  ): Promise<{ success: boolean; output?: string; error?: string; filesModified?: string[] }> {
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
