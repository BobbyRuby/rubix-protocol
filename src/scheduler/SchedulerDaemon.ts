/**
 * SchedulerDaemon
 *
 * Background process that monitors triggers and executes scheduled tasks.
 * Spawns Claude CLI with context from god-agent memory.
 */

import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import type { MemoryEngine } from '../core/MemoryEngine.js';
import { TaskStore } from './TaskStore.js';
import { TriggerEvaluator } from './TriggerEvaluator.js';
import { ContextBuilder } from './ContextBuilder.js';
import {
  TaskStatus,
  RunStatus,
  TriggerType,
  type ScheduledTask,
  type TaskRun,
  type SchedulerConfig,
  type EventEntry,
  DEFAULT_SCHEDULER_CONFIG
} from './types.js';

/**
 * Events emitted by SchedulerDaemon
 */
export interface SchedulerEvents {
  'task:started': { task: ScheduledTask; run: TaskRun };
  'task:completed': { task: ScheduledTask; run: TaskRun; output: string };
  'task:failed': { task: ScheduledTask; run: TaskRun; error: string };
  'task:decision': { task: ScheduledTask; run: TaskRun; prompt: string };
  'tick': { timestamp: Date; pendingTasks: number };
  'started': { config: SchedulerConfig };
  'stopped': { reason: string };
  'error': { error: Error; context: string };
}

export class SchedulerDaemon extends EventEmitter {
  private config: SchedulerConfig;
  private engine: MemoryEngine;
  private taskStore: TaskStore;
  private triggerEvaluator: TriggerEvaluator;
  private contextBuilder: ContextBuilder;
  private running: boolean = false;
  private tickInterval: NodeJS.Timeout | null = null;
  private runningTasks: Map<string, { task: ScheduledTask; run: TaskRun; process?: ReturnType<typeof spawn> }> = new Map();

  constructor(
    engine: MemoryEngine,
    config: Partial<SchedulerConfig> = {}
  ) {
    super();
    this.config = { ...DEFAULT_SCHEDULER_CONFIG, ...config };
    this.engine = engine;

    // Initialize components using the engine's database
    const db = engine.getStorage().getDb();
    this.taskStore = new TaskStore(db);
    this.triggerEvaluator = new TriggerEvaluator({
      enableFileWatching: this.config.enableFileWatching
    });
    this.contextBuilder = new ContextBuilder();
  }

  /**
   * Start the scheduler daemon
   */
  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    this.emit('started', { config: this.config });

    // Run first tick immediately
    this.tick().catch(err => {
      this.emit('error', { error: err, context: 'initial tick' });
    });

    // Set up interval for subsequent ticks
    this.tickInterval = setInterval(() => {
      this.tick().catch(err => {
        this.emit('error', { error: err, context: 'scheduled tick' });
      });
    }, this.config.checkInterval);
  }

  /**
   * Stop the scheduler daemon
   */
  stop(reason: string = 'Manual stop'): void {
    if (!this.running) {
      return;
    }

    this.running = false;

    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }

    // Kill any running task processes
    for (const [, { process }] of this.runningTasks) {
      if (process) {
        process.kill();
      }
    }
    this.runningTasks.clear();

    this.emit('stopped', { reason });
  }

  /**
   * Check if daemon is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Perform a single tick - check triggers and execute tasks
   */
  async tick(): Promise<void> {
    if (!this.running) return;

    // Get unconsumed events for event triggers
    const events = this.taskStore.getUnconsumedEvents();

    // Get pending tasks
    const pendingTasks = this.taskStore.getPendingTasks();

    this.emit('tick', {
      timestamp: new Date(),
      pendingTasks: pendingTasks.length
    });

    // Check concurrent limit
    const currentRunning = this.runningTasks.size;
    const availableSlots = this.config.maxConcurrent - currentRunning;

    if (availableSlots <= 0) {
      return;
    }

    // Evaluate and execute tasks
    let executed = 0;
    for (const task of pendingTasks) {
      if (executed >= availableSlots) break;

      const evaluation = this.triggerEvaluator.shouldTrigger(task, events);

      if (evaluation.shouldTrigger) {
        await this.executeTask(task, events);
        executed++;
      } else if (evaluation.nextRun) {
        // Update next run time if calculated
        this.taskStore.updateNextRun(task.id, evaluation.nextRun);
      }
    }
  }

  /**
   * Execute a scheduled task
   */
  private async executeTask(task: ScheduledTask, events: EventEntry[]): Promise<void> {
    // Mark task as running
    this.taskStore.updateTaskStatus(task.id, TaskStatus.RUNNING);

    // Create run record
    const run = this.taskStore.createRun(task.id);

    // Consume event if this was event-triggered
    if (task.trigger.type === TriggerType.EVENT) {
      const matchingEvent = events.find(
        e => e.event === (task.trigger as { type: TriggerType.EVENT; event: string }).event && !e.consumed
      );
      if (matchingEvent) {
        this.taskStore.consumeEvent(matchingEvent.id);
      }
    }

    this.runningTasks.set(task.id, { task, run });
    this.emit('task:started', { task, run });

    try {
      // Build context
      const context = await this.contextBuilder.build(task, this.engine);

      // Build prompt
      const prompt = this.contextBuilder.buildPrompt(task, context);

      // Execute Claude CLI
      const output = await this.spawnClaude(prompt, task.id);

      // Store result in memory
      const resultEntry = await this.engine.store(
        `Task Result: ${task.name}\n\n${output}`,
        {
          tags: ['scheduler', 'task-result', `task:${task.id}`],
          importance: 0.7
        }
      );

      // Complete the run
      this.taskStore.completeRun(run.id, RunStatus.SUCCESS, {
        resultMemoryId: resultEntry.id,
        output
      });

      // Update task
      this.taskStore.recordTaskRun(task.id);

      // Calculate next run for cron tasks
      if (task.trigger.type === TriggerType.CRON) {
        const nextRun = this.triggerEvaluator.calculateNextRun(task.trigger);
        this.taskStore.updateNextRun(task.id, nextRun);
        this.taskStore.updateTaskStatus(task.id, TaskStatus.PENDING);
      } else {
        this.taskStore.updateTaskStatus(task.id, TaskStatus.COMPLETED);
      }

      this.emit('task:completed', { task, run, output });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      this.taskStore.completeRun(run.id, RunStatus.FAILED, {
        error: errorMessage
      });

      this.taskStore.updateTaskStatus(task.id, TaskStatus.FAILED);
      this.emit('task:failed', { task, run, error: errorMessage });

    } finally {
      this.runningTasks.delete(task.id);
    }
  }

  /**
   * Spawn Claude CLI and run the prompt
   */
  private spawnClaude(prompt: string, taskId: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = [...this.config.claudeArgs, '--prompt', prompt];

      const child = spawn(this.config.claudeCommand, args, {
        cwd: this.config.workingDirectory,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: process.platform === 'win32'
      });

      let output = '';
      let errorOutput = '';

      child.stdout?.on('data', (data) => {
        output += data.toString();
      });

      child.stderr?.on('data', (data) => {
        errorOutput += data.toString();
      });

      // Set up timeout
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error(`Task ${taskId} timed out after ${this.config.taskTimeout}ms`));
      }, this.config.taskTimeout);

      child.on('close', (code) => {
        clearTimeout(timeout);

        if (code === 0) {
          resolve(output.trim());
        } else {
          reject(new Error(`Claude exited with code ${code}: ${errorOutput}`));
        }
      });

      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      // Store process reference for potential cancellation
      const runningTask = this.runningTasks.get(taskId);
      if (runningTask) {
        runningTask.process = child;
      }
    });
  }

  /**
   * Manually trigger a specific task
   */
  async triggerTask(taskId: string): Promise<TaskRun | null> {
    const task = this.taskStore.getTask(taskId);
    if (!task) return null;

    // Check if already running
    if (this.runningTasks.has(taskId)) {
      throw new Error('Task is already running');
    }

    // Execute regardless of trigger conditions
    await this.executeTask(task, []);

    return this.taskStore.getRunsForTask(taskId, 1)[0] ?? null;
  }

  /**
   * Fire an event to trigger event-based tasks
   */
  fireEvent(event: string, payload?: Record<string, unknown>): EventEntry {
    const entry = this.taskStore.fireEvent(event, payload);

    // Trigger immediate tick if running
    if (this.running) {
      this.tick().catch(err => {
        this.emit('error', { error: err, context: `event:${event}` });
      });
    }

    return entry;
  }

  /**
   * Get the task store for direct access
   */
  getTaskStore(): TaskStore {
    return this.taskStore;
  }

  /**
   * Get running task info
   */
  getRunningTasks(): Array<{ taskId: string; task: ScheduledTask; run: TaskRun }> {
    return Array.from(this.runningTasks.entries()).map(([taskId, info]) => ({
      taskId,
      task: info.task,
      run: info.run
    }));
  }

  /**
   * Cancel a running task
   */
  cancelRunningTask(taskId: string): boolean {
    const runningTask = this.runningTasks.get(taskId);
    if (!runningTask) return false;

    if (runningTask.process) {
      runningTask.process.kill();
    }

    this.taskStore.completeRun(runningTask.run.id, RunStatus.CANCELLED);
    this.taskStore.updateTaskStatus(taskId, TaskStatus.CANCELLED);
    this.runningTasks.delete(taskId);

    return true;
  }
}
