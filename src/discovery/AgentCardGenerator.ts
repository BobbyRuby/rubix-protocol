/**
 * AgentCardGenerator
 *
 * Generates A2A-compatible Agent Card JSON describing RUBIX capabilities.
 * Enables capability discovery, cost negotiation, and task routing.
 *
 * Key Features:
 * - Generate from MCP tool definitions
 * - Generate from CapabilitiesManager
 * - Export to JSON file
 * - Validate against A2A schema
 */

import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type {
  AgentCard,
  Capability,
  CapabilityCategory,
  CapabilityExample,
  MCPTool,
  GeneratorOptions,
  ValidationResult,
  ValidationError,
  ValidationWarning,
  JSONSchema,
  EstimatedTokens
} from './types.js';

/**
 * Category mapping for MCP tools
 */
const TOOL_CATEGORIES: Record<string, CapabilityCategory> = {
  god_store: 'memory',
  god_query: 'memory',
  god_edit: 'memory',
  god_delete: 'memory',
  god_trace: 'memory',
  god_stats: 'memory',
  god_checkpoint: 'memory',
  god_causal: 'causal',
  god_find_paths: 'causal',
  god_cleanup_expired: 'causal',
  god_learn: 'learning',
  god_learning_stats: 'learning',
  god_prune_patterns: 'learning',
  god_shadow_search: 'learning',
  god_route: 'routing',
  god_route_result: 'routing',
  god_routing_stats: 'routing',
  god_circuit_status: 'routing',
  god_reset_circuit: 'routing',
  god_codex_do: 'codex',
  god_codex_status: 'codex',
  god_codex_cancel: 'codex',
  god_codex_answer: 'codex',
  god_codex_decision: 'codex',
  god_codex_log: 'codex',
  god_codex_logs: 'codex',
  god_codex_wait: 'codex',
  god_deepwork_start: 'deepwork',
  god_deepwork_pause: 'deepwork',
  god_deepwork_resume: 'deepwork',
  god_deepwork_status: 'deepwork',
  god_deepwork_checkpoint: 'deepwork',
  god_deepwork_log: 'deepwork',
  god_pw_launch: 'playwright',
  god_pw_close: 'playwright',
  god_pw_navigate: 'playwright',
  god_pw_screenshot: 'playwright',
  god_pw_action: 'playwright',
  god_pw_assert: 'playwright',
  god_pw_console: 'playwright',
  god_pw_verify: 'playwright',
  god_review: 'review',
  god_quick_review: 'review',
  god_security_review: 'review',
  god_review_config: 'review',
  god_notify: 'notification',
  god_notify_slack: 'notification',
  god_notify_discord: 'notification',
  god_notify_preferences: 'notification',
  god_notify_test: 'notification',
  god_notify_history: 'notification',
  god_comms_setup: 'communication',
  god_comms_escalate: 'communication',
  god_lsp_start: 'lsp',
  god_lsp_stop: 'lsp',
  god_lsp_available: 'lsp',
  god_lsp_definition: 'lsp',
  god_lsp_references: 'lsp',
  god_lsp_diagnostics: 'lsp',
  god_lsp_symbols: 'lsp',
  god_git_blame: 'git',
  god_git_bisect: 'git',
  god_git_history: 'git',
  god_git_diff: 'git',
  god_git_branches: 'git',
  god_ast_parse: 'analysis',
  god_ast_query: 'analysis',
  god_ast_refactor: 'analysis',
  god_ast_symbols: 'analysis',
  god_analyze_lint: 'analysis',
  god_analyze_types: 'analysis',
  god_analyze_deps: 'analysis',
  god_analyze_impact: 'analysis',
  god_debug_start: 'debug',
  god_debug_stop: 'debug',
  god_debug_breakpoint: 'debug',
  god_debug_step: 'debug',
  god_debug_eval: 'debug',
  god_enhance: 'memory',
  god_enhance_batch: 'memory',
  god_gnn_stats: 'memory',
  god_clear_gnn_cache: 'memory',
  god_schedule: 'codex',
  god_trigger: 'codex',
  god_tasks: 'codex',
  god_pause: 'codex',
  god_resume: 'codex',
  god_cancel: 'codex',
  god_scheduler_stats: 'codex',
  god_failure_record: 'learning',
  god_failure_query: 'learning',
  god_failure_resolve: 'learning',
  god_failure_stats: 'learning',
  god_partner_config: 'codex',
  god_partner_challenge: 'codex',
  god_partner_status: 'codex',
  god_containment_check: 'codex',
  god_containment_config: 'codex',
  god_containment_add_rule: 'codex',
  god_containment_remove_rule: 'codex',
  god_containment_status: 'codex',
  god_containment_session: 'codex',
  god_curiosity_list: 'learning',
  god_curiosity_explore: 'learning',
  god_budget_status: 'learning',
  god_budget_history: 'learning',
  god_config_get: 'codex',
  god_config_set: 'codex',
  god_config_load: 'codex',
  god_config_save: 'codex',
  god_config_reset: 'codex',
  god_wolfram_query: 'analysis',
  god_wolfram_calculate: 'analysis',
  god_wolfram_solve: 'analysis',
  god_wolfram_convert: 'analysis',
  god_capabilities_status: 'discovery',
  god_db_schema: 'analysis',
  god_db_types: 'analysis',
  god_profile_start: 'analysis',
  god_profile_stop: 'analysis',
  god_profile_hotspots: 'analysis',
  god_docs_fetch: 'analysis',
  god_docs_search: 'analysis',
  god_stack_parse: 'debug',
  god_stack_context: 'debug',
  god_store_compressed: 'memory',
  god_query_expanded: 'memory',
  god_self_query: 'memory',
  god_compression_stats: 'memory',
  god_bootstrap_status: 'memory',
  god_recompress_all: 'memory',
  god_autorecall_config: 'memory',
  god_autorecall_status: 'memory',
  // New tools
  god_reflexion_query: 'reflexion',
  god_reflexion_generate: 'reflexion',
  god_reflexion_stats: 'reflexion',
  god_agent_card: 'discovery',
  god_guardian_audit: 'guardian'
};

/**
 * Complexity estimates for tools
 */
const TOOL_COMPLEXITY: Record<string, 'low' | 'medium' | 'high'> = {
  god_codex_do: 'high',
  god_codex_status: 'low',
  god_review: 'high',
  god_security_review: 'high',
  god_quick_review: 'medium',
  god_pw_verify: 'medium',
  god_pw_launch: 'medium',
  god_lsp_references: 'medium',
  god_ast_refactor: 'high',
  god_analyze_deps: 'medium',
  god_debug_start: 'medium',
  god_git_bisect: 'high',
  god_enhance: 'medium',
  god_enhance_batch: 'high',
  god_reflexion_generate: 'high',
  god_guardian_audit: 'high'
};

/**
 * Token estimates for tools
 */
const TOKEN_ESTIMATES: Record<string, EstimatedTokens> = {
  god_codex_do: { min: 10000, typical: 50000, max: 200000, factors: ['task complexity', 'file count'] },
  god_review: { min: 1000, typical: 5000, max: 20000, factors: ['file count', 'file size'] },
  god_security_review: { min: 500, typical: 3000, max: 15000, factors: ['file count'] },
  god_reflexion_generate: { min: 500, typical: 2000, max: 5000, factors: ['context size'] },
  god_guardian_audit: { min: 500, typical: 3000, max: 10000, factors: ['file count', 'test coverage'] }
};

/**
 * AgentCardGenerator - Generate A2A-compatible Agent Cards
 */
export class AgentCardGenerator {
  /**
   * Generate Agent Card from MCP tool definitions
   */
  static fromMCPTools(
    tools: MCPTool[],
    options: GeneratorOptions = {}
  ): AgentCard {
    const capabilities: Capability[] = tools.map(tool =>
      this.toolToCapability(tool, options)
    );

    return {
      id: 'rubix-codex-v1',
      name: 'RUBIX Autonomous Developer',
      version: '1.0.0',
      description: 'AI developer agent with memory, learning, and multi-phase execution. ' +
        'Capable of autonomous code generation, testing, security review, and self-healing.',
      provider: {
        name: 'RUBIX Protocol',
        url: 'https://github.com/BobbyRuby',
        repository: 'https://github.com/BobbyRuby/rubix-protocol'
      },
      capabilities,
      endpoints: [
        {
          type: 'mcp',
          protocol: 'stdio',
          description: 'Model Context Protocol over stdio'
        }
      ],
      authentication: [
        {
          type: 'mcp_native',
          description: 'MCP native authentication via Claude Code'
        },
        {
          type: 'api_key',
          description: 'Anthropic API key for Claude integration',
          scopes: ['claude-sonnet', 'claude-opus']
        }
      ],
      constraints: [
        {
          type: 'context_window',
          value: 200000,
          unit: 'tokens',
          description: 'Maximum context window for Claude'
        },
        {
          type: 'concurrency',
          value: 1,
          description: 'One task at a time (CODEX limitation)'
        },
        {
          type: 'timeout',
          value: 600000,
          unit: 'ms',
          description: 'Default execution timeout (10 minutes)'
        }
      ],
      costModel: {
        type: 'per_token',
        tokenCosts: {
          inputTokens: 0.003, // $3/MTok for Sonnet
          outputTokens: 0.015, // $15/MTok for Sonnet
          thinkingTokens: 0.015 // Same as output
        },
        currency: 'USD',
        tiers: [
          {
            name: 'sonnet',
            threshold: 0,
            cost: { amount: 0.003, unit: 'per 1K input tokens' }
          },
          {
            name: 'opus',
            threshold: 0,
            cost: { amount: 0.015, unit: 'per 1K input tokens' }
          }
        ]
      },
      generatedAt: new Date(),
      metadata: {
        languages: ['typescript', 'javascript', 'python', 'go', 'rust', 'java', 'php'],
        frameworks: ['react', 'vue', 'next.js', 'fastapi', 'django', 'express'],
        runtime: 'node.js >= 18',
        models: [
          { id: 'claude-sonnet-4-20250514', provider: 'anthropic', purpose: 'general' },
          { id: 'claude-opus-4-20250514', provider: 'anthropic', purpose: 'complex' }
        ],
        ...options.metadata
      }
    };
  }

  /**
   * Convert MCP tool to capability
   */
  private static toolToCapability(
    tool: MCPTool,
    options: GeneratorOptions
  ): Capability {
    const name = tool.name.replace('mcp__rubix__', '');
    const category = TOOL_CATEGORIES[name] || 'other';
    const complexity = TOOL_COMPLEXITY[name] || 'low';
    const tokens = TOKEN_ESTIMATES[name] || { min: 100, typical: 500, max: 2000 };

    const capability: Capability = {
      name,
      description: tool.description || `Execute ${name}`,
      category,
      inputSchema: this.convertSchema(tool.inputSchema),
      outputSchema: { type: 'object', description: 'Tool result' },
      complexity,
      estimatedTokens: tokens,
      tags: this.generateTags(name, category),
      async: this.isAsync(name),
      requires: this.getDependencies(name)
    };

    if (options.includeExamples) {
      capability.examples = this.generateExamples(name);
    }

    return capability;
  }

  /**
   * Convert tool input schema to JSONSchema
   */
  private static convertSchema(schema?: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
  }): JSONSchema {
    if (!schema) {
      return { type: 'object' };
    }

    return {
      type: schema.type,
      properties: schema.properties as Record<string, JSONSchema>,
      required: schema.required
    };
  }

  /**
   * Generate tags for a capability
   */
  private static generateTags(name: string, category: CapabilityCategory): string[] {
    const tags: string[] = [category];

    if (name.includes('codex')) tags.push('autonomous', 'code-generation');
    if (name.includes('review')) tags.push('security', 'quality');
    if (name.includes('memory') || name.includes('store') || name.includes('query')) {
      tags.push('memory', 'semantic-search');
    }
    if (name.includes('learn')) tags.push('learning', 'improvement');
    if (name.includes('pw_') || name.includes('playwright')) tags.push('browser', 'testing');
    if (name.includes('git')) tags.push('version-control');
    if (name.includes('lsp')) tags.push('ide', 'code-intelligence');
    if (name.includes('reflexion')) tags.push('failure-analysis', 'root-cause');
    if (name.includes('guardian')) tags.push('audit', 'rollback');

    return [...new Set(tags)];
  }

  /**
   * Check if capability is async
   */
  private static isAsync(name: string): boolean {
    return [
      'god_codex_do',
      'god_pw_verify',
      'god_review',
      'god_security_review',
      'god_git_bisect',
      'god_reflexion_generate',
      'god_guardian_audit'
    ].includes(name);
  }

  /**
   * Get capability dependencies
   */
  private static getDependencies(name: string): string[] | undefined {
    const deps: Record<string, string[]> = {
      god_codex_do: ['god_containment_check'],
      god_review: ['god_lsp_diagnostics'],
      god_security_review: ['god_lsp_diagnostics'],
      god_pw_verify: ['god_pw_launch'],
      god_pw_screenshot: ['god_pw_launch'],
      god_pw_action: ['god_pw_launch'],
      god_lsp_definition: ['god_lsp_start'],
      god_lsp_references: ['god_lsp_start'],
      god_debug_breakpoint: ['god_debug_start'],
      god_debug_step: ['god_debug_start'],
      god_guardian_audit: ['god_codex_do']
    };
    return deps[name];
  }

  /**
   * Generate examples for a capability
   */
  private static generateExamples(name: string): CapabilityExample[] | undefined {
    const examples: Record<string, CapabilityExample[]> = {
      god_codex_do: [{
        description: 'Build a calculator component',
        input: {
          description: 'Build a calculator component with add, subtract, multiply, divide',
          codebase: '/path/to/project'
        },
        output: { taskId: 'task_123', status: 'running' }
      }],
      god_store: [{
        description: 'Store a learning',
        input: {
          content: 'React components should be memoized for performance',
          tags: ['react', 'performance'],
          importance: 0.8
        },
        output: { id: 'entry_abc', success: true }
      }],
      god_reflexion_generate: [{
        description: 'Generate reflection on a failure',
        input: {
          failureId: 'fail_123',
          context: 'Type error in API response handling'
        },
        output: {
          reflection: {
            whyItFailed: 'Assumed API returns typed response',
            rootCause: 'type_mismatch',
            lesson: 'Always validate API responses'
          }
        }
      }]
    };
    return examples[name];
  }

  /**
   * Export Agent Card to JSON file
   */
  static export(card: AgentCard, path: string): void {
    // Ensure directory exists
    const dir = dirname(path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const json = JSON.stringify(card, null, 2);
    writeFileSync(path, json, 'utf-8');
    console.log(`[AgentCardGenerator] Exported agent card to ${path}`);
  }

  /**
   * Validate Agent Card against A2A schema
   */
  static validate(card: AgentCard): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Required fields
    if (!card.id) {
      errors.push({ path: 'id', message: 'Agent ID is required', code: 'REQUIRED' });
    }
    if (!card.name) {
      errors.push({ path: 'name', message: 'Agent name is required', code: 'REQUIRED' });
    }
    if (!card.version) {
      errors.push({ path: 'version', message: 'Version is required', code: 'REQUIRED' });
    }
    if (!card.capabilities || card.capabilities.length === 0) {
      errors.push({ path: 'capabilities', message: 'At least one capability required', code: 'REQUIRED' });
    }

    // Version format
    if (card.version && !/^\d+\.\d+\.\d+/.test(card.version)) {
      warnings.push({
        path: 'version',
        message: 'Version should follow semver format',
        suggestion: 'Use format: major.minor.patch'
      });
    }

    // Validate capabilities
    card.capabilities?.forEach((cap, i) => {
      if (!cap.name) {
        errors.push({
          path: `capabilities[${i}].name`,
          message: 'Capability name is required',
          code: 'REQUIRED'
        });
      }
      if (!cap.description) {
        warnings.push({
          path: `capabilities[${i}].description`,
          message: 'Capability description recommended',
          suggestion: 'Add a description for discoverability'
        });
      }
      if (!cap.inputSchema) {
        warnings.push({
          path: `capabilities[${i}].inputSchema`,
          message: 'Input schema recommended',
          suggestion: 'Define input schema for validation'
        });
      }
    });

    // Cost model
    if (!card.costModel) {
      warnings.push({
        path: 'costModel',
        message: 'Cost model recommended for negotiation',
        suggestion: 'Add cost model for A2A cost negotiation'
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Get capability by name
   */
  static getCapability(card: AgentCard, name: string): Capability | undefined {
    return card.capabilities.find(c => c.name === name);
  }

  /**
   * Get capabilities by category
   */
  static getCapabilitiesByCategory(
    card: AgentCard,
    category: CapabilityCategory
  ): Capability[] {
    return card.capabilities.filter(c => c.category === category);
  }

  /**
   * Estimate total tokens for a set of capabilities
   */
  static estimateTokens(
    card: AgentCard,
    capabilityNames: string[]
  ): { min: number; typical: number; max: number } {
    const caps = capabilityNames
      .map(name => this.getCapability(card, name))
      .filter((c): c is Capability => c !== undefined);

    return caps.reduce(
      (acc, cap) => ({
        min: acc.min + cap.estimatedTokens.min,
        typical: acc.typical + cap.estimatedTokens.typical,
        max: acc.max + cap.estimatedTokens.max
      }),
      { min: 0, typical: 0, max: 0 }
    );
  }
}

export default AgentCardGenerator;
