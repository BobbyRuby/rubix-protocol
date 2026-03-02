#!/usr/bin/env node
/**
 * Rubix QC Ledger Hook (PostToolUse: god_lsp_diagnostics | god_analyze_lint | god_analyze_types)
 *
 * Fires after diagnostic MCP tools are invoked. Records the diagnosed files
 * into {dataDir}/qc-ledger.json so the Stop hook knows QC was performed.
 *
 * This closes the enforcement loop:
 *   STM hook records edits → Stop hook demands QC → Claude runs diagnostics →
 *   THIS hook marks files as diagnosed → Stop hook sees ledger → exits 0.
 *
 * Input (stdin JSON): { tool_name, tool_input, tool_output, cwd, session_id }
 * Output: [QC OK] confirmation line
 * Exit code: always 0
 */

const path = require('path');
const {
  RUBIX_ROOT,
  readStdin,
  detectProject,
  resolveMcpConfig,
  writeQcLedger
} = require('./rubix-hook-utils.cjs');

async function main() {
  const input = await readStdin();
  if (!input) return;

  const toolName = input.tool_name || '';
  const toolInput = input.tool_input || {};

  // Extract file paths from tool input based on tool schema
  const files = [];

  if (toolName.includes('god_lsp_diagnostics')) {
    // Schema: { file?: string }
    if (toolInput.file) {
      files.push(toolInput.file);
    }
  } else if (toolName.includes('god_analyze_lint') || toolName.includes('god_analyze_types')) {
    // Schema: { files?: string[] }
    if (Array.isArray(toolInput.files)) {
      files.push(...toolInput.files);
    }
  }

  // If no specific files targeted (ran on whole project), mark all pending files as diagnosed
  // by reading the STM journal for undiagnosed files
  if (files.length === 0) {
    const { getUndiagnosedFiles } = require('./rubix-hook-utils.cjs');
    const cwd = input.cwd || process.cwd();
    const project = detectProject(cwd);
    const mcpConfig = resolveMcpConfig();
    let dataDir = './data';
    if (mcpConfig && project) {
      dataDir = mcpConfig[project.instance]?.dataDir || './data';
    }
    const dataDirResolved = path.isAbsolute(dataDir) ? dataDir : path.join(RUBIX_ROOT, dataDir);
    const undiagnosed = getUndiagnosedFiles(dataDirResolved);

    // Determine which tool types match
    const isLint = toolName.includes('god_analyze_lint');
    const isTypes = toolName.includes('god_analyze_types');
    for (const { file, lang } of undiagnosed) {
      // lint + types only apply to JS/TS; LSP applies to all
      if ((isLint || isTypes) && lang !== 'typescript' && lang !== 'javascript') continue;
      files.push(file);
    }
  }

  if (files.length === 0) return;

  // Resolve data dir
  const cwd = input.cwd || process.cwd();
  const project = detectProject(cwd);
  const mcpConfig = resolveMcpConfig();
  let dataDir = './data';
  if (mcpConfig && project) {
    dataDir = mcpConfig[project.instance]?.dataDir || './data';
  }
  const dataDirResolved = path.isAbsolute(dataDir) ? dataDir : path.join(RUBIX_ROOT, dataDir);

  // Determine which diagnostic was run
  const toolShort = toolName.includes('god_lsp_diagnostics') ? 'lsp'
    : toolName.includes('god_analyze_lint') ? 'lint'
    : toolName.includes('god_analyze_types') ? 'types'
    : 'unknown';

  // Build ledger entries
  const ledgerFiles = {};
  const now = new Date().toISOString();
  for (const file of files) {
    const key = file;
    ledgerFiles[key] = {
      at: now,
      tool: toolShort,
      basename: path.basename(file)
    };
    // Also key by basename for flexible matching
    ledgerFiles[path.basename(file)] = {
      at: now,
      tool: toolShort,
      basename: path.basename(file)
    };
  }

  writeQcLedger(dataDirResolved, { files: ledgerFiles });

  const names = files.map(f => path.basename(f)).join(', ');
  console.log(`[QC OK] ${toolShort} completed for: ${names} — marked as diagnosed`);
}

main().catch(() => {
  // Silent failure — never interfere with tool execution
});
