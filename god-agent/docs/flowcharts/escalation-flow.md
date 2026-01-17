# Escalation Flow

How RUBIX decides when to escalate to humans.

## Decision Flow

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

## Communication Fallback Chain

```mermaid
flowchart LR
    A[Escalation] --> B[Telegram]
    B -->|5 min timeout| C[Phone]
    C -->|5 min timeout| D[SMS]
    D -->|5 min timeout| E[Slack]
    E -->|5 min timeout| F[Discord]
    F -->|5 min timeout| G[Email]

    B -->|Response| H[Resume]
    C -->|Response| H
    D -->|Response| H
    E -->|Response| H
    F -->|Response| H
    G -->|Response| H
```

## Escalation Types

| Type | Description | Example |
|------|-------------|---------|
| `clarification` | Need more info | "Which database should I use?" |
| `decision` | Business choice needed | "Should we delete old data?" |
| `blocked` | Cannot proceed | "Missing API credentials" |
| `approval` | Irreversible action | "Deploy to production?" |

## Hard Escalation Rules

These **always** trigger escalation:

1. **Critical specification ambiguity** - Core requirements unclear
2. **Max attempts exceeded** - 3+ failures on same subtask
3. **High-impact irreversible** - Destructive operations
4. **Security-sensitive** - Credential handling

## Autonomous Decisions

These can be made **without** escalation:

- Formatting choices (tabs vs spaces)
- Variable naming conventions
- Import ordering
- Comment style

## Escalation Message Format

```typescript
{
  type: "decision",
  title: "Database Selection Required",
  message: "The task requires a database but none is specified.",
  options: [
    { label: "PostgreSQL", description: "ACID compliant, good for relations" },
    { label: "MongoDB", description: "Flexible schema, good for documents" },
    { label: "SQLite", description: "Simple, file-based, no server" }
  ]
}
```

## State During Escalation

```mermaid
stateDiagram-v2
    [*] --> Running
    Running --> Blocked: Escalation sent
    Blocked --> Waiting: Channel timeout
    Waiting --> Blocked: Try next channel
    Blocked --> Running: User responds
    Waiting --> Failed: All channels exhausted
```

## Related

- [Task Execution Flow](task-execution-flow.md)
- [Communication Tools](../tools/communication-tools.md)
- [EscalationGate](../codex/escalation-gate.md)
