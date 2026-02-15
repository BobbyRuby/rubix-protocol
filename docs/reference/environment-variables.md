# Environment Variables

Complete reference for all RUBIX environment variables.

## Required Variables

### API Keys

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes | OpenAI API key for embeddings |
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key for RUBIX code generation |

```bash
OPENAI_API_KEY=sk-proj-...
ANTHROPIC_API_KEY=sk-ant-api03-...
```

---

## Memory System

### Data Storage

| Variable | Default | Description |
|----------|---------|-------------|
| `RUBIX_DATA_DIR` | `./data` | Directory for database files |

### Multi-Project

| Variable | Default | Description |
|----------|---------|-------------|
| `RUBIX_PROJECT_ROOT` | *(none)* | Absolute path to the project directory this instance manages |
| `RUBIX_PROJECT_NAME` | *(directory name)* | Human-readable project name (used in logs and context) |
| `RUBIX_CORE_BRAIN_DATA_DIR` | *(none)* | Path to shared knowledge base for cross-project learning |
| `RUBIX_MODE` | `auto` | Execution mode override (`auto`, `mcp-only`, `daemon`) |

```bash
# Multi-project instance configuration
RUBIX_DATA_DIR=./data/projects/backend-api
RUBIX_PROJECT_ROOT=/home/user/projects/backend-api
RUBIX_PROJECT_NAME="Backend API"
RUBIX_CORE_BRAIN_DATA_DIR=./data/core-brain
RUBIX_MODE=auto
```

### HNSW Vector Database

| Variable | Default | Description |
|----------|---------|-------------|
| `RUBIX_HNSW_MAX_ELEMENTS` | `100000` | Maximum vectors to store |
| `RUBIX_HNSW_EF_CONSTRUCTION` | `200` | Construction quality (higher = better) |
| `RUBIX_HNSW_EF_SEARCH` | `100` | Search quality (higher = better) |
| `RUBIX_HNSW_M` | `16` | Connections per node |

```bash
# Production settings (higher quality)
RUBIX_HNSW_MAX_ELEMENTS=500000
RUBIX_HNSW_EF_CONSTRUCTION=400
RUBIX_HNSW_EF_SEARCH=200
RUBIX_HNSW_M=32
```

### Embeddings

| Variable | Default | Description |
|----------|---------|-------------|
| `RUBIX_EMBEDDING_MODEL` | `text-embedding-3-small` | OpenAI model |
| `RUBIX_EMBEDDING_DIMENSIONS` | `768` | Vector dimensions |

---

## L-Score (Provenance)

| Variable | Default | Description |
|----------|---------|-------------|
| `RUBIX_LSCORE_DECAY` | `0.9` | Parent score decay factor |
| `RUBIX_LSCORE_MIN` | `0.01` | Minimum L-Score |
| `RUBIX_LSCORE_THRESHOLD` | `0.3` | Threshold for enforcement |
| `RUBIX_ENFORCE_LSCORE_THRESHOLD` | `true` | Enforce threshold |

```bash
# Strict provenance (production)
RUBIX_LSCORE_DECAY=0.85
RUBIX_LSCORE_THRESHOLD=0.4
RUBIX_ENFORCE_LSCORE_THRESHOLD=true

# Relaxed (development)
RUBIX_ENFORCE_LSCORE_THRESHOLD=false
```

---

## RUBIX (CODEX)

### Model Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `RUBIX_MODEL` | `claude-opus-4-5-20250514` | Claude model for code generation |
| `RUBIX_MAX_TOKENS` | `8192` | Maximum tokens per request |

### Extended Thinking

| Variable | Default | Description |
|----------|---------|-------------|
| `RUBIX_ULTRATHINK` | `true` | Enable extended thinking |
| `RUBIX_THINK_BASE` | `5000` | Initial thinking budget |
| `RUBIX_THINK_INCREMENT` | `5000` | Budget increase per retry |
| `RUBIX_THINK_MAX` | `16000` | Maximum thinking budget |
| `RUBIX_THINK_START_ATTEMPT` | `2` | First attempt to use thinking |

```bash
# Conservative thinking (faster)
RUBIX_ULTRATHINK=false

# Aggressive thinking (higher quality)
RUBIX_ULTRATHINK=true
RUBIX_THINK_BASE=8000
RUBIX_THINK_MAX=24000
```

### Execution Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `RUBIX_EXECUTION_MODE` | `cli-first` | Execution mode |
| `RUBIX_CLI_MODEL` | `opus` | CLI model (opus/sonnet/haiku) |
| `RUBIX_CLI_TIMEOUT` | `300000` | CLI timeout (5 min) |
| `RUBIX_MAX_PARALLEL` | `5` | Max parallel subtasks |
| `RUBIX_FAIL_FAST` | `true` | Stop on first failure |

---

## Providers

### Ollama (Local LLM)

| Variable | Default | Description |
|----------|---------|-------------|
| `OLLAMA_ENDPOINT` | `http://localhost:11434` | Ollama server URL |
| `OLLAMA_MODEL` | `qwen2.5-coder:32b` | Model for local inference |

### Rate Limiting

| Variable | Default | Description |
|----------|---------|-------------|
| `RATE_LIMIT_WAIT_MS` | `60000` | Wait time on rate limit (1 min) |

---

## Communication

### Telegram

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | No | Telegram bot token |
| `TELEGRAM_CHAT_ID` | No | Default chat ID |

### Slack

| Variable | Required | Description |
|----------|----------|-------------|
| `SLACK_WEBHOOK_URL` | No | Slack incoming webhook |

### Discord

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_WEBHOOK_URL` | No | Discord webhook URL |

---

## Capabilities

### Wolfram Alpha

| Variable | Required | Description |
|----------|----------|-------------|
| `WOLFRAM_APP_ID` | No | Wolfram Alpha App ID |

### Database

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | No | Default database connection |

---

## Server

### HTTP/Webhook Server

| Variable | Default | Description |
|----------|---------|-------------|
| `WEBHOOK_PORT` | `3456` | Webhook server port |
| `WEBHOOK_HOST` | `0.0.0.0` | Webhook server host |

---

## Complete Example

```bash
# .env file

# Required API Keys
OPENAI_API_KEY=sk-proj-abc123...
ANTHROPIC_API_KEY=sk-ant-api03-xyz789...

# Data Storage
RUBIX_DATA_DIR=./data

# Multi-Project (per-instance, optional)
# RUBIX_PROJECT_ROOT=/home/user/projects/backend-api
# RUBIX_PROJECT_NAME="Backend API"
# RUBIX_CORE_BRAIN_DATA_DIR=./data/core-brain
# RUBIX_MODE=auto

# HNSW Vector Settings (production)
RUBIX_HNSW_MAX_ELEMENTS=500000
RUBIX_HNSW_EF_CONSTRUCTION=300
RUBIX_HNSW_EF_SEARCH=150
RUBIX_HNSW_M=24

# Embeddings
RUBIX_EMBEDDING_MODEL=text-embedding-3-small
RUBIX_EMBEDDING_DIMENSIONS=768

# L-Score
RUBIX_LSCORE_DECAY=0.9
RUBIX_LSCORE_THRESHOLD=0.3
RUBIX_ENFORCE_LSCORE_THRESHOLD=true

# RUBIX Settings
RUBIX_MODEL=claude-opus-4-5-20250514
RUBIX_MAX_TOKENS=8192
RUBIX_ULTRATHINK=true
RUBIX_THINK_BASE=5000
RUBIX_THINK_MAX=16000
RUBIX_CLI_MODEL=opus
RUBIX_CLI_TIMEOUT=300000
RUBIX_MAX_PARALLEL=5

# Local LLM (Ollama)
OLLAMA_ENDPOINT=http://localhost:11434
OLLAMA_MODEL=qwen2.5-coder:32b

# Communication (optional)
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/T00/B00/XXX
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/123/abc

# Capabilities (optional)
WOLFRAM_APP_ID=ABC123-XYZ789

# Server
WEBHOOK_PORT=3456
```

---

## Priority Order

Environment variables are loaded with this priority:

1. **Process environment** - Runtime variables
2. **`.env` file** - Local configuration
3. **Defaults** - Built-in values

```typescript
// Example: RUBIX_DATA_DIR
// 1. Check process.env.RUBIX_DATA_DIR
// 2. Check .env file
// 3. Use default: "./data"
```

---

## Configuration Override

Some settings can be overridden via `codex.yaml`:

```yaml
# codex.yaml
escalation:
  maxAttemptsBeforeEscalate: 5  # Overrides behavior

playwright:
  timeout: 60000  # Overrides RUBIX_CLI_TIMEOUT for Playwright
```

Environment variables take precedence over codex.yaml:

```
Environment > codex.yaml > defaults
```

---

## Validation

Run this to validate your configuration:

```bash
# Check required variables
node -e "
  const required = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length) {
    console.error('Missing:', missing);
    process.exit(1);
  }
  console.log('Configuration valid');
"
```

## Next Steps

- [Configuration](../getting-started/configuration.md) - Setup guide
- [File Reference](file-reference.md) - Complete file listing
- [Glossary](glossary.md) - Terms and definitions
