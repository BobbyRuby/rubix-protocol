import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { TelegramTask, TaskProgress } from './types';

export class TaskManager extends EventEmitter {
  private tasks: Map<string, TelegramTask> = new Map();
  private userTasks: Map<number, Set<string>> = new Map();

  createTask(chatId: number, userId: number, messageId: number, description: string): TelegramTask {
    const taskId = uuidv4();
    const task: TelegramTask = {
      id: taskId,
      chatId,
      userId,
      description,
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
      messageId
    };

    this.tasks.set(taskId, task);
    
    if (!this.userTasks.has(userId)) {
      this.userTasks.set(userId, new Set());
    }
    this.userTasks.get(userId)!.add(taskId);

    this.emit('taskCreated', task);
    return task;
  }

  getTask(taskId: string): TelegramTask | undefined {
    return this.tasks.get(taskId);
  }

  getUserTasks(userId: number): TelegramTask[] {
    const taskIds = this.userTasks.get(userId) || new Set();
    return Array.from(taskIds)
      .map(id => this.tasks.get(id))
      .filter((task): task is TelegramTask => task !== undefined)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  updateTaskStatus(taskId: string, status: TelegramTask['status']): boolean {
    const task = this.tasks.get(taskId);
    if (!task) {
      return false;
    }

    task.status = status;
    task.updatedAt = new Date();
    
    this.emit('taskStatusChanged', task);
    return true;
  }

  cancelUserTasks(userId: number): TelegramTask[] {
    const userTasks = this.getUserTasks(userId);
    const cancelledTasks = userTasks.filter(task => 
      task.status === 'pending' || task.status === 'running'
    );

    for (const task of cancelledTasks) {
      this.updateTaskStatus(task.id, 'cancelled');
    }

    return cancelledTasks;
  }

  reportProgress(taskId: string, progress: TaskProgress): void {
    const task = this.tasks.get(taskId);
    if (task) {
      this.emit('taskProgress', task, progress);
    }
  }

  cleanup(): void {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    for (const [taskId, task] of this.tasks.entries()) {
      if (task.updatedAt < oneDayAgo && 
          (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled')) {
        this.tasks.delete(taskId);
        
        const userTaskSet = this.userTasks.get(task.userId);
        if (userTaskSet) {
          userTaskSet.delete(taskId);
          if (userTaskSet.size === 0) {
            this.userTasks.delete(task.userId);
          }
        }
      }
    }
  }
}