# RUBIX/God-Agent Documentation

**RUBIX** is an autonomous AI developer agent with persistent memory, continuous learning, and intelligent escalation. It can execute complex multi-step tasks, self-heal from failures, and only escalate to humans when genuinely blocked.

## System Overview

```mermaid
graph TB
    subgraph "Entry Points"
        MCP[MCP Server<br/>160+ tools]
        CLI[CLI<br/>Commands]
        TG[Telegram Bot<br/>Standalone]
        SCHED[Scheduler<br/>Daemon]
    end

    subgraph "Core Facade"
        ME[MemoryEngine<br/>Unified API]
    end

    subgraph "Storage Layer"
        SQL[(SQLiteStorage<br/>Persistent)]
        HNSW[(VectorDB<br/>HNSW 768-dim)]
        EQ[EmbeddingQueue<br/>Deferred Batch]
    end

    subgraph "Intelligence Layer"
        SONA[SonaEngine<br/>Trajectory Learning]
        TD[TinyDancer<br/>Query Routing]
        SS[ShadowSearch<br/>Contradictions]
        GNN[EnhancementLayer<br/>GNN]
    end

    subgraph "RUBIX Execution"
        PE[PhasedExecutor<br/>6-Phase Pipeline]
        PAR[ParallelEngineer<br/>Topo-Sort Batching]
        SH[SelfHealer]
        EG[EscalationGate]
    end

    subgraph "Communication"
        CM[CommsManager<br/>Multi-Channel Escalation]
        TGB[Telegram<br/>Bot + AFK Mode]
    end

    subgraph "Providers"
        CLAUDE[Claude API<br/>Opus/Sonnet]
        OLLAMA[Ollama<br/>Local LLM]
    end

    MCP --> ME
    CLI --> ME
    TG --> PE
    SCHED --> ME

    ME --> SQL
    ME --> HNSW
    ME --> EQ
    ME --> SONA
    ME --> TD
    ME --> SS
    ME --> GNN

    PE --> PAR
    PE --> SH
    PE --> EG
    PE --> CM

    CM --> TGB

    PAR --> CLAUDE
    PAR --> OLLAMA
```

## Key Features

### Autonomous Task Execution
- **Task Decomposition**: Breaks complex tasks into research, design, code, test, integrate, verify, and review subtasks
- **Self-Healing**: Analyzes failures, queries similar past failures, and suggests alternative approaches
- **Intelligent Escalation**: Only escalates to humans when genuinely blocked (respects user attention)
- **Multi-Channel Communication**: Telegram → Phone → SMS → Slack → Discord → Email fallback chain

### Persistent Memory System
- **Semantic Compression**: LLM-based compression for efficient token usage
- **768-dim Vector Search**: HNSW index for fast semantic search
- **L-Score Provenance**: Tracks information reliability through lineage
- **Causal Relations**: Hypergraph relationships with TTL support

### Continuous Learning (Sona)
- **Trajectory-Based Learning**: Records query → patterns → outcomes
- **EWC++ Regularization**: Prevents catastrophic forgetting
- **Auto-Prune/Boost**: Removes failing patterns, strengthens successful ones

### 160+ MCP Tools
Access to memory, causal reasoning, learning, scheduling, browser automation, code review, and more.

## Quick Start

```bash
# Install dependencies
cd rubix-protocol
npm install

# Set up environment
cp .env.example .env
# Edit .env with your API keys

# Build
npm run build

# Run MCP server
node dist/mcp-server.js
```

## Documentation Sections

| Section | Description |
|---------|-------------|
| [Getting Started](getting-started/installation.md) | Installation, configuration, quick start |
| [Architecture](architecture/overview.md) | System design, data flow, component relationships |
| [Core System](core/memory-engine.md) | MemoryEngine, types, configuration |
| [CODEX/RUBIX](codex/task-executor.md) | Task execution, decomposition, self-healing |
| [Memory System](memory/compression-schemas.md) | Compression, embeddings, async writes |
| [Learning System](learning/sona-engine.md) | Sona engine, weights, regularization |
| [Providers](providers/provider-factory.md) | LLM providers, Ollama, factory |
| [MCP Tools](tools/index.md) | Complete 160+ tool reference |
| [Prompts](prompts/all-prompts.md) | LLM prompts used in the system |
| [Flowcharts](flowcharts/system-architecture.md) | Visual architecture diagrams |
| [Reference](reference/environment-variables.md) | Environment variables, file listing |

## Environment Variables

### Required
```bash
OPENAI_API_KEY=sk-...        # For 768-dim embeddings
ANTHROPIC_API_KEY=sk-ant-... # For code generation
```

### Optional
```bash
RUBIX_DATA_DIR=./data         # Database location
RUBIX_MODEL=claude-opus-4-5-20251101  # Model for RUBIX
OLLAMA_ENDPOINT=http://localhost:11434  # Local LLM
TELEGRAM_BOT_TOKEN=...        # For Telegram bot
```

See [Environment Variables Reference](reference/environment-variables.md) for complete list.

## Source Code Structure

```
rubix-protocol/src/
├── core/           # MemoryEngine, types, config, errors
├── codex/          # PhasedExecutor, ParallelEngineer, SelfHealer
├── memory/         # Compression schemas, LLM compressor
├── storage/        # SQLite persistence (15 tables)
├── vector/         # HNSW 768-dim vector database
├── learning/       # Sona trajectory learning, MemRL
├── routing/        # TinyDancer query router
├── provenance/     # L-Score reliability tracking
├── causal/         # Hypergraph causal relations
├── adversarial/    # ShadowSearch contradiction detection
├── gnn/            # GNN embedding enhancement
├── distillation/   # Weekly memory distillation
├── reflexion/      # Learning from failures
├── failure/        # Failure pattern tracking
├── review/         # Code review + OWASP security
├── discovery/      # Agent card, bootstrap
├── curiosity/      # Autonomous exploration
├── providers/      # LLM provider abstraction
├── capabilities/   # 10 IDE capabilities (LSP, Git, AST...)
├── communication/  # Multi-channel escalation + inter-instance comms
├── notification/   # Slack, Discord
├── scheduler/      # Cron-based task scheduling
├── deepwork/       # Focus session management
├── playwright/     # Browser automation
├── telegram/       # Standalone Telegram bot
├── mcp-server.ts   # Main MCP server (160+ tools)
└── index.ts        # Main exports
```

## License

MIT License - See [LICENSE](https://github.com/BobbyRuby/rubix-protocol/blob/main/LICENSE) for details.
