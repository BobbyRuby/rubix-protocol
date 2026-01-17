#!/usr/bin/env node
/**
 * Telegram + RUBIX Launcher
 *
 * Starts:
 * - MemoryEngine + RUBIX (via bootstrap)
 * - Telegram bot
 * - CommunicationManager (for escalations)
 *
 * Users can send /task to trigger RUBIX code generation.
 * Escalation responses are handled by the Telegram bot to avoid polling conflicts.
 */

import { bootstrap, setupShutdown, printBanner } from './bootstrap.js';
import { requireEnvInteractive, ENV_REQUIREMENTS } from './env.js';
import { TelegramBot } from '../telegram/TelegramBot.js';
import { CommunicationManager } from '../communication/CommunicationManager.js';

async function main(): Promise<void> {
  printBanner('Telegram + RUBIX');

  // Validate environment - prompts for missing required config
  await requireEnvInteractive(ENV_REQUIREMENTS.telegram, 'Telegram');

  // Bootstrap core systems (includes capability pre-warming)
  const { executor, engine, containment, capabilities } = await bootstrap({ showEnvSummary: true });

  // Create CommunicationManager with Telegram channel
  const comms = new CommunicationManager({
    enabled: true,
    fallbackOrder: ['telegram'],
    telegram: {
      enabled: true,
      botToken: process.env.TELEGRAM_BOT_TOKEN!,
      chatId: process.env.TELEGRAM_CHAT_ID || ''
    }
  });
  comms.initialize();

  // Start Telegram bot with TaskExecutor and Engine
  const bot = new TelegramBot(
    {
      token: process.env.TELEGRAM_BOT_TOKEN!,
      allowedUsers: process.env.TELEGRAM_ALLOWED_USERS
        ? process.env.TELEGRAM_ALLOWED_USERS.split(',').map(Number)
        : []
    },
    executor,
    process.cwd(),
    engine  // Pass engine in constructor for planning sessions
  );

  // Wire TelegramBot and CommunicationManager together:
  // 1. TelegramChannel goes into send-only mode (TelegramBot handles polling)
  // 2. Escalation responses are forwarded from TelegramBot to CommunicationManager
  comms.setTelegramBotActive(true);
  bot.setComms(comms);

  // Set comms on executor for escalations
  executor.setCommunications(comms);

  // Wire containment for /paths, /path-add, /path-remove commands
  bot.setContainment(containment);

  bot.start();
  console.log('[Launch] Telegram bot started');
  console.log('[Launch] Escalation responses will be forwarded through TelegramBot');

  // Setup graceful shutdown
  setupShutdown(async () => {
    console.log('[Shutdown] Stopping Telegram bot...');
    bot.stop();
    console.log('[Shutdown] Stopping capabilities...');
    await capabilities.shutdown();
  });

  console.log('');
  console.log('════════════════════════════════════════════════════');
  console.log('  Rubix Telegram Bot running!');
  console.log('');
  console.log('  Task Commands:');
  console.log('    /task <description>  - Execute task immediately');
  console.log('    /status              - Check task status');
  console.log('');
  console.log('  Planning Commands:');
  console.log('    /plan <description>  - Start planning session');
  console.log('    /resume              - Resume last session');
  console.log('    /plans               - List all sessions');
  console.log('    /plan-status         - Show plan status');
  console.log('    /execute             - Run approved plan');
  console.log('    /cancel              - Cancel session');
  console.log('');
  console.log('  Configuration Commands:');
  console.log('    /config              - Show configuration');
  console.log('    /paths               - List allowed paths');
  console.log('    /path-add <path> rw  - Add path (rw|read)');
  console.log('    /path-remove <path>  - Remove path');
  console.log('');
  console.log('  Planning mode stores all exchanges in memory');
  console.log('  for unlimited context - no token limits!');
  console.log('');
  console.log('  Press Ctrl+C to stop');
  console.log('════════════════════════════════════════════════════');
  console.log('');
}

main().catch((error) => {
  console.error('[Fatal] Startup failed:', error);
  process.exit(1);
});
