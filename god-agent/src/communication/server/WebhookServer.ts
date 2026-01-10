/**
 * WebhookServer
 *
 * HTTP server that receives webhook callbacks from communication channels.
 * Routes incoming messages to appropriate channel handlers.
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http';
import type { ChannelType } from '../types.js';

export interface WebhookHandler {
  (payload: unknown): Promise<void>;
}

export class WebhookServer {
  private server: Server | null = null;
  private handlers: Map<ChannelType, WebhookHandler> = new Map();
  private port: number;
  private isRunning: boolean = false;

  constructor(port: number = 3456) {
    this.port = port;
  }

  /**
   * Register a handler for a specific channel
   */
  registerHandler(channel: ChannelType, handler: WebhookHandler): void {
    this.handlers.set(channel, handler);
    console.log(`[WebhookServer] Registered handler for ${channel}`);
  }

  /**
   * Start the webhook server
   */
  async start(): Promise<void> {
    if (this.isRunning) return;

    return new Promise((resolve, reject) => {
      this.server = createServer(async (req, res) => {
        await this.handleRequest(req, res);
      });

      this.server.on('error', (error) => {
        console.error('[WebhookServer] Server error:', error);
        reject(error);
      });

      this.server.listen(this.port, () => {
        this.isRunning = true;
        console.log(`[WebhookServer] Listening on port ${this.port}`);
        console.log(`[WebhookServer] Endpoints:`);
        console.log(`  - POST /webhooks/sms     (Twilio/Telnyx SMS)`);
        console.log(`  - POST /webhooks/slack   (Slack interactions)`);
        console.log(`  - POST /webhooks/discord (Discord interactions)`);
        console.log(`  - POST /webhooks/phone   (CallMe callbacks)`);
        console.log(`  - GET  /health           (Health check)`);
        resolve();
      });
    });
  }

  /**
   * Stop the webhook server
   */
  async stop(): Promise<void> {
    if (!this.isRunning || !this.server) return;

    return new Promise((resolve) => {
      this.server!.close(() => {
        this.isRunning = false;
        console.log('[WebhookServer] Stopped');
        resolve();
      });
    });
  }

  /**
   * Handle incoming HTTP request
   */
  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url || '';
    const method = req.method || 'GET';

    // Health check
    if (url === '/health' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        handlers: Array.from(this.handlers.keys()),
        uptime: process.uptime()
      }));
      return;
    }

    // Only accept POST for webhooks
    if (method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    // Parse webhook path
    const pathMatch = url.match(/^\/webhooks\/(\w+)$/);
    if (!pathMatch) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    const channelType = pathMatch[1] as ChannelType;
    const handler = this.handlers.get(channelType);

    if (!handler) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `No handler for channel: ${channelType}` }));
      return;
    }

    try {
      // Parse request body
      const body = await this.parseBody(req);
      console.log(`[WebhookServer] Received ${channelType} webhook`);

      // Handle based on channel type
      await handler(body);

      // Send appropriate response
      this.sendChannelResponse(channelType, res);
    } catch (error) {
      console.error(`[WebhookServer] Error handling ${channelType} webhook:`, error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }

  /**
   * Parse request body (JSON or form-urlencoded)
   */
  private async parseBody(req: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let body = '';

      req.on('data', (chunk) => {
        body += chunk.toString();
      });

      req.on('end', () => {
        const contentType = req.headers['content-type'] || '';

        try {
          if (contentType.includes('application/json')) {
            resolve(JSON.parse(body));
          } else if (contentType.includes('application/x-www-form-urlencoded')) {
            // Parse form data (Twilio format)
            const params = new URLSearchParams(body);
            const obj: Record<string, string> = {};
            params.forEach((value, key) => {
              obj[key] = value;
            });
            resolve(obj);
          } else if (contentType.includes('multipart/form-data')) {
            // For Slack, payload is in 'payload' field
            const params = new URLSearchParams(body);
            const payloadStr = params.get('payload');
            if (payloadStr) {
              resolve(JSON.parse(payloadStr));
            } else {
              resolve(body);
            }
          } else {
            // Try JSON, fallback to raw
            try {
              resolve(JSON.parse(body));
            } catch {
              resolve(body);
            }
          }
        } catch (error) {
          reject(error);
        }
      });

      req.on('error', reject);
    });
  }

  /**
   * Send channel-appropriate response
   */
  private sendChannelResponse(channel: ChannelType, res: ServerResponse): void {
    switch (channel) {
      case 'sms':
        // Twilio expects TwiML response
        res.writeHead(200, { 'Content-Type': 'text/xml' });
        res.end('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
        break;

      case 'slack':
        // Slack expects 200 OK quickly
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        break;

      case 'discord':
        // Discord expects JSON ACK
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ type: 1 }));
        break;

      default:
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ received: true }));
    }
  }

  /**
   * Get server status
   */
  getStatus(): { running: boolean; port: number; handlers: ChannelType[] } {
    return {
      running: this.isRunning,
      port: this.port,
      handlers: Array.from(this.handlers.keys())
    };
  }
}

export default WebhookServer;
