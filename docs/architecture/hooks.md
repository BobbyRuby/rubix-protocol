# Hooks System

RUBIX uses Claude Code hooks for automatic lifecycle actions — memory recall, permission routing, plan validation, short-term memory tracking, and QC enforcement. Configured in `.claude/settings.json`, implemented as Node.js scripts in `scripts/`.

## Hook Registry

| Event | Matcher | Script | Timeout | Purpose |
|-------|---------|--------|---------|---------|
| UserPromptSubmit | (all) | `rubix-recall-hook.cjs` | 30s | Auto-recall memories, detect project, check comms inbox, load polyglot skills |
| PermissionRequest | (all) | `rubix-permission-hook.cjs` | 400s | Route permissions: orchestra relay → AFK Telegram → default CLI |
| Notification | (all) | `rubix-notification-hook.cjs` | 5s | Forward notifications to Telegram when AFK |
| Stop | (all) | `rubix-comms-stop-hook.cjs` | 15s | Check unread comms, demand QC for edited files, store STM journal |
| PreToolUse | `EnterPlanMode` | `rubix-plan-hook.cjs` | 5s | Broadcast plan-mode entry, surface unread messages, inject STM context |
| PreToolUse | `Write\|Edit` | `rubix-plan-gate-hook.cjs` | 10s | Plan validation gate — run V1-V4 validators, block on CRITICALs |
| PostToolUse | `ExitPlanMode` | `rubix-plan-preflight-hook.cjs` | 10s | Capture plan text, export V1-V4 validators for gate hook |
| PostToolUse | `Write\|Edit\|Bash` | `rubix-stm-hook.cjs` | 2s | Append edit/write signals to `stm-journal.json` |
| PostToolUse | diagnostics tools | `rubix-qc-hook.cjs` | 2s | Record diagnosed files to `qc-ledger.json` |
| SessionEnd | (all) | `rubix-session-end-hook.cjs` | 10s | Persist STM journal to memory, session-end marker |

## Data Flow

```
User Prompt
  │
  ▼
┌──────────────────┐
│ Recall Hook      │ → Loads memories, polyglot skills, comms inbox count
└──────────────────┘
  │
  ▼
Tool Usage (Write/Edit/Bash)
  │
  ├──▶ STM Hook (PostToolUse) → Appends to stm-journal.json
  │
  ├──▶ Plan Gate Hook (PreToolUse Write|Edit) → Validates plan if active
  │
  └──▶ QC Hook (PostToolUse diagnostics) → Marks files as diagnosed
  │
  ▼
Session Stop
  │
  ▼
┌──────────────────┐
│ Stop Hook        │ → Checks unread comms, demands QC for edited files,
│                  │   stores STM journal to memory
└──────────────────┘
```

## Plan Validation Pipeline

Two-stage validation prevents executing unvalidated plans:

**Stage 1: Capture** (PostToolUse → ExitPlanMode)
- `rubix-plan-preflight-hook.cjs` captures the plan text
- Runs V1-V4 validators (scope, file existence, version numbers, dependency check)
- Exports findings to `data/plan-preflight.json`

**Stage 2: Gate** (PreToolUse → Write|Edit)
- `rubix-plan-gate-hook.cjs` runs before the first Write/Edit after plan mode
- Checks `plan-preflight.json` for CRITICAL findings
- Blocks the write if CRITICALs exist (returns `decision: deny`)
- Escape hatch: after 3 consecutive blocks on the same plan, allows through with warning
- Smart false-positive handling: ignores known safe patterns

## QC Enforcement Loop

Ensures edited files get diagnostics run before session ends:

1. **STM hook** records every file written/edited to `stm-journal.json`
2. **Stop hook** compares journal against `qc-ledger.json`
3. If edited files haven't been diagnosed → injects reminder to run diagnostics
4. **QC hook** (PostToolUse on diagnostics tools) marks files as diagnosed in `qc-ledger.json`
5. Stop hook sees ledger entries → allows clean exit

## Permission Routing

`rubix-permission-hook.cjs` routes tool permission requests through three tiers:

```
Permission Request
  │
  ├─ Orchestra active + worker instance?
  │   └─ YES → Write to comms.db → Orchestrator decides → Poll response (3 min)
  │
  ├─ AFK mode active?
  │   └─ YES → HTTP POST to daemon → Telegram Allow/Deny → Wait response (6.5 min)
  │
  └─ Neither?
      └─ Exit cleanly → Normal Claude Code CLI permission prompt
```

Instance_1 (orchestrator) always gets CLI prompts — the user is there.

## Shared Utilities

`scripts/rubix-hook-utils.cjs` (1029 lines) provides common functions:

| Function | Purpose |
|----------|---------|
| `readStdin()` | Parse JSON from stdin (Claude Code hook protocol) |
| `detectProject()` | Determine active project from CWD |
| `resolveMcpConfig()` | Find MCP server config for current project |
| `readAfkState()` | Check `data/afk-state.json` |
| `isOrchestraActive()` | Check for running tmux session + registry |
| `readHookIdentity()` | Determine which instance this hook is running for |
| `writeCommsPermissionRequest()` | Write permission question to comms.db |
| `pollCommsPermissionResponse()` | Poll for response with matching thread_id |
| `readStmJournal()` | Read short-term memory journal |
| `readQcLedger()` | Read QC diagnosed files ledger |
| `httpPost()` | HTTP POST with timeout (for daemon communication) |

## Configuration

Hooks are configured in `.claude/settings.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node scripts/rubix-recall-hook.cjs",
            "timeout": 30,
            "statusMessage": "Recalling memories..."
          }
        ]
      }
    ]
  }
}
```

- `type`: always `"command"` (shell execution)
- `timeout`: seconds before hook is killed
- `statusMessage`: shown in Claude Code status bar during execution
- `matcher`: tool name pattern for PreToolUse/PostToolUse (supports `|` OR)

## See Also

- [AFK Mode](afk-mode.md) — Telegram remote control via hooks
- [Orchestra](orchestra.md) — multi-instance coordination
- [Comms Architecture](../communication/comms-architecture.md) — message bus used by hooks
