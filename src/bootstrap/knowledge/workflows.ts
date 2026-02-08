/**
 * Key Workflows Knowledge
 */

import type { SelfKnowledgeEntry } from '../../memory/types.js';

export const WORKFLOW_KNOWLEDGE: SelfKnowledgeEntry[] = [
  {
    type: 'workflow',
    compressed: `FLOW:task_execution
STEPS:submit→decompose→attempt(3x,heal)→escalate?→complete
ACTORS:TaskExecutor,TaskDecomposer,CodeGenerator,SelfHealer,EscalationGate
BUDGET:ultrathink(5K→10K→16K)`,
  },
  {
    type: 'workflow',
    compressed: `FLOW:query_lifecycle
STEPS:input→route(TinyDancer)→embed→search(HNSW)→filter→learn(Sona)
ACTORS:MemoryEngine,TinyDancer,VectorDB,SonaEngine`,
  },
  {
    type: 'workflow',
    compressed: `FLOW:escalation_chain
STEPS:determine_type→build_context→try_channel(5min)→fallback_next
CHANNELS:telegram→phone→sms→slack→discord→email
ACTORS:EscalationGate,CommunicationManager`,
  },
  {
    type: 'workflow',
    compressed: `FLOW:rubix_execution
STEPS:plan→research(phase1)→architect(phase2)→engineer(phase3)→validate+guard(phase4)
ACTORS:RubixOrchestrator,Researcher,Architect,Engineer,Validator,Guardian
PARALLEL:per_department,per_file`,
  },
  {
    type: 'workflow',
    compressed: `FLOW:discovery_cycle
STEPS:check_budget→select_probe(3:1)→explore→record→learn
ACTORS:AutonomousDiscoveryEngine,CuriosityTracker,TokenBudgetManager
SCHEDULE:Mon/Wed/Fri_8am`,
  },
  {
    type: 'workflow',
    compressed: `FLOW:memory_store
STEPS:validate→compress?→embed(768dim)→calculate_lscore→persist_sqlite→index_hnsw
ACTORS:MemoryEngine,MemoryCompressor,EmbeddingService,ProvenanceStore,VectorDB`,
  },
  {
    type: 'workflow',
    compressed: `FLOW:learning_feedback
STEPS:create_trajectory→receive_feedback(0-1)→update_weights(EWC++)→check_drift→prune_or_boost
ACTORS:SonaEngine,TrajectoryStore,WeightManager,EWCRegularizer
THRESHOLDS:prune<40%,boost>80%,drift>0.3`,
  },
];
