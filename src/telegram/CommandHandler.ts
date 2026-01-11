import { CodexTelegramBot } from './TelegramBot.js';
import { TaskExecutor } from '../core/TaskExecutor.js';
import { TaskCommand } from './types.js';

export class CommandHandler {
  private bot: CodexTelegramBot;
  private taskExecutor: TaskExecutor;
  private activeTasks: Map<string, TaskCommand> = new Map();

  constructor(bot: CodexTelegramBot, taskExecutor: TaskExecutor) {
    this.bot = bot;
    this.taskExecutor = taskExecutor;
    this.setupTaskExecutorEvents();
    this.setupCommandHandlers();
  }

  private setupTaskExecutorEvents(): void {
    this.taskExecutor.on('taskStarted', (taskId: string) => {
      this.bot.sendTaskProgress({
        taskId,
        status: 'in_progress',
        message: 'Task execution started'
      });
    });

    this.taskExecutor.on('taskProgress', (taskId: string, progress: number, message: string) => {
      this.bot.sendTaskProgress({
        taskId,
        status: 'in_progress',
        message,
        progress
      });
    });

    this.taskExecutor.on('taskCompleted', (taskId: string, result: any) => {
      this.bot.sendTaskProgress({
        taskId,
        status: 'completed',
        message: `Task completed successfully\n\`\`\`\n${JSON.stringify(result, null, 2)}\n\`\`\``
      });
      this.activeTasks.delete(taskId);
    });

    this.taskExecutor.on('taskFailed', (taskId: string, error: Error) => {
      this.bot.sendTaskProgress({
        taskId,
        status: 'failed',
        message: `Task failed: ${error.message}`
      });
      this.activeTasks.delete(taskId);
    });
  }

  private setupCommandHandlers(): void {
    this.bot.onMessage(async (message: string, chatId: string) => {
      try {
        await this.handleCommand(message);
      } catch (error) {
        console.error('Error handling command:', error);
        await this.bot.sendMessage(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    });
  }

  private async handleCommand(message: string): Promise<void> {
    const trimmed = message.trim();
    
    if (trimmed.startsWith('/task ')) {
      await this.executeTask(trimmed.substring(6));
    } else if (trimmed === '/status') {
      await this.showStatus();
    } else if (trimmed === '/help') {
      await this.showHelp();
    } else if (trimmed.startsWith('/')) {
      await this.bot.sendMessage('Unknown command. Type /help for available commands.');
    }
  }

  private async executeTask(description: string): Promise<void> {
    if (!description.trim()) {
      await this.bot.sendMessage('Please provide a task description. Example: `/task create a simple calculator`');
      return;
    }

    const taskId = this.generateTaskId();
    const taskCommand: TaskCommand = {
      taskId,
      description,
      timestamp: Date.now()
    };

    this.activeTasks.set(taskId, taskCommand);

    await this.bot.sendTaskProgress({
      taskId,
      status: 'pending',
      message: `Task queued: ${description}`
    });

    try {
      await this.taskExecutor.submitTask({
        id: taskId,
        description,
        type: 'code',
        metadata: {
          source: 'telegram',
          timestamp: taskCommand.timestamp
        }
      });
    } catch (error) {
      this.activeTasks.delete(taskId);
      await this.bot.sendTaskProgress({
        taskId,
        status: 'failed',
        message: `Failed to submit task: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    }
  }

  private async showStatus(): Promise<void> {
    if (this.activeTasks.size === 0) {
      await this.bot.sendMessage('No active tasks.');
      return;
    }

    const taskList = Array.from(this.activeTasks.values())
      .map(task => `• *${task.taskId}*: ${task.description}`)
      .join('\n');

    await this.bot.sendMessage(`*Active Tasks:*\n${taskList}`);
  }

  private async showHelp(): Promise<void> {
    const helpText = `*CODEX Telegram Bot Commands:*

/task <description> - Execute a new task
/status - Show active tasks
/help - Show this help message

*Examples:*
\`/task create a todo app in React\`
\`/task fix the bug in authentication\`
\`/task refactor the user service\``;

    await this.bot.sendMessage(helpText);
  }

  private generateTaskId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
  }
}