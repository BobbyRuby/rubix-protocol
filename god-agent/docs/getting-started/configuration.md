# Configuration

Complete reference for all environment variables and configuration options.

## Environment Variables

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `OPENAI_API_KEY` | OpenAI API key for embeddings | `sk-...` |
| `ANTHROPIC_API_KEY` | Anthropic API key for code generation | `sk-ant-...` |

### Memory System

| Variable | Default | Description |
|----------|---------|-------------|
| `GOD_AGENT_DATA_DIR` | `./data` | Database storage location |
| `GOD_AGENT_HNSW_MAX_ELEMENTS` | `100000` | Maximum vectors in HNSW index |
| `GOD_AGENT_HNSW_EF_CONSTRUCTION` | `200` | Construction quality (higher = better) |
| `GOD_AGENT_HNSW_EF_SEARCH` | `100` | Search quality (higher = slower but better) |
| `GOD_AGENT_HNSW_M` | `16` | Connections per node |
| `GOD_AGENT_EMBEDDING_MODEL` | `text-embedding-3-small` | OpenAI embedding model |
| `GOD_AGENT_EMBEDDING_DIMENSIONS` | `768` | Vector dimensions |

### L-Score (Provenance)

| Variable | Default | Description |
|----------|---------|-------------|
| `GOD_AGENT_LSCORE_DECAY` | `0.9` | Parent contribution decay factor |
| `GOD_AGENT_LSCORE_MIN` | `0.01` | Minimum L-Score threshold |
| `GOD_AGENT_LSCORE_THRESHOLD` | `0.3` | Enforcement threshold |
| `GOD_AGENT_ENFORCE_LSCORE_THRESHOLD` | `true` | Whether to enforce threshold |

### RUBIX Code Generation

| Variable | Default | Description |
|----------|---------|-------------|
| `RUBIX_MODEL` | `claude-opus-4-5-20251101` | Claude model for code generation |
| `RUBIX_MAX_TOKENS` | `8192` | Maximum tokens per generation |
| `RUBIX_ULTRATHINK` | `true` | Enable extended thinking |
| `RUBIX_THINK_BASE` | `5000` | Initial thinking budget (tokens) |
| `RUBIX_THINK_INCREMENT` | `5000` | Budget increment per retry |
| `RUBIX_THINK_MAX` | `16000` | Maximum thinking budget |
| `RUBIX_THINK_START_ATTEMPT` | `2` | Attempt number to start thinking |
| `RUBIX_EXECUTION_MODE` | `cli-first` | Execution mode (cli-first, api-only) |
| `RUBIX_CLI_MODEL` | `opus` | CLI model (opus, sonnet, haiku) |
| `RUBIX_CLI_TIMEOUT` | `300000` | CLI timeout in ms (5 min default) |
| `RUBIX_MAX_PARALLEL` | `5` | Maximum parallel subtasks |
| `RUBIX_FAIL_FAST` | `true` | Stop on first failure |

### Provider Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `OLLAMA_ENDPOINT` | `http://localhost:11434` | Local Ollama endpoint |
| `OLLAMA_MODEL` | `qwen2.5-coder:32b` | Ollama model for fallback |
| `RATE_LIMIT_WAIT_MS` | `60000` | Wait time on rate limit (ms) |

### Optional Integrations

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Telegram bot token for escalations |
| `SLACK_WEBHOOK_URL` | Slack webhook for notifications |
| `DISCORD_WEBHOOK_URL` | Discord webhook for notifications |
| `CALLME_API_KEY` | CallMe.bot API for phone escalations |
| `TWILIO_ACCOUNT_SID` | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | Twilio auth token |
| `TWILIO_PHONE_NUMBER` | Twilio sending phone number |

## MCP Configuration

### Project-Level Config (Recommended)

Create `.claude/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "rubix": {
      "command": "node",
      "args": ["dist/mcp-server.js"],
      "cwd": "D:\\rubix-protocol\\god-agent",
      "env": {
        "OPENAI_API_KEY": "sk-...",
        "ANTHROPIC_API_KEY": "sk-ant-...",
        "GOD_AGENT_DATA_DIR": "./data",
        "RUBIX_MODEL": "claude-opus-4-5-20251101",
        "RUBIX_ULTRATHINK": "true"
      }
    }
  }
}
```

### Global Config (Not Recommended)

Located at `~/.claude/mcp.json`. Affects all projects.

**Warning:** Prefer project-level config to avoid conflicts.

## codex.yaml Configuration

RUBIX can be configured via `codex.yaml` in the project root:

```yaml
# codex.yaml
escalation:
  maxAttemptsBeforeEscalate: 3
  autonomousDecisions:
    - dependency_minor_versions
    - code_formatting
    - variable_naming
    - test_structure
  requireApproval:
    - database_schema_changes
    - api_breaking_changes
    - new_dependencies
    - architecture_changes

workMode:
  deepWorkDefault: true
  notifyOnComplete: true
  notifyOnBlocked: true
  notifyOnProgress: false
  batchDecisions: false

playwright:
  defaultMode: headless
  timeout: 30000
  screenshotOnFailure: true
  captureConsole: true

review:
  autoReview: true
  securityScan: true
  autoApproveIf:
    - no_critical_issues
    - tests_pass
  requireHumanReview:
    - security_changes
    - api_changes

notifications:
  console: true
  slack:
    webhookUrl: "https://hooks.slack.com/..."
    channel: "#dev-notifications"
    username: "RUBIX"
    iconEmoji: ":robot_face:"
  discord:
    webhookUrl: "https://discord.com/api/webhooks/..."
    username: "RUBIX"

memory:
  storeSuccesses: true
  storeFailures: true
  pruneAfterDays: 90
```

### Load Configuration

```typescript
// Via MCP tool
await mcp__rubix__god_config_load();

// Or with custom path
await mcp__rubix__god_config_load({ path: "./custom-codex.yaml" });
```

### View Current Configuration

```typescript
// Get all configuration
const config = await mcp__rubix__god_config_get();

// Get specific section
const escalation = await mcp__rubix__god_config_get({ section: "escalation" });
```

### Modify Configuration

```typescript
await mcp__rubix__god_config_set({
  escalation: {
    maxAttemptsBeforeEscalate: 5
  },
  workMode: {
    notifyOnProgress: true
  }
});
```

## Containment Configuration

Control file system access:

```typescript
// Configure containment
await mcp__rubix__god_containment_config({
  enabled: true,
  projectRoot: "D:/my-project",
  defaultPermission: "deny"
});

// Add path rules
await mcp__rubix__god_containment_add_rule({
  pattern: "src/**",
  permission: "read-write",
  reason: "Source code access"
});

await mcp__rubix__god_containment_add_rule({
  pattern: "**/.env*",
  permission: "deny",
  reason: "Secrets protection"
});
```

## Notification Configuration

### Slack Setup

```typescript
await mcp__rubix__god_notify_slack({
  webhookUrl: "https://hooks.slack.com/services/...",
  enabled: true,
  channel: "#dev",
  username: "RUBIX",
  iconEmoji: ":robot_face:"
});
```

### Discord Setup

```typescript
await mcp__rubix__god_notify_discord({
  webhookUrl: "https://discord.com/api/webhooks/...",
  enabled: true,
  username: "RUBIX"
});
```

### Notification Preferences

```typescript
await mcp__rubix__god_notify_preferences({
  onComplete: true,
  onBlocked: true,
  onDecision: true,
  onError: true,
  onProgress: false,
  onReviewReady: true,
  minUrgency: "normal"  // low, normal, high, critical
});
```

## Communication Setup (Escalation)

Configure the multi-channel escalation chain:

```typescript
// View setup wizard
await mcp__rubix__god_comms_setup({ mode: "wizard" });

// Check status
await mcp__rubix__god_comms_setup({ mode: "status" });

// Configure phone
await mcp__rubix__god_comms_setup({
  mode: "set",
  channel: "phone",
  config: {
    phoneNumber: "+15551234567",
    provider: "callme"  // or twilio, telnyx
  }
});

// Set fallback order
await mcp__rubix__god_comms_setup({
  mode: "order",
  fallbackOrder: ["telegram", "phone", "slack", "discord", "email"]
});

// Test all channels
await mcp__rubix__god_comms_setup({ mode: "test" });
```

## Next Steps

- [Quick Start](quick-start.md) - Run your first task
- [Architecture Overview](../architecture/overview.md) - Understand the system
