import { TaskExecutor } from '../task-execution/TaskExecutor.js';
import { Memory } from '../memory/Memory.js';
import { Capabilities } from '../capabilities/Capabilities.js';
import { PlaywrightService } from '../playwright/PlaywrightService.js';
import { VerificationService } from '../verification/VerificationService.js';
import { TelegramMessage, TelegramCallbackQuery } from './types.js';

export class TelegramHandler {
  private taskExecutor: TaskExecutor;
  private memory: Memory;
  private capabilities: Capabilities;
  private playwright: PlaywrightService;
  private verification: VerificationService;

  constructor() {
    this.memory = new Memory();
    this.capabilities = new Capabilities();
    this.playwright = new PlaywrightService();
    this.verification = new VerificationService();
    this.taskExecutor = new TaskExecutor(
      this.memory,
      this.capabilities,
      this.playwright,
      this.verification
    );
  }

  public async handleMessage(message: TelegramMessage): Promise<void> {
    try {
      const chatId = message.chat.id;
      const text = message.text;

      if (!text) {
        return;
      }

      if (text.startsWith('/start')) {
        await this.handleStartCommand(chatId);
        return;
      }

      if (text.startsWith('/help')) {
        await this.handleHelpCommand(chatId);
        return;
      }

      if (text.startsWith('/task')) {
        const taskDescription = text.replace('/task', '').trim();
        await this.handleTaskCommand(chatId, taskDescription);
        return;
      }

      await this.handleGeneralMessage(chatId, text);
    } catch (error) {
      console.error('Error handling message:', error);
    }
  }

  public async handleCallbackQuery(query: TelegramCallbackQuery): Promise<void> {
    try {
      const chatId = query.message?.chat.id;
      const data = query.data;

      if (!chatId || !data) {
        return;
      }

      if (data.startsWith('confirm_')) {
        await this.handleConfirmation(chatId, data);
      } else if (data.startsWith('cancel_')) {
        await this.handleCancellation(chatId, data);
      }
    } catch (error) {
      console.error('Error handling callback query:', error);
    }
  }

  private async handleStartCommand(chatId: number): Promise<void> {
    const welcomeMessage = `
Welcome to the AI Task Assistant! 🤖

I can help you execute various tasks. Here's what you can do:

/task <description> - Execute a specific task
/help - Show this help message

Example: /task "Take a screenshot of google.com"
    `;
    // In a real implementation, you would send this message via the bot
    console.log(`Sending to chat ${chatId}:`, welcomeMessage);
  }

  private async handleHelpCommand(chatId: number): Promise<void> {
    const helpMessage = `
Available commands:

/start - Start using the bot
/task <description> - Execute a task
/help - Show this help

The bot can perform various automated tasks using web browsers and other tools.
    `;
    console.log(`Sending to chat ${chatId}:`, helpMessage);
  }

  private async handleTaskCommand(chatId: number, taskDescription: string): Promise<void> {
    if (!taskDescription) {
      console.log(`Sending to chat ${chatId}:`, 'Please provide a task description. Example: /task "Take a screenshot of google.com"');
      return;
    }

    try {
      console.log(`Sending to chat ${chatId}:`, `Executing task: ${taskDescription}`);
      
      const result = await this.taskExecutor.execute({
        description: taskDescription,
        type: 'general',
        parameters: {}
      });

      const successMessage = `Task completed successfully! ✅\n\nResult: ${JSON.stringify(result, null, 2)}`;
      console.log(`Sending to chat ${chatId}:`, successMessage);
    } catch (error) {
      const errorMessage = `Task failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      console.log(`Sending to chat ${chatId}:`, errorMessage);
    }
  }

  private async handleGeneralMessage(chatId: number, text: string): Promise<void> {
    const response = `I received your message: "${text}"\n\nTo execute a task, use: /task <description>`;
    console.log(`Sending to chat ${chatId}:`, response);
  }

  private async handleConfirmation(chatId: number, data: string): Promise<void> {
    const taskId = data.replace('confirm_', '');
    console.log(`Sending to chat ${chatId}:`, `Confirmed task: ${taskId}`);
  }

  private async handleCancellation(chatId: number, data: string): Promise<void> {
    const taskId = data.replace('cancel_', '');
    console.log(`Sending to chat ${chatId}:`, `Cancelled task: ${taskId}`);
  }

  private async handleTaskExecution(chatId: number, taskDescription: string): Promise<void> {
    try {
      console.log(`Sending to chat ${chatId}:`, `Starting task execution: ${taskDescription}`);
      
      const result = await this.taskExecutor.execute({
        description: taskDescription,
        type: 'automation',
        parameters: {
          chatId,
          source: 'telegram'
        }
      });

      console.log(`Sending to chat ${chatId}:`, `Task completed: ${JSON.stringify(result)}`);
    } catch (error) {
      console.log(`Sending to chat ${chatId}:`, `Task failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}