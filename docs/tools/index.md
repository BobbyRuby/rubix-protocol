# MCP Tools Reference

The god-agent exposes **160+ MCP tools** through the MCP server for use by Claude Code.

## Tool Categories

| Category | Count | Description |
|----------|-------|-------------|
| [Memory Tools](memory-tools.md) | 10 | Store, query, edit, delete, trace memories |
| [Compression Tools](compression-tools.md) | 6 | Compressed storage, expanded queries, self-knowledge |
| [Causal Tools](causal-tools.md) | 4 | Causal relations and path finding |
| [Learning Tools](learning-tools.md) | 12 | Sona learning, MemRL, routing |
| [Reflexion Tools](reflexion-tools.md) | 3 | Failure reflection and lesson extraction |
| [Distillation Tools](distillation-tools.md) | 4 | Weekly memory distillation and insight extraction |
| [Autorecall Tools](autorecall-tools.md) | 3 | Automatic memory recall and feedback |
| [Scheduler Tools](scheduler-tools.md) | 7 | Cron and event-based task scheduling |
| [Playwright Tools](playwright-tools.md) | 8 | Browser automation and verification |
| [CODEX Tools](codex-tools.md) | 9 | PhasedExecutor task execution pipeline |
| [Partner Tools](partner-tools.md) | 3 | Collaborative partner knowledge gaps |
| [Containment Tools](containment-tools.md) | 6 | File system path permissions |
| [Guardian Tools](guardian-tools.md) | 2 | Post-execution audit and agent card |
| [Capability Tools](capability-tools.md) | 40+ | LSP, Git, AST, profiler, debug, DB, Wolfram |
| [Review Tools](review-tools.md) | 4 | Code review and OWASP security scanning |
| [Notification Tools](notification-tools.md) | 6 | Slack, Discord notifications |
| [Communication Tools](communication-tools.md) | 14 | Escalation, inter-instance messaging, AFK, triggers |
| [Deep Work Tools](deepwork-tools.md) | 6 | Focus sessions and checkpoints |
| [Config Tools](config-tools.md) | 5 | Configuration management |
| [Failure Tools](failure-tools.md) | 4 | Failure pattern tracking and resolution |
| [Curiosity Tools](curiosity-tools.md) | 5 | Autonomous and web-based exploration |

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
