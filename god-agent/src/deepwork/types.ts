/**
 * Deep Work Mode Types
 *
 * Type definitions for RUBIX deep work sessions. Enables focused,
 * uninterrupted work with smart notification batching and checkpoint
 * management.
 */

/**
 * Deep work session status
 */
export type DeepWorkStatus = 'active' | 'paused' | 'completed' | 'interrupted';

/**
 * Focus level determines notification sensitivity
 */
export type FocusLevel = 'shallow' | 'normal' | 'deep';

/**
 * Notification urgency levels
 */
export type NotificationUrgency = 'low' | 'normal' | 'high' | 'critical';

/**
 * Log entry types for work tracking
 */
export type WorkLogType = 'start' | 'progress' | 'decision' | 'blocked' | 'complete' | 'error';

/**
 * Deep work session
 */
export interface DeepWorkSession {
  /** Unique session identifier */
  id: string;
  /** Associated task ID */
  taskId: string;
  /** Session start time */
  startedAt: Date;
  /** Paused time (if paused) */
  pausedAt?: Date;
  /** Completed time (if finished) */
  completedAt?: Date;
  /** Current session status */
  status: DeepWorkStatus;
  /** Focus level for notification filtering */
  focusLevel: FocusLevel;
  /** Notification policy for this session */
  notificationPolicy: NotificationPolicy;
  /** Chronological work log */
  workLog: WorkLogEntry[];
  /** Progress checkpoints */
  checkpoints: Checkpoint[];
  /** Total time spent working (excluding pauses) */
  activeTimeMs: number;
  /** Session metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Notification policy for deep work sessions
 */
export interface NotificationPolicy {
  /** Allow progress notifications */
  allowProgress: boolean;
  /** Allow blocked notifications (escalations) */
  allowBlocked: boolean;
  /** Allow completion notifications */
  allowComplete: boolean;
  /** Allow urgent/critical notifications */
  allowUrgent: boolean;
  /** Batch non-urgent notifications */
  batchNonUrgent: boolean;
  /** Quiet mode until this time */
  quietUntil?: Date;
  /** Minimum urgency level to notify */
  minUrgency: NotificationUrgency;
}

/**
 * Checkpoint for saving progress
 */
export interface Checkpoint {
  /** Unique checkpoint identifier */
  id: string;
  /** Session this checkpoint belongs to */
  sessionId: string;
  /** When checkpoint was created */
  timestamp: Date;
  /** Number of subtasks completed at this point */
  subtasksComplete: number;
  /** Number of subtasks remaining */
  subtasksRemaining: number;
  /** Human-readable summary */
  summary: string;
  /** Serialized state snapshot (JSON) */
  snapshot?: string;
  /** Files modified up to this point */
  filesModified?: string[];
  /** Checkpoint metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Work log entry for tracking activity
 */
export interface WorkLogEntry {
  /** Unique entry identifier */
  id: string;
  /** Session this entry belongs to */
  sessionId: string;
  /** When this entry was created */
  timestamp: Date;
  /** Type of log entry */
  type: WorkLogType;
  /** Human-readable message */
  message: string;
  /** Subtask ID if applicable */
  subtaskId?: string;
  /** Additional details */
  details?: Record<string, unknown>;
}

/**
 * Status report for deep work session
 */
export interface StatusReport {
  /** Current session info */
  session: DeepWorkSession;
  /** Current task description */
  currentTask: string;
  /** Progress percentage (0-100) */
  progress: number;
  /** Recent activity log */
  recentActivity: WorkLogEntry[];
  /** Number of pending decisions */
  pendingDecisions: number;
  /** List of current blockers */
  blockers: string[];
  /** Estimated time to completion */
  eta?: string;
  /** Time spent active */
  activeTimeFormatted: string;
  /** Batched notifications waiting */
  batchedNotifications: number;
}

/**
 * Options for starting a deep work session
 */
export interface DeepWorkOptions {
  /** Initial focus level (default: normal) */
  focusLevel?: FocusLevel;
  /** Custom notification policy */
  notificationPolicy?: Partial<NotificationPolicy>;
  /** Session metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Deep work statistics
 */
export interface DeepWorkStats {
  /** Total sessions created */
  totalSessions: number;
  /** Sessions completed successfully */
  completedSessions: number;
  /** Sessions interrupted */
  interruptedSessions: number;
  /** Average session duration (ms) */
  averageDurationMs: number;
  /** Total checkpoints created */
  totalCheckpoints: number;
  /** Average checkpoints per session */
  avgCheckpointsPerSession: number;
  /** Notifications batched */
  notificationsBatched: number;
  /** Notifications sent */
  notificationsSent: number;
}

/**
 * Batched notification for later delivery
 */
export interface BatchedNotification {
  /** Unique notification identifier */
  id: string;
  /** Session it belongs to */
  sessionId: string;
  /** When it was batched */
  timestamp: Date;
  /** Notification type */
  type: string;
  /** Urgency level */
  urgency: NotificationUrgency;
  /** Notification title */
  title: string;
  /** Notification message */
  message: string;
  /** Associated task/subtask IDs */
  taskId?: string;
  subtaskId?: string;
}

/**
 * Default notification policy based on focus level
 */
export const DEFAULT_NOTIFICATION_POLICIES: Record<FocusLevel, NotificationPolicy> = {
  shallow: {
    allowProgress: true,
    allowBlocked: true,
    allowComplete: true,
    allowUrgent: true,
    batchNonUrgent: false,
    minUrgency: 'low'
  },
  normal: {
    allowProgress: false,
    allowBlocked: true,
    allowComplete: true,
    allowUrgent: true,
    batchNonUrgent: true,
    minUrgency: 'normal'
  },
  deep: {
    allowProgress: false,
    allowBlocked: false,
    allowComplete: true,
    allowUrgent: true,
    batchNonUrgent: true,
    minUrgency: 'high'
  }
};
