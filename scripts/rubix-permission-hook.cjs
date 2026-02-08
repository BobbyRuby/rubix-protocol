#!/usr/bin/env node
/**
 * Rubix AFK Permission Hook for Claude Code (PermissionRequest)
 *
 * When AFK mode is active, routes ALL tool permission requests to Telegram
 * via the daemon's /api/permission endpoint. This enables full remote control
 * from Telegram — the user can approve/deny tool executions from their phone.
 *
 * When NOT AFK, exits immediately (normal Claude Code permission flow at keyboard).
 *
 * Input (stdin JSON): { tool_name, tool_input, permission_suggestions, cwd, session_id }
 * Output (stdout JSON): hookSpecificOutput with decision: allow|deny
 */

const {
  readStdin,
  readAfkState,
  httpPost
} = require('./rubix-hook-utils.cjs');

/**
 * Build a human-readable summary of the tool request for Telegram display.
 */
function summarizeTool(toolName, toolInput) {
  if (!toolInput) return toolName;

  switch (toolName) {
    case 'Bash':
      return `Run: ${(toolInput.command || '').substring(0, 200)}`;
    case 'Write':
      return `Write file: ${toolInput.file_path || 'unknown'}`;
    case 'Edit':
      return `Edit file: ${toolInput.file_path || 'unknown'}`;
    case 'MultiEdit':
      return `Multi-edit: ${(toolInput.edits || []).map(e => e.file_path).join(', ').substring(0, 200)}`;
    case 'WebFetch':
      return `Fetch URL: ${toolInput.url || 'unknown'}`;
    case 'WebSearch':
      return `Search: ${toolInput.query || 'unknown'}`;
    case 'NotebookEdit':
      return `Edit notebook: ${toolInput.notebook_path || 'unknown'}`;
    default:
      // MCP tools or other tools
      if (toolName.startsWith('mcp__')) {
        const parts = toolName.split('__');
        const mcpTool = parts[parts.length - 1] || toolName;
        const keyArgs = Object.entries(toolInput || {})
          .slice(0, 3)
          .map(([k, v]) => `${k}=${String(v).substring(0, 50)}`)
          .join(', ');
        return `MCP ${mcpTool}: ${keyArgs}`;
      }
      return `${toolName}: ${JSON.stringify(toolInput).substring(0, 150)}`;
  }
}

async function main() {
  const input = await readStdin();
  if (!input) return; // No input, exit cleanly

  // Check AFK state
  const afkState = readAfkState();
  if (!afkState.afk) {
    // Not AFK — exit 0, normal Claude Code permission flow
    return;
  }

  // AFK mode active — route to Telegram via daemon
  const toolName = input.tool_name || 'unknown';
  const toolInput = input.tool_input || {};
  const sessionId = input.session_id || '';
  const summary = summarizeTool(toolName, toolInput);

  // POST to daemon's permission endpoint
  // Server handles retry escalation (3 attempts x 120s each)
  const response = await httpPost('http://localhost:3456/api/permission', {
    tool_name: toolName,
    summary: summary,
    tool_input: toolInput,
    session_id: sessionId
  }, 390000); // 390s timeout (server does 3x120s retries internally)

  if (response && response.decision) {
    // Output hook-specific response
    const output = {
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: {
          behavior: response.decision === 'allow' ? 'allow' : 'deny',
          message: `${response.decision === 'allow' ? 'Approved' : 'Denied'} via Telegram AFK mode (attempt ${response.attempt || 1})`
        }
      }
    };
    console.log(JSON.stringify(output));
  } else {
    // Timeout or error — deny for safety
    const output = {
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: {
          behavior: 'deny',
          message: 'AFK permission: no response from Telegram after 3 attempts (6 min). Denied for safety.'
        }
      }
    };
    console.log(JSON.stringify(output));
  }
}

main().catch(() => {
  // On error, let normal permission flow happen (don't block)
});
