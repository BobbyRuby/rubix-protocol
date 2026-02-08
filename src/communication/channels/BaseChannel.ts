/**
 * BaseChannel - Abstract base class for all communication channels
 */

import type {
  ChannelType,
  ChannelStatus,
  EscalationRequest,
  EscalationResponse,
  IChannel
} from '../types.js';

export interface PendingRequest {
  request: EscalationRequest;
  resolve: (response: EscalationResponse | null) => void;
  timeoutHandle: NodeJS.Timeout;
}

export abstract class BaseChannel implements IChannel {
  abstract readonly type: ChannelType;
  protected status: ChannelStatus = 'idle';
  protected pendingRequests: Map<string, PendingRequest> = new Map();

  abstract get isConfigured(): boolean;
  abstract send(request: EscalationRequest): Promise<boolean>;
  abstract canReceiveResponses(): boolean;
  abstract test(): Promise<boolean>;
  protected abstract parseResponse(payload: unknown): Promise<EscalationResponse | null>;

  /**
   * Send and wait for response (blocking)
   */
  async sendAndWait(request: EscalationRequest): Promise<EscalationResponse | null> {
    return new Promise(async (resolve) => {
      // Set timeout
      const timeoutHandle = setTimeout(() => {
        this.pendingRequests.delete(request.id);
        this.status = 'timeout';
        console.log(`[${this.type}] Request ${request.id.slice(0,8)} timed out`);
        resolve(null);
      }, request.timeout);

      // Store pending request
      this.pendingRequests.set(request.id, {
        request,
        resolve,
        timeoutHandle
      });

      // Send the request
      this.status = 'sending';
      console.log(`[${this.type}] Sending request ${request.id.slice(0,8)}...`);

      const sent = await this.send(request);

      if (!sent) {
        clearTimeout(timeoutHandle);
        this.pendingRequests.delete(request.id);
        this.status = 'error';
        console.log(`[${this.type}] Failed to send request`);
        resolve(null);
        return;
      }

      this.status = 'waiting';
      console.log(`[${this.type}] Waiting for response...`);
    });
  }

  /**
   * Handle incoming response from webhook/listener
   */
  async handleIncomingResponse(payload: unknown): Promise<void> {
    let response: EscalationResponse | null = null;

    // Check for synthetic payload (injected from MCP tool)
    if (payload && typeof payload === 'object' && '_synthetic' in payload) {
      const synthetic = payload as { _synthetic: boolean; requestId: string; response: string };
      response = {
        requestId: synthetic.requestId,
        channel: this.type,
        response: synthetic.response,
        receivedAt: new Date()
      };
      console.log(`[${this.type}] Processing synthetic MCP response`);
    } else {
      response = await this.parseResponse(payload);
    }

    if (!response) {
      console.log(`[${this.type}] Could not parse response payload`);
      return;
    }

    // Try to find matching pending request
    let pending = this.pendingRequests.get(response.requestId);

    // If not found by ID, use most recent pending request
    if (!pending && this.pendingRequests.size > 0) {
      const [lastId] = Array.from(this.pendingRequests.keys()).slice(-1);
      pending = this.pendingRequests.get(lastId);
      if (pending) {
        response.requestId = lastId;
      }
    }

    if (pending) {
      clearTimeout(pending.timeoutHandle);
      this.pendingRequests.delete(response.requestId);
      this.status = 'responded';
      console.log(`[${this.type}] Got response: ${response.response.slice(0, 100)}...`);
      pending.resolve(response);
    } else {
      console.log(`[${this.type}] No pending request for response`);
    }
  }

  /**
   * Get current channel status
   */
  getStatus(): ChannelStatus {
    return this.status;
  }

  /**
   * Check if there are pending requests awaiting response
   */
  hasPendingRequests(): boolean {
    return this.pendingRequests.size > 0;
  }

  /**
   * Find request by short reference ID
   */
  protected findRequestByRef(ref: string | undefined): string | null {
    if (!ref) return null;
    for (const [id] of this.pendingRequests) {
      if (id.startsWith(ref) || id.slice(0, 8) === ref) {
        return id;
      }
    }
    return null;
  }

  /**
   * Get short reference ID for message tracking
   */
  protected getShortRef(requestId: string): string {
    return requestId.slice(0, 8);
  }

  /**
   * Track a sent request for response correlation
   */
  protected trackRequest(request: EscalationRequest): void {
    // Store request without a resolve callback (for fire-and-forget sends)
    // The request can still be found by findRequestByRef for response matching
    if (!this.pendingRequests.has(request.id)) {
      this.pendingRequests.set(request.id, {
        request,
        resolve: () => {},  // No-op resolve for tracked-only requests
        timeoutHandle: setTimeout(() => {
          this.pendingRequests.delete(request.id);
        }, request.timeout || 600000)
      });
    }
  }

  /**
   * Extend timeout for pending requests by additional time
   * Returns true if any pending request was extended, false otherwise
   */
  extendTimeout(additionalMs: number = 600000): { extended: boolean; newTimeout?: Date; requestId?: string } {
    if (this.pendingRequests.size === 0) {
      return { extended: false };
    }

    // Find the most recent pending request
    const entries = Array.from(this.pendingRequests.entries());
    const [requestId, pending] = entries[entries.length - 1];

    // Clear existing timeout
    clearTimeout(pending.timeoutHandle);

    // Calculate new timeout end time
    const newTimeoutEnd = new Date(Date.now() + additionalMs);

    // Create new timeout
    pending.timeoutHandle = setTimeout(() => {
      this.pendingRequests.delete(requestId);
      this.status = 'timeout';
      console.log(`[${this.type}] Request ${requestId.slice(0,8)} timed out after extension`);
      pending.resolve(null);
    }, additionalMs);

    console.log(`[${this.type}] Extended timeout for ${requestId.slice(0,8)} by ${additionalMs/60000} minutes`);

    return {
      extended: true,
      newTimeout: newTimeoutEnd,
      requestId: requestId.slice(0, 8)
    };
  }

  /**
   * Get remaining time for pending requests
   */
  getPendingInfo(): Array<{ requestId: string; title: string; waitingSince: Date }> {
    return Array.from(this.pendingRequests.values()).map(p => ({
      requestId: p.request.id.slice(0, 8),
      title: p.request.title,
      waitingSince: p.request.createdAt
    }));
  }
}
