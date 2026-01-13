/**
 * RUBIX - Autonomous Developer Agent
 *
 * "Give it a task. It does the work. Bothers you only when necessary."
 *
 * Core Components:
 * - TaskExecutor: Main execution loop orchestrating everything
 * - TaskDecomposer: Breaks tasks into executable subtasks
 * - SelfHealer: Analyzes failures and suggests alternatives
 * - EscalationGate: Decides when to ask the human
 */

// Main executor
export { TaskExecutor, type TaskSubmission, type ExecutionOptions } from './TaskExecutor.js';

// Code generation
export { CodeGenerator, type CodeGenRequest, type CodeGenResult, type CodeGeneratorConfig } from './CodeGenerator.js';

// Claude Code CLI executor (for Max subscription integration)
export { ClaudeCodeExecutor, type ClaudeCodeResult, type ClaudeCodeExecutorConfig } from './ClaudeCodeExecutor.js';

// Task decomposition
export { TaskDecomposer } from './TaskDecomposer.js';

// Self-healing
export { SelfHealer } from './SelfHealer.js';

// Working Memory (Active memory engagement during task execution)
export {
  WorkingMemoryManager,
  type WorkingMemoryConfig,
  type MemoryResult,
  type ContradictionResult,
  type SessionStats
} from './WorkingMemoryManager.js';

// Escalation
export { EscalationGate, type Situation, type SituationType } from './EscalationGate.js';

// Planning Mode (Memory-backed unlimited planning sessions)
export {
  PlanningSession,
  type PlanningSessionConfig,
  type PlanningStatus,
  type SessionSummary
} from './PlanningSession.js';

export {
  PlanningAgent,
  type PlanningAgentConfig,
  type PlanDocument,
  type PlanComponent,
  type PlanningExchange
} from './PlanningAgent.js';

// Conversation Mode (Lightweight chat before planning)
export {
  ConversationSession,
  type ConversationExchange
} from './ConversationSession.js';

// Intelligence Layer
export {
  LearningIntegration,
  type CodexPatternType,
  type LearnedPattern,
  type PatternFeedback,
  type LearningSuggestion
} from './LearningIntegration.js';

export {
  AlternativesFinder,
  type AlternativeApproach,
  type AlternativesOptions
} from './AlternativesFinder.js';

export {
  CausalDebugger,
  type FailureNode,
  type CausalChain,
  type DebugInsight
} from './CausalDebugger.js';

// Types - Enums
export { TaskStatus, SubtaskStatus } from './types.js';

// Types - Interfaces
export type {
  SubtaskType,
  CodexTask,
  Subtask,
  SubtaskAttempt,
  SubtaskResult,
  TaskResult,
  VerificationPlan,
  Decision,
  DecisionOption,
  Assumption,
  EscalationType,
  Escalation,
  EscalationDecision,
  HealingAnalysis,
  SimilarFailure,
  WorkLogEntry,
  StatusReport,
  CodexConfig,
  DecomposeRequest,
  DecomposeResult,
  Ambiguity,
  DependencyGraph,
  ExecutionContext,
  ExecuteSubtaskRequest,
  ExecuteSubtaskResult
} from './types.js';

// Default config
export { DEFAULT_RUBIX_CONFIG } from './types.js';
