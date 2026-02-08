/**
 * Scheduler Types
 *
 * Type definitions for the task scheduling system.
 * Enables scheduling tasks for future execution with various trigger types.
 */

/**
 * Task status enum
 */
export enum TaskStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  PAUSED = 'paused',
  CANCELLED = 'cancelled'
}

/**
 * Trigger type enum
 */
export enum TriggerType {
  DATETIME = 'datetime',
  CRON = 'cron',
  EVENT = 'event',
  FILE = 'file',
  MANUAL = 'manual'
}

/**
 * File event types for file-based triggers
 */
export type FileEventType = 'created' | 'modified' | 'deleted';

/**
 * Schedule trigger - union type for different trigger configurations
 */
export type ScheduleTrigger =
  | { type: TriggerType.DATETIME; at: string }  // ISO datetime string
  | { type: TriggerType.CRON; pattern: string }  // Cron expression
  | { type: TriggerType.EVENT; event: string }   // Event name to listen for
  | { type: TriggerType.FILE; path: string; event: FileEventType }
  | { type: TriggerType.MANUAL };

/**
 * Notification configuration for a task
 */
export interface TaskNotification {
  onComplete?: boolean;
  onDecision?: boolean;
  onFailure?: boolean;
}

/**
 * Scheduled task interface
 */
export interface ScheduledTask {
  id: string;
  name: string;
  description?: string;
  promptTemplate: string;           // Task prompt with {context} placeholder
  trigger: ScheduleTrigger;
  contextIds?: string[];            // Memory IDs to load as context
  contextQuery?: string;            // Query to run for fresh context
  status: TaskStatus;
  priority: number;                 // 1-10, higher = more important
  notification: TaskNotification;
  createdAt: Date;
  lastRun?: Date;
  nextRun?: Date;
  runCount: number;
  metadata?: Record<string, unknown>;
}

/**
 * Task run status
 */
export enum RunStatus {
  SUCCESS = 'success',
  FAILED = 'failed',
  NEEDS_DECISION = 'needs_decision',
  TIMEOUT = 'timeout',
  CANCELLED = 'cancelled'
}

/**
 * Task run record
 */
export interface TaskRun {
  id: string;
  taskId: string;
  startedAt: Date;
  completedAt?: Date;
  status: RunStatus;
  resultMemoryId?: string;          // Memory ID where results were stored
  error?: string;
  decisionPrompt?: string;          // If needs_decision, what to ask user
  output?: string;                  // Raw output from execution
  durationMs?: number;
}

/**
 * Scheduler configuration
 */
export interface SchedulerConfig {
  /** Check interval in milliseconds (default: 60000 = 1 minute) */
  checkInterval: number;
  /** Maximum concurrent tasks (default: 3) */
  maxConcurrent: number;
  /** Task execution timeout in milliseconds (default: 300000 = 5 minutes) */
  taskTimeout: number;
  /** Whether to enable file watching triggers (default: false) */
  enableFileWatching: boolean;
  /** Working directory for spawned processes */
  workingDirectory?: string;
  /** Claude CLI command (default: 'claude') */
  claudeCommand: string;
  /** Claude CLI arguments */
  claudeArgs: string[];
}

/**
 * Default scheduler configuration
 */
export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  checkInterval: 60000,        // 1 minute
  maxConcurrent: 3,
  taskTimeout: 300000,         // 5 minutes
  enableFileWatching: false,
  claudeCommand: 'claude',
  claudeArgs: ['--print']
};

/**
 * Event queue entry
 */
export interface EventEntry {
  id: string;
  event: string;
  firedAt: Date;
  payload?: Record<string, unknown>;
  consumed: boolean;
}

/**
 * Task store query options
 */
export interface TaskQueryOptions {
  status?: TaskStatus | TaskStatus[];
  triggerType?: TriggerType;
  limit?: number;
  offset?: number;
  orderBy?: 'createdAt' | 'nextRun' | 'priority';
  orderDir?: 'asc' | 'desc';
}

/**
 * Create task input
 */
export interface CreateTaskInput {
  name: string;
  description?: string;
  prompt: string;
  trigger: ScheduleTrigger;
  contextIds?: string[];
  contextQuery?: string;
  priority?: number;
  notification?: TaskNotification;
  metadata?: Record<string, unknown>;
}

/**
 * Update task input
 */
export interface UpdateTaskInput {
  name?: string;
  description?: string;
  prompt?: string;
  trigger?: ScheduleTrigger;
  contextIds?: string[];
  contextQuery?: string;
  priority?: number;
  notification?: TaskNotification;
  status?: TaskStatus;
  metadata?: Record<string, unknown>;
}

/**
 * Scheduler statistics
 */
export interface SchedulerStats {
  totalTasks: number;
  pendingTasks: number;
  runningTasks: number;
  completedTasks: number;
  failedTasks: number;
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  averageRunDuration: number;
  eventsInQueue: number;
}

/**
 * Built context for task execution
 */
export interface TaskContext {
  memories: Array<{
    id: string;
    content: string;
    tags?: string[];
    importance?: number;
  }>;
  formattedContext: string;
}
