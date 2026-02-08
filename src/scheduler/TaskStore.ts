/**
 * TaskStore
 *
 * Persistence layer for scheduled tasks, task runs, and events.
 * Uses SQLite via the shared database connection.
 */

import { v4 as uuidv4 } from 'uuid';
import type Database from 'better-sqlite3';
import {
  TaskStatus,
  TriggerType,
  RunStatus,
  type ScheduledTask,
  type TaskRun,
  type ScheduleTrigger,
  type EventEntry,
  type TaskQueryOptions,
  type CreateTaskInput,
  type UpdateTaskInput,
  type SchedulerStats
} from './types.js';

/**
 * Row types for SQLite results
 */
interface ScheduledTaskRow {
  id: string;
  name: string;
  description: string | null;
  prompt_template: string;
  trigger_type: string;
  trigger_config: string | null;
  context_ids: string | null;
  context_query: string | null;
  status: string;
  priority: number;
  notify_on_complete: number;
  notify_on_decision: number;
  notify_on_failure: number;
  created_at: string;
  last_run: string | null;
  next_run: string | null;
  run_count: number;
  metadata: string | null;
}

interface TaskRunRow {
  id: string;
  task_id: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  result_memory_id: string | null;
  error: string | null;
  decision_prompt: string | null;
  output: string | null;
  duration_ms: number | null;
}

interface EventQueueRow {
  id: string;
  event: string;
  fired_at: string;
  payload: string | null;
  consumed: number;
}

export class TaskStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  // ==========================================
  // SCHEDULED TASKS
  // ==========================================

  /**
   * Create a new scheduled task
   */
  createTask(input: CreateTaskInput): ScheduledTask {
    const id = uuidv4();
    const now = new Date();
    const notification = input.notification ?? {
      onComplete: false,
      onDecision: true,
      onFailure: true
    };

    // Calculate next run time based on trigger type
    const nextRun = this.calculateNextRun(input.trigger) ?? undefined;

    const task: ScheduledTask = {
      id,
      name: input.name,
      description: input.description,
      promptTemplate: input.prompt,
      trigger: input.trigger,
      contextIds: input.contextIds,
      contextQuery: input.contextQuery,
      status: TaskStatus.PENDING,
      priority: input.priority ?? 5,
      notification,
      createdAt: now,
      nextRun,
      runCount: 0,
      metadata: input.metadata
    };

    this.db.prepare(`
      INSERT INTO scheduled_tasks (
        id, name, description, prompt_template, trigger_type, trigger_config,
        context_ids, context_query, status, priority,
        notify_on_complete, notify_on_decision, notify_on_failure,
        created_at, next_run, run_count, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      task.id,
      task.name,
      task.description ?? null,
      task.promptTemplate,
      task.trigger.type,
      this.serializeTriggerConfig(task.trigger),
      task.contextIds ? JSON.stringify(task.contextIds) : null,
      task.contextQuery ?? null,
      task.status,
      task.priority,
      notification.onComplete ? 1 : 0,
      notification.onDecision ? 1 : 0,
      notification.onFailure ? 1 : 0,
      task.createdAt.toISOString(),
      task.nextRun?.toISOString() ?? null,
      task.runCount,
      task.metadata ? JSON.stringify(task.metadata) : null
    );

    return task;
  }

  /**
   * Get a task by ID
   */
  getTask(id: string): ScheduledTask | null {
    const row = this.db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id) as ScheduledTaskRow | undefined;
    return row ? this.rowToTask(row) : null;
  }

  /**
   * Update a task
   */
  updateTask(id: string, updates: UpdateTaskInput): ScheduledTask | null {
    const task = this.getTask(id);
    if (!task) return null;

    const updateFields: string[] = [];
    const values: unknown[] = [];

    if (updates.name !== undefined) {
      updateFields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.description !== undefined) {
      updateFields.push('description = ?');
      values.push(updates.description);
    }
    if (updates.prompt !== undefined) {
      updateFields.push('prompt_template = ?');
      values.push(updates.prompt);
    }
    if (updates.trigger !== undefined) {
      updateFields.push('trigger_type = ?');
      values.push(updates.trigger.type);
      updateFields.push('trigger_config = ?');
      values.push(this.serializeTriggerConfig(updates.trigger));
      updateFields.push('next_run = ?');
      values.push(this.calculateNextRun(updates.trigger)?.toISOString() ?? null);
    }
    if (updates.contextIds !== undefined) {
      updateFields.push('context_ids = ?');
      values.push(JSON.stringify(updates.contextIds));
    }
    if (updates.contextQuery !== undefined) {
      updateFields.push('context_query = ?');
      values.push(updates.contextQuery);
    }
    if (updates.priority !== undefined) {
      updateFields.push('priority = ?');
      values.push(updates.priority);
    }
    if (updates.notification !== undefined) {
      updateFields.push('notify_on_complete = ?');
      values.push(updates.notification.onComplete ? 1 : 0);
      updateFields.push('notify_on_decision = ?');
      values.push(updates.notification.onDecision ? 1 : 0);
      updateFields.push('notify_on_failure = ?');
      values.push(updates.notification.onFailure ? 1 : 0);
    }
    if (updates.status !== undefined) {
      updateFields.push('status = ?');
      values.push(updates.status);
    }
    if (updates.metadata !== undefined) {
      updateFields.push('metadata = ?');
      values.push(JSON.stringify(updates.metadata));
    }

    if (updateFields.length === 0) return task;

    values.push(id);
    this.db.prepare(`
      UPDATE scheduled_tasks SET ${updateFields.join(', ')} WHERE id = ?
    `).run(...values);

    return this.getTask(id);
  }

  /**
   * Delete a task
   */
  deleteTask(id: string): boolean {
    const result = this.db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /**
   * Query tasks with filters
   */
  queryTasks(options: TaskQueryOptions = {}): ScheduledTask[] {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (options.status) {
      const statuses = Array.isArray(options.status) ? options.status : [options.status];
      const placeholders = statuses.map(() => '?').join(',');
      conditions.push(`status IN (${placeholders})`);
      values.push(...statuses);
    }

    if (options.triggerType) {
      conditions.push('trigger_type = ?');
      values.push(options.triggerType);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const orderBy = options.orderBy ?? 'createdAt';
    const orderDir = options.orderDir ?? 'desc';
    const orderColumn = orderBy === 'createdAt' ? 'created_at' : orderBy === 'nextRun' ? 'next_run' : 'priority';
    const limit = options.limit ?? 100;
    const offset = options.offset ?? 0;

    const rows = this.db.prepare(`
      SELECT * FROM scheduled_tasks
      ${whereClause}
      ORDER BY ${orderColumn} ${orderDir.toUpperCase()}
      LIMIT ? OFFSET ?
    `).all(...values, limit, offset) as ScheduledTaskRow[];

    return rows.map(row => this.rowToTask(row));
  }

  /**
   * Get pending tasks that are ready to run
   */
  getPendingTasks(): ScheduledTask[] {
    const now = new Date().toISOString();
    const rows = this.db.prepare(`
      SELECT * FROM scheduled_tasks
      WHERE status = 'pending'
        AND (next_run IS NULL OR next_run <= ?)
      ORDER BY priority DESC, next_run ASC
    `).all(now) as ScheduledTaskRow[];

    return rows.map(row => this.rowToTask(row));
  }

  /**
   * Get tasks listening for a specific event
   */
  getTasksForEvent(event: string): ScheduledTask[] {
    const rows = this.db.prepare(`
      SELECT * FROM scheduled_tasks
      WHERE trigger_type = 'event'
        AND status = 'pending'
        AND json_extract(trigger_config, '$.event') = ?
    `).all(event) as ScheduledTaskRow[];

    return rows.map(row => this.rowToTask(row));
  }

  /**
   * Update task status
   */
  updateTaskStatus(id: string, status: TaskStatus): void {
    this.db.prepare('UPDATE scheduled_tasks SET status = ? WHERE id = ?').run(status, id);
  }

  /**
   * Record that a task ran
   */
  recordTaskRun(id: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE scheduled_tasks
      SET last_run = ?, run_count = run_count + 1
      WHERE id = ?
    `).run(now, id);
  }

  /**
   * Update next run time for a task
   */
  updateNextRun(id: string, nextRun: Date | null): void {
    this.db.prepare('UPDATE scheduled_tasks SET next_run = ? WHERE id = ?').run(
      nextRun?.toISOString() ?? null,
      id
    );
  }

  // ==========================================
  // TASK RUNS
  // ==========================================

  /**
   * Create a new task run record
   */
  createRun(taskId: string): TaskRun {
    const id = uuidv4();
    const now = new Date();

    const run: TaskRun = {
      id,
      taskId,
      startedAt: now,
      status: RunStatus.SUCCESS // Will be updated on completion
    };

    this.db.prepare(`
      INSERT INTO task_runs (id, task_id, started_at, status)
      VALUES (?, ?, ?, 'running')
    `).run(run.id, run.taskId, run.startedAt.toISOString());

    return run;
  }

  /**
   * Complete a task run
   */
  completeRun(
    runId: string,
    status: RunStatus,
    options: {
      resultMemoryId?: string;
      error?: string;
      decisionPrompt?: string;
      output?: string;
    } = {}
  ): TaskRun | null {
    const now = new Date();
    const row = this.db.prepare('SELECT * FROM task_runs WHERE id = ?').get(runId) as TaskRunRow | undefined;
    if (!row) return null;

    const startedAt = new Date(row.started_at);
    const durationMs = now.getTime() - startedAt.getTime();

    this.db.prepare(`
      UPDATE task_runs
      SET completed_at = ?, status = ?, result_memory_id = ?, error = ?,
          decision_prompt = ?, output = ?, duration_ms = ?
      WHERE id = ?
    `).run(
      now.toISOString(),
      status,
      options.resultMemoryId ?? null,
      options.error ?? null,
      options.decisionPrompt ?? null,
      options.output ?? null,
      durationMs,
      runId
    );

    return this.getRun(runId);
  }

  /**
   * Get a run by ID
   */
  getRun(id: string): TaskRun | null {
    const row = this.db.prepare('SELECT * FROM task_runs WHERE id = ?').get(id) as TaskRunRow | undefined;
    return row ? this.rowToRun(row) : null;
  }

  /**
   * Get runs for a task
   */
  getRunsForTask(taskId: string, limit: number = 10): TaskRun[] {
    const rows = this.db.prepare(`
      SELECT * FROM task_runs
      WHERE task_id = ?
      ORDER BY started_at DESC
      LIMIT ?
    `).all(taskId, limit) as TaskRunRow[];

    return rows.map(row => this.rowToRun(row));
  }

  /**
   * Get recent runs across all tasks
   */
  getRecentRuns(limit: number = 20): TaskRun[] {
    const rows = this.db.prepare(`
      SELECT * FROM task_runs
      ORDER BY started_at DESC
      LIMIT ?
    `).all(limit) as TaskRunRow[];

    return rows.map(row => this.rowToRun(row));
  }

  // ==========================================
  // EVENT QUEUE
  // ==========================================

  /**
   * Fire an event
   */
  fireEvent(event: string, payload?: Record<string, unknown>): EventEntry {
    const id = uuidv4();
    const now = new Date();

    const entry: EventEntry = {
      id,
      event,
      firedAt: now,
      payload,
      consumed: false
    };

    this.db.prepare(`
      INSERT INTO event_queue (id, event, fired_at, payload, consumed)
      VALUES (?, ?, ?, ?, 0)
    `).run(entry.id, entry.event, entry.firedAt.toISOString(), payload ? JSON.stringify(payload) : null);

    return entry;
  }

  /**
   * Get unconsumed events
   */
  getUnconsumedEvents(event?: string): EventEntry[] {
    let query = 'SELECT * FROM event_queue WHERE consumed = 0';
    const values: unknown[] = [];

    if (event) {
      query += ' AND event = ?';
      values.push(event);
    }

    query += ' ORDER BY fired_at ASC';

    const rows = this.db.prepare(query).all(...values) as EventQueueRow[];
    return rows.map(row => this.rowToEvent(row));
  }

  /**
   * Mark an event as consumed
   */
  consumeEvent(id: string): void {
    this.db.prepare('UPDATE event_queue SET consumed = 1 WHERE id = ?').run(id);
  }

  /**
   * Cleanup old consumed events
   */
  cleanupConsumedEvents(olderThanMs: number = 24 * 60 * 60 * 1000): number {
    const cutoff = new Date(Date.now() - olderThanMs).toISOString();
    const result = this.db.prepare(`
      DELETE FROM event_queue WHERE consumed = 1 AND fired_at < ?
    `).run(cutoff);
    return result.changes;
  }

  // ==========================================
  // STATISTICS
  // ==========================================

  /**
   * Get scheduler statistics
   */
  getStats(): SchedulerStats {
    const taskCounts = this.db.prepare(`
      SELECT status, COUNT(*) as count FROM scheduled_tasks GROUP BY status
    `).all() as { status: string; count: number }[];

    const runCounts = this.db.prepare(`
      SELECT status, COUNT(*) as count FROM task_runs GROUP BY status
    `).all() as { status: string; count: number }[];

    const avgDuration = this.db.prepare(`
      SELECT AVG(duration_ms) as avg FROM task_runs WHERE duration_ms IS NOT NULL
    `).get() as { avg: number | null };

    const eventCount = this.db.prepare(`
      SELECT COUNT(*) as count FROM event_queue WHERE consumed = 0
    `).get() as { count: number };

    const taskStatusMap = Object.fromEntries(taskCounts.map(r => [r.status, r.count]));
    const runStatusMap = Object.fromEntries(runCounts.map(r => [r.status, r.count]));

    return {
      totalTasks: Object.values(taskStatusMap).reduce((a, b) => a + b, 0),
      pendingTasks: taskStatusMap['pending'] ?? 0,
      runningTasks: taskStatusMap['running'] ?? 0,
      completedTasks: taskStatusMap['completed'] ?? 0,
      failedTasks: taskStatusMap['failed'] ?? 0,
      totalRuns: Object.values(runStatusMap).reduce((a, b) => a + b, 0),
      successfulRuns: runStatusMap['success'] ?? 0,
      failedRuns: runStatusMap['failed'] ?? 0,
      averageRunDuration: avgDuration.avg ?? 0,
      eventsInQueue: eventCount.count
    };
  }

  // ==========================================
  // HELPERS
  // ==========================================

  private rowToTask(row: ScheduledTaskRow): ScheduledTask {
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      promptTemplate: row.prompt_template,
      trigger: this.parseTrigger(row.trigger_type, row.trigger_config),
      contextIds: row.context_ids ? JSON.parse(row.context_ids) : undefined,
      contextQuery: row.context_query ?? undefined,
      status: row.status as TaskStatus,
      priority: row.priority,
      notification: {
        onComplete: row.notify_on_complete === 1,
        onDecision: row.notify_on_decision === 1,
        onFailure: row.notify_on_failure === 1
      },
      createdAt: new Date(row.created_at),
      lastRun: row.last_run ? new Date(row.last_run) : undefined,
      nextRun: row.next_run ? new Date(row.next_run) : undefined,
      runCount: row.run_count,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined
    };
  }

  private rowToRun(row: TaskRunRow): TaskRun {
    return {
      id: row.id,
      taskId: row.task_id,
      startedAt: new Date(row.started_at),
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
      status: row.status as RunStatus,
      resultMemoryId: row.result_memory_id ?? undefined,
      error: row.error ?? undefined,
      decisionPrompt: row.decision_prompt ?? undefined,
      output: row.output ?? undefined,
      durationMs: row.duration_ms ?? undefined
    };
  }

  private rowToEvent(row: EventQueueRow): EventEntry {
    return {
      id: row.id,
      event: row.event,
      firedAt: new Date(row.fired_at),
      payload: row.payload ? JSON.parse(row.payload) : undefined,
      consumed: row.consumed === 1
    };
  }

  private parseTrigger(type: string, config: string | null): ScheduleTrigger {
    const configObj = config ? JSON.parse(config) : {};

    switch (type) {
      case TriggerType.DATETIME:
        return { type: TriggerType.DATETIME, at: configObj.at };
      case TriggerType.CRON:
        return { type: TriggerType.CRON, pattern: configObj.pattern };
      case TriggerType.EVENT:
        return { type: TriggerType.EVENT, event: configObj.event };
      case TriggerType.FILE:
        return { type: TriggerType.FILE, path: configObj.path, event: configObj.event };
      case TriggerType.MANUAL:
      default:
        return { type: TriggerType.MANUAL };
    }
  }

  private serializeTriggerConfig(trigger: ScheduleTrigger): string | null {
    switch (trigger.type) {
      case TriggerType.DATETIME:
        return JSON.stringify({ at: trigger.at });
      case TriggerType.CRON:
        return JSON.stringify({ pattern: trigger.pattern });
      case TriggerType.EVENT:
        return JSON.stringify({ event: trigger.event });
      case TriggerType.FILE:
        return JSON.stringify({ path: trigger.path, event: trigger.event });
      case TriggerType.MANUAL:
        return null;
    }
  }

  private calculateNextRun(trigger: ScheduleTrigger): Date | null {
    switch (trigger.type) {
      case TriggerType.DATETIME:
        return new Date(trigger.at);
      case TriggerType.CRON:
        // Will be calculated by TriggerEvaluator
        return null;
      case TriggerType.EVENT:
      case TriggerType.FILE:
      case TriggerType.MANUAL:
        return null;
    }
  }
}
