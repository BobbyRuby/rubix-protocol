# Causal Memory Architecture

Manages hypergraph causal relations between memory entries, supporting complex
multi-source/multi-target causation with optional TTL-based expiration.

## Purpose

Tracks WHY things are related, not just THAT they are related. Models causation as
a directed hypergraph where edges connect `sourceIds[]` to `targetIds[]`, capturing
complexity like "A and B together cause C."

## Source Files

- `src/causal/CausalMemory.ts` -- High-level API combining Hypergraph with SQLite
- `src/causal/Hypergraph.ts` -- In-memory hypergraph with DFS/BFS traversal
- `src/causal/CausalDetector.ts` -- Automatic causal relation detection
- `src/causal/types.ts` -- HyperedgeData, CausalPath, CausalQuery

## Key Concepts

**Relation Types:** `causes` (direct), `enables` (prerequisite), `prevents`,
`correlates`, `precedes` (temporal), `triggers` (event).

**Hyperedges:** Each edge carries `type`, `strength` (0.0-1.0), and optional `ttl`
in milliseconds. Unlike normal graphs, one edge can connect N sources to M targets.

**TTL Expiration:** Relations can expire -- useful for regime-dependent correlations
(e.g., temporary deployment window). Cleanup removes from both SQLite and in-memory.

**Traversal:** DFS-based with configurable direction (`forward`, `backward`, `both`),
max depth, relation type filters, and minimum strength. O(1) cycle detection via Set.

## MCP Tools

| Tool | Description |
|------|-------------|
| `god_causal` | Add a causal relation between memory entries |
| `god_find_paths` | Find all causal paths between two entries |
| `god_cleanup_expired` | Remove expired TTL-based relations |

## Usage Example

```typescript
// Record that a bug causes an error
await god_causal({
  sourceIds: ["bug_entry_id"], targetIds: ["error_entry_id"],
  type: "causes", strength: 0.9
});

// Add a temporary correlation (7-day TTL)
await god_causal({
  sourceIds: ["metric_a"], targetIds: ["metric_b"],
  type: "correlates", strength: 0.7, ttl: 604800000
});

// Find causal chain between two entries
const paths = await god_find_paths({
  sourceId: "bug_entry_id", targetId: "outage_entry_id", maxDepth: 5
});

// Clean up expired relations
await god_cleanup_expired();
// Returns: { cleaned: 3, relationIds: ["rel_1", "rel_2", "rel_3"] }
```

## Related Systems

- **GNN Enhancement** -- Uses causal graph structure for embedding enrichment
- **Distillation** -- Extracts failure-fix chains via causal traversal
- **Failure Memory** -- Creates causal links between failures, root causes, and fixes
- **Provenance** -- Parent-child links form complementary graph edges
