/**
 * SelfKnowledgeBootstrap - RUBIX self-knowledge in pure token format.
 *
 * 12 dense entries covering all RUBIX systems.
 * Each entry can be decompressed to human-readable form on demand.
 *
 * Token Schema:
 *   SYS:   System name
 *   TYPE:  System type
 *   CAP:   Capabilities (comma-separated)
 *   FLOW:  Process flow (arrow-separated)
 *   TECH:  Technologies
 *   CFG:   Configuration (key=value pairs)
 *   DEPT:  Departments
 *   TOOL:  Tools
 *   SUB:   Subsystems
 *   ENTRY: Entry points
 *   ROUTES: Available routes
 *   CHANNELS: Communication channels
 */

import { MemoryEngine } from '../core/MemoryEngine.js';
import { MemorySource } from '../core/types.js';
import { SelfKnowledgeCompressor } from '../prompts/SelfKnowledgeCompressor.js';

/**
 * Token-format self-knowledge entries.
 */
export const RUBIX_SELF_KNOWLEDGE: string[] = [
  // 1. Core Architecture
  `SYS:rubix
TYPE:autonomous_agent
CAP:mcp,cli,standalone,telegram
TECH:typescript,sqlite,hnsw,768dim
ENTRY:mcp-server.ts,cli/index.ts,TelegramBot.ts`,

  // 2. Memory Engine
  `SYS:memory-engine
TYPE:memory_system
CAP:store,query,trace,learn,enhance,shadow
SUB:VectorDB,Provenance,CausalMemory,Sona,GNN,ShadowSearch
TECH:sqlite,hnsw,embeddings
FLOW:input→embed→store→index→query`,

  // 3. Self-Healing
  `SYS:self-heal
TYPE:recovery_system
FLOW:fail→analyze→retry→alternative→ultrathink→escalate
CFG:budget_base=5000,budget_step=5000,budget_max=16000
SUB:SelfHealer,AlternativesFinder,EscalationGate`,

  // 4. Departments
  `SYS:rubix-departments
TYPE:organizational
DEPT:researcher,architect,engineer,validator,guardian
CAP:parallel_execution,sub_agents,autonomous
FLOW:research→design→implement→test→secure`,

  // 5. Query Routing
  `SYS:tiny-dancer
TYPE:neural_router
CAP:route,circuit_break,fallback
ROUTES:pattern_match,causal_forward,causal_backward,temporal,hybrid,direct,adversarial
CFG:fail_threshold=5,cooldown=5min`,

  // 6. Learning Engine
  `SYS:sona
TYPE:learning_engine
CAP:trajectory,feedback,prune,boost
ALGO:ewc++,lora_style
CFG:prune_threshold=0.4,boost_threshold=0.8`,

  // 7. Provenance
  `SYS:l-score
TYPE:reliability_tracking
FLOW:store→calculate→track→decay
CFG:user=1.0,tool=0.9,agent=0.8,external=0.7
TIERS:high>=0.8,medium>=0.5,low>=0.3`,

  // 8. MCP Tools
  `SYS:mcp-tools
TYPE:tool_registry
COUNT:70+
MEMORY:store,query,edit,delete,trace,stats,checkpoint
CAUSAL:causal,find_paths,cleanup_expired
LEARN:learn,learning_stats,prune_patterns
ROUTE:route,route_result,circuit_status
CODEX:codex_do,codex_status,codex_history`,

  // 9. Communication
  `SYS:communication
TYPE:escalation_system
FLOW:event→escalation→channel_chain→response
CHANNELS:telegram,phone,sms,slack,discord,email
CFG:timeout_per_channel=5min
TRIGGERS:blocked,security,approval`,

  // 10. Input Compression
  `SYS:input-compressor
TYPE:bidirectional
CAP:compress,decompress
FLOW:input→strip_fluff→tokenize→format
OUTPUT:TASK,DO,TARGET,TYPE,TECH,LOC
CFG:reduction=50-65%`,

  // 11. Scheduler
  `SYS:scheduler-daemon
TYPE:task_scheduler
CAP:cron,event,file_watch,manual
FLOW:trigger→load_context→execute→store_result
TOOL:schedule,trigger,tasks,pause,resume,cancel`,

  // 12. Capabilities
  `SYS:capabilities
TYPE:ide_powers
COUNT:10
LIST:LSP,Git,StaticAnalysis,AST,DependencyGraph,DocMiner,REPL,Profiler,StackTrace,DatabaseIntrospection
FLOW:detect→initialize→use→cache`,
];

/**
 * Bootstrap RUBIX with self-knowledge in token format.
 */
export async function bootstrapSelfKnowledge(engine: MemoryEngine): Promise<void> {
  console.log('[SelfKnowledge] Bootstrapping RUBIX self-knowledge...');

  let stored = 0;
  let skipped = 0;

  for (const tokens of RUBIX_SELF_KNOWLEDGE) {
    // Extract system name for checking duplicates
    const sysMatch = tokens.match(/^SYS:(.+)$/m);
    const sysName = sysMatch?.[1] || 'unknown';

    // Check if already exists
    const existing = await engine.query(`SYS:${sysName}`, {
      filters: { tags: ['rubix:self'] },
      topK: 1,
    });

    if (existing.length > 0 && existing[0].score > 0.95) {
      skipped++;
      continue;
    }

    // Store the token-format entry
    await engine.store(tokens, {
      tags: ['rubix:self', `rubix:${sysName}`],
      source: MemorySource.SYSTEM,
      importance: 1.0,
      confidence: 1.0,
    });

    stored++;
  }

  console.log(`[SelfKnowledge] Bootstrap complete: ${stored} stored, ${skipped} skipped (already exist)`);
}

/**
 * Query self-knowledge with optional decompression.
 */
export async function querySelfKnowledge(
  engine: MemoryEngine,
  query: string,
  format: 'tokens' | 'readable' | 'full' = 'readable'
): Promise<string[]> {
  const results = await engine.query(query, {
    filters: { tags: ['rubix:self'] },
    topK: 5,
  });

  return results.map(r => {
    const tokens = r.entry.content;
    switch (format) {
      case 'tokens':
        return tokens;
      case 'full':
        return SelfKnowledgeCompressor.decompressFull(tokens);
      case 'readable':
      default:
        return SelfKnowledgeCompressor.decompress(tokens);
    }
  });
}

/**
 * List all self-knowledge entries.
 */
export async function listSelfKnowledge(
  engine: MemoryEngine,
  format: 'tokens' | 'readable' | 'full' = 'readable'
): Promise<string[]> {
  const results = await engine.query('SYS rubix system', {
    filters: { tags: ['rubix:self'] },
    topK: 20,
  });

  return results.map(r => {
    const tokens = r.entry.content;
    switch (format) {
      case 'tokens':
        return tokens;
      case 'full':
        return SelfKnowledgeCompressor.decompressFull(tokens);
      case 'readable':
      default:
        return SelfKnowledgeCompressor.decompress(tokens);
    }
  });
}
