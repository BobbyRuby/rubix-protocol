#!/usr/bin/env node
/**
 * Rubix Auto-Recall Hook for Claude Code (UserPromptSubmit)
 *
 * Automatically queries memory on every substantive prompt.
 * Replaces detect-project.cjs — includes project detection + memory recall.
 *
 * Fast path: HTTP query to daemon (~50ms) if running on localhost:3456
 * Fallback:  CLI spawn (~2-5s) if daemon not available
 *
 * Input (stdin JSON): { prompt, cwd, session_id }
 * Output (stdout): Project context + recalled memories
 */

const path = require('path');
const { execFileSync } = require('child_process');
const {
  RUBIX_ROOT,
  readStdin,
  detectProject,
  resolveMcpConfig,
  httpPost
} = require('./rubix-hook-utils.cjs');

/**
 * Check comms.db for unread messages.
 * Returns { total, urgent, senders[] } or null if comms.db doesn't exist.
 */
function checkCommsInbox(dataDir) {
  try {
    const Database = require('better-sqlite3');
    const dbPath = path.join(dataDir, 'comms.db');
    const fs = require('fs');
    if (!fs.existsSync(dbPath)) return null;

    const db = new Database(dbPath, { readonly: true });
    try {
      const total = db.prepare("SELECT COUNT(*) as c FROM messages WHERE status = 'unread'").get();
      const urgent = db.prepare("SELECT COUNT(*) as c FROM messages WHERE status = 'unread' AND priority >= 2").get();
      const senders = db.prepare("SELECT DISTINCT from_instance FROM messages WHERE status = 'unread' LIMIT 5").all();
      return {
        total: total?.c || 0,
        urgent: urgent?.c || 0,
        senders: senders.map(r => r.from_instance)
      };
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

// Trivial prompts that don't need memory recall
const TRIVIAL_PATTERN = /^(yes|no|ok|y|n|sure|thanks|thank you|continue|go ahead|do it|correct|right|yep|nope|done|good|great|fine|k|ty|thx|please|proceed|confirmed|approved|deny|denied|allow|reject)\b/i;

async function main() {
  const input = await readStdin();
  if (!input) return;

  const prompt = input.prompt || '';
  const cwd = input.cwd || process.cwd();

  // Smart skip: trivial or very short prompts
  const now = new Date().toLocaleTimeString('en-GB', { hour12: false });

  if (prompt.length < 10 || TRIVIAL_PATTERN.test(prompt.trim())) {
    // Still output project context + comms check for short prompts
    const project = detectProject(cwd);
    if (project) {
      console.log(`[PROJECT] Active: ${project.name} | Instance: ${project.instance} | Tools: ${project.tools} | Time: ${now}`);
    }
    // Quick comms inbox check even on trivial prompts
    const mcpCfg = resolveMcpConfig();
    const dd = (mcpCfg && project) ? (mcpCfg[project.instance]?.dataDir || './data') : './data';
    const ddResolved = path.isAbsolute(dd) ? dd : path.join(RUBIX_ROOT, dd);
    const inboxCheck = checkCommsInbox(ddResolved);
    if (inboxCheck && inboxCheck.total > 0) {
      const urgTag = inboxCheck.urgent > 0 ? ` (${inboxCheck.urgent} URGENT)` : '';
      const from = inboxCheck.senders.length > 0 ? ` from: ${inboxCheck.senders.join(', ')}` : '';
      console.log(`[COMMS] ${inboxCheck.total} unread message(s)${urgTag}${from} — call god_comms_heartbeat then god_comms_inbox to read`);
    }
    return;
  }

  // Detect project
  const project = detectProject(cwd);
  if (project) {
    console.log(`[PROJECT] Active: ${project.name} | Instance: ${project.instance} | Tools: ${project.tools} | Time: ${now}`);
  }

  // Check comms inbox for unread messages
  const mcpConfigForComms = resolveMcpConfig();
  const commsDataDir = (mcpConfigForComms && project)
    ? (mcpConfigForComms[project.instance]?.dataDir || './data')
    : './data';
  const commsDataDirResolved = path.isAbsolute(commsDataDir)
    ? commsDataDir
    : path.join(RUBIX_ROOT, commsDataDir);
  const inbox = checkCommsInbox(commsDataDirResolved);
  if (inbox && inbox.total > 0) {
    const urgentTag = inbox.urgent > 0 ? ` (${inbox.urgent} URGENT)` : '';
    const from = inbox.senders.length > 0 ? ` from: ${inbox.senders.join(', ')}` : '';
    console.log(`[COMMS] ${inbox.total} unread message(s)${urgentTag}${from} — call god_comms_heartbeat then god_comms_inbox to read`);
  }

  // Query memory — try HTTP fast path first, then CLI fallback
  const queryText = prompt.substring(0, 500);
  let results = null;
  let learning = null;
  let styleResults = null;
  let usedHttpPath = false;

  // Attempt 1: HTTP fast path via daemon (prompt query + style query in parallel)
  try {
    // Query 1: prompt-based semantic recall (existing)
    const promptQuery = httpPost('http://localhost:3456/api/query', {
      query: queryText,
      topK: 5,
      minScore: 0.4,
      includeProvenance: true
    }, 3000);

    // Query 2: always_recall / core memories (style, directives, preferences)
    const styleQuery = httpPost('http://localhost:3456/api/query', {
      query: 'user working style preferences directives',
      topK: 5,
      tags: ['always_recall'],
      minScore: 0.0,
      includeProvenance: false
    }, 3000);

    const [promptResponse, styleResponse] = await Promise.all([promptQuery, styleQuery]);

    if (promptResponse && promptResponse.results && promptResponse.results.length > 0) {
      results = promptResponse.results;
      learning = promptResponse._learning || null;
      usedHttpPath = true;
    }

    if (styleResponse && styleResponse.results && styleResponse.results.length > 0) {
      styleResults = styleResponse.results;
      usedHttpPath = true;
    }
  } catch {
    // HTTP failed, try CLI
  }

  // Attempt 2: CLI fallback (prompt query only — style query skipped for performance)
  if (!results && !usedHttpPath) {
    try {
      const mcpConfig = resolveMcpConfig();
      const instanceConfig = mcpConfig && project ? mcpConfig[project.instance] : null;
      const dataDir = instanceConfig ? instanceConfig.dataDir : './data';
      const openaiKey = instanceConfig ? instanceConfig.openaiKey : '';
      const serverCwd = instanceConfig ? instanceConfig.cwd : RUBIX_ROOT;

      const env = {
        ...process.env,
        RUBIX_DATA_DIR: dataDir
      };
      if (openaiKey) env.OPENAI_API_KEY = openaiKey;

      const cliOutput = execFileSync('node', [
        path.join(RUBIX_ROOT, 'dist', 'cli', 'index.js'),
        'query',
        queryText,
        '-k', '5',
        '-m', '0.4',
        '-o', 'json',
        '-d', dataDir
      ], {
        env,
        cwd: serverCwd,
        timeout: 4000, // 4s timeout for CLI
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      });

      if (cliOutput) {
        const parsed = JSON.parse(cliOutput.trim());
        if (parsed && Array.isArray(parsed.results) && parsed.results.length > 0) {
          results = parsed.results;
          learning = parsed._learning || null;
        }
      }
    } catch {
      // CLI also failed — graceful degradation
    }
  }

  // Dedup: remove style entries that already appear in prompt results (by ID)
  if (styleResults && styleResults.length > 0 && results && results.length > 0) {
    const promptIds = new Set(results.map(r => r.id));
    styleResults = styleResults.filter(r => !promptIds.has(r.id));
  }

  // Format output — style section first, then recalled memories
  if (styleResults && styleResults.length > 0) {
    console.log('');
    console.log(`[STYLE] (${styleResults.length} core memories)`);
    styleResults.forEach((r, i) => {
      const tags = r.tags ? ` (tags: ${r.tags.join(', ')})` : '';
      const content = (r.content || r.entry?.content || '').substring(0, 200).replace(/\n/g, ' ');
      console.log(`${i + 1}. ${content}${tags}`);
    });
  }

  if (results && results.length > 0) {
    console.log('');
    console.log(`[RECALLED MEMORIES] (${results.length} results)`);
    results.forEach((r, i) => {
      const score = (r.score || 0).toFixed(2);
      const lScore = r.lScore ? `, L: ${r.lScore.toFixed(2)}` : '';
      const tags = r.tags ? ` (tags: ${r.tags.join(', ')})` : '';
      // Truncate content to 200 chars for display
      const content = (r.content || r.entry?.content || '').substring(0, 200).replace(/\n/g, ' ');
      console.log(`${i + 1}. [score: ${score}${lScore}] ${content}${tags}`);
    });

    if (learning) {
      console.log('');
      console.log(`[LEARNING] trajectoryId=${learning.trajectoryId || 'none'} queryId=${learning.queryId || 'none'}`);
      console.log('Rate these recalls 0-10 when appropriate. Use god_comms_escalate for rating, then god_learn(trajectoryId, quality=score/10, memrlQueryId).');
    }
  }
}

main().catch(() => {
  // Silent failure — never block the user's prompt
});
