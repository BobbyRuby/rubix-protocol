# Task Execution Flow

How RUBIX executes tasks from submission to completion.

## Sequence Diagram

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

    loop For each subtask (max 3 attempts)
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

## Subtask Types

```mermaid
flowchart TD
    TASK[Task] --> TD[TaskDecomposer]
    TD --> R[research]
    TD --> D[design]
    TD --> C[code]
    TD --> T[test]
    TD --> I[integrate]
    TD --> V[verify]
    TD --> REV[review]

    R --> |Analyze codebase| CG
    D --> |Architecture| CG
    C --> |Implementation| CG
    T --> |Write tests| CG
    I --> |Wire components| CG
    V --> |Playwright| PW
    REV --> |Code review| CR

    CG[CodeGenerator]
    PW[Playwright]
    CR[CodeReviewer]
```

## Retry Strategy

| Attempt | Strategy | Thinking Budget |
|---------|----------|-----------------|
| 1 | Standard approach | 0 (no thinking) |
| 2 | Alternative + healing suggestions | 5,000 tokens |
| 3 | Ultrathink mode | 16,000 tokens |
| 4+ | Escalate to human | N/A |

## State Machine

```mermaid
stateDiagram-v2
    [*] --> Pending: Submit task
    Pending --> Running: Start execution
    Running --> Running: Process subtask
    Running --> Blocked: Need clarification
    Blocked --> Running: User responds
    Running --> Completed: All subtasks done
    Running --> Failed: Max attempts exceeded
    Completed --> [*]
    Failed --> [*]
```

## Related

- [System Architecture](system-architecture.md)
- [Escalation Flow](escalation-flow.md)
- [CODEX Tools](../tools/codex-tools.md)
