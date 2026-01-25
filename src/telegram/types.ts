import { Message, Update, CallbackQuery, InlineQuery } from 'node-telegram-bot-api';

export interface TelegramContext {
  update: Update;
  message?: Message;
  callbackQuery?: CallbackQuery;
  inlineQuery?: InlineQuery;
}

export interface BotCommand {
  command: string;
  description: string;
  handler: (ctx: TelegramContext) => Promise<void>;
}

export interface BotConfig {
  token: string;
  webhookUrl?: string;
  polling?: boolean;
}

export interface UserSession {
  userId: number;
  chatId: number;
  username?: string;
  state?: any;
  lastActivity: Date;
}

// Dark Fantasy themed types for zombie integration
export interface DarkFantasyUpdate {
  type: 'zombie_spawn' | 'zombie_move' | 'zombie_attack';
  position: { x: number; y: number };
  animation?: string;
  damage?: number;
}

export interface ZombieCommand extends BotCommand {
  zombieAction?: 'spawn' | 'move' | 'attack' | 'idle';
  animationTrigger?: string;
}