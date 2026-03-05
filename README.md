# RUBIX Protocol

AI development agent that remembers everything, learns from every failure, and gets faster the longer it runs.

Built as an [MCP](https://modelcontextprotocol.io/) server for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). 160 tools. 246 TypeScript files. 35+ subsystems. Production-tested with five concurrent AI instances coordinating across projects against a shared memory brain.

## What It Does

- **Persistent Memory** — Decisions, patterns, and fixes stored with semantic search, provenance tracking (L-Score), and causal relationship graphs. Nothing lost between sessions.
- **Autonomous Execution** — Six-phase pipeline: context scout, architect, engineer, security review, validate, self-correct. Complexity-routed model selection (Haiku/Sonnet/Opus).
- **Self-Healing** — Analyzes failures, queries past failure memory, applies learned fixes, escalates through five tiers (Sonnet → Sonnet+alt → Sonnet+think → Opus → Opus+think) before asking a human.
- **Continuous Learning** — RL-augmented retrieval (MemRL two-phase), trajectory learning (SONA) with Elastic Weight Consolidation to prevent forgetting. Weekly automated knowledge distillation.
- **Multi-Instance Orchestration** — Run multiple AI instances via tmux. SQLite-backed message bus (comms.db) with heartbeats, threading, priority routing, broadcast, and inter-agent permission relay.
- **Multi-Project Isolation** — Each project gets isolated memory, embeddings, task queues, and containment rules. Optional shared Core Brain for cross-project learning.
- **Full-Stack Tooling** — LSP, Git, AST, profiling, debugging, database introspection, browser automation (Playwright), static analysis, documentation mining, Wolfram Alpha.
- **Multi-Channel Comms** — Telegram, phone, SMS, Slack, Discord, email. Six-channel fallback. AFK mode for remote control from your phone.

## Quick Start

```bash
git clone https://github.com/BobbyRuby/rubix-protocol.git
cd rubix-protocol
npm install && npm run build
```

### MCP Configuration

Add to your project's `.claude/mcp.json`:

```json
{
  "mcpServers": {
    "rubix": {
      "command": "node",
      "args": ["dist/mcp-server.js"],
      "cwd": "/path/to/rubix-protocol",
      "env": {
        "OPENAI_API_KEY": "sk-...",
        "ANTHROPIC_API_KEY": "sk-ant-...",
        "RUBIX_DATA_DIR": "./data"
      }
    }
  }
}
```

Restart Claude Code after adding this config.

### Multi-Project Setup

Each project gets its own isolated MCP instance:

```json
{
  "mcpServers": {
    "rubix-backend": {
      "command": "node",
      "args": ["dist/mcp-server.js"],
      "cwd": "/path/to/rubix-protocol",
      "env": {
        "OPENAI_API_KEY": "sk-...",
        "ANTHROPIC_API_KEY": "sk-ant-...",
        "RUBIX_DATA_DIR": "./data/projects/backend",
        "RUBIX_PROJECT_ROOT": "/path/to/backend-api",
        "RUBIX_PROJECT_NAME": "Backend API"
      }
    },
    "rubix-frontend": {
      "command": "node",
      "args": ["dist/mcp-server.js"],
      "cwd": "/path/to/rubix-protocol",
      "env": {
        "OPENAI_API_KEY": "sk-...",
        "ANTHROPIC_API_KEY": "sk-ant-...",
        "RUBIX_DATA_DIR": "./data/projects/frontend",
        "RUBIX_PROJECT_ROOT": "/path/to/web-app",
        "RUBIX_PROJECT_NAME": "Frontend App"
      }
    }
  }
}
```

### Standalone Mode

Run as a standalone service with Telegram bot, HTTP webhooks, and cron scheduling:

```bash
# Set TELEGRAM_BOT_TOKEN in environment
npm run launch           # All services
npm run launch:telegram  # Telegram bot only
npm run launch:daemon    # Daemon + webhooks
```

### Multi-Instance Orchestra

Run multiple Claude Code instances coordinating via shared message bus:

```bash
# Linux/macOS (tmux required)
bash scripts/rubix-orchestra.sh start 3   # Launch 3 instances + monitor
bash scripts/rubix-orchestra.sh status    # Check heartbeats + message queue
bash scripts/rubix-orchestra.sh attach    # Reattach to tmux session
bash scripts/rubix-orchestra.sh stop      # Shutdown
```

Instances communicate via `comms.db` — persistent SQLite message bus with heartbeats, threading, priority routing, and broadcast. Worker permission requests relay to the orchestrator automatically.

## Architecture

```
INTERFACES   MCP Server (160 tools) | CLI | Telegram Bot | HTTP Webhooks
     |
CORE ──► CODEX       6-phase execution, parallel engineering, 5-tier self-healing
     |
     ├──► MEMORY     SQLite + HNSW vector (768d), MemRL retrieval, L-Score provenance,
     |                causal hypergraph, SONA learning, GNN enhancement, shadow search
     |
     ├──► COMMS      comms.db message bus, 6-channel escalation fallback, AFK mode,
     |                inter-instance messaging, permission relay, orchestra coordination
     |
     └──► CAPABILITIES   LSP, Git, AST, profiler, debugger, Playwright, static analysis,
                          dependency graph, doc mining, DB introspection, Wolfram Alpha
```

### CODEX Execution Pipeline

```
Phase 1: CONTEXT SCOUT (Sonnet) — gather codebase context, polyglot knowledge
Phase 2: ARCHITECT (Opus) — design solution, assess complexity
Phase 3: ENGINEER (complexity-routed) — write code, parallel for high-complexity
Phase 4: CODE REVIEW — OWASP security scan, guardian audit
Phase 5: VALIDATOR — test, lint, type-check
Phase 6: FIX LOOP — 5-tier escalation: Sonnet → Sonnet(alt) → Sonnet+think → Opus → Opus+think
```

### Memory & Learning

```
STORE:  content → L-Score provenance → compress → SQLite + embed → HNSW vector index
QUERY:  text → embed → HNSW search → MemRL Phase A (similarity filter) → Phase B (Q-value rank)
LEARN:  SONA trajectory feedback → EWC regularization → auto-prune/boost → weekly distillation
CAUSAL: hypergraph relations (causes|enables|prevents|correlates|precedes|triggers) with TTL
```

## Environment Variables

### Required

| Variable | Purpose |
|----------|---------|
| `OPENAI_API_KEY` | Embeddings (text-embedding-3-small, 768-dim) |
| `ANTHROPIC_API_KEY` | Claude code generation |

### Optional

| Variable | Default | Purpose |
|----------|---------|---------|
| `RUBIX_DATA_DIR` | `./data` | Data directory |
| `RUBIX_PROJECT_ROOT` | — | Project directory (multi-project mode) |
| `RUBIX_PROJECT_NAME` | — | Project display name |
| `RUBIX_CORE_BRAIN_DATA_DIR` | — | Shared knowledge base path |
| `RUBIX_MODEL` | `claude-opus-4-5-20250514` | Claude model for code generation |
| `RUBIX_ULTRATHINK` | `true` | Enable extended thinking |
| `TELEGRAM_BOT_TOKEN` | — | Telegram bot + AFK remote control |

## npm Scripts

| Script | Purpose |
|--------|---------|
| `npm run build` | Compile TypeScript to dist/ |
| `npm run start:mcp` | Run MCP server |
| `npm run launch` | Start all services (Telegram, daemon, webhooks) |
| `npm run launch:telegram` | Telegram bot only |
| `npm run launch:daemon` | Daemon + webhooks |
| `npm run launch:webhooks` | Webhook server only (port 3456) |
| `npm test` | Run tests (vitest) |
| `npm run clean:temp` | Clean tmpclaude-*-cwd temp directories |
| `npm run update` | Git pull + rebuild |

## Documentation

Full docs in [`docs/`](docs/).

| Section | Description |
|---------|-------------|
| [Getting Started](docs/getting-started/index.md) | Install, configure, first task |
| [Architecture](docs/architecture/index.md) | System design, data flow, components |
| [CODEX Engine](docs/codex/index.md) | Six-phase execution pipeline |
| [Memory System](docs/memory/index.md) | Compression, embeddings, async writes |
| [Learning System](docs/learning/index.md) | SONA, MemRL, EWC, distillation |
| [MCP Tools](docs/tools/) | All 160 tools by category |
| [Examples](docs/examples/index.md) | Usage patterns and workflows |
| [Reference](docs/reference/index.md) | Env vars, glossary, file reference |

## Requirements

- **Node.js** >= 20
- **OpenAI API key** — embeddings
- **Anthropic API key** — code generation
- **Optional:** Telegram Bot Token, Ollama, Wolfram Alpha App ID

## License

**AGPL-3.0 with Additional Terms** — see [LICENSE](LICENSE) and [NOTICE](NOTICE).

- Runtime integration with RUBIX memory, tools, or learning systems = covered work under AGPL-3.0
- Commercial use of generated output requires attribution
- **Commercial licenses available** — contact the copyright holder
