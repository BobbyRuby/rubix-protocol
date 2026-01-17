/**
 * PermissionDetector
 *
 * Detects Claude Code CLI permission prompts in stdout and parses them
 * for routing to Telegram approval or auto-response.
 */

import { randomUUID } from 'crypto';

/**
 * Classification of prompt types for handling logic
 */
export type PromptType =
  | 'permission'      // Tool permission [y/n] - route to Telegram
  | 'continuation'    // Continue/Enter - auto-respond
  | 'selection'       // Choose option [1/2/3] - route to Telegram
  | 'input'           // Free text input expected - route to Telegram
  | 'confirmation'    // yes/no safety check - depends on risk level
  | 'retry';          // Retry? [y/n/r] - auto-yes typically safe

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
  /** Classification of the prompt type */
  type: PromptType;
}

/**
 * Pattern definition with type classification
 */
interface PatternDef {
  pattern: RegExp;
  type: PromptType;
}

/**
 * Comprehensive patterns to detect prompts from Claude Code CLI
 * Organized by prompt type for proper handling
 */
const PROMPT_PATTERNS: PatternDef[] = [
  // ===== PERMISSION PROMPTS (route to Telegram) =====
  // "Allow Bash(npm install)? [y/n]"
  { pattern: /Allow\s+(\w+)\(([^)]+)\)\?\s*\[y\/n\]/i, type: 'permission' },
  // "Allow Bash for this session? [y/n]" with command on previous line
  { pattern: /Allow\s+(\w+)\s+for\s+this\s+session\?\s*\[y\/n\]/i, type: 'permission' },
  // Generic permission request
  { pattern: /Do you want to allow\s+(.+)\?\s*\[y\/n\]/i, type: 'permission' },
  // Bash permission with command
  { pattern: /Bash:\s*(.+)\n.*\[y\/n\]/i, type: 'permission' },
  // Tool permission pattern
  { pattern: /(\w+)\s+permission.*\[y\/n\]/i, type: 'permission' },
  // Allow/deny patterns
  { pattern: /Allow\s+this\s+(\w+).*\?\s*\[y\/n\]/i, type: 'permission' },
  { pattern: /Approve\s+(\w+).*\?\s*\[y\/n\]/i, type: 'permission' },

  // ===== CONTINUATION PROMPTS (auto-respond with Enter) =====
  { pattern: /Continue\?\s*\[(y|n|continue|c)\]/i, type: 'continuation' },
  { pattern: /Press\s+Enter\s+to\s+continue/i, type: 'continuation' },
  { pattern: /\[Enter\]\s*to\s+continue/i, type: 'continuation' },
  { pattern: /Press\s+any\s+key\s+to\s+continue/i, type: 'continuation' },
  { pattern: /Hit\s+enter\s+to\s+continue/i, type: 'continuation' },
  { pattern: /Continue\s+with\s+.*\?\s*\[y\/n\]/i, type: 'continuation' },
  { pattern: /Proceed\?\s*\[y\/n\]/i, type: 'continuation' },

  // ===== RETRY PROMPTS (typically safe to auto-yes) =====
  { pattern: /Retry\?\s*\[(y|n|r)\]/i, type: 'retry' },
  { pattern: /Try\s+again\?\s*\[y\/n\]/i, type: 'retry' },
  { pattern: /Attempt\s+again\?\s*\[y\/n\]/i, type: 'retry' },

  // ===== SELECTION PROMPTS (route to Telegram) =====
  { pattern: /Select.*\[(\d+)(?:\/\d+)+\]/i, type: 'selection' },
  { pattern: /Choose.*\[(\d+(?:-\d+)?)\]/i, type: 'selection' },
  { pattern: /Option\s*\[\d+(?:\/\d+)*\]:/i, type: 'selection' },
  { pattern: /Enter\s+option\s*\(?\d+-\d+\)?:/i, type: 'selection' },
  { pattern: /Which\s+.*\?\s*\[\d+\]/i, type: 'selection' },

  // ===== CONFIRMATION PROMPTS (depends on risk level) =====
  { pattern: /Are\s+you\s+sure\?/i, type: 'confirmation' },
  { pattern: /This\s+cannot\s+be\s+undone.*\[yes\/no\]/i, type: 'confirmation' },
  { pattern: /\[yes\/no\]/i, type: 'confirmation' },
  { pattern: /Confirm\??\s*\[y\/n\]/i, type: 'confirmation' },
  { pattern: /Overwrite\?\s*\[(y|n|a)\]/i, type: 'confirmation' },
  { pattern: /File\s+exists.*Overwrite\?\s*\[y\/n\]/i, type: 'confirmation' },
  { pattern: /Replace\?\s*\[y\/n\]/i, type: 'confirmation' },
  { pattern: /Delete\?\s*\[y\/n\]/i, type: 'confirmation' },

  // ===== INPUT PROMPTS (route to Telegram) =====
  // Line ending with colon expecting input (but exclude file paths and common log patterns)
  { pattern: /^(?!.*(?:\.ts|\.js|\.json|\.md|Error|Warning|Info|DEBUG|WARN):).+:\s*$/m, type: 'input' },
  // Prompt for value
  { pattern: /Enter\s+(?:a\s+)?value\s*:/i, type: 'input' },
  { pattern: /(?:Name|Email|Password|Token|Key|Value|Path|URL|Host|Port):\s*$/i, type: 'input' },
  // Shell-like prompt endings
  { pattern: />\s*$/m, type: 'input' }
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
    for (const { pattern, type } of PROMPT_PATTERNS) {
      const match = this.buffer.match(pattern);
      if (match) {
        const request = this.parsePermissionRequest(match, this.buffer, type);
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
  private parsePermissionRequest(
    match: RegExpMatchArray,
    context: string,
    type: PromptType
  ): PermissionRequest | null {
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
      timestamp: new Date(),
      type
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
    const typeEmoji = {
      permission: '🔐',
      continuation: '⏩',
      selection: '📋',
      input: '✏️',
      confirmation: '⚠️',
      retry: '🔄'
    }[request.type] || '❓';

    return `${typeEmoji} *${request.type.charAt(0).toUpperCase() + request.type.slice(1)} Request*

*Tool:* \`${request.tool}\`
*Type:* \`${request.type}\`
*Command:*
\`\`\`
${request.command}
\`\`\`

*Context:*
\`\`\`
${request.fullPrompt.slice(-500)}
\`\`\`

*Instance:* \`${request.instanceId.slice(0, 8)}\`
*Time:* ${request.timestamp.toLocaleTimeString()}`;
  }

  /**
   * Check if a prompt type should be auto-responded
   */
  static isAutoRespondType(type: PromptType): boolean {
    return type === 'continuation' || type === 'retry';
  }

  /**
   * Get the default auto-response for a prompt type
   */
  static getDefaultAutoResponse(type: PromptType): string | null {
    switch (type) {
      case 'continuation':
        return '\n';  // Press Enter
      case 'retry':
        return 'y\n'; // Auto-retry
      default:
        return null;  // No auto-response
    }
  }
}
