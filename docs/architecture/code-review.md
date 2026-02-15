# Code Review System

**File:** `src/review/CodeReviewer.ts` (~1480 lines)

Automated code review engine with OWASP security scanning. Reviews generated code for security vulnerabilities, code quality, and best practices. Integrated into PhasedExecutor Phase 4a and used by PostExecGuardian.

## Purpose

CodeReviewer performs multi-dimensional automated review: security vulnerability detection (OWASP Top 10), style/lint checking, logic/type checking, and test coverage analysis. Produces a scored result (0-100) with approval status.

## Key Concepts

### Review Types

| Type | Description |
|------|-------------|
| `full` | Security + style + logic + tests |
| `security` | Security scanning only |
| `style` | Style and formatting only |
| `logic` | Type checking and correctness |
| `quick` | Fast sanity check (pre-commit) |
| `pre-commit` | Pre-commit validation |

### Security Scanning (OWASP Top 10)

Defined in `src/review/SecurityPatterns.ts`. 23 regex patterns covering: Broken Access Control (A01), Cryptographic Failures (A02), Injection/XSS (A03), Security Misconfiguration (A05), Auth Failures (A07), SSRF (A10), hardcoded secrets, path traversal, prototype pollution, and ReDoS.

Each `SecurityFinding` includes: severity, CWE ID, OWASP category, remediation advice, confidence level, and false-positive detection.

### Approval Logic

| Condition | Result |
|-----------|--------|
| Any critical issues | Blocked, requires human review |
| High-severity issues | Changes requested |
| Total issues > maxIssues (50) | Blocked |
| Only medium/low issues | Approved with notes |
| No issues | Clean approval |

### Scoring

Score = 100 minus weighted penalties: critical (-25), high (-10), medium (-3), low (-1).

## MCP Tools

### god_review

Full code review on specified files:

```typescript
const result = await mcp__rubix__god_review({
  files: ["src/api/handler.ts"],
  type: "full"
});
// Returns: { status, summary, issues[], security[], approval, score }
```

### god_quick_review

Fast pre-commit check returning only critical/high issues.

### god_security_review

Security-only scan returning findings with risk level (critical/high/medium/low/none).

### god_review_config

Get or update review configuration (enable/disable phases, set thresholds).

## Parallel Processing

Files are reviewed in parallel batches (default: 5 concurrent) with per-file timeout (30s). Progress events are emitted via EventEmitter for real-time tracking.

## Next Steps

- [Guardian](guardian.md) - Post-execution audit using CodeReviewer
- [Task Execution](task-execution.md) - Phase 4a integration
