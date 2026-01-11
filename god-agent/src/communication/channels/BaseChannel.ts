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
    const response = await this.parseResponse(payload);
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
        }, request.timeout || 300000)
      });
    }
  }
}
