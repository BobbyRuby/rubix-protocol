# Data Flow

Complete documentation of how data flows through the RUBIX system.

## Memory Storage Flow

```mermaid
flowchart TD
    A[god_store called] --> B{LLM Available?}
    B -->|Yes| C[LLMCompressor.compress]
    B -->|No| D[Use original content]
    C --> E[Add 'llm-compressed' tag]
    D --> E
    E --> F[Calculate L-Score from parents]
    F --> G{L-Score >= threshold?}
    G -->|No| H[Throw ProvenanceThresholdError]
    G -->|Yes| I[Create MemoryEntry]
    I --> J[Store to SQLite]
    J --> K[Queue to EmbeddingQueue]
    K --> L{Threshold reached?}
    L -->|Yes| M[Batch embed via OpenAI]
    L -->|No| N[Wait for periodic flush]
    M --> O[Add to HNSW vector index]
    N --> O
    O --> P[Return entry ID]
```

## Query Flow

```mermaid
flowchart TD
    A[god_query called] --> B[TinyDancer.route]
    B --> C{Routing Decision}

    C -->|pattern_match| D[Pattern-based search]
    C -->|causal_forward| E[Forward causal reasoning]
    C -->|causal_backward| F[Backward causal reasoning]
    C -->|direct_retrieval| G[Vector search only]
    C -->|adversarial| H[Shadow search]
    C -->|hybrid| I[Combined approach]

    D --> J[Execute Query]
    E --> J
    F --> J
    G --> J
    H --> J
    I --> J

    J --> K[Generate embedding]
    K --> L[HNSW similarity search]
    L --> M[Load entries from SQLite]
    M --> N{Include provenance?}
    N -->|Yes| O[Calculate L-Scores]
    N -->|No| P[Skip L-Scores]
    O --> Q[Create Trajectory]
    P --> Q
    Q --> R[Return results + trajectoryId]
```

## Learning Flow (Sona)

```mermaid
flowchart TD
    A[Query executed] --> B[Create Trajectory]
    B --> C[Store: query + matches + scores]
    C --> D[Return trajectoryId]

    D --> E[User evaluates results]
    E --> F[god_learn called]
    F --> G[provideFeedback quality:0-1]

    G --> H{Quality > 0.5?}
    H -->|Yes| I[Positive gradient]
    H -->|No| J[Negative gradient]

    I --> K[EWC++ regularized update]
    J --> K

    K --> L[Update pattern weights]
    L --> M{Check drift}
    M -->|Critical| N[Suggest rollback]
    M -->|Normal| O[Continue]

    O --> P{Pattern success rate?}
    P -->|< 40%| Q[Auto-prune]
    P -->|> 80%| R[Auto-boost]
    P -->|Normal| S[Done]
```

## Task Execution Flow

```mermaid
sequenceDiagram
    participant User
    participant MCP as god_codex_do
    participant TE as TaskExecutor
    participant TD as TaskDecomposer
    participant CG as CodeGenerator
    participant SH as SelfHealer
    participant EG as EscalationGate
    participant CM as CommunicationManager

    User->>MCP: Submit task
    MCP->>TE: execute(task)
    TE->>TD: decompose(task)
    TD-->>TE: subtasks[]

    loop For each subtask (max 5 attempts)
        TE->>CG: generate(context)

        alt Success
            CG-->>TE: CodeGenResult
            TE->>TE: verify()
        else Failure
            CG-->>TE: Error
            TE->>SH: analyze(context)
            SH-->>TE: HealingAnalysis

            alt Can Retry
                TE->>CG: generate(alternative)
            else Max Attempts
                TE->>EG: shouldEscalate()
                EG-->>TE: EscalationDecision

                alt Must Escalate
                    TE->>CM: escalate()
                    CM->>User: Telegram/Phone/etc
                    User-->>CM: Response
                    CM-->>TE: Resolution
                end
            end
        end
    end

    TE-->>MCP: TaskResult
    MCP-->>User: Summary
```

## Escalation Flow

```mermaid
flowchart TD
    A[Subtask fails] --> B[EscalationGate.shouldEscalate]

    B --> C{Hard Rules?}
    C -->|Critical spec ambiguity| D[MUST ESCALATE]
    C -->|Max attempts exceeded| D
    C -->|High impact irreversible| D
    C -->|No| E{Can make assumption?}

    E -->|Minor ambiguity| F[Make assumption + continue]
    E -->|No| G{Can self-resolve?}

    G -->|Known error pattern| H[Resolve + continue]
    G -->|Autonomous decision type| H
    G -->|No| I[Default: ESCALATE]

    D --> J[CommunicationManager.escalate]
    I --> J

    J --> K[Telegram: 5 min timeout]
    K -->|Response| L[Return resolution]
    K -->|Timeout| M[Phone: 5 min timeout]
    M -->|Response| L
    M -->|Timeout| N[SMS → Slack → Discord → Email]
    N --> L
```

## Compression Flow

```mermaid
flowchart LR
    subgraph "Storage"
        A[Human Text] -->|Compress| B[Tokens]
        B --> C[(Database)]
    end

    subgraph "Retrieval"
        C --> D[Tokens]
        D -->|Decompress| E[Human Text]
    end
```

### Compression Pipeline

```mermaid
flowchart TD
    A[Input Content] --> B{Detect Type}
    B -->|component| C[COMPONENT Schema]
    B -->|error| D[ERROR_PATTERN Schema]
    B -->|bug_fix| E[BUG_FIX Schema]
    B -->|unknown| F[GENERIC Schema]

    C --> G[Apply positional encoding]
    D --> G
    E --> G
    F --> H[Filler word removal]

    G --> I{LLM Available?}
    H --> I

    I -->|Yes| J[LLMCompressor.compress]
    I -->|No| K[Use schema output]

    J --> L[Compressed tokens]
    K --> L

    L --> M[Store with metadata]
```

## GNN Enhancement Flow

```mermaid
flowchart TD
    A[Entry for enhancement] --> B[Extract ego graph]
    B --> C[2-hop neighborhood]
    C --> D[Load neighbor embeddings]
    D --> E[Message passing]
    E --> F[Aggregate neighbors]
    F --> G[Project 768 → 1024 dim]
    G --> H[Enhanced embedding]
    H --> I[Cache for reuse]
```

## Routing Decision Flow

```mermaid
flowchart TD
    A[Query received] --> B[TinyDancer.route]
    B --> C[Extract keywords]
    C --> D{Circuit breaker check}

    D -->|OPEN| E[Use fallback route]
    D -->|CLOSED| F[Apply routing rules]

    F --> G{Match keywords?}
    G -->|"why, cause, led to"| H[causal_backward]
    G -->|"effect, result, impact"| I[causal_forward]
    G -->|"similar, like, pattern"| J[pattern_match]
    G -->|"contradict, oppose"| K[adversarial]
    G -->|No match| L[direct_retrieval]

    H --> M[Return route + confidence]
    I --> M
    J --> M
    K --> M
    L --> M

    M --> N[Record for circuit breaker]
```

## Notification Flow

```mermaid
flowchart TD
    A[Event occurs] --> B{Deep work mode?}
    B -->|Yes| C{Focus level check}
    B -->|No| D[Send immediately]

    C -->|shallow| D
    C -->|normal| E{Urgent?}
    C -->|deep| F{Critical?}

    E -->|Yes| D
    E -->|No| G[Batch notification]

    F -->|Yes| D
    F -->|No| G

    D --> H{Channel available?}
    H -->|Console| I[Console output]
    H -->|Slack| J[Slack webhook]
    H -->|Discord| K[Discord webhook]
    H -->|All| L[All channels]

    G --> M[Add to batch queue]
    M --> N[Flush on session end]
```

## Data Persistence

### SQLite Tables

```mermaid
erDiagram
    memory_entries ||--o{ memory_tags : has
    memory_entries ||--o| provenance : has
    memory_entries ||--o{ causal_relations : source
    memory_entries ||--o{ causal_relations : target
    trajectories ||--o{ pattern_weights : affects
    scheduled_tasks ||--o{ task_runs : executes

    memory_entries {
        string id PK
        string content
        string source
        float importance
        timestamp created_at
    }

    memory_tags {
        string entry_id FK
        string tag
    }

    provenance {
        string entry_id FK
        string parent_ids
        float l_score
        int lineage_depth
    }

    causal_relations {
        string id PK
        string source_ids
        string target_ids
        string type
        float strength
        timestamp expires_at
    }

    trajectories {
        string id PK
        string query
        string matches
        float quality
        timestamp created_at
    }

    pattern_weights {
        string pattern_id PK
        string name
        float weight
        int use_count
        float success_rate
    }

    scheduled_tasks {
        string id PK
        string name
        string prompt
        string trigger_type
        string status
    }

    task_runs {
        string id PK
        string task_id FK
        string status
        timestamp started_at
        timestamp completed_at
    }
```

## Next Steps

- [Memory System](memory-system.md) - Deep dive into storage
- [Learning System](learning-system.md) - How Sona learns
- [Task Execution](task-execution.md) - RUBIX execution details
