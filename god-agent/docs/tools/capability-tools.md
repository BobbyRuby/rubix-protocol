# Capability Tools

Tools for IDE-like development capabilities including LSP, Git, AST, debugging, and more.

## Tool Categories

| Category | Tools | Description |
|----------|-------|-------------|
| [LSP](#lsp-tools) | 6 | Language Server Protocol |
| [Git](#git-tools) | 5 | Git integration |
| [AST](#ast-tools) | 4 | Abstract Syntax Tree |
| [Analysis](#analysis-tools) | 4 | Static analysis |
| [Debug](#debug-tools) | 5 | Debugging |
| [Stack](#stack-tools) | 2 | Stack trace |
| [Database](#database-tools) | 2 | Database introspection |
| [Profiler](#profiler-tools) | 3 | Performance profiling |
| [Docs](#docs-tools) | 2 | Documentation |
| [Wolfram](#wolfram-tools) | 4 | Computational |
| [Status](#status-tools) | 1 | Capabilities status |

---

## LSP Tools

Language Server Protocol tools for code intelligence.

### god_lsp_start

Start the Language Server Protocol integration.

```typescript
await mcp__rubix__god_lsp_start();
```

**Response:**
```json
{
  "success": true,
  "message": "LSP started",
  "languages": ["typescript", "javascript"]
}
```

### god_lsp_stop

Stop the Language Server Protocol integration.

```typescript
await mcp__rubix__god_lsp_stop();
```

### god_lsp_definition

Go to definition of a symbol.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | string | Yes | File path |
| `line` | number | Yes | Line number (1-based) |
| `column` | number | Yes | Column number (1-based) |

```typescript
const def = await mcp__rubix__god_lsp_definition({
  file: "src/api/users.ts",
  line: 25,
  column: 15
});

// Response
{
  "success": true,
  "definition": {
    "file": "src/models/User.ts",
    "line": 10,
    "column": 14,
    "preview": "export interface User {"
  }
}
```

### god_lsp_references

Find all references to a symbol.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | string | Yes | File path |
| `line` | number | Yes | Line number (1-based) |
| `column` | number | Yes | Column number (1-based) |
| `includeDeclaration` | boolean | No | Include declaration |

```typescript
const refs = await mcp__rubix__god_lsp_references({
  file: "src/models/User.ts",
  line: 10,
  column: 14,
  includeDeclaration: true
});

// Response
{
  "success": true,
  "references": [
    { "file": "src/models/User.ts", "line": 10, "column": 14 },
    { "file": "src/api/users.ts", "line": 5, "column": 10 },
    { "file": "src/services/auth.ts", "line": 15, "column": 20 }
  ],
  "count": 3
}
```

### god_lsp_diagnostics

Get diagnostics (errors, warnings) from the language server.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | string | No | File path (all files if not specified) |

```typescript
const diagnostics = await mcp__rubix__god_lsp_diagnostics({
  file: "src/api/users.ts"
});

// Response
{
  "success": true,
  "diagnostics": [
    {
      "file": "src/api/users.ts",
      "line": 42,
      "column": 10,
      "severity": "error",
      "message": "Property 'name' does not exist on type 'User'",
      "code": "ts(2339)"
    }
  ]
}
```

### god_lsp_symbols

Search for symbols across the codebase.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Symbol search query |

```typescript
const symbols = await mcp__rubix__god_lsp_symbols({
  query: "UserService"
});

// Response
{
  "success": true,
  "symbols": [
    {
      "name": "UserService",
      "kind": "class",
      "file": "src/services/UserService.ts",
      "line": 15
    }
  ]
}
```

---

## Git Tools

Git integration for version control operations.

### god_git_blame

Get blame information for a file.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | string | Yes | File path |
| `startLine` | number | No | Start line (1-based) |
| `endLine` | number | No | End line (1-based) |

```typescript
const blame = await mcp__rubix__god_git_blame({
  file: "src/api/users.ts",
  startLine: 40,
  endLine: 50
});

// Response
{
  "success": true,
  "lines": [
    {
      "line": 40,
      "commit": "abc1234",
      "author": "John Doe",
      "email": "john@example.com",
      "date": "2024-01-10",
      "message": "Add user validation"
    }
  ]
}
```

### god_git_bisect

Binary search for a breaking commit.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `good` | string | Yes | Known good commit/tag |
| `bad` | string | No | Known bad commit (default: HEAD) |
| `testCommand` | string | Yes | Command to test if commit is good |

```typescript
const result = await mcp__rubix__god_git_bisect({
  good: "v1.0.0",
  bad: "HEAD",
  testCommand: "npm test"
});

// Response
{
  "success": true,
  "badCommit": "def5678",
  "message": "Introduced bug in user validation",
  "author": "Jane Doe",
  "date": "2024-01-12",
  "stepsCount": 5
}
```

### god_git_history

Get commit history for a file or repository.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | string | No | File path (all files if not specified) |
| `limit` | number | No | Number of commits to return |
| `author` | string | No | Filter by author |

```typescript
const history = await mcp__rubix__god_git_history({
  file: "src/api/users.ts",
  limit: 10
});

// Response
{
  "success": true,
  "commits": [
    {
      "hash": "abc1234",
      "shortHash": "abc1234",
      "author": "John Doe",
      "date": "2024-01-15",
      "message": "Fix user validation bug"
    }
  ]
}
```

### god_git_diff

Show changes in the working directory or between commits.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | string | No | File path (all files if not specified) |
| `commit` | string | No | Commit to diff against (default: HEAD) |
| `staged` | boolean | No | Show staged changes only |

```typescript
const diff = await mcp__rubix__god_git_diff({
  file: "src/api/users.ts",
  staged: true
});

// Response
{
  "success": true,
  "diff": "--- a/src/api/users.ts\n+++ b/src/api/users.ts\n@@ -40,6 +40,7 @@...",
  "additions": 5,
  "deletions": 2
}
```

### god_git_branches

List and get information about git branches.

```typescript
const branches = await mcp__rubix__god_git_branches();

// Response
{
  "success": true,
  "current": "feature/auth",
  "branches": [
    {
      "name": "main",
      "remote": "origin/main",
      "ahead": 0,
      "behind": 0
    },
    {
      "name": "feature/auth",
      "remote": "origin/feature/auth",
      "ahead": 3,
      "behind": 0
    }
  ]
}
```

---

## AST Tools

Abstract Syntax Tree tools for code analysis and refactoring.

### god_ast_parse

Parse a file into an Abstract Syntax Tree.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | string | Yes | File path to parse |

```typescript
const ast = await mcp__rubix__god_ast_parse({
  file: "src/api/users.ts"
});

// Response
{
  "success": true,
  "ast": {
    "type": "Program",
    "body": [...],
    "sourceType": "module"
  },
  "nodeCount": 150
}
```

### god_ast_query

Query the AST for specific node types.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | string | Yes | File path |
| `nodeType` | string | Yes | Node type to find |

```typescript
const result = await mcp__rubix__god_ast_query({
  file: "src/api/users.ts",
  nodeType: "FunctionDeclaration"
});

// Response
{
  "success": true,
  "nodes": [
    {
      "name": "getUserById",
      "line": 25,
      "params": ["id"],
      "async": true
    },
    {
      "name": "createUser",
      "line": 45,
      "params": ["data"],
      "async": true
    }
  ]
}
```

### god_ast_refactor

Perform safe refactoring operations.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `type` | enum | Yes | Refactoring type |
| `target` | string | Yes | Target (file:symbolName) |
| `newValue` | string | No | New name/location |
| `scope` | string | No | Scope (file path or "all") |

**Refactoring types:** `rename`, `extract`, `inline`, `move`

```typescript
// Rename a function
await mcp__rubix__god_ast_refactor({
  type: "rename",
  target: "src/api/users.ts:getUserById",
  newValue: "findUserById",
  scope: "all"
});

// Response
{
  "success": true,
  "changes": [
    { "file": "src/api/users.ts", "line": 25, "change": "getUserById → findUserById" },
    { "file": "src/services/user.ts", "line": 10, "change": "getUserById → findUserById" }
  ],
  "filesModified": 2
}
```

### god_ast_symbols

Get all symbols defined in a file.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | string | Yes | File path |

```typescript
const symbols = await mcp__rubix__god_ast_symbols({
  file: "src/api/users.ts"
});

// Response
{
  "success": true,
  "symbols": [
    { "name": "User", "kind": "interface", "line": 5, "exported": true },
    { "name": "getUserById", "kind": "function", "line": 25, "exported": true },
    { "name": "validateUser", "kind": "function", "line": 60, "exported": false }
  ]
}
```

---

## Analysis Tools

Static analysis tools for code quality.

### god_analyze_lint

Run ESLint on source files.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `files` | string[] | No | Files to lint (default: all source files) |

```typescript
const lint = await mcp__rubix__god_analyze_lint({
  files: ["src/api/users.ts"]
});

// Response
{
  "success": true,
  "issues": [
    {
      "file": "src/api/users.ts",
      "line": 42,
      "column": 10,
      "rule": "no-unused-vars",
      "severity": "warning",
      "message": "'temp' is defined but never used"
    }
  ],
  "errorCount": 0,
  "warningCount": 1
}
```

### god_analyze_types

Run TypeScript type checking.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `files` | string[] | No | Files to type-check (default: all) |

```typescript
const types = await mcp__rubix__god_analyze_types({
  files: ["src/api/users.ts"]
});

// Response
{
  "success": true,
  "errors": [
    {
      "file": "src/api/users.ts",
      "line": 50,
      "column": 15,
      "message": "Type 'string' is not assignable to type 'number'",
      "code": "ts(2322)"
    }
  ],
  "errorCount": 1
}
```

### god_analyze_deps

Build dependency graph from an entry point.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entryPoint` | string | Yes | Entry point file |

```typescript
const deps = await mcp__rubix__god_analyze_deps({
  entryPoint: "src/index.ts"
});

// Response
{
  "success": true,
  "graph": {
    "src/index.ts": ["src/api/users.ts", "src/api/posts.ts"],
    "src/api/users.ts": ["src/models/User.ts", "src/services/auth.ts"],
    ...
  },
  "circularDependencies": [
    ["src/a.ts", "src/b.ts", "src/a.ts"]
  ],
  "totalModules": 25
}
```

### god_analyze_impact

Analyze the impact of changing a file.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | string | Yes | File to analyze impact for |

```typescript
const impact = await mcp__rubix__god_analyze_impact({
  file: "src/models/User.ts"
});

// Response
{
  "success": true,
  "directDependents": [
    "src/api/users.ts",
    "src/services/auth.ts"
  ],
  "indirectDependents": [
    "src/index.ts",
    "src/api/index.ts"
  ],
  "totalImpact": 4,
  "riskLevel": "medium"
}
```

---

## Debug Tools

Debugging tools for Node.js applications.

### god_debug_start

Start a debug session for a Node.js script.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `script` | string | Yes | Script to debug |
| `args` | string[] | No | Script arguments |

```typescript
await mcp__rubix__god_debug_start({
  script: "src/index.ts",
  args: ["--port", "3000"]
});

// Response
{
  "success": true,
  "sessionId": "debug_abc123",
  "message": "Debug session started"
}
```

### god_debug_stop

Stop all debug sessions.

```typescript
await mcp__rubix__god_debug_stop();
```

### god_debug_breakpoint

Set or remove a breakpoint.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | string | Yes | File path |
| `line` | number | Yes | Line number |
| `condition` | string | No | Conditional breakpoint expression |
| `remove` | boolean | No | Remove breakpoint instead of adding |

```typescript
// Set breakpoint
await mcp__rubix__god_debug_breakpoint({
  file: "src/api/users.ts",
  line: 42,
  condition: "user.id === 5"
});

// Remove breakpoint
await mcp__rubix__god_debug_breakpoint({
  file: "src/api/users.ts",
  line: 42,
  remove: true
});
```

### god_debug_step

Step through code execution.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | enum | Yes | Step action |

**Actions:** `continue`, `stepOver`, `stepInto`, `stepOut`

```typescript
await mcp__rubix__god_debug_step({
  action: "stepOver"
});

// Response
{
  "success": true,
  "location": {
    "file": "src/api/users.ts",
    "line": 43,
    "column": 5
  },
  "paused": true
}
```

### god_debug_eval

Evaluate an expression in the current debug context.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `expression` | string | Yes | Expression to evaluate |

```typescript
const result = await mcp__rubix__god_debug_eval({
  expression: "user.name"
});

// Response
{
  "success": true,
  "result": "John Doe",
  "type": "string"
}
```

---

## Stack Tools

Stack trace parsing and analysis.

### god_stack_parse

Parse an error stack trace.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `error` | string | Yes | Error message or stack trace string |

```typescript
const parsed = await mcp__rubix__god_stack_parse({
  error: "Error: Cannot find user\n    at getUserById (src/api/users.ts:42:10)\n    at async main (src/index.ts:15:5)"
});

// Response
{
  "success": true,
  "frames": [
    {
      "function": "getUserById",
      "file": "src/api/users.ts",
      "line": 42,
      "column": 10
    },
    {
      "function": "main",
      "file": "src/index.ts",
      "line": 15,
      "column": 5
    }
  ],
  "message": "Cannot find user"
}
```

### god_stack_context

Get code context around an error location.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | string | Yes | File path |
| `line` | number | Yes | Line number |
| `contextLines` | number | No | Number of surrounding lines (default: 5) |

```typescript
const context = await mcp__rubix__god_stack_context({
  file: "src/api/users.ts",
  line: 42,
  contextLines: 5
});

// Response
{
  "success": true,
  "context": {
    "before": ["  const user = await db.findOne({ id });", "  if (!user) {"],
    "line": "    throw new Error('Cannot find user');",
    "after": ["  }", "  return user;"]
  }
}
```

---

## Database Tools

Database introspection and type generation.

### god_db_schema

Get database schema information.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `connectionString` | string | No | Database connection string |

```typescript
const schema = await mcp__rubix__god_db_schema({
  connectionString: "postgresql://localhost/mydb"
});

// Response
{
  "success": true,
  "tables": [
    {
      "name": "users",
      "columns": [
        { "name": "id", "type": "integer", "nullable": false, "primaryKey": true },
        { "name": "email", "type": "varchar(255)", "nullable": false, "unique": true },
        { "name": "name", "type": "varchar(100)", "nullable": true }
      ],
      "indexes": [
        { "name": "users_pkey", "columns": ["id"], "unique": true }
      ],
      "foreignKeys": []
    }
  ]
}
```

### god_db_types

Generate TypeScript types from database schema.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `exportFormat` | enum | No | TypeScript export format |
| `addNullable` | boolean | No | Add null types for nullable columns |
| `addOptional` | boolean | No | Make nullable fields optional |

**Export formats:** `interface`, `type`, `class`

```typescript
const types = await mcp__rubix__god_db_types({
  exportFormat: "interface",
  addNullable: true,
  addOptional: true
});

// Response
{
  "success": true,
  "types": "export interface User {\n  id: number;\n  email: string;\n  name?: string | null;\n}"
}
```

---

## Profiler Tools

Performance profiling for Node.js applications.

### god_profile_start

Start CPU profiling a script.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `script` | string | Yes | Script to profile |
| `args` | string[] | No | Script arguments |
| `duration` | number | No | Max duration in seconds (default: 30) |

```typescript
await mcp__rubix__god_profile_start({
  script: "src/index.ts",
  duration: 60
});

// Response
{
  "success": true,
  "sessionId": "prof_abc123",
  "message": "Profiling started"
}
```

### god_profile_stop

Stop profiling and get results.

```typescript
const results = await mcp__rubix__god_profile_stop();

// Response
{
  "success": true,
  "profile": {
    "duration": 30000,
    "samples": 15000,
    "topFunctions": [
      { "name": "processData", "time": 2500, "percentage": 25 }
    ]
  }
}
```

### god_profile_hotspots

Analyze profile for performance hotspots.

```typescript
const hotspots = await mcp__rubix__god_profile_hotspots();

// Response
{
  "success": true,
  "hotspots": [
    {
      "function": "processData",
      "file": "src/utils/process.ts",
      "line": 45,
      "selfTime": 2500,
      "totalTime": 3000,
      "calls": 1500,
      "suggestion": "Consider caching or memoization"
    }
  ]
}
```

---

## Docs Tools

Documentation fetching and search.

### god_docs_fetch

Fetch documentation from a URL.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | Yes | Documentation URL to fetch |

```typescript
await mcp__rubix__god_docs_fetch({
  url: "https://react.dev/reference/react/useState"
});

// Response
{
  "success": true,
  "title": "useState",
  "content": "...",
  "cached": true
}
```

### god_docs_search

Search cached documentation.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Search query |
| `package` | string | No | Package name to search docs for |

```typescript
const results = await mcp__rubix__god_docs_search({
  query: "useState hook",
  package: "react"
});

// Response
{
  "success": true,
  "results": [
    {
      "title": "useState",
      "url": "https://react.dev/reference/react/useState",
      "snippet": "useState is a React Hook that lets you add a state variable..."
    }
  ]
}
```

---

## Wolfram Tools

Computational tools powered by Wolfram Alpha.

### god_wolfram_query

Query Wolfram Alpha computational knowledge engine.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Natural language query |

```typescript
const result = await mcp__rubix__god_wolfram_query({
  query: "integrate x^2 sin(x) dx"
});

// Response
{
  "success": true,
  "result": "-x^2 cos(x) + 2x sin(x) + 2 cos(x) + C",
  "interpretedAs": "integral of x^2 sin(x) dx"
}
```

### god_wolfram_calculate

Quick calculation via Wolfram Alpha.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `expression` | string | Yes | Math expression to calculate |

```typescript
const result = await mcp__rubix__god_wolfram_calculate({
  expression: "sqrt(2) + pi"
});

// Response
{
  "success": true,
  "result": "4.5558...",
  "exact": "√2 + π"
}
```

### god_wolfram_solve

Solve an equation via Wolfram Alpha.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `equation` | string | Yes | Equation to solve |

```typescript
const result = await mcp__rubix__god_wolfram_solve({
  equation: "x^3 - 4x + 2 = 0"
});

// Response
{
  "success": true,
  "solutions": [
    { "x": "-2.2143...", "type": "real" },
    { "x": "0.5390...", "type": "real" },
    { "x": "1.6753...", "type": "real" }
  ]
}
```

### god_wolfram_convert

Unit conversion via Wolfram Alpha.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `value` | number | Yes | Value to convert |
| `fromUnit` | string | Yes | Source unit |
| `toUnit` | string | Yes | Target unit |

```typescript
const result = await mcp__rubix__god_wolfram_convert({
  value: 100,
  fromUnit: "USD",
  toUnit: "EUR"
});

// Response
{
  "success": true,
  "result": 92.50,
  "rate": 0.925,
  "rateDate": "2024-01-15"
}
```

---

## Status Tools

### god_capabilities_status

Get status of all capabilities.

```typescript
const status = await mcp__rubix__god_capabilities_status();

// Response
{
  "success": true,
  "capabilities": {
    "lsp": { "enabled": true, "initialized": true },
    "git": { "enabled": true, "initialized": true },
    "ast": { "enabled": true, "initialized": true },
    "analysis": { "enabled": true, "initialized": true },
    "debug": { "enabled": true, "initialized": false },
    "database": { "enabled": true, "initialized": false },
    "profiler": { "enabled": true, "initialized": false },
    "docs": { "enabled": true, "initialized": true },
    "wolfram": { "enabled": false, "reason": "WOLFRAM_APP_ID not configured" }
  }
}
```

---

## Complete Workflow Example

```typescript
// 1. Start LSP for code intelligence
await mcp__rubix__god_lsp_start();

// 2. Find all references to a function
const refs = await mcp__rubix__god_lsp_references({
  file: "src/api/users.ts",
  line: 25,
  column: 10
});

// 3. Check impact before refactoring
const impact = await mcp__rubix__god_analyze_impact({
  file: "src/api/users.ts"
});

// 4. Rename the function safely
await mcp__rubix__god_ast_refactor({
  type: "rename",
  target: "src/api/users.ts:getUserById",
  newValue: "findUserById",
  scope: "all"
});

// 5. Run type checking to verify
const types = await mcp__rubix__god_analyze_types({});

// 6. Run lint to check style
const lint = await mcp__rubix__god_analyze_lint({});

// 7. Check git diff
const diff = await mcp__rubix__god_git_diff({});

console.log(`Refactoring complete!`);
console.log(`Type errors: ${types.errorCount}`);
console.log(`Lint warnings: ${lint.warningCount}`);
```

## Next Steps

- [CODEX Tools](codex-tools.md) - Task execution
- [Review Tools](review-tools.md) - Code review
- [Tools Overview](index.md) - All tools
