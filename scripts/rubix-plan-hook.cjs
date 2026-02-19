#!/usr/bin/env node
/**
 * Rubix Plan Mode Hook for Claude Code (PreToolUse: EnterPlanMode)
 *
 * Fires when an instance enters plan mode. Broadcasts plan-mode status
 * to other instances via comms.db and surfaces any unread messages.
 *
 * Input (stdin JSON): { tool_name: "EnterPlanMode", tool_input: {}, cwd, session_id }
 * Output (stdout): Plan-mode context block
 * Exit codes: 0 = allow plan mode to proceed
 */

const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const {
  RUBIX_ROOT,
  readStdin,
  detectProject,
  resolveMcpConfig,
  readHookIdentity,
  readStmJournal,
  getLspLanguageForFile
} = require('./rubix-hook-utils.cjs');

/**
 * Broadcast plan-mode entry to comms.db via direct SQLite write.
 * Uses a write connection (not readonly) to INSERT a status message.
 */
function broadcastPlanStart(dataDir, instanceId, projectName) {
  try {
    const Database = require('better-sqlite3');
    const dbPath = path.join(dataDir, 'comms.db');
    if (!fs.existsSync(dbPath)) return false;

    const db = new Database(dbPath);
    try {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const payload = JSON.stringify({
        action: 'plan_start',
        instance: instanceId,
        project: projectName,
        timestamp: now
      });

      db.prepare(`
        INSERT INTO messages (id, from_instance, to_instance, type, priority, subject, payload, status, created_at, expires_at)
        VALUES (?, ?, NULL, 'status', 0, ?, ?, 'unread', ?, ?)
      `).run(
        id,
        instanceId,
        'Entered plan mode',
        payload,
        now,
        new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString() // expires in 4h
      );

      return true;
    } finally {
      db.close();
    }
  } catch (err) {
    process.stderr.write(`[plan-hook] broadcast error: ${err.message}\n`);
    return false;
  }
}

/**
 * Fetch unread message count and summary from comms.db (readonly).
 * If instance identity is known, filters out self-sent and already-acked broadcasts.
 */
function getUnreadSummary(dataDir, instanceId) {
  try {
    const Database = require('better-sqlite3');
    const dbPath = path.join(dataDir, 'comms.db');
    if (!fs.existsSync(dbPath)) return { count: 0, senders: [] };

    const db = new Database(dbPath, { readonly: true });
    try {
      if (instanceId) {
        const countSql = `
          SELECT COUNT(*) as count FROM (
            SELECT id FROM messages
              WHERE to_instance = ? AND status = 'unread' AND from_instance != ?
            UNION ALL
            SELECT m.id FROM messages m
              LEFT JOIN message_reads mr ON m.id = mr.message_id AND mr.instance_id = ?
              WHERE m.to_instance IS NULL AND mr.message_id IS NULL
              AND m.from_instance != ? AND m.status != 'expired'
          )`;
        const row = db.prepare(countSql).get(instanceId, instanceId, instanceId, instanceId);
        const sendersSql = `
          SELECT DISTINCT from_instance FROM (
            SELECT from_instance FROM messages
              WHERE to_instance = ? AND status = 'unread' AND from_instance != ?
            UNION ALL
            SELECT m.from_instance FROM messages m
              LEFT JOIN message_reads mr ON m.id = mr.message_id AND mr.instance_id = ?
              WHERE m.to_instance IS NULL AND mr.message_id IS NULL
              AND m.from_instance != ? AND m.status != 'expired'
          ) LIMIT 5`;
        const senders = db.prepare(sendersSql).all(instanceId, instanceId, instanceId, instanceId);
        return {
          count: row.count,
          senders: senders.map(s => s.from_instance)
        };
      }
      // Fallback: no identity — count all unread
      const row = db.prepare(`SELECT COUNT(*) as count FROM messages WHERE status = 'unread'`).get();
      const senders = db.prepare(`SELECT DISTINCT from_instance FROM messages WHERE status = 'unread'`).all();
      return {
        count: row.count,
        senders: senders.map(s => s.from_instance)
      };
    } finally {
      db.close();
    }
  } catch {
    return { count: 0, senders: [] };
  }
}

/**
 * Build [LSP+LINT] directive from recently-edited files in STM journal.
 * Returns a multi-line string or null if no LSP-supported files were edited.
 */
function getLspDirective(dataDir) {
  const journal = readStmJournal(dataDir);
  if (!journal || !journal.signals || journal.signals.length === 0) return null;

  const lspFiles = new Map(); // lang -> Set<filePath>
  for (const sig of journal.signals) {
    if ((sig.type === 'edit' || sig.type === 'write') && sig.file) {
      const lang = sig.lspLang || getLspLanguageForFile(sig.file);
      if (lang) {
        if (!lspFiles.has(lang)) lspFiles.set(lang, new Set());
        lspFiles.get(lang).add(sig.file);
      }
    }
  }
  if (lspFiles.size === 0) return null;

  const lines = ['[LSP+LINT] Recently-edited files have LSP + linter coverage. Before planning, check for errors:'];
  for (const [lang, files] of lspFiles) {
    const names = [...files].slice(0, 5).map(f => path.basename(f)).join(', ');
    const tools = (lang === 'typescript' || lang === 'javascript')
      ? 'god_lsp_diagnostics + god_analyze_lint + god_analyze_types'
      : 'god_lsp_diagnostics';
    lines.push(`  ${lang}: ${names} → ${tools}`);
  }
  lines.push('  Start servers first: god_lsp_start({language})');
  lines.push('  Check structure: god_lsp_symbols({query}) for key types/functions');
  return lines.join('\n');
}

async function main() {
  const input = await readStdin() || {};

  const cwd = input.cwd || process.cwd();
  const project = detectProject(cwd);
  const mcpConfig = resolveMcpConfig();

  let dataDir = './data';
  if (mcpConfig && project) {
    dataDir = mcpConfig[project.instance]?.dataDir || './data';
  }
  const dataDirResolved = path.isAbsolute(dataDir) ? dataDir : path.join(RUBIX_ROOT, dataDir);

  // Read persisted instance identity (written by god_comms_heartbeat)
  const identity = readHookIdentity(dataDirResolved);
  const instanceId = identity?.instanceId || 'unknown';
  const instanceName = identity?.name || null;
  const instanceLabel = instanceName ? `${instanceName} (${instanceId})` : instanceId;
  const projectName = project?.name || 'Unknown';
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', { hour12: false });

  // Broadcast plan-mode entry to other instances
  const broadcasted = broadcastPlanStart(dataDirResolved, instanceId, projectName);

  // Check for unread comms (instance-aware if identity known)
  const unread = getUnreadSummary(dataDirResolved, identity ? instanceId : null);

  // Output context block
  console.log(`[PLAN MODE] Instance: ${instanceLabel} | Project: ${projectName} | Time: ${timeStr}`);

  if (broadcasted) {
    console.log(`[COMMS] Broadcasted plan_start to all instances`);
  }

  if (unread.count > 0) {
    console.log(`[COMMS] ${unread.count} unread message(s) from: ${unread.senders.join(', ')} — check god_comms_inbox after heartbeat`);
  }

  // LSP + linter directive for recently-edited files
  const lspDirective = getLspDirective(dataDirResolved);
  if (lspDirective) console.log(lspDirective);

  // Always exit 0 — allow plan mode to proceed
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`[plan-hook] error: ${err.message}\n`);
  process.exit(0);
});
