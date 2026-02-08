# Telegram Bot Guide

Interactive bot interface for RUBIX task management.

## Location

`src/telegram/TelegramHandler.ts`, `src/telegram/TelegramBot.ts`

## Session Modes (Required)

All messages require an active session mode. The bot uses **strict mode enforcement**:

```
                         /task
    +------------------------------------------+
    |                                          |
    v                                          |
+-------+  /plan   +-------+  /conversation  +-------+
| NONE  | -------->| PLAN  | <-------------->| CHAT  |
+-------+          +-------+                 +-------+
    ^                  |                         |
    |       /exit      |         /exit           |
    +------------------+-------------------------+
```

**No mode = error message prompting user to choose a command.**

When sending a message without an active mode, you'll receive:

```
Please start with a command:

* `/plan <description>` - Start planning
* `/task <description>` - Execute immediately
* `/conversation` - Start chat mode

Use `/help` for more options.
```

---

## Commands Reference

### Starting a Mode

| Command | Description | Mode Set |
|---------|-------------|----------|
| `/conversation` | Start casual chat mode | `conversation` |
| `/plan <desc>` | Start planning session | `plan` |
| `/task <desc>` | Execute task immediately | `task` (transient) |

### Mode Control

| Command | Description |
|---------|-------------|
| `/exit` | Leave current mode |
| `/rubixallize` | Convert conversation to plan |

### Planning Commands

| Command | Description |
|---------|-------------|
| `/plans` | List recent sessions |
| `/plans all` | List all sessions |
| `/resume` | Resume last session |
| `/resume N` | Resume session #N |
| `/delete N` | Delete session #N |
| `/plan-status` | Current plan details |
| `/execute` | Preview & run plan |
| `/cancel` | Abandon current session |

### Task Commands

| Command | Description |
|---------|-------------|
| `/status` | Check running tasks |
| `/wait` | Extend escalation timeout 10 min |
| `/wait N` | Extend by N minutes |

### System Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message |
| `/help` | Full help |
| `/setproject <path>` | Set working directory |
| `/whereami` | Show current context |
| `/config` | Show configuration |
| `/paths` | Show allowed paths |
| `/path-add <path> rw` | Add path access |
| `/path-remove <pattern>` | Remove access |
| `/restart` | Restart RUBIX |

---

## Workflows

### Conversation -> Plan -> Execute

1. `/conversation` - Enter chat mode
2. Discuss your idea freely
3. `/rubixallize` - Convert to plan
4. `/execute` - Run the plan

### Direct Planning

1. `/plan Build a REST API` - Start with description
2. Refine requirements with bot
3. `/execute` - Approve and run

### Immediate Execution

1. `/task Fix the login bug` - Run immediately
2. `/status` - Monitor progress
3. Respond to escalations if needed

---

## Session Mode Details

### None Mode (Default)

When no mode is active, the bot only accepts mode-starting commands. Any other message will prompt the user to select a mode.

### Conversation Mode

- Free-form discussion with the AI
- Context is maintained throughout the conversation
- Use `/rubixallize` to convert ideas into an actionable plan
- Use `/exit` to end the conversation

### Plan Mode

- Structured planning session
- Plan is refined through dialogue
- View plan status with `/plan-status`
- Execute with `/execute` when ready
- Cancel with `/cancel` to discard

### Task Mode (Transient)

- One-shot execution mode
- Immediately starts RUBIX TaskExecutor
- Returns to `none` mode after completion
- Monitor with `/status`

---

## Error Messages

### No Mode Set

```
Please start with a command:

* `/plan <description>` - Start planning
* `/task <description>` - Execute immediately
* `/conversation` - Start chat mode

Use `/help` for more options.
```

### No Session to Exit

```
No active session to exit.
```

### Session Already Active

```
You already have an active {mode} session. Use /exit to leave first.
```

---

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | Bot API token (from @BotFather) |
| `TELEGRAM_CHAT_ID` | No | Your chat ID (for escalations) |
| `TELEGRAM_DEBUG` | No | Set to 'true' for debug logs |

### Getting Your Bot Token

1. Open Telegram and search for `@BotFather`
2. Send `/newbot` and follow the prompts
3. Copy the token provided
4. Set `TELEGRAM_BOT_TOKEN` environment variable

### Getting Your Chat ID

1. Start a conversation with your bot
2. Send any message
3. Visit: `https://api.telegram.org/bot<TOKEN>/getUpdates`
4. Find your `chat.id` in the response

---

## Architecture

### Component Interaction

```
User Message
    |
    v
TelegramBot.ts (receives message)
    |
    v
TelegramHandler.ts (processes message)
    |
    +----> Mode Check: Is mode active?
    |           |
    |           +-- No --> Send mode selection prompt
    |           |
    |           +-- Yes --> Route to handler
    |                           |
    +---------------------------+
    |
    v
Handler based on mode:
  - conversation: ConversationSession
  - plan: PlanningSession
  - task: TaskExecutor
```

### Session Storage

Sessions are stored in memory with optional persistence:
- Active session mode per chat
- Conversation history
- Planning context
- Task state

---

## Integration with RUBIX

The Telegram bot can trigger full RUBIX task execution:

```typescript
// User sends: /task Build a REST API for user management

// TelegramHandler calls:
await taskExecutor.execute({
  description: "Build a REST API for user management",
  codebase: config.projectPath
});

// Progress updates sent back to Telegram
// Escalations appear as interactive messages
```

### Escalation Responses

When RUBIX needs input during task execution:

```
RUBIX Escalation

Type: Decision
Title: Database Choice

Which database should I use?

1. PostgreSQL
2. MongoDB
3. SQLite

Reply with a number or custom answer:
```

---

## Best Practices

### Session Management

1. **Always start with a command** - Don't send bare messages
2. **Exit cleanly** - Use `/exit` when done
3. **One session at a time** - Exit before starting new mode

### Planning

1. **Be specific** - Include context in `/plan` description
2. **Iterate** - Refine through conversation
3. **Review before execute** - Use `/plan-status` first

### Task Execution

1. **Monitor progress** - Check `/status` periodically
2. **Respond quickly** - Escalations have timeouts
3. **Use `/wait`** - Extend timeout if needed

---

## Troubleshooting

### Bot Not Responding

1. Check `TELEGRAM_BOT_TOKEN` is set correctly
2. Verify bot is started in the application logs
3. Ensure network connectivity to Telegram API

### Commands Not Working

1. Verify you're in the correct mode
2. Check command syntax (case-sensitive)
3. Use `/help` to see available commands

### Sessions Lost

Sessions are stored in memory by default. If the bot restarts:
1. Use `/plans` to see saved planning sessions
2. Use `/resume` to continue where you left off

---

## Related

- [CommunicationManager](communication-manager.md) - Escalation system
- [Communication Tools](../tools/communication-tools.md) - MCP tools
- [TaskExecutor](../codex/task-executor.md) - Task execution
