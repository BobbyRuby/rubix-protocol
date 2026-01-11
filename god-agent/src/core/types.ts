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
  dateRange?: { start: Date; end: Date };
  minImportance?: number;
  sessionId?: string;
  agentId?: string;
}

export interface QueryResult {
  entry: MemoryEntry;
  score: number;
  matchType: 'vector' | 'pattern' | 'hybrid';
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
  hnswConfig: HNSWConfig;
  embeddingConfig: EmbeddingConfig;
  storageConfig: StorageConfig;
  lScoreConfig: LScoreConfig;
}

export interface HNSWConfig {
  maxElements: number;
  efConstruction: number;
  efSearch: number;
  M: number;
  spaceName: 'l2' | 'ip' | 'cosine';
}

export interface EmbeddingConfig {
  provider: 'openai' | 'local';
  model: string;
  dimensions: number;
  apiKey?: string;
  batchSize?: number;
}

export interface StorageConfig {
  sqlitePath: string;
  indexPath: string;
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
  /** Anthropic API key for code generation */
  apiKey?: string;
  /** Claude model to use (default: claude-opus-4-5-20250514) */
  model?: string;
  /** Maximum tokens for generation (default: 8192) */
  maxTokens?: number;
  /** Extended thinking (ultrathink) configuration */
  extendedThinking?: ExtendedThinkingConfig;
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
