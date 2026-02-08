#!/usr/bin/env node
/**
 * Rubix AFK Notification Hook for Claude Code (Notification)
 *
 * When AFK mode is active, forwards all Claude Code notifications to Telegram.
 * When NOT AFK, exits immediately (normal desktop notification).
 *
 * Input (stdin JSON): { message, title, notification_type }
 * Output: none (fire-and-forget)
 */

const {
  readStdin,
  readAfkState,
  httpPost
} = require('./rubix-hook-utils.cjs');

async function main() {
  const input = await readStdin();
  if (!input) return;

  // Check AFK state
  const afkState = readAfkState();
  if (!afkState.afk) {
    // Not AFK — exit 0, normal desktop notification
    return;
  }

  // AFK mode active — forward to Telegram via daemon
  const title = input.title || 'Claude Code';
  const message = input.message || '';
  const type = input.notification_type || 'info';

  // Fire-and-forget POST to daemon
  await httpPost('http://localhost:3456/api/notify', {
    title,
    message,
    type
  }, 3000); // 3s timeout, don't block
}

main().catch(() => {
  // Silent failure — never block notifications
});
