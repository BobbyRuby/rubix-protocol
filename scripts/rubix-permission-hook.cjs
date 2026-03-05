#!/usr/bin/env node
/**
 * Rubix Permission Hook for Claude Code (PermissionRequest)
 *
 * Routes tool permission requests based on context:
 *
 * 1. ORCHESTRA MODE (comms relay):
 *    When orchestra is active and this is a worker instance (not Forge/instance_1),
 *    writes a permission request to comms.db → Forge asks the user → response relayed back.
 *
 * 2. AFK MODE (Telegram):
 *    When AFK is active, routes to Telegram daemon for remote approval.
 *
 * 3. DEFAULT:
 *    Exits cleanly → normal Claude Code permission flow (keyboard prompt).
 *
 * Input (stdin JSON): { tool_name, tool_input, permission_suggestions, cwd, session_id }
 * Output (stdout JSON): hookSpecificOutput with decision: allow|deny
 */

const path = require('path');
const {
  RUBIX_ROOT,
  readStdin,
  readAfkState,
  readHookIdentity,
  httpPost,
  isOrchestraActive,
  writeCommsPermissionRequest,
  pollCommsPermissionResponse
} = require('./rubix-hook-utils.cjs');

/**
 * Build a human-readable summary of the tool request.
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

function outputDecision(behavior, message) {
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: { behavior, message }
    }
  }));
}

async function main() {
  const input = await readStdin();
  if (!input) return;

  const toolName = input.tool_name || 'unknown';
  const toolInput = input.tool_input || {};
  const sessionId = input.session_id || '';
  const summary = summarizeTool(toolName, toolInput);

  // --- Mode 1: Orchestra Comms Relay ---
  if (isOrchestraActive()) {
    const dataDir = path.join(RUBIX_ROOT, 'data');
    const identity = readHookIdentity(dataDir);

    // Forge (instance_1) = user is right here, skip relay
    if (identity && identity.instanceId === 'instance_1') {
      return; // Normal permission flow
    }

    // Worker instance — relay to Forge via comms.db
    const instanceId = identity ? identity.instanceId : 'unknown_worker';
    const msgId = writeCommsPermissionRequest(instanceId, toolName, summary, toolInput);

    if (msgId) {
      // Poll for Forge's response (max 3 minutes)
      const response = pollCommsPermissionResponse(msgId, 180000);

      if (response && response.allowed !== undefined) {
        const decision = response.allowed ? 'allow' : 'deny';
        outputDecision(decision, `${decision === 'allow' ? 'Approved' : 'Denied'} by Forge via comms relay`);
      } else {
        outputDecision('deny', 'Comms relay: no response from Forge after 3 minutes. Denied for safety.');
      }
      return;
    }
    // If comms write failed, fall through to AFK check
  }

  // --- Mode 2: AFK Mode (Telegram) ---
  const afkState = readAfkState();
  if (!afkState.afk) {
    return; // Not AFK, normal Claude Code permission flow
  }

  // POST to daemon's permission endpoint
  const response = await httpPost('http://localhost:3456/api/permission', {
    tool_name: toolName,
    summary: summary,
    tool_input: toolInput,
    session_id: sessionId
  }, 390000);

  if (response && response.decision) {
    outputDecision(
      response.decision === 'allow' ? 'allow' : 'deny',
      `${response.decision === 'allow' ? 'Approved' : 'Denied'} via Telegram AFK mode (attempt ${response.attempt || 1})`
    );
  } else {
    outputDecision('deny', 'AFK permission: no response from Telegram after 3 attempts (6 min). Denied for safety.');
  }
}

main().catch(() => {
  // On error, let normal permission flow happen (don't block)
});
