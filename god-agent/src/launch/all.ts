#!/usr/bin/env node
/**
 * Full Stack Launcher
 *
 * Starts all God-Agent services:
 * - MemoryEngine + RUBIX
 * - Telegram bot (if TELEGRAM_BOT_TOKEN set)
 * - Scheduler daemon
 * - Webhook server
 * - Notification service
 * - Communication manager
 */

import { bootstrap, setupShutdown, printBanner } from './bootstrap.js';
import { requireEnvInteractive, ENV_REQUIREMENTS } from './env.js';

import { TelegramBot } from '../telegram/TelegramBot.js';
import { SchedulerDaemon } from '../scheduler/SchedulerDaemon.js';
import { WebhookServer } from '../communication/server/WebhookServer.js';
import { NotificationService } from '../notification/NotificationService.js';
import { CommunicationManager } from '../communication/CommunicationManager.js';

interface Service {
  name: string;
  stop: () => void | Promise<void>;
}

async function main(): Promise<void> {
  printBanner('Full Stack');

  // Validate environment - prompts for missing required config
  await requireEnvInteractive(ENV_REQUIREMENTS.all, 'Full Stack');

  // Bootstrap core systems
  const { engine, executor } = await bootstrap({ showEnvSummary: true });

  // Track all services for cleanup
  const services: Service[] = [];

  // 1. Notification Service
  const notifications = new NotificationService(engine, {
    console: true,
    slack: process.env.SLACK_WEBHOOK_URL ? {
      enabled: true,
      webhookUrl: process.env.SLACK_WEBHOOK_URL
    } : undefined,
    discord: process.env.DISCORD_WEBHOOK_URL ? {
      enabled: true,
      webhookUrl: process.env.DISCORD_WEBHOOK_URL
    } : undefined
  });
  executor.setNotifications(notifications);
  console.log('[Launch] NotificationService initialized');

  // 2. Communication Manager
  // Note: Telegram channel for escalations requires chatId (different from bot polling)
  const comms = new CommunicationManager({
    enabled: true,
    telegram: process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID ? {
      enabled: true,
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      chatId: process.env.TELEGRAM_CHAT_ID
    } : undefined,
    slack: process.env.SLACK_WEBHOOK_URL ? {
      enabled: true,
      webhookUrl: process.env.SLACK_WEBHOOK_URL
    } : undefined,
    discord: process.env.DISCORD_WEBHOOK_URL ? {
      enabled: true,
      webhookUrl: process.env.DISCORD_WEBHOOK_URL
    } : undefined
  });
  comms.initialize();
  executor.setCommunications(comms);
  console.log('[Launch] CommunicationManager initialized');

  // 3. Telegram Bot (if token available)
  if (process.env.TELEGRAM_BOT_TOKEN) {
    const bot = new TelegramBot(
      {
        token: process.env.TELEGRAM_BOT_TOKEN,
        allowedUsers: process.env.TELEGRAM_ALLOWED_USERS
          ? process.env.TELEGRAM_ALLOWED_USERS.split(',').map(Number)
          : []
      },
      executor,
      process.cwd(),
      engine  // Pass engine for planning sessions
    );

    // Wire TelegramBot and CommunicationManager together:
    // 1. TelegramChannel goes into send-only mode (TelegramBot handles polling)
    // 2. Escalation responses are forwarded from TelegramBot to CommunicationManager
    comms.setTelegramBotActive(true);
    bot.setComms(comms);

    bot.start();
    services.push({ name: 'Telegram Bot', stop: () => bot.stop() });
    console.log('[Launch] Telegram bot started');
    console.log('[Launch] Escalation responses will be forwarded through TelegramBot');
  } else {
    console.log('[Launch] Telegram bot skipped (TELEGRAM_BOT_TOKEN not set)');
  }

  // 4. Scheduler Daemon
  const daemon = new SchedulerDaemon(engine);
  daemon.start();
  services.push({ name: 'Scheduler Daemon', stop: () => daemon.stop('shutdown') });
  console.log('[Launch] Scheduler daemon started');

  // 5. Webhook Server
  const webhookPort = parseInt(process.env.WEBHOOK_PORT || '3456', 10);
  const webhooks = new WebhookServer(webhookPort);
  await webhooks.start();
  services.push({ name: 'Webhook Server', stop: () => webhooks.stop() });
  console.log(`[Launch] Webhook server started on port ${webhookPort}`);

  // Setup graceful shutdown
  setupShutdown(async () => {
    for (const service of services.reverse()) {
      console.log(`[Shutdown] Stopping ${service.name}...`);
      try {
        await service.stop();
      } catch (error) {
        console.error(`[Shutdown] Error stopping ${service.name}:`, error);
      }
    }
  });

  // Summary
  console.log('');
  console.log('════════════════════════════════════════');
  console.log('  All services running!');
  console.log('');
  console.log('  Services:');
  services.forEach(s => console.log(`    - ${s.name}`));
  console.log('');
  console.log('  Press Ctrl+C to stop');
  console.log('════════════════════════════════════════');
  console.log('');
}

main().catch((error) => {
  console.error('[Fatal] Startup failed:', error);
  process.exit(1);
});
