# Learning & Routing Tools

Tools for trajectory learning, query routing, and GNN enhancement.

## Tool Reference

| Tool | Purpose |
|------|---------|
| [god_learn](#god_learn) | Provide feedback |
| [god_learning_stats](#god_learning_stats) | Learning statistics |
| [god_prune_patterns](#god_prune_patterns) | Prune failing patterns |
| [god_route](#god_route) | Route query |
| [god_route_result](#god_route_result) | Record route result |
| [god_routing_stats](#god_routing_stats) | Routing statistics |
| [god_circuit_status](#god_circuit_status) | Circuit breaker status |
| [god_reset_circuit](#god_reset_circuit) | Reset circuit breaker |
| [god_enhance](#god_enhance) | GNN enhancement |
| [god_enhance_batch](#god_enhance_batch) | Batch GNN enhancement |
| [god_gnn_stats](#god_gnn_stats) | GNN statistics |
| [god_clear_gnn_cache](#god_clear_gnn_cache) | Clear GNN cache |

---

## god_learn

Provide feedback for a query trajectory to improve future retrieval.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `trajectoryId` | string | Yes | Trajectory ID from previous query |
| `quality` | number | Yes | Quality score 0-1 |
| `route` | string | No | Optional reasoning route |

### Quality Scores

| Score | Meaning | Effect |
|-------|---------|--------|
| 0.0 | Completely useless | Strong negative gradient |
| 0.25 | Mostly unhelpful | Moderate negative |
| 0.5 | Neutral | No change |
| 0.75 | Mostly helpful | Moderate positive |
| 1.0 | Perfect results | Strong positive |

### Response

```json
{
  "success": true,
  "trajectoryId": "traj_abc123",
  "quality": 0.8,
  "patternsUpdated": 5,
  "driftScore": 0.15
}
```

### Example

```typescript
// First, run a query
const result = await mcp__rubix__god_query({
  query: "authentication patterns"
});

// Evaluate results, then provide feedback
await mcp__rubix__god_learn({
  trajectoryId: result.trajectoryId,
  quality: 0.8  // Good results
});
```

---

## god_learning_stats

Get Sona learning engine statistics.

### Parameters

None.

### Response

```json
{
  "success": true,
  "totalTrajectories": 1500,
  "trajectoriesWithFeedback": 1200,
  "totalPatterns": 350,
  "avgSuccessRate": 0.72,
  "currentDrift": 0.12,
  "pruneCandidates": 15,
  "boostCandidates": 45
}
```

### Example

```typescript
const stats = await mcp__rubix__god_learning_stats();

console.log(`Feedback coverage: ${(stats.trajectoriesWithFeedback / stats.totalTrajectories * 100).toFixed(1)}%`);
console.log(`Average success rate: ${(stats.avgSuccessRate * 100).toFixed(1)}%`);
console.log(`Current drift: ${stats.currentDrift}`);
```

---

## god_prune_patterns

Prune patterns with low success rates.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `dryRun` | boolean | No | Preview without deleting |

### Prune Criteria

- At least 100 uses (configurable)
- Success rate below 40% (configurable)

### Response

```json
{
  "success": true,
  "pruned": [
    {
      "id": "pattern_123",
      "name": "keyword:deprecated",
      "uses": 150,
      "successRate": 0.25
    }
  ],
  "total": 3
}
```

### Example

```typescript
// Preview what would be pruned
const preview = await mcp__rubix__god_prune_patterns({
  dryRun: true
});

console.log(`Would prune ${preview.total} patterns`);

// Actually prune
const result = await mcp__rubix__god_prune_patterns({
  dryRun: false
});
```

---

## god_route

Route a query to the optimal reasoning strategy.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Query to route |
| `preferredRoute` | enum | No | Preferred route |
| `previousRoute` | enum | No | Previous route used |

### Route Types

| Route | Description | Keywords |
|-------|-------------|----------|
| `pattern_match` | Similar historical patterns | "similar", "like", "pattern" |
| `causal_forward` | What effects does X cause? | "effect", "result", "lead to" |
| `causal_backward` | What caused X? | "why", "cause", "root" |
| `temporal_causal` | Time-based cause-effect | "after", "before", "timeline" |
| `hybrid` | Combined pattern + causal | Complex queries |
| `direct_retrieval` | Simple vector search | Simple queries |
| `adversarial` | Find contradictory evidence | "counter", "against", "risk" |

### Response

```json
{
  "success": true,
  "query": "what caused the authentication failure?",
  "recommendedRoute": "causal_backward",
  "confidence": 0.85,
  "alternatives": [
    { "route": "hybrid", "confidence": 0.65 },
    { "route": "pattern_match", "confidence": 0.45 }
  ],
  "routingTimeMs": 1.2
}
```

### Example

```typescript
// Route query first
const routing = await mcp__rubix__god_route({
  query: "what caused the server crash?"
});

console.log(`Recommended: ${routing.recommendedRoute}`);
console.log(`Confidence: ${routing.confidence}`);

// Execute with recommended route
// ... then record result
```

---

## god_route_result

Record the result of executing a routed query.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `route` | enum | Yes | Route that was executed |
| `success` | boolean | Yes | Whether execution succeeded |

### Response

```json
{
  "success": true,
  "route": "causal_backward",
  "recorded": true,
  "circuitState": "CLOSED"
}
```

### Example

```typescript
// Execute query with route
const routing = await mcp__rubix__god_route({ query: "..." });
const results = await executeWithRoute(routing.recommendedRoute);

// Record success/failure
await mcp__rubix__god_route_result({
  route: routing.recommendedRoute,
  success: results.length > 0
});
```

---

## god_routing_stats

Get TinyDancer routing statistics.

### Parameters

None.

### Response

```json
{
  "success": true,
  "totalRouted": 5000,
  "routeCounts": {
    "pattern_match": 2000,
    "causal_backward": 1500,
    "direct_retrieval": 1000,
    "hybrid": 500
  },
  "avgConfidence": {
    "pattern_match": 0.82,
    "causal_backward": 0.78
  },
  "avgRoutingTimeMs": 1.5,
  "fallbackCount": 50,
  "circuitTrips": 2
}
```

---

## god_circuit_status

Get circuit breaker status for all routes.

### Parameters

None.

### Response

```json
{
  "success": true,
  "circuits": {
    "pattern_match": {
      "state": "CLOSED",
      "failureCount": 2,
      "successCount": 150,
      "totalFailures": 10,
      "totalSuccesses": 2000
    },
    "causal_backward": {
      "state": "HALF_OPEN",
      "failureCount": 0,
      "successCount": 1,
      "cooldownEndsAt": "2024-01-15T10:15:00Z"
    }
  }
}
```

### Circuit States

| State | Description |
|-------|-------------|
| `CLOSED` | Normal operation |
| `OPEN` | Route blocked due to failures |
| `HALF_OPEN` | Testing if route recovered |

---

## god_reset_circuit

Reset circuit breaker for a route.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `route` | enum | No | Route to reset (omit for all) |

### Response

```json
{
  "success": true,
  "reset": ["pattern_match", "causal_backward"],
  "message": "All circuits reset to CLOSED"
}
```

---

## god_enhance

Enhance a memory entry's embedding using GNN.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entryId` | string | Yes | Entry ID to enhance |
| `includeWeights` | boolean | No | Include neighbor weights |

### Response

```json
{
  "success": true,
  "entryId": "entry_123",
  "originalDim": 768,
  "enhancedDim": 1024,
  "neighborsUsed": 12,
  "processingTimeMs": 45,
  "neighborWeights": {
    "entry_456": 0.25,
    "entry_789": 0.18
  }
}
```

### Example

```typescript
const enhanced = await mcp__rubix__god_enhance({
  entryId: "entry_important_123",
  includeWeights: true
});

console.log(`Used ${enhanced.neighborsUsed} neighbors`);
console.log(`Enhanced: ${enhanced.originalDim} → ${enhanced.enhancedDim} dims`);
```

---

## god_enhance_batch

Enhance multiple entries in batch.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entryIds` | string[] | Yes | Entry IDs to enhance |
| `maxBatchSize` | number | No | Max batch size (default: 50) |

### Response

```json
{
  "success": true,
  "enhanced": 45,
  "failed": 0,
  "avgNeighborsUsed": 8.5,
  "totalProcessingTimeMs": 1200,
  "results": [...]
}
```

---

## god_gnn_stats

Get GNN enhancement layer statistics.

### Parameters

None.

### Response

```json
{
  "success": true,
  "enhancementsPerformed": 500,
  "avgNeighborsUsed": 9.2,
  "avgProcessingTimeMs": 35,
  "cacheHitRate": 0.65,
  "cacheSize": 250
}
```

---

## god_clear_gnn_cache

Clear the GNN enhancement cache.

### Parameters

None.

### Response

```json
{
  "success": true,
  "cleared": 250,
  "message": "GNN cache cleared"
}
```

### When to Clear

- Graph structure has changed significantly
- Testing different enhancement configurations
- Memory pressure requires freeing resources

---

## Workflow Example

```typescript
// 1. Route query to optimal strategy
const routing = await mcp__rubix__god_route({
  query: "why did the tests fail?"
});

// 2. Execute query
const results = await mcp__rubix__god_query({
  query: "why did the tests fail?"
});

// 3. Record routing success
await mcp__rubix__god_route_result({
  route: routing.recommendedRoute,
  success: results.results.length > 0
});

// 4. Evaluate results and provide feedback
await mcp__rubix__god_learn({
  trajectoryId: results.trajectoryId,
  quality: 0.8
});

// 5. Check system health
const stats = await mcp__rubix__god_learning_stats();
if (stats.pruneCandidates > 10) {
  await mcp__rubix__god_prune_patterns({ dryRun: false });
}
```

## Next Steps

- [Causal Tools](causal-tools.md) - Causal relationships
- [Memory Tools](memory-tools.md) - Memory operations
- [Learning System](../learning/index.md) - Architecture
