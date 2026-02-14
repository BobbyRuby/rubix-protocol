/**
 * CommsStore — Inter-Instance Communication via shared SQLite
 *
 * Provides a lightweight message bus for coordinating multiple Claude Code
 * instances that share the same data directory. Uses WAL mode for safe
 * concurrent access from separate MCP server processes.
 *
 * No embeddings, no vector search — pure SQL inbox/outbox queries.
 */

import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ==========================================
// Types
// ==========================================

export type MessageType = 'task' | 'status' | 'question' | 'response' | 'notification' | 'handoff';
export type MessageStatus = 'unread' | 'read' | 'acked' | 'expired';
export type MessagePriority = 0 | 1 | 2; // 0=normal, 1=high, 2=urgent
export type InstanceStatus = 'active' | 'idle' | 'busy' | 'offline';

export interface CommsMessage {
  id: string;
  from_instance: string;
  to_instance: string | null;
  type: MessageType;
  priority: number;
  subject: string | null;
  payload: string; // JSON string
  thread_id: string | null;
  status: MessageStatus;
  created_at: string;
  read_at: string | null;
  expires_at: string | null;
}

export interface InstanceInfo {
  instance_id: string;
  name: string | null;
  role: string | null;
  last_heartbeat: string;
  status: InstanceStatus;
  metadata: string | null; // JSON string
}

export interface SendMessageInput {
  to?: string;        // null/omitted = broadcast
  type: MessageType;
  priority?: MessagePriority;
  subject?: string;
  payload: unknown;   // Will be JSON.stringify'd
  threadId?: string;
  expiresInMs?: number;
}

export interface InboxFilters {
  type?: MessageType;
  from?: string;
  priority?: MessagePriority;
  threadId?: string;
  limit?: number;
  includeRead?: boolean;
}

export interface CommsStats {
  totalMessages: number;
  unread: number;
  read: number;
  acked: number;
  expired: number;
  byType: Record<string, number>;
  activeInstances: number;
}

// ==========================================
// CommsStore
// ==========================================

export class CommsStore {
  private db: Database.Database;

  constructor(dataDir: string) {
    const dbPath = join(dataDir, 'comms.db');
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initializeSchema();
  }

  private initializeSchema(): void {
    const schemaPath = join(__dirname, 'comms-schema.sql');
    const schema = readFileSync(schemaPath, 'utf-8');
    this.db.exec(schema);
    this.migrateSchema();
  }

  private migrateSchema(): void {
    // Add name column to instances table if missing (added 2026-02-11)
    const cols = this.db.prepare("PRAGMA table_info(instances)").all() as Array<{ name: string }>;
    if (!cols.some(c => c.name === 'name')) {
      this.db.exec("ALTER TABLE instances ADD COLUMN name TEXT");
    }

    // Ensure trigger_tasks table exists (added 2026-02-11)
    const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='trigger_tasks'").all();
    if (tables.length === 0) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS trigger_tasks (
          id TEXT PRIMARY KEY,
          from_instance TEXT NOT NULL,
          target_instance TEXT NOT NULL,
          prompt TEXT NOT NULL,
          raw_task TEXT NOT NULL,
          status TEXT DEFAULT 'pending',
          priority INTEGER DEFAULT 0,
          pid INTEGER,
          result TEXT,
          error TEXT,
          response_message_id TEXT,
          chain_depth INTEGER DEFAULT 0,
          max_chain_depth INTEGER DEFAULT 3,
          created_at TEXT NOT NULL,
          started_at TEXT,
          completed_at TEXT,
          metadata TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_trigger_status ON trigger_tasks(status, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_trigger_from ON trigger_tasks(from_instance, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_trigger_target ON trigger_tasks(target_instance, status);
      `);
    }
  }

  // ==========================================
  // Messages
  // ==========================================

  /**
   * Send a message to a specific instance or broadcast to all.
   */
  send(fromInstance: string, input: SendMessageInput): string {
    const id = uuidv4();
    const now = new Date().toISOString();
    const defaultTtlMs = input.type === 'status' ? 30 * 60 * 1000 : undefined;
    const ttlMs = input.expiresInMs ?? defaultTtlMs;
    const expiresAt = ttlMs
      ? new Date(Date.now() + ttlMs).toISOString()
      : null;

    const stmt = this.db.prepare(`
      INSERT INTO messages (id, from_instance, to_instance, type, priority, subject, payload, thread_id, status, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unread', ?, ?)
    `);

    stmt.run(
      id,
      fromInstance,
      input.to ?? null,
      input.type,
      input.priority ?? 0,
      input.subject ?? null,
      JSON.stringify(input.payload),
      input.threadId ?? null,
      now,
      expiresAt
    );

    return id;
  }

  /**
   * Get unread messages for an instance (direct + unread broadcasts).
   */
  inbox(instanceId: string, filters?: InboxFilters): CommsMessage[] {
    // Expire messages first
    this.expireMessages();

    const limit = filters?.limit ?? 50;

    // Build filter conditions for both queries
    let typeFilter = '';
    let fromFilter = '';
    let priorityFilter = '';
    let threadFilter = '';

    if (filters?.type) {
      typeFilter = ' AND m.type = ?';
    }
    if (filters?.from) {
      fromFilter = ' AND m.from_instance = ?';
    }
    if (filters?.priority !== undefined) {
      priorityFilter = ' AND m.priority >= ?';
    }
    if (filters?.threadId) {
      threadFilter = ' AND m.thread_id = ?';
    }

    const sharedFilters = typeFilter + fromFilter + priorityFilter + threadFilter;

    // Direct messages to this instance
    let directStatusFilter = "m.status = 'unread'";
    if (filters?.includeRead) {
      directStatusFilter = "m.status IN ('unread', 'read')";
    }

    // Broadcasts not yet read by this instance
    let broadcastJoinFilter = 'mr.message_id IS NULL';
    if (filters?.includeRead) {
      broadcastJoinFilter = "(mr.message_id IS NULL OR mr.status = 'read')";
    }

    const sql = `
      SELECT m.* FROM messages m
        WHERE m.to_instance = ? AND ${directStatusFilter}
        AND m.from_instance != ?
        ${sharedFilters}
      UNION ALL
      SELECT m.* FROM messages m
        LEFT JOIN message_reads mr ON m.id = mr.message_id AND mr.instance_id = ?
        WHERE m.to_instance IS NULL
        AND ${broadcastJoinFilter}
        AND m.from_instance != ?
        AND m.status != 'expired'
        ${sharedFilters}
      ORDER BY priority DESC, created_at DESC
      LIMIT ?
    `;

    // Build params: direct part, then broadcast part, then limit
    const queryParams: unknown[] = [
      instanceId,  // to_instance = ?
      instanceId,  // from_instance != ? (don't see own messages)
    ];
    // shared filters for direct
    if (filters?.type) queryParams.push(filters.type);
    if (filters?.from) queryParams.push(filters.from);
    if (filters?.priority !== undefined) queryParams.push(filters.priority);
    if (filters?.threadId) queryParams.push(filters.threadId);

    // broadcast part
    queryParams.push(instanceId);  // mr.instance_id = ?
    queryParams.push(instanceId);  // from_instance != ?
    // shared filters for broadcast
    if (filters?.type) queryParams.push(filters.type);
    if (filters?.from) queryParams.push(filters.from);
    if (filters?.priority !== undefined) queryParams.push(filters.priority);
    if (filters?.threadId) queryParams.push(filters.threadId);

    queryParams.push(limit);

    return this.db.prepare(sql).all(...queryParams) as CommsMessage[];
  }

  /**
   * Mark a message as read.
   * Direct messages: updates messages.status.
   * Broadcasts: inserts into message_reads.
   */
  read(instanceId: string, messageId: string): CommsMessage | null {
    const msg = this.getMessage(messageId);
    if (!msg) return null;

    const now = new Date().toISOString();

    if (msg.to_instance === null) {
      // Broadcast — use message_reads table
      this.db.prepare(`
        INSERT OR REPLACE INTO message_reads (message_id, instance_id, status, read_at)
        VALUES (?, ?, 'read', ?)
      `).run(messageId, instanceId, now);
    } else {
      // Direct message — update messages table
      this.db.prepare(`
        UPDATE messages SET status = 'read', read_at = ? WHERE id = ? AND status = 'unread'
      `).run(now, messageId);
    }

    return this.getMessage(messageId);
  }

  /**
   * Acknowledge a message (marks as processed).
   * Direct messages: updates messages.status.
   * Broadcasts: updates message_reads.
   */
  ack(instanceId: string, messageId: string): boolean {
    const msg = this.getMessage(messageId);
    if (!msg) return false;

    const now = new Date().toISOString();

    if (msg.to_instance === null) {
      // Broadcast — upsert message_reads
      this.db.prepare(`
        INSERT INTO message_reads (message_id, instance_id, status, read_at)
        VALUES (?, ?, 'acked', ?)
        ON CONFLICT (message_id, instance_id)
        DO UPDATE SET status = 'acked', read_at = ?
      `).run(messageId, instanceId, now, now);
    } else {
      // Direct message
      this.db.prepare(`
        UPDATE messages SET status = 'acked', read_at = COALESCE(read_at, ?)
        WHERE id = ?
      `).run(now, messageId);
    }

    return true;
  }

  /**
   * Get a full conversation thread chronologically.
   */
  thread(threadId: string): CommsMessage[] {
    return this.db.prepare(`
      SELECT * FROM messages
      WHERE thread_id = ? OR id = ?
      ORDER BY created_at ASC
    `).all(threadId, threadId) as CommsMessage[];
  }

  /**
   * Get a single message by ID.
   */
  getMessage(messageId: string): CommsMessage | null {
    return (this.db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId) as CommsMessage) ?? null;
  }

  // ==========================================
  // Instance Registry
  // ==========================================

  /**
   * Register or update instance presence.
   */
  heartbeat(instanceId: string, role?: string, metadata?: unknown, name?: string): void {
    const now = new Date().toISOString();
    const metaJson = metadata ? JSON.stringify(metadata) : null;

    this.db.prepare(`
      INSERT INTO instances (instance_id, name, role, last_heartbeat, status, metadata)
      VALUES (?, ?, ?, ?, 'active', ?)
      ON CONFLICT (instance_id)
      DO UPDATE SET
        name = COALESCE(?, name),
        role = COALESCE(?, role),
        last_heartbeat = ?,
        status = 'active',
        metadata = COALESCE(?, metadata)
    `).run(
      instanceId, name ?? null, role ?? null, now, metaJson,
      name ?? null, role ?? null, now, metaJson
    );
  }

  /**
   * List all known instances. Marks stale ones (>10min) as offline.
   */
  listInstances(): InstanceInfo[] {
    const staleThreshold = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    // Mark stale instances as offline
    this.db.prepare(`
      UPDATE instances SET status = 'offline'
      WHERE last_heartbeat < ? AND status != 'offline'
    `).run(staleThreshold);

    return this.db.prepare('SELECT * FROM instances ORDER BY last_heartbeat DESC').all() as InstanceInfo[];
  }

  // ==========================================
  // Maintenance
  // ==========================================

  /**
   * Delete old acked + expired messages.
   */
  cleanup(olderThanHours: number = 48): number {
    const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000).toISOString();

    // Delete acked messages older than cutoff
    const ackedResult = this.db.prepare(`
      DELETE FROM messages WHERE status = 'acked' AND created_at < ?
    `).run(cutoff);

    // Delete expired messages
    const expiredResult = this.db.prepare(`
      DELETE FROM messages WHERE status = 'expired'
    `).run();

    return (ackedResult.changes ?? 0) + (expiredResult.changes ?? 0);
  }

  /**
   * Expire messages past their expires_at timestamp.
   */
  private expireMessages(): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE messages SET status = 'expired'
      WHERE expires_at IS NOT NULL AND expires_at < ? AND status NOT IN ('acked', 'expired')
    `).run(now);
  }

  /**
   * Get message and instance stats.
   */
  stats(): CommsStats {
    const statusCounts = this.db.prepare(`
      SELECT status, COUNT(*) as count FROM messages GROUP BY status
    `).all() as Array<{ status: string; count: number }>;

    const typeCounts = this.db.prepare(`
      SELECT type, COUNT(*) as count FROM messages GROUP BY type
    `).all() as Array<{ type: string; count: number }>;

    const activeInstances = this.db.prepare(`
      SELECT COUNT(*) as count FROM instances WHERE status != 'offline'
    `).get() as { count: number };

    const total = this.db.prepare('SELECT COUNT(*) as count FROM messages').get() as { count: number };

    const byStatus: Record<string, number> = {};
    for (const row of statusCounts) {
      byStatus[row.status] = row.count;
    }

    const byType: Record<string, number> = {};
    for (const row of typeCounts) {
      byType[row.type] = row.count;
    }

    return {
      totalMessages: total.count,
      unread: byStatus['unread'] ?? 0,
      read: byStatus['read'] ?? 0,
      acked: byStatus['acked'] ?? 0,
      expired: byStatus['expired'] ?? 0,
      byType,
      activeInstances: activeInstances.count
    };
  }

  // ==========================================
  // Trigger Tasks
  // ==========================================

  /**
   * Insert a new trigger task record.
   */
  createTriggerTask(task: {
    id: string;
    fromInstance: string;
    targetInstance: string;
    prompt: string;
    rawTask: string;
    priority?: number;
    chainDepth?: number;
    maxChainDepth?: number;
    metadata?: unknown;
  }): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO trigger_tasks (id, from_instance, target_instance, prompt, raw_task, status, priority, chain_depth, max_chain_depth, created_at, metadata)
      VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)
    `).run(
      task.id,
      task.fromInstance,
      task.targetInstance,
      task.prompt,
      task.rawTask,
      task.priority ?? 0,
      task.chainDepth ?? 0,
      task.maxChainDepth ?? 3,
      now,
      task.metadata ? JSON.stringify(task.metadata) : null
    );
  }

  /**
   * Update a trigger task's status and optional fields.
   */
  updateTriggerTask(id: string, updates: {
    status?: string;
    pid?: number;
    result?: string;
    error?: string;
    responseMessageId?: string;
    startedAt?: string;
    completedAt?: string;
  }): void {
    const sets: string[] = [];
    const vals: unknown[] = [];

    if (updates.status !== undefined) { sets.push('status = ?'); vals.push(updates.status); }
    if (updates.pid !== undefined) { sets.push('pid = ?'); vals.push(updates.pid); }
    if (updates.result !== undefined) { sets.push('result = ?'); vals.push(updates.result); }
    if (updates.error !== undefined) { sets.push('error = ?'); vals.push(updates.error); }
    if (updates.responseMessageId !== undefined) { sets.push('response_message_id = ?'); vals.push(updates.responseMessageId); }
    if (updates.startedAt !== undefined) { sets.push('started_at = ?'); vals.push(updates.startedAt); }
    if (updates.completedAt !== undefined) { sets.push('completed_at = ?'); vals.push(updates.completedAt); }

    if (sets.length === 0) return;
    vals.push(id);

    this.db.prepare(`UPDATE trigger_tasks SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  }

  /**
   * Get a single trigger task by ID.
   */
  getTriggerTask(id: string): TriggerTaskRow | null {
    return (this.db.prepare('SELECT * FROM trigger_tasks WHERE id = ?').get(id) as TriggerTaskRow) ?? null;
  }

  /**
   * List trigger tasks with optional filters.
   */
  listTriggerTasks(filters?: { status?: string; fromInstance?: string; targetInstance?: string; limit?: number }): TriggerTaskRow[] {
    const conditions: string[] = [];
    const vals: unknown[] = [];

    if (filters?.status) { conditions.push('status = ?'); vals.push(filters.status); }
    if (filters?.fromInstance) { conditions.push('from_instance = ?'); vals.push(filters.fromInstance); }
    if (filters?.targetInstance) { conditions.push('target_instance = ?'); vals.push(filters.targetInstance); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filters?.limit ?? 20;
    vals.push(limit);

    return this.db.prepare(`SELECT * FROM trigger_tasks ${where} ORDER BY created_at DESC LIMIT ?`).all(...vals) as TriggerTaskRow[];
  }

  /**
   * Count currently running trigger tasks.
   */
  countRunningTriggers(): number {
    const row = this.db.prepare("SELECT COUNT(*) as c FROM trigger_tasks WHERE status = 'running'").get() as { c: number };
    return row.c;
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.db.close();
  }
}

// ==========================================
// Trigger Task Row Type
// ==========================================

export interface TriggerTaskRow {
  id: string;
  from_instance: string;
  target_instance: string;
  prompt: string;
  raw_task: string;
  status: string;
  priority: number;
  pid: number | null;
  result: string | null;
  error: string | null;
  response_message_id: string | null;
  chain_depth: number;
  max_chain_depth: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  metadata: string | null;
}
