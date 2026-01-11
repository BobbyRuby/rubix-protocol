/**
 * CapabilitiesManager
 *
 * Unified manager orchestrating all 10 CODEX advanced coding capabilities.
 * Provides IDE-like powers for code understanding and manipulation.
 *
 * Capabilities:
 * 1. LSP Integration - Go-to-definition, find-references, diagnostics
 * 2. Git Intelligence - Blame, bisect, history analysis
 * 3. Static Analysis - ESLint + TypeScript compiler
 * 4. AST Manipulation - Parse, traverse, refactor
 * 5. Dependency Graph - Impact analysis
 * 6. Doc Mining - Fetch library documentation
 * 7. REPL/Debug - Live inspection
 * 8. Profiler - CPU profiling
 * 9. Stack Trace Parser - Error understanding
 * 10. Database Introspection - Schema awareness
 */

import type {
  CapabilitiesConfig,
  CapabilitiesStatus,
  CapabilityStatus,
  ErrorAnalysis,
  RefactorPlan,
  PerformanceReport,
  DefinitionResult,
  ReferencesResult,
  DiagnosticsResult,
  SymbolSearchResult,
  GitBlameResult,
  GitBisectResult,
  GitHistoryEntry,
  GitDiffResult,
  GitBranchInfo,
  ASTParseResult,
  ASTQueryResult,
  RefactorResult,
  RefactorOperation,
  LintResult,
  TypeCheckResult,
  AnalysisSummary,
  DependencyGraph,
  ImpactAnalysis,
  DebugSession,
  Breakpoint,
  VariableInspection,
  EvalResult,
  ProfileResult,
  HotspotResult,
  ParsedStackTrace,
  StackContext,
  DatabaseSchema,
  GeneratedTypes,
  DocFetchResult,
  DocSearchResult
} from './types.js';

// Import capability managers (will be implemented)
import { LSPManager } from './lsp/LSPManager.js';
import { GitManager } from './git/GitManager.js';
import { StaticAnalyzer } from './analysis/StaticAnalyzer.js';
import { ASTManager } from './ast/ASTManager.js';
import { DependencyGraphManager } from './deps/DependencyGraph.js';
import { REPLManager } from './repl/REPLManager.js';
import { ProfilerManager } from './profiler/ProfilerManager.js';
import { StackParser } from './stacktrace/StackParser.js';
import { SchemaIntrospector } from './database/SchemaIntrospector.js';
import { DocMiner } from './docs/DocMiner.js';

/**
 * Default configuration for capabilities
 */
export const DEFAULT_CAPABILITIES_CONFIG: Partial<CapabilitiesConfig> = {
  lsp: { enabled: true, timeout: 10000 },
  git: { enabled: true },
  analysis: { enabled: true, eslint: true, typescript: true },
  ast: { enabled: true },
  deps: { enabled: true },
  repl: { enabled: false }, // Disabled by default (requires explicit setup)
  profiler: { enabled: false }, // Disabled by default (performance overhead)
  stacktrace: { enabled: true },
  database: { enabled: false }, // Disabled by default (requires connection)
  docs: { enabled: true, cacheTTL: 3600 }
};

/**
 * CapabilitiesManager - Unified interface for all coding capabilities
 */
export class CapabilitiesManager {
  private config: CapabilitiesConfig;
  private initialized: boolean = false;

  // Capability managers
  private lsp: LSPManager | null = null;
  private git: GitManager | null = null;
  private analyzer: StaticAnalyzer | null = null;
  private ast: ASTManager | null = null;
  private deps: DependencyGraphManager | null = null;
  private repl: REPLManager | null = null;
  private profiler: ProfilerManager | null = null;
  private stack: StackParser | null = null;
  private db: SchemaIntrospector | null = null;
  private docs: DocMiner | null = null;

  constructor(config: CapabilitiesConfig) {
    this.config = {
      ...DEFAULT_CAPABILITIES_CONFIG,
      ...config,
      lsp: { ...DEFAULT_CAPABILITIES_CONFIG.lsp, ...config.lsp },
      git: { ...DEFAULT_CAPABILITIES_CONFIG.git, ...config.git },
      analysis: { ...DEFAULT_CAPABILITIES_CONFIG.analysis, ...config.analysis },
      ast: { ...DEFAULT_CAPABILITIES_CONFIG.ast, ...config.ast },
      deps: { ...DEFAULT_CAPABILITIES_CONFIG.deps, ...config.deps },
      repl: { ...DEFAULT_CAPABILITIES_CONFIG.repl, ...config.repl },
      profiler: { ...DEFAULT_CAPABILITIES_CONFIG.profiler, ...config.profiler },
      stacktrace: { ...DEFAULT_CAPABILITIES_CONFIG.stacktrace, ...config.stacktrace },
      database: { ...DEFAULT_CAPABILITIES_CONFIG.database, ...config.database },
      docs: { ...DEFAULT_CAPABILITIES_CONFIG.docs, ...config.docs }
    };
  }

  /**
   * Initialize all enabled capabilities
   */
  async initialize(): Promise<CapabilitiesStatus> {
    const statuses: CapabilityStatus[] = [];

    // Initialize LSP
    if (this.config.lsp?.enabled) {
      try {
        this.lsp = new LSPManager(this.config.projectRoot, this.config.lsp);
        await this.lsp.initialize();
        statuses.push({ name: 'lsp', enabled: true, initialized: true });
      } catch (error) {
        statuses.push({
          name: 'lsp',
          enabled: true,
          initialized: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    // Initialize Git
    if (this.config.git?.enabled) {
      try {
        this.git = new GitManager(this.config.projectRoot, this.config.git);
        await this.git.initialize();
        statuses.push({ name: 'git', enabled: true, initialized: true });
      } catch (error) {
        statuses.push({
          name: 'git',
          enabled: true,
          initialized: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    // Initialize Static Analyzer
    if (this.config.analysis?.enabled) {
      try {
        this.analyzer = new StaticAnalyzer(this.config.projectRoot, this.config.analysis);
        await this.analyzer.initialize();
        statuses.push({ name: 'analysis', enabled: true, initialized: true });
      } catch (error) {
        statuses.push({
          name: 'analysis',
          enabled: true,
          initialized: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    // Initialize AST Manager
    if (this.config.ast?.enabled) {
      try {
        this.ast = new ASTManager(this.config.projectRoot, this.config.ast);
        statuses.push({ name: 'ast', enabled: true, initialized: true });
      } catch (error) {
        statuses.push({
          name: 'ast',
          enabled: true,
          initialized: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    // Initialize Dependency Graph
    if (this.config.deps?.enabled) {
      try {
        this.deps = new DependencyGraphManager(this.config.projectRoot, this.config.deps);
        statuses.push({ name: 'deps', enabled: true, initialized: true });
      } catch (error) {
        statuses.push({
          name: 'deps',
          enabled: true,
          initialized: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    // Initialize REPL/Debug
    if (this.config.repl?.enabled) {
      try {
        this.repl = new REPLManager(this.config.projectRoot, this.config.repl);
        statuses.push({ name: 'repl', enabled: true, initialized: true });
      } catch (error) {
        statuses.push({
          name: 'repl',
          enabled: true,
          initialized: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    // Initialize Profiler
    if (this.config.profiler?.enabled) {
      try {
        this.profiler = new ProfilerManager(this.config.projectRoot, this.config.profiler);
        statuses.push({ name: 'profiler', enabled: true, initialized: true });
      } catch (error) {
        statuses.push({
          name: 'profiler',
          enabled: true,
          initialized: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    // Initialize Stack Parser
    if (this.config.stacktrace?.enabled) {
      try {
        this.stack = new StackParser(this.config.projectRoot, this.config.stacktrace);
        statuses.push({ name: 'stacktrace', enabled: true, initialized: true });
      } catch (error) {
        statuses.push({
          name: 'stacktrace',
          enabled: true,
          initialized: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    // Initialize Database Introspector
    if (this.config.database?.enabled) {
      try {
        this.db = new SchemaIntrospector(this.config.database);
        await this.db.initialize();
        statuses.push({ name: 'database', enabled: true, initialized: true });
      } catch (error) {
        statuses.push({
          name: 'database',
          enabled: true,
          initialized: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    // Initialize Doc Miner
    if (this.config.docs?.enabled) {
      try {
        this.docs = new DocMiner(this.config.projectRoot, this.config.docs);
        statuses.push({ name: 'docs', enabled: true, initialized: true });
      } catch (error) {
        statuses.push({
          name: 'docs',
          enabled: true,
          initialized: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    this.initialized = true;

    return {
      projectRoot: this.config.projectRoot,
      capabilities: statuses,
      ready: statuses.every(s => !s.enabled || s.initialized),
      errors: statuses.filter(s => s.error).map(s => `${s.name}: ${s.error}`)
    };
  }

  /**
   * Shutdown all capabilities
   */
  async shutdown(): Promise<void> {
    if (this.lsp) await this.lsp.shutdown();
    if (this.git) await this.git.shutdown();
    if (this.analyzer) await this.analyzer.shutdown();
    if (this.repl) await this.repl.shutdown();
    if (this.profiler) await this.profiler.shutdown();
    if (this.db) await this.db.shutdown();
    this.initialized = false;
  }

  /**
   * Get current status of all capabilities
   */
  getStatus(): CapabilitiesStatus {
    const statuses: CapabilityStatus[] = [
      { name: 'lsp', enabled: !!this.config.lsp?.enabled, initialized: !!this.lsp },
      { name: 'git', enabled: !!this.config.git?.enabled, initialized: !!this.git },
      { name: 'analysis', enabled: !!this.config.analysis?.enabled, initialized: !!this.analyzer },
      { name: 'ast', enabled: !!this.config.ast?.enabled, initialized: !!this.ast },
      { name: 'deps', enabled: !!this.config.deps?.enabled, initialized: !!this.deps },
      { name: 'repl', enabled: !!this.config.repl?.enabled, initialized: !!this.repl },
      { name: 'profiler', enabled: !!this.config.profiler?.enabled, initialized: !!this.profiler },
      { name: 'stacktrace', enabled: !!this.config.stacktrace?.enabled, initialized: !!this.stack },
      { name: 'database', enabled: !!this.config.database?.enabled, initialized: !!this.db },
      { name: 'docs', enabled: !!this.config.docs?.enabled, initialized: !!this.docs }
    ];

    return {
      projectRoot: this.config.projectRoot,
      capabilities: statuses,
      ready: this.initialized,
      errors: []
    };
  }

  // ===========================================================================
  // LSP Operations
  // ===========================================================================

  async startLspServer(languageId?: string): Promise<void> {
    if (!this.lsp) throw new Error('LSP not initialized');
    await this.lsp.startServer(languageId ?? 'typescript');
  }

  async stopLspServer(): Promise<void> {
    if (!this.lsp) throw new Error('LSP not initialized');
    await this.lsp.shutdown();
  }

  getLspStatus(): Array<{ languageId: string; running: boolean; capabilities: { definitionProvider: boolean; referencesProvider: boolean; documentSymbolProvider: boolean; workspaceSymbolProvider: boolean; diagnosticProvider: boolean; hoverProvider: boolean; completionProvider: boolean; renameProvider: boolean }; error?: string }> {
    if (!this.lsp) return [];
    return this.lsp.getStatus();
  }

  async gotoDefinition(file: string, line: number, column: number): Promise<DefinitionResult | null> {
    if (!this.lsp) throw new Error('LSP not initialized');
    return this.lsp.gotoDefinition(file, line, column);
  }

  async findReferences(file: string, line: number, column: number): Promise<ReferencesResult> {
    if (!this.lsp) throw new Error('LSP not initialized');
    return this.lsp.findReferences(file, line, column);
  }

  async getDiagnostics(file?: string): Promise<DiagnosticsResult[]> {
    if (!this.lsp) throw new Error('LSP not initialized');
    return this.lsp.getDiagnostics(file);
  }

  async searchSymbols(query: string): Promise<SymbolSearchResult> {
    if (!this.lsp) throw new Error('LSP not initialized');
    return this.lsp.searchSymbols(query);
  }

  // ===========================================================================
  // Git Operations
  // ===========================================================================

  async gitBlame(file: string, startLine?: number, endLine?: number): Promise<GitBlameResult> {
    if (!this.git) throw new Error('Git not initialized');
    return this.git.blame(file, startLine, endLine);
  }

  async gitBisect(goodCommit: string, badCommit: string, testCommand: string): Promise<GitBisectResult> {
    if (!this.git) throw new Error('Git not initialized');
    return this.git.bisect(goodCommit, badCommit, testCommand);
  }

  async gitHistory(file?: string, limit?: number): Promise<GitHistoryEntry[]> {
    if (!this.git) throw new Error('Git not initialized');
    return this.git.history(file, limit);
  }

  async gitDiff(file?: string, staged?: boolean): Promise<GitDiffResult[]> {
    if (!this.git) throw new Error('Git not initialized');
    return this.git.diff(file, staged);
  }

  async gitBranches(): Promise<GitBranchInfo[]> {
    if (!this.git) throw new Error('Git not initialized');
    return this.git.branches();
  }

  async gitRecentChanges(file: string, options?: { limit?: number }): Promise<GitHistoryEntry[]> {
    if (!this.git) throw new Error('Git not initialized');
    return this.git.history(file, options?.limit ?? 5);
  }

  // ===========================================================================
  // Static Analysis Operations
  // ===========================================================================

  async runLint(files?: string[]): Promise<LintResult[]> {
    if (!this.analyzer) throw new Error('Static analyzer not initialized');
    return this.analyzer.runLint(files);
  }

  async runTypeCheck(files?: string[]): Promise<TypeCheckResult[]> {
    if (!this.analyzer) throw new Error('Static analyzer not initialized');
    return this.analyzer.runTypeCheck(files);
  }

  async analyze(files?: string[]): Promise<AnalysisSummary> {
    if (!this.analyzer) throw new Error('Static analyzer not initialized');
    return this.analyzer.analyze(files);
  }

  /**
   * Run ESLint with --fix to auto-correct fixable issues
   * @param files Optional list of files to fix
   * @returns Object with count of fixed issues and remaining error count
   */
  async fixLintIssues(files?: string[]): Promise<{ fixedCount: number; remainingErrors: number }> {
    if (!this.analyzer) {
      return { fixedCount: 0, remainingErrors: 0 };
    }
    return this.analyzer.fixLintIssues(files);
  }

  // ===========================================================================
  // AST Operations
  // ===========================================================================

  async parseAST(file: string): Promise<ASTParseResult> {
    if (!this.ast) throw new Error('AST manager not initialized');
    return this.ast.parse(file);
  }

  async queryAST(file: string, nodeType: string): Promise<ASTQueryResult> {
    if (!this.ast) throw new Error('AST manager not initialized');
    return this.ast.query(file, nodeType);
  }

  async refactor(operation: RefactorOperation): Promise<RefactorResult> {
    if (!this.ast) throw new Error('AST manager not initialized');
    return this.ast.refactor(operation);
  }

  async getSymbols(file: string): Promise<Array<{ name: string; kind: string; location: { file: string; line: number; column: number }; scope: string; exported: boolean }>> {
    if (!this.ast) throw new Error('AST manager not initialized');
    return this.ast.getSymbols(file);
  }

  // ===========================================================================
  // Dependency Graph Operations
  // ===========================================================================

  async buildDependencyGraph(entryPoint: string): Promise<DependencyGraph> {
    if (!this.deps) throw new Error('Dependency graph not initialized');
    return this.deps.build(entryPoint);
  }

  async analyzeImpact(file: string): Promise<ImpactAnalysis> {
    if (!this.deps) throw new Error('Dependency graph not initialized');
    return this.deps.analyzeImpact(file);
  }

  // ===========================================================================
  // REPL/Debug Operations
  // ===========================================================================

  async startDebugSession(script: string): Promise<DebugSession> {
    if (!this.repl) throw new Error('REPL not initialized');
    return this.repl.startSession(script);
  }

  async stopAllDebugSessions(): Promise<void> {
    if (!this.repl) throw new Error('REPL not initialized');
    await this.repl.shutdown();
  }

  async setBreakpoint(file: string, line: number, condition?: string): Promise<Breakpoint> {
    if (!this.repl) throw new Error('REPL not initialized');
    return this.repl.setBreakpoint(file, line, condition);
  }

  async removeBreakpoint(breakpointId: string): Promise<void> {
    if (!this.repl) throw new Error('REPL not initialized');
    await this.repl.removeBreakpoint(breakpointId);
  }

  async step(action: 'into' | 'over' | 'out' | 'continue'): Promise<void> {
    if (!this.repl) throw new Error('REPL not initialized');
    await this.repl.step(action);
  }

  async inspectVariable(name: string): Promise<VariableInspection> {
    if (!this.repl) throw new Error('REPL not initialized');
    return this.repl.inspectVariable(name);
  }

  async evalExpression(expression: string): Promise<EvalResult> {
    if (!this.repl) throw new Error('REPL not initialized');
    return this.repl.eval(expression);
  }

  // ===========================================================================
  // Profiler Operations
  // ===========================================================================

  async startProfiling(): Promise<void> {
    if (!this.profiler) throw new Error('Profiler not initialized');
    return this.profiler.start();
  }

  async stopProfiling(): Promise<ProfileResult> {
    if (!this.profiler) throw new Error('Profiler not initialized');
    return this.profiler.stop();
  }

  async findHotspots(): Promise<HotspotResult> {
    if (!this.profiler) throw new Error('Profiler not initialized');
    return this.profiler.findHotspots();
  }

  // ===========================================================================
  // Stack Trace Operations
  // ===========================================================================

  async parseStackTrace(error: Error | string): Promise<ParsedStackTrace> {
    if (!this.stack) throw new Error('Stack parser not initialized');
    return this.stack.parse(error);
  }

  async getStackContext(file: string, line: number): Promise<StackContext> {
    if (!this.stack) throw new Error('Stack parser not initialized');
    return this.stack.getContext(file, line);
  }

  // ===========================================================================
  // Database Operations
  // ===========================================================================

  async getSchema(): Promise<DatabaseSchema> {
    if (!this.db) throw new Error('Database not initialized');
    return this.db.getSchema();
  }

  async shutdownDatabase(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    await this.db.shutdown();
  }

  async generateTypes(options?: {
    exportFormat?: 'interface' | 'type' | 'class';
    addNullable?: boolean;
    addOptional?: boolean;
  }): Promise<GeneratedTypes> {
    if (!this.db) throw new Error('Database not initialized');
    return this.db.generateTypes(options);
  }

  // ===========================================================================
  // Documentation Operations
  // ===========================================================================

  async fetchDocs(url: string): Promise<DocFetchResult> {
    if (!this.docs) throw new Error('Doc miner not initialized');
    return this.docs.fetch(url);
  }

  async searchDocs(query: string): Promise<DocSearchResult> {
    if (!this.docs) throw new Error('Doc miner not initialized');
    return this.docs.search(query);
  }

  // ===========================================================================
  // Composite Operations (combining multiple capabilities)
  // ===========================================================================

  /**
   * Analyze an error comprehensively using multiple capabilities
   */
  async analyzeError(error: Error): Promise<ErrorAnalysis> {
    const suggestions: string[] = [];

    // Parse the stack trace
    let stack: ParsedStackTrace;
    if (this.stack) {
      stack = await this.stack.parse(error);
    } else {
      // Fallback basic parsing
      stack = {
        message: error.message,
        name: error.name,
        frames: [],
        originalStack: error.stack ?? ''
      };
    }

    // Get context for the first frame
    let context: StackContext = {
      frame: stack.frames[0] ?? {
        functionName: 'unknown',
        file: 'unknown',
        line: 0,
        column: 0,
        isNative: false,
        isConstructor: false,
        isAsync: false
      },
      surroundingCode: []
    };

    if (this.stack && stack.frames[0]) {
      try {
        context = await this.stack.getContext(stack.frames[0].file, stack.frames[0].line);
      } catch {
        // Context unavailable
      }
    }

    // Get recent git history for the file
    let history: GitHistoryEntry[] = [];
    if (this.git && stack.frames[0]?.file) {
      try {
        history = await this.git.history(stack.frames[0].file, 5);
        if (history.length > 0) {
          suggestions.push(`Check recent changes by ${history[0].author} on ${history[0].date.toLocaleDateString()}`);
        }
      } catch {
        // History unavailable
      }
    }

    // Get diagnostics for the file
    let diagnostics: DiagnosticsResult | undefined;
    if (this.lsp && stack.frames[0]?.file) {
      try {
        const results = await this.lsp.getDiagnostics(stack.frames[0].file);
        diagnostics = results[0];
        if (diagnostics && diagnostics.errorCount > 0) {
          suggestions.push(`File has ${diagnostics.errorCount} diagnostic errors`);
        }
      } catch {
        // Diagnostics unavailable
      }
    }

    // Generate suggestions based on error type
    if (error.message.includes('undefined') || error.message.includes('null')) {
      suggestions.push('Add null/undefined checks');
    }
    if (error.message.includes('type') || error.message.includes('TypeError')) {
      suggestions.push('Verify type annotations and runtime type guards');
    }
    if (error.message.includes('import') || error.message.includes('require')) {
      suggestions.push('Check import paths and module resolution');
    }

    return {
      stack,
      context,
      history,
      diagnostics,
      suggestions
    };
  }

  /**
   * Prepare a refactor operation with impact analysis
   */
  async prepareRefactor(file: string, line: number, column: number): Promise<RefactorPlan> {
    const warnings: string[] = [];

    // Find references
    let references: ReferencesResult;
    if (this.lsp) {
      references = await this.lsp.findReferences(file, line, column);
    } else {
      references = {
        symbol: 'unknown',
        totalCount: 0,
        references: []
      };
      warnings.push('LSP not available - reference count may be incomplete');
    }

    // Analyze impact
    let impact: ImpactAnalysis;
    if (this.deps) {
      impact = await this.deps.analyzeImpact(file);
    } else {
      impact = {
        changedFile: file,
        directDependents: [],
        transitiveDependents: [],
        totalImpact: references.totalCount,
        riskLevel: references.totalCount > 10 ? 'high' : references.totalCount > 5 ? 'medium' : 'low',
        suggestions: []
      };
      warnings.push('Dependency graph not available - impact analysis may be incomplete');
    }

    // Determine if safe to refactor
    const safeToRefactor = impact.riskLevel !== 'high' && references.totalCount < 50;

    if (!safeToRefactor) {
      warnings.push(`High impact refactor: ${references.totalCount} references across ${impact.transitiveDependents.length} transitive dependents`);
    }

    return {
      symbol: references.symbol,
      references,
      impact,
      safeToRefactor,
      warnings
    };
  }

  /**
   * Investigate performance issues in a file
   */
  async investigatePerformance(file: string): Promise<PerformanceReport> {
    const suggestions: string[] = [];

    // Run profiler if available
    let profile: ProfileResult;
    let hotspots: HotspotResult;

    if (this.profiler) {
      await this.profiler.start();
      // Wait a bit for profiling
      await new Promise(resolve => setTimeout(resolve, 1000));
      profile = await this.profiler.stop();
      hotspots = await this.profiler.findHotspots();
    } else {
      profile = {
        duration: 0,
        samples: 0,
        topFunctions: [],
        callTree: { name: 'root', file: '', line: 0, selfTime: 0, totalTime: 0, children: [] }
      };
      hotspots = { hotspots: [], summary: 'Profiler not available' };
      suggestions.push('Enable profiler for detailed performance analysis');
    }

    // Add AST-based suggestions if available
    if (this.ast) {
      try {
        // Parse to ensure file is valid
        await this.ast.parse(file);
        // Look for common performance issues
        const loops = await this.ast.query(file, 'ForStatement');
        if (loops.matches.length > 5) {
          suggestions.push('Consider optimizing loops - found ' + loops.matches.length + ' loop statements');
        }
      } catch {
        // AST analysis failed
      }
    }

    // Generate suggestions from hotspots
    for (const hotspot of hotspots.hotspots) {
      if (hotspot.percentage > 20) {
        suggestions.push(`Optimize ${hotspot.function} - ${hotspot.percentage.toFixed(1)}% of execution time`);
      }
    }

    return {
      profile,
      hotspots,
      suggestions,
      estimatedImprovement: suggestions.length > 0 ? 'Potential 10-30% improvement' : undefined
    };
  }
}

export default CapabilitiesManager;
