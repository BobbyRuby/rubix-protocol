# TaskDecomposer

Breaks high-level tasks into executable subtasks.

## Location

`src/codex/TaskDecomposer.ts`

## Purpose

Analyzes a task description and produces an ordered list of subtasks that the TaskExecutor can process sequentially.

## Subtask Types

| Type | Purpose | Example |
|------|---------|---------|
| `research` | Analyze codebase | "Find all auth-related files" |
| `design` | Architecture planning | "Design the API structure" |
| `code` | Implementation | "Create the login component" |
| `test` | Write/run tests | "Add unit tests for validation" |
| `integrate` | Wire components | "Connect service to controller" |
| `verify` | UI verification | "Check login page renders" |
| `review` | Code quality | "Review for security issues" |

## Decomposition Flow

```mermaid
flowchart TD
    A[Task Description] --> B[TaskDecomposer.decompose]
    B --> C[Analyze requirements]
    C --> D[Identify dependencies]
    D --> E[Order by dependency]
    E --> F[Generate subtasks]
    F --> G[Return Subtask[]]
```

## Example

### Input
```
"Add user authentication with JWT tokens"
```

### Output
```typescript
[
  { type: "research", description: "Analyze existing auth patterns" },
  { type: "design", description: "Design JWT auth flow" },
  { type: "code", description: "Implement token generation" },
  { type: "code", description: "Implement token validation middleware" },
  { type: "code", description: "Create login/logout endpoints" },
  { type: "test", description: "Add auth unit tests" },
  { type: "integrate", description: "Wire auth to routes" },
  { type: "verify", description: "Test login flow in browser" }
]
```

## Interface

```typescript
interface TaskDecomposer {
  decompose(task: TaskDefinition): Promise<Subtask[]>;
}

interface Subtask {
  id: string;
  type: SubtaskType;
  description: string;
  dependencies?: string[];
  estimatedComplexity?: 'low' | 'medium' | 'high';
}
```

## Related

- [TaskExecutor](task-executor.md) - Executes subtasks
- [CodeGenerator](code-generator.md) - Generates code for subtasks
- [Task Execution Flow](../flowcharts/task-execution-flow.md)
