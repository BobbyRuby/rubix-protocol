import TelegramBotAPI from 'node-telegram-bot-api';
import { TelegramBotConfig, TelegramMessage } from './types.js';
import { TelegramHandler } from './TelegramHandler.js';
import type { TaskExecutor } from '../codex/TaskExecutor.js';
import type { CommunicationManager } from '../communication/CommunicationManager.js';
import type { MemoryEngine } from '../core/MemoryEngine.js';
import type { ContainmentManager } from '../codex/ContainmentManager.js';

export class TelegramBot {
  private bot: TelegramBotAPI;
  private handler: TelegramHandler;
  private allowedUsers: Set<number>;

  constructor(
    config: TelegramBotConfig,
    taskExecutor?: TaskExecutor,
    defaultCodebase?: string,
    engine?: MemoryEngine
  ) {
    this.bot = new TelegramBotAPI(config.token, { polling: true });
    this.handler = new TelegramHandler(taskExecutor, defaultCodebase, engine);
    this.allowedUsers = new Set(config.allowedUsers || []);

    this.setupHandlers();
  }

  /**
   * Set the TaskExecutor instance (for late binding)
   */
  setTaskExecutor(executor: TaskExecutor): void {
    this.handler.setTaskExecutor(executor);
  }

  /**
   * Set the CommunicationManager for escalation response forwarding.
   * When set, escalation responses are forwarded to CommunicationManager
   * instead of being treated as new tasks.
   */
  setComms(comms: CommunicationManager): void {
    this.handler.setComms(comms);
  }

  /**
   * Set the MemoryEngine for planning sessions.
   * Required for /plan commands to work.
   */
  setEngine(engine: MemoryEngine): void {
    this.handler.setEngine(engine);
  }

  /**
   * Set the ContainmentManager for path permission management.
   * Enables /paths, /path-add, /path-remove commands.
   */
  setContainment(containment: ContainmentManager): void {
    this.handler.setContainment(containment);
  }

  private setupHandlers(): void {
    this.bot.on('message', async (msg: TelegramMessage) => {
      try {
        if (!this.isUserAllowed(msg.from?.id)) {
          await this.sendMessage(msg.chat.id, 'Unauthorized access');
          return;
        }

        await this.handler.handleMessage(msg, this.bot);
      } catch (error) {
        console.error('Error handling message:', error);
        await this.sendMessage(msg.chat.id, 'An error occurred while processing your message');
      }
    });

    this.bot.on('callback_query', async (query) => {
      try {
        if (!this.isUserAllowed(query.from?.id)) {
          await this.bot.answerCallbackQuery(query.id, { text: 'Unauthorized access' });
          return;
        }

        await this.handler.handleCallbackQuery(query, this.bot);
      } catch (error) {
        console.error('Error handling callback query:', error);
        await this.bot.answerCallbackQuery(query.id, { text: 'An error occurred' });
      }
    });
  }

  private isUserAllowed(userId?: number): boolean {
    if (this.allowedUsers.size === 0) return true;
    return userId ? this.allowedUsers.has(userId) : false;
  }

  async sendMessage(chatId: number, text: string, options?: any): Promise<void> {
    await this.bot.sendMessage(chatId, text, options);
  }

  async sendDocument(chatId: number, document: string | Buffer, options?: any): Promise<void> {
    await this.bot.sendDocument(chatId, document, options);
  }

  start(): void {
    console.log('Telegram bot started');
  }

  stop(): void {
    this.bot.stopPolling();
    console.log('Telegram bot stopped');
  }
}