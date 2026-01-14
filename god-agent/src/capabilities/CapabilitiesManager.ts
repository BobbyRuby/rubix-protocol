/**
 * CapabilitiesManager
 *
 * Unified manager orchestrating all 10 RUBIX advanced coding capabilities.
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
 *
 * LAZY INITIALIZATION: Each capability is initialized on first use,
 * not during the main initialize() call. This prevents timeouts and
 * allows capabilities to be used even if others fail.
 */
export class CapabilitiesManager {
  private config: CapabilitiesConfig;
  private initialized: boolean = false;

  // Capability managers (lazy initialized)
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

  // Track initialization state per capability
  private initState: Map<string, 'pending' | 'initializing' | 'ready' | 'failed'> = new Map();
  private initErrors: Map<string, string> = new Map();

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

    // Initialize all capabilities as pending
    ['lsp', 'git', 'analysis', 'ast', 'deps', 'repl', 'profiler', 'stacktrace', 'database', 'docs'].forEach(cap => {
      this.initState.set(cap, 'pending');
    });
  }

  // ===========================================================================
  // Lazy Initialization Methods - Each capability is initialized on first use
  // ===========================================================================

  /**
   * Ensure Git is initialized (lazy)
   */
  private async ensureGit(): Promise<GitManager> {
    if (this.git && this.initState.get('git') === 'ready') {
      return this.git;
    }

    if (this.initState.get('git') === 'failed') {
      throw new Error(`Git initialization failed: ${this.initErrors.get('git')}`);
    }

    if (!this.config.git?.enabled) {
      throw new Error('Git capability is disabled in configuration');
    }

    this.initState.set('git', 'initializing');
    try {
      this.git = new GitManager(this.config.projectRoot, this.config.git);
      await this.git.initialize();
      this.initState.set('git', 'ready');
      return this.git;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.initState.set('git', 'failed');
      this.initErrors.set('git', msg);
      throw new Error(`Git initialization failed: ${msg}`);
    }
  }

  /**
   * Ensure AST manager is initialized (lazy)
   */
  private async ensureAst(): Promise<ASTManager> {
    if (this.ast && this.initState.get('ast') === 'ready') {
      return this.ast;
    }

    if (this.initState.get('ast') === 'failed') {
      throw new Error(`AST initialization failed: ${this.initErrors.get('ast')}`);
    }

    if (!this.config.ast?.enabled) {
      throw new Error('AST capability is disabled in configuration');
    }

    this.initState.set('ast', 'initializing');
    try {
      this.ast = new ASTManager(this.config.projectRoot, this.config.ast);
      this.initState.set('ast', 'ready');
      return this.ast;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.initState.set('ast', 'failed');
      this.initErrors.set('ast', msg);
      throw new Error(`AST initialization failed: ${msg}`);
    }
  }

  /**
   * Ensure Static Analyzer is initialized (lazy)
   */
  private async ensureAnalyzer(): Promise<StaticAnalyzer> {
    if (this.analyzer && this.initState.get('analysis') === 'ready') {
      return this.analyzer;
    }

    if (this.initState.get('analysis') === 'failed') {
      throw new Error(`Static analyzer initialization failed: ${this.initErrors.get('analysis')}`);
    }

    if (!this.config.analysis?.enabled) {
      throw new Error('Static analysis capability is disabled in configuration');
    }

    this.initState.set('analysis', 'initializing');
    try {
      this.analyzer = new StaticAnalyzer(this.config.projectRoot, this.config.analysis);
      await this.analyzer.initialize();
      this.initState.set('analysis', 'ready');
      return this.analyzer;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.initState.set('analysis', 'failed');
      this.initErrors.set('analysis', msg);
      throw new Error(`Static analyzer initialization failed: ${msg}`);
    }
  }

  /**
   * Ensure LSP is initialized (lazy)
   */
  private async ensureLsp(): Promise<LSPManager> {
    if (this.lsp && this.initState.get('lsp') === 'ready') {
      return this.lsp;
    }

    if (this.initState.get('lsp') === 'failed') {
      throw new Error(`LSP initialization failed: ${this.initErrors.get('lsp')}`);
    }

    if (!this.config.lsp?.enabled) {
      throw new Error('LSP capability is disabled in configuration');
    }

    this.initState.set('lsp', 'initializing');
    try {
      this.lsp = new LSPManager(this.config.projectRoot, this.config.lsp);
      await this.lsp.initialize();
      this.initState.set('lsp', 'ready');
      return this.lsp;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.initState.set('lsp', 'failed');
      this.initErrors.set('lsp', msg);
      throw new Error(`LSP initialization failed: ${msg}`);
    }
  }

  /**
   * Ensure Dependency Graph is initialized (lazy)
   */
  private async ensureDeps(): Promise<DependencyGraphManager> {
    if (this.deps && this.initState.get('deps') === 'ready') {
      return this.deps;
    }

    if (this.initState.get('deps') === 'failed') {
      throw new Error(`Dependency graph initialization failed: ${this.initErrors.get('deps')}`);
    }

    if (!this.config.deps?.enabled) {
      throw new Error('Dependency graph capability is disabled in configuration');
    }

    this.initState.set('deps', 'initializing');
    try {
      this.deps = new DependencyGraphManager(this.config.projectRoot, this.config.deps);
      this.initState.set('deps', 'ready');
      return this.deps;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.initState.set('deps', 'failed');
      this.initErrors.set('deps', msg);
      throw new Error(`Dependency graph initialization failed: ${msg}`);
    }
  }

  /**
   * Ensure REPL is initialized (lazy)
   */
  private async ensureRepl(): Promise<REPLManager> {
    if (this.repl && this.initState.get('repl') === 'ready') {
      return this.repl;
    }

    if (this.initState.get('repl') === 'failed') {
      throw new Error(`REPL initialization failed: ${this.initErrors.get('repl')}`);
    }

    if (!this.config.repl?.enabled) {
      throw new Error('REPL capability is disabled in configuration');
    }

    this.initState.set('repl', 'initializing');
    try {
      this.repl = new REPLManager(this.config.projectRoot, this.config.repl);
      this.initState.set('repl', 'ready');
      return this.repl;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.initState.set('repl', 'failed');
      this.initErrors.set('repl', msg);
      throw new Error(`REPL initialization failed: ${msg}`);
    }
  }

  /**
   * Ensure Profiler is initialized (lazy)
   */
  private async ensureProfiler(): Promise<ProfilerManager> {
    if (this.profiler && this.initState.get('profiler') === 'ready') {
      return this.profiler;
    }

    if (this.initState.get('profiler') === 'failed') {
      throw new Error(`Profiler initialization failed: ${this.initErrors.get('profiler')}`);
    }

    if (!this.config.profiler?.enabled) {
      throw new Error('Profiler capability is disabled in configuration');
    }

    this.initState.set('profiler', 'initializing');
    try {
      this.profiler = new ProfilerManager(this.config.projectRoot, this.config.profiler);
      this.initState.set('profiler', 'ready');
      return this.profiler;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.initState.set('profiler', 'failed');
      this.initErrors.set('profiler', msg);
      throw new Error(`Profiler initialization failed: ${msg}`);
    }
  }

  /**
   * Ensure Stack Parser is initialized (lazy)
   */
  private async ensureStack(): Promise<StackParser> {
    if (this.stack && this.initState.get('stacktrace') === 'ready') {
      return this.stack;
    }

    if (this.initState.get('stacktrace') === 'failed') {
      throw new Error(`Stack parser initialization failed: ${this.initErrors.get('stacktrace')}`);
    }

    if (!this.config.stacktrace?.enabled) {
      throw new Error('Stack trace capability is disabled in configuration');
    }

    this.initState.set('stacktrace', 'initializing');
    try {
      this.stack = new StackParser(this.config.projectRoot, this.config.stacktrace);
      this.initState.set('stacktrace', 'ready');
      return this.stack;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.initState.set('stacktrace', 'failed');
      this.initErrors.set('stacktrace', msg);
      throw new Error(`Stack parser initialization failed: ${msg}`);
    }
  }

  /**
   * Ensure Database introspector is initialized (lazy)
   */
  private async ensureDb(): Promise<SchemaIntrospector> {
    if (this.db && this.initState.get('database') === 'ready') {
      return this.db;
    }

    if (this.initState.get('database') === 'failed') {
      throw new Error(`Database initialization failed: ${this.initErrors.get('database')}`);
    }

    if (!this.config.database?.enabled) {
      throw new Error('Database capability is disabled in configuration');
    }

    this.initState.set('database', 'initializing');
    try {
      this.db = new SchemaIntrospector(this.config.database);
      await this.db.initialize();
      this.initState.set('database', 'ready');
      return this.db;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.initState.set('database', 'failed');
      this.initErrors.set('database', msg);
      throw new Error(`Database initialization failed: ${msg}`);
    }
  }

  /**
   * Ensure Doc Miner is initialized (lazy)
   */
  private async ensureDocs(): Promise<DocMiner> {
    if (this.docs && this.initState.get('docs') === 'ready') {
      return this.docs;
    }

    if (this.initState.get('docs') === 'failed') {
      throw new Error(`Doc miner initialization failed: ${this.initErrors.get('docs')}`);
    }

    if (!this.config.docs?.enabled) {
      throw new Error('Documentation capability is disabled in configuration');
    }

    this.initState.set('docs', 'initializing');
    try {
      this.docs = new DocMiner(this.config.projectRoot, this.config.docs);
      this.initState.set('docs', 'ready');
      return this.docs;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.initState.set('docs', 'failed');
      this.initErrors.set('docs', msg);
      throw new Error(`Doc miner initialization failed: ${msg}`);
    }
  }

  /**
   * Initialize all enabled capabilities (DEPRECATED - capabilities now lazy init)
   * This method is kept for backwards compatibility but does minimal work.
   * Each capability will initialize on first use instead.
   */
  async initialize(): Promise<CapabilitiesStatus> {
    // Mark as initialized - actual capability init happens on first use
    this.initialized = true;

    // Return status showing all as pending (will init on first use)
    const statuses: CapabilityStatus[] = [
      { name: 'lsp', enabled: !!this.config.lsp?.enabled, initialized: false },
      { name: 'git', enabled: !!this.config.git?.enabled, initialized: false },
      { name: 'analysis', enabled: !!this.config.analysis?.enabled, initialized: false },
      { name: 'ast', enabled: !!this.config.ast?.enabled, initialized: false },
      { name: 'deps', enabled: !!this.config.deps?.enabled, initialized: false },
      { name: 'repl', enabled: !!this.config.repl?.enabled, initialized: false },
      { name: 'profiler', enabled: !!this.config.profiler?.enabled, initialized: false },
      { name: 'stacktrace', enabled: !!this.config.stacktrace?.enabled, initialized: false },
      { name: 'database', enabled: !!this.config.database?.enabled, initialized: false },
      { name: 'docs', enabled: !!this.config.docs?.enabled, initialized: false }
    ];

    return {
      projectRoot: this.config.projectRoot,
      capabilities: statuses,
      ready: true, // Ready to accept requests (lazy init will handle the rest)
      errors: []
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

  /**
   * Pre-warm heavy capabilities in the background (non-blocking)
   *
   * This starts initialization of LSP, REPL, and Profiler without waiting.
   * Subsequent calls to these capabilities will be fast once pre-warming completes.
   *
   * @returns Promise that resolves when all pre-warming attempts complete
   */
  async prewarm(): Promise<{ lsp: boolean; repl: boolean; profiler: boolean }> {
    const results = { lsp: false, repl: false, profiler: false };

    // Install temporary unhandled rejection handler to catch LSP stream errors
    // These can occur after the initial catch due to async connection cleanup
    const rejectionHandler = (reason: unknown) => {
      const msg = reason instanceof Error ? reason.message : String(reason);
      if (msg.includes('stream') || msg.includes('LSP') || msg.includes('ERR_STREAM')) {
        console.warn('[Prewarm] Suppressed async error:', msg);
        // Don't rethrow - this is expected during LSP cleanup
      } else {
        // Re-emit for other unhandled rejections
        throw reason;
      }
    };
    process.on('unhandledRejection', rejectionHandler);

    // Pre-warm in parallel, catching errors individually
    const prewarmTasks: Promise<void>[] = [];

    // LSP (heavy - takes 10-30s, may fail if typescript-language-server not installed)
    if (this.config.lsp?.enabled && this.initState.get('lsp') === 'pending') {
      prewarmTasks.push(
        this.ensureLsp()
          .then(() => { results.lsp = true; })
          .catch(err => {
            console.warn('[Prewarm] LSP failed:', err.message);
            // Mark as failed so we don't retry
            this.initState.set('lsp', 'failed');
            this.initErrors.set('lsp', err.message);
          })
      );
    }

    // REPL/Debug (moderate)
    if (this.config.repl?.enabled && this.initState.get('repl') === 'pending') {
      prewarmTasks.push(
        this.ensureRepl()
          .then(() => { results.repl = true; })
          .catch(err => {
            console.warn('[Prewarm] REPL failed:', err.message);
          })
      );
    }

    // Profiler (moderate)
    if (this.config.profiler?.enabled && this.initState.get('profiler') === 'pending') {
      prewarmTasks.push(
        this.ensureProfiler()
          .then(() => { results.profiler = true; })
          .catch(err => {
            console.warn('[Prewarm] Profiler failed:', err.message);
          })
      );
    }

    // Wait for all pre-warming to complete (or fail)
    await Promise.all(prewarmTasks);

    // Give async cleanup a moment, then remove handler
    await new Promise(resolve => setTimeout(resolve, 500));
    process.removeListener('unhandledRejection', rejectionHandler);

    return results;
  }

  // ===========================================================================
  // LSP Operations (lazy initialized)
  // ===========================================================================

  async startLspServer(languageId?: string): Promise<void> {
    const lsp = await this.ensureLsp();
    await lsp.startServer(languageId ?? 'typescript');
  }

  async stopLspServer(): Promise<void> {
    const lsp = await this.ensureLsp();
    await lsp.shutdown();
  }

  getLspStatus(): Array<{ languageId: string; running: boolean; capabilities: { definitionProvider: boolean; referencesProvider: boolean; documentSymbolProvider: boolean; workspaceSymbolProvider: boolean; diagnosticProvider: boolean; hoverProvider: boolean; completionProvider: boolean; renameProvider: boolean }; error?: string }> {
    if (!this.lsp) return [];
    return this.lsp.getStatus();
  }

  async gotoDefinition(file: string, line: number, column: number): Promise<DefinitionResult | null> {
    const lsp = await this.ensureLsp();
    return lsp.gotoDefinition(file, line, column);
  }

  async findReferences(file: string, line: number, column: number): Promise<ReferencesResult> {
    const lsp = await this.ensureLsp();
    return lsp.findReferences(file, line, column);
  }

  async getDiagnostics(file?: string): Promise<DiagnosticsResult[]> {
    const lsp = await this.ensureLsp();
    return lsp.getDiagnostics(file);
  }

  async searchSymbols(query: string): Promise<SymbolSearchResult> {
    const lsp = await this.ensureLsp();
    return lsp.searchSymbols(query);
  }

  // ===========================================================================
  // Git Operations (lazy initialized)
  // ===========================================================================

  async gitBlame(file: string, startLine?: number, endLine?: number): Promise<GitBlameResult> {
    const git = await this.ensureGit();
    return git.blame(file, startLine, endLine);
  }

  async gitBisect(goodCommit: string, badCommit: string, testCommand: string): Promise<GitBisectResult> {
    const git = await this.ensureGit();
    return git.bisect(goodCommit, badCommit, testCommand);
  }

  async gitHistory(file?: string, limit?: number): Promise<GitHistoryEntry[]> {
    const git = await this.ensureGit();
    return git.history(file, limit);
  }

  async gitDiff(file?: string, staged?: boolean): Promise<GitDiffResult[]> {
    const git = await this.ensureGit();
    return git.diff(file, staged);
  }

  async gitBranches(): Promise<GitBranchInfo[]> {
    const git = await this.ensureGit();
    return git.branches();
  }

  async gitRecentChanges(file: string, options?: { limit?: number }): Promise<GitHistoryEntry[]> {
    const git = await this.ensureGit();
    return git.history(file, options?.limit ?? 5);
  }

  // ===========================================================================
  // Static Analysis Operations (lazy initialized)
  // ===========================================================================

  async runLint(files?: string[]): Promise<LintResult[]> {
    const analyzer = await this.ensureAnalyzer();
    return analyzer.runLint(files);
  }

  async runTypeCheck(files?: string[]): Promise<TypeCheckResult[]> {
    const analyzer = await this.ensureAnalyzer();
    return analyzer.runTypeCheck(files);
  }

  async analyze(files?: string[]): Promise<AnalysisSummary> {
    const analyzer = await this.ensureAnalyzer();
    return analyzer.analyze(files);
  }

  /**
   * Run ESLint with --fix to auto-correct fixable issues
   * @param files Optional list of files to fix
   * @returns Object with count of fixed issues and remaining error count
   */
  async fixLintIssues(files?: string[]): Promise<{ fixedCount: number; remainingErrors: number }> {
    const analyzer = await this.ensureAnalyzer();
    return analyzer.fixLintIssues(files);
  }

  // ===========================================================================
  // AST Operations (lazy initialized)
  // ===========================================================================

  async parseAST(file: string): Promise<ASTParseResult> {
    const ast = await this.ensureAst();
    return ast.parse(file);
  }

  async queryAST(file: string, nodeType: string): Promise<ASTQueryResult> {
    const ast = await this.ensureAst();
    return ast.query(file, nodeType);
  }

  async refactor(operation: RefactorOperation): Promise<RefactorResult> {
    const ast = await this.ensureAst();
    return ast.refactor(operation);
  }

  async getSymbols(file: string): Promise<Array<{ name: string; kind: string; location: { file: string; line: number; column: number }; scope: string; exported: boolean }>> {
    const ast = await this.ensureAst();
    return ast.getSymbols(file);
  }

  // ===========================================================================
  // Dependency Graph Operations (lazy initialized)
  // ===========================================================================

  async buildDependencyGraph(entryPoint: string): Promise<DependencyGraph> {
    const deps = await this.ensureDeps();
    return deps.build(entryPoint);
  }

  async analyzeImpact(file: string): Promise<ImpactAnalysis> {
    const deps = await this.ensureDeps();
    return deps.analyzeImpact(file);
  }

  // ===========================================================================
  // REPL/Debug Operations (lazy initialized)
  // ===========================================================================

  async startDebugSession(script: string): Promise<DebugSession> {
    const repl = await this.ensureRepl();
    return repl.startSession(script);
  }

  async stopAllDebugSessions(): Promise<void> {
    const repl = await this.ensureRepl();
    await repl.shutdown();
  }

  async setBreakpoint(file: string, line: number, condition?: string): Promise<Breakpoint> {
    const repl = await this.ensureRepl();
    return repl.setBreakpoint(file, line, condition);
  }

  async removeBreakpoint(breakpointId: string): Promise<void> {
    const repl = await this.ensureRepl();
    await repl.removeBreakpoint(breakpointId);
  }

  async step(action: 'into' | 'over' | 'out' | 'continue'): Promise<void> {
    const repl = await this.ensureRepl();
    await repl.step(action);
  }

  async inspectVariable(name: string): Promise<VariableInspection> {
    const repl = await this.ensureRepl();
    return repl.inspectVariable(name);
  }

  async evalExpression(expression: string): Promise<EvalResult> {
    const repl = await this.ensureRepl();
    return repl.eval(expression);
  }

  // ===========================================================================
  // Profiler Operations (lazy initialized)
  // ===========================================================================

  async startProfiling(): Promise<void> {
    const profiler = await this.ensureProfiler();
    return profiler.start();
  }

  async stopProfiling(): Promise<ProfileResult> {
    const profiler = await this.ensureProfiler();
    return profiler.stop();
  }

  async findHotspots(): Promise<HotspotResult> {
    const profiler = await this.ensureProfiler();
    return profiler.findHotspots();
  }

  // ===========================================================================
  // Stack Trace Operations (lazy initialized)
  // ===========================================================================

  async parseStackTrace(error: Error | string): Promise<ParsedStackTrace> {
    const stack = await this.ensureStack();
    return stack.parse(error);
  }

  async getStackContext(file: string, line: number): Promise<StackContext> {
    const stack = await this.ensureStack();
    return stack.getContext(file, line);
  }

  // ===========================================================================
  // Database Operations (lazy initialized)
  // ===========================================================================

  async getSchema(): Promise<DatabaseSchema> {
    const db = await this.ensureDb();
    return db.getSchema();
  }

  async shutdownDatabase(): Promise<void> {
    const db = await this.ensureDb();
    await db.shutdown();
  }

  async generateTypes(options?: {
    exportFormat?: 'interface' | 'type' | 'class';
    addNullable?: boolean;
    addOptional?: boolean;
  }): Promise<GeneratedTypes> {
    const db = await this.ensureDb();
    return db.generateTypes(options);
  }

  // ===========================================================================
  // Documentation Operations (lazy initialized)
  // ===========================================================================

  async fetchDocs(url: string): Promise<DocFetchResult> {
    const docs = await this.ensureDocs();
    return docs.fetch(url);
  }

  async searchDocs(query: string): Promise<DocSearchResult> {
    const docs = await this.ensureDocs();
    return docs.search(query);
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
