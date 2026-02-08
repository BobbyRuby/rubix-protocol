# Compression Flow

How content is compressed and decompressed.

## Compression Pipeline

```mermaid
flowchart TD
    A[god_store called] --> B{Content type?}

    B -->|Matches schema| C[Schema Compression]
    B -->|Generic| D[LLM Compression]

    C --> E[Apply positional tokens]
    D --> F[Send to Claude/Ollama]

    E --> G[Add schema tag]
    F --> H[Add llm-compressed tag]

    G --> I[Store compressed]
    H --> I

    I --> J[Generate embedding]
    J --> K[Add to vector index]
```

## Decompression Pipeline

```mermaid
flowchart TD
    A[god_query_expanded] --> B[Retrieve entries]
    B --> C{Has compressed tag?}

    C -->|llm-compressed| D[LLM Decompress]
    C -->|schema tag| E[Schema Decompress]
    C -->|No tag| F[Return as-is]

    D --> G[Claude/Ollama expand]
    E --> H[Apply schema template]

    G --> I[Return readable text]
    H --> I
    F --> I
```

## Schema Selection

```mermaid
flowchart TD
    A[Content] --> B{Detect type}

    B -->|Component info| C[COMPONENT schema]
    B -->|Error details| D[ERROR_PATTERN schema]
    B -->|Bug fix record| E[BUG_FIX schema]
    B -->|Architecture| F[ARCH_INSIGHT schema]
    B -->|Unknown| G[GENERIC/LLM]

    C --> H[name|type|actions|deps|path|lines]
    D --> I[id|symptom|root|fix|file]
    E --> J[id|status|symptom|root|fix|file|lesson]
    F --> K[name|type|insight|pattern|rule|comps]
    G --> L[LLM compression]
```

## 18 Compression Schemas

| Schema | Format | Use Case |
|--------|--------|----------|
| COMPONENT | `name\|type\|actions\|deps\|path\|lines` | Source components |
| DEPARTMENT | `name\|role\|actions\|agents\|phase\|path` | RUBIX departments |
| MCP_TOOL | `name\|action\|params\|returns\|uses` | Tool definitions |
| CAPABILITY | `name\|actions\|langs\|apis\|path` | IDE capabilities |
| WORKFLOW | `name\|steps\|actors\|budget` | Process flows |
| CONFIG | `name\|vars\|defaults` | Configuration |
| ERROR_PATTERN | `id\|symptom\|root\|fix\|file` | Error patterns |
| SUCCESS_PATTERN | `name\|factors\|rate\|context` | Success patterns |
| SYSTEM | `name\|modes\|core\|storage\|embed` | System info |
| BUG_FIX | `id\|status\|symptom\|root\|fix\|file\|lesson` | Bug records |
| DEV_FEATURE | `name\|type\|purpose\|path\|exports\|wiring` | Features |
| ARCH_INSIGHT | `name\|type\|insight\|pattern\|rule\|comps` | Architecture |
| CONVERSATION | `task_id\|department\|attempt\|...` | Conversations |
| CONTEXT_BUNDLE | `CTX\|task_id\|desc\|files\|...` | Task context |
| DESIGN | `DES\|comps\|models\|files\|apis\|notes` | Designs |
| EXEC_PLAN | `PLAN\|dept\|ops\|cmd\|conf\|notes` | Execution plans |
| VALIDATION | `VAL\|approve\|tests\|sec\|perf\|...` | Validation |
| GENERIC | Filler word removal | Fallback |

## Compression Example

```mermaid
flowchart LR
    subgraph "Input"
        A["The TaskExecutor is an orchestrator
        component that executes tasks,
        decomposes them, and heals from
        failures. Dependencies: CodeGenerator,
        SelfHealer. Location:
        codex/TaskExecutor.ts (~1800 lines)"]
    end

    subgraph "Output"
        B["TaskExecutor|O|exe.dec.heal|CG.SH|
        codex/TaskExecutor.ts|1800"]
    end

    A -->|Compress| B
```

## Provider Fallback

```mermaid
flowchart TD
    A[Compression Request] --> B[Try Claude Opus]
    B --> C{Success?}
    C -->|Yes| D[Return compressed]
    C -->|Rate limited| E[Try Ollama]
    C -->|Error| E
    E --> F{Ollama available?}
    F -->|Yes| G[Ollama compress]
    F -->|No| H[Return original]
    G --> D
```

## Metrics

| Content Type | Typical Reduction |
|--------------|-------------------|
| Component docs | 70% |
| Error patterns | 69% |
| Architecture | 65% |
| Generic text | 30% |

## Related

- [Memory Flow](memory-flow.md)
- [Compression Schemas](../memory/compression-schemas.md)
- [Compression Prompt](../prompts/compression-prompt.md)
