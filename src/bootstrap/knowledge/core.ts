/**
 * Core Systems Knowledge
 */

import type { SelfKnowledgeEntry } from '../../memory/types.js';

export const CORE_KNOWLEDGE: SelfKnowledgeEntry[] = [
  {
    type: 'component',
    compressed: `COMP:MemoryEngine
TYPE:facade
DOES:store→query→causal→learn→route
SUBS:SQLite,VectorDB,Provenance,Causal,Sona,TinyDancer,GNN,Shadow
API:store(),query(),addCausal(),queryWithLearning(),routeQuery()
LOC:src/core/MemoryEngine.ts
LINES:~1075`,
  },
  {
    type: 'component',
    compressed: `COMP:VectorDB
TYPE:index
DOES:embed→index→search_hnsw
IN:text,embedding
OUT:top_k_results[score,id]
CONFIG:768dim,maxElements:100000,efSearch:100
LOC:src/vector/VectorDB.ts`,
  },
  {
    type: 'component',
    compressed: `COMP:SQLiteStorage
TYPE:persistence
DOES:store→retrieve→query→migrate
TABLES:memory_entries,tags,provenance,causal,patterns,tasks
LOC:src/storage/SQLiteStorage.ts`,
  },
  {
    type: 'component',
    compressed: `COMP:ProvenanceStore
TYPE:tracker
DOES:track_lineage→calculate_lscore→validate
IN:entry,parents
OUT:lscore,depth,reliability
CONFIG:threshold:0.3,decay:0.9
LOC:src/provenance/ProvenanceStore.ts`,
  },
  {
    type: 'component',
    compressed: `COMP:CausalMemory
TYPE:graph
DOES:add_relation→find_paths→traverse→cleanup_ttl
RELATIONS:causes,enables,prevents,correlates,precedes,triggers
SUPPORT:n_to_m,ttl_expiry
LOC:src/causal/CausalMemory.ts`,
  },
  {
    type: 'component',
    compressed: `COMP:SonaEngine
TYPE:learner
DOES:create_trajectory→provide_feedback→update_weights
FEATURES:ewc++,drift_detection,auto_prune,auto_boost
THRESHOLDS:prune<40%,boost>80%
LOC:src/learning/SonaEngine.ts`,
  },
  {
    type: 'component',
    compressed: `COMP:TinyDancer
TYPE:router
DOES:analyze_query→select_route→circuit_breaker
ROUTES:pattern_match,causal_forward,causal_backward,temporal_causal,hybrid,direct_retrieval,adversarial
PROTECTION:5_failures_60s→open,5min_cooldown
LOC:src/routing/TinyDancer.ts`,
  },
  {
    type: 'component',
    compressed: `COMP:EnhancementLayer
TYPE:gnn
DOES:extract_ego_graph→message_passing→project
IN:768dim_embedding
OUT:1024dim_enhanced
CACHE:lru
LOC:src/gnn/EnhancementLayer.ts`,
  },
  {
    type: 'component',
    compressed: `COMP:ShadowSearch
TYPE:adversarial
DOES:invert_embedding→find_contradictions→calculate_credibility
TYPES:direct_negation,counterargument,falsification,alternative,exception
LOC:src/adversarial/ShadowSearch.ts`,
  },
  {
    type: 'component',
    compressed: `COMP:CommunicationManager
TYPE:orchestrator
DOES:escalate→fallback_chain→timeout_5min
CHAIN:telegram→phone→sms→slack→discord→email
LOC:src/communication/CommunicationManager.ts`,
  },
  {
    type: 'component',
    compressed: `COMP:SchedulerDaemon
TYPE:daemon
DOES:register_task→evaluate_trigger→execute→track_run
TRIGGERS:datetime,cron,event,file,manual
LOC:src/scheduler/SchedulerDaemon.ts`,
  },
  {
    type: 'component',
    compressed: `COMP:CuriosityTracker
TYPE:tracker
DOES:record_probe→prioritize→select→track_discovery
ORIGINS:failure(1.0),low_confidence(0.7),knowledge_gap(0.5),success_confirmation(0.2)
PATTERN:3_high_1_moderate
LOC:src/curiosity/CuriosityTracker.ts`,
  },
];
