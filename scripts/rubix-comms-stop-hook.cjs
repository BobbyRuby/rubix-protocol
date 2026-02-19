#!/usr/bin/env node
/**
 * Rubix Comms Stop Hook for Claude Code (Stop event)
 *
 * Fires after every assistant response. Checks comms.db for unread
 * inter-instance messages. If found, prints them to stdout and exits
 * with code 2 to force Claude to continue processing them.
 *
 * Loop prevention: The Stop hook receives `stop_hook_active: true` on
 * the second invocation (after Claude processed the injected messages).
 * When set, we exit 0 immediately so Claude stops normally.
 *
 * Input (stdin JSON): { stop_hook_active, session_id, ... }
 * Output (stdout): Formatted unread messages (if any)
 * Exit codes: 0 = stop normally, 2 = continue (messages found)
 */

const path = require('path');
const { execFileSync } = require('child_process');
const {
  RUBIX_ROOT,
  readStdin,
  detectProject,
  resolveMcpConfig,
  readHookIdentity,
  readPendingRating,
  deletePendingRating,
  readRatingCounter,
  incrementRatingCounter,
  readStmJournal,
  deleteStmJournal,
  computeStmImportance,
  synthesizeStmContent,
  filePathToSkillTags,
  readLastStmStore,
  writeLastStmStore,
  getUndiagnosedFiles,
  clearQcLedger
} = require('./rubix-hook-utils.cjs');

/**
 * Fetch unread messages relevant to this instance from comms.db.
 * If instance identity is known, filters out self-sent and already-acked broadcasts.
 * Returns array of message objects or empty array.
 */
function getUnreadMessages(dataDir) {
  try {
    const Database = require('better-sqlite3');
    const fs = require('fs');
    const dbPath = path.join(dataDir, 'comms.db');
    if (!fs.existsSync(dbPath)) return [];

    const identity = readHookIdentity(dataDir);
    const db = new Database(dbPath, { readonly: true });
    try {
      if (identity && identity.instanceId) {
        const iid = identity.instanceId;
        // Instance-aware: direct messages to me + broadcasts not from me and not yet acked
        const rows = db.prepare(`
          SELECT id, from_instance, to_instance, type, priority, subject, payload, thread_id, created_at FROM (
            SELECT * FROM messages
              WHERE to_instance = ? AND status = 'unread' AND from_instance != ?
            UNION ALL
            SELECT m.* FROM messages m
              LEFT JOIN message_reads mr ON m.id = mr.message_id AND mr.instance_id = ?
              WHERE m.to_instance IS NULL AND mr.message_id IS NULL
              AND m.from_instance != ? AND m.status != 'expired'
          )
          ORDER BY priority DESC, created_at ASC
          LIMIT 20
        `).all(iid, iid, iid, iid);
        return rows;
      }
      // Fallback: no identity — return all unread (old behavior)
      const rows = db.prepare(`
        SELECT id, from_instance, to_instance, type, priority, subject, payload, thread_id, created_at
        FROM messages
        WHERE status = 'unread'
        ORDER BY priority DESC, created_at ASC
        LIMIT 20
      `).all();
      return rows;
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

/**
 * Format a single message for display.
 */
function formatMessage(msg, index) {
  const priorityLabel = msg.priority >= 2 ? ' [URGENT]' : msg.priority >= 1 ? ' [HIGH]' : '';
  const subject = msg.subject || '(no subject)';
  const from = msg.from_instance || 'unknown';
  const type = msg.type || 'message';

  // Parse and truncate payload
  let payloadPreview = '';
  try {
    const payload = JSON.parse(msg.payload);
    // Show a useful preview of the payload
    if (typeof payload === 'string') {
      payloadPreview = payload;
    } else if (payload.msg || payload.message || payload.content || payload.text) {
      payloadPreview = payload.msg || payload.message || payload.content || payload.text;
    } else {
      payloadPreview = JSON.stringify(payload);
    }
  } catch {
    payloadPreview = msg.payload || '';
  }

  // Truncate payload to 500 chars
  if (payloadPreview.length > 500) {
    payloadPreview = payloadPreview.substring(0, 500) + '...';
  }

  const time = msg.created_at || '';
  return `  ${index}. [${type}]${priorityLabel} from ${from} — "${subject}" (${time})\n     ${payloadPreview}`;
}

async function main() {
  const input = await readStdin() || {};

  // Loop prevention: if this is the second stop after we already injected messages, exit cleanly
  if (input.stop_hook_active) {
    process.exit(0);
    return;
  }

  // Detect project + resolve data dir
  const cwd = input.cwd || process.cwd();
  const project = detectProject(cwd);
  const mcpConfig = resolveMcpConfig();

  let dataDir = './data';
  if (mcpConfig && project) {
    dataDir = mcpConfig[project.instance]?.dataDir || './data';
  }
  const dataDirResolved = path.isAbsolute(dataDir) ? dataDir : path.join(RUBIX_ROOT, dataDir);

  // DEBUG: trace resolution path (stderr so it doesn't interfere with stdout)
  const dbPath = path.join(dataDirResolved, 'comms.db');
  const dbExists = require('fs').existsSync(dbPath);
  process.stderr.write(`[comms-stop] input keys: ${JSON.stringify(Object.keys(input))}, cwd: ${cwd}, project: ${project?.instance || 'null'}, dataDir: ${dataDirResolved}, comms.db exists: ${dbExists}\n`);

  let needsContinue = false;

  // ─── Phase 1: Check for unread inter-instance messages ───
  const messages = getUnreadMessages(dataDirResolved);
  process.stderr.write(`[comms-stop] messages found: ${messages.length}\n`);

  if (messages.length > 0) {
    const urgentCount = messages.filter(m => m.priority >= 2).length;
    const senders = [...new Set(messages.map(m => m.from_instance))];

    console.log('');
    console.log('═══════════════════════════════════════════════════');
    console.log(`[INTER-INSTANCE COMMS] ${messages.length} unread message(s) detected`);
    if (urgentCount > 0) {
      console.log(`  ⚠ ${urgentCount} URGENT message(s)`);
    }
    console.log(`  From: ${senders.join(', ')}`);
    console.log('───────────────────────────────────────────────────');

    messages.forEach((msg, i) => {
      console.log(formatMessage(msg, i + 1));
    });

    console.log('───────────────────────────────────────────────────');
    console.log('ACTION REQUIRED: Process these messages now.');
    console.log('1. Call god_comms_heartbeat with your instance identity');
    console.log('2. Call god_comms_inbox to retrieve messages via MCP');
    console.log('3. Call god_comms_ack for each message after processing');
    console.log('═══════════════════════════════════════════════════');
    console.log('');
    needsContinue = true;
  }

  // ─── Phase 2: Mandatory query rating (50% enforcement) ───
  const pendingRating = readPendingRating(dataDirResolved);
  if (pendingRating) {
    const ratingAge = Date.now() - new Date(pendingRating.timestamp).getTime();
    const isStale = ratingAge > 10 * 60 * 1000; // 10 min

    if (!isStale && pendingRating.trajectoryId) {
      const counter = incrementRatingCounter(dataDirResolved);
      const shouldRate = (counter % 2 === 1); // odd = rate

      if (shouldRate) {
        const tid = pendingRating.trajectoryId;
        const qid = pendingRating.queryId || 'none';
        console.log('');
        console.log('═══════════════════════════════════════════════════');
        console.log('[RATE RECALLS] Rate the memories recalled for your last prompt.');
        console.log('Use AskUserQuestion:');
        console.log('  Question: "How relevant were the recalled memories?"');
        console.log('  Options: "9-10 Spot on" / "7-8 Helpful" / "4-6 Okay" / "1-3 Barely" / "0 Useless"');
        console.log(`Then call: god_learn(trajectoryId="${tid}", quality=<score>/10, memrlQueryId="${qid}")`);
        console.log('═══════════════════════════════════════════════════');
        console.log('');
        needsContinue = true;
      }
    }

    // Always delete pending rating to prevent stale buildup
    deletePendingRating(dataDirResolved);
  }

  // ─── Phase 2.5: QC Debt Check ───
  const undiagnosedFiles = getUndiagnosedFiles(dataDirResolved);
  if (undiagnosedFiles.length > 0) {
    console.log('');
    console.log('═══════════════════════════════════════════════════');
    console.log(`[QC DEBT] ${undiagnosedFiles.length} file(s) edited but never diagnosed:`);
    for (const { file, lang } of undiagnosedFiles) {
      const tools = (lang === 'typescript' || lang === 'javascript')
        ? 'god_lsp_diagnostics + god_analyze_lint + god_analyze_types'
        : 'god_lsp_diagnostics';
      console.log(`  ${path.basename(file)} (${lang}) → ${tools}`);
    }
    console.log('Run diagnostics on these files before finishing.');
    console.log('═══════════════════════════════════════════════════');
    console.log('');
    needsContinue = true;
  }

  // ─── Phase 3: Auto-STM store from journal ───
  const journal = readStmJournal(dataDirResolved);
  if (journal && journal.signals && journal.signals.length > 0 && !journal.manualStmCalled) {
    const importance = computeStmImportance(journal.signals);
    process.stderr.write(`[comms-stop] STM journal: ${journal.signals.length} signals, importance=${importance.toFixed(2)}\n`);

    if (importance >= 0.3) {
      // Check 5-min cooldown
      const lastStore = readLastStmStore(dataDirResolved);
      const cooldownOk = (Date.now() - lastStore) > 5 * 60 * 1000;

      if (cooldownOk) {
        const content = synthesizeStmContent(journal.signals);
        const today = new Date().toISOString().split('T')[0];

        // Collect skill tags from file extensions
        const skillTags = new Set();
        for (const s of journal.signals) {
          if (s.file) {
            for (const tag of filePathToSkillTags(s.file)) {
              skillTags.add(tag);
            }
          }
        }
        const tags = ['auto_stm', today, ...skillTags].join(',');

        // Resolve CLI env
        const mcpCfgForStore = resolveMcpConfig();
        const instanceCfg = mcpCfgForStore && project ? mcpCfgForStore[project.instance] : null;
        const storeDataDir = instanceCfg ? instanceCfg.dataDir : './data';
        const storeOpenaiKey = instanceCfg ? instanceCfg.openaiKey : '';
        const storeCwd = instanceCfg ? instanceCfg.cwd : RUBIX_ROOT;

        const storeEnv = { ...process.env, RUBIX_DATA_DIR: storeDataDir };
        if (storeOpenaiKey) storeEnv.OPENAI_API_KEY = storeOpenaiKey;

        try {
          execFileSync('node', [
            path.join(RUBIX_ROOT, 'dist', 'cli', 'index.js'),
            'store',
            content,
            '-t', tags,
            '-i', importance.toFixed(2),
            '-d', storeDataDir
          ], {
            env: storeEnv,
            cwd: storeCwd,
            timeout: 8000,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe']
          });
          writeLastStmStore(dataDirResolved);
          process.stderr.write(`[comms-stop] Auto-STM stored (importance=${importance.toFixed(2)})\n`);
        } catch (err) {
          process.stderr.write(`[comms-stop] Auto-STM store failed: ${err.message}\n`);
        }
      }
    }

    // Clear the journal + QC ledger regardless (fresh journal = fresh ledger)
    deleteStmJournal(dataDirResolved);
    clearQcLedger(dataDirResolved);
  }

  // ─── Final exit ───
  if (needsContinue) {
    process.exit(2);
  } else {
    process.exit(0);
  }
}

main().catch(() => {
  // Silent failure — never block Claude from stopping
  process.exit(0);
});
