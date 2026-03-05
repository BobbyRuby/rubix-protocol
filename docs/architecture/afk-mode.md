# AFK Mode

Turns Telegram into a full remote control for Claude Code. When AFK is active, all tool permission requests, questions, and notifications route through your phone instead of the CLI.

## How It Works

```
                    AFK OFF (default)          AFK ON
                    ─────────────────          ──────
Permission request  CLI keyboard prompt    →   Telegram Allow/Deny buttons
Questions           AskUserQuestion (CLI)  →   Telegram message + wait
Notifications       Desktop/silent         →   Telegram forward
Escalation          CLI fallback           →   Telegram first
```

## State

Stored in `data/afk-state.json`:

```json
{ "afk": true, "since": "2026-03-05T22:00:00Z" }
```

## Toggle Methods

| Method | Command |
|--------|---------|
| MCP tool | `god_afk action="on"` / `"off"` / `"toggle"` / `"status"` |
| Telegram | `/afk` command |
| HTTP API | `POST http://localhost:3456/api/afk` |

## Routing Priority

When a tool permission request fires, the permission hook checks in order:

```
1. Orchestra active + worker instance?  →  comms.db relay to orchestrator
2. AFK mode active?                     →  HTTP POST to Telegram daemon
3. Neither?                             →  Normal CLI permission prompt
```

Orchestra relay takes priority over AFK — if both are active, workers relay to the orchestrator (who may or may not be AFK themselves).

## Permission Flow (AFK)

1. Claude Code fires `PermissionRequest` event
2. `rubix-permission-hook.cjs` reads `afk-state.json` → AFK is ON
3. Hook POSTs to `http://localhost:3456/api/permission` with tool name, summary, and input
4. Daemon sends Telegram message with Allow/Deny inline buttons
5. User taps Allow or Deny on phone
6. Daemon returns decision to hook
7. Hook outputs `allow` or `deny` to Claude Code

Timeout: 3 attempts, ~2 minutes each (6.5 minutes total). If no response, denied for safety.

## Prerequisites

- **Telegram bot token** set via `TELEGRAM_BOT_TOKEN`
- **Daemon running**: `npm run launch:daemon` or `npm run launch`
- Daemon health check: `GET http://localhost:3456/health`

## See Also

- [Hooks System](hooks.md) — permission hook details
- [Communication Tools](../tools/communication-tools.md) — `god_afk` tool reference
- [Telegram Bot Guide](../communication/telegram-bot-guide.md) — bot commands and sessions
