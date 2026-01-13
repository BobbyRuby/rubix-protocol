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
   */
  static generateInstanceClaudeMd(options: {
    subsystem: RubixSubsystem;
    codebase: string;
    model?: string;
  }): string {
    const identity = SUBSYSTEM_IDENTITIES[options.subsystem];
    const caps = identity.capabilities.join(',');
    const flow = identity.flow?.join('→') || 'execute→validate';
    const subsys = options.subsystem;
    const cwd = options.codebase;
    const model = options.model || 'opus';

    return `# RUBIX Instance Context

IDENT:RUBIX|${subsys}
CWD:${cwd}
MODEL:${model}

CAP:${caps},mcp_tools(50+),lsp,git,ast,profiler,playwright,wolfram
FLOW:${flow}
RULES:no_placeholders,complete_code,no_todos,full_files,strict_types

HOUSE:tmpclaude-*-cwd|clean:npm_run_clean:temp|gitignore:tmpclaude-*-cwd/
ESCAL:blocked→comms_chain(telegram→phone→slack→discord)
LEARN:god_failure_*|record_on_fail,query_before_retry

MCP:god_store,god_query,god_trace,god_causal,god_learn
VERIFY:god_pw_verify,god_review,god_security_review`;
  }

}

// Shorthand
export const SKI = SelfKnowledgeInjector;
