# Scheduler Tools

Tools for scheduling tasks for future execution.

## Tool Reference

| Tool | Purpose |
|------|---------|
| [god_schedule](#god_schedule) | Schedule task |
| [god_trigger](#god_trigger) | Trigger task/event |
| [god_tasks](#god_tasks) | List tasks |
| [god_pause](#god_pause) | Pause task |
| [god_resume](#god_resume) | Resume task |
| [god_cancel](#god_cancel) | Cancel task |
| [god_scheduler_stats](#god_scheduler_stats) | Get statistics |

---

## god_schedule

Schedule a task for future execution.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | Task name |
| `prompt` | string | Yes | Task prompt (use `{context}` for memory) |
| `trigger` | object | Yes | Trigger configuration |
| `description` | string | No | Optional description |
| `priority` | number | No | Priority 1-10 |
| `contextIds` | string[] | No | Memory IDs for context |
| `contextQuery` | string | No | Query for fresh context |
| `notification` | object | No | Notification settings |

### Trigger Types

| Type | Description | Config |
|------|-------------|--------|
| `datetime` | Execute at specific time | `at: "ISO datetime"` |
| `cron` | Execute on schedule | `pattern: "cron expression"` |
| `event` | Execute when event fires | `event: "event_name"` |
| `file` | Execute when file changes | `path: "file/path"` |
| `manual` | Execute only when triggered | - |

### Cron Pattern Examples

| Pattern | Description |
|---------|-------------|
| `0 8 * * 1-5` | 8 AM weekdays |
| `0 */4 * * *` | Every 4 hours |
| `0 0 * * 0` | Midnight Sundays |
| `*/15 * * * *` | Every 15 minutes |
| `0 9,17 * * *` | 9 AM and 5 PM |

### Response

```json
{
  "success": true,
  "taskId": "task_abc123...",
  "name": "Morning analysis",
  "trigger": {
    "type": "cron",
    "pattern": "0 8 * * 1-5"
  },
  "nextRun": "2024-01-16T08:00:00Z"
}
```

### Examples

```typescript
// Daily analysis at 8 AM weekdays
await mcp__rubix__god_schedule({
  name: "Morning analysis",
  prompt: "Analyze overnight developments. Context: {context}",
  trigger: { type: "cron", pattern: "0 8 * * 1-5" },
  contextQuery: "recent market events",
  priority: 8
});

// One-time execution
await mcp__rubix__god_schedule({
  name: "Deploy reminder",
  prompt: "Remind to check deployment status",
  trigger: {
    type: "datetime",
    at: "2024-01-20T14:00:00Z"
  }
});

// Event-triggered
await mcp__rubix__god_schedule({
  name: "Post-trading analysis",
  prompt: "Analyze today's trades. Context: {context}",
  trigger: { type: "event", event: "trading_complete" },
  contextQuery: "today's trading activity"
});

// File watcher
await mcp__rubix__god_schedule({
  name: "Config reload",
  prompt: "Configuration changed, reload settings",
  trigger: { type: "file", path: "config/settings.yaml" }
});
```

---

## god_trigger

Manually trigger a scheduled task or fire an event.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `taskId` | string | No | Task ID to trigger directly |
| `event` | string | No | Event name to fire |

One of `taskId` or `event` must be provided.

### Response

```json
{
  "success": true,
  "triggered": {
    "type": "event",
    "event": "trading_complete",
    "tasksTriggered": 3
  }
}
```

### Examples

```typescript
// Trigger specific task immediately
await mcp__rubix__god_trigger({
  taskId: "task_abc123"
});

// Fire event (triggers all listening tasks)
await mcp__rubix__god_trigger({
  event: "trading_complete"
});
```

---

## god_tasks

List scheduled tasks.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `status` | enum | No | Filter by status (default: "all") |
| `limit` | number | No | Max results (default: 100) |

### Status Values

| Status | Description |
|--------|-------------|
| `pending` | Waiting for trigger |
| `running` | Currently executing |
| `completed` | Finished successfully |
| `failed` | Errored |
| `paused` | Temporarily suspended |
| `cancelled` | Cancelled |
| `all` | All tasks |

### Response

```json
{
  "success": true,
  "tasks": [
    {
      "id": "task_abc123",
      "name": "Morning analysis",
      "status": "pending",
      "trigger": {
        "type": "cron",
        "pattern": "0 8 * * 1-5"
      },
      "lastRun": "2024-01-15T08:00:00Z",
      "nextRun": "2024-01-16T08:00:00Z",
      "runCount": 15,
      "priority": 8
    }
  ],
  "total": 10
}
```

### Example

```typescript
// List all pending tasks
const pending = await mcp__rubix__god_tasks({
  status: "pending"
});

// List failed tasks
const failed = await mcp__rubix__god_tasks({
  status: "failed",
  limit: 10
});
```

---

## god_pause

Pause a scheduled task.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `taskId` | string | Yes | Task ID to pause |

### Response

```json
{
  "success": true,
  "taskId": "task_abc123",
  "status": "paused",
  "message": "Task paused. Use god_resume to continue."
}
```

### Example

```typescript
await mcp__rubix__god_pause({
  taskId: "task_abc123"
});
```

---

## god_resume

Resume a paused task.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `taskId` | string | Yes | Task ID to resume |

### Response

```json
{
  "success": true,
  "taskId": "task_abc123",
  "status": "pending",
  "nextRun": "2024-01-16T08:00:00Z"
}
```

---

## god_cancel

Cancel a scheduled task.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `taskId` | string | Yes | Task ID to cancel |

### Response

```json
{
  "success": true,
  "taskId": "task_abc123",
  "status": "cancelled",
  "message": "Task cancelled permanently."
}
```

### Note

Cancelled tasks remain in history but won't execute. Use `god_pause` for temporary suspension.

---

## god_scheduler_stats

Get scheduler statistics.

### Parameters

None.

### Response

```json
{
  "success": true,
  "taskCounts": {
    "pending": 15,
    "running": 1,
    "completed": 500,
    "failed": 12,
    "paused": 3,
    "cancelled": 5
  },
  "runHistory": {
    "last24h": 48,
    "last7d": 320,
    "total": 536
  },
  "avgRunDurationMs": 15000,
  "eventsInQueue": 2
}
```

---

## Workflow Examples

### Daily Reporting

```typescript
// Schedule daily report
await mcp__rubix__god_schedule({
  name: "Daily report",
  prompt: `Generate daily summary report.

Context from memory:
{context}

Include:
1. Key events
2. Metrics changes
3. Anomalies detected`,
  trigger: { type: "cron", pattern: "0 18 * * 1-5" },
  contextQuery: "today's events and metrics",
  notification: {
    onComplete: true,
    onFailure: true
  }
});
```

### Event-Driven Analysis

```typescript
// Create event-triggered tasks
await mcp__rubix__god_schedule({
  name: "Error alert analysis",
  prompt: "Analyze new error alert. Context: {context}",
  trigger: { type: "event", event: "error_alert" },
  contextQuery: "recent errors",
  priority: 10
});

// Later, trigger the event
await mcp__rubix__god_trigger({
  event: "error_alert"
});
```

### File-Based Triggers

```typescript
// Watch for config changes
await mcp__rubix__god_schedule({
  name: "Config watcher",
  prompt: "Configuration file changed. Validate and reload.",
  trigger: { type: "file", path: "config/app.yaml" }
});
```

### Maintenance Tasks

```typescript
// Weekly cleanup
await mcp__rubix__god_schedule({
  name: "Weekly cleanup",
  prompt: "Perform weekly maintenance: prune old data, optimize indexes",
  trigger: { type: "cron", pattern: "0 3 * * 0" },  // 3 AM Sunday
  priority: 5
});
```

---

## Best Practices

### 1. Use Context Queries

```typescript
// Good - fetches fresh context
contextQuery: "recent market events"

// Also good - uses specific entries
contextIds: ["entry_123", "entry_456"]
```

### 2. Set Appropriate Priorities

| Priority | Use Case |
|----------|----------|
| 9-10 | Critical alerts, urgent analysis |
| 7-8 | Important scheduled tasks |
| 5-6 | Regular maintenance |
| 1-4 | Low-priority background tasks |

### 3. Enable Notifications

```typescript
notification: {
  onComplete: true,   // Notify when done
  onFailure: true,    // Notify on error
  onDecision: true    // Notify if needs input
}
```

## Next Steps

- [CODEX Tools](codex-tools.md) - Task execution
- [Deep Work Tools](deepwork-tools.md) - Focus mode
- [Notification Tools](notification-tools.md) - Notifications
