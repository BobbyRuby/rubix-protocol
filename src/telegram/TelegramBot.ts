import TelegramBot from 'node-telegram-bot-api';
import { TelegramHandler } from './TelegramHandler.js';
import { TelegramConfig, TelegramUpdate } from './types.js';

export class TelegramBotService {
  private bot: TelegramBot;
  private handler: TelegramHandler;

  constructor(config: TelegramConfig) {
    this.bot = new TelegramBot(config.token, { polling: true });
    this.handler = new TelegramHandler();
    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.bot.on('message', (msg) => {
      this.handler.handleMessage(msg);
    });

    this.bot.on('callback_query', (query) => {
      this.handler.handleCallbackQuery(query);
    });

    this.bot.on('polling_error', (error) => {
      console.error('Telegram polling error:', error);
    });
  }

  public async sendMessage(chatId: number, text: string): Promise<void> {
    try {
      await this.bot.sendMessage(chatId, text);
    } catch (error) {
      console.error('Error sending message:', error);
      throw error;
    }
  }

  public async stop(): Promise<void> {
    await this.bot.stopPolling();
  }
}