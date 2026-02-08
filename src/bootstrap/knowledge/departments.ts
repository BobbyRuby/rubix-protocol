/**
 * RUBIX Department Knowledge
 */

import type { SelfKnowledgeEntry } from '../../memory/types.js';

export const DEPARTMENT_KNOWLEDGE: SelfKnowledgeEntry[] = [
  {
    type: 'department',
    compressed: `DEPT:Researcher
ROLE:VP_Discovery
DOES:analyze,map,patterns,deps,conventions
AGENTS:file_analyzer,pattern_matcher,dep_grapher,doc_miner
PHASE:1
LOC:src/rubix/departments/Researcher.ts`,
  },
  {
    type: 'department',
    compressed: `DEPT:Architect
ROLE:VP_Design
DOES:design,structure,interfaces,data_models,contracts
AGENTS:structure_designer,interface_designer,data_modeler,module_planner
PHASE:2
LOC:src/rubix/departments/Architect.ts`,
  },
  {
    type: 'department',
    compressed: `DEPT:Engineer
ROLE:VP_Implementation
DOES:build,code,implement,integrate
AGENTS:logic_builder,component_builder,algorithm_writer,integrator
PHASE:3
LOC:src/rubix/departments/Engineer.ts`,
  },
  {
    type: 'department',
    compressed: `DEPT:Validator
ROLE:VP_Quality
DOES:test,verify,validate,edge_cases
AGENTS:unit_tester,integration_tester,edge_finder,type_validator
PHASE:4
LOC:src/rubix/departments/Validator.ts`,
  },
  {
    type: 'department',
    compressed: `DEPT:Guardian
ROLE:VP_Reliability
DOES:security,performance,review,protect
AGENTS:security_scanner,perf_profiler,style_reviewer,resilience_checker
PHASE:4
LOC:src/rubix/departments/Guardian.ts`,
  },
];
