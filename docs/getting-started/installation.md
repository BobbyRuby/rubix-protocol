# Installation

## System Requirements

| Requirement | Minimum | Recommended |
|-------------|---------|-------------|
| Node.js | 18.x | 20.x LTS |
| npm | 9.x | 10.x |
| Memory | 4GB RAM | 8GB+ RAM |
| Disk | 500MB | 2GB+ |
| OS | Windows/macOS/Linux | Any |

## Quick Install

```bash
# Clone the repository
git clone https://github.com/your-org/rubix-protocol.git
cd rubix-protocol

# Install dependencies
npm install

# Build the project
npm run build

# Initialize the database
node dist/cli/index.js init
```

## API Keys

You'll need two API keys:

### 1. OpenAI API Key (Required)

Used for generating 768-dimensional embeddings for semantic search.

```bash
# Get your key from: https://platform.openai.com/api-keys
export OPENAI_API_KEY="sk-..."
```

### 2. Anthropic API Key (Required)

Used for code generation via Claude Opus.

```bash
# Get your key from: https://console.anthropic.com/
export ANTHROPIC_API_KEY="sk-ant-..."
```

## Installation Methods

### Method 1: MCP Server (Claude Code Integration)

Create `.claude/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "rubix": {
      "command": "node",
      "args": ["dist/mcp-server.js"],
      "cwd": "/path/to/god-agent",
      "env": {
        "OPENAI_API_KEY": "sk-...",
        "ANTHROPIC_API_KEY": "sk-ant-...",
        "RUBIX_DATA_DIR": "./data"
      }
    }
  }
}
```

Restart Claude Code to load the MCP server.

### Method 2: Global CLI Installation

```bash
# Install globally
npm install -g @rubix/god-agent

# Or link for development
cd rubix-protocol
npm link

# Verify installation
god-agent --version
```

### Method 3: Docker (Coming Soon)

```dockerfile
# Dockerfile
FROM node:20-alpine
WORKDIR /app
COPY . .
RUN npm install && npm run build
CMD ["node", "dist/mcp-server.js"]
```

## Verify Installation

### Check MCP Tools

Once Claude Code restarts, verify the tools are available:

```
/mcp
```

You should see 160+ tools prefixed with `mcp__rubix__god_*`.

### Test Memory Storage

```typescript
// Via MCP tool
await mcp__rubix__god_store({
  content: "Test entry",
  tags: ["test"],
  importance: 0.5
});
```

### Test Query

```typescript
const results = await mcp__rubix__god_query({
  query: "test",
  topK: 5
});
```

## Database Location

By default, the SQLite database is created at:

```
./data/memory.db
```

Configure with:

```bash
export RUBIX_DATA_DIR="/custom/path"
```

## Troubleshooting

### "OPENAI_API_KEY not set"

Ensure the environment variable is exported or set in your MCP config:

```json
{
  "env": {
    "OPENAI_API_KEY": "sk-..."
  }
}
```

### "Cannot find module"

Rebuild the project:

```bash
npm run build
```

### "Database locked"

Only one process should access the database at a time. Close other instances or use a different data directory.

### MCP Tools Not Loading

1. Check Claude Code logs for errors
2. Verify the path in `.claude/mcp.json` is correct
3. Ensure `dist/mcp-server.js` exists
4. Restart Claude Code after config changes

## Next Steps

- [Configuration](configuration.md) - Set up all environment variables
- [Quick Start](quick-start.md) - Run your first task
