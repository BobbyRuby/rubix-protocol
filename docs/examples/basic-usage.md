# Basic Usage

Step-by-step examples for getting started with RUBIX/god-agent.

## Memory Operations

### Storing Information

```typescript
// Basic store
const entry = await mcp__rubix__god_store({
  content: "The API uses REST with JSON responses",
  tags: ["api", "rest", "documentation"]
});

console.log(`Stored with ID: ${entry.id}`);
```

### Store with Metadata

```typescript
await mcp__rubix__god_store({
  content: "Database uses PostgreSQL 15 with read replicas",
  tags: ["database", "postgres", "infrastructure"],
  importance: 0.9,        // High importance
  source: "user_input",   // User provided this
  confidence: 1.0         // Certain about this
});
```

### Store with Provenance

```typescript
// Store parent entry (high reliability)
const parent = await mcp__rubix__god_store({
  content: "Authentication uses JWT tokens",
  source: "user_input",
  importance: 0.9
});

// Store derived information (inherits reliability)
const child = await mcp__rubix__god_store({
  content: "JWT tokens expire after 1 hour and use RS256",
  parentIds: [parent.id],  // Links to parent for L-Score
  source: "agent_inference"
});

// L-Score = parent_lscore * 0.9 (decay factor)
```

### Querying Memory

```typescript
// Basic query
const results = await mcp__rubix__god_query({
  query: "how does authentication work?",
  topK: 5
});

for (const result of results.results) {
  console.log(`[${result.score.toFixed(2)}] ${result.content}`);
}
```

### Query with Filters

```typescript
// Filter by tags
const tagged = await mcp__rubix__god_query({
  query: "database configuration",
  tags: ["postgres", "config"],
  topK: 10
});

// Filter by source
const userProvided = await mcp__rubix__god_query({
  query: "api endpoints",
  sources: ["user_input"],
  minImportance: 0.7
});
```

### Query with Expansion

```typescript
// Auto-expand compressed entries
const expanded = await mcp__rubix__god_query_expanded({
  query: "error handling patterns",
  expand: true,
  topK: 5
});

// Returns human-readable content
for (const result of expanded.results) {
  console.log(result.expandedContent);
}
```

---

## Editing and Deleting

### Edit Entry

```typescript
// First find the entry
const results = await mcp__rubix__god_query({
  query: "jwt expiration",
  topK: 1
});

// Edit content
await mcp__rubix__god_edit({
  entryId: results.results[0].id,
  content: "JWT tokens expire after 2 hours (updated)",
  tags: ["jwt", "auth", "updated"]
});
```

### Delete Entry

```typescript
await mcp__rubix__god_delete({
  entryId: "entry_abc123",
  confirm: true  // Required to confirm deletion
});
```

---

## Provenance Tracking

### Trace Entry History

```typescript
const trace = await mcp__rubix__god_trace({
  entryId: "entry_xyz789",
  depth: 5  // Max depth to trace
});

console.log(`L-Score: ${trace.lScore}`);
console.log(`Reliability: ${trace.reliability}`);
console.log(`Lineage depth: ${trace.depth}`);
console.log(`Parents: ${trace.parents.length}`);
```

### Understanding L-Score

```
L-Score Categories:
- 0.8-1.0: High reliability (user_input, verified)
- 0.5-0.79: Medium reliability
- 0.3-0.49: Low reliability
- <0.3: Unreliable (may be blocked)
```

---

## Causal Relations

### Create Relationship

```typescript
// Store cause
const cause = await mcp__rubix__god_store({
  content: "Missing null check in user validation"
});

// Store effect
const effect = await mcp__rubix__god_store({
  content: "Application crashes on empty form submission"
});

// Create causal link
await mcp__rubix__god_causal({
  sourceIds: [cause.id],
  targetIds: [effect.id],
  type: "causes",
  strength: 0.95
});
```

### Relationship Types

```typescript
// Direct causation
type: "causes"

// Prerequisite
type: "enables"

// Prevention
type: "prevents"

// Correlation
type: "correlates"

// Temporal ordering
type: "precedes"

// Event trigger
type: "triggers"
```

### Find Paths

```typescript
// Find how things are connected
const paths = await mcp__rubix__god_find_paths({
  sourceId: "entry_abc",
  targetId: "entry_xyz",
  maxDepth: 5
});

for (const path of paths.paths) {
  console.log(`Path: ${path.join(" → ")}`);
}
```

### Temporal Relations (TTL)

```typescript
// Create relation that expires
await mcp__rubix__god_causal({
  sourceIds: [eventA],
  targetIds: [eventB],
  type: "correlates",
  strength: 0.7,
  ttl: 604800000  // 7 days in ms
});

// Clean up expired relations
await mcp__rubix__god_cleanup_expired({
  dryRun: false
});
```

---

## Shadow Search (Contradictions)

### Find Counter-Arguments

```typescript
// Find evidence against a claim
const shadow = await mcp__rubix__god_shadow_search({
  query: "Using localStorage for tokens is safe",
  topK: 5,
  threshold: 0.5
});

console.log(`Credibility: ${shadow.credibility}`);

for (const contradiction of shadow.contradictions) {
  console.log(`[${contradiction.refutationStrength}] ${contradiction.content}`);
}
```

### Filter by Type

```typescript
const directNegations = await mcp__rubix__god_shadow_search({
  query: "The API is fast",
  contradictionType: "direct_negation"
});
```

---

## Statistics

### Memory Stats

```typescript
const stats = await mcp__rubix__god_stats();

console.log(`Total entries: ${stats.totalEntries}`);
console.log(`Vector count: ${stats.vectorCount}`);
console.log(`Causal relations: ${stats.causalRelations}`);
console.log(`Average L-Score: ${stats.avgLScore}`);
```

### Learning Stats

```typescript
const learning = await mcp__rubix__god_learning_stats();

console.log(`Trajectories: ${learning.totalTrajectories}`);
console.log(`With feedback: ${learning.trajectoriesWithFeedback}`);
console.log(`Drift score: ${learning.driftScore}`);
```

### Routing Stats

```typescript
const routing = await mcp__rubix__god_routing_stats();

console.log(`Queries routed: ${routing.totalRouted}`);
console.log(`Fallback count: ${routing.fallbackCount}`);
console.log(`Circuit trips: ${routing.circuitTrips}`);
```

---

## Checkpoints

### Create Checkpoint

```typescript
// Save database state for version control
await mcp__rubix__god_checkpoint();
```

### Overwrite Latest

```typescript
// Update existing checkpoint
await mcp__rubix__god_checkpoint({
  overwrite: true
});
```

---

## Complete Workflow

```typescript
// 1. Store project knowledge
await mcp__rubix__god_store({
  content: "Project uses Express.js with TypeScript",
  tags: ["stack", "express", "typescript"],
  importance: 0.9,
  source: "user_input"
});

// 2. Store architectural decision
const decision = await mcp__rubix__god_store({
  content: "Chose PostgreSQL over MongoDB for ACID compliance",
  tags: ["database", "decision", "architecture"],
  importance: 0.8
});

// 3. Store implementation detail (linked)
await mcp__rubix__god_store({
  content: "Using Prisma ORM for type-safe database access",
  tags: ["orm", "prisma", "database"],
  parentIds: [decision.id],  // Links to decision
  source: "agent_inference"
});

// 4. Query for context
const context = await mcp__rubix__god_query({
  query: "database setup",
  topK: 5
});

// 5. Check for contradictions
const risks = await mcp__rubix__god_shadow_search({
  query: "PostgreSQL is the best choice"
});

// 6. Create checkpoint
await mcp__rubix__god_checkpoint();

console.log("Knowledge base updated!");
```

## Next Steps

- [Task Examples](task-examples.md) - CODEX task execution
- [Integration Examples](integration-examples.md) - Integration patterns
- [Memory Tools](../tools/memory-tools.md) - Complete tool reference
