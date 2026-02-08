/**
 * Agent Card Types
 *
 * Type definitions for A2A-compatible agent discovery.
 * Enables other agents to discover RUBIX capabilities,
 * negotiate costs, and perform capability matching.
 */

/**
 * Main Agent Card structure - describes agent capabilities
 */
export interface AgentCard {
  /** Unique identifier for this agent */
  id: string;
  /** Human-readable name */
  name: string;
  /** Semantic version */
  version: string;
  /** Description of agent capabilities */
  description: string;
  /** Provider information */
  provider: AgentProvider;
  /** List of capabilities */
  capabilities: Capability[];
  /** Available endpoints */
  endpoints: Endpoint[];
  /** Supported authentication methods */
  authentication: AuthMethod[];
  /** Operational constraints */
  constraints: Constraint[];
  /** Cost model for token/compute usage */
  costModel: CostModel;
  /** When this card was generated */
  generatedAt: Date;
  /** Agent metadata */
  metadata: AgentMetadata;
}

/**
 * Provider information
 */
export interface AgentProvider {
  name: string;
  url?: string;
  contact?: string;
  repository?: string;
}

/**
 * A capability describes what the agent can do
 */
export interface Capability {
  /** Capability name (e.g., 'god_codex_do') */
  name: string;
  /** Human-readable description */
  description: string;
  /** Category for grouping */
  category: CapabilityCategory;
  /** JSON Schema for input */
  inputSchema: JSONSchema;
  /** JSON Schema for output */
  outputSchema: JSONSchema;
  /** Complexity classification */
  complexity: 'low' | 'medium' | 'high';
  /** Estimated token usage */
  estimatedTokens: EstimatedTokens;
  /** Tags for discovery */
  tags: string[];
  /** Whether this capability is async */
  async: boolean;
  /** Required capabilities (dependencies) */
  requires?: string[];
  /** Example usage */
  examples?: CapabilityExample[];
}

/**
 * Capability categories for organization
 */
export type CapabilityCategory =
  | 'memory'
  | 'causal'
  | 'learning'
  | 'routing'
  | 'codex'
  | 'deepwork'
  | 'playwright'
  | 'review'
  | 'notification'
  | 'communication'
  | 'analysis'
  | 'git'
  | 'lsp'
  | 'debug'
  | 'discovery'
  | 'reflexion'
  | 'guardian'
  | 'other';

/**
 * Estimated token usage for a capability
 */
export interface EstimatedTokens {
  /** Minimum tokens (simple case) */
  min: number;
  /** Typical tokens */
  typical: number;
  /** Maximum tokens (complex case) */
  max: number;
  /** Factors that affect token usage */
  factors?: string[];
}

/**
 * Example usage of a capability
 */
export interface CapabilityExample {
  /** Description of the example */
  description: string;
  /** Example input */
  input: Record<string, unknown>;
  /** Expected output shape */
  output?: Record<string, unknown>;
}

/**
 * JSON Schema type (simplified)
 */
export interface JSONSchema {
  type: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  description?: string;
  enum?: (string | number)[];
  minimum?: number;
  maximum?: number;
  default?: unknown;
}

/**
 * Endpoint for accessing the agent
 */
export interface Endpoint {
  /** Endpoint type */
  type: 'mcp' | 'http' | 'websocket' | 'grpc';
  /** URL or connection string */
  url?: string;
  /** Protocol version */
  protocol?: string;
  /** Description */
  description?: string;
}

/**
 * Authentication method
 */
export interface AuthMethod {
  /** Auth type */
  type: 'none' | 'api_key' | 'oauth2' | 'bearer' | 'mcp_native';
  /** Description */
  description?: string;
  /** Required scopes */
  scopes?: string[];
}

/**
 * Operational constraint
 */
export interface Constraint {
  /** Constraint type */
  type: 'rate_limit' | 'context_window' | 'file_size' | 'timeout' | 'concurrency' | 'region';
  /** Constraint value */
  value: string | number;
  /** Unit of measurement */
  unit?: string;
  /** Description */
  description?: string;
}

/**
 * Cost model for the agent
 */
export interface CostModel {
  /** Pricing model type */
  type: 'free' | 'per_token' | 'per_request' | 'subscription' | 'hybrid';
  /** Base cost (if applicable) */
  baseCost?: Cost;
  /** Per-token costs */
  tokenCosts?: TokenCosts;
  /** Cost tiers */
  tiers?: CostTier[];
  /** Currency */
  currency?: string;
}

/**
 * Cost specification
 */
export interface Cost {
  amount: number;
  unit: string;
  description?: string;
}

/**
 * Token-based costs
 */
export interface TokenCosts {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens?: number;
}

/**
 * Cost tier for tiered pricing
 */
export interface CostTier {
  name: string;
  threshold: number;
  cost: Cost;
}

/**
 * Agent metadata
 */
export interface AgentMetadata {
  /** Supported languages */
  languages?: string[];
  /** Supported frameworks */
  frameworks?: string[];
  /** Runtime environment */
  runtime?: string;
  /** Model information */
  models?: ModelInfo[];
  /** Custom metadata */
  custom?: Record<string, unknown>;
}

/**
 * Model information
 */
export interface ModelInfo {
  id: string;
  provider: string;
  purpose: string;
}

/**
 * Validation result for agent card
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

/**
 * Validation error
 */
export interface ValidationError {
  path: string;
  message: string;
  code: string;
}

/**
 * Validation warning
 */
export interface ValidationWarning {
  path: string;
  message: string;
  suggestion?: string;
}

/**
 * MCP Tool definition (for conversion)
 */
export interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Agent Card Generator options
 */
export interface GeneratorOptions {
  /** Include examples */
  includeExamples?: boolean;
  /** Include full schemas */
  includeSchemas?: boolean;
  /** Estimate token costs */
  estimateTokens?: boolean;
  /** Custom metadata */
  metadata?: Partial<AgentMetadata>;
}
