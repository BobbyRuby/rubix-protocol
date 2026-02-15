# Memory Distillation Architecture

Weekly automated memory distillation that extracts generalizable patterns from
accumulated memories using Claude-powered analysis.

## Purpose

While Reflexion and Sona learn reactively from individual events, Distillation
proactively reviews the full memory corpus to extract higher-order insights: success
patterns, failure-fix chains, and cross-domain principles. Runs on a weekly cron
schedule (Sunday 3am) with budget-controlled token usage (~20K tokens/run).

## Source Files

- `src/distillation/MemoryDistillationService.ts` (~1263 lines) -- Full service
- `src/distillation/types.ts` -- DistilledInsight, DistillationConfig, DistillationType

## Key Concepts

**Insight Types:**

| Type | Description |
|------|-------------|
| `success_pattern` | "When facing X, approach Y works because Z" (cluster min 3) |
| `failure_fix` | "Error X caused by Y, fix with Z" (from causal chains) |
| `cross_domain` | Transferable principles across domains (2+ domains, 2+ memories each) |
| `contradiction` | Conflicting memories needing resolution (deferred) |
| `consolidation` | Merge many small memories into fewer (deferred) |

**Extraction Pipeline:**
- *Success patterns:* Query `success`/`resolution` memories -> cluster by tags (min 3) -> Claude analysis
- *Failure-fix chains:* Query `failure` memories -> traverse causal links to resolutions -> Claude analysis
- *Cross-domain:* Query high-importance patterns -> group by domain -> pair domains -> Claude analysis

**Storage:** Insights stored with importance 0.9, tags `distilled_insight` + `type:<T>`,
causal `ENABLES` links from sources, and Sona feedback (0.85) for confidence >= 0.8.

**Config:** `schedule: '0 3 * * 0'`, `maxTokensPerRun: 100000`, `minConfidence: 0.7`,
`lookbackDays: 7`, `model: claude-sonnet-4-20250514`, `enableExtendedThinking: true`.

## MCP Tools

| Tool | Description |
|------|-------------|
| `god_distill` | Manually trigger distillation (supports dry run, type override) |
| `god_distillation_stats` | Run history, insight counts, token usage |
| `god_distillation_config` | View or update configuration |
| `god_distillation_query` | Search stored insights by semantic query |

## Usage Example

```typescript
// Trigger manual distillation (dry run)
const result = await god_distill({ dryRun: true, types: ["success_pattern"] });
// Returns: { insights: [...], tokensUsed: 4200, memoriesProcessed: 28 }

// Query past insights
const insights = await god_distillation_query({
  query: "authentication patterns", type: "success_pattern", topK: 5
});

// Check stats
const stats = await god_distillation_stats();
// Returns: { totalRuns: 12, totalInsights: 47, avgTokensPerRun: 18500 }
```

## Related Systems

- **Causal Memory** -- Failure-fix chains discovered via causal traversal
- **Sona** -- Insights feed back into trajectory learning
- **Curiosity** -- Runs on aligned weekly schedule (Mon/Wed/Fri vs Sunday)
- **Shadow Search** -- `contradiction` type uses adversarial search
