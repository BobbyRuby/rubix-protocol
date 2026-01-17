# Constants

**File:** `src/core/constants.ts` (~30 lines)

System-wide constants and tags used throughout the RUBIX/god-agent system.

## System Tags

Tags automatically applied by the system:

```typescript
export const SYSTEM_TAGS = {
  // Compression
  COMPRESSED: 'compressed',
  LLM_COMPRESSED: 'llm-compressed',
  SCHEMA_COMPRESSED: 'schema-compressed',

  // Learning
  FAILURE: 'failure',
  SUCCESS: 'success',
  CODEX: 'codex',
  LEARNING: 'learning',
  TRAJECTORY: 'trajectory',

  // Sources
  USER_INPUT: 'user-input',
  AGENT: 'agent',
  TOOL: 'tool',
  SYSTEM: 'system',
  EXTERNAL: 'external',

  // Memory types
  COMPONENT: 'component',
  DEPARTMENT: 'department',
  MCP_TOOL: 'mcp-tool',
  CAPABILITY: 'capability',
  WORKFLOW: 'workflow',
  CONFIG: 'config',
  ERROR_PATTERN: 'error-pattern',
  SUCCESS_PATTERN: 'success-pattern',
  BUG_FIX: 'bug-fix',
  DEV_FEATURE: 'dev-feature',
  ARCH_INSIGHT: 'arch-insight',

  // Task execution
  TASK: 'task',
  SUBTASK: 'subtask',
  RESEARCH: 'research',
  DESIGN: 'design',
  CODE: 'code',
  TEST: 'test',
  INTEGRATE: 'integrate',
  VERIFY: 'verify',
  REVIEW: 'review',

  // Special
  BOOTSTRAP: 'bootstrap',
  SELF_KNOWLEDGE: 'self-knowledge'
} as const;
```

## Default Values

Default values for various operations:

```typescript
export const DEFAULTS = {
  // Importance
  IMPORTANCE: 0.5,
  MIN_IMPORTANCE: 0.0,
  MAX_IMPORTANCE: 1.0,

  // Query
  TOP_K: 10,
  MAX_TOP_K: 100,

  // L-Score
  LSCORE_DECAY: 0.9,
  LSCORE_MIN: 0.01,
  LSCORE_THRESHOLD: 0.3,

  // HNSW
  HNSW_MAX_ELEMENTS: 100000,
  HNSW_EF_CONSTRUCTION: 200,
  HNSW_EF_SEARCH: 100,
  HNSW_M: 16,
  HNSW_DIMENSIONS: 768,

  // Embedding
  EMBEDDING_MODEL: 'text-embedding-3-small',
  EMBEDDING_DIMENSIONS: 768,
  EMBEDDING_BATCH_SIZE: 100,
  EMBEDDING_FLUSH_INTERVAL: 5000,

  // RUBIX
  RUBIX_MODEL: 'claude-opus-4-5-20251101',
  RUBIX_MAX_TOKENS: 8192,
  RUBIX_THINK_BASE: 5000,
  RUBIX_THINK_INCREMENT: 5000,
  RUBIX_THINK_MAX: 16000,
  RUBIX_THINK_START_ATTEMPT: 2,
  RUBIX_CLI_TIMEOUT: 300000,
  RUBIX_MAX_ATTEMPTS: 5,
  RUBIX_MAX_PARALLEL: 5,

  // Circuit breaker
  CIRCUIT_FAILURE_THRESHOLD: 5,
  CIRCUIT_FAILURE_WINDOW: 60000,
  CIRCUIT_COOLDOWN: 300000,

  // Learning
  SONA_LEARNING_RATE: 0.01,
  SONA_EWC_LAMBDA: 100,
  SONA_PRUNE_THRESHOLD: 0.4,
  SONA_PRUNE_MIN_USES: 100,
  SONA_BOOST_THRESHOLD: 0.8,

  // Notifications
  ESCALATION_TIMEOUT: 300000,  // 5 minutes per channel

  // Playwright
  PLAYWRIGHT_TIMEOUT: 30000,

  // Memory
  MEMORY_PRUNE_DAYS: 90
} as const;
```

## Base L-Scores

Base L-Scores by source type:

```typescript
export const BASE_LSCORES: Record<SourceType, number> = {
  user_input: 1.0,
  system: 1.0,
  agent_inference: 0.9,
  tool_output: 0.8,
  external: 0.7
} as const;
```

## Route Keywords

Keywords for TinyDancer routing:

```typescript
export const ROUTE_KEYWORDS = {
  causal_backward: [
    'why', 'cause', 'caused', 'reason',
    'led to', 'resulted in', 'because',
    'root cause', 'origin', 'source'
  ],
  causal_forward: [
    'effect', 'impact', 'result',
    'consequence', 'outcome', 'lead to',
    'what happens', 'affects'
  ],
  pattern_match: [
    'similar', 'like', 'pattern',
    'before', 'previously', 'history',
    'example', 'case', 'instance'
  ],
  adversarial: [
    'contradict', 'oppose', 'against',
    'wrong', 'false', 'disprove',
    'counterargument', 'refute'
  ]
} as const;
```

## Error Codes

Error codes for custom errors:

```typescript
export const ERROR_CODES = {
  PROVENANCE_THRESHOLD: 'PROVENANCE_THRESHOLD',
  STORAGE_ERROR: 'STORAGE_ERROR',
  EMBEDDING_ERROR: 'EMBEDDING_ERROR',
  CIRCUIT_BREAKER_OPEN: 'CIRCUIT_BREAKER_OPEN',
  CONFIGURATION_ERROR: 'CONFIGURATION_ERROR',
  TASK_EXECUTION_ERROR: 'TASK_EXECUTION_ERROR'
} as const;
```

## Compression Schemas

Schema type codes:

```typescript
export const SCHEMA_TYPE_CODES = {
  component: {
    O: 'orchestrator',
    F: 'facade',
    S: 'service',
    M: 'manager',
    E: 'engine',
    H: 'handler'
  },
  department: {
    D: 'discovery',
    G: 'design',
    I: 'implementation',
    Q: 'quality',
    R: 'reliability'
  },
  mcp_tool: {
    s: 'string',
    n: 'number',
    b: 'boolean',
    a: 'array',
    o: 'object'
  },
  bug_fix: {
    F: 'fixed',
    O: 'open',
    W: 'wip'
  }
} as const;
```

## Action Abbreviations

Standard abbreviations for compression:

```typescript
export const ACTION_ABBREVIATIONS: Record<string, string> = {
  // Common actions
  execute: 'exe',
  decompose: 'dec',
  heal: 'heal',
  analyze: 'ana',
  generate: 'gen',
  validate: 'val',
  initialize: 'init',
  configure: 'cfg',

  // CRUD
  create: 'C',
  read: 'R',
  update: 'U',
  delete: 'D',

  // Flow
  start: 'sta',
  stop: 'sto',
  pause: 'pau',
  resume: 'res'
} as const;
```

## File Paths

Standard file paths:

```typescript
export const PATHS = {
  DEFAULT_DATA_DIR: './data',
  MEMORY_DB: 'memory.db',
  HNSW_INDEX: 'hnsw.index',
  CONFIG_FILE: 'codex.yaml',
  CHECKPOINT_PREFIX: 'dev-memory-'
} as const;
```

## Usage

Import constants where needed:

```typescript
import {
  SYSTEM_TAGS,
  DEFAULTS,
  BASE_LSCORES
} from '@rubix/god-agent';

// Use in code
const entry = await engine.store({
  content: "...",
  tags: [SYSTEM_TAGS.COMPONENT],
  importance: DEFAULTS.IMPORTANCE
});
```

## Next Steps

- [Types](types.md) - Type definitions
- [Configuration](config.md) - Configuration reference
- [Compression Schemas](../memory/compression-schemas.md) - Schema details
