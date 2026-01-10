# God Agent User's Guide

A neuro-symbolic cognitive architecture for multi-agent orchestration with provenance tracking, causal reasoning, and continuous learning.

## Table of Contents

1. [Installation](#installation)
2. [Configuration](#configuration)
3. [Core Concepts](#core-concepts)
4. [MCP Tools Reference](#mcp-tools-reference)
5. [Usage Examples](#usage-examples)
6. [Advanced Features](#advanced-features)

---

## Installation

### Prerequisites
- Node.js 20+
- OpenAI API key (for embeddings)

### Setup

```bash
cd god-agent
npm install
npm run build
```

### Environment Variables

Create a `.env` file:

```env
OPENAI_API_KEY=sk-your-key-here
GOD_AGENT_DATA_DIR=./data
GOD_AGENT_EMBEDDING_MODEL=text-embedding-3-small
GOD_AGENT_EMBEDDING_DIMENSIONS=768
```

### Running as MCP Server

Add to your Claude settings (`.claude/settings.json` for user-level, or `.claude/mcp.json` for project-level):

```json
{
  "mcpServers": {
    "god-agent": {
      "command": "node",
      "args": ["dist/mcp-server.js"],
      "cwd": "/path/to/god-agent",
      "env": {
        "OPENAI_API_KEY": "sk-your-key"
      }
    }
  }
}
```

---

## Configuration

### Default Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `dataDir` | `./data` | Directory for SQLite and vector index |
| `embeddingDimensions` | 768 | Vector dimensions |
| `hnswMaxElements` | 100,000 | Max vectors in HNSW index |
| `minLScoreThreshold` | 0.3 | Reject entries below this L-Score |

---

## Core Concepts

### Memory Entries

Every piece of information stored in god-agent is a **memory entry** with:
- **Content**: The actual text/information
- **Source**: Where it came from (`user_input`, `agent_inference`, `tool_output`, `system`, `external`)
- **Tags**: Categorization labels
- **Importance**: 0-1 score for prioritization
- **L-Score**: Reliability score based on provenance

### Provenance & L-Score

The **L-Score** (Lineage Score) measures information reliability:

```
L-Score = (GeometricMean(confidences) × AverageRelevance) / (1 + lineageDepth)
```

- **Root entries** (no parents): L-Score = 1.0
- **Derived entries**: L-Score decreases with depth
- **Threshold**: Entries with L-Score < 0.3 are rejected by default

### Causal Relations

God-agent supports **hypergraph causal relations**:
- Multiple sources → Multiple targets
- Relation types: `causes`, `enables`, `prevents`, `correlates`, `precedes`, `triggers`
- Strength: 0-1 confidence score
- TTL: Optional time-to-live for temporal relations

### Vector Search

Uses HNSW (Hierarchical Navigable Small World) for O(log n) approximate nearest neighbor search with 768-dimensional embeddings.

---

## MCP Tools Reference

### Core Memory Tools

#### `god_store`
Store information with provenance tracking.

```typescript
god_store({
  content: "Bitcoin price hit $100k",
  tags: ["crypto", "bitcoin", "price"],
  importance: 0.9,
  source: "external",
  parentIds: ["previous-entry-id"],  // Optional: for provenance chain
  confidence: 0.95
})
```

#### `god_query`
Semantic search through memory.

```typescript
god_query({
  query: "cryptocurrency prices",
  topK: 10,
  tags: ["crypto"],              // Optional: filter by tags
  minImportance: 0.5,            // Optional: filter by importance
  includeProvenance: true        // Optional: include L-Score
})
```

#### `god_edit`
Edit an existing memory entry.

```typescript
god_edit({
  entryId: "uuid-here",
  content: "Updated content",    // Optional
  tags: ["new", "tags"],         // Optional: replaces all tags
  importance: 0.8                // Optional
})
```

#### `god_delete`
Permanently delete a memory entry.

```typescript
god_delete({
  entryId: "uuid-here",
  confirm: true                  // Required safety flag
})
```

#### `god_stats`
Get memory system statistics.

```typescript
god_stats()
// Returns: total entries, vector count, causal relations, avg L-Score
```

#### `god_checkpoint`
Create a Git-trackable database checkpoint.

```typescript
god_checkpoint({
  overwrite: false              // Optional: overwrite most recent
})
```

---

### Provenance Tools

#### `god_trace`
Trace the provenance lineage of an entry.

```typescript
god_trace({
  entryId: "uuid-here",
  depth: 5                       // Optional: max depth to trace
})
// Returns: L-Score, lineage depth, parent entries, reliability category
```

---

### Causal Reasoning Tools

#### `god_causal`
Add a causal relationship between entries.

```typescript
god_causal({
  sourceIds: ["entry-1", "entry-2"],
  targetIds: ["entry-3"],
  type: "causes",                // causes|enables|prevents|correlates|precedes|triggers
  strength: 0.85,
  ttl: 86400000                  // Optional: TTL in ms (24 hours)
})
```

#### `god_find_paths`
Find causal paths between two entries.

```typescript
god_find_paths({
  sourceId: "entry-1",
  targetId: "entry-5",
  maxDepth: 10
})
// Returns: all causal paths connecting the entries
```

#### `god_cleanup_expired`
Clean up expired TTL-based causal relations.

```typescript
god_cleanup_expired()
// Returns: count of cleaned relations
```

---

### Learning Tools (Sona Engine)

#### `god_learn`
Provide feedback on a reasoning trajectory.

```typescript
god_learn({
  trajectoryId: "traj-uuid",     // From previous god_query
  quality: 0.9,                  // 0-1 success score
  route: "pattern_match"         // Optional: reasoning type used
})
```

#### `god_learning_stats`
Get Sona learning engine statistics.

```typescript
god_learning_stats()
// Returns: trajectory count, feedback count, avg quality, drift metrics
```

#### `god_prune_patterns`
Prune low-performance patterns.

```typescript
god_prune_patterns({
  minUses: 100,                  // Min uses before eligible
  maxSuccessRate: 0.4            // Prune below this rate
})
```

---

### Adversarial Tools

#### `god_shadow_search`
Find contradictory evidence using shadow vectors (v × -1).

```typescript
god_shadow_search({
  query: "The market is bullish",
  topK: 5,
  threshold: 0.7                 // Min refutation strength
})
// Returns: contradicting entries with refutation scores
```

---

### GNN Enhancement Tools

#### `god_enhance`
Enhance a single entry's embedding using graph context.

```typescript
god_enhance({
  entryId: "uuid-here"
})
// Returns: 1024-dim enhanced embedding
```

#### `god_enhance_batch`
Enhance multiple entries' embeddings.

```typescript
god_enhance_batch({
  entryIds: ["id-1", "id-2", "id-3"]
})
```

#### `god_gnn_stats`
Get GNN enhancement layer statistics.

```typescript
god_gnn_stats()
// Returns: cache size, enhancement count, avg neighbors
```

#### `god_clear_gnn_cache`
Clear the GNN embedding cache.

```typescript
god_clear_gnn_cache()
```

---

### Neural Routing Tools

#### `god_route`
Route a query to the optimal reasoning strategy.

```typescript
god_route({
  query: "What caused the market crash?",
  preferredRoute: "causal_backward"  // Optional hint
})
// Returns: recommended route, confidence, reasoning
```

**Available Routes:**
- `pattern_match` - Find similar historical patterns
- `causal_forward` - What effects does X cause?
- `causal_backward` - What caused X?
- `temporal_causal` - Time-based cause-effect chains
- `hybrid` - Combine pattern + causal
- `direct_retrieval` - Simple vector search

#### `god_route_result`
Record the outcome of a routed query.

```typescript
god_route_result({
  route: "causal_backward",
  success: true,
  latencyMs: 150
})
```

#### `god_routing_stats`
Get routing statistics.

```typescript
god_routing_stats()
// Returns: route usage counts, success rates, avg latency
```

#### `god_circuit_status`
Check circuit breaker status for routes.

```typescript
god_circuit_status({
  route: "pattern_match"         // Optional: specific route
})
// Returns: CLOSED (healthy), OPEN (suspended), HALF_OPEN (testing)
```

#### `god_reset_circuit`
Reset a tripped circuit breaker.

```typescript
god_reset_circuit({
  route: "pattern_match"         // Optional: specific route, or all
})
```

---

### Scheduler Tools

#### `god_schedule`
Schedule a task for future execution.

```typescript
god_schedule({
  name: "Daily Analysis",
  prompt: "Analyze today's data. Context: {context}",
  trigger: {
    type: "cron",                // datetime|cron|event|file|manual
    pattern: "0 9 * * *"         // 9am daily
  },
  contextIds: ["id-1", "id-2"],  // Optional: memory IDs for context
  contextQuery: "recent analysis", // Optional: or query for fresh context
  priority: 8,                   // 1-10
  notify: {
    onComplete: true,
    onDecision: true
  }
})
```

**Trigger Types:**

| Type | Config | Example |
|------|--------|---------|
| `datetime` | `at: "ISO-date"` | `"2025-12-31T23:59:59Z"` |
| `cron` | `pattern: "cron"` | `"0 9 * * 1-5"` (9am weekdays) |
| `event` | `event: "name"` | `"trading_complete"` |
| `file` | `path: "...", event: "modified"` | Watch file changes |
| `manual` | (none) | Trigger via `god_trigger` |

#### `god_trigger`
Fire an event or manually trigger a task.

```typescript
// Fire an event (triggers all listening tasks)
god_trigger({ event: "trading_complete" })

// Trigger specific task
god_trigger({ taskId: "task-uuid" })
```

#### `god_tasks`
List scheduled tasks.

```typescript
god_tasks({
  status: "pending",             // pending|running|completed|paused|all
  limit: 20
})
```

#### `god_pause`
Pause a scheduled task.

```typescript
god_pause({ taskId: "task-uuid" })
```

#### `god_resume`
Resume a paused task.

```typescript
god_resume({ taskId: "task-uuid" })
```

#### `god_cancel`
Cancel and remove a task.

```typescript
god_cancel({ taskId: "task-uuid" })
```

#### `god_scheduler_stats`
Get scheduler statistics.

```typescript
god_scheduler_stats()
// Returns: task counts by status, run history, event queue size
```

---

## Usage Examples

### Example 1: Building a Knowledge Base

```typescript
// Store initial facts
const entry1 = await god_store({
  content: "RSI below 30 indicates oversold conditions",
  tags: ["trading", "indicators", "RSI"],
  importance: 0.9,
  source: "external"
});

const entry2 = await god_store({
  content: "Oversold conditions often precede price reversals",
  tags: ["trading", "patterns"],
  importance: 0.8,
  source: "agent_inference",
  parentIds: [entry1.id],
  confidence: 0.85
});

// Create causal relation
await god_causal({
  sourceIds: [entry1.id],
  targetIds: [entry2.id],
  type: "enables",
  strength: 0.8
});
```

### Example 2: Querying with Provenance

```typescript
// Find relevant memories with reliability scores
const results = await god_query({
  query: "RSI trading signals",
  topK: 5,
  includeProvenance: true
});

// Check reliability of top result
const trace = await god_trace({
  entryId: results[0].id
});
console.log(`L-Score: ${trace.lScore}, Reliability: ${trace.category}`);
```

### Example 3: Finding Contradictions

```typescript
// Store a hypothesis
await god_store({
  content: "Low volatility always signals bullish continuation",
  tags: ["hypothesis", "volatility"]
});

// Find contradicting evidence
const contradictions = await god_shadow_search({
  query: "Low volatility always signals bullish continuation",
  topK: 5
});

// Evaluate credibility
const credibility = supportWeight / (supportWeight + contradictionWeight);
```

### Example 4: Scheduling Automated Analysis

```typescript
// Schedule daily market analysis
await god_schedule({
  name: "Morning Market Brief",
  prompt: `Analyze overnight market movements and provide key insights.
           Previous context: {context}`,
  trigger: {
    type: "cron",
    pattern: "0 8 * * 1-5"  // 8am weekdays
  },
  contextQuery: "yesterday market analysis",
  notify: { onComplete: true }
});

// Signal end of trading day
await god_trigger({ event: "market_close" });
```

### Example 5: Causal Path Analysis

```typescript
// Find what caused a specific outcome
const paths = await god_find_paths({
  sourceId: "fed-rate-hike-entry",
  targetId: "market-crash-entry",
  maxDepth: 5
});

// Analyze causal chain
paths.forEach(path => {
  console.log(`Path: ${path.nodes.join(' → ')}`);
  console.log(`Strength: ${path.strength}`);
});
```

---

## Advanced Features

### Circuit Breaker Pattern

The routing system uses circuit breakers to prevent cascade failures:

- **CLOSED**: Route is healthy, requests flow normally
- **OPEN**: Route has failed repeatedly, requests are blocked
- **HALF_OPEN**: Testing if route has recovered

```typescript
// Check status
const status = await god_circuit_status();

// Reset if needed
await god_reset_circuit({ route: "pattern_match" });
```

### Temporal Hyperedges (TTL)

Causal relations can expire automatically:

```typescript
// Create relation that expires in 24 hours
await god_causal({
  sourceIds: ["event-a"],
  targetIds: ["event-b"],
  type: "correlates",
  ttl: 24 * 60 * 60 * 1000  // 24 hours in ms
});

// Clean up expired relations
const cleaned = await god_cleanup_expired();
```

### Continuous Learning

The Sona engine learns from feedback:

```typescript
// Query returns trajectory ID
const result = await god_query({ query: "market prediction" });

// After using the result, provide feedback
await god_learn({
  trajectoryId: result.trajectoryId,
  quality: 0.9,  // High quality result
  route: "hybrid"
});

// System adjusts weights for better future results
```

### GNN-Enhanced Retrieval

For complex queries, use graph-enhanced embeddings:

```typescript
// Enhance embeddings with graph context
await god_enhance_batch({
  entryIds: ["key-entry-1", "key-entry-2"]
});

// Enhanced embeddings capture structural relationships
// 768-dim → 1024-dim with neighbor context
```

---

## Database Schema

God-agent uses SQLite with the following tables:

| Table | Purpose |
|-------|---------|
| `memory_entries` | Core memory storage |
| `memory_tags` | Entry tags (many-to-many) |
| `provenance` | L-Score and lineage data |
| `provenance_links` | Parent-child relationships |
| `causal_relations` | Hyperedge relations |
| `causal_sources` | Relation source nodes |
| `causal_targets` | Relation target nodes |
| `pattern_templates` | Reusable patterns |
| `pattern_stats` | Pattern success tracking |
| `vector_mappings` | HNSW label mappings |
| `scheduled_tasks` | Task definitions |
| `task_runs` | Execution history |
| `event_queue` | Event-based triggers |

---

## Troubleshooting

### "L-Score below threshold" Error

Your entry's provenance chain has too low reliability:
- Increase `confidence` when storing
- Reduce derivation depth
- Or disable threshold: set `minLScoreThreshold: 0`

### Circuit Breaker Open

A route has failed too many times:
```typescript
await god_reset_circuit({ route: "failing-route" });
```

### Slow Queries

- Check vector count: `god_stats()`
- Clear GNN cache: `god_clear_gnn_cache()`
- Reduce `topK` in queries

### Missing Embeddings

Ensure `OPENAI_API_KEY` is set and valid.

---

## API Versioning

Current version: **0.1.0**

All tools use JSON input/output for compatibility.

---

## License

MIT License
