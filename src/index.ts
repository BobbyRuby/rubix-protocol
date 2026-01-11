import { TelegramInterface } from './telegram';
import { config } from 'dotenv';

config();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!TELEGRAM_BOT_TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN environment variable is required');
  process.exit(1);
}

const telegramInterface = new TelegramInterface(TELEGRAM_BOT_TOKEN);

process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  telegramInterface.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Shutting down gracefully...');
  telegramInterface.stop();
  process.exit(0);
});

telegramInterface.start();

console.log('CODEX Telegram Bot is running...');