/**
 * IDE Capabilities Knowledge
 */

import type { SelfKnowledgeEntry } from '../../memory/types.js';

export const CAPABILITY_KNOWLEDGE: SelfKnowledgeEntry[] = [
  {
    type: 'capability',
    compressed: `CAP:LSP
DOES:goto_def,find_refs,diagnostics,symbols,check_availability
LANG:ts,js,php,css,html,sql,java,py,go,rust
SERVERS:typescript-language-server,intelephense,vscode-langservers-extracted,sql-language-server,jdtls,pyright,gopls,rust-analyzer
API:goToDefinition(),findReferences(),getDiagnostics(),getSymbols(),checkAvailability()
LOC:src/capabilities/lsp/`,
  },
  {
    type: 'capability',
    compressed: `CAP:Git
DOES:blame,bisect,history,branch_analysis,diff
API:blame(),bisect(),getHistory(),analyzeBranch(),getDiff()
LOC:src/capabilities/git/`,
  },
  {
    type: 'capability',
    compressed: `CAP:StaticAnalysis
DOES:eslint,typescript_check,lint,type_check
LANG:ts,js
API:analyze(),lint(),checkTypes()
LOC:src/capabilities/analysis/`,
  },
  {
    type: 'capability',
    compressed: `CAP:AST
DOES:parse,traverse,refactor,transform
LANG:ts,js
API:parse(),traverse(),transform(),refactor()
LOC:src/capabilities/ast/`,
  },
  {
    type: 'capability',
    compressed: `CAP:DependencyGraph
DOES:analyze_imports,impact_analysis,find_chains
API:buildGraph(),analyzeImpact(),findImportChains()
LOC:src/capabilities/deps/`,
  },
  {
    type: 'capability',
    compressed: `CAP:DocMiner
DOES:fetch_docs,cache,extract_api
CONFIG:cacheTTL:3600
API:fetchDocs(),getCached(),extractAPI()
LOC:src/capabilities/docs/`,
  },
  {
    type: 'capability',
    compressed: `CAP:REPL
DOES:live_inspect,evaluate,watch
ENABLED:false
API:evaluate(),inspect(),watch()
LOC:src/capabilities/repl/`,
  },
  {
    type: 'capability',
    compressed: `CAP:Profiler
DOES:cpu_profile,memory_profile,performance
ENABLED:false
API:startProfile(),stopProfile(),analyze()
LOC:src/capabilities/profiler/`,
  },
  {
    type: 'capability',
    compressed: `CAP:StackTrace
DOES:parse_error,extract_frames,locate_source
API:parse(),extractFrames(),locateSource()
LOC:src/capabilities/stacktrace/`,
  },
  {
    type: 'capability',
    compressed: `CAP:Database
DOES:introspect_schema,analyze_queries,optimize
ENABLED:false
API:getSchema(),analyzeQuery(),suggestOptimizations()
LOC:src/capabilities/database/`,
  },
];
