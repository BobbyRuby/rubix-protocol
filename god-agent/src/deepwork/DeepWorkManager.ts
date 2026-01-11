/**
 * DeepWorkManager
 *
 * Manages deep work sessions for RUBIX. Provides:
 * - Session lifecycle (start, pause, resume, end)
 * - Work logging and checkpointing
 * - Smart notification filtering based on focus level
 * - Progress tracking and status reporting
 */

import { randomUUID } from 'crypto';
import type {
  DeepWorkSession,
  FocusLevel,
  NotificationPolicy,
  NotificationUrgency,
  Checkpoint,
  WorkLogEntry,
  StatusReport,
  DeepWorkOptions,
  DeepWorkStats,
  BatchedNotification
} from './types.js';
import { DEFAULT_NOTIFICATION_POLICIES } from './types.js';

/**
 * DeepWorkManager - Controls deep work sessions
 */
export class DeepWorkManager {
  private currentSession: DeepWorkSession | null = null;
  private sessionHistory: DeepWorkSession[] = [];
  private batchedNotifications: BatchedNotification[] = [];
  private stats: DeepWorkStats = {
    totalSessions: 0,
    completedSessions: 0,
    interruptedSessions: 0,
    averageDurationMs: 0,
    totalCheckpoints: 0,
    avgCheckpointsPerSession: 0,
    notificationsBatched: 0,
    notificationsSent: 0
  };
  private pauseStartTime: number | null = null;

  /**
   * Start a new deep work session
   */
  startSession(taskId: string, options: DeepWorkOptions = {}): DeepWorkSession {
    // End any existing session
    if (this.currentSession) {
      this.endSession('interrupted');
    }

    const focusLevel = options.focusLevel ?? 'normal';
    const defaultPolicy = DEFAULT_NOTIFICATION_POLICIES[focusLevel];
    const notificationPolicy: NotificationPolicy = {
      ...defaultPolicy,
      ...options.notificationPolicy
    };

    const session: DeepWorkSession = {
      id: randomUUID(),
      taskId,
      startedAt: new Date(),
      status: 'active',
      focusLevel,
      notificationPolicy,
      workLog: [],
      checkpoints: [],
      activeTimeMs: 0,
      metadata: options.metadata
    };

    this.currentSession = session;
    this.stats.totalSessions++;

    // Log session start
    this.log({
      type: 'start',
      message: `Deep work session started with focus level: ${focusLevel}`
    });

    return session;
  }

  /**
   * Pause the current session
   */
  pauseSession(): DeepWorkSession | null {
    if (!this.currentSession || this.currentSession.status !== 'active') {
      return null;
    }

    // Calculate active time before pause
    this.updateActiveTime();
    this.pauseStartTime = Date.now();

    this.currentSession.status = 'paused';
    this.currentSession.pausedAt = new Date();

    this.log({
      type: 'progress',
      message: 'Session paused'
    });

    return this.currentSession;
  }

  /**
   * Resume a paused session
   */
  resumeSession(): DeepWorkSession | null {
    if (!this.currentSession || this.currentSession.status !== 'paused') {
      return null;
    }

    this.currentSession.status = 'active';
    this.currentSession.pausedAt = undefined;
    this.pauseStartTime = null;

    this.log({
      type: 'progress',
      message: 'Session resumed'
    });

    return this.currentSession;
  }

  /**
   * End the current session
   */
  endSession(reason: 'completed' | 'interrupted' = 'completed'): DeepWorkSession | null {
    if (!this.currentSession) {
      return null;
    }

    // Update final active time
    this.updateActiveTime();

    this.currentSession.status = reason;
    this.currentSession.completedAt = new Date();

    // Update stats
    if (reason === 'completed') {
      this.stats.completedSessions++;
    } else {
      this.stats.interruptedSessions++;
    }

    // Update average duration
    const totalDuration = this.sessionHistory.reduce((sum, s) => sum + s.activeTimeMs, 0) + this.currentSession.activeTimeMs;
    this.stats.averageDurationMs = totalDuration / this.stats.totalSessions;

    // Update checkpoint stats
    this.stats.avgCheckpointsPerSession = this.stats.totalCheckpoints / this.stats.totalSessions;

    this.log({
      type: 'complete',
      message: `Session ${reason}. Total active time: ${this.formatDuration(this.currentSession.activeTimeMs)}`,
      details: {
        activeTimeMs: this.currentSession.activeTimeMs,
        checkpoints: this.currentSession.checkpoints.length,
        logEntries: this.currentSession.workLog.length
      }
    });

    // Move to history
    this.sessionHistory.push(this.currentSession);
    const endedSession = this.currentSession;
    this.currentSession = null;
    this.pauseStartTime = null;

    // Flush batched notifications
    this.flushBatchedNotifications();

    return endedSession;
  }

  /**
   * Add a work log entry
   */
  log(entry: Omit<WorkLogEntry, 'id' | 'sessionId' | 'timestamp'>): WorkLogEntry | null {
    if (!this.currentSession) {
      return null;
    }

    const logEntry: WorkLogEntry = {
      id: randomUUID(),
      sessionId: this.currentSession.id,
      timestamp: new Date(),
      ...entry
    };

    this.currentSession.workLog.push(logEntry);
    return logEntry;
  }

  /**
   * Create a progress checkpoint
   */
  createCheckpoint(
    subtasksComplete: number,
    subtasksRemaining: number,
    summary: string,
    options: {
      snapshot?: string;
      filesModified?: string[];
      metadata?: Record<string, unknown>;
    } = {}
  ): Checkpoint | null {
    if (!this.currentSession) {
      return null;
    }

    const checkpoint: Checkpoint = {
      id: randomUUID(),
      sessionId: this.currentSession.id,
      timestamp: new Date(),
      subtasksComplete,
      subtasksRemaining,
      summary,
      snapshot: options.snapshot,
      filesModified: options.filesModified,
      metadata: options.metadata
    };

    this.currentSession.checkpoints.push(checkpoint);
    this.stats.totalCheckpoints++;

    this.log({
      type: 'progress',
      message: `Checkpoint: ${summary}`,
      details: {
        checkpointId: checkpoint.id,
        subtasksComplete,
        subtasksRemaining
      }
    });

    return checkpoint;
  }

  /**
   * Get current status report
   */
  getStatus(): StatusReport | null {
    if (!this.currentSession) {
      return null;
    }

    // Update active time for accurate reporting
    this.updateActiveTime();

    const totalSubtasks = this.getLastCheckpointTotal();
    const completedSubtasks = this.getLastCheckpointCompleted();
    const progress = totalSubtasks > 0
      ? Math.round((completedSubtasks / totalSubtasks) * 100)
      : 0;

    // Get blockers from recent log entries
    const blockers = this.currentSession.workLog
      .filter(e => e.type === 'blocked')
      .slice(-5)
      .map(e => e.message);

    // Count pending decisions
    const pendingDecisions = this.currentSession.workLog
      .filter(e => e.type === 'decision' && !e.details?.resolved)
      .length;

    return {
      session: this.currentSession,
      currentTask: this.currentSession.taskId,
      progress,
      recentActivity: this.currentSession.workLog.slice(-10),
      pendingDecisions,
      blockers,
      eta: this.estimateETA(progress),
      activeTimeFormatted: this.formatDuration(this.currentSession.activeTimeMs),
      batchedNotifications: this.batchedNotifications.filter(
        n => n.sessionId === this.currentSession!.id
      ).length
    };
  }

  /**
   * Update notification policy
   */
  setNotificationPolicy(policy: Partial<NotificationPolicy>): NotificationPolicy | null {
    if (!this.currentSession) {
      return null;
    }

    this.currentSession.notificationPolicy = {
      ...this.currentSession.notificationPolicy,
      ...policy
    };

    return this.currentSession.notificationPolicy;
  }

  /**
   * Set focus level (updates notification policy accordingly)
   */
  setFocusLevel(level: FocusLevel): NotificationPolicy | null {
    if (!this.currentSession) {
      return null;
    }

    this.currentSession.focusLevel = level;

    // Merge default policy for new focus level
    const defaultPolicy = DEFAULT_NOTIFICATION_POLICIES[level];
    this.currentSession.notificationPolicy = {
      ...this.currentSession.notificationPolicy,
      ...defaultPolicy
    };

    this.log({
      type: 'progress',
      message: `Focus level changed to: ${level}`
    });

    return this.currentSession.notificationPolicy;
  }

  /**
   * Check if a notification should be sent based on current policy
   */
  shouldNotify(type: string, urgency: NotificationUrgency): boolean {
    if (!this.currentSession) {
      return true; // No session, allow all
    }

    const policy = this.currentSession.notificationPolicy;

    // Check quiet period
    if (policy.quietUntil && new Date() < policy.quietUntil) {
      return false;
    }

    // Check urgency threshold
    const urgencyOrder: NotificationUrgency[] = ['low', 'normal', 'high', 'critical'];
    const typeUrgencyIndex = urgencyOrder.indexOf(urgency);
    const minUrgencyIndex = urgencyOrder.indexOf(policy.minUrgency);

    if (typeUrgencyIndex < minUrgencyIndex) {
      return false;
    }

    // Check type-specific policies
    switch (type) {
      case 'progress':
        return policy.allowProgress;
      case 'blocked':
      case 'escalation':
        return policy.allowBlocked;
      case 'complete':
        return policy.allowComplete;
      case 'urgent':
      case 'critical':
        return policy.allowUrgent;
      default:
        // For other types, check if urgent or should batch
        if (urgency === 'critical' || urgency === 'high') {
          return policy.allowUrgent;
        }
        return !policy.batchNonUrgent;
    }
  }

  /**
   * Batch a notification for later delivery
   */
  batchNotification(
    type: string,
    urgency: NotificationUrgency,
    title: string,
    message: string,
    taskId?: string,
    subtaskId?: string
  ): BatchedNotification | null {
    if (!this.currentSession) {
      return null;
    }

    const notification: BatchedNotification = {
      id: randomUUID(),
      sessionId: this.currentSession.id,
      timestamp: new Date(),
      type,
      urgency,
      title,
      message,
      taskId,
      subtaskId
    };

    this.batchedNotifications.push(notification);
    this.stats.notificationsBatched++;

    return notification;
  }

  /**
   * Get batched notifications for current session
   */
  getBatchedNotifications(): BatchedNotification[] {
    if (!this.currentSession) {
      return [];
    }

    return this.batchedNotifications.filter(
      n => n.sessionId === this.currentSession!.id
    );
  }

  /**
   * Flush batched notifications (called on session end)
   */
  flushBatchedNotifications(): BatchedNotification[] {
    const sessionNotifications = this.getBatchedNotifications();

    // Remove flushed notifications
    this.batchedNotifications = this.batchedNotifications.filter(
      n => !sessionNotifications.includes(n)
    );

    this.stats.notificationsSent += sessionNotifications.length;

    return sessionNotifications;
  }

  /**
   * Get current session
   */
  getCurrentSession(): DeepWorkSession | null {
    return this.currentSession;
  }

  /**
   * Check if there's an active session
   */
  hasActiveSession(): boolean {
    return this.currentSession !== null && this.currentSession.status === 'active';
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): DeepWorkSession | null {
    if (this.currentSession?.id === sessionId) {
      return this.currentSession;
    }
    return this.sessionHistory.find(s => s.id === sessionId) ?? null;
  }

  /**
   * Get work log for current or specific session
   */
  getWorkLog(sessionId?: string, limit?: number): WorkLogEntry[] {
    const session = sessionId ? this.getSession(sessionId) : this.currentSession;
    if (!session) {
      return [];
    }

    const log = session.workLog;
    return limit ? log.slice(-limit) : log;
  }

  /**
   * Get checkpoints for current or specific session
   */
  getCheckpoints(sessionId?: string): Checkpoint[] {
    const session = sessionId ? this.getSession(sessionId) : this.currentSession;
    return session?.checkpoints ?? [];
  }

  /**
   * Get session statistics
   */
  getStats(): DeepWorkStats {
    return { ...this.stats };
  }

  /**
   * Get session history
   */
  getHistory(limit?: number): DeepWorkSession[] {
    const history = this.sessionHistory;
    return limit ? history.slice(-limit) : history;
  }

  // ==========================================
  // Private Helpers
  // ==========================================

  private updateActiveTime(): void {
    if (!this.currentSession || this.currentSession.status !== 'active') {
      return;
    }

    const now = Date.now();
    const sessionStart = this.currentSession.startedAt.getTime();

    // Calculate total elapsed minus pause time
    let elapsed = now - sessionStart;

    // If we were tracking a pause, don't count that time
    if (this.pauseStartTime) {
      elapsed -= (now - this.pauseStartTime);
    }

    this.currentSession.activeTimeMs = Math.max(0, elapsed);
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  }

  private getLastCheckpointTotal(): number {
    if (!this.currentSession || this.currentSession.checkpoints.length === 0) {
      return 0;
    }
    const last = this.currentSession.checkpoints[this.currentSession.checkpoints.length - 1];
    return last.subtasksComplete + last.subtasksRemaining;
  }

  private getLastCheckpointCompleted(): number {
    if (!this.currentSession || this.currentSession.checkpoints.length === 0) {
      return 0;
    }
    return this.currentSession.checkpoints[this.currentSession.checkpoints.length - 1].subtasksComplete;
  }

  private estimateETA(progress: number): string | undefined {
    if (!this.currentSession || progress === 0 || progress >= 100) {
      return undefined;
    }

    const elapsed = this.currentSession.activeTimeMs;
    const estimatedTotal = (elapsed / progress) * 100;
    const remaining = estimatedTotal - elapsed;

    if (remaining < 60000) {
      return 'less than a minute';
    }
    if (remaining < 3600000) {
      return `~${Math.round(remaining / 60000)} minutes`;
    }
    return `~${Math.round(remaining / 3600000)} hours`;
  }
}

export default DeepWorkManager;
