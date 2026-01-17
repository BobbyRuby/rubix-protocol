# Examples

Practical examples for using RUBIX/god-agent.

## Example Categories

| Category | Description |
|----------|-------------|
| [Basic Usage](basic-usage.md) | Getting started examples |
| [Task Examples](task-examples.md) | RUBIX task execution |
| [Integration Examples](integration-examples.md) | Integration patterns |

---

## Quick Start Examples

### Store and Query Memory

```typescript
// Store information
await mcp__rubix__god_store({
  content: "The authentication module uses JWT tokens with 1-hour expiration",
  tags: ["auth", "jwt", "security"],
  importance: 0.8,
  source: "agent_inference"
});

// Query memory
const results = await mcp__rubix__god_query({
  query: "how does authentication work?",
  topK: 5
});
```

### Submit a Task

```typescript
// Submit task to RUBIX
const task = await mcp__rubix__god_codex_do({
  description: "Add input validation to the user registration form",
  codebase: "D:/my-project",
  verificationUrl: "http://localhost:3000/register"
});

// Check status
const status = await mcp__rubix__god_codex_status();
```

### Verify a URL

```typescript
// Quick verification
const result = await mcp__rubix__god_pw_verify({
  url: "http://localhost:3000",
  assertVisible: ["#header", "#login-button", "#footer"]
});

console.log(`Errors: ${result.consoleErrors}`);
console.log(`Assertions: ${result.assertions.passed}/${result.assertions.passed + result.assertions.failed}`);
```

---

## Memory Examples

### With Provenance

```typescript
// Store with parent reference
const parent = await mcp__rubix__god_store({
  content: "User service handles authentication",
  source: "user_input"
});

const child = await mcp__rubix__god_store({
  content: "Auth uses JWT with RS256 signing",
  parentIds: [parent.id],  // Links to parent
  source: "agent_inference"
});

// Trace provenance
const trace = await mcp__rubix__god_trace({
  entryId: child.id
});
// Shows L-Score calculated from parent
```

### With Causal Relations

```typescript
// Store related entries
const cause = await mcp__rubix__god_store({
  content: "Memory leak in worker thread",
  tags: ["bug", "memory"]
});

const effect = await mcp__rubix__god_store({
  content: "Application crashes after 24 hours",
  tags: ["bug", "crash"]
});

// Create causal link
await mcp__rubix__god_causal({
  sourceIds: [cause.id],
  targetIds: [effect.id],
  type: "causes",
  strength: 0.9
});

// Find causal paths
const paths = await mcp__rubix__god_find_paths({
  sourceId: cause.id,
  targetId: effect.id
});
```

---

## Learning Examples

### Feedback Loop

```typescript
// Query memory
const results = await mcp__rubix__god_query({
  query: "best practices for error handling"
});

// Evaluate results quality
// If results were useful:
await mcp__rubix__god_learn({
  trajectoryId: results.trajectoryId,
  quality: 0.9  // High quality
});

// If results were poor:
await mcp__rubix__god_learn({
  trajectoryId: results.trajectoryId,
  quality: 0.2  // Low quality
});
```

### Route Selection

```typescript
// Get routing recommendation
const route = await mcp__rubix__god_route({
  query: "what caused the authentication failure?"
});

console.log(`Recommended: ${route.route}`);
console.log(`Confidence: ${route.confidence}`);

// Execute query with recommended route
// ... execute query ...

// Report success/failure
await mcp__rubix__god_route_result({
  route: route.route,
  success: true
});
```

---

## CODEX Examples

### Basic Task

```typescript
// Submit simple task
await mcp__rubix__god_codex_do({
  description: "Fix the login button not working on mobile",
  codebase: "D:/my-project"
});

// Wait for completion
let status;
do {
  await sleep(5000);
  status = await mcp__rubix__god_codex_status();
} while (status.status === "running");

console.log(`Result: ${status.status}`);
```

### With Specification

```typescript
await mcp__rubix__god_codex_do({
  description: "Implement user profile page",
  specification: `
    Requirements:
    - Display user avatar, name, email
    - Show recent activity list
    - Add "Edit Profile" button
    - Responsive design for mobile

    Technical:
    - Use existing UserService
    - Follow project CSS conventions
    - Add unit tests
  `,
  codebase: "D:/my-project",
  verificationUrl: "http://localhost:3000/profile"
});
```

### Handle Escalations

```typescript
// Check for escalations
const status = await mcp__rubix__god_codex_status();

if (status.pendingEscalations.length > 0) {
  const escalation = status.pendingEscalations[0];

  console.log(`Escalation: ${escalation.title}`);
  console.log(`Message: ${escalation.message}`);
  console.log(`Options:`, escalation.options);

  // Answer the escalation
  await mcp__rubix__god_codex_answer({
    escalationId: escalation.id,
    answer: "Use PostgreSQL for the database"
  });
}
```

---

## Browser Automation Examples

### Login Flow Test

```typescript
// Launch browser
const session = await mcp__rubix__god_pw_launch({
  browser: "chromium",
  headless: true
});

try {
  // Navigate to login
  await mcp__rubix__god_pw_navigate({
    sessionId: session.sessionId,
    url: "http://localhost:3000/login"
  });

  // Fill form
  await mcp__rubix__god_pw_action({
    sessionId: session.sessionId,
    selector: "#email",
    action: "fill",
    value: "test@example.com"
  });

  await mcp__rubix__god_pw_action({
    sessionId: session.sessionId,
    selector: "#password",
    action: "fill",
    value: "password123"
  });

  // Screenshot before submit
  await mcp__rubix__god_pw_screenshot({
    sessionId: session.sessionId,
    label: "before-login"
  });

  // Click login
  await mcp__rubix__god_pw_action({
    sessionId: session.sessionId,
    selector: "#login-button",
    action: "click"
  });

  // Assert redirect
  await mcp__rubix__god_pw_assert({
    sessionId: session.sessionId,
    type: "url",
    expected: "http://localhost:3000/dashboard"
  });

  // Check for console errors
  const console = await mcp__rubix__god_pw_console({
    sessionId: session.sessionId
  });

  if (console.errorCount > 0) {
    console.error("Login had console errors!");
  }

} finally {
  await mcp__rubix__god_pw_close({
    sessionId: session.sessionId
  });
}
```

---

## Configuration Examples

### Setup Notifications

```typescript
// Configure Slack
await mcp__rubix__god_notify_slack({
  webhookUrl: process.env.SLACK_WEBHOOK,
  channel: "#dev-alerts",
  username: "RUBIX Bot"
});

// Configure preferences
await mcp__rubix__god_notify_preferences({
  onComplete: true,
  onBlocked: true,
  onError: true,
  minUrgency: "normal"
});

// Test configuration
await mcp__rubix__god_notify_test();
```

### Setup Communication Channels

```typescript
// Configure Telegram (primary)
await mcp__rubix__god_comms_setup({
  mode: "set",
  channel: "telegram",
  config: { chatId: process.env.TELEGRAM_CHAT_ID }
});

// Configure Slack (backup)
await mcp__rubix__god_comms_setup({
  mode: "set",
  channel: "slack",
  config: { webhookUrl: process.env.SLACK_WEBHOOK }
});

// Set fallback order
await mcp__rubix__god_comms_setup({
  mode: "order",
  fallbackOrder: ["telegram", "slack", "email"]
});

// Test all channels
await mcp__rubix__god_comms_setup({ mode: "test" });
```

---

## Deep Work Examples

### Focus Session

```typescript
// Start deep work session
await mcp__rubix__god_deepwork_start({
  focusLevel: "deep",
  batchNonUrgent: true,
  allowProgress: false
});

// Submit task
await mcp__rubix__god_codex_do({
  description: "Refactor authentication module",
  codebase: "D:/my-project"
});

// Create checkpoint at milestone
await mcp__rubix__god_deepwork_checkpoint({
  summary: "Completed token refresh implementation"
});

// Check status
const status = await mcp__rubix__god_deepwork_status();
console.log(`Active time: ${status.session.activeTime / 60000} minutes`);
```

## Next Steps

- [Basic Usage](basic-usage.md) - Step-by-step basics
- [Task Examples](task-examples.md) - More CODEX examples
- [Integration Examples](integration-examples.md) - Integration patterns
