/**
 * TelegramChannel - Telegram Bot escalation with inline keyboards
 *
 * Sends messages via Telegram Bot API and polls for responses.
 * Supports inline keyboard buttons for option selection.
 */

import { BaseChannel } from './BaseChannel.js';
import type {
  ChannelType,
  TelegramChannelConfig,
  EscalationRequest,
  EscalationResponse
} from '../types.js';

export class TelegramChannel extends BaseChannel {
  readonly type: ChannelType = 'telegram';
  private config: TelegramChannelConfig;
  private lastUpdateId: number = 0;
  private pollingInterval: NodeJS.Timeout | null = null;
  private sendOnlyMode: boolean = false;

  constructor(config: TelegramChannelConfig) {
    super();
    this.config = config;
  }

  /**
   * Enable send-only mode - disables polling.
   * Use when TelegramBot is handling polling to avoid conflicts.
   */
  setSendOnlyMode(enabled: boolean): void {
    this.sendOnlyMode = enabled;
    if (enabled) {
      this.stopPolling();
      console.log('[TelegramChannel] Send-only mode enabled (TelegramBot handles polling)');
    }
  }

  /**
   * Check if in send-only mode
   */
  isSendOnlyMode(): boolean {
    return this.sendOnlyMode;
  }

  get isConfigured(): boolean {
    return this.config.enabled && !!this.config.botToken && !!this.config.chatId;
  }

  canReceiveResponses(): boolean {
    return true;  // Telegram bot can receive replies via polling
  }

  private get apiBase(): string {
    return `https://api.telegram.org/bot${this.config.botToken}`;
  }

  async send(request: EscalationRequest): Promise<boolean> {
    if (!this.isConfigured) return false;

    try {
      const message = this.buildTelegramMessage(request);
      const keyboard = this.buildInlineKeyboard(request);

      const body: Record<string, unknown> = {
        chat_id: this.config.chatId,
        text: message,
        parse_mode: 'Markdown'
      };

      if (keyboard) {
        body.reply_markup = keyboard;
      }

      const response = await fetch(`${this.apiBase}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('[TelegramChannel] Send failed:', error);
        return false;
      }

      const result = await response.json() as { ok: boolean; result?: { message_id: number } };
      if (result.ok) {
        this.trackRequest(request);
        console.log(`[TelegramChannel] Message sent, id: ${result.result?.message_id}`);
        return true;
      }

      return false;
    } catch (error) {
      console.error('[TelegramChannel] Send error:', error);
      return false;
    }
  }

  private buildTelegramMessage(request: EscalationRequest): string {
    const urgencyEmoji = request.urgency === 'critical' ? '🚨' :
                         request.urgency === 'high' ? '⚠️' : 'ℹ️';

    let message = `${urgencyEmoji} *[CODEX] ${this.escapeMarkdown(request.title)}*\n\n`;
    message += this.escapeMarkdown(request.message);
    message += `\n\n_Type: ${request.type} | Ref: ${this.getShortRef(request.id)}_`;

    if (request.options?.length) {
      message += '\n\n*Options:* Tap a button below or reply with your answer.';
    } else {
      message += '\n\n*Reply to this message with your response.*';
    }

    return message;
  }

  private escapeMarkdown(text: string): string {
    // Escape Telegram Markdown special chars
    return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
  }

  private buildInlineKeyboard(request: EscalationRequest): object | null {
    if (!request.options?.length) return null;

    const buttons = request.options.slice(0, 6).map((opt) => ({
      text: opt.label.slice(0, 64),
      callback_data: JSON.stringify({ rid: request.id.slice(0, 8), opt: opt.value.slice(0, 20) })
    }));

    // Arrange buttons in rows of 2
    const rows: Array<typeof buttons> = [];
    for (let i = 0; i < buttons.length; i += 2) {
      rows.push(buttons.slice(i, i + 2));
    }

    return { inline_keyboard: rows };
  }

  async startPolling(): Promise<void> {
    if (this.pollingInterval) return;

    const intervalMs = this.config.pollingIntervalMs || 2000;

    // Get initial offset
    await this.getUpdates();

    this.pollingInterval = setInterval(async () => {
      await this.pollForResponses();
    }, intervalMs);

    console.log(`[TelegramChannel] Polling started (${intervalMs}ms interval)`);
  }

  stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
      console.log('[TelegramChannel] Polling stopped');
    }
  }

  private async getUpdates(): Promise<Array<{ update_id: number; message?: unknown; callback_query?: unknown }>> {
    // Skip polling in send-only mode to avoid conflict with TelegramBot
    if (this.sendOnlyMode) {
      return [];
    }

    try {
      const url = `${this.apiBase}/getUpdates?offset=${this.lastUpdateId + 1}&timeout=1`;
      const response = await fetch(url);
      const data = await response.json() as { ok: boolean; result: Array<{ update_id: number; message?: unknown; callback_query?: unknown }> };

      if (data.ok && data.result.length > 0) {
        this.lastUpdateId = data.result[data.result.length - 1].update_id;
        return data.result;
      }
      return [];
    } catch (error) {
      console.error('[TelegramChannel] getUpdates error:', error);
      return [];
    }
  }

  private async pollForResponses(): Promise<void> {
    if (this.pendingRequests.size === 0) return;

    const updates = await this.getUpdates();

    for (const update of updates) {
      const response = await this.parseResponse(update);
      if (response) {
        await this.handleIncomingResponse(update);
      }
    }
  }

  protected async parseResponse(payload: unknown): Promise<EscalationResponse | null> {
    const update = payload as {
      message?: {
        text?: string;
        reply_to_message?: { text?: string };
        chat?: { id: number };
      };
      callback_query?: {
        id?: string;
        data?: string;
        message?: { chat?: { id: number } };
      };
    };

    // Handle inline button callback
    if (update.callback_query?.data) {
      try {
        const data = JSON.parse(update.callback_query.data) as { rid: string; opt: string };
        const requestId = this.findRequestByRef(data.rid);

        if (requestId) {
          // Acknowledge the callback
          await this.answerCallback(update.callback_query);

          return {
            requestId,
            channel: 'telegram',
            response: data.opt,
            selectedOption: data.opt,
            receivedAt: new Date(),
            rawPayload: payload
          };
        }
      } catch {
        // Not our callback format
      }
    }

    // Handle text reply
    if (update.message?.text && update.message.chat?.id.toString() === this.config.chatId) {
      const text = update.message.text;

      // Skip commands
      if (text.startsWith('/')) return null;

      // Try to match to a pending request
      // Check if it's a reply to our message
      if (update.message.reply_to_message?.text?.includes('[CODEX]')) {
        // Extract ref from the original message
        const refMatch = update.message.reply_to_message.text.match(/Ref: ([a-f0-9]+)/i);
        const requestId = this.findRequestByRef(refMatch?.[1]);

        if (requestId) {
          return {
            requestId,
            channel: 'telegram',
            response: text,
            receivedAt: new Date(),
            rawPayload: payload
          };
        }
      }

      // Fallback: use most recent pending request
      if (this.pendingRequests.size > 0) {
        const [fallbackId] = Array.from(this.pendingRequests.keys()).slice(-1);
        return {
          requestId: fallbackId,
          channel: 'telegram',
          response: text,
          receivedAt: new Date(),
          rawPayload: payload
        };
      }
    }

    return null;
  }

  private async answerCallback(callbackQuery: { id?: string }): Promise<void> {
    if (!callbackQuery.id) return;

    try {
      await fetch(`${this.apiBase}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callback_query_id: callbackQuery.id,
          text: 'Response received!'
        })
      });
    } catch {
      // Ignore callback answer errors
    }
  }

  async test(): Promise<boolean> {
    if (!this.isConfigured) return false;

    try {
      const response = await fetch(`${this.apiBase}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.config.chatId,
          text: '✅ *CODEX Connection Test*\n\nTelegram channel is working!',
          parse_mode: 'Markdown'
        })
      });

      const result = await response.json() as { ok: boolean };
      return result.ok;
    } catch {
      return false;
    }
  }

  /**
   * Resolve a pending request directly without going through parseResponse.
   * Used by receiveForwardedResponse to avoid incomplete payload issues.
   */
  private resolvePendingRequest(requestId: string, response: EscalationResponse): void {
    const pending = this.pendingRequests.get(requestId);
    if (pending) {
      clearTimeout(pending.timeoutHandle);
      this.pendingRequests.delete(requestId);
      this.status = 'responded';
      console.log(`[TelegramChannel] Got response: ${response.response.slice(0, 100)}...`);
      pending.resolve(response);
    }
  }

  /**
   * Receive a forwarded response from TelegramBot (in send-only mode).
   * This allows TelegramBot to handle all polling while forwarding
   * escalation responses to this channel.
   */
  async receiveForwardedResponse(message: {
    text: string;
    replyToText?: string;
    callbackData?: string;
  }): Promise<EscalationResponse | null> {
    // Handle callback button press
    if (message.callbackData) {
      try {
        const data = JSON.parse(message.callbackData) as { rid: string; opt: string };
        const requestId = this.findRequestByRef(data.rid);

        if (requestId) {
          const response: EscalationResponse = {
            requestId,
            channel: 'telegram',
            response: data.opt,
            selectedOption: data.opt,
            receivedAt: new Date(),
            rawPayload: message
          };

          // Resolve the pending request directly
          this.resolvePendingRequest(requestId, response);
          return response;
        }
      } catch {
        // Not valid callback data
      }
    }

    // Handle text reply
    if (message.text && !message.text.startsWith('/')) {
      // Try to match via reply-to reference
      if (message.replyToText?.includes('[CODEX]')) {
        const refMatch = message.replyToText.match(/Ref: ([a-f0-9]+)/i);
        const requestId = this.findRequestByRef(refMatch?.[1]);

        if (requestId) {
          const response: EscalationResponse = {
            requestId,
            channel: 'telegram',
            response: message.text,
            receivedAt: new Date(),
            rawPayload: message
          };

          // Resolve the pending request directly
          this.resolvePendingRequest(requestId, response);
          return response;
        }
      }

      // Fallback: use most recent pending request
      if (this.pendingRequests.size > 0) {
        const [fallbackId] = Array.from(this.pendingRequests.keys()).slice(-1);
        const response: EscalationResponse = {
          requestId: fallbackId,
          channel: 'telegram',
          response: message.text,
          receivedAt: new Date(),
          rawPayload: message
        };

        this.resolvePendingRequest(fallbackId, response);
        return response;
      }
    }

    return null;
  }
}

export default TelegramChannel;
