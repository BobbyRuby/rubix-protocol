# Multi-Project Quick Reference

## Setup Commands

```bash
# Interactive configuration (recommended)
node scripts/configure-projects.js

# Manual data directory setup
mkdir -p data/projects/{project-id}

# Build god-agent
npm run build

# Validate configuration
jq . .claude/mcp.json

# Restart Claude Code (required after config changes)
```

---

## Configuration Template

```json
{
  "mcpServers": {
    "rubix-{PROJECT_ID}": {
      "command": "node",
      "args": ["dist/mcp-server.js"],
      "cwd": "{ABSOLUTE_PATH_TO_GOD_AGENT}",
      "env": {
        "OPENAI_API_KEY": "sk-...",
        "ANTHROPIC_API_KEY": "sk-ant-...",
        "RUBIX_DATA_DIR": "./data/projects/{PROJECT_ID}",
        "RUBIX_PROJECT_ROOT": "{ABSOLUTE_PATH_TO_PROJECT}",
        "RUBIX_PROJECT_NAME": "{PROJECT_NAME}"
      }
    }
  }
}
```

---

## Tool Naming Pattern

```
mcp__rubix_{project-id}__god_{tool-name}
         └─────┬─────┘       └────┬────┘
           Instance ID         Tool Name
```

**Examples:**
- `mcp__rubix_backend_api__god_codex_do`
- `mcp__rubix_frontend__god_query`
- `mcp__rubix_mobile__god_store`

---

## Common Operations

### Query Project Context

```typescript
const context = mcp__rubix_{project_id}__god_query({
  query: "What is this project? Tech stack and structure?",
  topK: 10
});
```

### Execute Task

```typescript
const task = mcp__rubix_{project_id}__god_codex_do({
  task: "Implement feature X with these requirements..."
});
```

### Check Task Status

```typescript
const status = mcp__rubix_{project_id}__god_codex_status({
  taskId: task.taskId
});
```

### Store Context

```typescript
mcp__rubix_{project_id}__god_store({
  content: "Important project information",
  tags: ['project_config', 'always_recall'],
  importance: 1.0
});
```

### View Task Logs

```typescript
const logs = mcp__rubix_{project_id}__god_codex_logs({
  taskId: task.taskId,
  limit: 50
});
```

### Cancel Task

```typescript
mcp__rubix_{project_id}__god_codex_cancel({
  taskId: task.taskId,
  reason: "Requirements changed"
});
```

---

## Parallel Execution

```typescript
// Start all tasks at once
const backendTask = mcp__rubix_backend__god_codex_do({ task: "..." });
const frontendTask = mcp__rubix_frontend__god_codex_do({ task: "..." });
const mobileTask = mcp__rubix_mobile__god_codex_do({ task: "..." });

// All tasks execute in parallel
// Monitor each independently
```

---

## Environment Variables

### Required

| Variable | Example | Purpose |
|----------|---------|---------|
| `OPENAI_API_KEY` | `sk-proj-abc...` | OpenAI embeddings |
| `ANTHROPIC_API_KEY` | `sk-ant-api03-...` | Claude code generation |
| `RUBIX_DATA_DIR` | `./data/projects/backend` | Instance data storage |
| `RUBIX_PROJECT_ROOT` | `D:\projects\backend-api` | Project directory |
| `RUBIX_PROJECT_NAME` | `Backend API` | Human-readable name |

### Optional

| Variable | Default | Purpose |
|----------|---------|---------|
| `RUBIX_MODE` | `auto` | Execution mode |
| `RUBIX_MODEL` | `claude-opus-4-5-20250514` | Default model |
| `RUBIX_MAX_PARALLEL` | `5` | Max parallel ops |
| `RUBIX_ULTRATHINK` | `true` | Extended thinking |

---

## File Locations

```
god-agent/
├── .claude/
│   └── mcp.json                 # MCP configuration
├── data/
│   └── projects/
│       ├── {project-id}/        # Instance data
│       │   ├── god-agent.db     # SQLite database
│       │   └── embeddings/      # HNSW indexes
│       └── ...
├── scripts/
│   ├── configure-projects.js    # Interactive config
│   ├── setup-project-dirs.sh    # Unix setup
│   └── setup-project-dirs.ps1   # Windows setup
└── dist/
    └── mcp-server.js            # MCP server
```

---

## Troubleshooting Quick Fixes

### Instance Not Loading

```bash
# Check .claude/mcp.json exists
ls .claude/mcp.json

# Validate JSON
jq . .claude/mcp.json

# Check dist/mcp-server.js exists
ls dist/mcp-server.js

# Rebuild if needed
npm run build

# Restart Claude Code completely
```

### Path Issues

```bash
# Windows: Use double backslashes
"RUBIX_PROJECT_ROOT": "D:\\projects\\backend-api"

# Unix: Use forward slashes
"RUBIX_PROJECT_ROOT": "/home/user/projects/backend-api"

# Verify path exists
test -d "D:\projects\backend-api" && echo "exists"
```

### Cross-Contamination

```bash
# Verify unique data directories
cat .claude/mcp.json | jq '.mcpServers[].env.RUBIX_DATA_DIR'

# Each should be different:
# "./data/projects/backend"
# "./data/projects/frontend"
# "./data/projects/mobile"
```

### Clear and Reset

```bash
# Clear all project data
rm -rf data/projects/*

# Reconfigure
node scripts/configure-projects.js

# Restart Claude Code
```

---

## Common Workflows

### 1. Full-Stack Feature

```typescript
// 1. Define contract
const contract = "API: POST /api/resource ...";

// 2. Implement backend
mcp__rubix_backend__god_codex_do({ task: contract });

// 3. Implement frontend (parallel)
mcp__rubix_frontend__god_codex_do({ task: contract });

// 4. Implement mobile (parallel)
mcp__rubix_mobile__god_codex_do({ task: contract });

// 5. Store contract in all
mcp__rubix_backend__god_store({ content: contract, ... });
mcp__rubix_frontend__god_store({ content: contract, ... });
mcp__rubix_mobile__god_store({ content: contract, ... });
```

### 2. Bug Fix Across Projects

```typescript
// Define the bug
const bugFix = "BUG: Issue description and fix...";

// Fix in all projects
mcp__rubix_backend__god_codex_do({ task: bugFix });
mcp__rubix_frontend__god_codex_do({ task: bugFix });
mcp__rubix_mobile__god_codex_do({ task: bugFix });
```

### 3. Configuration Sync

```typescript
// Query config from one project
const config = mcp__rubix_backend__god_query({
  query: "environment variables"
});

// Apply to others
mcp__rubix_frontend__god_codex_do({
  task: `Update config: ${config.results[0].content}`
});
```

---

## Best Practices

### ✅ Do

- Use absolute paths for `RUBIX_PROJECT_ROOT`
- Use relative paths for `RUBIX_DATA_DIR`
- Restart Claude Code after config changes
- Execute independent tasks in parallel
- Store shared contracts in all relevant projects
- Use descriptive instance names
- Configure only active projects (2-5)

### ❌ Don't

- Don't use relative paths for project roots
- Don't use absolute paths for data directories
- Don't share data directories between instances
- Don't assume context from one project exists in another
- Don't configure more than 10 instances
- Don't use vague instance names

---

## Resource Usage

| Instances | Idle | Active | Recommendation |
|-----------|------|--------|----------------|
| 1 | ~50MB | ~100-200MB | Single project |
| 2-5 | ~100MB | ~500MB-1GB | Optimal range |
| 6-10 | ~200MB | ~1-2GB | Only if needed |

---

## Support Links

- [Full Setup Guide](../getting-started/multi-project-setup.md)
- [CLI Usage Guide](../getting-started/multi-project-cli-usage.md)
- [Manual Configuration](../getting-started/multi-project-manual-config.md)
- [Examples](../examples/multi-project-examples.md)
- [CLAUDE.md](../../CLAUDE.md) - Multi-Project Context section

---

## Quick Checklist

### Initial Setup

- [ ] Run `node scripts/configure-projects.js`
- [ ] Review generated `.claude/mcp.json`
- [ ] Verify data directories created
- [ ] Run `npm run build`
- [ ] Restart Claude Code
- [ ] Verify tools available

### Daily Usage

- [ ] Use correct instance prefix for operations
- [ ] Execute independent tasks in parallel
- [ ] Monitor task progress
- [ ] Store important contracts/decisions
- [ ] Query context before making changes

### Troubleshooting

- [ ] Validate JSON syntax
- [ ] Check all paths exist
- [ ] Verify dist/mcp-server.js exists
- [ ] Check unique data directories
- [ ] Restart Claude Code completely

---

## Emergency Reset

If everything is broken, start fresh:

```bash
# 1. Backup current config
cp .claude/mcp.json .claude/mcp.json.backup

# 2. Clear all data
rm -rf data/projects/*

# 3. Reconfigure
node scripts/configure-projects.js

# 4. Rebuild
npm run build

# 5. Restart Claude Code

# 6. Test with single instance first
```

---

## Version Information

- Multi-Project Support: v1.0 (2026-01-25)
- God-Agent: Check `package.json` version
- MCP Protocol: As provided by Claude Code

Last Updated: 2026-01-25
