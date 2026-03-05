# Comms Architecture (comms.db)

Lightweight SQLite message bus for coordinating multiple Claude Code instances. Separate from `memory.db` (knowledge store). Uses WAL mode for safe concurrent access from multiple MCP server processes.

## Schema

Four tables, defined in `src/communication/comms-schema.sql`:

### messages

Core message table. 12 columns.

| Column | Type | Purpose |
|--------|------|---------|
| `id` | TEXT PK | UUID |
| `from_instance` | TEXT | Sender instance ID |
| `to_instance` | TEXT | Recipient (NULL = broadcast) |
| `type` | TEXT | task\|status\|question\|response\|notification\|handoff |
| `priority` | INTEGER | 0=normal, 1=high, 2=urgent |
| `subject` | TEXT | Short description |
| `payload` | TEXT | JSON body |
| `thread_id` | TEXT | Original message ID for reply chains |
| `status` | TEXT | unread\|read\|acked\|expired |
| `created_at` | TEXT | ISO timestamp |
| `read_at` | TEXT | When first read |
| `expires_at` | TEXT | Auto-expiry timestamp |

Indexes: inbox (to_instance + status + created_at), thread, type + status, expiry, broadcasts.

### message_reads

Per-recipient tracking for broadcast messages. Direct messages use `messages.status` directly.

| Column | Type | Purpose |
|--------|------|---------|
| `message_id` | TEXT FK | References messages(id) |
| `instance_id` | TEXT | Recipient |
| `status` | TEXT | read\|acked |
| `read_at` | TEXT | When read |

PK: (message_id, instance_id).

### instances

Heartbeat registry for active instances.

| Column | Type | Purpose |
|--------|------|---------|
| `instance_id` | TEXT PK | e.g., "instance_1" |
| `name` | TEXT | Display name (e.g., "Forge") |
| `role` | TEXT | orchestrator\|worker |
| `last_heartbeat` | TEXT | ISO timestamp |
| `status` | TEXT | active\|idle\|busy\|offline |
| `metadata` | TEXT | JSON |

### trigger_tasks

Autonomous instance spawning with chain depth limiting.

| Column | Type | Purpose |
|--------|------|---------|
| `id` | TEXT PK | UUID |
| `from_instance` | TEXT | Requesting instance |
| `target_instance` | TEXT | Target instance |
| `prompt` | TEXT | Task prompt |
| `status` | TEXT | pending\|running\|completed\|failed\|cancelled |
| `chain_depth` | INTEGER | Current depth (prevents infinite chains) |
| `max_chain_depth` | INTEGER | Limit (default: 3) |

## Message Lifecycle

```
Send (god_comms_send)
  │
  ▼
UNREAD ──read──▶ READ ──ack──▶ ACKED
  │                                │
  ▼                                ▼
EXPIRED (24h stale cleanup)   (auto-cleanup after 48h)
```

- **Direct messages**: status tracked on the `messages` row
- **Broadcasts** (to_instance=NULL): per-recipient status in `message_reads`
- Monitor expires stale unread messages (>24h) on startup
- CommsStore cleanup runs after 48h for acked messages

## Message Types

| Type | Purpose | Typical Payload |
|------|---------|-----------------|
| `task` | Assign work to an instance | `{task, description, constraints}` |
| `response` | Return results | `{result, filesChanged}` |
| `question` | Ask for input/decision | `{question}` or `{type: "permission_request", question}` |
| `status` | Progress update | `{phase, progress, message}` |
| `notification` | FYI (no response expected) | `{message, action, details}` |
| `handoff` | Transfer ownership of work | `{task, context, reason}` |

## Threading

Set `thread_id` to the original message's `id` for reply chains:

```
Message A (id: "abc")           → question from worker
  └─ Message B (thread_id: "abc") → response from orchestrator
      └─ Message C (thread_id: "abc") → follow-up
```

Used for permission request/response pairing: the hook writes a question, polls for a response with matching `thread_id`.

## Heartbeats

Instances register via `god_comms_heartbeat`. Freshness check:

```sql
julianday('now') - julianday(last_heartbeat) < 0.007  -- ~10 minutes
```

The orchestra `wait_for_ready` function polls this on startup (120s timeout). The monitor dashboard shows heartbeat age per instance.

## Integration Points

| System | How It Uses comms.db |
|--------|---------------------|
| **Orchestra monitor** | Polls unread messages, delivers to tmux panes |
| **Recall hook** | Checks inbox count, shows `[COMMS] N unread` in prompt context |
| **Stop hook** | Checks for unread messages before session end |
| **Permission hook** | Writes permission requests, polls for responses (orchestra mode) |
| **AFK mode** | Permission routing priority: orchestra relay > AFK Telegram > CLI |
| **god_comms_* tools** | Full API for send, read, ack, thread, broadcast, peers |

## See Also

- [Orchestra](../architecture/orchestra.md) — tmux launcher and monitor
- [Communication Tools](../tools/communication-tools.md) — god_comms_* tool reference
- [Hooks System](../architecture/hooks.md) — hook integration details
