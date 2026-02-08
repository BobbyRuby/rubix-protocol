# Memory Tools

Memory tools for storing, querying, and managing memories in the RUBIX/god-agent system.

## Tool Reference

| Tool | Purpose |
|------|---------|
| [god_store](#god_store) | Store with compression |
| [god_query](#god_query) | Semantic search |
| [god_query_expanded](#god_query_expanded) | Query with auto-expansion |
| [god_trace](#god_trace) | Trace provenance lineage |
| [god_edit](#god_edit) | Edit entry |
| [god_delete](#god_delete) | Delete entry |
| [god_stats](#god_stats) | Memory statistics |
| [god_checkpoint](#god_checkpoint) | Create checkpoint |
| [god_self_query](#god_self_query) | Query self-knowledge |
| [god_compression_stats](#god_compression_stats) | Compression statistics |

---

## god_store

Store information with automatic compression.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `content` | string | Yes | Content to store |
| `tags` | string[] | No | Categorization tags |
| `importance` | number | No | Importance 0-1 (default: 0.5) |
| `source` | enum | No | user_input, agent_inference, tool_output, system, external |
| `parentIds` | string[] | No | Parent entry IDs for provenance |
| `type` | enum | No | Memory type for compression schema |
| `agentId` | string | No | Agent identifier |
| `sessionId` | string | No | Session identifier |
| `confidence` | number | No | Confidence 0-1 |

### Memory Types

- `component`, `department`, `mcp_tool`, `capability`
- `workflow`, `config`, `error_pattern`, `success_pattern`
- `system`, `bug_fix`, `dev_feature`, `arch_insight`, `generic`

### Response

```json
{
  "success": true,
  "entryId": "abc123...",
  "lScore": 0.9,
  "compressed": true,
  "compressionRatio": 0.35
}
```

### Example

```typescript
await mcp__rubix__god_store({
  content: "The authentication module uses JWT tokens with 24-hour expiry",
  tags: ["auth", "security", "jwt"],
  importance: 0.8,
  source: "agent_inference",
  type: "component"
});
```

---

## god_query

Semantic search through memory.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Search query |
| `topK` | number | No | Number of results (default: 10) |
| `tags` | string[] | No | Filter by tags |
| `minImportance` | number | No | Minimum importance |
| `sources` | enum[] | No | Filter by source types |
| `includeProvenance` | boolean | No | Include L-Score |

### Response

```json
{
  "success": true,
  "results": [
    {
      "id": "abc123...",
      "content": "auth|jwt|24h_expiry|security",
      "similarity": 0.92,
      "tags": ["auth", "security"],
      "importance": 0.8,
      "lScore": 0.9,
      "createdAt": "2024-01-15T10:00:00Z"
    }
  ],
  "trajectoryId": "traj_xyz..."
}
```

### Example

```typescript
const results = await mcp__rubix__god_query({
  query: "how does authentication work?",
  topK: 5,
  includeProvenance: true
});
```

---

## god_query_expanded

Query with automatic expansion of compressed entries.

### Parameters

Same as `god_query`, plus:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `expand` | boolean | No | Whether to expand (default: true) |

### Response

Returns human-readable content instead of compressed tokens:

```json
{
  "success": true,
  "results": [
    {
      "id": "abc123...",
      "content": "The authentication module uses JWT tokens with 24-hour expiry for secure session management.",
      "similarity": 0.92,
      "expanded": true
    }
  ]
}
```

### Example

```typescript
const results = await mcp__rubix__god_query_expanded({
  query: "authentication",
  topK: 3
});
```

---

## god_trace

Trace the provenance lineage of a memory entry.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entryId` | string | Yes | Entry ID to trace |
| `depth` | number | No | Max depth (default: 10, max: 50) |

### Response

```json
{
  "success": true,
  "entry": {
    "id": "abc123...",
    "content": "...",
    "lScore": 0.81,
    "lineageDepth": 2,
    "reliability": "high"
  },
  "parents": [
    {
      "id": "parent1...",
      "lScore": 0.9,
      "content": "..."
    }
  ]
}
```

### Reliability Categories

| Category | L-Score Range |
|----------|---------------|
| high | >= 0.7 |
| medium | >= 0.5 |
| low | >= 0.3 |
| unreliable | < 0.3 |

### Example

```typescript
const lineage = await mcp__rubix__god_trace({
  entryId: "abc123...",
  depth: 5
});
```

---

## god_edit

Edit an existing memory entry.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entryId` | string | Yes | Entry ID to edit |
| `content` | string | No | New content (re-embeds) |
| `tags` | string[] | No | New tags (replaces all) |
| `importance` | number | No | New importance |
| `source` | enum | No | New source type |

### Response

```json
{
  "success": true,
  "entryId": "abc123...",
  "updated": ["content", "tags"]
}
```

### Example

```typescript
await mcp__rubix__god_edit({
  entryId: "abc123...",
  content: "Updated authentication uses OAuth 2.0",
  importance: 0.9
});
```

---

## god_delete

Delete a memory entry permanently.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entryId` | string | Yes | Entry ID to delete |
| `confirm` | boolean | Yes | Must be true to confirm |

### Response

```json
{
  "success": true,
  "deleted": "abc123..."
}
```

### Example

```typescript
await mcp__rubix__god_delete({
  entryId: "abc123...",
  confirm: true
});
```

---

## god_stats

Get memory system statistics.

### Parameters

None.

### Response

```json
{
  "success": true,
  "totalEntries": 1500,
  "vectorCount": 1450,
  "causalRelations": 200,
  "avgLScore": 0.78,
  "compressedEntries": 1200,
  "avgCompressionRatio": 0.35
}
```

### Example

```typescript
const stats = await mcp__rubix__god_stats();
```

---

## god_checkpoint

Create a Git-trackable checkpoint of the memory database.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `overwrite` | boolean | No | Overwrite most recent checkpoint |

### Response

```json
{
  "success": true,
  "checkpointPath": "data/dev-memory-20240115-100000.db"
}
```

### Example

```typescript
// Create new checkpoint
await mcp__rubix__god_checkpoint();

// Overwrite most recent
await mcp__rubix__god_checkpoint({ overwrite: true });
```

---

## god_self_query

Query RUBIX's self-knowledge about its architecture and capabilities.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `question` | string | Yes | Question about RUBIX |
| `format` | enum | No | tokens, readable, full (default: readable) |
| `topK` | number | No | Number of results (default: 5) |

### Response

```json
{
  "success": true,
  "answer": "TaskExecutor is an orchestrator component that coordinates task execution. It handles decomposition, code generation, self-healing, and escalation.",
  "sources": [
    {
      "id": "...",
      "relevance": 0.95
    }
  ]
}
```

### Example

```typescript
const answer = await mcp__rubix__god_self_query({
  question: "What is TaskExecutor?",
  format: "readable"
});
```

---

## god_compression_stats

Get compression system statistics.

### Parameters

None.

### Response

```json
{
  "success": true,
  "totalCompressed": 1200,
  "avgCompressionRatio": 0.35,
  "estimatedTokensSaved": 45000,
  "byType": {
    "component": { "count": 200, "avgRatio": 0.30 },
    "error_pattern": { "count": 150, "avgRatio": 0.35 },
    "generic": { "count": 850, "avgRatio": 0.40 }
  }
}
```

### Example

```typescript
const stats = await mcp__rubix__god_compression_stats();
```

---

## Best Practices

### 1. Use Appropriate Types

Specify the memory type for better compression:

```typescript
// Good - specifies type
await mcp__rubix__god_store({
  content: "Error: undefined property",
  type: "error_pattern"
});

// Less efficient - uses generic
await mcp__rubix__god_store({
  content: "Error: undefined property"
});
```

### 2. Tag Consistently

Use consistent tags for better filtering:

```typescript
await mcp__rubix__god_store({
  content: "...",
  tags: ["auth", "security", "jwt"]  // Hierarchical tags
});

// Query with tags
await mcp__rubix__god_query({
  query: "...",
  tags: ["auth"]  // Filter by tag
});
```

### 3. Track Provenance

Link related entries for provenance tracking:

```typescript
// Store parent
const parent = await mcp__rubix__god_store({
  content: "Research findings",
  source: "user_input"
});

// Store child with parent link
await mcp__rubix__god_store({
  content: "Derived insight",
  parentIds: [parent.entryId],
  source: "agent_inference"
});
```

### 4. Provide Learning Feedback

Use trajectoryId to improve search:

```typescript
const result = await mcp__rubix__god_query({ query: "..." });

// If results were useful
await mcp__rubix__god_learn({
  trajectoryId: result.trajectoryId,
  quality: 0.8
});
```

## Next Steps

- [Causal Tools](causal-tools.md) - Causal relations
- [Learning Tools](learning-tools.md) - Learning and routing
- [Memory System](../memory/index.md) - Memory architecture
