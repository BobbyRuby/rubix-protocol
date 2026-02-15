# Reflexion Architecture

Claude-powered verbal reflection system that generates structured root cause analysis
when tasks fail, extracting lessons and recommendations for future attempts.

## Purpose

While SelfHealer classifies errors by type and selects fix strategies, Reflexion goes
deeper: it uses Claude to generate natural language explanations of WHY a failure
happened, producing generalizable lessons that can be semantically searched and applied
to future tasks facing similar challenges.

## Source Files

- `src/reflexion/ReflexionService.ts` -- Reflection generation, storage, querying, lesson extraction
- `src/reflexion/types.ts` -- Reflection, RootCauseCategory, ReflexionConfig

## Key Concepts

**Root Cause Categories:** `misunderstood_requirements`, `missing_context`,
`wrong_approach`, `dependency_issue`, `type_mismatch`, `integration_failure`,
`test_logic_error`, `environment_issue`, `race_condition`, `resource_exhaustion`,
`api_misuse`, `security_violation`, `other`.

**Reflection Structure:** Each contains `whyItFailed` (Claude-generated root cause),
`rootCause` (categorized), `lesson` (generalizable principle), `nextTimeApproach`
(concrete recommendation), and `confidence` (0.0-1.0).

**Generation Flow:**
1. SelfHealer builds ReflectionContext (failure, previous attempts, code, stack trace)
2. Structured prompt sent to Claude (with optional extended thinking, 4096 budget)
3. XML-tagged response parsed into Reflection object
4. Stored with tags `reflexion`, `root_cause:<category>`, `task:<id>`
5. Causal link created: failure TRIGGERS reflection

**Query Results:** Searching past reflections returns `applicableLessons` (principles),
`suggestedApproaches` (what worked), and `approachesToAvoid` (what failed).

**Config:** `model: claude-sonnet-4-20250514`, `maxTokens: 2048`, `minConfidence: 0.5`,
`enableExtendedThinking: true`, `cacheTtlMs: 3600000` (1 hour).

## MCP Tools

| Tool | Description |
|------|-------------|
| `god_reflexion_query` | Search past reflections by error or context |
| `god_reflexion_generate` | Generate a reflection on a specific failure |
| `god_reflexion_stats` | Count by root cause, avg confidence, top lessons |

## Usage Example

```typescript
// Query for lessons relevant to current task
const result = await god_reflexion_query({
  query: "TypeScript type error calling external API",
  topK: 5, highConfidenceOnly: true
});
// Returns: {
//   applicableLessons: ["Always validate API response shape before destructuring"],
//   suggestedApproaches: ["Use zod schema validation on API responses"],
//   approachesToAvoid: ["Trusting API docs without runtime checks"]
// }

// Check statistics
const stats = await god_reflexion_stats();
// Returns: { totalReflections: 34, avgConfidence: 0.73,
//   byRootCause: { wrong_approach: 12, missing_context: 8, ... } }
```

## Related Systems

- **SelfHealer** -- Invokes Reflexion during fix loop analysis
- **Failure Memory** -- Structured failure records that Reflexion analyzes
- **Causal Memory** -- Reflections linked to failures via TRIGGERS relation
- **Sona** -- Reflection quality feeds into trajectory learning
