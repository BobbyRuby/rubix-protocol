/**
 * TriggerEvaluator
 *
 * Evaluates whether a scheduled task's trigger conditions are met.
 * Supports datetime, cron, event, file, and manual triggers.
 */

import { existsSync, statSync } from 'fs';
import {
  TriggerType,
  type ScheduledTask,
  type ScheduleTrigger,
  type EventEntry
} from './types.js';

/**
 * Configuration for TriggerEvaluator
 */
export interface TriggerEvaluatorConfig {
  /** Default tolerance for datetime triggers in ms (default: 60000 = 1 minute) */
  datetimeTolerance: number;
  /** Whether to enable file watching (default: false) */
  enableFileWatching: boolean;
}

/**
 * Default configuration
 */
export const DEFAULT_TRIGGER_EVALUATOR_CONFIG: TriggerEvaluatorConfig = {
  datetimeTolerance: 60000,  // 1 minute
  enableFileWatching: false
};

/**
 * Trigger evaluation result
 */
export interface TriggerEvaluation {
  shouldTrigger: boolean;
  reason: string;
  nextRun?: Date;
}

/**
 * File tracking for file-based triggers
 */
interface FileState {
  path: string;
  exists: boolean;
  mtime?: number;
}

export class TriggerEvaluator {
  private config: TriggerEvaluatorConfig;
  private fileStates: Map<string, FileState> = new Map();

  constructor(config: Partial<TriggerEvaluatorConfig> = {}) {
    this.config = { ...DEFAULT_TRIGGER_EVALUATOR_CONFIG, ...config };
  }

  /**
   * Evaluate whether a task should trigger
   */
  shouldTrigger(task: ScheduledTask, events: EventEntry[] = []): TriggerEvaluation {
    const trigger = task.trigger;

    switch (trigger.type) {
      case TriggerType.DATETIME:
        return this.evaluateDatetime(trigger);
      case TriggerType.CRON:
        return this.evaluateCron(trigger);
      case TriggerType.EVENT:
        return this.evaluateEvent(trigger, events);
      case TriggerType.FILE:
        return this.evaluateFile(trigger);
      case TriggerType.MANUAL:
        return { shouldTrigger: false, reason: 'Manual trigger requires explicit invocation' };
    }
  }

  /**
   * Evaluate datetime trigger
   */
  private evaluateDatetime(trigger: { type: TriggerType.DATETIME; at: string }): TriggerEvaluation {
    const targetTime = new Date(trigger.at).getTime();
    const now = Date.now();
    const diff = targetTime - now;

    if (diff <= this.config.datetimeTolerance && diff > -this.config.datetimeTolerance * 10) {
      return {
        shouldTrigger: true,
        reason: `Datetime trigger reached: ${trigger.at}`
      };
    }

    if (diff < -this.config.datetimeTolerance * 10) {
      return {
        shouldTrigger: false,
        reason: `Datetime trigger expired: ${trigger.at}`
      };
    }

    return {
      shouldTrigger: false,
      reason: `Datetime trigger pending: ${trigger.at}`,
      nextRun: new Date(trigger.at)
    };
  }

  /**
   * Evaluate cron trigger
   */
  private evaluateCron(trigger: { type: TriggerType.CRON; pattern: string }): TriggerEvaluation {
    try {
      const nextRun = this.getNextCronTime(trigger.pattern);

      if (!nextRun) {
        return {
          shouldTrigger: false,
          reason: `Invalid cron pattern: ${trigger.pattern}`
        };
      }

      const now = Date.now();
      const diff = nextRun.getTime() - now;

      // If next run is within tolerance, trigger
      if (diff <= this.config.datetimeTolerance && diff > -this.config.datetimeTolerance) {
        return {
          shouldTrigger: true,
          reason: `Cron trigger matched: ${trigger.pattern}`,
          nextRun: this.getNextCronTime(trigger.pattern, new Date(nextRun.getTime() + 60000)) ?? undefined
        };
      }

      return {
        shouldTrigger: false,
        reason: `Cron next run: ${nextRun.toISOString()}`,
        nextRun
      };
    } catch (error) {
      return {
        shouldTrigger: false,
        reason: `Cron evaluation error: ${error instanceof Error ? error.message : 'Unknown'}`
      };
    }
  }

  /**
   * Parse cron pattern and get next execution time
   * Simple implementation supporting: minute hour day-of-month month day-of-week
   */
  private getNextCronTime(pattern: string, after: Date = new Date()): Date | null {
    try {
      const parts = pattern.trim().split(/\s+/);
      if (parts.length < 5) {
        return null;
      }

      const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

      // Start from the next minute
      const next = new Date(after);
      next.setSeconds(0);
      next.setMilliseconds(0);
      next.setMinutes(next.getMinutes() + 1);

      // Simple matcher - iterate up to 1 year to find next match
      const maxIterations = 525600; // 1 year in minutes
      for (let i = 0; i < maxIterations; i++) {
        if (this.cronFieldMatches(next.getMinutes(), minute) &&
            this.cronFieldMatches(next.getHours(), hour) &&
            this.cronFieldMatches(next.getDate(), dayOfMonth) &&
            this.cronFieldMatches(next.getMonth() + 1, month) &&
            this.cronFieldMatches(next.getDay(), dayOfWeek)) {
          return next;
        }
        next.setMinutes(next.getMinutes() + 1);
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Check if a value matches a cron field
   */
  private cronFieldMatches(value: number, field: string): boolean {
    if (field === '*') return true;

    // Handle step values: */5, */10, etc.
    if (field.startsWith('*/')) {
      const step = parseInt(field.slice(2), 10);
      return value % step === 0;
    }

    // Handle ranges: 1-5, 9-17, etc.
    if (field.includes('-')) {
      const [start, end] = field.split('-').map(n => parseInt(n, 10));
      return value >= start && value <= end;
    }

    // Handle lists: 1,3,5, etc.
    if (field.includes(',')) {
      const values = field.split(',').map(n => parseInt(n, 10));
      return values.includes(value);
    }

    // Handle single value
    return parseInt(field, 10) === value;
  }

  /**
   * Evaluate event trigger
   */
  private evaluateEvent(
    trigger: { type: TriggerType.EVENT; event: string },
    events: EventEntry[]
  ): TriggerEvaluation {
    const matchingEvent = events.find(e => e.event === trigger.event && !e.consumed);

    if (matchingEvent) {
      return {
        shouldTrigger: true,
        reason: `Event received: ${trigger.event}`
      };
    }

    return {
      shouldTrigger: false,
      reason: `Waiting for event: ${trigger.event}`
    };
  }

  /**
   * Evaluate file trigger
   */
  private evaluateFile(
    trigger: { type: TriggerType.FILE; path: string; event: 'created' | 'modified' | 'deleted' }
  ): TriggerEvaluation {
    if (!this.config.enableFileWatching) {
      return {
        shouldTrigger: false,
        reason: 'File watching is disabled'
      };
    }

    const previousState = this.fileStates.get(trigger.path);
    const currentState = this.getFileState(trigger.path);

    // Update tracked state
    this.fileStates.set(trigger.path, currentState);

    // First check - no previous state
    if (!previousState) {
      return {
        shouldTrigger: false,
        reason: 'Tracking file state'
      };
    }

    switch (trigger.event) {
      case 'created':
        if (!previousState.exists && currentState.exists) {
          return {
            shouldTrigger: true,
            reason: `File created: ${trigger.path}`
          };
        }
        break;

      case 'modified':
        if (previousState.exists && currentState.exists &&
            previousState.mtime !== currentState.mtime) {
          return {
            shouldTrigger: true,
            reason: `File modified: ${trigger.path}`
          };
        }
        break;

      case 'deleted':
        if (previousState.exists && !currentState.exists) {
          return {
            shouldTrigger: true,
            reason: `File deleted: ${trigger.path}`
          };
        }
        break;
    }

    return {
      shouldTrigger: false,
      reason: `Watching file: ${trigger.path} for ${trigger.event}`
    };
  }

  /**
   * Get current file state
   */
  private getFileState(path: string): FileState {
    try {
      if (existsSync(path)) {
        const stats = statSync(path);
        return {
          path,
          exists: true,
          mtime: stats.mtimeMs
        };
      }
    } catch {
      // File doesn't exist or can't be accessed
    }

    return {
      path,
      exists: false
    };
  }

  /**
   * Calculate the next run time for a task
   */
  calculateNextRun(trigger: ScheduleTrigger): Date | null {
    switch (trigger.type) {
      case TriggerType.DATETIME:
        return new Date(trigger.at);
      case TriggerType.CRON:
        return this.getNextCronTime(trigger.pattern);
      case TriggerType.EVENT:
      case TriggerType.FILE:
      case TriggerType.MANUAL:
        return null;
    }
  }

  /**
   * Validate a trigger configuration
   */
  validateTrigger(trigger: ScheduleTrigger): { valid: boolean; error?: string } {
    switch (trigger.type) {
      case TriggerType.DATETIME:
        const date = new Date(trigger.at);
        if (isNaN(date.getTime())) {
          return { valid: false, error: 'Invalid datetime format' };
        }
        return { valid: true };

      case TriggerType.CRON:
        const parts = trigger.pattern.trim().split(/\s+/);
        if (parts.length < 5) {
          return { valid: false, error: 'Cron pattern must have at least 5 fields' };
        }
        const nextRun = this.getNextCronTime(trigger.pattern);
        if (!nextRun) {
          return { valid: false, error: 'Could not calculate next cron run' };
        }
        return { valid: true };

      case TriggerType.EVENT:
        if (!trigger.event || trigger.event.trim().length === 0) {
          return { valid: false, error: 'Event name is required' };
        }
        return { valid: true };

      case TriggerType.FILE:
        if (!trigger.path || trigger.path.trim().length === 0) {
          return { valid: false, error: 'File path is required' };
        }
        if (!['created', 'modified', 'deleted'].includes(trigger.event)) {
          return { valid: false, error: 'File event must be created, modified, or deleted' };
        }
        return { valid: true };

      case TriggerType.MANUAL:
        return { valid: true };

      default:
        return { valid: false, error: 'Unknown trigger type' };
    }
  }

  /**
   * Clear file state tracking
   */
  clearFileStates(): void {
    this.fileStates.clear();
  }
}
