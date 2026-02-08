# Type Definitions

**File:** `src/core/types.ts` (~500 lines)

Complete TypeScript type definitions for the RUBIX/god-agent system.

## Memory Types

### MemoryEntry

The core memory entry structure:

```typescript
interface MemoryEntry {
  id: string;
  content: string;
  tags: string[];
  importance: number;      // 0.0 - 1.0
  source: SourceType;
  agentId?: string;
  sessionId?: string;
  createdAt: Date;
  updatedAt?: Date;
}
```

### SourceType

Types of information sources:

```typescript
type SourceType =
  | 'user_input'      // Direct user input (L-Score: 1.0)
  | 'agent_inference' // Agent-generated (L-Score: 0.9)
  | 'tool_output'     // Tool results (L-Score: 0.8)
  | 'system'          // System events (L-Score: 1.0)
  | 'external';       // External sources (L-Score: 0.7)
```

### StoreInput

Input for storing memories:

```typescript
interface StoreInput {
  content: string;
  tags?: string[];
  importance?: number;
  source?: SourceType;
  parentIds?: string[];
  agentId?: string;
  sessionId?: string;
  type?: MemoryType;      // For compression schema
  confidence?: number;
}
```

### StoreResult

Result from storing:

```typescript
interface StoreResult {
  success: boolean;
  entryId: string;
  lScore: number;
  compressed: boolean;
  compressionRatio?: number;
  error?: string;
}
```

## Query Types

### QueryInput

Input for querying memories:

```typescript
interface QueryInput {
  query: string;
  topK?: number;
  tags?: string[];
  minImportance?: number;
  sources?: SourceType[];
  includeProvenance?: boolean;
  route?: RouteType;
}
```

### QueryResult

Result from querying:

```typescript
interface QueryResult {
  success: boolean;
  results: MatchResult[];
  trajectoryId?: string;
  route?: RouteType;
  routeConfidence?: number;
}
```

### MatchResult

Individual match from query:

```typescript
interface MatchResult {
  id: string;
  content: string;
  similarity: number;     // 0.0 - 1.0
  tags: string[];
  importance: number;
  source: SourceType;
  lScore?: number;        // If includeProvenance
  createdAt: Date;
}
```

## Provenance Types

### ProvenanceData

Provenance information for an entry:

```typescript
interface ProvenanceData {
  entryId: string;
  parentIds: string[];
  lScore: number;
  lineageDepth: number;
  reliability: ReliabilityCategory;
}
```

### ReliabilityCategory

L-Score reliability categories:

```typescript
type ReliabilityCategory =
  | 'high'        // L-Score >= 0.7
  | 'medium'      // L-Score >= 0.5
  | 'low'         // L-Score >= 0.3
  | 'unreliable'; // L-Score < 0.3
```

## Causal Types

### CausalRelation

Causal relationship between entries:

```typescript
interface CausalRelation {
  id: string;
  sourceIds: string[];
  targetIds: string[];
  type: RelationType;
  strength: number;       // 0.0 - 1.0
  ttl?: number;          // Milliseconds
  expiresAt?: Date;
  createdAt: Date;
}
```

### RelationType

Types of causal relationships:

```typescript
type RelationType =
  | 'causes'      // Direct causation
  | 'enables'     // Prerequisite
  | 'prevents'    // Prevention
  | 'correlates'  // Correlation
  | 'precedes'    // Temporal
  | 'triggers';   // Event trigger
```

### CausalPath

A path between entries:

```typescript
interface CausalPath {
  nodes: string[];        // Entry IDs
  relations: CausalRelation[];
  totalStrength: number;
}
```

## Learning Types

### Trajectory

Learning trajectory from a query:

```typescript
interface Trajectory {
  id: string;
  query: string;
  queryEmbedding: Float32Array;
  matches: MatchResult[];
  scores: number[];
  quality?: number;
  route?: RouteType;
  createdAt: Date;
  feedbackAt?: Date;
}
```

### PatternWeight

Pattern weight for learning:

```typescript
interface PatternWeight {
  patternId: string;
  name: string;
  weight: number;
  baseWeight: number;
  delta: number;
  useCount: number;
  successRate: number;
  lastUpdated: Date;
}
```

### LearningStats

Learning statistics:

```typescript
interface LearningStats {
  totalTrajectories: number;
  trajectoriesWithFeedback: number;
  feedbackRate: number;
  avgQuality: number;
  patternCount: number;
  avgPatternWeight: number;
  avgSuccessRate: number;
  driftScore: number;
  pruningCandidates: number;
  boostingCandidates: number;
}
```

## Routing Types

### RouteType

Query routing strategies:

```typescript
type RouteType =
  | 'pattern_match'     // Similar patterns
  | 'causal_forward'    // Effects of X
  | 'causal_backward'   // Causes of X
  | 'temporal_causal'   // Time-based causation
  | 'hybrid'            // Combined approach
  | 'direct_retrieval'  // Simple vector search
  | 'adversarial';      // Find contradictions
```

### RouteDecision

Routing decision result:

```typescript
interface RouteDecision {
  route: RouteType;
  confidence: number;
  alternatives: RouteType[];
  keywords: string[];
}
```

### CircuitState

Circuit breaker state:

```typescript
interface CircuitState {
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  failureCount: number;
  successCount: number;
  lastFailure?: Date;
  cooldownEndsAt?: Date;
  totalFailures: number;
  totalSuccesses: number;
}
```

## Shadow Search Types

### ShadowSearchInput

Input for contradiction search:

```typescript
interface ShadowSearchInput {
  query: string;
  topK?: number;
  threshold?: number;      // Min refutation strength
  tags?: string[];
  minImportance?: number;
  includeProvenance?: boolean;
  contradictionType?: ContradictionType;
}
```

### ContradictionResult

Result from shadow search:

```typescript
interface ContradictionResult {
  id: string;
  content: string;
  refutationStrength: number;
  contradictionType: ContradictionType;
  similarity: number;
  lScore?: number;
}
```

### ContradictionType

Types of contradictions:

```typescript
type ContradictionType =
  | 'direct_negation'   // Directly contradicts
  | 'counterargument'   // Argues against
  | 'falsification'     // Disproves
  | 'alternative'       // Suggests alternative
  | 'exception';        // Exception to rule
```

## Compression Types

### MemoryType

Memory types for compression schemas:

```typescript
type MemoryType =
  | 'component'
  | 'department'
  | 'mcp_tool'
  | 'capability'
  | 'workflow'
  | 'config'
  | 'error_pattern'
  | 'success_pattern'
  | 'system'
  | 'bug_fix'
  | 'dev_feature'
  | 'arch_insight'
  | 'generic';
```

### CompressionResult

Result from compression:

```typescript
interface CompressionResult {
  compressed: string;
  original: string;
  ratio: number;
  type: MemoryType;
  method: 'schema' | 'llm' | 'generic';
}
```

## Task Types

See also: [CODEX Types](../codex/types.md)

### TaskStatus

Task execution status:

```typescript
type TaskStatus =
  | 'pending'
  | 'decomposing'
  | 'executing'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'cancelled';
```

### SubtaskType

Types of subtasks:

```typescript
type SubtaskType =
  | 'research'
  | 'design'
  | 'code'
  | 'test'
  | 'integrate'
  | 'verify'
  | 'review';
```

## Configuration Types

### MemoryEngineConfig

Configuration for MemoryEngine:

```typescript
interface MemoryEngineConfig {
  dataDir: string;
  hnsw: HNSWConfig;
  lscore: LScoreConfig;
  embedding: EmbeddingConfig;
}
```

### HNSWConfig

HNSW vector database configuration:

```typescript
interface HNSWConfig {
  maxElements: number;
  efConstruction: number;
  efSearch: number;
  M: number;
  dimensions: number;
}
```

### LScoreConfig

L-Score configuration:

```typescript
interface LScoreConfig {
  decay: number;
  threshold: number;
  enforce: boolean;
  min: number;
}
```

## Utility Types

### Paginated

Paginated results:

```typescript
interface Paginated<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}
```

### Result

Generic result wrapper:

```typescript
type Result<T, E = Error> =
  | { success: true; data: T }
  | { success: false; error: E };
```

## Export

All types are exported from the main module:

```typescript
import {
  MemoryEntry,
  StoreInput,
  QueryInput,
  QueryResult,
  CausalRelation,
  Trajectory,
  RouteType,
  // ... etc
} from '@rubix/god-agent';
```

## Next Steps

- [Configuration](config.md) - Configuration reference
- [Errors](errors.md) - Error types
- [MemoryEngine](memory-engine.md) - API documentation
