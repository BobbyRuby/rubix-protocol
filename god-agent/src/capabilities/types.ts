/**
 * Capabilities Types
 *
 * Shared types for all CODEX advanced coding capabilities.
 * These give CODEX IDE-like powers for code understanding and manipulation.
 */

// =============================================================================
// Configuration
// =============================================================================

/**
 * Configuration for all capabilities
 */
export interface CapabilitiesConfig {
  /** Project root directory */
  projectRoot: string;
  /** Enable LSP integration */
  lsp?: LSPConfig;
  /** Enable Git intelligence */
  git?: GitConfig;
  /** Enable static analysis */
  analysis?: AnalysisConfig;
  /** Enable AST manipulation */
  ast?: ASTConfig;
  /** Enable dependency graph */
  deps?: DepsConfig;
  /** Enable REPL/debug */
  repl?: REPLConfig;
  /** Enable profiler */
  profiler?: ProfilerConfig;
  /** Enable stack trace parsing */
  stacktrace?: StackTraceConfig;
  /** Enable database introspection */
  database?: DatabaseConfig;
  /** Enable documentation mining */
  docs?: DocsConfig;
}

export interface LSPConfig {
  enabled?: boolean;
  /** Language servers to start (auto-detect by default) */
  servers?: string[];
  /** Timeout for LSP operations in ms */
  timeout?: number;
}

export interface GitConfig {
  enabled?: boolean;
  /** Path to git binary (auto-detect by default) */
  gitPath?: string;
}

export interface AnalysisConfig {
  enabled?: boolean;
  /** Enable ESLint */
  eslint?: boolean;
  /** Enable TypeScript compiler diagnostics */
  typescript?: boolean;
  /** Custom ESLint config path */
  eslintConfig?: string;
}

export interface ASTConfig {
  enabled?: boolean;
  /** Parser plugins to enable */
  plugins?: string[];
}

export interface DepsConfig {
  enabled?: boolean;
  /** Include dev dependencies in analysis */
  includeDevDeps?: boolean;
}

export interface REPLConfig {
  enabled?: boolean;
  /** Node.js inspector port */
  port?: number;
}

export interface ProfilerConfig {
  enabled?: boolean;
  /** Sampling interval in microseconds */
  samplingInterval?: number;
}

export interface StackTraceConfig {
  enabled?: boolean;
  /** Source map directories */
  sourceMaps?: string[];
}

export interface DatabaseConfig {
  enabled?: boolean;
  /** Database connection string */
  connectionString?: string;
  /** Database client (pg, mysql, sqlite3, etc.) */
  client?: string;
}

export interface DocsConfig {
  enabled?: boolean;
  /** Cache directory for fetched docs */
  cacheDir?: string;
  /** Cache TTL in seconds */
  cacheTTL?: number;
}

// =============================================================================
// LSP Types
// =============================================================================

export interface LSPPosition {
  line: number;
  character: number;
}

export interface LSPRange {
  start: LSPPosition;
  end: LSPPosition;
}

export interface LSPLocation {
  uri: string;
  range: LSPRange;
}

export interface LSPDiagnostic {
  range: LSPRange;
  severity: 'error' | 'warning' | 'info' | 'hint';
  code?: string | number;
  source?: string;
  message: string;
  relatedInformation?: Array<{
    location: LSPLocation;
    message: string;
  }>;
}

export interface LSPSymbol {
  name: string;
  kind: string;
  location: LSPLocation;
  containerName?: string;
}

export interface LSPReference {
  uri: string;
  range: LSPRange;
  isDefinition: boolean;
}

export interface DefinitionResult {
  file: string;
  line: number;
  column: number;
  preview?: string;
}

export interface ReferencesResult {
  symbol: string;
  totalCount: number;
  references: Array<{
    file: string;
    line: number;
    column: number;
    preview: string;
    isDefinition: boolean;
  }>;
}

export interface DiagnosticsResult {
  file: string;
  diagnostics: LSPDiagnostic[];
  errorCount: number;
  warningCount: number;
}

export interface SymbolSearchResult {
  symbols: LSPSymbol[];
  totalCount: number;
}

// =============================================================================
// Git Types
// =============================================================================

export interface GitBlameResult {
  file: string;
  lines: Array<{
    lineNumber: number;
    commit: string;
    author: string;
    date: Date;
    content: string;
  }>;
}

export interface GitBisectResult {
  badCommit: string;
  testCommand: string;
  firstBadCommit?: string;
  message?: string;
  author?: string;
  date?: Date;
  status: 'found' | 'not_found' | 'error';
}

export interface GitHistoryEntry {
  commit: string;
  author: string;
  date: Date;
  message: string;
  files: string[];
  insertions: number;
  deletions: number;
}

export interface GitDiffResult {
  file: string;
  hunks: Array<{
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    content: string;
  }>;
  additions: number;
  deletions: number;
}

export interface GitBranchInfo {
  name: string;
  current: boolean;
  commit: string;
  upstream?: string;
  ahead?: number;
  behind?: number;
}

// =============================================================================
// AST Types
// =============================================================================

export interface ASTNode {
  type: string;
  start: number;
  end: number;
  loc: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
  [key: string]: unknown;
}

export interface ASTParseResult {
  file: string;
  ast: ASTNode;
  errors: Array<{
    message: string;
    line: number;
    column: number;
  }>;
}

export interface ASTQueryResult {
  file: string;
  nodeType: string;
  matches: Array<{
    node: ASTNode;
    path: string;
    code: string;
  }>;
}

export interface RefactorOperation {
  type: 'rename' | 'extract' | 'inline' | 'move';
  target: string;
  newValue?: string;
  scope?: string;
}

export interface RefactorResult {
  operation: RefactorOperation;
  changes: Array<{
    file: string;
    oldContent: string;
    newContent: string;
    diffPreview: string;
  }>;
  affectedFiles: number;
  success: boolean;
  error?: string;
}

// =============================================================================
// Analysis Types
// =============================================================================

export interface LintResult {
  file: string;
  errorCount: number;
  warningCount: number;
  messages: Array<{
    ruleId: string;
    severity: 'error' | 'warning';
    message: string;
    line: number;
    column: number;
    endLine?: number;
    endColumn?: number;
    fix?: {
      range: [number, number];
      text: string;
    };
  }>;
}

export interface TypeCheckResult {
  file: string;
  errors: Array<{
    code: number;
    message: string;
    line: number;
    column: number;
    endLine?: number;
    endColumn?: number;
  }>;
  warnings: Array<{
    code: number;
    message: string;
    line: number;
    column: number;
  }>;
}

export interface AnalysisSummary {
  totalFiles: number;
  totalErrors: number;
  totalWarnings: number;
  lintResults: LintResult[];
  typeResults: TypeCheckResult[];
}

// =============================================================================
// Dependency Graph Types
// =============================================================================

export interface DependencyNode {
  id: string;
  path: string;
  imports: string[];
  exports: string[];
  isExternal: boolean;
}

export interface DependencyEdge {
  source: string;
  target: string;
  type: 'import' | 'export' | 'dynamic';
  symbols?: string[];
}

export interface DependencyGraph {
  nodes: DependencyNode[];
  edges: DependencyEdge[];
  entryPoint: string;
  circularDependencies: string[][];
}

export interface ImpactAnalysis {
  changedFile: string;
  directDependents: string[];
  transitiveDependents: string[];
  totalImpact: number;
  riskLevel: 'low' | 'medium' | 'high';
  suggestions: string[];
}

// =============================================================================
// Debug/REPL Types
// =============================================================================

export interface DebugSession {
  id: string;
  script: string;
  status: 'running' | 'paused' | 'stopped';
  currentLocation?: {
    file: string;
    line: number;
    column: number;
  };
}

export interface Breakpoint {
  id: string;
  file: string;
  line: number;
  condition?: string;
  hitCount?: number;
  enabled: boolean;
}

export interface VariableInspection {
  name: string;
  value: unknown;
  type: string;
  properties?: VariableInspection[];
  scope: 'local' | 'closure' | 'global';
}

export interface StackFrame {
  id: number;
  name: string;
  file: string;
  line: number;
  column: number;
  isNative: boolean;
}

export interface EvalResult {
  expression: string;
  result: unknown;
  type: string;
  error?: string;
}

// =============================================================================
// Profiler Types
// =============================================================================

export interface ProfileResult {
  duration: number;
  samples: number;
  topFunctions: ProfileFunction[];
  callTree: ProfileNode;
}

export interface ProfileFunction {
  name: string;
  file: string;
  line: number;
  selfTime: number;
  totalTime: number;
  callCount: number;
  percentage: number;
}

export interface ProfileNode {
  name: string;
  file: string;
  line: number;
  selfTime: number;
  totalTime: number;
  children: ProfileNode[];
}

export interface HotspotResult {
  hotspots: Array<{
    function: string;
    file: string;
    line: number;
    percentage: number;
    suggestion?: string;
  }>;
  summary: string;
}

// =============================================================================
// Stack Trace Types
// =============================================================================

export interface ParsedStackFrame {
  functionName: string;
  file: string;
  line: number;
  column: number;
  isNative: boolean;
  isConstructor: boolean;
  isAsync: boolean;
  source?: string;
}

export interface ParsedStackTrace {
  message: string;
  name: string;
  frames: ParsedStackFrame[];
  originalStack: string;
}

export interface StackContext {
  frame: ParsedStackFrame;
  surroundingCode: Array<{
    line: number;
    content: string;
    isErrorLine: boolean;
  }>;
  variables?: Record<string, unknown>;
}

// =============================================================================
// Database Types
// =============================================================================

export interface DatabaseSchema {
  tables: TableSchema[];
  views: ViewSchema[];
  relationships: RelationshipSchema[];
}

export interface TableSchema {
  name: string;
  columns: ColumnSchema[];
  primaryKey: string[];
  indexes: IndexSchema[];
}

export interface ColumnSchema {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue?: unknown;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  references?: {
    table: string;
    column: string;
  };
}

export interface IndexSchema {
  name: string;
  columns: string[];
  unique: boolean;
  type: string;
}

export interface ViewSchema {
  name: string;
  definition: string;
  columns: ColumnSchema[];
}

export interface RelationshipSchema {
  name: string;
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  type: 'one-to-one' | 'one-to-many' | 'many-to-many';
}

export interface GeneratedTypes {
  typescript: string;
  tableCount: number;
  warnings: string[];
}

// =============================================================================
// Documentation Types
// =============================================================================

export interface DocFetchResult {
  url: string;
  title: string;
  content: string;
  sections: DocSection[];
  fetchedAt: Date;
  cached: boolean;
}

export interface DocSection {
  heading: string;
  level: number;
  content: string;
  codeExamples: Array<{
    language: string;
    code: string;
  }>;
}

export interface DocSearchResult {
  query: string;
  results: Array<{
    url: string;
    title: string;
    snippet: string;
    relevance: number;
  }>;
}

// =============================================================================
// Composite Types (for CapabilitiesManager)
// =============================================================================

export interface ErrorAnalysis {
  stack: ParsedStackTrace;
  context: StackContext;
  history: GitHistoryEntry[];
  diagnostics?: DiagnosticsResult;
  suggestions: string[];
}

export interface RefactorPlan {
  symbol: string;
  references: ReferencesResult;
  impact: ImpactAnalysis;
  safeToRefactor: boolean;
  warnings: string[];
}

export interface PerformanceReport {
  profile: ProfileResult;
  hotspots: HotspotResult;
  suggestions: string[];
  estimatedImprovement?: string;
}

// =============================================================================
// Capability Status
// =============================================================================

export interface CapabilityStatus {
  name: string;
  enabled: boolean;
  initialized: boolean;
  error?: string;
  version?: string;
}

export interface CapabilitiesStatus {
  projectRoot: string;
  capabilities: CapabilityStatus[];
  ready: boolean;
  errors: string[];
}
