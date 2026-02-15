# GNN Enhancement Layer Architecture

Graph Neural Network layer that enriches embeddings by incorporating structural
context from causal and provenance graphs via message passing.

## Purpose

Standard embeddings capture semantic content but miss structural relationships. The
GNN Enhancement Layer uses the graph of causal relations and provenance links to
enrich each entry's embedding with neighbor information, producing graph-aware
embeddings that improve retrieval recall by an estimated 15-30%.

## Source Files

- `src/gnn/EnhancementLayer.ts` -- Ego graph extraction, projection (768d->1024d), LRU cache
- `src/gnn/MessagePassing.ts` -- Neighbor aggregation (mean, sum, max, attention)
- `src/gnn/EgoGraphExtractor.ts` -- Extracts 2-hop neighborhood subgraphs
- `src/gnn/types.ts` -- EgoGraph, EnhancementConfig, MessagePassingConfig

## Key Concepts

**Enhancement Pipeline:**
1. Extract ego graph (2-hop neighborhood, max 50 neighbors/hop)
2. Load neighbor embeddings via lookup function
3. Aggregate via message passing: `h' = 0.5*h_center + 0.5*AGG(neighbors)`
4. Project: `768d -> Linear(512) -> ReLU -> Linear(1024) + Residual -> Normalize`

**Aggregation Methods:** `mean` (weighted by edge weight + distance decay, default),
`sum`, `max` (element-wise), `attention` (learned query-key dot product with softmax).
Distance decay of 0.7/hop means 2-hop neighbors contribute ~49% of 1-hop weight.

**Residual Connection:** Original 768d embedding is zero-padded to 1024d and added
to the projection output, preserving the original semantic signal.

**LRU Cache:** Bounded cache (max 1000 entries) avoids recomputation. Cache hit rate
tracked in statistics.

## MCP Tools

| Tool | Description |
|------|-------------|
| `god_enhance` | Enhance a single entry's embedding using GNN |
| `god_enhance_batch` | Enhance multiple entries in batch |
| `god_gnn_stats` | Get statistics (count, avg neighbors, cache hit rate) |
| `god_clear_gnn_cache` | Clear the enhancement cache |

## Usage Example

```typescript
// Enhance a single entry
const result = await god_enhance({ entryId: "entry_abc" });
// Returns: { entryId, neighborsUsed: 8, processingTimeMs: 12 }

// Batch enhance
const batch = await god_enhance_batch({
  entryIds: ["entry_1", "entry_2", "entry_3"]
});
// Returns: { results: [...], totalTimeMs: 34, avgNeighbors: 6.3 }

// Check statistics
const stats = await god_gnn_stats();
// Returns: { enhancementsPerformed: 142, avgNeighborsUsed: 7.2,
//            avgProcessingTimeMs: 11.5, cacheHitRate: 0.34 }
```

## Related Systems

- **Causal Memory** -- Provides graph structure for neighbor extraction
- **Provenance** -- Parent-child links form additional graph edges
- **VectorDB** -- Enhanced embeddings used for richer similarity search
