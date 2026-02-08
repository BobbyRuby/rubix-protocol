/**
 * WebhookServer
 *
 * HTTP server that receives webhook callbacks from communication channels.
 * Routes incoming messages to appropriate channel handlers.
 *
 * Also exposes API endpoints for hook scripts:
 *   POST /api/query      — Memory query (used by auto-recall hook)
 *   GET  /api/afk        — Read AFK state
 *   POST /api/afk        — Toggle AFK state
 *   POST /api/permission — AFK permission routing (used by permission hook)
 *   POST /api/notify     — AFK notification forwarding (used by notification hook)
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import type { ChannelType } from '../types.js';
import type { MemoryEngine } from '../../core/MemoryEngine.js';
import type { CommunicationManager } from '../CommunicationManager.js';

export interface WebhookHandler {
  (payload: unknown): Promise<void>;
}

/** Pending permission request — resolves when user taps Allow/Deny in Telegram */
interface PendingPermission {
  resolve: (decision: 'allow' | 'deny') => void;
  timer: ReturnType<typeof setTimeout>;
  attempt: number;
}

export class WebhookServer {
  private server: Server | null = null;
  private handlers: Map<ChannelType, WebhookHandler> = new Map();
  private port: number;
  private isRunning: boolean = false;

  /** MemoryEngine for /api/query endpoint */
  private engine: MemoryEngine | null = null;

  /** CommunicationManager for sending Telegram messages */
  private comms: CommunicationManager | null = null;

  /** Pending permission requests awaiting Telegram callback */
  private pendingPermissions: Map<string, PendingPermission> = new Map();

  /** AFK state file path */
  private afkStatePath: string;

  constructor(port: number = 3456) {
    this.port = port;
    this.afkStatePath = join(process.cwd(), 'data', 'afk-state.json');
  }

  /**
   * Set the MemoryEngine for /api/query endpoint
   */
  setMemoryEngine(engine: MemoryEngine): void {
    this.engine = engine;
    console.log('[WebhookServer] MemoryEngine connected for /api/query');
  }

  /**
   * Set the CommunicationManager for permission/notification forwarding
   */
  setCommunicationManager(comms: CommunicationManager): void {
    this.comms = comms;
    console.log('[WebhookServer] CommunicationManager connected for AFK routing');
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
        console.log(`  - POST /api/query        (Memory query)`);
        console.log(`  - GET  /api/afk          (AFK status)`);
        console.log(`  - POST /api/afk          (Toggle AFK)`);
        console.log(`  - POST /api/permission   (AFK permission routing)`);
        console.log(`  - POST /api/notify       (AFK notification forward)`);
        resolve();
      });
    });
  }

  /**
   * Stop the webhook server
   */
  async stop(): Promise<void> {
    if (!this.isRunning || !this.server) return;

    // Clean up pending permissions
    for (const [, pending] of this.pendingPermissions) {
      clearTimeout(pending.timer);
      pending.resolve('deny');
    }
    this.pendingPermissions.clear();

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

    // API routes
    if (url.startsWith('/api/')) {
      await this.handleApiRequest(url, method, req, res);
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
   * Handle /api/* routes
   */
  private async handleApiRequest(url: string, method: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      // POST /api/query — Memory query
      if (url === '/api/query' && method === 'POST') {
        await this.handleApiQuery(req, res);
        return;
      }

      // GET /api/afk — Read AFK state
      if (url === '/api/afk' && method === 'GET') {
        this.handleApiAfkGet(res);
        return;
      }

      // POST /api/afk — Toggle AFK state
      if (url === '/api/afk' && method === 'POST') {
        await this.handleApiAfkPost(req, res);
        return;
      }

      // POST /api/permission — AFK permission routing
      if (url === '/api/permission' && method === 'POST') {
        await this.handleApiPermission(req, res);
        return;
      }

      // POST /api/notify — AFK notification forward
      if (url === '/api/notify' && method === 'POST') {
        await this.handleApiNotify(req, res);
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'API endpoint not found' }));
    } catch (error) {
      console.error(`[WebhookServer] API error (${url}):`, error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }

  /**
   * POST /api/query — Query memory via MemoryEngine
   */
  private async handleApiQuery(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.engine) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'MemoryEngine not available' }));
      return;
    }

    const body = await this.parseBody(req) as {
      query?: string;
      topK?: number;
      tags?: string[];
      minScore?: number;
      includeProvenance?: boolean;
    };

    if (!body || !body.query) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing required field: query' }));
      return;
    }

    const { results, trajectoryId } = await this.engine.queryWithLearning(body.query, {
      topK: body.topK || 5,
      filters: {
        tags: body.tags,
        minImportance: body.minScore
      },
      includeProvenance: body.includeProvenance
    });

    // Format results for hook consumption
    const formatted = results.map(r => ({
      content: r.entry.content,
      score: r.score,
      lScore: r.lScore,
      tags: r.entry.metadata?.tags || [],
      matchType: r.matchType,
      id: r.entry.id
    }));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      results: formatted,
      _learning: {
        trajectoryId,
        queryId: trajectoryId // trajectoryId serves as queryId for feedback
      }
    }));
  }

  /**
   * GET /api/afk — Read AFK state
   */
  private handleApiAfkGet(res: ServerResponse): void {
    const state = this.readAfkState();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(state));
  }

  /**
   * POST /api/afk — Toggle or set AFK state
   */
  private async handleApiAfkPost(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.parseBody(req) as { action?: string } | null;
    const current = this.readAfkState();

    let newAfk: boolean;
    const action = body && typeof body === 'object' ? (body as { action?: string }).action : undefined;

    if (action === 'on') {
      newAfk = true;
    } else if (action === 'off') {
      newAfk = false;
    } else {
      // Toggle
      newAfk = !current.afk;
    }

    const newState = {
      afk: newAfk,
      since: newAfk ? new Date().toISOString() : null
    };

    this.writeAfkState(newState);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(newState));
  }

  /**
   * POST /api/permission — Route permission request to Telegram when AFK
   *
   * Implements retry escalation: 3 attempts x 120s each.
   * The hook blocks on this HTTP call for up to 390s.
   */
  private async handleApiPermission(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.parseBody(req) as {
      tool_name?: string;
      summary?: string;
      tool_input?: unknown;
      session_id?: string;
    };

    if (!body || !body.tool_name) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing required field: tool_name' }));
      return;
    }

    if (!this.comms) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'CommunicationManager not available', decision: 'deny' }));
      return;
    }

    const permissionId = `perm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const summary = body.summary || body.tool_name;
    const maxAttempts = 3;
    const attemptTimeout = 120000; // 120s per attempt

    console.log(`[WebhookServer] Permission request: ${summary} (id: ${permissionId})`);

    // Try up to 3 attempts
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const prefix = attempt === 1
        ? ''
        : attempt === 2
          ? 'Reminder: '
          : 'FINAL: ';

      const message = `${prefix}Claude needs permission to execute:\n\n` +
        `Tool: ${body.tool_name}\n` +
        `Action: ${summary}\n\n` +
        `Attempt ${attempt}/${maxAttempts}`;

      try {
        // Send via CommunicationManager escalation
        const escalation = {
          id: permissionId,
          taskId: `permission-${permissionId}`,
          type: 'approval' as const,
          title: `Permission: ${body.tool_name}`,
          context: message,
          options: [
            { label: 'Allow', description: 'Approve this tool execution' },
            { label: 'Deny', description: 'Reject this tool execution' }
          ],
          blocking: true
        };

        // Use escalate with a per-attempt timeout
        const responsePromise = this.comms.escalate(escalation);
        const timeoutPromise = new Promise<null>((resolve) =>
          setTimeout(() => resolve(null), attemptTimeout)
        );

        const response = await Promise.race([responsePromise, timeoutPromise]);

        if (response) {
          const decision = response.response?.toLowerCase().includes('allow') ? 'allow' : 'deny';
          console.log(`[WebhookServer] Permission ${decision} via ${response.channel} (attempt ${attempt})`);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ decision, attempt }));
          return;
        }

        console.log(`[WebhookServer] Permission timeout, attempt ${attempt}/${maxAttempts}`);
      } catch (error) {
        console.error(`[WebhookServer] Permission escalation error (attempt ${attempt}):`, error);
      }
    }

    // All attempts exhausted — deny for safety
    console.log(`[WebhookServer] Permission denied after ${maxAttempts} attempts (no response)`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ decision: 'deny', attempt: maxAttempts }));
  }

  /**
   * POST /api/notify — Forward notification to Telegram
   */
  private async handleApiNotify(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.parseBody(req) as {
      title?: string;
      message?: string;
      type?: string;
    };

    if (!body || !body.message) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing required field: message' }));
      return;
    }

    if (!this.comms) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'CommunicationManager not available' }));
      return;
    }

    const title = body.title || 'Claude Code';
    const urgency = body.type === 'error' ? 'high' as const : 'normal' as const;

    await this.comms.notify(title, body.message, urgency);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ sent: true }));
  }

  // ============================================================
  // AFK State Helpers
  // ============================================================

  readAfkState(): { afk: boolean; since: string | null } {
    try {
      if (existsSync(this.afkStatePath)) {
        const raw = readFileSync(this.afkStatePath, 'utf8');
        return JSON.parse(raw);
      }
    } catch {
      // ignore
    }
    return { afk: false, since: null };
  }

  private writeAfkState(state: { afk: boolean; since: string | null }): void {
    try {
      const dir = dirname(this.afkStatePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.afkStatePath, JSON.stringify(state, null, 2));
    } catch (err) {
      console.error('[WebhookServer] Failed to write AFK state:', err);
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
