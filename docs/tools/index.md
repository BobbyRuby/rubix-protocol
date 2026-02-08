# MCP Tools Reference

The god-agent exposes **80+ MCP tools** through the MCP server for use by Claude Code.

## Tool Categories

| Category | Count | Description |
|----------|-------|-------------|
| [Memory Tools](memory-tools.md) | 10 | Store, query, edit, delete memories |
| [Causal Tools](causal-tools.md) | 4 | Causal relations and contradictions |
| [Learning Tools](learning-tools.md) | 12 | Sona learning and routing |
| [Scheduler Tools](scheduler-tools.md) | 7 | Task scheduling |
| [Playwright Tools](playwright-tools.md) | 8 | Browser automation |
| [CODEX Tools](codex-tools.md) | 7 | RUBIX task execution |
| [Partner Tools](partner-tools.md) | 3 | Collaborative partner |
| [Containment Tools](containment-tools.md) | 6 | Path permissions |
| [Capability Tools](capability-tools.md) | 40+ | LSP, Git, AST, etc. |
| [Review Tools](review-tools.md) | 4 | Code review |
| [Notification Tools](notification-tools.md) | 6 | Notifications |
| [Deep Work Tools](deepwork-tools.md) | 6 | Focus sessions |
| [Config Tools](config-tools.md) | 5 | Configuration |
| [Failure Tools](failure-tools.md) | 4 | Failure learning |
| [Communication Tools](communication-tools.md) | 2 | Escalation channels |
| [Curiosity Tools](curiosity-tools.md) | 4 | Autonomous exploration |

## Quick Reference

### Most Used Tools

| Tool | Purpose |
|------|---------|
| `god_store` | Store information with compression |
| `god_query` | Semantic search |
| `god_query_expanded` | Query with auto-expansion |
| `god_codex_do` | Submit task to RUBIX |
| `god_codex_status` | Check RUBIX status |
| `god_trace` | Trace provenance lineage |
| `god_learn` | Provide query feedback |

### Tool Naming Convention

- `god_` prefix for all tools
- Category: `god_{category}_{action}`
- Examples:
  - `god_store` - Memory store
  - `god_codex_do` - CODEX task submission
  - `god_pw_launch` - Playwright launch
  - `god_lsp_definition` - LSP go-to-definition

## Tool Response Format

All tools return JSON responses with consistent structure:

```typescript
// Success
{
  success: true,
  entryId?: string,
  results?: any[],
  // ... tool-specific fields
}

// Error
{
  success: false,
  error: string,
  code?: string
}
```

## Common Parameters

### Memory Tools

| Parameter | Type | Description |
|-----------|------|-------------|
| `content` | string | Content to store |
| `tags` | string[] | Categorization tags |
| `importance` | 0-1 | Importance score |
| `source` | enum | user_input, agent_inference, tool_output, system, external |
| `topK` | number | Number of results (default: 10) |

### Query Filtering

| Parameter | Type | Description |
|-----------|------|-------------|
| `tags` | string[] | Filter by tags |
| `minImportance` | 0-1 | Minimum importance |
| `sources` | enum[] | Filter by source types |
| `includeProvenance` | boolean | Include L-Score |

## Tool Usage Examples

### Store and Query

```typescript
// Store
await god_store({
  content: "Authentication module uses JWT tokens",
  tags: ["auth", "security"],
  importance: 0.8
});

// Query
const results = await god_query({
  query: "how does authentication work?",
  topK: 5,
  includeProvenance: true
});
```

### Task Execution

```typescript
// Submit task
const { taskId } = await god_codex_do({
  description: "Add user registration endpoint",
  codebase: "D:/my-project",
  constraints: ["Use TypeScript", "Add tests"]
});

// Check status
const status = await god_codex_status();
```

### Browser Automation

```typescript
// Launch browser
const { sessionId } = await god_pw_launch({
  browser: "chromium",
  headless: true
});

// Navigate and verify
await god_pw_navigate({ sessionId, url: "http://localhost:3000" });
await god_pw_assert({ sessionId, type: "visible", selector: ".login-form" });
```
