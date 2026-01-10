/**
 * Communication Layer
 *
 * Multi-channel escalation system with fallback chain.
 * Phone -> SMS -> Slack -> Discord -> Email
 */

export * from './types.js';
export { BaseChannel } from './channels/BaseChannel.js';
export { CommunicationManager } from './CommunicationManager.js';

// Channel exports
export { PhoneChannel } from './channels/PhoneChannel.js';
export { SMSChannel } from './channels/SMSChannel.js';
export { SlackChannel } from './channels/SlackChannel.js';
export { DiscordChannel } from './channels/DiscordChannel.js';
export { EmailChannel } from './channels/EmailChannel.js';

// Webhook server
export { WebhookServer } from './server/WebhookServer.js';
export type { WebhookHandler } from './server/WebhookServer.js';
