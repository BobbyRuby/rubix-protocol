# Multi-Instance Orchestra

Run multiple Claude Code instances coordinating via shared SQLite message bus (`comms.db`) and tmux. One orchestrator splits work across workers; a monitor process bridges messages between `comms.db` and tmux panes.

## Architecture

```
tmux session "rubix"
┌─────────────────┬─────────────────┬─────────────────┬─────────────────┐
│ Pane 0          │ Pane 1          │ Pane 2          │ Pane 3          │
│ instance_1      │ instance_2      │ instance_3      │ MONITOR         │
│ Forge           │ Axis            │ Trace           │                 │
│ (orchestrator)  │ (worker)        │ (worker)        │ Polls comms.db  │
│                 │                 │                 │ every 3s.       │
│ Splits tasks,   │ Executes tasks, │ Executes tasks, │ Routes messages │
│ synthesizes     │ reports back    │ reports back    │ to panes via    │
│ responses.      │ via comms.db.   │ via comms.db.   │ paste-buffer.   │
└────────┬────────┴────────┬────────┴────────┬────────┴────────┬────────┘
         │                 │                 │                 │
         └─────────────────┴─────────────────┴─────────────────┘
                                    │
                            ┌───────┴───────┐
                            │   comms.db    │
                            │  (SQLite WAL) │
                            └───────────────┘
```

## Components

| Script | Lines | Purpose |
|--------|-------|---------|
| `scripts/rubix-orchestra.sh` | 324 | tmux launcher — start/stop/status/attach/list |
| `scripts/rubix-monitor.sh` | 451 | comms.db poller — routes messages to tmux panes, displays dashboard |
| `scripts/rubix-orchestra.ps1` | ~150 | Windows Terminal version — no monitor (can't inject keystrokes) |

## Usage

```bash
bash scripts/rubix-orchestra.sh start 3    # Launch 3 instances + monitor
bash scripts/rubix-orchestra.sh status     # Show heartbeats + message queue
bash scripts/rubix-orchestra.sh attach     # Reattach to tmux session
bash scripts/rubix-orchestra.sh list       # List panes
bash scripts/rubix-orchestra.sh stop       # Kill session + cleanup
```

Default: 3 instances. Pass any number: `start 5` for 5 instances.

## Instance Naming

Names cycle every 5: **Forge, Axis, Trace, Loom, Spark**. At 6+, names append a cycle number (Forge2, Axis2, ...).

| Instance | Name | Role |
|----------|------|------|
| instance_1 | Forge | orchestrator |
| instance_2 | Axis | worker |
| instance_3 | Trace | worker |
| instance_4 | Loom | worker |
| instance_5 | Spark | worker |
| instance_6 | Forge2 | worker |

Instance 1 is always the orchestrator. All others are workers.

## Startup Sequence

1. Create tmux session `rubix` (220x50)
2. Split into N instance panes + 1 monitor pane, tiled layout
3. Write registry file (`data/orchestra-registry.json`)
4. Launch `claude` in each instance pane (staggered 8s apart to avoid API rate limits)
5. Inject identity prompts via `tmux load-buffer` + `paste-buffer` (atomic, no partial sends)
6. Launch monitor in last pane
7. Wait up to 120s for all instances to register heartbeats in comms.db

### Identity Prompt

Each instance receives a prompt with:
- Instance ID and name
- `god_comms_heartbeat` call to register in comms.db
- `/recall` to load memories
- Role-specific instructions (orchestrator: split tasks, synthesize; worker: execute, report back)

## Registry File

Written to `data/orchestra-registry.json` before any instances launch:

```json
{
  "session": "rubix",
  "created": "2026-03-05T22:00:00Z",
  "instances": {
    "instance_1": { "name": "Forge", "role": "orchestrator", "pane": 0 },
    "instance_2": { "name": "Axis", "role": "worker", "pane": 1 },
    "instance_3": { "name": "Trace", "role": "worker", "pane": 2 }
  },
  "monitorPane": 3
}
```

The monitor reads this file every 30s to map instance IDs to tmux panes.

## Monitor

`rubix-monitor.sh` bridges comms.db and tmux:

1. **Poll** — queries `comms.db` for unread messages every 3s
2. **Format** — templates messages by type:
   - `task` — includes response template for the worker
   - `question` — includes reply template with threadId
   - `permission` — includes ALLOW/DENY response templates
   - `response` — shows result + files changed
   - `status` — dashboard only (not injected into panes)
3. **Deliver** — sends formatted message to target pane via `tmux load-buffer` + `paste-buffer` + `Enter`
4. **Track** — records delivered message IDs in `data/monitor-delivered.txt` (hourly cleanup)
5. **Dashboard** — clears and redraws: instance status, heartbeat age, queue depth, uptime

Rate limit: max 5 deliveries per poll cycle. Broadcasts deliver to all panes except sender.

### Stale Message Cleanup

On startup, the monitor expires unread messages older than 24 hours (sets status to `expired`). This prevents message backlog from previous sessions overwhelming new instances.

## Permission Relay

When a worker instance hits a tool permission prompt:

1. `rubix-permission-hook.cjs` detects orchestra is active
2. Writes a `question` message to comms.db with type `permission_request`
3. Polls for a response (max 3 minutes)
4. Monitor delivers the permission request to the orchestrator's pane (instance_1)
5. Orchestrator sees formatted ALLOW/DENY templates, responds via `god_comms_send`
6. Hook receives the response and allows or denies the tool

Instance_1 (orchestrator) is excluded from relay — it uses the normal CLI permission prompt since the user is there.

## Platform Differences

| Feature | Linux/macOS | Windows |
|---------|-------------|---------|
| Launcher | `rubix-orchestra.sh` (tmux) | `rubix-orchestra.ps1` (Windows Terminal) |
| Monitor | Full (polls + delivers) | Not available |
| Identity injection | Automatic (paste-buffer) | Manual (prints prompt, user copy-pastes) |
| Prerequisites | tmux, sqlite3, python3 | Windows Terminal, sqlite3 |

## See Also

- [Comms Architecture](../communication/comms-architecture.md) — comms.db schema and message lifecycle
- [Communication Tools](../tools/communication-tools.md) — god_comms_* tool reference
- [Hooks System](hooks.md) — permission relay hook details
