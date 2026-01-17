# Task Examples

Examples of RUBIX/CODEX task execution patterns.

## Basic Tasks

### Simple Bug Fix

```typescript
await mcp__rubix__god_codex_do({
  description: "Fix the login button that doesn't respond on mobile devices",
  codebase: "D:/my-project"
});

// Monitor progress
let status;
do {
  await sleep(5000);
  status = await mcp__rubix__god_codex_status();

  if (status.task?.subtasks) {
    const { completed, total } = status.task.subtasks;
    console.log(`Progress: ${completed}/${total}`);
  }
} while (status.status === "running");
```

### Feature Implementation

```typescript
await mcp__rubix__god_codex_do({
  description: "Add user profile page with avatar upload",
  specification: `
    Requirements:
    1. Display user information (name, email, avatar)
    2. Allow avatar upload with preview
    3. Form to update name and bio
    4. Responsive design

    Technical:
    - Use existing UserService for API calls
    - Follow project styling conventions
    - Add unit tests for new components
  `,
  codebase: "D:/my-project",
  verificationUrl: "http://localhost:3000/profile"
});
```

### Code Refactoring

```typescript
await mcp__rubix__god_codex_do({
  description: "Refactor authentication module to use refresh tokens",
  specification: `
    Current state:
    - Auth uses simple access tokens with 1hr expiry
    - Users get logged out frequently

    Desired state:
    - Short-lived access tokens (15 min)
    - Long-lived refresh tokens (7 days)
    - Automatic token refresh
    - Secure token storage

    Constraints:
    - Maintain backward compatibility with existing sessions
    - Don't break current tests
  `,
  codebase: "D:/my-project"
});
```

---

## Advanced Tasks

### With Verification

```typescript
await mcp__rubix__god_codex_do({
  description: "Implement shopping cart with checkout flow",
  specification: `
    Features:
    - Add/remove items
    - Quantity adjustment
    - Price calculation
    - Checkout form
    - Order confirmation
  `,
  codebase: "D:/my-project",
  verificationUrl: "http://localhost:3000/cart",
  constraints: [
    "Use existing ProductService",
    "Follow project design system",
    "Add E2E tests with Playwright"
  ]
});
```

### With Constraints

```typescript
await mcp__rubix__god_codex_do({
  description: "Add email notification system",
  specification: `
    Send emails for:
    - User registration
    - Password reset
    - Order confirmation
    - Weekly digest
  `,
  codebase: "D:/my-project",
  constraints: [
    "Use SendGrid for email delivery",
    "Queue emails for async processing",
    "Add rate limiting",
    "Support HTML and plain text",
    "Include unsubscribe link"
  ]
});
```

---

## Handling Escalations

### Answer Clarification

```typescript
// Check for pending escalations
const status = await mcp__rubix__god_codex_status();

if (status.pendingEscalations.length > 0) {
  const escalation = status.pendingEscalations[0];

  console.log("Escalation:");
  console.log(`  Title: ${escalation.title}`);
  console.log(`  Message: ${escalation.message}`);

  // Show options
  if (escalation.options) {
    console.log("  Options:");
    escalation.options.forEach((opt, i) => {
      console.log(`    ${i + 1}. ${opt.label} - ${opt.description}`);
    });
  }

  // Answer with text
  await mcp__rubix__god_codex_answer({
    escalationId: escalation.id,
    answer: "Use PostgreSQL with Prisma ORM"
  });

  // Or select an option
  await mcp__rubix__god_codex_answer({
    escalationId: escalation.id,
    optionIndex: 0  // First option
  });
}
```

### Answer Decision

```typescript
const status = await mcp__rubix__god_codex_status();

if (status.pendingDecisions.length > 0) {
  const decision = status.pendingDecisions[0];

  console.log(`Decision needed: ${decision.question}`);

  await mcp__rubix__god_codex_decision({
    decisionId: decision.id,
    answer: "Yes, proceed with the migration"
  });
}
```

### Extend Timeout

```typescript
// If you need more time to respond
await mcp__rubix__god_codex_wait({
  minutes: 30  // Add 30 minutes
});
```

---

## Task Management

### Check Status

```typescript
const status = await mcp__rubix__god_codex_status();

console.log(`Status: ${status.status}`);
console.log(`Task: ${status.task?.description}`);

if (status.task?.subtasks) {
  console.log(`Subtasks: ${status.task.subtasks.completed}/${status.task.subtasks.total}`);
}

if (status.currentSubtask) {
  console.log(`Current: ${status.currentSubtask.description}`);
  console.log(`  Type: ${status.currentSubtask.type}`);
  console.log(`  Attempt: ${status.currentSubtask.attempt}`);
}
```

### View Work Log

```typescript
const log = await mcp__rubix__god_codex_log();

console.log("Recent activities:");
for (const entry of log.entries) {
  const time = new Date(entry.timestamp).toLocaleTimeString();
  console.log(`[${time}] ${entry.type}: ${entry.details}`);
}
```

### Cancel Task

```typescript
// If you need to abort
await mcp__rubix__god_codex_cancel();
```

---

## Deep Work Integration

### Focus Session

```typescript
// Start focused session
await mcp__rubix__god_deepwork_start({
  focusLevel: "deep",  // Minimal interruptions
  batchNonUrgent: true,
  allowProgress: false
});

// Submit task
await mcp__rubix__god_codex_do({
  description: "Major refactoring of database layer",
  codebase: "D:/my-project"
});

// Create checkpoints at milestones
await mcp__rubix__god_deepwork_checkpoint({
  summary: "Completed schema migration"
});

// Check session status
const dwStatus = await mcp__rubix__god_deepwork_status();
console.log(`Active time: ${dwStatus.session.activeTime / 60000} minutes`);
```

### Pause and Resume

```typescript
// Take a break
await mcp__rubix__god_deepwork_pause();

// Continue later
await mcp__rubix__god_deepwork_resume();
```

---

## Verification Examples

### Verify After Task

```typescript
// Task completes
const status = await mcp__rubix__god_codex_status();

if (status.status === "completed") {
  // Verify the result
  const verify = await mcp__rubix__god_pw_verify({
    url: "http://localhost:3000",
    screenshot: true,
    checkConsole: true,
    assertVisible: ["#new-feature", ".success-message"]
  });

  if (verify.consoleErrors > 0) {
    console.error("Implementation has errors!");
  }

  if (verify.assertions.failed > 0) {
    console.error("Some elements not visible!");
  }
}
```

### Manual Browser Testing

```typescript
// Launch browser for manual inspection
const session = await mcp__rubix__god_pw_launch({
  headless: false,  // Visible browser
  viewport: { width: 1920, height: 1080 }
});

await mcp__rubix__god_pw_navigate({
  sessionId: session.sessionId,
  url: "http://localhost:3000/new-feature"
});

// Interact and test
await mcp__rubix__god_pw_action({
  sessionId: session.sessionId,
  selector: "#test-button",
  action: "click"
});

// Screenshot
await mcp__rubix__god_pw_screenshot({
  sessionId: session.sessionId,
  fullPage: true,
  label: "after-click"
});

// Check console
const console = await mcp__rubix__god_pw_console({
  sessionId: session.sessionId
});

if (console.errorCount > 0) {
  console.error("Console errors found:", console.errors);
}

// Close
await mcp__rubix__god_pw_close({
  sessionId: session.sessionId
});
```

---

## Code Review

### Review After Task

```typescript
// After task completes, review changes
const review = await mcp__rubix__god_review({
  files: ["src/features/new-feature/**/*.ts"],
  type: "full"
});

console.log(`Issues found: ${review.summary.issueCount}`);

if (review.summary.bySeverity.critical > 0) {
  console.error("Critical issues need attention!");
  for (const issue of review.issues) {
    if (issue.severity === "critical") {
      console.error(`${issue.file}:${issue.line} - ${issue.message}`);
    }
  }
}
```

### Security Review

```typescript
const security = await mcp__rubix__god_security_review({
  files: ["src/**/*.ts"]
});

if (security.summary.critical > 0 || security.summary.high > 0) {
  console.error("Security vulnerabilities found!");
  for (const vuln of security.vulnerabilities) {
    console.error(`[${vuln.severity}] ${vuln.title}`);
    console.error(`  ${vuln.file}:${vuln.line}`);
    console.error(`  ${vuln.recommendation}`);
  }
}
```

---

## Complete Task Workflow

```typescript
async function executeTask(description: string, codebase: string) {
  // 1. Start deep work session
  await mcp__rubix__god_deepwork_start({
    focusLevel: "normal"
  });

  try {
    // 2. Submit task
    console.log("Starting task:", description);
    await mcp__rubix__god_codex_do({
      description,
      codebase,
      verificationUrl: "http://localhost:3000"
    });

    // 3. Monitor progress
    let status;
    do {
      await sleep(5000);
      status = await mcp__rubix__god_codex_status();

      // Handle escalations
      if (status.pendingEscalations.length > 0) {
        console.log("Escalation needed - check Telegram");
      }

      // Log progress
      if (status.currentSubtask) {
        console.log(`Working on: ${status.currentSubtask.description}`);
      }
    } while (status.status === "running");

    // 4. Check result
    if (status.status === "completed") {
      console.log("Task completed!");

      // 5. Verify result
      const verify = await mcp__rubix__god_pw_verify({
        url: "http://localhost:3000",
        checkConsole: true
      });

      // 6. Code review
      const review = await mcp__rubix__god_review({
        files: ["src/**/*.ts"],
        type: "quick"
      });

      console.log(`Console errors: ${verify.consoleErrors}`);
      console.log(`Code issues: ${review.summary.issueCount}`);

    } else {
      console.error(`Task failed: ${status.status}`);
    }

    // 7. Get work log
    const log = await mcp__rubix__god_codex_log();
    console.log(`Completed ${log.entries.length} activities`);

  } finally {
    // Session ends automatically
  }
}

// Usage
await executeTask(
  "Add user search functionality",
  "D:/my-project"
);
```

## Next Steps

- [Integration Examples](integration-examples.md) - Integration patterns
- [CODEX Tools](../tools/codex-tools.md) - Complete reference
- [Playwright Tools](../tools/playwright-tools.md) - Browser automation
