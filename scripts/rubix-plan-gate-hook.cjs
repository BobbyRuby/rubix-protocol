#!/usr/bin/env node
/**
 * Rubix Plan Gate Hook (PreToolUse: Write|Edit)
 *
 * Stage 2 of two-stage plan validation:
 *   - Fires before the first Write or Edit after a plan is captured
 *   - Runs V1-V4 validators against the captured plan text
 *   - Outputs findings to stdout (Claude sees them)
 *   - Writes plan-preflight-findings.json for Stop hook
 *   - Marks preflightDone=true so subsequent writes skip validation
 *
 * Fast path: ~1ms when no pending plan (fs.existsSync only).
 * Exit code: always 0 (informative, never blocking).
 *
 * Input (stdin JSON): { tool_name, tool_input, cwd, session_id }
 */

const path = require('path');
const {
  RUBIX_ROOT,
  readStdin,
  detectProject,
  resolveMcpConfig,
  readPendingPlan,
  writePendingPlan,
  writePlanPreflightFindings
} = require('./rubix-hook-utils.cjs');

async function main() {
  const input = await readStdin();
  if (!input) return;

  const toolName = input.tool_name || '';
  if (toolName !== 'Write' && toolName !== 'Edit') return;

  const cwd = input.cwd || process.cwd();

  // Resolve data dir
  const project = detectProject(cwd);
  const mcpConfig = resolveMcpConfig();
  let dataDir = './data';
  if (mcpConfig && project) {
    dataDir = mcpConfig[project.instance]?.dataDir || './data';
  }
  const dataDirResolved = path.isAbsolute(dataDir) ? dataDir : path.join(RUBIX_ROOT, dataDir);

  // Fast path: no pending plan or already done
  const pending = readPendingPlan(dataDirResolved);
  if (!pending || pending.preflightDone) return;

  const planText = pending.planText || '';
  if (planText.length < 20) return;

  // Import validators from preflight hook
  const {
    extractAndCheckFilePaths,
    extractAndCheckFunctionRefs,
    extractAndCheckVersions,
    checkMemoryRules,
    formatAndOutputFindings
  } = require('./rubix-plan-preflight-hook.cjs');

  // Run V1-V4 validators
  const v1 = extractAndCheckFilePaths(planText, cwd);
  const v2 = extractAndCheckFunctionRefs(planText, cwd);
  const v3 = extractAndCheckVersions(planText);
  const v4 = checkMemoryRules(planText, dataDirResolved);

  // Output findings to stdout
  const { criticals, warnings } = formatAndOutputFindings(v1, v2, v3, v4);

  // Write state file for Stop hook reminder
  writePlanPreflightFindings(dataDirResolved, {
    timestamp: new Date().toISOString(),
    criticalCount: criticals.length,
    warningCount: warnings.length,
    criticals: criticals.map(f => `${f.type}: ${f.detail}`),
    warnings: warnings.map(f => `${f.type}: ${f.detail}`)
  });

  // Mark preflight as done (won't re-run on subsequent writes)
  pending.preflightDone = true;
  writePendingPlan(dataDirResolved, pending);
}

main().catch(() => {
  // Silent failure — never block file writes
});
