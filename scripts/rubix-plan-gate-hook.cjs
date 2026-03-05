#!/usr/bin/env node
/**
 * Rubix Plan Gate Hook (PreToolUse: Write|Edit)
 *
 * Stage 2 of two-stage plan validation:
 *   - Fires before the first Write or Edit after a plan is captured
 *   - Runs V1-V4 validators against the captured plan text
 *   - Outputs findings to stdout (Claude sees them)
 *   - Writes plan-preflight-findings.json for Stop hook
 *
 * Hard enforcement:
 *   - CRITICALs found → exit 2 (BLOCK the write), don't mark preflightDone
 *   - No CRITICALs → exit 0, mark preflightDone (subsequent writes skip)
 *   - Escape hatch: after 3 consecutive blocks, allow write with warning
 *   - Stale cleanup: plans older than 2 hours are cleared automatically
 *
 * Fast path: ~1ms when no pending plan (fs.existsSync only).
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
  clearPendingPlan,
  writePlanPreflightFindings
} = require('./rubix-hook-utils.cjs');

const STALE_PLAN_MS = 2 * 60 * 60 * 1000;   // 2 hours
const ESCAPE_HATCH_THRESHOLD = 3;             // blocks before escape

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

  // Stale plan cleanup: if captured >2h ago, clear and allow write
  if (pending.capturedAt) {
    const age = Date.now() - new Date(pending.capturedAt).getTime();
    if (age > STALE_PLAN_MS) {
      clearPendingPlan(dataDirResolved);
      return; // fast path — stale plan discarded
    }
  }

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

  // Write state file for Stop hook
  writePlanPreflightFindings(dataDirResolved, {
    timestamp: new Date().toISOString(),
    criticalCount: criticals.length,
    warningCount: warnings.length,
    criticals: criticals.map(f => `${f.type}: ${f.detail}`),
    warnings: warnings.map(f => `${f.type}: ${f.detail}`)
  });

  if (criticals.length > 0) {
    // Track consecutive block count
    const blockCount = (pending.blockCount || 0) + 1;
    pending.blockCount = blockCount;
    // Do NOT mark preflightDone — re-validate on next write attempt
    writePendingPlan(dataDirResolved, pending);

    if (blockCount >= ESCAPE_HATCH_THRESHOLD) {
      // Escape hatch: user has been blocked N times, override and allow
      console.log(`\n[PLAN GATE] Escape hatch (${blockCount} blocks). CRITICALs unresolved — proceeding anyway.\n`);
      pending.preflightDone = true;
      writePendingPlan(dataDirResolved, pending);
      // exit 0 — allow the write
    } else {
      // Hard block — prevent the write
      console.log(`\n[PLAN GATE] BLOCKED (${blockCount}/${ESCAPE_HATCH_THRESHOLD}). Resolve CRITICALs. Escape hatch at ${ESCAPE_HATCH_THRESHOLD}.\n`);
      process.exit(2);
    }
  } else {
    // No CRITICALs — mark done, allow write
    pending.preflightDone = true;
    pending.blockCount = 0;
    writePendingPlan(dataDirResolved, pending);
  }
}

main().catch((err) => {
  // Genuine validator errors → fail open (exit 0), don't block writes
  // This catches unexpected crashes in V1-V4, NOT CRITICAL findings
  process.stderr.write(`[plan-gate] Validator error (fail-open): ${err.message}\n`);
});
