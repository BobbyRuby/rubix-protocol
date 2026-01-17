# CODEX Types

Type definitions for the RUBIX/CODEX execution system.

## Location

`src/codex/types.ts`

## Core Types

### TaskDefinition

```typescript
interface TaskDefinition {
  id: string;
  description: string;
  specification?: string;
  codebase: string;
  verificationUrl?: string;
  constraints?: string[];
  dryRun?: boolean;
}
```

### Subtask

```typescript
interface Subtask {
  id: string;
  type: SubtaskType;
  description: string;
  dependencies?: string[];
  estimatedComplexity?: 'low' | 'medium' | 'high';
  status: SubtaskStatus;
  attempt: number;
  result?: SubtaskResult;
}

type SubtaskType =
  | 'research'
  | 'design'
  | 'code'
  | 'test'
  | 'integrate'
  | 'verify'
  | 'review';

type SubtaskStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped';
```

### TaskResult

```typescript
interface TaskResult {
  taskId: string;
  status: TaskStatus;
  subtasks: {
    completed: number;
    total: number;
    results: SubtaskResult[];
  };
  artifacts?: Artifact[];
  duration: number;
  error?: string;
}

type TaskStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'cancelled';
```

### CodeGenResult

```typescript
interface CodeGenResult {
  success: boolean;
  files: FileChange[];
  explanation?: string;
  tokensUsed: number;
  thinkingBudget?: number;
}

interface FileChange {
  path: string;
  action: 'create' | 'modify' | 'delete';
  content?: string;
  diff?: string;
}
```

### Escalation Types

```typescript
interface Escalation {
  id: string;
  type: EscalationType;
  title: string;
  message: string;
  options?: EscalationOption[];
  createdAt: Date;
  respondedAt?: Date;
  response?: string;
}

type EscalationType =
  | 'clarification'
  | 'decision'
  | 'blocked'
  | 'approval';

interface EscalationOption {
  label: string;
  description: string;
}
```

### HealingAnalysis

```typescript
interface HealingAnalysis {
  canRetry: boolean;
  suggestion: string;
  alternativeApproach?: string;
  rootCause?: string;
  similarFailures?: string[];
}
```

## Department Types

```typescript
type Department =
  | 'RESEARCHER'
  | 'ARCHITECT'
  | 'ENGINEER'
  | 'VALIDATOR'
  | 'GUARDIAN';

type Phase =
  | 'RESEARCH'
  | 'DESIGN'
  | 'IMPLEMENT'
  | 'TEST'
  | 'VALIDATE'
  | 'INTEGRATE';
```

## Configuration Types

```typescript
interface CodexConfig {
  model: string;
  maxTokens: number;
  ultrathink: boolean;
  thinkBase: number;
  thinkIncrement: number;
  thinkMax: number;
  thinkStartAttempt: number;
  maxParallel: number;
  failFast: boolean;
  cliModel: string;
  cliTimeout: number;
}
```

## Related

- [TaskExecutor](task-executor.md)
- [Core Types](../core/types.md)
- [Task Execution Flow](../flowcharts/task-execution-flow.md)
