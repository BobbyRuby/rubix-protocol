#!/usr/bin/env node
/**
 * Scheduler Daemon Launcher
 *
 * Starts:
 * - MemoryEngine (via bootstrap)
 * - SchedulerDaemon
 *
 * Runs scheduled/cron tasks in the background.
 * Note: RUBIX code generation requires ANTHROPIC_API_KEY.
 */

import { bootstrap, setupShutdown, printBanner } from './bootstrap.js';
import { requireEnv, ENV_REQUIREMENTS } from './env.js';
import { SchedulerDaemon } from '../scheduler/SchedulerDaemon.js';

async function main(): Promise<void> {
  printBanner('Scheduler Daemon');

  // Validate environment
  requireEnv(ENV_REQUIREMENTS.daemon, 'Scheduler');

  // Bootstrap core systems
  const { engine } = await bootstrap({ showEnvSummary: true });

  // Start scheduler daemon
  const daemon = new SchedulerDaemon(engine);

  // Listen for daemon events
  daemon.on('task:started', ({ task }) => {
    console.log(`[Scheduler] Task started: ${task.name}`);
  });

  daemon.on('task:completed', ({ task }) => {
    console.log(`[Scheduler] Task completed: ${task.name}`);
  });

  daemon.on('task:failed', ({ task, error }) => {
    console.error(`[Scheduler] Task failed: ${task.name} - ${error}`);
  });

  daemon.on('error', ({ error, context }) => {
    console.error(`[Scheduler] Error in ${context}:`, error);
  });

  daemon.start();
  console.log('[Launch] Scheduler daemon started');

  // Setup graceful shutdown
  setupShutdown(async () => {
    console.log('[Shutdown] Stopping scheduler daemon...');
    daemon.stop('shutdown');
  });

  console.log('');
  console.log('════════════════════════════════════════');
  console.log('  Scheduler Daemon running!');
  console.log('');
  console.log('  Trigger types supported:');
  console.log('    - datetime: Execute at specific time');
  console.log('    - cron: Recurring schedule');
  console.log('    - event: Event-triggered');
  console.log('    - file: File change watch');
  console.log('    - manual: On-demand only');
  console.log('');
  console.log('  Press Ctrl+C to stop');
  console.log('════════════════════════════════════════');
  console.log('');
}

main().catch((error) => {
  console.error('[Fatal] Startup failed:', error);
  process.exit(1);
});
