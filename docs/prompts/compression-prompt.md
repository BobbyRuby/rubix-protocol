# Compression Prompt

Reduces human-readable content to minimal semantic tokens.

## Location

`src/memory/LLMCompressor.ts:203-227`

## Used By

- `god_store` - Memory storage
- `god_store_compressed` - Explicit compression
- Memory compression pipeline

---

## The Prompt

```text
You are a semantic compression engine. Extract the pure meaning from this content using minimal tokens.

Rules:
- Strip ALL filler words (the, a, an, please, basically, actually, etc.)
- Strip ALL NLP pleasantries
- Keep ONLY semantic content that carries meaning
- Use abbreviations for common patterns:
  - comp = component
  - cfg = configuration/config
  - fn = function
  - impl = implementation
  - req = request/requirement
  - res = response
  - err = error
  - msg = message
- Use | as delimiter between distinct fields/concepts
- Use → for flows/sequences/causation
- Use . for lists within a field (A.B.C)
- Preserve technical terms, names, paths, and specific values exactly
- Format: TYPE|KEY_INFO|DETAILS|CONTEXT (adapt as needed)

Content to compress:
{CONTENT}

Output ONLY the compressed tokens. No explanation, no meta-commentary.
```

---

## Abbreviations

| Short | Full |
|-------|------|
| comp | component |
| cfg | configuration/config |
| fn | function |
| impl | implementation |
| req | request/requirement |
| res | response |
| err | error |
| msg | message |
| exec | execute |
| init | initialize |
| param | parameter |
| ctx | context |
| deps | dependencies |

---

## Delimiters

| Symbol | Meaning | Example |
|--------|---------|---------|
| `\|` | Field separator | `name\|type\|actions` |
| `→` | Flow/sequence | `input→process→output` |
| `.` | List items | `exe.dec.heal` |
| `:` | Key-value | `content:string` |
| `,` | Enumeration | `path1,path2,path3` |

---

## Example

### Input
```text
The TaskExecutor is an orchestrator component that executes tasks,
decomposes them into subtasks, and heals from failures.
It depends on CodeGenerator and SelfHealer.
Location: codex/TaskExecutor.ts (~1800 lines)
```

### Output
```text
TaskExecutor|O|exe.dec.heal|CG.SH|codex/TaskExecutor.ts|1800
```

### Breakdown
| Token | Meaning |
|-------|---------|
| `TaskExecutor` | Component name (preserved exactly) |
| `O` | Type: Orchestrator |
| `exe.dec.heal` | Actions: execute, decompose, heal |
| `CG.SH` | Dependencies: CodeGenerator, SelfHealer |
| `codex/TaskExecutor.ts` | File path (preserved exactly) |
| `1800` | Line count |

---

## Compression Metrics

| Content Type | Original | Compressed | Reduction |
|--------------|----------|------------|-----------|
| Failure record | 845 chars | 264 chars | **69%** |
| Component docs | 400 chars | 120 chars | **70%** |
| Error pattern | 300 chars | 90 chars | **70%** |
| Generic text | 200 chars | 140 chars | **30%** |

---

## Related

- [Decompression Prompt](decompression-prompt.md) - Reverse operation
- [All Prompts](all-prompts.md) - Complete reference
- [Compression Schemas](../memory/compression-schemas.md) - Schema-based compression
