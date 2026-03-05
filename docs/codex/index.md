# CODEX System Documentation

The CODEX system is the core of RUBIX's autonomous development capabilities. It consists of 28 files that handle task decomposition, code generation, self-healing, and escalation.

## Overview

```mermaid
graph TB
    subgraph "Task Management"
        TE[TaskExecutor]
        TD[TaskDecomposer]
    end

    subgraph "Code Generation"
        CG[CodeGenerator]
        CCE[ClaudeCodeExecutor]
        OR[OllamaReasoner]
    end

    subgraph "Self-Healing"
        SH[SelfHealer]
        AF[AlternativesFinder]
        CD[CausalDebugger]
    end

    subgraph "Escalation"
        EG[EscalationGate]
        CM[CommunicationManager]
    end

    subgraph "Planning"
        PS[PlanningSession]
        PA[PlanningAgent]
        PV[PlanValidator]
        PE[PlanExecutor]
    end

    subgraph "Advanced"
        CP[CollaborativePartner]
        CM2[ContainmentManager]
        PX[PhasedExecutor]
    end

    TE --> TD
    TE --> CG
    TE --> SH
    TE --> EG

    CG --> CCE
    CG --> OR

    SH --> AF
    SH --> CD

    EG --> CM
```

## File Reference

| File | Lines | Purpose |
|------|-------|---------|
| [TaskExecutor](task-executor.md) | ~3350 | Main orchestrator |
| [TaskDecomposer](task-decomposer.md) | ~700 | Task breakdown |
| [ClaudeReasoner](code-generator.md) | ~600 | Claude code generation |
| [SelfHealer](self-healer.md) | ~985 | Failure analysis + 5-tier escalation |
| [EscalationGate](escalation-gate.md) | ~540 | Escalation logic |
| [CollaborativePartner](collaborative-partner.md) | ~590 | Proactive curiosity |
| [ContainmentManager](containment-manager.md) | ~710 | Path permissions |
| [PhasedExecutor](phased-executor.md) | ~2160 | 6-phase execution pipeline |
| [ParallelEngineer](parallel-engineer.md) | ~350 | Topo-sorted parallel code gen |
| EngineerProvider | ~350 | Provider abstraction |
| [types.ts](types.md) | ~530 | Type definitions |
| ContextScout | ~580 | Context gathering + skill detection |
| ModelSelector | ~100 | Complexity-based model routing |
| LearningIntegration | ~500 | Pattern learning |
| AlternativesFinder | ~500 | Alternative strategies |
| CausalDebugger | ~645 | Causal debugging |
| WorkingMemoryManager | ~636 | Active memory |
| PlanningSession | ~1260 | Unlimited planning |
| ConversationSession | ~130 | Lightweight chat |
| PlanningAgent | ~1295 | Agentic planning |
| PlanValidator | ~445 | Plan validation |
| PlanExecutor | ~390 | Plan execution |
| PlanDeviationDetector | ~340 | Plan drift detection |
| [SkillDetector](skill-detector.md) | ~200 | Polyglot skill detection |
| PermissionDetector | ~280 | Permission detection |
| CodexLogger | ~360 | Structured logging |
| Logger | ~200 | Log utilities |
| index.ts | ~150 | Export hub |

## Execution Flow

```mermaid
sequenceDiagram
    participant User
    participant MCP as god_codex_do
    participant TE as TaskExecutor
    participant TD as TaskDecomposer
    participant CG as CodeGenerator
    participant SH as SelfHealer
    participant EG as EscalationGate

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
            end
        end
    end

    TE-->>MCP: TaskResult
```

## 7 Subtask Types

| Type | Description | Example |
|------|-------------|---------|
| **research** | Analyze codebase, read docs | "Understand authentication flow" |
| **design** | Architecture planning | "Design component structure" |
| **code** | Code generation | "Implement login function" |
| **test** | Write/run tests | "Add unit tests for auth" |
| **integrate** | Wire components | "Connect auth to routes" |
| **verify** | Playwright verification | "Verify login works in browser" |
| **review** | Code quality check | "Review for security issues" |

## Retry Strategy

| Attempt | Strategy | Extended Thinking |
|---------|----------|-------------------|
| 1 | Standard approach | No |
| 2 | Alternative + learning suggestions | 5K tokens |
| 3 | Extended thinking | 10K tokens |
| 4 | Different alternative approach | 15K tokens |
| 5 | Final attempt with maximum context | 16K tokens |

## Execution Modes

### 1. Standard Mode

Default execution with Claude Code CLI.

```typescript
const result = await taskExecutor.execute({
  description: "Add user authentication",
  codebase: "/path/to/project"
});
```

### 2. RUBIX Mode

Department heads with parallel execution.

```typescript
taskExecutor.enableRubixMode({
  model: 'claude-sonnet-4-20250514',
  maxSubAgentsPerDepartment: 5
});
```

### 3. Phased Mode

6-phase tokenized execution for rate limit mitigation.

```typescript
const result = await phasedExecutor.execute(task);
```

## MCP Tools

### god_codex_do

Submit a task for execution:

```typescript
await mcp__rubix__god_codex_do({
  description: "Add login functionality",
  codebase: "D:/my-project",
  constraints: ["Use TypeScript", "Add tests"],
  verificationUrl: "http://localhost:3000"
});
```

### god_codex_status

Check execution status:

```typescript
const status = await mcp__rubix__god_codex_status();
```

### god_codex_answer

Answer an escalation:

```typescript
await mcp__rubix__god_codex_answer({
  escalationId: "esc_123",
  answer: "Use JWT tokens"
});
```

### god_codex_cancel

Cancel the current task:

```typescript
await mcp__rubix__god_codex_cancel();
```

### god_codex_log

Get the work log:

```typescript
const log = await mcp__rubix__god_codex_log();
```

## Self-Healing

When a subtask fails:

1. **Error Classification** - Type, transient check, strategy suggestion
2. **Failure Memory Query** - Find similar past failures
3. **Enhanced Analysis** - Stack traces, git history, diagnostics
4. **Strategy Selection** - Choose recovery approach

### Healing Strategies

| Strategy | Description |
|----------|-------------|
| `retry_with_context` | Retry with more context |
| `simplify_approach` | Try simpler approach |
| `try_alternative` | Use different approach |
| `gather_more_context` | Gather more information |
| `break_into_smaller_steps` | Decompose further |
| `escalate` | Ask user for help |

## Escalation Rules

### Must Escalate

- Critical spec ambiguity (high business impact)
- Max attempts exceeded
- High-impact irreversible actions

### Autonomous Decisions

- Dependency minor versions
- Code formatting
- Variable naming
- Test structure

### Requires Approval

- Database schema changes
- API breaking changes
- New dependencies
- Architecture changes

## Next Steps

- [TaskExecutor](task-executor.md) - Main orchestrator documentation
- [CodeGenerator](code-generator.md) - Code generation details
- [SelfHealer](self-healer.md) - Self-healing system
- [EscalationGate](escalation-gate.md) - Escalation logic
