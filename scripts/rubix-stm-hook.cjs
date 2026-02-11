#!/usr/bin/env node
/**
 * Rubix Auto-STM Signal Collector (PostToolUse)
 *
 * Fires after Edit, Write, and Bash tool invocations.
 * Appends a lightweight signal to {dataDir}/stm-journal.json.
 *
 * Design goals:
 * - Fast (<50ms) — file I/O only, no network, no DB
 * - Dedup consecutive same-file signals
 * - Skip read-only bash commands
 * - Cap at 50 signals per session
 *
 * Input (stdin JSON): { tool_name, tool_input, tool_output, ... }
 * Output: none (silent)
 * Exit code: always 0
 */

const path = require('path');
const {
  RUBIX_ROOT,
  readStdin,
  detectProject,
  resolveMcpConfig,
  readStmJournal,
  writeStmJournal,
  isReadOnlyBash
} = require('./rubix-hook-utils.cjs');

const MAX_SIGNALS = 50;

async function main() {
  const input = await readStdin();
  if (!input) return;

  const toolName = (input.tool_name || '').toLowerCase();
  const toolInput = input.tool_input || {};
  const toolOutput = input.tool_output || {};

  // Only track Edit, Write, Bash
  let signal = null;

  if (toolName === 'edit') {
    const file = toolInput.file_path || '';
    if (!file) return;
    signal = {
      type: 'edit',
      file: file,
      timestamp: new Date().toISOString()
    };
  } else if (toolName === 'write') {
    const file = toolInput.file_path || '';
    if (!file) return;
    signal = {
      type: 'write',
      file: file,
      timestamp: new Date().toISOString()
    };
  } else if (toolName === 'bash') {
    const command = toolInput.command || '';
    if (isReadOnlyBash(command)) return;

    // Extract file path if the command obviously targets one
    let file = null;
    const npmTestMatch = command.match(/^npm\s+(test|run\s+\w+)/);
    const gitMatch = command.match(/^git\s+(add|commit|push)/);
    if (!npmTestMatch && !gitMatch) {
      // Try to extract first file path argument
      const pathMatch = command.match(/\s(\/[\w./-]+\.\w+)/);
      if (pathMatch) file = pathMatch[1];
    }

    // Detect failure from exit code or output
    const failed = toolOutput.exit_code !== undefined && toolOutput.exit_code !== 0;

    signal = {
      type: 'bash',
      command: command.substring(0, 100), // truncate long commands
      file: file,
      failed: failed,
      timestamp: new Date().toISOString()
    };
  }

  if (!signal) return;

  // Resolve data dir
  const cwd = input.cwd || process.cwd();
  const project = detectProject(cwd);
  const mcpConfig = resolveMcpConfig();
  let dataDir = './data';
  if (mcpConfig && project) {
    dataDir = mcpConfig[project.instance]?.dataDir || './data';
  }
  const dataDirResolved = path.isAbsolute(dataDir) ? dataDir : path.join(RUBIX_ROOT, dataDir);

  // Read existing journal
  const journal = readStmJournal(dataDirResolved) || { signals: [], manualStmCalled: false };

  // Cap check
  if (journal.signals.length >= MAX_SIGNALS) return;

  // Dedup: skip if last signal is same type+file
  const last = journal.signals[journal.signals.length - 1];
  if (last && last.type === signal.type && last.file === signal.file && signal.file) return;

  // Append signal
  journal.signals.push(signal);
  writeStmJournal(dataDirResolved, journal);
}

main().catch(() => {
  // Silent failure — never interfere with tool execution
});
