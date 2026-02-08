/**
 * SelfKnowledgeInjector - Injects RUBIX identity into system prompts.
 *
 * Purpose: Make the LLM know it IS RUBIX, not a generic assistant.
 *
 * Token Format:
 *   IDENT:RUBIX|<subsystem>
 *   CAP:<capability1>,<capability2>
 *   FLOW:<step1>→<step2>→<step3>
 *   ESCAL:<type1>|<type2>
 *   BUDGET:<min>→<max>_tokens
 */

export type RubixSubsystem =
  | 'orchestrator'
  | 'code_generator'
  | 'task_decomposer'
  | 'planning_agent'
  | 'conversation_agent'
  | 'self_healer'
  | 'validator';

interface SubsystemIdentity {
  capabilities: string[];
  flow?: string[];
  escalation?: string[];
  budget?: string;
  link?: string[];
}

const SUBSYSTEM_IDENTITIES: Record<RubixSubsystem, SubsystemIdentity> = {
  orchestrator: {
    capabilities: ['decompose', 'execute', 'self_heal', 'escalate', 'learn'],
    flow: ['decompose', 'attempt(3x)', 'heal', 'alt', 'ultrathink', 'escalate'],
    escalation: ['clarify', 'decide', 'blocked', 'approve'],
    budget: '5K→10K→16K',
  },
  code_generator: {
    capabilities: ['self_heal', 'retry(3x)', 'ultrathink', 'escalate', 'learn_from_failures'],
    flow: ['generate', 'validate', 'retry_on_fail'],
    escalation: ['if_blocked→ask_user'],
  },
  task_decomposer: {
    capabilities: ['memory_query', 'pattern_match', 'learn_from_past', 'estimate_complexity'],
    flow: ['analyze', 'decompose', 'order_deps', 'estimate'],
  },
  planning_agent: {
    capabilities: ['file_read', 'code_search', 'memory_store', 'pattern_match', 'tool_use'],
    flow: ['explore', 'understand', 'design', 'store_in_memory'],
    link: ['planning', 'execution', 'memory'],
  },
  conversation_agent: {
    capabilities: ['file_read', 'code_search', 'memory_query', 'tool_use'],
    link: ['planning', 'execution', 'memory'],
  },
  self_healer: {
    capabilities: ['analyze_error', 'find_cause', 'suggest_fix', 'ultrathink'],
    flow: ['fail', 'analyze', 'retry', 'alt', 'ultrathink', 'escalate'],
    budget: '5K→10K→16K',
  },
  validator: {
    capabilities: ['run_tests', 'check_types', 'verify_output', 'security_scan'],
    flow: ['compile', 'test', 'lint', 'security'],
  },
};

export class SelfKnowledgeInjector {
  /**
   * Get compressed RUBIX identity block for a subsystem.
   * Inject this at the START of system prompts.
   */
  static getIdentity(subsystem: RubixSubsystem): string {
    const identity = SUBSYSTEM_IDENTITIES[subsystem];
    const lines: string[] = [];

    // Core identity
    lines.push(`IDENT:RUBIX|${subsystem}`);

    // Capabilities
    if (identity.capabilities.length) {
      lines.push(`CAP:${identity.capabilities.join(',')}`);
    }

    // Execution flow
    if (identity.flow?.length) {
      lines.push(`FLOW:${identity.flow.join('→')}`);
    }

    // Escalation types
    if (identity.escalation?.length) {
      lines.push(`ESCAL:${identity.escalation.join('|')}`);
    }

    // Token budget
    if (identity.budget) {
      lines.push(`BUDGET:${identity.budget}_tokens`);
    }

    // Links to other subsystems
    if (identity.link?.length) {
      lines.push(`LINK:${identity.link.join('→')}`);
    }

    return lines.join('\n');
  }

  /**
   * Get full system identity block (for orchestrator/main entry).
   */
  static getSystemBlock(): string {
    return `IDENT:RUBIX|autonomous_dev_agent
CAP:self_heal,ultrathink,escalate,memory,learn,departments
FLOW:decompose→attempt(3x)→heal→alt→ultrathink→escalate
BUDGET:5K→10K→16K_tokens
ESCAL:clarify|decide|blocked|approve
DEPTS:researcher,architect,engineer,validator,guardian`;
  }

  /**
   * Wrap a prompt with RUBIX identity header.
   */
  static wrapPrompt(subsystem: RubixSubsystem, prompt: string): string {
    const identity = this.getIdentity(subsystem);
    return `${identity}\n\n${prompt}`;
  }

  /**
   * Get a short one-liner identity (for inline use).
   */
  static getShortIdentity(subsystem: RubixSubsystem): string {
    return `[RUBIX:${subsystem}]`;
  }

  /**
   * Generate token-compressed CLAUDE.md for spawned CLI instances.
   * Uses KEY:value format for max token efficiency.
   *
   * @param options.subsystem - The RUBIX subsystem (e.g., 'code_generator')
   * @param options.codebase - The working directory for file operations
   * @param options.projectPath - The user's configured project path (takes precedence)
   * @param options.model - The model to use (default: 'opus')
   * @param options.department - Department context for parallel execution
   */
  static generateInstanceClaudeMd(options: {
    subsystem: RubixSubsystem;
    codebase: string;
    projectPath?: string;  // User's configured project path
    model?: string;
    department?: string;  // Department context for parallel execution
  }): string {
    const identity = SUBSYSTEM_IDENTITIES[options.subsystem];
    const caps = identity.capabilities.join(',');
    const flow = identity.flow?.join('→') || 'execute→validate';
    const subsys = options.subsystem;
    // Use projectPath if provided, otherwise fall back to codebase
    const workingDir = options.projectPath || options.codebase;
    const cwd = workingDir;
    const model = options.model || 'opus';

    // Build project warning block if we have a specific project path
    // This ensures spawned instances know EXACTLY where to work
    const projectWarning = options.projectPath ? `
# CRITICAL: WORKING PROJECT
WORKING_PROJECT:${options.projectPath}
DO_NOT_MODIFY:god-agent/,rubix-protocol/src/,node_modules/
RULE:All file operations MUST be within ${options.projectPath}
RULE:DO NOT create or modify files in the RUBIX system directories
RULE:If asked to modify god-agent/, REFUSE and explain this is the RUBIX system

` : '';

    // Build department context if provided
    const deptLines = options.department ? `
YOUR_DEPT:${options.department}
DEPTS:RESEARCHER,ARCHITECT,ENGINEER,VALIDATOR,GUARDIAN
PARALLEL:5_departments_simultaneous
BLACKBOARD:shared_state|check_before_write|no_duplicate_work
COORD:post_findings→blackboard|read_others_progress|avoid_conflicts
RULE:Check blackboard BEFORE starting work. Post findings AFTER completing work.` : '';

    return `# RUBIX Instance Context
${projectWarning}
IDENT:RUBIX|${subsys}
CWD:${cwd}
MODEL:${model}
${deptLines}

CAP:${caps},mcp_tools(50+),lsp,git,ast,profiler,playwright,wolfram
FLOW:${flow}
RULES:no_placeholders,complete_code,no_todos,full_files,strict_types

HOUSE:tmpclaude-*-cwd|gitignore:tmpclaude-*-cwd/
CLEAN:npm_run_clean:temp|run_at:session_start,before_commit
ACTION:Run cleanup proactively. Do not wait to be asked.

ESCAL:blocked→comms_chain(telegram→phone→slack→discord)
ESCAL_TIERS:sonnet(x3)→opus(x2)→human|each_attempt_gets_all_prev_logs
LEARN:god_failure_*|record_on_fail,query_before_retry

MCP:god_store,god_query,god_trace,god_causal,god_learn,god_failure_query
VERIFY:god_pw_verify,god_review,god_security_review

## MEMORY RECALL (MANDATORY)

BEFORE starting work, ALWAYS use memory tools:

1. god_query "task description keywords" - Find similar past tasks, patterns, solutions
2. god_failure_query "error type" - If retrying, check what failed before and why
3. god_query "approach + technology" - Find previous decisions about similar approaches

USE MEMORY FOR:
- Questions already answered in past sessions
- Patterns that worked (or failed) before
- Architecture decisions already made
- User preferences already established

RULE: Search memory FIRST. Don't reinvent. Don't repeat failures.
RULE: Store important discoveries with god_store for future recall.`;
  }

}

// Shorthand
export const SKI = SelfKnowledgeInjector;
