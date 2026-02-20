/**
 * God Agent Core Types
 *
 * Central type definitions for the God Agent memory system.
 * Based on the God Agent White Paper architecture.
 */

// ==========================================
// MEMORY ENTRY TYPES
// ==========================================

export interface MemoryEntry {
  id: string;
  content: string;
  embedding?: Float32Array;
  metadata: MemoryMetadata;
  provenance: ProvenanceInfo;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemoryMetadata {
  source: MemorySource;
  tags: string[];
  importance: number; // 0.0 - 1.0
  context?: Record<string, unknown>;
  sessionId?: string;
  agentId?: string;
}

export enum MemorySource {
  USER_INPUT = 'user_input',
  AGENT_INFERENCE = 'agent_inference',
  TOOL_OUTPUT = 'tool_output',
  SYSTEM = 'system',
  EXTERNAL = 'external'
}

// ==========================================
// PROVENANCE TYPES
// ==========================================

export interface ProvenanceInfo {
  parentIds: string[];
  lineageDepth: number;
  confidence: number; // 0.0 - 1.0
  relevance: number;  // 0.0 - 1.0
  lScore?: number;    // Calculated L-Score
}

export interface LineageNode {
  entryId: string;
  depth: number;
  confidence: number;
  relevance: number;
  lScore: number;
  children: LineageNode[];
}

export interface LScoreParams {
  confidences: number[];
  relevances: number[];
  depth: number;
  depthDecay?: number;
}

export interface ProvenanceChain {
  rootId: string;
  nodes: Map<string, LineageNode>;
  maxDepth: number;
  aggregateLScore: number;
}

// ==========================================
// QUERY & RETRIEVAL TYPES
// ==========================================

export interface QueryOptions {
  topK?: number;
  minScore?: number;
  filters?: QueryFilters;
  includeProvenance?: boolean;
  traceDepth?: number;
}

export interface QueryFilters {
  sources?: MemorySource[];
  tags?: string[];
  /** If true (default), require ALL tags to match. If false, match ANY tag. */
  tagMatchAll?: boolean;
  dateRange?: { start: Date; end: Date };
  minImportance?: number;
  sessionId?: string;
  agentId?: string;
}

export interface QueryResult {
  entry: MemoryEntry;
  score: number;
  /** Match type: vector (semantic), pattern, hybrid, or tag-only (SQLite fallback for entries without embeddings) */
  matchType: 'vector' | 'pattern' | 'hybrid' | 'tag-only';
  lScore?: number;
}

// ==========================================
// CAUSAL MEMORY TYPES
// ==========================================

export interface CausalRelation {
  id: string;
  type: CausalRelationType;
  sourceIds: string[];
  targetIds: string[];
  strength: number; // 0.0 - 1.0
  metadata?: Record<string, unknown>;
  createdAt: Date;
  /** Time-to-live in milliseconds. If set, relation expires after this duration. */
  ttl?: number;
  /** Expiration timestamp. Computed from createdAt + ttl if ttl is set. */
  expiresAt?: Date;
}

export enum CausalRelationType {
  CAUSES = 'causes',
  ENABLES = 'enables',
  PREVENTS = 'prevents',
  CORRELATES = 'correlates',
  PRECEDES = 'precedes',
  TRIGGERS = 'triggers'
}

export interface CausalQuery {
  startNodeIds: string[];
  direction: 'forward' | 'backward' | 'both';
  maxDepth?: number;
  relationTypes?: CausalRelationType[];
}

export interface CausalPath {
  nodes: string[];
  edges: CausalRelation[];
  totalStrength: number;
}

// ==========================================
// PATTERN MATCHING TYPES
// ==========================================

export interface PatternTemplate {
  id: string;
  name: string;
  pattern: string;
  slots: PatternSlot[];
  priority: number;
  createdAt: Date;
}

export interface PatternSlot {
  name: string;
  type: 'text' | 'entity' | 'date' | 'number' | 'any';
  required: boolean;
  validators?: string[];
}

export interface PatternMatch {
  templateId: string;
  templateName: string;
  confidence: number;
  bindings: Record<string, string>;
  matchedEntries: MemoryEntry[];
}

// ==========================================
// VECTOR TYPES
// ==========================================

export interface VectorEntry {
  id: string;
  vector: Float32Array;
  metadata?: Record<string, unknown>;
}

export interface VectorSearchResult {
  id: string;
  distance: number;
  score: number;
}

export interface VectorDBStats {
  totalVectors: number;
  dimensions: number;
  indexSize: number;
  avgSearchLatency: number;
}

// ==========================================
// CONFIGURATION TYPES
// ==========================================

export interface MemoryEngineConfig {
  dataDir: string;
  vectorDimensions: number;
  vectorConfig: VectorConfig;
  embeddingConfig: EmbeddingConfig;
  storageConfig: StorageConfig;
  lScoreConfig: LScoreConfig;
}

export interface VectorConfig {
  maxElements: number;
}

/** @deprecated Use VectorConfig instead */
export type HNSWConfig = VectorConfig;

export interface EmbeddingConfig {
  provider: 'openai' | 'local';
  model: string;
  dimensions: number;
  apiKey?: string;
  batchSize?: number;
}

export interface StorageConfig {
  sqlitePath: string;
  enableWAL: boolean;
}

export interface LScoreConfig {
  depthDecay: number;
  minScore: number;
  /** Minimum L-Score threshold for storage (default: 0.3). Entries below this are rejected. */
  threshold: number;
  /** Whether to enforce the L-Score threshold during storage (default: true) */
  enforceThreshold: boolean;
}

export interface CodexLLMConfig {
  /** Anthropic API key for code generation (optional - only for API fallback) */
  apiKey?: string;
  /** Claude model to use for API calls (default: claude-opus-4-5-20251101) */
  model?: string;
  /** Maximum tokens for generation (default: 8192) */
  maxTokens?: number;
  /** Extended thinking (ultrathink) configuration */
  extendedThinking?: ExtendedThinkingConfig;
  /**
   * Execution mode:
   * - cli-first: Try Claude Code CLI first (uses Max subscription), fall back to API (default)
   * - api-only: Only use Anthropic API (requires ANTHROPIC_API_KEY)
   * - cli-only: Only use Claude Code CLI, never fall back to API
   */
  executionMode?: 'cli-first' | 'api-only' | 'cli-only';
  /** CLI model preference: opus (default), sonnet, haiku */
  cliModel?: 'opus' | 'sonnet' | 'haiku';
  /** CLI timeout in ms (default: 300000 = 5 minutes) */
  cliTimeout?: number;

  // === ENGINEER PROVIDER CONFIGURATION ===
  /**
   * Engineer provider for code generation in parallel engineering:
   * - claude: Use Anthropic Claude API (default)
   * - ollama: Use Ollama cloud or local API
   */
  engineerProvider?: 'claude' | 'ollama';
  /** Ollama API endpoint (default: https://ollama.com/api) */
  ollamaEndpoint?: string;
  /** Ollama API key for cloud services (optional) */
  ollamaApiKey?: string;
  /** Ollama model to use (default: qwen3-coder:480b-cloud) */
  ollamaModel?: string;
  /** Ollama timeout in milliseconds (default: 120000 = 2 minutes) */
  ollamaTimeout?: number;

  // === PLAN DEVIATION GATE CONFIGURATION ===
  /**
   * Plan deviation mode - controls how architect design deviations are handled:
   * - strict: ALWAYS escalate to user when design deviates from approved plan (default)
   * - smart: Escalate only for major deviations (future enhancement)
   * - autonomous: Never escalate, trust architect decisions
   */
  planDeviationMode?: 'strict' | 'smart' | 'autonomous';
}

/**
 * Configuration for RUBIX ultrathink - extended thinking that escalates on failures
 */
export interface ExtendedThinkingConfig {
  /** Enable extended thinking (default: true) */
  enabled: boolean;
  /** Base thinking budget in tokens (default: 5000, min: 1024) */
  baseBudget: number;
  /** Additional tokens per retry attempt (default: 5000) */
  budgetIncrement: number;
  /** Maximum thinking budget cap (default: 16000) */
  maxBudget: number;
  /** First attempt to enable extended thinking (default: 2, 1 = always) */
  enableOnAttempt: number;
}

// ==========================================
// STORE OPTIONS
// ==========================================

export interface StoreOptions {
  tags?: string[];
  source?: MemorySource;
  importance?: number;
  parentIds?: string[];
  confidence?: number;
  relevance?: number;
  sessionId?: string;
  agentId?: string;
  context?: Record<string, unknown>;
}

// ==========================================
// STATISTICS
// ==========================================

export interface MemoryStats {
  totalEntries: number;
  vectorCount: number;
  causalRelations: number;
  patternTemplates: number;
  avgLScore: number;
  avgSearchLatency: number;
  dataSize: number;
  /** Compression tier distribution (hot, warm, cool, cold, frozen) */
  compressionTiers?: Record<string, number>;
}
