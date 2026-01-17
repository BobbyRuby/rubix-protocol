# Configuration

**File:** `src/core/config.ts` (~350 lines)

Complete configuration reference for the RUBIX/god-agent system.

## Configuration Sources

Configuration is loaded from multiple sources in order of priority:

1. **Environment variables** (highest priority)
2. **codex.yaml file** (project-level)
3. **Default values** (lowest priority)

## Loading Configuration

```typescript
import { loadConfig } from '@rubix/god-agent';

// Load with defaults
const config = await loadConfig();

// Load from specific path
const config = await loadConfig({ path: './custom-codex.yaml' });
```

## Environment Variables

### Required

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | OpenAI API key for embeddings |
| `ANTHROPIC_API_KEY` | Anthropic API key for code generation |

### Memory System

| Variable | Default | Description |
|----------|---------|-------------|
| `GOD_AGENT_DATA_DIR` | `./data` | Database directory |
| `GOD_AGENT_HNSW_MAX_ELEMENTS` | `100000` | Max vectors in HNSW |
| `GOD_AGENT_HNSW_EF_CONSTRUCTION` | `200` | Construction quality |
| `GOD_AGENT_HNSW_EF_SEARCH` | `100` | Search quality |
| `GOD_AGENT_HNSW_M` | `16` | Connections per node |
| `GOD_AGENT_EMBEDDING_MODEL` | `text-embedding-3-small` | OpenAI model |
| `GOD_AGENT_EMBEDDING_DIMENSIONS` | `768` | Vector dimensions |

### L-Score (Provenance)

| Variable | Default | Description |
|----------|---------|-------------|
| `GOD_AGENT_LSCORE_DECAY` | `0.9` | Parent decay factor |
| `GOD_AGENT_LSCORE_MIN` | `0.01` | Minimum L-Score |
| `GOD_AGENT_LSCORE_THRESHOLD` | `0.3` | Enforcement threshold |
| `GOD_AGENT_ENFORCE_LSCORE_THRESHOLD` | `true` | Whether to enforce |

### RUBIX Execution

| Variable | Default | Description |
|----------|---------|-------------|
| `RUBIX_MODEL` | `claude-opus-4-5-20251101` | Claude model |
| `RUBIX_MAX_TOKENS` | `8192` | Max tokens per generation |
| `RUBIX_ULTRATHINK` | `true` | Enable extended thinking |
| `RUBIX_THINK_BASE` | `5000` | Initial thinking budget |
| `RUBIX_THINK_INCREMENT` | `5000` | Budget increment |
| `RUBIX_THINK_MAX` | `16000` | Maximum budget |
| `RUBIX_THINK_START_ATTEMPT` | `2` | Attempt to start thinking |
| `RUBIX_EXECUTION_MODE` | `cli-first` | Execution mode |
| `RUBIX_CLI_MODEL` | `opus` | CLI model |
| `RUBIX_CLI_TIMEOUT` | `300000` | CLI timeout (ms) |
| `RUBIX_MAX_PARALLEL` | `5` | Parallel subtasks |
| `RUBIX_FAIL_FAST` | `true` | Stop on first failure |

### Providers

| Variable | Default | Description |
|----------|---------|-------------|
| `OLLAMA_ENDPOINT` | `http://localhost:11434` | Ollama endpoint |
| `OLLAMA_MODEL` | `qwen2.5-coder:32b` | Ollama model |
| `RATE_LIMIT_WAIT_MS` | `60000` | Rate limit wait (ms) |

### Optional Integrations

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `SLACK_WEBHOOK_URL` | Slack webhook |
| `DISCORD_WEBHOOK_URL` | Discord webhook |
| `CALLME_API_KEY` | CallMe.bot API key |
| `TWILIO_ACCOUNT_SID` | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | Twilio auth token |
| `TWILIO_PHONE_NUMBER` | Twilio phone number |

## codex.yaml File

The `codex.yaml` file provides project-level configuration:

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

## Configuration Sections

### Escalation

Controls when RUBIX escalates to the user:

```typescript
interface EscalationConfig {
  maxAttemptsBeforeEscalate: number;  // Default: 3
  autonomousDecisions: string[];      // Can decide without asking
  requireApproval: string[];          // Must ask for approval
}
```

**Autonomous Decisions** (default):
- `dependency_minor_versions` - Minor version bumps
- `code_formatting` - Formatting changes
- `variable_naming` - Variable naming choices
- `test_structure` - Test organization

**Require Approval** (default):
- `database_schema_changes` - Schema modifications
- `api_breaking_changes` - Breaking API changes
- `new_dependencies` - Adding dependencies
- `architecture_changes` - Architectural decisions

### Work Mode

Controls notification behavior:

```typescript
interface WorkModeConfig {
  deepWorkDefault: boolean;     // Default: true
  notifyOnComplete: boolean;    // Default: true
  notifyOnBlocked: boolean;     // Default: true
  notifyOnProgress: boolean;    // Default: false
  batchDecisions: boolean;      // Default: false
}
```

### Playwright

Browser automation settings:

```typescript
interface PlaywrightConfig {
  defaultMode: 'headless' | 'visible';  // Default: headless
  timeout: number;                      // Default: 30000
  screenshotOnFailure: boolean;         // Default: true
  captureConsole: boolean;              // Default: true
}
```

### Review

Code review settings:

```typescript
interface ReviewConfig {
  autoReview: boolean;          // Default: true
  securityScan: boolean;        // Default: true
  autoApproveIf: string[];      // Conditions for auto-approval
  requireHumanReview: string[]; // Force human review
}
```

### Notifications

Notification channel settings:

```typescript
interface NotificationsConfig {
  console: boolean;             // Default: true
  slack?: SlackConfig;
  discord?: DiscordConfig;
}

interface SlackConfig {
  webhookUrl: string;
  channel?: string;
  username?: string;
  iconEmoji?: string;
}

interface DiscordConfig {
  webhookUrl: string;
  username?: string;
  avatarUrl?: string;
}
```

### Memory

Memory system settings:

```typescript
interface MemoryConfig {
  storeSuccesses: boolean;      // Default: true
  storeFailures: boolean;       // Default: true
  pruneAfterDays: number;       // Default: 90
}
```

## MCP Configuration Tools

### god_config_get

Get current configuration:

```typescript
// Get all
const config = await mcp__rubix__god_config_get();

// Get section
const escalation = await mcp__rubix__god_config_get({
  section: "escalation"
});
```

### god_config_set

Update configuration:

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

### god_config_load

Load from file:

```typescript
await mcp__rubix__god_config_load();
// Or with custom path
await mcp__rubix__god_config_load({ path: "./custom.yaml" });
```

### god_config_save

Save to file:

```typescript
await mcp__rubix__god_config_save();
// Or with custom path
await mcp__rubix__god_config_save({ path: "./backup.yaml" });
```

### god_config_reset

Reset to defaults:

```typescript
await mcp__rubix__god_config_reset();
```

## Configuration Schema

Full TypeScript configuration schema:

```typescript
interface Config {
  // Memory system
  dataDir: string;
  hnsw: {
    maxElements: number;
    efConstruction: number;
    efSearch: number;
    M: number;
    dimensions: number;
  };
  lscore: {
    decay: number;
    threshold: number;
    enforce: boolean;
    min: number;
  };
  embedding: {
    model: string;
    dimensions: number;
  };

  // RUBIX execution
  rubix: {
    model: string;
    maxTokens: number;
    ultrathink: boolean;
    thinkBase: number;
    thinkIncrement: number;
    thinkMax: number;
    thinkStartAttempt: number;
    executionMode: 'cli-first' | 'api-only';
    cliModel: 'opus' | 'sonnet' | 'haiku';
    cliTimeout: number;
    maxParallel: number;
    failFast: boolean;
  };

  // Providers
  providers: {
    ollama: {
      endpoint: string;
      model: string;
    };
    rateLimitWaitMs: number;
  };

  // From codex.yaml
  escalation: EscalationConfig;
  workMode: WorkModeConfig;
  playwright: PlaywrightConfig;
  review: ReviewConfig;
  notifications: NotificationsConfig;
  memory: MemoryConfig;
}
```

## Best Practices

### 1. Use Environment Variables for Secrets

```bash
# .env file (never commit)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
```

### 2. Use codex.yaml for Project Settings

```yaml
# codex.yaml (commit to repo)
escalation:
  maxAttemptsBeforeEscalate: 5
```

### 3. Override in Development

```bash
# Development overrides
RUBIX_ULTRATHINK=false npm run dev
```

### 4. Validate Configuration

```typescript
const config = await loadConfig();
if (!config.openaiApiKey) {
  throw new Error("OPENAI_API_KEY required");
}
```

## Next Steps

- [Types](types.md) - Type definitions
- [Errors](errors.md) - Error types
- [Environment Variables](../reference/environment-variables.md) - Complete reference
