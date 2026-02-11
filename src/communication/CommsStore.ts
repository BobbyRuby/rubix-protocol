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
    const expiresAt = input.expiresInMs
      ? new Date(Date.now() + input.expiresInMs).toISOString()
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

  /**
   * Close the database connection.
   */
  close(): void {
    this.db.close();
  }
}
