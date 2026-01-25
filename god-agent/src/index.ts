/**
 * God Agent - Core Memory System
 *
 * A neuro-symbolic cognitive architecture for multi-agent orchestration.
 * Implements provenance-tracked memory with L-Score validation,
 * hypergraph-based causal reasoning, and semantic search.
 */

// Core exports
export { MemoryEngine } from './core/MemoryEngine.js';
export { getDefaultConfig, validateConfig, mergeConfig } from './core/config.js';
export {
  ProvenanceThresholdError,
  PatternPruneError,
  LearningDriftError
} from './core/errors.js';

// Security: Output sanitization
export {
  OutputSanitizer,
  getSanitizer,
  sanitize,
  sanitizeError
} from './core/OutputSanitizer.js';
export type { SanitizationPattern } from './core/OutputSanitizer.js';

// Export enums as values (not just types)
export { MemorySource, CausalRelationType } from './core/types.js';

// Export interfaces as types
export type {
  MemoryEntry,
  MemoryMetadata,
  ProvenanceInfo,
  QueryOptions,
  QueryFilters,
  QueryResult,
  CausalRelation,
  PatternTemplate,
  PatternSlot,
  PatternMatch,
  MemoryEngineConfig,
  HNSWConfig,
  EmbeddingConfig,
  StorageConfig,
  LScoreConfig,
  StoreOptions,
  MemoryStats
} from './core/types.js';

// Storage exports
export { SQLiteStorage } from './storage/SQLiteStorage.js';

// Vector exports
export { VectorDB } from './vector/VectorDB.js';
export { EmbeddingService } from './vector/EmbeddingService.js';
export type {
  VectorEntry,
  VectorSearchResult,
  VectorDBConfig,
  EmbeddingServiceConfig,
  EmbeddingResult,
  BatchEmbeddingResult
} from './vector/types.js';

// Provenance exports
export { LScoreCalculator } from './provenance/LScoreCalculator.js';
export { ProvenanceStore } from './provenance/ProvenanceStore.js';
export type {
  LineageNode,
  ProvenanceChain,
  LScoreParams,
  ProvenanceStoreConfig,
  LineageTraceResult
} from './provenance/types.js';

// Causal exports
export { CausalMemory } from './causal/CausalMemory.js';
export { Hypergraph } from './causal/Hypergraph.js';
export type {
  HyperedgeData,
  CausalNode,
  CausalPath,
  CausalQuery,
  CausalTraversalResult,
  CausalGraphStats,
  CausalExportFormat
} from './causal/types.js';

// Pattern exports
export { PatternMatcher } from './pattern/PatternMatcher.js';
export type {
  PatternMatcherConfig,
  SlotValidationResult,
  PatternStats,
  PruneResult
} from './pattern/types.js';

// Adversarial exports
export { ShadowSearch } from './adversarial/ShadowSearch.js';
export type {
  Contradiction,
  ContradictionType,
  ShadowSearchOptions,
  ShadowSearchResult,
  ShadowSearchConfig
} from './adversarial/types.js';

// Learning exports (Sona)
export { SonaEngine } from './learning/SonaEngine.js';
export { TrajectoryStore } from './learning/TrajectoryStore.js';
export { WeightManager } from './learning/WeightManager.js';
export { EWCRegularizer } from './learning/EWCRegularizer.js';
export type {
  Trajectory,
  TrajectoryFeedback,
  PatternWeight,
  SonaConfig,
  FeedbackResult,
  DriftMetrics,
  LearningStats,
  TrackedQueryResult,
  WeightCheckpoint
} from './learning/types.js';

// Routing exports (Tiny Dancer)
export { TinyDancer } from './routing/TinyDancer.js';
export { CircuitBreaker } from './routing/CircuitBreaker.js';
export { ReasoningRoute, CircuitState } from './routing/types.js';
export type {
  TinyDancerConfig,
  RoutingDecision,
  QueryContext,
  RoutingStats,
  CircuitBreakerConfig,
  CircuitStatus,
  RoutedQueryResult
} from './routing/types.js';

// Scheduler exports (Phase 9)
export { SchedulerDaemon } from './scheduler/SchedulerDaemon.js';
export { TaskStore } from './scheduler/TaskStore.js';
export { TriggerEvaluator } from './scheduler/TriggerEvaluator.js';
export { ContextBuilder } from './scheduler/ContextBuilder.js';
export { TaskStatus, TriggerType, RunStatus } from './scheduler/types.js';
export type {
  ScheduleTrigger,
  ScheduledTask,
  TaskRun,
  TaskNotification,
  EventEntry,
  SchedulerConfig,
  TaskQueryOptions,
  CreateTaskInput,
  UpdateTaskInput,
  SchedulerStats,
  TaskContext
} from './scheduler/types.js';

// Playwright exports (RUBIX)
export { PlaywrightManager } from './playwright/PlaywrightManager.js';
export { VerificationService } from './playwright/VerificationService.js';
export { ConsoleCapture } from './playwright/ConsoleCapture.js';
export { DEFAULT_BROWSER_CONFIG } from './playwright/types.js';
export type {
  BrowserConfig,
  BrowserSession,
  CapturedConsoleMessage,
  CapturedPageError,
  ScreenshotInfo,
  ActionType,
  ActionParams,
  ActionResult,
  AssertionType,
  AssertionParams,
  AssertionResult,
  VerificationStep,
  VerificationResult,
  ScreenshotParams,
  TestParams,
  ConsoleCheckParams,
  TestRunResult,
  TestFailure,
  NavigationOptions,
  LaunchResult,
  ConsoleSummary
} from './playwright/types.js';

// RUBIX exports (Autonomous Developer)
export { TaskExecutor, type TaskSubmission, type ExecutionOptions } from './codex/TaskExecutor.js';
export { TaskDecomposer } from './codex/TaskDecomposer.js';
export { SelfHealer } from './codex/SelfHealer.js';
export { EscalationGate, type Situation, type SituationType } from './codex/EscalationGate.js';
export { TaskStatus as CodexTaskStatus, SubtaskStatus, DEFAULT_RUBIX_CONFIG } from './codex/types.js';

// Engineer Provider exports (Provider-agnostic code generation)
export {
  ClaudeEngineerProvider,
  OllamaEngineerProvider,
  FallbackEngineerProvider,
  createEngineerProvider
} from './codex/EngineerProvider.js';
export type { EngineerFn, EngineerProvider } from './codex/EngineerProvider.js';
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
} from './codex/types.js';

// RUBIX Intelligence Layer
export {
  LearningIntegration,
  type CodexPatternType,
  type LearnedPattern,
  type PatternFeedback,
  type LearningSuggestion
} from './codex/LearningIntegration.js';

export {
  AlternativesFinder,
  type AlternativeApproach,
  type AlternativesOptions
} from './codex/AlternativesFinder.js';

export {
  CausalDebugger,
  type FailureNode,
  type CausalChain,
  type DebugInsight
} from './codex/CausalDebugger.js';

// Plan Deviation Detection (Strict Mode Design Approval)
export {
  detectPlanDeviations,
  formatDeviationReport,
  type DeviationType,
  type DeviationSeverity,
  type PlanDeviation,
  type DeviationReport
} from './codex/PlanDeviationDetector.js';

// Capabilities exports (Stage 4 - Advanced Coding Capabilities)
export {
  CapabilitiesManager,
  DEFAULT_CAPABILITIES_CONFIG,
  LSPManager,
  GitManager,
  StaticAnalyzer,
  ASTManager,
  DependencyGraphManager,
  REPLManager,
  ProfilerManager,
  StackParser,
  SchemaIntrospector,
  DocMiner
} from './capabilities/index.js';

export type {
  // Configuration
  CapabilitiesConfig,
  LSPConfig,
  GitConfig,
  AnalysisConfig,
  ASTConfig,
  DepsConfig,
  REPLConfig,
  ProfilerConfig,
  StackTraceConfig,
  DatabaseConfig,
  DocsConfig,
  // LSP types
  DefinitionResult,
  ReferencesResult,
  DiagnosticsResult,
  SymbolSearchResult,
  // Git types
  GitBlameResult,
  GitBisectResult,
  GitHistoryEntry,
  GitDiffResult,
  GitBranchInfo,
  // AST types
  ASTNode,
  ASTParseResult,
  ASTQueryResult,
  RefactorOperation,
  RefactorResult,
  // Analysis types
  LintResult,
  TypeCheckResult,
  AnalysisSummary,
  // Dependency types
  DependencyNode,
  DependencyEdge,
  DependencyGraph as CapabilitiesDependencyGraph,
  ImpactAnalysis,
  // Debug types
  DebugSession,
  Breakpoint,
  VariableInspection,
  StackFrame,
  EvalResult,
  // Profiler types
  ProfileResult,
  ProfileFunction,
  ProfileNode,
  HotspotResult,
  // Stack trace types
  ParsedStackFrame,
  ParsedStackTrace,
  StackContext,
  // Database types
  DatabaseSchema,
  TableSchema,
  ColumnSchema,
  IndexSchema,
  ViewSchema,
  RelationshipSchema,
  GeneratedTypes,
  // Doc types
  DocFetchResult,
  DocSection,
  DocSearchResult,
  // Composite types
  ErrorAnalysis,
  RefactorPlan,
  PerformanceReport,
  // Status types
  CapabilityStatus,
  CapabilitiesStatus
} from './capabilities/index.js';

// Configuration exports (Stage 9 - Polish & Configuration)
export {
  ConfigurationManager,
  ConfigLoader,
  DEFAULT_CODEX_CONFIGURATION
} from './config/index.js';

export type {
  CodexConfiguration,
  PartialCodexConfiguration,
  EscalationConfig,
  WorkModeConfig,
  PlaywrightConfig,
  ReviewConfig as CodexReviewConfig,
  NotificationsConfig,
  MemoryConfig,
  SlackConfig,
  DiscordConfig,
  ConfigValidationResult,
  ConfigValidationError,
  ConfigValidationWarning,
  ConfigChangeEvent,
  ConfigWatchCallback
} from './config/index.js';

// Failure Learning exports (Stage 7 - Failure Learning)
export {
  FailureMemoryService,
  type FailureMemoryServiceConfig
} from './failure/index.js';

export type {
  FailureMemory,
  FailurePattern,
  FailureQueryResult,
  FailureCausalLink,
  FailureStats,
  RecordFailureInput,
  QueryFailuresInput,
  RecordResolutionInput,
  FeedbackQuality
} from './failure/index.js';

// Reflexion exports (Verbal Reflexion System)
export {
  ReflexionService,
  DEFAULT_REFLEXION_CONFIG
} from './reflexion/index.js';

export type {
  Reflection,
  ReflectionQuery,
  ReflectionQueryResult,
  ReflectionContext,
  FailureInput,
  ReflexionStats,
  ReflexionConfig,
  RootCauseCategory,
  AttemptSummary
} from './reflexion/index.js';

// Discovery exports (Agent Cards)
export {
  AgentCardGenerator
} from './discovery/index.js';

export type {
  AgentCard,
  Capability,
  CapabilityCategory,
  JSONSchema,
  EstimatedTokens,
  CapabilityExample,
  Endpoint,
  AuthMethod,
  Constraint,
  CostModel,
  Cost,
  TokenCosts,
  CostTier,
  AgentProvider,
  AgentMetadata,
  ModelInfo,
  ValidationResult,
  ValidationError,
  ValidationWarning,
  MCPTool,
  GeneratorOptions
} from './discovery/index.js';

// Guardian exports (Post-Execution Guardian)
export {
  PostExecGuardian,
  DEFAULT_GUARDIAN_CONFIG
} from './guardian/index.js';

export type {
  AuditResult,
  AuditIssue,
  AuditSeverity,
  AuditCategory,
  AuditSummary,
  AuditPhase,
  AuditContext,
  RollbackResult,
  RollbackMethod,
  PreWriteSnapshot,
  SnapshotFile,
  GuardianConfig,
  GuardianStats,
  SecurityPattern
} from './guardian/index.js';

// Memory Distillation exports (Proactive Lesson Extraction)
export {
  MemoryDistillationService,
  DEFAULT_DISTILLATION_CONFIG
} from './distillation/index.js';

export type {
  DistillationConfig,
  DistilledInsight,
  DistillationResult,
  DistillationStats,
  DistillationType,
  InsightQuery,
  InsightQueryResult,
  MemoryInput,
  MemoryCluster,
  FailureFixChain,
  DistillationRun,
  ManualDistillationOptions
} from './distillation/index.js';
