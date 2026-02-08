#!/usr/bin/env node
/**
 * Webhook Server Launcher
 *
 * Starts:
 * - WebhookServer on port 3456 (or WEBHOOK_PORT)
 *
 * Completely standalone - no MemoryEngine needed.
 * Used for receiving SMS/Slack/Discord callbacks.
 */

import { setupShutdown, printBanner } from './bootstrap.js';
import { requireEnv, ENV_REQUIREMENTS } from './env.js';
import { WebhookServer } from '../communication/server/WebhookServer.js';

async function main(): Promise<void> {
  printBanner('Webhook Server');

  // Validate environment (webhooks has no required vars)
  requireEnv(ENV_REQUIREMENTS.webhooks, 'Webhooks');

  // Get port from environment
  const port = parseInt(process.env.WEBHOOK_PORT || '3456', 10);

  // Start webhook server
  const server = new WebhookServer(port);
  await server.start();
  console.log(`[Launch] Webhook server started on port ${port}`);

  // Setup graceful shutdown
  setupShutdown(async () => {
    console.log('[Shutdown] Stopping webhook server...');
    await server.stop();
  });

  console.log('');
  console.log('════════════════════════════════════════');
  console.log('  Webhook Server running!');
  console.log('');
  console.log('  Endpoints:');
  console.log(`    POST http://localhost:${port}/webhooks/sms`);
  console.log(`    POST http://localhost:${port}/webhooks/slack`);
  console.log(`    POST http://localhost:${port}/webhooks/discord`);
  console.log(`    POST http://localhost:${port}/webhooks/phone`);
  console.log(`    GET  http://localhost:${port}/health`);
  console.log('');
  console.log('  Press Ctrl+C to stop');
  console.log('════════════════════════════════════════');
  console.log('');
}

main().catch((error) => {
  console.error('[Fatal] Startup failed:', error);
  process.exit(1);
});
