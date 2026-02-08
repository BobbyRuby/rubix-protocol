# PhasedExecutor

6-phase tokenized execution system for RUBIX tasks.

## Location

`src/codex/PhasedExecutor.ts`

## Purpose

Executes tasks through 6 distinct phases with token budget management and department-based parallelization.

## The 6 Phases

```mermaid
flowchart LR
    P1[1. RESEARCH] --> P2[2. DESIGN]
    P2 --> P3[3. IMPLEMENT]
    P3 --> P4[4. TEST]
    P4 --> P5[5. VALIDATE]
    P5 --> P6[6. INTEGRATE]
```

| Phase | Department | Purpose | Parallelism |
|-------|------------|---------|-------------|
| 1. RESEARCH | RESEARCHER | Understand codebase | Low |
| 2. DESIGN | ARCHITECT | Plan solution | Low |
| 3. IMPLEMENT | ENGINEER | Write code | **High** |
| 4. TEST | VALIDATOR | Write tests | Medium |
| 5. VALIDATE | GUARDIAN | Security/review | Medium |
| 6. INTEGRATE | ENGINEER | Wire together | Low |

## Token Budget Routing

```mermaid
flowchart TD
    A[Task] --> B[TokenRouter]
    B --> C{Complexity?}
    C -->|Simple| D[50K tokens]
    C -->|Medium| E[100K tokens]
    C -->|Complex| F[200K tokens]
    D --> G[Distribute to phases]
    E --> G
    F --> G
```

## Department Model

```
                    ┌─────────────────┐
                    │     CLAUDE      │
                    │  (Head of Ops)  │
                    └────────┬────────┘
                             │
        ┌────────────────────┼────────────────────┐
        ▼                    ▼                    ▼
   ┌─────────┐          ┌─────────┐          ┌─────────┐
   │RESEARCHER│         │ARCHITECT│          │ENGINEER │
   └────┬────┘          └────┬────┘          └────┬────┘
        │                    │                    │
     Agents               Agents              Agents
     (1-2)                (1-2)               (1-5)
```

## Phase Configuration

```typescript
interface PhaseConfig {
  phase: Phase;
  department: Department;
  maxAgents: number;
  tokenBudget: number;
  canParallelize: boolean;
}

const PHASE_CONFIGS: PhaseConfig[] = [
  { phase: 'RESEARCH', department: 'RESEARCHER', maxAgents: 2, canParallelize: false },
  { phase: 'DESIGN', department: 'ARCHITECT', maxAgents: 2, canParallelize: false },
  { phase: 'IMPLEMENT', department: 'ENGINEER', maxAgents: 5, canParallelize: true },
  { phase: 'TEST', department: 'VALIDATOR', maxAgents: 3, canParallelize: true },
  { phase: 'VALIDATE', department: 'GUARDIAN', maxAgents: 2, canParallelize: true },
  { phase: 'INTEGRATE', department: 'ENGINEER', maxAgents: 2, canParallelize: false }
];
```

## Execution Flow

```mermaid
sequenceDiagram
    participant PE as PhasedExecutor
    participant TR as TokenRouter
    participant DP as Department
    participant CG as CodeGenerator

    PE->>TR: allocateBudget(task)
    TR-->>PE: phasebudgets[]

    loop For each phase
        PE->>DP: assignWork(subtasks)
        DP->>CG: generate(context)
        CG-->>DP: results
        DP-->>PE: phaseComplete
    end
```

## Benefits

| Feature | Benefit |
|---------|---------|
| Phase isolation | Clear boundaries, easier debugging |
| Token budgeting | Predictable costs |
| Parallel IMPLEMENT | Faster code generation |
| Department model | Specialized prompts per role |

## Related

- [TaskExecutor](task-executor.md) - Main orchestrator
- [CodeGenerator](code-generator.md) - Generates code
- [Task Execution Flow](../flowcharts/task-execution-flow.md)
