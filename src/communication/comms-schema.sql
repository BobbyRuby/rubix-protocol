-- Inter-Instance Communication Schema
-- Shared message bus for coordinating multiple Claude Code instances.
-- Uses WAL mode for concurrent access from separate MCP server processes.

CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    from_instance TEXT NOT NULL,
    to_instance TEXT,               -- NULL = broadcast
    type TEXT NOT NULL,             -- task|status|question|response|notification|handoff
    priority INTEGER DEFAULT 0,     -- 0=normal, 1=high, 2=urgent
    subject TEXT,
    payload TEXT NOT NULL,          -- JSON
    thread_id TEXT,                 -- reply threading
    status TEXT DEFAULT 'unread',   -- unread|read|acked|expired
    created_at TEXT NOT NULL,
    read_at TEXT,
    expires_at TEXT
);

-- Inbox: "show me my unread messages, newest first"
CREATE INDEX IF NOT EXISTS idx_msg_inbox ON messages(to_instance, status, created_at DESC);
-- Threads, types, expiry
CREATE INDEX IF NOT EXISTS idx_msg_thread ON messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_msg_type ON messages(type, status);
CREATE INDEX IF NOT EXISTS idx_msg_expires ON messages(expires_at) WHERE expires_at IS NOT NULL;
-- Broadcasts only (no to_instance)
CREATE INDEX IF NOT EXISTS idx_msg_broadcast ON messages(created_at DESC) WHERE to_instance IS NULL;

-- Per-recipient read tracking (for broadcasts)
-- Direct messages use messages.status directly.
-- Broadcast messages (to_instance IS NULL) use this table for per-recipient state.
CREATE TABLE IF NOT EXISTS message_reads (
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    instance_id TEXT NOT NULL,
    status TEXT DEFAULT 'read',     -- read|acked
    read_at TEXT NOT NULL,
    PRIMARY KEY (message_id, instance_id)
);
CREATE INDEX IF NOT EXISTS idx_reads_instance ON message_reads(instance_id, status);

CREATE TABLE IF NOT EXISTS instances (
    instance_id TEXT PRIMARY KEY,
    role TEXT,
    last_heartbeat TEXT NOT NULL,
    status TEXT DEFAULT 'active',   -- active|idle|busy|offline
    metadata TEXT                   -- JSON
);
