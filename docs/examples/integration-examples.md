# Integration Examples

Patterns for integrating RUBIX/god-agent into workflows.

## CI/CD Integration

### Pre-Commit Hook

```bash
#!/bin/bash
# .git/hooks/pre-commit

# Get staged files
FILES=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(ts|tsx|js|jsx)$')

if [ -n "$FILES" ]; then
  echo "Running RUBIX quick review..."

  # Run quick review
  node -e "
    const files = '$FILES'.split('\n');
    const result = await mcp__rubix__god_quick_review({ files });

    if (!result.passed) {
      console.error('Pre-commit check failed!');
      console.error('Critical issues:', result.criticalIssues);
      console.error('High issues:', result.highIssues);
      process.exit(1);
    }
  "

  if [ $? -ne 0 ]; then
    echo "Fix issues before committing."
    exit 1
  fi
fi
```

### GitHub Actions

```yaml
# .github/workflows/rubix-review.yml
name: RUBIX Code Review

on:
  pull_request:
    types: [opened, synchronize]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Get changed files
        id: changed
        uses: tj-actions/changed-files@v41
        with:
          files: |
            **/*.ts
            **/*.tsx

      - name: Run RUBIX Security Review
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          npm install @rubix/god-agent

          node << 'EOF'
          const changedFiles = '${{ steps.changed.outputs.all_changed_files }}'.split(' ');

          const security = await mcp__rubix__god_security_review({
            files: changedFiles
          });

          if (security.summary.critical > 0) {
            console.error('Critical security issues found!');
            process.exit(1);
          }

          if (security.summary.high > 0) {
            console.warn('High severity issues found');
          }

          console.log('Security review passed');
          EOF
```

---

## Slack Integration

### Notification Bot

```typescript
// slack-bot.ts
import { App } from '@slack/bolt';

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET
});

// Configure RUBIX notifications to Slack
await mcp__rubix__god_notify_slack({
  webhookUrl: process.env.SLACK_WEBHOOK,
  channel: "#rubix-alerts"
});

// Listen for task requests
app.message(/rubix task: (.+)/i, async ({ message, say, context }) => {
  const taskDescription = context.matches[1];

  await say(`Starting task: ${taskDescription}`);

  // Submit to RUBIX
  await mcp__rubix__god_codex_do({
    description: taskDescription,
    codebase: process.env.CODEBASE_PATH
  });

  // Monitor and report
  let status;
  do {
    await sleep(10000);
    status = await mcp__rubix__god_codex_status();
  } while (status.status === "running");

  await say(`Task ${status.status}: ${taskDescription}`);
});

app.start(3000);
```

---

## Telegram Bot

### Standalone Bot

```typescript
// telegram-standalone.ts
import { TelegramBot } from './telegram/TelegramBot';

const bot = new TelegramBot({
  token: process.env.TELEGRAM_BOT_TOKEN,
  allowedUsers: [parseInt(process.env.TELEGRAM_USER_ID)]
});

// Handle /task command
bot.on('task', async (ctx) => {
  const description = ctx.message.text.replace('/task ', '');

  await ctx.reply(`Starting: ${description}`);

  await mcp__rubix__god_codex_do({
    description,
    codebase: process.env.CODEBASE_PATH
  });
});

// Handle escalations
bot.on('escalation', async (ctx, escalation) => {
  // Format options as inline keyboard
  const keyboard = escalation.options.map((opt, i) => ([
    { text: opt.label, callback_data: `escalation:${escalation.id}:${i}` }
  ]));

  await ctx.reply(
    `🚨 ${escalation.title}\n\n${escalation.message}`,
    { reply_markup: { inline_keyboard: keyboard } }
  );
});

bot.start();
```

---

## VS Code Extension

### Extension Integration

```typescript
// vscode-extension.ts
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  // Register command
  const submitTask = vscode.commands.registerCommand(
    'rubix.submitTask',
    async () => {
      const description = await vscode.window.showInputBox({
        prompt: 'Describe the task',
        placeHolder: 'Fix the login button...'
      });

      if (!description) return;

      // Submit to RUBIX
      await mcp__rubix__god_codex_do({
        description,
        codebase: vscode.workspace.rootPath
      });

      vscode.window.showInformationMessage('Task submitted to RUBIX');

      // Show status in status bar
      const statusBar = vscode.window.createStatusBarItem();
      statusBar.text = '$(sync~spin) RUBIX working...';
      statusBar.show();

      // Monitor
      let status;
      do {
        await sleep(5000);
        status = await mcp__rubix__god_codex_status();
        statusBar.text = `$(sync~spin) RUBIX: ${status.currentSubtask?.description || 'working'}`;
      } while (status.status === "running");

      statusBar.text = `$(check) RUBIX: ${status.status}`;
      setTimeout(() => statusBar.dispose(), 5000);
    }
  );

  context.subscriptions.push(submitTask);
}
```

---

## API Server

### REST API Wrapper

```typescript
// api-server.ts
import express from 'express';

const app = express();
app.use(express.json());

// Submit task endpoint
app.post('/api/tasks', async (req, res) => {
  const { description, codebase } = req.body;

  try {
    const task = await mcp__rubix__god_codex_do({
      description,
      codebase
    });

    res.json({ taskId: task.taskId, status: 'submitted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get status endpoint
app.get('/api/tasks/status', async (req, res) => {
  const status = await mcp__rubix__god_codex_status();
  res.json(status);
});

// Query memory endpoint
app.post('/api/memory/query', async (req, res) => {
  const { query, topK = 10 } = req.body;

  const results = await mcp__rubix__god_query({
    query,
    topK
  });

  res.json(results);
});

// Store memory endpoint
app.post('/api/memory/store', async (req, res) => {
  const { content, tags, importance } = req.body;

  const entry = await mcp__rubix__god_store({
    content,
    tags,
    importance,
    source: 'external'
  });

  res.json({ id: entry.id });
});

app.listen(3000);
```

---

## Scheduled Tasks

### Cron-Based Automation

```typescript
// scheduled-tasks.ts

// Daily code review at 9 AM
await mcp__rubix__god_schedule({
  name: "Daily Code Review",
  prompt: "Review all changes from yesterday. Context: {context}",
  trigger: {
    type: "cron",
    pattern: "0 9 * * 1-5"  // 9 AM Mon-Fri
  },
  contextQuery: "recent code changes"
});

// Weekly security scan on Sundays
await mcp__rubix__god_schedule({
  name: "Weekly Security Scan",
  prompt: "Run security review on all source files",
  trigger: {
    type: "cron",
    pattern: "0 2 * * 0"  // 2 AM Sunday
  }
});

// Event-triggered analysis
await mcp__rubix__god_schedule({
  name: "PR Analysis",
  prompt: "Analyze the pull request for issues. Context: {context}",
  trigger: {
    type: "event",
    event: "pr_opened"
  }
});

// Trigger the event
await mcp__rubix__god_trigger({
  event: "pr_opened"
});
```

---

## Monitoring Dashboard

### Status Dashboard

```typescript
// dashboard.ts
import { Server } from 'socket.io';

const io = new Server(3001);

// Emit status updates
setInterval(async () => {
  const [memStats, learnStats, taskStatus] = await Promise.all([
    mcp__rubix__god_stats(),
    mcp__rubix__god_learning_stats(),
    mcp__rubix__god_codex_status()
  ]);

  io.emit('status', {
    memory: memStats,
    learning: learnStats,
    task: taskStatus,
    timestamp: Date.now()
  });
}, 5000);

// Dashboard frontend
const html = `
<!DOCTYPE html>
<html>
<head><title>RUBIX Dashboard</title></head>
<body>
  <div id="memory">
    <h2>Memory</h2>
    <p>Entries: <span id="entries">-</span></p>
    <p>Vectors: <span id="vectors">-</span></p>
  </div>

  <div id="task">
    <h2>Current Task</h2>
    <p>Status: <span id="task-status">-</span></p>
    <p>Progress: <span id="progress">-</span></p>
  </div>

  <script src="/socket.io/socket.io.js"></script>
  <script>
    const socket = io();
    socket.on('status', (data) => {
      document.getElementById('entries').textContent = data.memory.totalEntries;
      document.getElementById('vectors').textContent = data.memory.vectorCount;
      document.getElementById('task-status').textContent = data.task.status || 'idle';
      if (data.task.task?.subtasks) {
        const { completed, total } = data.task.task.subtasks;
        document.getElementById('progress').textContent = completed + '/' + total;
      }
    });
  </script>
</body>
</html>
`;
```

---

## Knowledge Base Sync

### Sync from External Sources

```typescript
// sync-knowledge.ts

// Sync from Notion
async function syncNotion() {
  const pages = await notionClient.search({ query: '' });

  for (const page of pages.results) {
    const content = await notionClient.blocks.children.list({
      block_id: page.id
    });

    await mcp__rubix__god_store({
      content: extractText(content),
      tags: ['notion', 'documentation'],
      source: 'external',
      importance: 0.7
    });
  }
}

// Sync from Confluence
async function syncConfluence() {
  const spaces = await confluenceClient.getSpaces();

  for (const space of spaces) {
    const pages = await confluenceClient.getPages(space.key);

    for (const page of pages) {
      await mcp__rubix__god_store({
        content: page.body,
        tags: ['confluence', space.key],
        source: 'external'
      });
    }
  }
}

// Run sync daily
await mcp__rubix__god_schedule({
  name: "Knowledge Sync",
  prompt: "Sync knowledge from external sources",
  trigger: {
    type: "cron",
    pattern: "0 3 * * *"  // 3 AM daily
  }
});
```

---

## Testing Integration

### Jest Integration

```typescript
// jest.setup.ts
import { beforeAll, afterAll } from '@jest/globals';

beforeAll(async () => {
  // Initialize RUBIX for testing
  await mcp__rubix__god_containment_config({
    enabled: true,
    projectRoot: process.cwd(),
    defaultPermission: "read-write"
  });
});

// test/integration.test.ts
describe('RUBIX Integration', () => {
  it('should store and query memory', async () => {
    const entry = await mcp__rubix__god_store({
      content: 'Test content',
      tags: ['test']
    });

    const results = await mcp__rubix__god_query({
      query: 'test content',
      topK: 1
    });

    expect(results.results[0].id).toBe(entry.id);
  });

  it('should trace provenance', async () => {
    const parent = await mcp__rubix__god_store({
      content: 'Parent entry',
      source: 'user_input'
    });

    const child = await mcp__rubix__god_store({
      content: 'Child entry',
      parentIds: [parent.id]
    });

    const trace = await mcp__rubix__god_trace({
      entryId: child.id
    });

    expect(trace.parents).toContain(parent.id);
    expect(trace.lScore).toBeLessThan(1);
  });
});
```

## Next Steps

- [Basic Usage](basic-usage.md) - Getting started
- [Task Examples](task-examples.md) - CODEX examples
- [Tools Overview](../tools/index.md) - Complete tool reference
