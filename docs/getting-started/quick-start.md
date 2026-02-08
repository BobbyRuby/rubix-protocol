# Quick Start

Get RUBIX running and execute your first task in 5 minutes.

## Prerequisites

Ensure you have:
- [x] Node.js 20+ installed
- [x] `OPENAI_API_KEY` set
- [x] `ANTHROPIC_API_KEY` set
- [x] RUBIX built and running as MCP server

## Step 1: Verify MCP Tools

In Claude Code, check that RUBIX tools are available:

```
/mcp
```

You should see tools like:
- `mcp__rubix__god_store`
- `mcp__rubix__god_query`
- `mcp__rubix__god_codex_do`
- ... (80+ tools)

## Step 2: Store Your First Memory

```typescript
await mcp__rubix__god_store({
  content: "The authentication module uses JWT tokens with 24-hour expiry",
  tags: ["auth", "security", "jwt"],
  importance: 0.8
});
```

Response:
```json
{
  "success": true,
  "entryId": "abc123...",
  "lScore": 0.9,
  "compressed": true
}
```

## Step 3: Query Memory

```typescript
const results = await mcp__rubix__god_query({
  query: "how does authentication work?",
  topK: 5,
  includeProvenance: true
});
```

Response:
```json
{
  "success": true,
  "results": [
    {
      "id": "abc123...",
      "content": "auth|jwt|24h_expiry|security",
      "similarity": 0.92,
      "lScore": 0.9
    }
  ]
}
```

## Step 4: Query with Expansion

Get human-readable results:

```typescript
const expanded = await mcp__rubix__god_query_expanded({
  query: "authentication",
  topK: 3
});
```

Response:
```json
{
  "success": true,
  "results": [
    {
      "id": "abc123...",
      "content": "The authentication module uses JWT tokens with 24-hour expiry.",
      "similarity": 0.92,
      "expanded": true
    }
  ]
}
```

## Step 5: Submit a RUBIX Task

```typescript
await mcp__rubix__god_codex_do({
  description: "Create a simple hello world function in TypeScript",
  codebase: "D:/my-project",
  constraints: ["Use TypeScript", "Add JSDoc comments"]
});
```

Response:
```json
{
  "success": true,
  "taskId": "task_xyz...",
  "status": "decomposing"
}
```

## Step 6: Monitor Task Progress

```typescript
const status = await mcp__rubix__god_codex_status();
```

Response:
```json
{
  "status": "executing",
  "currentTask": {
    "description": "Create a simple hello world function",
    "subtasks": [
      { "type": "research", "status": "completed" },
      { "type": "code", "status": "in_progress" },
      { "type": "test", "status": "pending" }
    ]
  },
  "progress": {
    "completed": 1,
    "total": 3
  }
}
```

## Step 7: View Work Log

```typescript
const log = await mcp__rubix__god_codex_log();
```

Response:
```json
{
  "entries": [
    { "time": "10:00:01", "event": "task_started", "details": "..." },
    { "time": "10:00:05", "event": "subtask_completed", "type": "research" },
    { "time": "10:00:30", "event": "file_created", "path": "src/hello.ts" }
  ]
}
```

## Example: Full Development Workflow

### 1. Research Phase

RUBIX analyzes your codebase:

```typescript
// RUBIX automatically:
// - Scans project structure
// - Identifies patterns and conventions
// - Finds relevant existing code
```

### 2. Code Generation

RUBIX generates code following your patterns:

```typescript
// Generated file: src/hello.ts
/**
 * Returns a greeting message.
 * @param name - The name to greet
 * @returns The greeting string
 */
export function hello(name: string): string {
  return `Hello, ${name}!`;
}
```

### 3. Verification

RUBIX verifies the result:

```typescript
// - TypeScript compilation check
// - Lint check
// - Test execution (if applicable)
```

## Browser Verification Example

For UI tasks, RUBIX can verify visually:

```typescript
await mcp__rubix__god_codex_do({
  description: "Add a login button to the header",
  codebase: "D:/my-webapp",
  verificationUrl: "http://localhost:3000"
});

// RUBIX will:
// 1. Generate the code
// 2. Launch browser via Playwright
// 3. Navigate to verification URL
// 4. Assert the button is visible
// 5. Take screenshot for proof
```

## Self-Healing in Action

When something fails:

```
Attempt 1: Standard approach → Type error
Attempt 2: Alternative approach → Runtime error
Attempt 3: Extended thinking (16K tokens) → Success!
```

RUBIX automatically:
1. Analyzes the failure
2. Queries similar past failures
3. Tries alternative approaches
4. Escalates only when truly blocked

## Deep Work Mode

For focused development:

```typescript
// Start deep work session
await mcp__rubix__god_deepwork_start({
  focusLevel: "deep",
  allowUrgent: true,
  allowComplete: true
});

// Submit multiple tasks
await mcp__rubix__god_codex_do({...});

// Check progress periodically
await mcp__rubix__god_deepwork_status();

// End session
await mcp__rubix__god_deepwork_pause();
```

## Common Task Examples

### Add a Feature

```typescript
await mcp__rubix__god_codex_do({
  description: "Add user profile page with avatar upload",
  codebase: "D:/my-app",
  constraints: [
    "Use existing auth system",
    "Follow React patterns in codebase",
    "Add unit tests"
  ]
});
```

### Fix a Bug

```typescript
await mcp__rubix__god_codex_do({
  description: "Fix: Login fails when email contains plus sign",
  codebase: "D:/my-app",
  specification: `
    Bug: Users with emails like user+tag@example.com cannot log in.
    Expected: Login should work with any valid email.
    Current: Email validation rejects plus signs.
  `
});
```

### Refactor Code

```typescript
await mcp__rubix__god_codex_do({
  description: "Refactor authentication module to use async/await",
  codebase: "D:/my-app",
  constraints: [
    "Maintain backward compatibility",
    "Update all tests",
    "No breaking API changes"
  ]
});
```

## Next Steps

- [Architecture Overview](../architecture/overview.md) - Understand how RUBIX works
- [MCP Tools Reference](../tools/index.md) - Explore all 80+ tools
- [Task Execution](../architecture/task-execution.md) - Deep dive into RUBIX execution
