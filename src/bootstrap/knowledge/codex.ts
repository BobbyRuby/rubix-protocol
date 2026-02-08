/**
 * CODEX Components Knowledge
 */

import type { SelfKnowledgeEntry } from '../../memory/types.js';

export const CODEX_KNOWLEDGE: SelfKnowledgeEntry[] = [
  {
    type: 'component',
    compressed: `COMP:TaskExecutor
TYPE:orchestrator
DOES:decompose→attempt(3x)→heal→escalate
IN:task,context
OUT:result,artifacts
DEPS:TaskDecomposer,CodeGenerator,SelfHealer,EscalationGate
LOC:src/codex/TaskExecutor.ts
LINES:~1800`,
  },
  {
    type: 'component',
    compressed: `COMP:TaskDecomposer
TYPE:analyzer
DOES:break_task→subtasks→dependencies
IN:task_description
OUT:subtasks[type,desc,deps]
DEPS:MemoryEngine
LOC:src/codex/TaskDecomposer.ts`,
  },
  {
    type: 'component',
    compressed: `COMP:CodeGenerator
TYPE:generator
DOES:claude_api→generate_code→parse_files
IN:task,context,model
OUT:file_operations[path,action,code]
DEPS:Anthropic_SDK
LOC:src/codex/CodeGenerator.ts
LINES:~250`,
  },
  {
    type: 'component',
    compressed: `COMP:SelfHealer
TYPE:analyzer
DOES:analyze_failure→find_cause→suggest_fix
IN:error,context,attempt
OUT:cause,fix,strategy
DEPS:CausalDebugger
LOC:src/codex/SelfHealer.ts`,
  },
  {
    type: 'component',
    compressed: `COMP:EscalationGate
TYPE:decision
DOES:determine_escalation→build_context→route
IN:failure,context
OUT:escalation_type,message,channels
DEPS:CommunicationManager
LOC:src/codex/EscalationGate.ts`,
  },
  {
    type: 'component',
    compressed: `COMP:AlternativesFinder
TYPE:generator
DOES:generate_alternatives→rank→recommend
IN:failed_approach,constraints
OUT:alternatives[approach,tradeoff,confidence]
LOC:src/codex/AlternativesFinder.ts`,
  },
  {
    type: 'component',
    compressed: `COMP:CausalDebugger
TYPE:analyzer
DOES:trace_cause→effect_chain→find_root
IN:symptom,stack,state
OUT:causal_chain,root_cause,fix
LOC:src/codex/CausalDebugger.ts`,
  },
  {
    type: 'component',
    compressed: `COMP:LearningIntegration
TYPE:connector
DOES:send_results→track_suggestions→update_patterns
IN:task_result
OUT:learning_applied
DEPS:SonaEngine
LOC:src/codex/LearningIntegration.ts`,
  },
  {
    type: 'component',
    compressed: `COMP:CollaborativePartner
TYPE:advisor
DOES:identify_gaps→challenge_decisions→suggest
IN:context,decisions
OUT:questions,gaps,suggestions
LOC:src/codex/CollaborativePartner.ts`,
  },
  {
    type: 'component',
    compressed: `COMP:WorkingMemoryManager
TYPE:cache
DOES:store_context→retrieve→prune
IN:execution_context
OUT:relevant_memories
DEPS:MemoryEngine
LOC:src/codex/WorkingMemoryManager.ts`,
  },
  {
    type: 'component',
    compressed: `COMP:ContainmentManager
TYPE:sandbox
DOES:isolate_code→prevent_side_effects→rollback
IN:experimental_code
OUT:safe_execution_result
LOC:src/codex/ContainmentManager.ts`,
  },
];
