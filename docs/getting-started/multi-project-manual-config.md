# Multi-Project Manual Configuration

## Overview

This guide provides detailed instructions for manually configuring multi-project support without using the interactive helper. Use this when you need fine-grained control or are automating configuration.

---

## Configuration File Structure

### Location

```
D:\rubix-protocol\.claude\mcp.json
```

!!! info "Project-Level Only"
    God-Agent uses **project-level** MCP configuration (`.claude/mcp.json` in god-agent root), never global configuration (`~/.claude/mcp.json`).

### Basic Structure

```json
{
  "mcpServers": {
    "instance-name": {
      "command": "node",
      "args": ["dist/mcp-server.js"],
      "cwd": "/absolute/path/to/god-agent",
      "env": {
        "OPENAI_API_KEY": "sk-...",
        "ANTHROPIC_API_KEY": "sk-ant-...",
        "RUBIX_DATA_DIR": "./data/projects/instance-id",
        "RUBIX_PROJECT_ROOT": "/absolute/path/to/project",
        "RUBIX_PROJECT_NAME": "Human Readable Name"
      }
    }
  }
}
```

---

## Step-by-Step Manual Configuration

### Step 1: Create Configuration Directory

```bash
# Navigate to rubix-protocol
cd D:\rubix-protocol

# Create .claude directory
mkdir -p .claude

# Or on Windows
md .claude
```

### Step 2: Create mcp.json

Create `.claude/mcp.json` with your preferred editor:

```bash
# Unix/Linux/macOS
nano .claude/mcp.json

# Windows
notepad .claude\mcp.json
```

### Step 3: Add Instance Configuration

For each project, add an instance entry:

```json
{
  "mcpServers": {
    "rubix-{PROJECT_ID}": {
      "command": "node",
      "args": ["dist/mcp-server.js"],
      "cwd": "{RUBIX_ROOT}",
      "env": {
        "OPENAI_API_KEY": "{YOUR_OPENAI_KEY}",
        "ANTHROPIC_API_KEY": "{YOUR_ANTHROPIC_KEY}",
        "RUBIX_DATA_DIR": "./data/projects/{PROJECT_ID}",
        "RUBIX_PROJECT_ROOT": "{PROJECT_PATH}",
        "RUBIX_PROJECT_NAME": "{PROJECT_NAME}"
      }
    }
  }
}
```

**Replace placeholders:**

- `{PROJECT_ID}`: Unique identifier (e.g., `backend-api`, `frontend`)
- `{RUBIX_ROOT}`: Absolute path to god-agent directory
- `{YOUR_OPENAI_KEY}`: Your OpenAI API key
- `{YOUR_ANTHROPIC_KEY}`: Your Anthropic API key
- `{PROJECT_PATH}`: Absolute path to your project
- `{PROJECT_NAME}`: Human-readable name (e.g., `Backend API`)

---

## Configuration Parameters

### Required Parameters

#### `command` (string)

Node.js executable to run the MCP server.

```json
"command": "node"
```

**Options:**
- `"node"` - Use system Node.js
- `"/path/to/node"` - Use specific Node.js version
- `"node18"` - Use specific Node version (if aliased)

#### `args` (array)

Arguments passed to the command.

```json
"args": ["dist/mcp-server.js"]
```

**Must always be:** `["dist/mcp-server.js"]`

#### `cwd` (string)

Working directory for the MCP server process (god-agent root).

```json
"cwd": "D:\\rubix-protocol"
```

!!! warning "Use Absolute Paths"
    Always use **absolute paths** for `cwd`. Relative paths may not resolve correctly.

**Windows Example:**
```json
"cwd": "D:\\rubix-protocol"
```

**Unix/Linux/macOS Example:**
```json
"cwd": "/home/user/rubix-protocol"
```

---

### Environment Variables

#### Required

##### `OPENAI_API_KEY` (string)

OpenAI API key for embeddings (text-embedding-3-small, 768 dimensions).

```json
"OPENAI_API_KEY": "sk-proj-abc123..."
```

Get your key from: https://platform.openai.com/api-keys

##### `ANTHROPIC_API_KEY` (string)

Anthropic API key for Claude (code generation, reasoning).

```json
"ANTHROPIC_API_KEY": "sk-ant-api03-xyz789..."
```

Get your key from: https://console.anthropic.com/

##### `RUBIX_DATA_DIR` (string)

Directory for this instance's data (SQLite DB, embeddings, rules).

```json
"RUBIX_DATA_DIR": "./data/projects/backend-api"
```

!!! tip "Use Relative Paths"
    Use **relative paths** for `RUBIX_DATA_DIR` (relative to god-agent root) for portability.

**Best Practice:**
```json
"RUBIX_DATA_DIR": "./data/projects/{instance-id}"
```

##### `RUBIX_PROJECT_ROOT` (string)

Absolute path to the project directory this instance manages.

```json
"RUBIX_PROJECT_ROOT": "D:\\projects\\backend-api"
```

!!! warning "Must Be Absolute"
    Always use **absolute paths** for `RUBIX_PROJECT_ROOT`.

**Windows:**
```json
"RUBIX_PROJECT_ROOT": "D:\\projects\\backend-api"
```

**Unix/Linux/macOS:**
```json
"RUBIX_PROJECT_ROOT": "/home/user/projects/backend-api"
```

##### `RUBIX_PROJECT_NAME` (string)

Human-readable name for the project.

```json
"RUBIX_PROJECT_NAME": "Backend API"
```

Used in logs and context display. Defaults to directory name if not provided.

---

#### Optional

##### `RUBIX_MODE` (string)

Execution mode for the instance.

```json
"RUBIX_MODE": "auto"
```

**Options:**
- `"auto"` (default) - Auto-detect daemon availability
- `"mcp-only"` - Force MCP-only mode
- `"daemon"` - Force daemon mode (fail if not running)

##### `RUBIX_MODEL` (string)

Default Claude model for this instance.

```json
"RUBIX_MODEL": "claude-opus-4-5-20250514"
```

**Available Models:**
- `"claude-opus-4-5-20250514"` - Most capable (default)
- `"claude-sonnet-4-5-20250514"` - Balanced
- `"claude-haiku-3-5-20250514"` - Fastest

##### `RUBIX_MAX_PARALLEL` (number)

Maximum parallel operations for this instance.

```json
"RUBIX_MAX_PARALLEL": 5
```

Default: `5`

##### `RUBIX_ULTRATHINK` (boolean)

Enable extended thinking mode.

```json
"RUBIX_ULTRATHINK": true
```

Default: `true`

##### `RUBIX_THINK_BASE` (number)

Base thinking budget (tokens).

```json
"RUBIX_THINK_BASE": 5000
```

Default: `5000`

##### `RUBIX_THINK_MAX` (number)

Maximum thinking budget (tokens).

```json
"RUBIX_THINK_MAX": 16000
```

Default: `16000`

---

## Complete Configuration Examples

### Example 1: Single Project

```json
{
  "mcpServers": {
    "rubix-backend": {
      "command": "node",
      "args": ["dist/mcp-server.js"],
      "cwd": "D:\\rubix-protocol",
      "env": {
        "OPENAI_API_KEY": "sk-proj-abc123...",
        "ANTHROPIC_API_KEY": "sk-ant-api03-xyz789...",
        "RUBIX_DATA_DIR": "./data/projects/backend",
        "RUBIX_PROJECT_ROOT": "D:\\projects\\backend-api",
        "RUBIX_PROJECT_NAME": "Backend API"
      }
    }
  }
}
```

### Example 2: Multiple Projects (Full Stack)

```json
{
  "mcpServers": {
    "rubix-backend": {
      "command": "node",
      "args": ["dist/mcp-server.js"],
      "cwd": "D:\\rubix-protocol",
      "env": {
        "OPENAI_API_KEY": "sk-proj-abc123...",
        "ANTHROPIC_API_KEY": "sk-ant-api03-xyz789...",
        "RUBIX_DATA_DIR": "./data/projects/backend",
        "RUBIX_PROJECT_ROOT": "D:\\projects\\backend-api",
        "RUBIX_PROJECT_NAME": "Backend API",
        "RUBIX_MODEL": "claude-opus-4-5-20250514"
      }
    },
    "rubix-frontend": {
      "command": "node",
      "args": ["dist/mcp-server.js"],
      "cwd": "D:\\rubix-protocol",
      "env": {
        "OPENAI_API_KEY": "sk-proj-abc123...",
        "ANTHROPIC_API_KEY": "sk-ant-api03-xyz789...",
        "RUBIX_DATA_DIR": "./data/projects/frontend",
        "RUBIX_PROJECT_ROOT": "D:\\projects\\web-frontend",
        "RUBIX_PROJECT_NAME": "Web Frontend",
        "RUBIX_MODEL": "claude-sonnet-4-5-20250514"
      }
    },
    "rubix-mobile": {
      "command": "node",
      "args": ["dist/mcp-server.js"],
      "cwd": "D:\\rubix-protocol",
      "env": {
        "OPENAI_API_KEY": "sk-proj-abc123...",
        "ANTHROPIC_API_KEY": "sk-ant-api03-xyz789...",
        "RUBIX_DATA_DIR": "./data/projects/mobile",
        "RUBIX_PROJECT_ROOT": "D:\\projects\\mobile-app",
        "RUBIX_PROJECT_NAME": "Mobile App",
        "RUBIX_MODEL": "claude-sonnet-4-5-20250514"
      }
    }
  }
}
```

### Example 3: Monorepo with Workspaces

```json
{
  "mcpServers": {
    "rubix-core-lib": {
      "command": "node",
      "args": ["dist/mcp-server.js"],
      "cwd": "D:\\rubix-protocol",
      "env": {
        "OPENAI_API_KEY": "sk-proj-abc123...",
        "ANTHROPIC_API_KEY": "sk-ant-api03-xyz789...",
        "RUBIX_DATA_DIR": "./data/projects/core-lib",
        "RUBIX_PROJECT_ROOT": "D:\\monorepo\\packages\\core",
        "RUBIX_PROJECT_NAME": "Core Library"
      }
    },
    "rubix-ui-lib": {
      "command": "node",
      "args": ["dist/mcp-server.js"],
      "cwd": "D:\\rubix-protocol",
      "env": {
        "OPENAI_API_KEY": "sk-proj-abc123...",
        "ANTHROPIC_API_KEY": "sk-ant-api03-xyz789...",
        "RUBIX_DATA_DIR": "./data/projects/ui-lib",
        "RUBIX_PROJECT_ROOT": "D:\\monorepo\\packages\\ui",
        "RUBIX_PROJECT_NAME": "UI Components"
      }
    },
    "rubix-web-app": {
      "command": "node",
      "args": ["dist/mcp-server.js"],
      "cwd": "D:\\rubix-protocol",
      "env": {
        "OPENAI_API_KEY": "sk-proj-abc123...",
        "ANTHROPIC_API_KEY": "sk-ant-api03-xyz789...",
        "RUBIX_DATA_DIR": "./data/projects/web-app",
        "RUBIX_PROJECT_ROOT": "D:\\monorepo\\apps\\web",
        "RUBIX_PROJECT_NAME": "Web Application"
      }
    }
  }
}
```

---

## Creating Data Directories

After configuring `.claude/mcp.json`, create data directories for each instance.

### Manual Creation

```bash
# For each project configured, create its data directory

# Unix/Linux/macOS
mkdir -p data/projects/backend
mkdir -p data/projects/frontend
mkdir -p data/projects/mobile

# Windows CMD
md data\projects\backend
md data\projects\frontend
md data\projects\mobile

# Windows PowerShell
mkdir -Force data/projects/backend
mkdir -Force data/projects/frontend
mkdir -Force data/projects/mobile
```

### Using Setup Scripts

```bash
# Unix/Linux/macOS
bash scripts/setup-project-dirs.sh backend frontend mobile

# Windows PowerShell
.\scripts\setup-project-dirs.ps1 backend frontend mobile
```

---

## Validation

### Validate JSON Syntax

```bash
# Using jq (requires installation)
jq . .claude/mcp.json

# Using Python
python -m json.tool .claude/mcp.json

# Using Node.js
node -e "console.log(JSON.stringify(require('./.claude/mcp.json'), null, 2))"
```

### Validate Paths

```bash
# Check rubix-protocol root exists
test -d "D:\rubix-protocol" && echo "exists"

# Check project roots exist
test -d "D:\projects\backend-api" && echo "backend exists"
test -d "D:\projects\web-frontend" && echo "frontend exists"

# Check data directories exist
ls -la data/projects/
```

### Validate Build

```bash
# Ensure mcp-server.js exists
ls -la dist/mcp-server.js

# If missing, build
npm run build
```

---

## Testing Configuration

### Test Single Instance

1. **Start with one instance** to verify basic functionality:

```json
{
  "mcpServers": {
    "rubix-test": {
      "command": "node",
      "args": ["dist/mcp-server.js"],
      "cwd": "D:\\rubix-protocol",
      "env": {
        "OPENAI_API_KEY": "sk-proj-abc123...",
        "ANTHROPIC_API_KEY": "sk-ant-api03-xyz789...",
        "RUBIX_DATA_DIR": "./data/projects/test",
        "RUBIX_PROJECT_ROOT": "D:\\projects\\test-project",
        "RUBIX_PROJECT_NAME": "Test Project"
      }
    }
  }
}
```

2. **Create data directory:**

```bash
mkdir -p data/projects/test
```

3. **Restart Claude Code**

4. **Verify tools available:**

```typescript
// Should have tools like:
// mcp__rubix_test__god_query
// mcp__rubix_test__god_codex_do
```

5. **Test basic operation:**

```typescript
const result = mcp__rubix_test__god_query({
  query: "project context",
  topK: 5
});

console.log(result);
// Should show project information
```

6. **If working, add more instances**

---

## Common Configuration Patterns

### Pattern 1: Environment-Specific Instances

```json
{
  "mcpServers": {
    "rubix-api-dev": {
      "env": {
        "RUBIX_DATA_DIR": "./data/projects/api-dev",
        "RUBIX_PROJECT_ROOT": "D:\\projects\\api",
        "RUBIX_PROJECT_NAME": "API (Development)"
      }
    },
    "rubix-api-staging": {
      "env": {
        "RUBIX_DATA_DIR": "./data/projects/api-staging",
        "RUBIX_PROJECT_ROOT": "D:\\projects\\api",
        "RUBIX_PROJECT_NAME": "API (Staging)"
      }
    },
    "rubix-api-prod": {
      "env": {
        "RUBIX_DATA_DIR": "./data/projects/api-prod",
        "RUBIX_PROJECT_ROOT": "D:\\projects\\api",
        "RUBIX_PROJECT_NAME": "API (Production)"
      }
    }
  }
}
```

### Pattern 2: Microservices Architecture

```json
{
  "mcpServers": {
    "rubix-auth-service": {
      "env": {
        "RUBIX_PROJECT_ROOT": "D:\\services\\authentication"
      }
    },
    "rubix-user-service": {
      "env": {
        "RUBIX_PROJECT_ROOT": "D:\\services\\user-management"
      }
    },
    "rubix-payment-service": {
      "env": {
        "RUBIX_PROJECT_ROOT": "D:\\services\\payment-processing"
      }
    },
    "rubix-notification-service": {
      "env": {
        "RUBIX_PROJECT_ROOT": "D:\\services\\notifications"
      }
    }
  }
}
```

### Pattern 3: Client Projects

```json
{
  "mcpServers": {
    "rubix-client-acme": {
      "env": {
        "RUBIX_DATA_DIR": "./data/clients/acme",
        "RUBIX_PROJECT_ROOT": "D:\\clients\\acme-corp",
        "RUBIX_PROJECT_NAME": "Acme Corp Project"
      }
    },
    "rubix-client-globex": {
      "env": {
        "RUBIX_DATA_DIR": "./data/clients/globex",
        "RUBIX_PROJECT_ROOT": "D:\\clients\\globex-inc",
        "RUBIX_PROJECT_NAME": "Globex Inc Project"
      }
    }
  }
}
```

---

## Troubleshooting

### Invalid JSON

**Error:** Configuration file is not valid JSON

**Solution:**

```bash
# Validate with jq
jq . .claude/mcp.json

# Common issues:
# - Missing commas between entries
# - Trailing commas after last entry
# - Unescaped backslashes in paths (use \\)
# - Missing quotes around strings
```

### Path Not Found

**Error:** "ENOENT: no such file or directory"

**Solution:**

```bash
# Verify paths exist
test -d "D:\rubix-protocol" && echo "rubix-protocol exists"
test -d "D:\projects\backend-api" && echo "project exists"

# Use absolute paths
# Use proper path separators (Windows: \\, Unix: /)
```

### Instance Not Loading

**Error:** Tools not appearing after restart

**Solution:**

1. Check `.claude/mcp.json` location (must be in god-agent root)
2. Validate JSON syntax
3. Ensure `dist/mcp-server.js` exists
4. Fully restart Claude Code (quit and reopen)

---

## Next Steps

- [CLI Usage Guide](./multi-project-cli-usage.md) - Using configured instances
