import { TelegramBot, TelegramMessage } from './TelegramBot';
import { CommandHandler } from './CommandHandler';
import { CommandParser } from './CommandParser';
import { TaskManager } from './TaskManager';
import { CommandContext } from './types';

export class TelegramInterface {
  private bot: TelegramBot;
  private taskManager: TaskManager;
  private commandHandler: CommandHandler;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(botToken: string) {
    this.bot = new TelegramBot(botToken);
    this.taskManager = new TaskManager();
    this.commandHandler = new CommandHandler(this.bot, this.taskManager);

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.bot.on('message', (message: TelegramMessage) => {
      this.handleMessage(message);
    });

    this.bot.on('error', (error: Error) => {
      console.error('Telegram bot error:', error);
    });
  }

  private async handleMessage(message: TelegramMessage): Promise<void> {
    if (!message.text || !message.from) {
      return;
    }

    const command = CommandParser.parse(message.text);
    const context: CommandContext = {
      chatId: message.chat.id,
      userId: message.from.id,
      messageId: message.message_id,
      username: message.from.username
    };

    try {
      await this.commandHandler.handleCommand(command, context);
    } catch (error) {
      console.error('Error handling message:', error);
      
      await this.bot.sendMessage(
        context.chatId,
        '❌ Sorry, an error occurred while processing your request. Please try again later.',
        context.messageId
      );
    }
  }

  start(): void {
    console.log('Starting Telegram interface...');
    
    this.bot.startPolling();
    
    this.cleanupInterval = setInterval(() => {
      this.taskManager.cleanup();
    }, 60 * 60 * 1000);
    
    console.log('Telegram interface started successfully');
  }

  stop(): void {
    console.log('Stopping Telegram interface...');
    
    this.bot.stopPolling();
    
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    console.log('Telegram interface stopped');
  }

  async sendMessage(chatId: number, text: string): Promise<void> {
    await this.bot.sendMessage(chatId, text);
  }

  getTaskManager(): TaskManager {
    return this.taskManager;
  }
}