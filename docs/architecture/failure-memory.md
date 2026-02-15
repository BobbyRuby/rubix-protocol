# Failure Memory Architecture

Structured failure database that records, queries, and tracks resolution of errors.
Used by SelfHealer to avoid repeating mistakes and by Reflexion as source material.

## Purpose

Quantitative tracking layer for failures: which approaches failed, which succeeded,
what patterns recur. SelfHealer's primary reference when deciding how to fix a task.

## Source Files

- `src/failure/FailureMemoryService.ts` -- Recording, querying, resolution tracking, pattern cache
- `src/failure/types.ts` -- FailureMemory, FailurePattern, FailureCausalLink, FailureStats

## Key Concepts

**FailureMemory Record:** Stores `taskId`, `subtaskId`, `attemptNumber`, `approach`,
`error`/`errorType`, `consoleErrors`, `stackTrace`, `resolved`, `resolutionApproach`.

**Error Types:** Classified by SelfHealer: `syntax`, `type`, `runtime`, `test`,
`integration`, `timeout`, `unknown`.

**Pattern Cache:** Errors are normalized (numbers->N, strings->STR) to create
signatures. Each pattern tracks `occurrences`, `failedApproaches`, and
`successfulFixes`, letting the system skip known-bad approaches and try known-good
fixes first.

**Query Results:** Returns `similarFailures`, `suggestedAvoidances` (approaches that
failed for similar errors), and `recommendedApproaches` (approaches that resolved them).

**Causal Links:** On resolution with known root cause, three relations are created:
failure CAUSES rootCause (0.8), rootCause ENABLES fix (0.9), failure TRIGGERS fix (0.7).

**Sona Integration:** Failures get low-quality feedback (0.2) to down-weight bad
patterns. Resolutions get high-quality feedback (0.8) to reinforce successful ones.

## MCP Tools

| Tool | Description |
|------|-------------|
| `god_failure_record` | Record a new failure with error details and context |
| `god_failure_query` | Find similar past failures, get avoidance/fix recommendations |
| `god_failure_resolve` | Mark failure as resolved, record successful approach |
| `god_failure_stats` | Counts, error type breakdown, resolution rate |

## Usage Example

```typescript
// Record a failure
const failure = await god_failure_record({
  taskId: "task_123", subtaskId: "sub_456", attemptNumber: 1,
  approach: "Direct SQL without parameterization",
  error: "SQLITE_ERROR: near DROP: syntax error",
  errorType: "runtime", context: "Writing user input to database",
  subtaskType: "database_write"
});

// Query before retrying
const query = await god_failure_query({
  error: "SQLITE_ERROR", context: "database write"
});
// Returns: {
//   suggestedAvoidances: ["Direct SQL without parameterization"],
//   recommendedApproaches: ["Use parameterized prepared statements"]
// }

// Mark resolved
await god_failure_resolve({
  failureId: failure.id,
  approach: "Switched to parameterized prepared statements"
});
```

## Related Systems

- **SelfHealer** -- Primary consumer; queries failures before each fix attempt
- **Reflexion** -- Generates qualitative "why" analysis from failure records
- **Causal Memory** -- Failure-cause-fix chains stored as causal relations
- **Distillation** -- Extracts failure-fix patterns for higher-order insights
