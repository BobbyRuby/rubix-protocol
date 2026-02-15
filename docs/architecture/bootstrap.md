# Self-Knowledge Bootstrap

**File:** `src/bootstrap/SelfKnowledgeBootstrap.ts` (~190 lines)

Self-knowledge initialization system. On first run, RUBIX stores compressed descriptions of its own architecture, capabilities, and tool inventory as memory entries. Enables `god_self_query` for introspective queries about its own design.

## Purpose

Bootstrap solves the cold-start problem: RUBIX needs to understand its own capabilities to answer questions about itself. On first initialization, it stores pre-written compressed knowledge entries covering architecture, tools, workflows, and subsystems. These entries are tagged `rubix:self` and queryable via semantic search.

## Key Concepts

### Bootstrap Entries

Knowledge is organized in `src/bootstrap/knowledge/` across categories:

| File | Category | Content |
|------|----------|---------|
| `core.ts` | `core` | Memory engine, storage, vector DB architecture |
| `codex.ts` | `codex` | PhasedExecutor, task execution, fix loops |
| `capabilities.ts` | `capabilities` | LSP, Git, AST, profiling, debugging |
| `mcp-tools.ts` | `tools` | All 50+ MCP tool descriptions |
| `workflows.ts` | `workflows` | Common usage patterns and flows |
| `departments.ts` | `departments` | Engineer, reviewer, executor roles |
| `system.ts` | `system` | Config, environment, deployment |

### One-Time Execution

Bootstrap tracks completion via the `bootstrap_status` SQLite table (key: `self_knowledge_v1`). It runs only once per database. Use `rebootstrap()` to force re-run without deleting existing entries (vector search deduplicates).

### Compressed Storage

Entries are stored pre-compressed with the `expandable: true` context flag. When queried via `querySelf()`, entries are auto-expanded using `MemoryCompressor.autoDecode()`. All entries use `MemorySource.SYSTEM` with importance `0.9`.

### Tagging

Every bootstrap entry is tagged with:
- `rubix:self` - Identifies it as self-knowledge
- `rubix:{category}` - Category tag (e.g., `rubix:codex`, `rubix:core`)

## MCP Tools

### god_self_query

Query RUBIX about its own architecture and capabilities:

```typescript
const answers = await mcp__rubix__god_self_query({
  question: "How does the fix loop work in PhasedExecutor?",
  topK: 5
});
// Returns: string[] of expanded self-knowledge entries
```

### god_bootstrap_status

Check bootstrap state and entry counts:

```typescript
const status = await mcp__rubix__god_bootstrap_status();
// Returns: { bootstrapped: true, entriesCount: 42, categories: { core: 8, codex: 12, ... } }
```

## Bootstrap Flow

```
MCP Server startup
  → SelfKnowledgeBootstrap.bootstrap()
    → hasBootstrapped()? → skip
    → For each SELF_KNOWLEDGE entry:
        → engine.store(compressed, { tags: ['rubix:self', 'rubix:{type}'] })
    → markBootstrapped('self_knowledge_v1')
```

## Next Steps

- [Memory System](memory-system.md) - Storage and query infrastructure
- [Data Flow](data-flow.md) - How bootstrap fits into initialization
