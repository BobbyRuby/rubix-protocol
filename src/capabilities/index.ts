/**
 * Capabilities Module
 *
 * RUBIX Advanced Coding Capabilities - 10 IDE-like tools for code understanding
 * and manipulation.
 *
 * Phase A (Foundation):
 * - LSP Integration: Go-to-definition, find-references, diagnostics
 * - Git Intelligence: Blame, bisect, history analysis
 * - Static Analysis: ESLint + TypeScript compiler
 *
 * Phase B (Understanding):
 * - AST Manipulation: Parse, traverse, refactor
 * - Dependency Graph: Impact analysis
 * - Doc Mining: Fetch library documentation
 *
 * Phase C (Runtime):
 * - REPL/Debug: Live inspection with Node inspector
 * - Profiler: CPU profiling with v8-profiler
 * - Stack Trace Parser: Intelligent error parsing
 *
 * Phase D (External):
 * - Database Introspection: Schema awareness
 */

// Main manager
export { CapabilitiesManager, DEFAULT_CAPABILITIES_CONFIG } from './CapabilitiesManager.js';

// Capability managers
export { LSPManager } from './lsp/LSPManager.js';
export { GitManager } from './git/GitManager.js';
export { StaticAnalyzer } from './analysis/StaticAnalyzer.js';
export { ASTManager } from './ast/ASTManager.js';
export { DependencyGraphManager } from './deps/DependencyGraph.js';
export { REPLManager } from './repl/REPLManager.js';
export { ProfilerManager } from './profiler/ProfilerManager.js';
export { StackParser } from './stacktrace/StackParser.js';
export { SchemaIntrospector } from './database/SchemaIntrospector.js';
export { DocMiner } from './docs/DocMiner.js';
export { WolframManager } from './wolfram/WolframManager.js';

// Shared types
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
  LSPPosition,
  LSPRange,
  LSPLocation,
  LSPDiagnostic,
  LSPSymbol,
  LSPReference,
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
  DependencyGraph,
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
} from './types.js';

// Capability-specific types
export type {
  LSPServerConfig,
  LSPConnectionOptions,
  LSPCapabilities,
  LSPServerStatus
} from './lsp/types.js';

export type {
  GitBisectOptions,
  GitLogOptions,
  GitDiffOptions,
  GitStashEntry
} from './git/types.js';

export type {
  ESLintMessage,
  ESLintResult,
  TypeScriptDiagnostic,
  AnalyzerOptions
} from './analysis/types.js';

export type {
  BabelAST,
  ASTVisitorOptions,
  ASTTransformOptions,
  CodeLocation,
  SymbolInfo,
  RefactorPreview
} from './ast/types.js';

export type {
  ModuleInfo,
  CircularDependency,
  DependencyAnalysisOptions,
  ImpactAnalysisOptions
} from './deps/types.js';

export type {
  InspectorSession,
  BreakpointInfo,
  CallFrame,
  Scope,
  RemoteObject,
  DebuggerPausedEvent,
  StepAction
} from './repl/types.js';

export type {
  CPUProfile,
  ProfileOptions,
  FunctionMetrics
} from './profiler/types.js';

export type {
  RawStackFrame,
  SourceMapInfo,
  MappedLocation,
  StackParseOptions
} from './stacktrace/types.js';

export type {
  DBConnection,
  TableInfo,
  ColumnInfo,
  IndexInfo,
  ForeignKeyInfo,
  TypeGeneratorOptions
} from './database/types.js';

export type {
  CachedDoc,
  DocParseOptions,
  DocSource,
  CodeExample
} from './docs/types.js';

export type {
  WolframConfig,
  WolframResult,
  WolframPod
} from './wolfram/WolframManager.js';
