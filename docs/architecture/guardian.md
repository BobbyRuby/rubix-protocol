# Guardian (Post-Execution Audit)

**File:** `src/guardian/PostExecGuardian.ts` (~1400 lines)

Post-execution audit system. After PhasedExecutor writes files (Phase 5), the Guardian audits changes for security vulnerabilities, quality issues, and policy violations. Can trigger automatic rollback on critical findings.

## Purpose

The Guardian acts as a safety net between code generation and task completion. It runs 6 audit phases on every file written or modified by CODEX, and has veto power to block completion or roll back changes entirely.

## Key Concepts

### Audit Phases

| Phase | Description | Enabled by Default |
|-------|-------------|--------------------|
| `security` | Pattern-based vulnerability scanning (eval, SQL injection, hardcoded secrets, etc.) | Yes |
| `regression` | Runs test suite to detect broken functionality | Yes |
| `diff_analysis` | Compares pre/post snapshots for risky changes (removed exports, large diffs) | Yes |
| `type_check` | TypeScript type checking via CapabilitiesManager | Yes |
| `lint` | ESLint linting via CapabilitiesManager | Yes |
| `quality` | Checks for long functions (>100 lines), deep nesting, long lines | Yes |

### Severity and Blocking

Issues are classified by severity: `critical > high > medium > low > info`. The `blockingSeverity` config (default: `high`) determines the threshold. Critical issues trigger automatic rollback when `autoRollbackOnCritical` is enabled (default: true).

### Pre-Write Snapshots

Before EXECUTOR writes files, Guardian creates a `PreWriteSnapshot` containing file contents (inline for <100KB, backup file for larger). Also creates a git stash ref as fallback. Snapshots enable rollback via file restore, git stash apply, or git checkout.

### Rollback Methods

Rollback is attempted in order: git stash apply, file-by-file restore from snapshot, git checkout as last resort.

## Integration with PhasedExecutor

```
Phase 5 (EXECUTOR) → writes files
Phase 5a (POST_AUDIT) → Guardian.audit(context) → AuditResult
  → passed? → continue to Phase 4 (VALIDATOR)
  → failed? → Guardian.rollback(context) → restore files
```

## MCP Tools

### god_guardian_audit

Trigger a manual audit on specified files:

```typescript
const result = await mcp__rubix__god_guardian_audit({
  files: ["src/routes/api.ts", "src/middleware/auth.ts"],
  taskId: "task_123"
});
// Returns: { passed, issues[], rollbackRequired, summary }
```

## Configuration

```typescript
// Key defaults from DEFAULT_GUARDIAN_CONFIG
{
  autoRollbackOnCritical: true,
  blockingSeverity: 'high',
  maxIssuesBeforeBlock: 10,
  testTimeout: 120000,       // 2 min
  maxFileSize: 1048576,      // 1MB
  skipPatterns: ['**/node_modules/**', '**/dist/**', '**/*.test.ts']
}
```

## Audit Results Stored in Memory

Audit results are automatically stored with tags `['guardian', 'audit', 'passed'|'failed']`. Critical issues are stored separately with importance 0.9 for future learning.

## Next Steps

- [Code Review](code-review.md) - OWASP security scanning used by Guardian
- [Task Execution](task-execution.md) - PhasedExecutor integration
