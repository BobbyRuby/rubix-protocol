# Memory Flow

How data flows through the memory system.

## Storage Flow

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
    B --> C{Route type?}

    C -->|direct_retrieval| D[Vector search only]
    C -->|pattern_match| E[Pattern + vector search]
    C -->|causal_forward| F[Causal graph traversal]
    C -->|hybrid| G[Combined approach]

    D --> H[HNSW k-NN search]
    E --> H
    F --> I[Graph BFS/DFS]
    G --> H
    G --> I

    H --> J[Rank by similarity]
    I --> J
    J --> K{Expand results?}
    K -->|Yes| L[LLMCompressor.decompress]
    K -->|No| M[Return raw tokens]
    L --> N[Return readable text]
    M --> N
```

## Embedding Pipeline

```mermaid
flowchart LR
    subgraph "Async Queue"
        A[New Entry] --> B[EmbeddingQueue]
        B --> C{Batch full?}
        C -->|No| D[Wait]
        C -->|Yes| E[Flush batch]
    end

    subgraph "Embedding"
        E --> F[OpenAI API]
        F --> G[768-dim vectors]
    end

    subgraph "Storage"
        G --> H[HNSW Index]
        H --> I[Vector mappings]
    end
```

## L-Score Calculation

```mermaid
flowchart TD
    A[New Entry] --> B{Has parents?}
    B -->|No| C[L-Score = source_weight]
    B -->|Yes| D[Get parent L-Scores]
    D --> E[Average parent scores]
    E --> F[Apply decay: score * 0.9]
    F --> G[Clamp to minimum 0.01]
    C --> H{>= threshold 0.3?}
    G --> H
    H -->|Yes| I[Store entry]
    H -->|No| J[Reject entry]
```

## Source Weights

| Source | Base L-Score |
|--------|--------------|
| `user_input` | 1.0 |
| `tool_output` | 0.9 |
| `system` | 0.85 |
| `external` | 0.7 |
| `agent_inference` | 0.6 |

## Related

- [System Architecture](system-architecture.md)
- [Memory Tools](../tools/memory-tools.md)
- [Compression Flow](compression-flow.md)
