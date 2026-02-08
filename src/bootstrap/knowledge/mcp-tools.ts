/**
 * MCP Tools Knowledge
 */

import type { SelfKnowledgeEntry } from '../../memory/types.js';

export const MCP_TOOL_KNOWLEDGE: SelfKnowledgeEntry[] = [
  // Memory tools
  {
    type: 'mcp_tool',
    compressed: `TOOL:god_store
DOES:persist_memory_with_provenance
IN:{content:str,tags:[],importance:0-1,source:enum,parentIds:[]}
OUT:{id:str,lScore:num}
USE:save_facts,track_lineage,build_knowledge`,
  },
  {
    type: 'mcp_tool',
    compressed: `TOOL:god_query
DOES:semantic_search_with_filters
IN:{query:str,tags:[],topK:num,minImportance:num}
OUT:{results:[{content,score,id,tags}],trajectoryId}
USE:find_memories,retrieve_context,search_knowledge`,
  },
  {
    type: 'mcp_tool',
    compressed: `TOOL:god_trace
DOES:trace_provenance_lineage
IN:{entryId:str,depth:num}
OUT:{lScore,lineageDepth,parents,reliability}
USE:validate_reliability,check_source,trace_origins`,
  },
  {
    type: 'mcp_tool',
    compressed: `TOOL:god_edit
DOES:update_existing_entry
IN:{entryId:str,content:str,tags:[],importance:num}
OUT:{updated:bool}
USE:modify_memory,update_tags,change_importance`,
  },
  {
    type: 'mcp_tool',
    compressed: `TOOL:god_delete
DOES:remove_memory_permanently
IN:{entryId:str,confirm:bool}
OUT:{deleted:bool}
USE:remove_outdated,cleanup,delete_incorrect`,
  },
  {
    type: 'mcp_tool',
    compressed: `TOOL:god_stats
DOES:get_memory_statistics
IN:{}
OUT:{totalEntries,vectorCount,causalRelations,avgLScore}
USE:monitor_health,check_usage,audit_system`,
  },

  // Causal tools
  {
    type: 'mcp_tool',
    compressed: `TOOL:god_causal
DOES:add_causal_relationship
IN:{sourceIds:[],targetIds:[],type:enum,strength:0-1,ttl:ms}
OUT:{relationId:str}
USE:track_causation,link_events,model_effects`,
  },
  {
    type: 'mcp_tool',
    compressed: `TOOL:god_find_paths
DOES:discover_causal_chains
IN:{sourceId:str,targetId:str,maxDepth:num}
OUT:{paths:[[ids]],strengths:[]}
USE:understand_causation,trace_effects,debug_chains`,
  },

  // Learning tools
  {
    type: 'mcp_tool',
    compressed: `TOOL:god_learn
DOES:provide_query_feedback
IN:{trajectoryId:str,quality:0-1,route:str}
OUT:{updated:bool}
USE:improve_retrieval,train_patterns,adjust_weights`,
  },
  {
    type: 'mcp_tool',
    compressed: `TOOL:god_learning_stats
DOES:get_learning_metrics
IN:{}
OUT:{trajectories,feedbackCount,patterns,driftScore}
USE:monitor_learning,check_drift,audit_patterns`,
  },

  // Routing tools
  {
    type: 'mcp_tool',
    compressed: `TOOL:god_route
DOES:select_optimal_reasoning_strategy
IN:{query:str,preferredRoute:enum}
OUT:{route:enum,confidence:num,alternatives:[]}
USE:optimize_queries,select_strategy,route_reasoning`,
  },
  {
    type: 'mcp_tool',
    compressed: `TOOL:god_circuit_status
DOES:check_circuit_breaker_states
IN:{}
OUT:{routes:{state,failures,cooldownEnds}}
USE:debug_routing,check_health,monitor_failures`,
  },

  // CODEX tools
  {
    type: 'mcp_tool',
    compressed: `TOOL:god_codex_do
DOES:submit_autonomous_task
IN:{description:str,priority:num,context:{}}
OUT:{taskId:str,status:pending}
USE:execute_tasks,run_code,automate_work`,
  },
  {
    type: 'mcp_tool',
    compressed: `TOOL:god_codex_status
DOES:poll_task_execution_status
IN:{taskId:str}
OUT:{status,progress,result,escalation}
USE:check_progress,monitor_task,get_result`,
  },
  {
    type: 'mcp_tool',
    compressed: `TOOL:god_codex_answer
DOES:provide_escalation_response
IN:{taskId:str,answer:str}
OUT:{acknowledged:bool}
USE:respond_to_question,unblock_task,provide_decision`,
  },

  // Scheduler tools
  {
    type: 'mcp_tool',
    compressed: `TOOL:god_schedule
DOES:create_scheduled_task
IN:{name:str,prompt:str,trigger:{type,pattern},contextQuery:str}
OUT:{taskId:str}
USE:automate_recurring,schedule_future,setup_triggers`,
  },
  {
    type: 'mcp_tool',
    compressed: `TOOL:god_trigger
DOES:manually_fire_task_or_event
IN:{taskId:str,event:str}
OUT:{triggered:bool}
USE:force_execution,fire_event,test_task`,
  },
  {
    type: 'mcp_tool',
    compressed: `TOOL:god_tasks
DOES:list_scheduled_tasks
IN:{status:enum,limit:num}
OUT:{tasks:[{id,name,trigger,lastRun,nextRun}]}
USE:view_schedule,check_tasks,monitor_queue`,
  },

  // Shadow search
  {
    type: 'mcp_tool',
    compressed: `TOOL:god_shadow_search
DOES:find_contradictory_evidence
IN:{query:str,topK:num,threshold:num}
OUT:{contradictions:[],credibility:num}
USE:risk_assessment,bias_detection,devils_advocate`,
  },

  // Enhancement tools
  {
    type: 'mcp_tool',
    compressed: `TOOL:god_enhance
DOES:gnn_enhance_embedding
IN:{entryId:str,includeWeights:bool}
OUT:{enhancedDim:1024,neighborsUsed:num}
USE:improve_retrieval,enrich_context,boost_search`,
  },

  // Curiosity tools
  {
    type: 'mcp_tool',
    compressed: `TOOL:god_curiosity_list
DOES:list_pending_curiosity_probes
IN:{limit:num,origin:enum}
OUT:{probes:[{id,domain,question,priority,origin}]}
USE:view_curiosities,check_pending,monitor_learning`,
  },
  {
    type: 'mcp_tool',
    compressed: `TOOL:god_curiosity_explore
DOES:trigger_probe_exploration
IN:{probeId:str}
OUT:{result:{findings,tokensUsed,success}}
USE:explore_now,manual_discovery,investigate_gap`,
  },
  {
    type: 'mcp_tool',
    compressed: `TOOL:god_budget_status
DOES:check_exploration_budget
IN:{}
OUT:{weeklyStats:{probesUsed,remaining,pattern,tokensUsed}}
USE:check_budget,monitor_spending,plan_exploration`,
  },

  // Checkpoint
  {
    type: 'mcp_tool',
    compressed: `TOOL:god_checkpoint
DOES:create_git_trackable_database_snapshot
IN:{overwrite:bool}
OUT:{filename:str,path:str}
USE:backup_state,version_memory,track_changes`,
  },
];
