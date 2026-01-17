# System Architecture

High-level architecture of the RUBIX/god-agent system.

## Complete System Diagram

```mermaid
graph TB
    subgraph "Entry Points"
        MCP[MCP Server<br/>80+ tools]
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
        TE[TaskExecutor<br/>Orchestrator]
        TD2[TaskDecomposer]
        CG[CodeGenerator]
        SH[SelfHealer]
        EG[EscalationGate]
    end

    subgraph "Communication"
        CM[CommunicationManager]
        TGC[Telegram]
        PHN[Phone]
        SLK[Slack]
    end

    subgraph "Providers"
        CLAUDE[Claude API<br/>Opus/Sonnet]
        OLLAMA[Ollama<br/>Local LLM]
    end

    MCP --> ME
    MCP --> TE
    CLI --> ME
    TG --> TE
    SCHED --> ME

    ME --> SQL
    ME --> HNSW
    ME --> EQ
    ME --> SONA
    ME --> TD
    ME --> SS
    ME --> GNN

    TE --> TD2
    TE --> CG
    TE --> SH
    TE --> EG
    EG --> CM

    CM --> TGC
    CM --> PHN
    CM --> SLK

    CG --> CLAUDE
    CG --> OLLAMA
    ME --> CLAUDE
    ME --> OLLAMA
```

## Layer Breakdown

### Entry Points
| Component | Purpose |
|-----------|---------|
| MCP Server | Model Context Protocol interface (80+ tools) |
| CLI | Command-line interface |
| Telegram Bot | Standalone chat interface |
| Scheduler | Background cron/event daemon |

### Storage Layer
| Component | Purpose |
|-----------|---------|
| SQLiteStorage | Persistent memory entries |
| VectorDB (HNSW) | 768-dimensional semantic search |
| EmbeddingQueue | Batched embedding generation |

### Intelligence Layer
| Component | Purpose |
|-----------|---------|
| SonaEngine | Trajectory-based learning |
| TinyDancer | Query routing with circuit breakers |
| ShadowSearch | Contradiction finding |
| EnhancementLayer | GNN-based embedding enrichment |

### RUBIX Execution
| Component | Purpose |
|-----------|---------|
| TaskExecutor | Main orchestrator |
| TaskDecomposer | Task → subtask breakdown |
| CodeGenerator | Claude-powered code generation |
| SelfHealer | Failure analysis and recovery |
| EscalationGate | Human escalation decisions |

## Data Flow Summary

```mermaid
flowchart LR
    User -->|Task| TE[TaskExecutor]
    TE -->|Context| ME[MemoryEngine]
    ME -->|Similar patterns| TE
    TE -->|Code prompt| CG[CodeGenerator]
    CG -->|Generated code| TE
    TE -->|Verify| PW[Playwright]
    PW -->|Result| TE
    TE -->|Learn| ME
```

## Related

- [Task Execution Flow](task-execution-flow.md)
- [Memory Flow](memory-flow.md)
- [Learning Flow](learning-flow.md)
