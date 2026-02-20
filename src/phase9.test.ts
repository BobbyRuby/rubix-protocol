/**
 * Phase 9: Scheduler System Tests
 *
 * Tests for:
 * 1. TaskStore - CRUD operations, queries, statistics
 * 2. TriggerEvaluator - datetime, cron, event, file triggers
 * 3. ContextBuilder - memory context building
 * 4. SchedulerDaemon - basic setup and event firing
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryEngine } from './index.js';
import { TaskStore } from './scheduler/TaskStore.js';
import { TriggerEvaluator, DEFAULT_TRIGGER_EVALUATOR_CONFIG } from './scheduler/TriggerEvaluator.js';
import { ContextBuilder, DEFAULT_CONTEXT_BUILDER_CONFIG } from './scheduler/ContextBuilder.js';
import { SchedulerDaemon } from './scheduler/SchedulerDaemon.js';
import {
  TaskStatus,
  TriggerType,
  RunStatus,
  DEFAULT_SCHEDULER_CONFIG
} from './scheduler/types.js';
import type { ScheduleTrigger, CreateTaskInput } from './scheduler/types.js';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';

describe('Phase 9: TaskStore', () => {
  let engine: MemoryEngine;
  let taskStore: TaskStore;
  let testDbPath: string;

  beforeEach(async () => {
    testDbPath = join(process.cwd(), `test-phase9-taskstore-${Date.now()}.db`);

    try {
      if (existsSync(testDbPath)) rmSync(testDbPath);
      if (existsSync(testDbPath + '.idx')) rmSync(testDbPath + '.idx');
    } catch {
      // Ignore cleanup errors
    }

    engine = new MemoryEngine({
      storageConfig: {
        sqlitePath: testDbPath,

        enableWAL: false
      }
    });
    await engine.initialize();

    const db = engine.getStorage().getDb();
    taskStore = new TaskStore(db);
  });

  afterEach(async () => {
    try {
      if (engine) await engine.close();
    } catch {
      // Ignore close errors
    }
    try {
      if (existsSync(testDbPath)) rmSync(testDbPath);
      if (existsSync(testDbPath + '.idx')) rmSync(testDbPath + '.idx');
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should create a task with datetime trigger', () => {
    const input: CreateTaskInput = {
      name: 'Test Task',
      prompt: 'Do something with {context}',
      trigger: { type: TriggerType.DATETIME, at: '2025-12-31T23:59:59Z' }
    };

    const task = taskStore.createTask(input);

    expect(task.id).toBeDefined();
    expect(task.name).toBe('Test Task');
    expect(task.promptTemplate).toBe('Do something with {context}');
    expect(task.status).toBe(TaskStatus.PENDING);
    expect(task.trigger.type).toBe(TriggerType.DATETIME);
    expect(task.nextRun).toBeDefined();
    expect(task.runCount).toBe(0);
  });

  it('should create a task with cron trigger', () => {
    const input: CreateTaskInput = {
      name: 'Recurring Task',
      prompt: 'Run daily analysis',
      trigger: { type: TriggerType.CRON, pattern: '0 9 * * *' }
    };

    const task = taskStore.createTask(input);

    expect(task.trigger.type).toBe(TriggerType.CRON);
    if (task.trigger.type === TriggerType.CRON) {
      expect(task.trigger.pattern).toBe('0 9 * * *');
    }
  });

  it('should create a task with event trigger', () => {
    const input: CreateTaskInput = {
      name: 'Event Task',
      prompt: 'Handle event',
      trigger: { type: TriggerType.EVENT, event: 'trading_complete' }
    };

    const task = taskStore.createTask(input);

    expect(task.trigger.type).toBe(TriggerType.EVENT);
    if (task.trigger.type === TriggerType.EVENT) {
      expect(task.trigger.event).toBe('trading_complete');
    }
  });

  it('should create a task with manual trigger', () => {
    const input: CreateTaskInput = {
      name: 'Manual Task',
      prompt: 'Do something manually',
      trigger: { type: TriggerType.MANUAL }
    };

    const task = taskStore.createTask(input);

    expect(task.trigger.type).toBe(TriggerType.MANUAL);
  });

  it('should get a task by ID', () => {
    const input: CreateTaskInput = {
      name: 'Test Task',
      prompt: 'Test',
      trigger: { type: TriggerType.MANUAL }
    };

    const created = taskStore.createTask(input);
    const retrieved = taskStore.getTask(created.id);

    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe(created.id);
    expect(retrieved?.name).toBe('Test Task');
  });

  it('should return null for non-existent task', () => {
    const task = taskStore.getTask('non-existent-id');
    expect(task).toBeNull();
  });

  it('should update task status', () => {
    const input: CreateTaskInput = {
      name: 'Test',
      prompt: 'Test',
      trigger: { type: TriggerType.MANUAL }
    };

    const task = taskStore.createTask(input);
    taskStore.updateTaskStatus(task.id, TaskStatus.PAUSED);

    const updated = taskStore.getTask(task.id);
    expect(updated?.status).toBe(TaskStatus.PAUSED);
  });

  it('should delete a task', () => {
    const input: CreateTaskInput = {
      name: 'Test',
      prompt: 'Test',
      trigger: { type: TriggerType.MANUAL }
    };

    const task = taskStore.createTask(input);
    const deleted = taskStore.deleteTask(task.id);

    expect(deleted).toBe(true);
    expect(taskStore.getTask(task.id)).toBeNull();
  });

  it('should query tasks by status', () => {
    taskStore.createTask({
      name: 'Task 1',
      prompt: 'Test',
      trigger: { type: TriggerType.MANUAL }
    });

    taskStore.createTask({
      name: 'Task 2',
      prompt: 'Test',
      trigger: { type: TriggerType.MANUAL }
    });

    const task3 = taskStore.createTask({
      name: 'Task 3',
      prompt: 'Test',
      trigger: { type: TriggerType.MANUAL }
    });
    taskStore.updateTaskStatus(task3.id, TaskStatus.PAUSED);

    const pending = taskStore.queryTasks({ status: TaskStatus.PENDING });
    expect(pending.length).toBe(2);

    const paused = taskStore.queryTasks({ status: TaskStatus.PAUSED });
    expect(paused.length).toBe(1);
    expect(paused[0].name).toBe('Task 3');
  });

  it('should get tasks for an event', () => {
    taskStore.createTask({
      name: 'Event Task 1',
      prompt: 'Test',
      trigger: { type: TriggerType.EVENT, event: 'my_event' }
    });

    taskStore.createTask({
      name: 'Event Task 2',
      prompt: 'Test',
      trigger: { type: TriggerType.EVENT, event: 'my_event' }
    });

    taskStore.createTask({
      name: 'Other Task',
      prompt: 'Test',
      trigger: { type: TriggerType.EVENT, event: 'other_event' }
    });

    const tasks = taskStore.getTasksForEvent('my_event');
    expect(tasks.length).toBe(2);
    expect(tasks.every(t => t.name.startsWith('Event Task'))).toBe(true);
  });

  it('should create and complete task runs', () => {
    const task = taskStore.createTask({
      name: 'Test',
      prompt: 'Test',
      trigger: { type: TriggerType.MANUAL }
    });

    const run = taskStore.createRun(task.id);
    expect(run.id).toBeDefined();
    expect(run.taskId).toBe(task.id);
    expect(run.startedAt).toBeDefined();

    const completed = taskStore.completeRun(run.id, RunStatus.SUCCESS, {
      output: 'Task completed'
    });

    expect(completed?.status).toBe(RunStatus.SUCCESS);
    expect(completed?.completedAt).toBeDefined();
    expect(completed?.durationMs).toBeDefined();
    expect(completed?.output).toBe('Task completed');
  });

  it('should fire and consume events', () => {
    const event = taskStore.fireEvent('test_event', { key: 'value' });

    expect(event.id).toBeDefined();
    expect(event.event).toBe('test_event');
    expect(event.consumed).toBe(false);
    expect(event.payload).toEqual({ key: 'value' });

    const unconsumed = taskStore.getUnconsumedEvents('test_event');
    expect(unconsumed.length).toBe(1);

    taskStore.consumeEvent(event.id);

    const afterConsume = taskStore.getUnconsumedEvents('test_event');
    expect(afterConsume.length).toBe(0);
  });

  it('should get scheduler statistics', () => {
    taskStore.createTask({
      name: 'Task 1',
      prompt: 'Test',
      trigger: { type: TriggerType.MANUAL }
    });

    taskStore.createTask({
      name: 'Task 2',
      prompt: 'Test',
      trigger: { type: TriggerType.MANUAL }
    });

    taskStore.fireEvent('test_event');

    const stats = taskStore.getStats();
    expect(stats.totalTasks).toBe(2);
    expect(stats.pendingTasks).toBe(2);
    expect(stats.eventsInQueue).toBe(1);
  });
});

describe('Phase 9: TriggerEvaluator', () => {
  it('should use default configuration', () => {
    // Just verify the default config values
    expect(DEFAULT_TRIGGER_EVALUATOR_CONFIG.datetimeTolerance).toBe(60000);
    expect(DEFAULT_TRIGGER_EVALUATOR_CONFIG.enableFileWatching).toBe(false);
  });

  it('should evaluate datetime trigger - not yet', () => {
    const evaluator = new TriggerEvaluator();
    const futureDate = new Date(Date.now() + 3600000).toISOString(); // 1 hour from now

    const result = evaluator.shouldTrigger({
      id: 'test',
      name: 'Test',
      promptTemplate: 'Test',
      trigger: { type: TriggerType.DATETIME, at: futureDate },
      status: TaskStatus.PENDING,
      priority: 5,
      notification: {},
      createdAt: new Date(),
      runCount: 0
    });

    expect(result.shouldTrigger).toBe(false);
    expect(result.nextRun).toBeDefined();
  });

  it('should evaluate datetime trigger - time reached', () => {
    const evaluator = new TriggerEvaluator({ datetimeTolerance: 60000 });
    const now = new Date().toISOString();

    const result = evaluator.shouldTrigger({
      id: 'test',
      name: 'Test',
      promptTemplate: 'Test',
      trigger: { type: TriggerType.DATETIME, at: now },
      status: TaskStatus.PENDING,
      priority: 5,
      notification: {},
      createdAt: new Date(),
      runCount: 0
    });

    expect(result.shouldTrigger).toBe(true);
    expect(result.reason).toContain('Datetime trigger reached');
  });

  it('should evaluate event trigger - no matching event', () => {
    const evaluator = new TriggerEvaluator();

    const result = evaluator.shouldTrigger({
      id: 'test',
      name: 'Test',
      promptTemplate: 'Test',
      trigger: { type: TriggerType.EVENT, event: 'my_event' },
      status: TaskStatus.PENDING,
      priority: 5,
      notification: {},
      createdAt: new Date(),
      runCount: 0
    }, []);

    expect(result.shouldTrigger).toBe(false);
    expect(result.reason).toContain('Waiting for event');
  });

  it('should evaluate event trigger - matching event', () => {
    const evaluator = new TriggerEvaluator();

    const result = evaluator.shouldTrigger({
      id: 'test',
      name: 'Test',
      promptTemplate: 'Test',
      trigger: { type: TriggerType.EVENT, event: 'my_event' },
      status: TaskStatus.PENDING,
      priority: 5,
      notification: {},
      createdAt: new Date(),
      runCount: 0
    }, [{
      id: 'event1',
      event: 'my_event',
      firedAt: new Date(),
      consumed: false
    }]);

    expect(result.shouldTrigger).toBe(true);
    expect(result.reason).toContain('Event received');
  });

  it('should evaluate manual trigger - never auto-triggers', () => {
    const evaluator = new TriggerEvaluator();

    const result = evaluator.shouldTrigger({
      id: 'test',
      name: 'Test',
      promptTemplate: 'Test',
      trigger: { type: TriggerType.MANUAL },
      status: TaskStatus.PENDING,
      priority: 5,
      notification: {},
      createdAt: new Date(),
      runCount: 0
    });

    expect(result.shouldTrigger).toBe(false);
    expect(result.reason).toContain('Manual trigger');
  });

  it('should validate datetime trigger', () => {
    const evaluator = new TriggerEvaluator();

    const valid = evaluator.validateTrigger({
      type: TriggerType.DATETIME,
      at: '2025-12-31T23:59:59Z'
    });
    expect(valid.valid).toBe(true);

    const invalid = evaluator.validateTrigger({
      type: TriggerType.DATETIME,
      at: 'not-a-date'
    });
    expect(invalid.valid).toBe(false);
  });

  it('should validate cron trigger', () => {
    const evaluator = new TriggerEvaluator();

    const valid = evaluator.validateTrigger({
      type: TriggerType.CRON,
      pattern: '0 9 * * 1-5'
    });
    expect(valid.valid).toBe(true);

    const invalid = evaluator.validateTrigger({
      type: TriggerType.CRON,
      pattern: 'invalid'
    });
    expect(invalid.valid).toBe(false);
  });

  it('should validate event trigger', () => {
    const evaluator = new TriggerEvaluator();

    const valid = evaluator.validateTrigger({
      type: TriggerType.EVENT,
      event: 'my_event'
    });
    expect(valid.valid).toBe(true);

    const invalid = evaluator.validateTrigger({
      type: TriggerType.EVENT,
      event: ''
    });
    expect(invalid.valid).toBe(false);
  });

  it('should calculate next cron run time', () => {
    const evaluator = new TriggerEvaluator();

    // Every day at 9am
    const nextRun = evaluator.calculateNextRun({
      type: TriggerType.CRON,
      pattern: '0 9 * * *'
    });

    expect(nextRun).toBeDefined();
    expect(nextRun?.getHours()).toBe(9);
    expect(nextRun?.getMinutes()).toBe(0);
  });
});

describe('Phase 9: ContextBuilder', () => {
  let engine: MemoryEngine;
  let contextBuilder: ContextBuilder;
  let testDbPath: string;

  beforeEach(async () => {
    testDbPath = join(process.cwd(), `test-phase9-context-${Date.now()}.db`);

    try {
      if (existsSync(testDbPath)) rmSync(testDbPath);
      if (existsSync(testDbPath + '.idx')) rmSync(testDbPath + '.idx');
    } catch {
      // Ignore cleanup errors
    }

    engine = new MemoryEngine({
      storageConfig: {
        sqlitePath: testDbPath,

        enableWAL: false
      }
    });
    await engine.initialize();
    contextBuilder = new ContextBuilder();
  });

  afterEach(async () => {
    try {
      if (engine) await engine.close();
    } catch {
      // Ignore close errors
    }
    try {
      if (existsSync(testDbPath)) rmSync(testDbPath);
      if (existsSync(testDbPath + '.idx')) rmSync(testDbPath + '.idx');
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should use default configuration', () => {
    expect(DEFAULT_CONTEXT_BUILDER_CONFIG.maxMemories).toBe(10);
    expect(DEFAULT_CONTEXT_BUILDER_CONFIG.maxContextLength).toBe(8000);
  });

  it('should build empty context when no memories', async () => {
    const context = await contextBuilder.build({
      id: 'test',
      name: 'Test',
      promptTemplate: 'Test',
      trigger: { type: TriggerType.MANUAL },
      status: TaskStatus.PENDING,
      priority: 5,
      notification: {},
      createdAt: new Date(),
      runCount: 0
    }, engine);

    expect(context.memories.length).toBe(0);
    expect(context.formattedContext).toBe('[No context available]');
  });

  it('should build context from contextIds', async () => {
    const entry1 = await engine.store('First memory content', {
      tags: ['test'],
      importance: 0.8
    });

    const entry2 = await engine.store('Second memory content', {
      tags: ['test'],
      importance: 0.6
    });

    const context = await contextBuilder.build({
      id: 'test',
      name: 'Test',
      promptTemplate: 'Test',
      trigger: { type: TriggerType.MANUAL },
      contextIds: [entry1.id, entry2.id],
      status: TaskStatus.PENDING,
      priority: 5,
      notification: {},
      createdAt: new Date(),
      runCount: 0
    }, engine);

    expect(context.memories.length).toBe(2);
    expect(context.memories[0].content).toBe('First memory content');
    expect(context.memories[1].content).toBe('Second memory content');
    expect(context.formattedContext).toContain('First memory content');
    expect(context.formattedContext).toContain('Second memory content');
  });

  it('should build context from contextQuery', async () => {
    await engine.store('Trading analysis results', {
      tags: ['trading'],
      importance: 0.9
    });

    await engine.store('Unrelated content', {
      tags: ['other'],
      importance: 0.5
    });

    const context = await contextBuilder.build({
      id: 'test',
      name: 'Test',
      promptTemplate: 'Test',
      trigger: { type: TriggerType.MANUAL },
      contextQuery: 'trading analysis',
      status: TaskStatus.PENDING,
      priority: 5,
      notification: {},
      createdAt: new Date(),
      runCount: 0
    }, engine);

    expect(context.memories.length).toBeGreaterThan(0);
    // The trading content should rank higher
  });

  it('should build prompt with context', () => {
    const task = {
      id: 'test',
      name: 'Test',
      promptTemplate: 'Analyze this: {context}',
      trigger: { type: TriggerType.MANUAL } as ScheduleTrigger,
      status: TaskStatus.PENDING as TaskStatus,
      priority: 5,
      notification: {},
      createdAt: new Date(),
      runCount: 0
    };

    const context = {
      memories: [{ id: '1', content: 'Test content' }],
      formattedContext: 'Test content'
    };

    const prompt = contextBuilder.buildPrompt(task, context);
    expect(prompt).toBe('Analyze this: Test content');
  });

  it('should append context if no placeholder', () => {
    const task = {
      id: 'test',
      name: 'Test',
      promptTemplate: 'Do the analysis',
      trigger: { type: TriggerType.MANUAL } as ScheduleTrigger,
      status: TaskStatus.PENDING as TaskStatus,
      priority: 5,
      notification: {},
      createdAt: new Date(),
      runCount: 0
    };

    const context = {
      memories: [{ id: '1', content: 'Test content' }],
      formattedContext: 'Test content'
    };

    const prompt = contextBuilder.buildPrompt(task, context);
    expect(prompt).toContain('Do the analysis');
    expect(prompt).toContain('Context:');
    expect(prompt).toContain('Test content');
  });
});

describe('Phase 9: SchedulerDaemon', () => {
  let engine: MemoryEngine;
  let scheduler: SchedulerDaemon;
  let testDbPath: string;

  beforeEach(async () => {
    testDbPath = join(process.cwd(), `test-phase9-scheduler-${Date.now()}.db`);

    try {
      if (existsSync(testDbPath)) rmSync(testDbPath);
      if (existsSync(testDbPath + '.idx')) rmSync(testDbPath + '.idx');
    } catch {
      // Ignore cleanup errors
    }

    engine = new MemoryEngine({
      storageConfig: {
        sqlitePath: testDbPath,

        enableWAL: false
      }
    });
    await engine.initialize();
    scheduler = new SchedulerDaemon(engine, {
      checkInterval: 1000 // 1 second for testing
    });
  });

  afterEach(async () => {
    try {
      if (scheduler && scheduler.isRunning()) {
        scheduler.stop('Test cleanup');
      }
    } catch {
      // Ignore stop errors
    }
    try {
      if (engine) await engine.close();
    } catch {
      // Ignore close errors
    }
    try {
      if (existsSync(testDbPath)) rmSync(testDbPath);
      if (existsSync(testDbPath + '.idx')) rmSync(testDbPath + '.idx');
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should use default configuration', () => {
    expect(DEFAULT_SCHEDULER_CONFIG.checkInterval).toBe(60000);
    expect(DEFAULT_SCHEDULER_CONFIG.maxConcurrent).toBe(3);
    expect(DEFAULT_SCHEDULER_CONFIG.taskTimeout).toBe(300000);
  });

  it('should not be running initially', () => {
    expect(scheduler.isRunning()).toBe(false);
  });

  it('should start and stop', () => {
    scheduler.start();
    expect(scheduler.isRunning()).toBe(true);

    scheduler.stop('Test');
    expect(scheduler.isRunning()).toBe(false);
  });

  it('should fire events', () => {
    const taskStore = scheduler.getTaskStore();

    // Create a task listening for the event
    taskStore.createTask({
      name: 'Event Listener',
      prompt: 'Handle event',
      trigger: { type: TriggerType.EVENT, event: 'test_event' }
    });

    const event = scheduler.fireEvent('test_event', { data: 'test' });

    expect(event.event).toBe('test_event');
    expect(event.payload).toEqual({ data: 'test' });
  });

  it('should get running tasks (empty when not executing)', () => {
    const running = scheduler.getRunningTasks();
    expect(running).toEqual([]);
  });

  it('should emit started event', async () => {
    const startedPromise = new Promise<void>((resolve) => {
      scheduler.once('started', () => resolve());
    });

    scheduler.start();
    await startedPromise;

    expect(scheduler.isRunning()).toBe(true);
    scheduler.stop('Test');
  });

  it('should emit stopped event', async () => {
    scheduler.start();

    const stoppedPromise = new Promise<{ reason: string }>((resolve) => {
      scheduler.once('stopped', (data) => resolve(data));
    });

    scheduler.stop('Test reason');
    const result = await stoppedPromise;

    expect(result.reason).toBe('Test reason');
  });
});

describe('Phase 9: Configuration Defaults', () => {
  it('should have correct default scheduler config', () => {
    expect(DEFAULT_SCHEDULER_CONFIG.checkInterval).toBe(60000);
    expect(DEFAULT_SCHEDULER_CONFIG.maxConcurrent).toBe(3);
    expect(DEFAULT_SCHEDULER_CONFIG.taskTimeout).toBe(300000);
    expect(DEFAULT_SCHEDULER_CONFIG.claudeCommand).toBe('claude');
  });

  it('should have correct default trigger evaluator config', () => {
    expect(DEFAULT_TRIGGER_EVALUATOR_CONFIG.datetimeTolerance).toBe(60000);
    expect(DEFAULT_TRIGGER_EVALUATOR_CONFIG.enableFileWatching).toBe(false);
  });

  it('should have correct default context builder config', () => {
    expect(DEFAULT_CONTEXT_BUILDER_CONFIG.maxMemories).toBe(10);
    expect(DEFAULT_CONTEXT_BUILDER_CONFIG.maxContextLength).toBe(8000);
    expect(DEFAULT_CONTEXT_BUILDER_CONFIG.includeMetadata).toBe(true);
  });

  it('should have all TaskStatus values', () => {
    expect(TaskStatus.PENDING).toBe('pending');
    expect(TaskStatus.RUNNING).toBe('running');
    expect(TaskStatus.COMPLETED).toBe('completed');
    expect(TaskStatus.FAILED).toBe('failed');
    expect(TaskStatus.PAUSED).toBe('paused');
    expect(TaskStatus.CANCELLED).toBe('cancelled');
  });

  it('should have all TriggerType values', () => {
    expect(TriggerType.DATETIME).toBe('datetime');
    expect(TriggerType.CRON).toBe('cron');
    expect(TriggerType.EVENT).toBe('event');
    expect(TriggerType.FILE).toBe('file');
    expect(TriggerType.MANUAL).toBe('manual');
  });

  it('should have all RunStatus values', () => {
    expect(RunStatus.SUCCESS).toBe('success');
    expect(RunStatus.FAILED).toBe('failed');
    expect(RunStatus.NEEDS_DECISION).toBe('needs_decision');
    expect(RunStatus.TIMEOUT).toBe('timeout');
    expect(RunStatus.CANCELLED).toBe('cancelled');
  });
});
