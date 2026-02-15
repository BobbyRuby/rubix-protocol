# RUBIX Protocol

Your developers spend 60% of their time on context — reading code they forgot, re-learning decisions that were made last quarter, debugging failures they've already seen. RUBIX eliminates that.

**RUBIX is an AI development agent that remembers everything, learns from every mistake, and gets faster the longer it runs.** It doesn't just generate code. It understands your codebase, executes multi-step engineering tasks autonomously, and only asks for help when it genuinely needs a human decision.

Built as an [MCP](https://modelcontextprotocol.io/) server for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) with 160+ tools. Production-tested across multi-developer, multi-project environments.

## What This Actually Does

- **Persistent Memory** -- Every decision, pattern, and fix is stored with semantic search, provenance tracking, and causal relationships. Nothing gets lost between sessions. Nothing gets re-learned.
- **Autonomous Execution** -- Hands it a task, it scouts context, architects a solution, engineers the code, reviews it for security, validates, and self-corrects. Six phases, no hand-holding.
- **Self-Healing** -- When something breaks, it doesn't just retry. It analyzes the failure, checks if it's seen something similar before, applies what it learned, and tries a different approach. Five escalation tiers before it asks you.
- **Continuous Learning** -- Every query, every task outcome, every failure-fix chain makes the next run smarter. Trajectory learning with drift protection so it doesn't degrade over time.
- **Multi-Project Isolation** -- Run it across your entire portfolio. Each project gets isolated memory, independent task queues, and its own security containment — with an optional shared knowledge base so lessons from one project benefit all of them.
- **Full-Stack Tooling** -- LSP, Git, AST analysis, profiling, debugging, database introspection, browser automation, static analysis. It doesn't shell out to other tools — it has them built in.
- **Multi-Channel Comms** -- Telegram, phone, SMS, Slack, Discord, email. Six-channel fallback chain. Walk away from your desk and manage it from your phone.

## Quick Start

```bash
# Clone and install
git clone https://github.com/BobbyRuby/rubix-protocol.git
cd rubix-protocol
npm install

# Set up environment
cp .env.example .env
# Edit .env with your API keys (OPENAI_API_KEY, ANTHROPIC_API_KEY)

# Build
npm run build

# Run as MCP server
node dist/mcp-server.js
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

### Standalone Mode

RUBIX can also run as a standalone service with Telegram bot, HTTP webhooks, and cron scheduling:

```bash
# Set TELEGRAM_BOT_TOKEN in .env
npm run launch           # All services
npm run launch:telegram  # Telegram bot only
npm run launch:daemon    # Daemon + webhooks
```

## Architecture

242 TypeScript files. 32 subsystems. Four interfaces.

```
INTERFACES: MCP Server | CLI | Telegram Bot | HTTP Webhooks
     │
CORE ──► CODEX    Task execution — architect, engineer, review, validate, fix
     │
     ├──► MEMORY   Vector search, provenance, causal graphs, learning engines
     │
     ├──► COMMS    Six-channel fallback, inter-instance messaging, AFK mode
     │
     └──► CAPABILITIES   LSP, Git, AST, profiler, debugger, browser, DB, docs
```

## Documentation

Full documentation in [`docs/`](docs/), built with [MkDocs Material](https://squidfundamentals.com/mkdocs-material/).

| Section | What's There |
|---------|-------------|
| [Getting Started](docs/getting-started/installation.md) | Install, configure, running in 5 minutes |
| [Architecture](docs/architecture/overview.md) | System design, data flow, every component |
| [MCP Tools](docs/tools/index.md) | All 160+ tools, documented |
| [CODEX Engine](docs/codex/index.md) | The six-phase execution pipeline |
| [Learning System](docs/learning/index.md) | How it gets smarter over time |
| [Reference](docs/reference/environment-variables.md) | Env vars, glossary, file reference |

## Requirements

- **Node.js** >= 18
- **OpenAI API key** — embeddings (text-embedding-3-small, 768-dim)
- **Anthropic API key** — Claude code generation

### Optional

- **Telegram Bot Token** — standalone bot + AFK remote control
- **Ollama** — local LLM fallback (no API costs for routine tasks)
- **Wolfram Alpha App ID** — computational queries

## License

**AGPL-3.0 with Additional Terms** — see [LICENSE](LICENSE) and [NOTICE](NOTICE).

- Runtime integration with RUBIX memory, tools, or learning systems = covered work under AGPL-3.0
- Commercial use of generated output requires attribution
- **Commercial licenses available** — no AGPL obligations, no Additional Terms

For commercial licensing: contact the copyright holder.
