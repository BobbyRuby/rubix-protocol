/**
 * PermissionDetector
 *
 * Detects Claude Code CLI permission prompts in stdout and parses them
 * for routing to Telegram approval.
 */

import { randomUUID } from 'crypto';

/**
 * Represents a permission request from Claude Code CLI
 */
export interface PermissionRequest {
  id: string;
  instanceId: string;
  tool: string;
  command: string;
  fullPrompt: string;
  timestamp: Date;
}

/**
 * Patterns to detect permission prompts from Claude Code CLI
 * These match the various formats Claude Code uses to ask for permission
 */
const PERMISSION_PATTERNS = [
  // "Allow Bash(npm install)? [y/n]"
  /Allow\s+(\w+)\(([^)]+)\)\?\s*\[y\/n\]/i,
  // "Allow Bash for this session? [y/n]" with command on previous line
  /Allow\s+(\w+)\s+for\s+this\s+session\?\s*\[y\/n\]/i,
  // Generic permission request
  /Do you want to allow\s+(.+)\?\s*\[y\/n\]/i,
  // Bash permission with command
  /Bash:\s*(.+)\n.*\[y\/n\]/i,
  // Tool permission pattern
  /(\w+)\s+permission.*\[y\/n\]/i
];

/**
 * Pattern to extract the command from surrounding context
 */
const COMMAND_CONTEXT_PATTERN = /(?:Bash|Execute|Run|Command)[:=]?\s*[`"']?([^`"'\n]+)[`"']?/i;

/**
 * Detects and parses permission prompts from Claude Code CLI output
 */
export class PermissionDetector {
  private instanceId: string;
  private buffer: string = '';
  private pendingRequests: Map<string, PermissionRequest> = new Map();

  constructor(instanceId?: string) {
    this.instanceId = instanceId || randomUUID();
  }

  /**
   * Process incoming stdout data and detect permission prompts
   * Returns a PermissionRequest if one is detected, null otherwise
   */
  detect(output: string): PermissionRequest | null {
    // Add to buffer for context (keep last 2000 chars)
    this.buffer += output;
    if (this.buffer.length > 2000) {
      this.buffer = this.buffer.slice(-2000);
    }

    // Check each pattern
    for (const pattern of PERMISSION_PATTERNS) {
      const match = this.buffer.match(pattern);
      if (match) {
        const request = this.parsePermissionRequest(match, this.buffer);
        if (request) {
          // Clear the matched portion from buffer to avoid re-detection
          this.buffer = '';
          this.pendingRequests.set(request.id, request);
          return request;
        }
      }
    }

    return null;
  }

  /**
   * Parse a permission request from regex match and context
   */
  private parsePermissionRequest(match: RegExpMatchArray, context: string): PermissionRequest | null {
    let tool = 'Bash';
    let command = '';

    // Try to extract tool and command from match groups
    if (match[1]) {
      // Check if match[1] looks like a tool name
      if (/^[A-Z][a-z]+$/.test(match[1])) {
        tool = match[1];
        command = match[2] || '';
      } else {
        // match[1] is probably the command
        command = match[1];
      }
    }

    // If no command found in match, try to extract from context
    if (!command) {
      const cmdMatch = context.match(COMMAND_CONTEXT_PATTERN);
      if (cmdMatch) {
        command = cmdMatch[1].trim();
      }
    }

    // Clean up command
    command = command.trim();
    if (!command) {
      command = 'unknown command';
    }

    // Extract the full prompt text for display
    const promptLines = context.split('\n').slice(-10).join('\n');

    return {
      id: randomUUID(),
      instanceId: this.instanceId,
      tool,
      command,
      fullPrompt: promptLines,
      timestamp: new Date()
    };
  }

  /**
   * Get a pending request by ID
   */
  getPendingRequest(id: string): PermissionRequest | undefined {
    return this.pendingRequests.get(id);
  }

  /**
   * Remove a pending request (after it's been handled)
   */
  removePendingRequest(id: string): void {
    this.pendingRequests.delete(id);
  }

  /**
   * Check if there are any pending permission requests
   */
  hasPendingRequests(): boolean {
    return this.pendingRequests.size > 0;
  }

  /**
   * Reset the detector state
   */
  reset(): void {
    this.buffer = '';
    this.pendingRequests.clear();
  }

  /**
   * Format a permission request for Telegram display
   */
  static formatForTelegram(request: PermissionRequest): string {
    return `🔐 *Permission Request*

*Tool:* \`${request.tool}\`
*Command:*
\`\`\`
${request.command}
\`\`\`

*Instance:* \`${request.instanceId.slice(0, 8)}\`
*Time:* ${request.timestamp.toLocaleTimeString()}`;
  }
}
