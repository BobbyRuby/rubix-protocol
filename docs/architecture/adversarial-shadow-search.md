# Adversarial Shadow Search Architecture

Detects contradictions and conflicting information in stored memories by running
adversarial queries using inverted embedding vectors.

## Purpose

ShadowSearch is a built-in "devil's advocate." While normal vector search finds
entries that SUPPORT a claim, shadow search inverts the query embedding to find
entries that REFUTE it. This enables bias detection, risk assessment, and credibility
scoring before acting on stored knowledge.

## Source Files

- `src/adversarial/ShadowSearch.ts` -- Vector inversion, contradiction detection, credibility scoring
- `src/adversarial/types.ts` -- Contradiction, ShadowSearchResult, ContradictionType

## Key Concepts

**Shadow Vector Math:**
`Shadow(v) = v * -1`. Entries similar to the original query have high cosine
similarity to `v`; searching with `-v` returns semantically opposite entries.

**Contradiction Types:** `direct_negation` (>= 0.8 strength), `counterargument`
(>= 0.65), `alternative` (>= 0.5), `exception` (< 0.5), `falsification`.

**Credibility Score:**
`credibility = supportWeight / (supportWeight + contradictionWeight)`.
Weights are similarity scores optionally multiplied by L-Score. Below 0.5 = contested.

**Search Flow:**
1. Generate embedding for the query
2. Run normal search for supporting evidence
3. Invert the embedding and search for contradictions
4. Classify each contradiction by refutation strength
5. Calculate overall credibility score

## MCP Tools

| Tool | Description |
|------|-------------|
| `god_shadow_search` | Find contradictions to a claim and calculate credibility |

## Usage Example

```typescript
const result = await god_shadow_search({
  query: "Our auth middleware is secure against injection attacks",
  topK: 5, threshold: 0.5, includeProvenance: true
});
// Returns: {
//   contradictions: [
//     { entry: {...}, refutationStrength: 0.82, contradictionType: "direct_negation" },
//     { entry: {...}, refutationStrength: 0.61, contradictionType: "alternative" }
//   ],
//   count: 2,
//   credibility: 0.63,
//   supportWeight: 4.2,
//   contradictionWeight: 2.5
// }
```

## Related Systems

- **PhasedExecutor** -- Challenges design assumptions after architect phase
- **TinyDancer Router** -- Routes adversarial-intent queries to shadow search
- **Distillation** -- `contradiction` insight type resolves conflicting memories
