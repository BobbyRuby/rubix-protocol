# RUBIX Protocol

**RUBIX** is an autonomous AI developer agent with persistent memory, continuous learning, and intelligent escalation. It executes complex multi-step coding tasks, self-heals from failures, and only escalates to humans when genuinely blocked.

Built as an [MCP](https://modelcontextprotocol.io/) server for [Claude Code](https://docs.anthropic.com/en/docs/claude-code), RUBIX extends Claude with 160+ tools spanning memory, code execution, browser automation, static analysis, and more.

## Key Features

- **Persistent Memory** -- 768-dim vector search (HNSW), L-Score provenance tracking, causal hypergraph relations, and semantic compression
- **Autonomous Task Execution** -- PhasedExecutor with 6-phase pipeline: context scout, architect, engineer, code review, validate, fix loop
- **Self-Healing** -- Analyzes failures, queries similar past failures, applies reflexion-based learning, and escalates only as a last resort
- **Continuous Learning** -- Sona trajectory learning with EWC++ regularization, MemRL two-phase ranking, and autonomous curiosity-driven discovery
- **Multi-Channel Communication** -- Telegram, phone, SMS, Slack, Discord, email fallback chain with inter-instance messaging
- **IDE Capabilities** -- LSP, Git, AST analysis, profiling, debugging, database introspection, Wolfram Alpha, and Playwright browser automation
- **Multi-Project Support** -- Isolated MCP instances per project with optional shared core brain for cross-project knowledge

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

```
INTERFACES: MCP Server | CLI | Telegram Bot | HTTP Webhooks
     |
CORE ----> CODEX [PhasedExecutor, ParallelEngineer, SelfHealer, EscalationGate]
     |
     +---> MEMORY [MemoryEngine -> Storage, VectorDB, Embeddings, Provenance,
     |             Causal, Patterns, ShadowSearch, Sona, MemRL, GNN, Router]
     |
     +---> COMMS [Telegram -> Phone -> SMS -> Slack -> Discord -> Email]
     |
     +---> CAPABILITIES [LSP, Git, AST, Profiler, Debug, Playwright,
                         StaticAnalysis, DepGraph, DocMining, DB Introspection]
```

## Documentation

Full documentation is available in the [`docs/`](docs/) directory, built with [MkDocs Material](https://squidfundamentals.com/mkdocs-material/).

| Section | Description |
|---------|-------------|
| [Getting Started](docs/getting-started/installation.md) | Installation, configuration, quick start |
| [Architecture](docs/architecture/overview.md) | System design, data flow, components |
| [MCP Tools](docs/tools/index.md) | Complete 160+ tool reference |
| [CODEX/RUBIX](docs/codex/index.md) | Task execution pipeline |
| [Learning System](docs/learning/index.md) | Sona, MemRL, trajectory learning |
| [Reference](docs/reference/environment-variables.md) | Environment variables, glossary |

## Requirements

- **Node.js** >= 18
- **OpenAI API key** -- for text-embedding-3-small (768-dim vectors)
- **Anthropic API key** -- for Claude code generation

### Optional

- **Telegram Bot Token** -- for standalone Telegram bot mode
- **Ollama** -- for local LLM fallback
- **Wolfram Alpha App ID** -- for computational queries

## License

AGPL-3.0 with Additional Terms -- see [LICENSE](LICENSE) and [NOTICE](NOTICE) for details.

Key points:
- **Runtime integration** with God-Agent's memory, MCP tools, or learning systems makes your application a covered work under AGPL-3.0 (full source disclosure required)
- **Generated output** used commercially requires attribution
- **Commercial licenses** are available that exempt you from AGPL-3.0 and the Additional Terms

For commercial licensing inquiries, contact the copyright holder.
