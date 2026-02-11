#!/usr/bin/env node
/**
 * Rubix Session-End Hook for Claude Code (SessionEnd)
 *
 * Stores a session-end marker in memory when Claude Code exits.
 * Fire-and-forget — never blocks exit, silent on failure.
 *
 * Input (stdin JSON): { session_id, transcript_path, ... }
 * Output: none (silent)
 */

const path = require('path');
const { execFileSync } = require('child_process');
const {
  RUBIX_ROOT,
  readStdin,
  resolveMcpConfig,
  readStmJournal,
  deleteStmJournal,
  computeStmImportance,
  synthesizeStmContent,
  filePathToSkillTags,
  writeLastStmStore
} = require('./rubix-hook-utils.cjs');

async function main() {
  const input = await readStdin();
  const sessionId = (input && input.session_id) || 'unknown';
  const reason = (input && input.reason) || 'normal_exit';

  // Resolve data dir from MCP config
  const mcpConfig = resolveMcpConfig();
  let dataDir = './data';
  let openaiKey = '';
  let serverCwd = RUBIX_ROOT;

  if (mcpConfig) {
    // Use the first available instance config
    const firstKey = Object.keys(mcpConfig)[0];
    if (firstKey && mcpConfig[firstKey]) {
      dataDir = mcpConfig[firstKey].dataDir || dataDir;
      openaiKey = mcpConfig[firstKey].openaiKey || '';
      serverCwd = mcpConfig[firstKey].cwd || RUBIX_ROOT;
    }
  }

  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  const env = { ...process.env, RUBIX_DATA_DIR: dataDir };
  if (openaiKey) env.OPENAI_API_KEY = openaiKey;

  // ─── Flush remaining STM journal signals (lower threshold on session end) ───
  const dataDirResolved = path.isAbsolute(dataDir) ? dataDir : path.join(serverCwd, dataDir);
  const journal = readStmJournal(dataDirResolved);
  if (journal && journal.signals && journal.signals.length > 0 && !journal.manualStmCalled) {
    const importance = Math.max(0.4, computeStmImportance(journal.signals)); // floor 0.4 on session end
    const stmContent = synthesizeStmContent(journal.signals);

    // Collect skill tags from file extensions
    const skillTags = new Set();
    for (const s of journal.signals) {
      if (s.file) {
        for (const tag of filePathToSkillTags(s.file)) {
          skillTags.add(tag);
        }
      }
    }
    const stmTags = ['auto_stm', today, ...skillTags].join(',');

    try {
      execFileSync('node', [
        path.join(RUBIX_ROOT, 'dist', 'cli', 'index.js'),
        'store',
        stmContent,
        '-t', stmTags,
        '-i', importance.toFixed(2),
        '-d', dataDir
      ], {
        env,
        cwd: serverCwd,
        timeout: 8000,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
      writeLastStmStore(dataDirResolved);
    } catch {
      // Silent failure
    }
    deleteStmJournal(dataDirResolved);
  }

  // ─── Store session-end marker ───
  const content = `Session ended. Reason: ${reason}. Session ID: ${sessionId}. Date: ${today}`;

  try {
    execFileSync('node', [
      path.join(RUBIX_ROOT, 'dist', 'cli', 'index.js'),
      'store',
      content,
      '-t', `session,session_end,${today}`,
      '-i', '0.6',
      '-d', dataDir
    ], {
      env,
      cwd: serverCwd,
      timeout: 8000,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
  } catch {
    // Silent failure — never block exit
  }
}

main().catch(() => {
  // Silent failure — never block exit
});
