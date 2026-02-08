# Conversation Schema

The conversation schema provides efficient compression for sub-agent conversation logs in RUBIX department head system.

## Format

Compressed format: `task_id|department|attempt|model|tools|files|outcome|duration|error|summary`

Example:
```
TSK001|engineer|2|S|R3.E2.B1|src/auth.ts,src/middleware.ts|S|45000||refactored_auth_logic
```

## Fields

| Position | Field | Description | Example Values |
|----------|-------|-------------|----------------|
| 0 | task_id | Task identifier | TSK001, TASK-ABC |
| 1 | department | RUBIX department | researcher, architect, engineer, validator, guardian |
| 2 | attempt | Attempt number | 1, 2, 3 |
| 3 | model | Claude model used | S (Sonnet), O (Opus) |
| 4 | tools_used | Tool usage counts | R3.E2.B1 = Read(3), Edit(2), Bash(1) |
| 5 | files_modified | Comma-separated file paths | src/foo.ts,src/bar.ts |
| 6 | outcome | Success or failure | S (SUCCESS), F (FAILED) |
| 7 | duration_ms | Duration in milliseconds | 45000 (45 seconds) |
| 8 | error_type | Error type if failed | timeout, syntax, type, runtime |
| 9 | summary | Brief summary (max 40 chars) | refactored_auth_logic |

## Tool Abbreviations

- R = Read
- E = Edit
- W = Write
- B = Bash
- G = Glob
- P = Grep
- T = Task
- F = WebFetch

## Usage Example

```typescript
import { COMPRESSION_SCHEMAS } from './src/memory/CompressionSchemas.js';

// Store a conversation log
const conversationText = `
Task: TSK001
Department: engineer
Attempt: 2
Model: Sonnet
Tools: Read(3), Edit(2), Bash(1)
Files: src/auth.ts, src/middleware.ts
Outcome: success
Duration: 45000ms
Summary: Refactored authentication logic to use JWT tokens
`;

// Compress
const compressed = COMPRESSION_SCHEMAS.conversation.encode(conversationText);
// Result: "TSK001|engineer|2|S|R3.E2.B1|src/auth.ts,src/middleware.ts|S|45000||refactored_auth_logic"

// Decompress
const readable = COMPRESSION_SCHEMAS.conversation.decode(compressed);
console.log(readable);
```

## Decoded Output Format

```
Task: TSK001
Department: engineer (Attempt 2)
Model: Sonnet
Tools: Read(3), Edit(2), Bash(1)
Files: src/auth.ts, src/middleware.ts
Outcome: SUCCESS
Duration: 45s
Summary: refactored auth logic
```

## Compression Efficiency

Typical compression ratios: 50-60% size reduction

- Input: ~200 characters
- Compressed: ~100 characters
- Token savings: ~50 tokens per conversation log

## Integration with Memory Storage

```typescript
import { MemoryEngine } from './src/memory/index.js';

const engine = new MemoryEngine();

// Store compressed conversation
await engine.store(
  conversationText,
  {
    type: 'conversation',
    tags: ['rubix', 'engineer', 'auth'],
    importance: 0.8,
    source: 'tool_output'
  }
);

// Query conversations
const results = await engine.query('authentication refactoring', {
  tags: ['conversation']
});

// Results are automatically decompressed for readability
console.log(results[0].content); // Human-readable format
```

## Type Detection

The schema is automatically detected based on:
- 10 segments in compressed format
- Model code (S/O) in position 3
- Department name (researcher/architect/engineer/validator/guardian) in position 1

This allows automatic compression/decompression without explicit type specification.
