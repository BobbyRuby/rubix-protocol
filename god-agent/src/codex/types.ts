/**
 * CODEX Types
 *
 * Type definitions for the autonomous developer agent system.
 * Covers tasks, subtasks, execution, escalation, and self-healing.
 */

import type { VerificationStep, VerificationResult } from '../playwright/types.js';

/**
 * Task status
 */
export enum TaskStatus {
  PENDING = 'pending',
  DECOMPOSING = 'decomposing',
  EXECUTING = 'executing',
  BLOCKED = 'blocked',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled'
}

/**
 * Subtask status
 */
export enum SubtaskStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
  SKIPPED = 'skipped'
}

/**
 * Subtask type
 */
export type SubtaskType = 'research' | 'design' | 'code' | 'test' | 'integrate' | 'verify' | 'review';

/**
 * Main CODEX task
 */
export interface CodexTask {
  id: string;
  description: string;
  specification?: string;
  codebase: string;
  constraints?: string[];
  verificationPlan?: VerificationPlan;
  status: TaskStatus;
  subtasks: Subtask[];
  decisions: Decision[];
  assumptions: Assumption[];
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  result?: TaskResult;
}

/**
 * Subtask within a task
 */
export interface Subtask {
  id: string;
  taskId: string;
  type: SubtaskType;
  description: string;
  dependencies: string[];
  verification: VerificationStep[];
  maxAttempts: number;
  attempts: SubtaskAttempt[];
  status: SubtaskStatus;
  order: number;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  result?: SubtaskResult;
}

/**
 * Single attempt at executing a subtask
 */
export interface SubtaskAttempt {
  id: string;
  subtaskId: string;
  attemptNumber: number;
  approach: string;
  startedAt: Date;
  completedAt?: Date;
  success: boolean;
  error?: string;
  consoleErrors?: string[];
  screenshot?: string;
  verificationResults?: VerificationResult[];
  healingAction?: string;
}

/**
 * Result of a completed subtask
 */
export interface SubtaskResult {
  success: boolean;
  output?: string;
  filesModified?: string[];
  testsRun?: number;
  testsPassed?: number;
  verificationPassed?: boolean;
  duration: number;
}

/**
 * Result of a completed task
 */
export interface TaskResult {
  success: boolean;
  summary: string;
  subtasksCompleted: number;
  subtasksFailed: number;
  filesModified: string[];
  testsWritten: number;
  duration: number;
  decisions: Decision[];
  assumptions: Assumption[];
}

/**
 * Verification plan for a task
 */
export interface VerificationPlan {
  url?: string;
  testFiles?: string[];
  assertVisible?: string[];
  checkConsole?: boolean;
  customSteps?: VerificationStep[];
}

/**
 * Decision made during task execution
 */
export interface Decision {
  id: string;
  taskId: string;
  question: string;
  options: DecisionOption[];
  selectedOption?: number;
  answer?: string;
  decidedBy: 'codex' | 'user';
  decidedAt?: Date;
  context?: string;
}

/**
 * Option for a decision
 */
export interface DecisionOption {
  label: string;
  description: string;
  tradeoff?: string;
  recommended?: boolean;
}

/**
 * Assumption made by CODEX
 */
export interface Assumption {
  id: string;
  taskId: string;
  description: string;
  reasoning: string;
  madeAt: Date;
  validated?: boolean;
}

/**
 * Escalation types
 */
export type EscalationType = 'clarification' | 'decision' | 'blocked' | 'approval';

/**
 * Escalation to user
 */
export interface Escalation {
  id: string;
  taskId: string;
  subtaskId?: string;
  type: EscalationType;
  title: string;
  context: string;
  questions?: string[];
  options?: DecisionOption[];
  attemptsSummary?: string;
  errors?: string[];
  blocking: boolean;
  createdAt: Date;
  resolvedAt?: Date;
  resolution?: string;
}

/**
 * Escalation decision result
 */
export interface EscalationDecision {
  shouldEscalate: boolean;
  type?: EscalationType;
  reason?: string;
  canContinueWithAssumption: boolean;
  assumption?: Assumption;
}

/**
 * Self-healing analysis result
 */
export interface HealingAnalysis {
  isFundamentalBlocker: boolean;
  reason?: string;
  newApproach: string;
  needsMoreContext: boolean;
  contextNeeded?: string[];
  suggestedActions: string[];
  similarFailures?: SimilarFailure[];
}

/**
 * Similar failure from memory
 */
export interface SimilarFailure {
  id: string;
  description: string;
  error: string;
  resolution?: string;
  similarity: number;
}

/**
 * Work log entry for deep work mode
 */
export interface WorkLogEntry {
  id: string;
  taskId: string;
  subtaskId?: string;
  timestamp: Date;
  type: 'start' | 'progress' | 'success' | 'failure' | 'decision' | 'escalation' | 'complete' | 'memory';
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Status report for user
 */
export interface StatusReport {
  currentTask?: CodexTask;
  subtasksComplete: number;
  subtasksRemaining: number;
  currentSubtask?: Subtask;
  recentLog: WorkLogEntry[];
  blockers: string[];
  estimatedProgress: number;
  pendingDecisions: Decision[];
  pendingEscalations: Escalation[];
}

/**
 * CODEX configuration
 */
export interface CodexConfig {
  maxAttemptsBeforeEscalate: number;
  batchDecisions: boolean;
  notifyOnProgress: boolean;
  notifyOnComplete: boolean;
  notifyOnBlocked: boolean;
  autonomousDecisions: string[];
  requireApproval: string[];
  verificationTimeout: number;
  selfHealTimeout: number;
}

/**
 * Default CODEX configuration
 */
export const DEFAULT_CODEX_CONFIG: CodexConfig = {
  maxAttemptsBeforeEscalate: 3,
  batchDecisions: true,
  notifyOnProgress: false,
  notifyOnComplete: true,
  notifyOnBlocked: true,
  autonomousDecisions: [
    'dependency_minor_versions',
    'code_formatting',
    'variable_naming',
    'test_structure'
  ],
  requireApproval: [
    'database_schema_changes',
    'api_breaking_changes',
    'new_dependencies',
    'architecture_changes'
  ],
  verificationTimeout: 60000,
  selfHealTimeout: 30000
};

/**
 * Task decomposition request
 */
export interface DecomposeRequest {
  task: CodexTask;
  codebaseContext: string;
  existingPatterns?: string[];
}

/**
 * Task decomposition result
 */
export interface DecomposeResult {
  subtasks: Subtask[];
  estimatedComplexity: 'low' | 'medium' | 'high';
  ambiguities: Ambiguity[];
  dependencies: DependencyGraph;
  /** True if Claude needs clarification before decomposing */
  needsClarification?: boolean;
  /** Claude's clarification questions/text */
  clarificationText?: string;
}

/**
 * Ambiguity in task specification
 */
export interface Ambiguity {
  id: string;
  description: string;
  critical: boolean;
  possibleInterpretations: string[];
  suggestedQuestion?: string;
}

/**
 * Dependency graph for subtasks
 */
export interface DependencyGraph {
  nodes: string[];
  edges: Array<{ from: string; to: string }>;
  executionOrder: string[];
}

/**
 * Execution context for a subtask
 */
export interface ExecutionContext {
  task: CodexTask;
  subtask: Subtask;
  attempt: SubtaskAttempt;
  previousAttempts: SubtaskAttempt[];
  codebaseContext: string;
  memoryContext?: string;
  failurePatterns?: SimilarFailure[];
}

/**
 * Execute subtask request
 */
export interface ExecuteSubtaskRequest {
  context: ExecutionContext;
  approach: string;
  verificationPlan?: VerificationPlan;
}

/**
 * Execute subtask result
 */
export interface ExecuteSubtaskResult {
  success: boolean;
  output?: string;
  error?: string;
  filesModified?: string[];
  verificationResults?: VerificationResult[];
  consoleErrors?: string[];
  screenshot?: string;
  duration: number;
}

// ==========================================
// COLLABORATIVE PARTNER TYPES
// ==========================================

/**
 * Challenge context for escalation
 */
export interface ChallengeContext {
  /** Credibility score from shadow search (0-1) */
  credibility: number;
  /** L-Score of the approach (0-1) */
  lScore: number;
  /** Contradictions found */
  contradictions: Array<{
    content: string;
    refutationStrength: number;
    source: string;
  }>;
  /** Partner's recommendation */
  recommendation: string;
  /** Reasoning for the challenge */
  reasoning: string;
}

/**
 * Knowledge gap for proactive curiosity
 */
export interface KnowledgeGapInfo {
  /** The question to ask */
  question: string;
  /** Whether this blocks execution */
  critical: boolean;
  /** Domain of the gap */
  domain: 'task_novelty' | 'specification' | 'terminology' | 'scope' | 'technology';
  /** Additional context */
  context?: string;
}

/**
 * Partner assessment result
 */
export interface PartnerAssessmentResult {
  /** Whether the partner has concerns */
  shouldChallenge: boolean;
  /** Whether this is a hard gate (requires override) */
  isHardGate: boolean;
  /** Credibility score (0-1) */
  credibility: number;
  /** L-Score (0-1) */
  lScore: number;
  /** Challenge context if challenging */
  challengeContext?: ChallengeContext;
}
