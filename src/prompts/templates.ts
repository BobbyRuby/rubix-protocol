/**
 * Compressed Prompt Templates
 *
 * Format:
 * VERB
 * KEY:value
 * →{output_schema}
 *
 * Rules:
 * - No articles (a, an, the)
 * - No pronouns (you, I, we)
 * - No politeness (please, thanks)
 * - No hedging (maybe, might, could)
 * - No filler (basically, actually, really)
 */

import { PC } from './PromptCompressor.js';

// ============================================================================
// RUBIX ORCHESTRATOR
// ============================================================================

export const PLAN_EXEC = (task: string, codebase: string) => `PLAN_EXEC
TASK:${task}
CODEBASE:${codebase}
DEPTS:research→architect→engineer→validate+guard
→{phases:[{order:n,depts:[],goal:""}],size:S|M|L|XL}`;

// ============================================================================
// DEPARTMENT HEADS
// ============================================================================

export const RESEARCH = (task: string, codebase: string) => `RESEARCH
TARGET:${task}
ROOT:${codebase}
SCAN:structure,patterns,deps,conventions
→{files:[],patterns:[],deps:{},conventions:[],risks:[]}`;

export const DESIGN = (task: string, findings: string) => `DESIGN
TASK:${task}
RESEARCH:${findings}
→{components:[{name,responsibility,interface}],dataflow:[],contracts:[]}`;

export const BUILD = (spec: string, lang: string, conventions: string) => `BUILD
DESIGN:${spec}
LANG:${lang}
STYLE:${conventions}
→{files:[{path,action:create|modify,code:""}]}`;

export const TEST = (files: string, expected: string) => `TEST
CODE:${files}
SPEC:${expected}
COVER:unit,integration,edge
→{tests:[{path,code}],run:{pass:n,fail:n,coverage:%}}`;

export const GUARD = (files: string) => `GUARD
CODE:${files}
CHECK:security,perf,quality,owasp
→{issues:[{severity:crit|high|med|low,file,line,desc}],approved:bool}`;

// ============================================================================
// CODEX COMPONENTS
// ============================================================================

export const GEN = (task: string, ctx: Record<string, unknown>, lang: string) => `GEN
TASK:${task}
CTX:${PC.ctx(ctx)}
LANG:${lang}
→<file path="" action="create|modify">code</file>`;

export const DECOMPOSE = (task: string) => `DECOMPOSE
TASK:${task}
TYPES:research,design,code,test,integrate,verify,review
→{subtasks:[{id,type,desc,deps:[ids],parallel:bool}]}`;

export const HEAL = (
  errType: string,
  errMsg: string,
  stack: string,
  attempt: number,
  prevFixes: string[]
) => `HEAL
ERR:${errType}|${errMsg.slice(0, 200)}
STACK:${PC.stack(stack)}
ATTEMPT:${attempt}/3
PREV_FIXES:${prevFixes.join(',')}
→{cause:"",fix:"",confidence:0-1,strategy:retry|alt|escalate}`;

export const ALT = (failed: string, constraints: string, goal: string) => `ALT
FAILED:${failed}
CONSTRAINT:${constraints}
GOAL:${goal}
→{alternatives:[{approach,tradeoff,confidence}],recommended:0}`;

export const DEBUG = (symptom: string, trace: string, state: string) => `DEBUG
SYMPTOM:${symptom}
STACK:${PC.stack(trace)}
STATE:${state}
→{chain:[{cause,effect}],root:"",fix:""}`;

// ============================================================================
// LEARNING & REVIEW
// ============================================================================

export const LEARN = (
  result: 'success' | 'fail',
  trajectory: string,
  pattern: string
) => `LEARN
RESULT:${result}
TRAJECTORY:${trajectory}
PATTERN:${pattern}
→{update:{pattern,weight_delta},new_pattern?:{name,trigger,action}}`;

export const REVIEW = (diff: string) => `REVIEW
DIFF:${diff}
RULES:security,perf,maintainability,types
→{issues:[{line,severity,msg}],suggestions:[],approve:bool}`;

// ============================================================================
// CURIOSITY PROBES
// ============================================================================

export interface ProbeContext {
  domain: string;
  errorType?: string;
  errorMsg?: string;
  stackTrace?: string;
  patternName?: string;
  successRate?: number;
  uses?: number;
  recentFailures?: { type: string }[];
  question?: string;
  relatedPatterns?: string[];
  context?: Record<string, unknown>;
}

export const PROBE_FAILURE = (p: ProbeContext) => `PROBE:fail|${p.domain}
ERR:${p.errorType}|${(p.errorMsg || '').slice(0, 200)}
STACK:${PC.stack(p.stackTrace || '')}
CTX:${PC.ctx(p.context || {})}
→{cause:"",fix:"",pattern_update:"",confidence:0-1}`;

export const PROBE_LOW_CONFIDENCE = (p: ProbeContext) => `PROBE:uncertain|${p.domain}
PATTERN:${p.patternName}|success:${p.successRate}
FAILS:${(p.recentFailures || []).map(f => f.type).join(',')}
→{why_failing:"",improve:"",confidence:0-1}`;

export const PROBE_KNOWLEDGE_GAP = (p: ProbeContext) => `PROBE:gap|${p.domain}
UNKNOWN:${p.question}
RELATED:${(p.relatedPatterns || []).join(',')}
→{learned:"",store:[],confidence:0-1}`;

export const PROBE_SUCCESS_CONFIRM = (p: ProbeContext) => `PROBE:confirm|${p.domain}
PATTERN:${p.patternName}|success:${p.successRate}|uses:${p.uses}
→{why_works:"",key_factors:[],confidence:0-1}`;

// ============================================================================
// TEMPLATE REGISTRY
// ============================================================================

export const TEMPLATES = {
  // Orchestrator
  PLAN_EXEC,

  // Departments
  RESEARCH,
  DESIGN,
  BUILD,
  TEST,
  GUARD,

  // Codex
  GEN,
  DECOMPOSE,
  HEAL,
  ALT,
  DEBUG,

  // Learning
  LEARN,
  REVIEW,

  // Curiosity
  PROBE_FAILURE,
  PROBE_LOW_CONFIDENCE,
  PROBE_KNOWLEDGE_GAP,
  PROBE_SUCCESS_CONFIRM,
} as const;

export type TemplateName = keyof typeof TEMPLATES;
