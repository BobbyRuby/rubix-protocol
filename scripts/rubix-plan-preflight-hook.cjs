#!/usr/bin/env node
/**
 * Rubix Plan Preflight Hook (PostToolUse: ExitPlanMode)
 *
 * Stage 1 of two-stage plan validation:
 *   - Captures plan text to pending-plan.json (no validation here)
 *   - Validation runs later via rubix-plan-gate-hook.cjs on first Write/Edit
 *
 * Also exports V1-V4 validator functions for use by the gate hook.
 *
 * Output (stdout): [PLAN CAPTURED] confirmation message.
 * Exit code: always 0 (informative, never blocking).
 *
 * Input (stdin JSON): { tool_name, tool_input, tool_output: { plan }, cwd, session_id }
 */

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const {
  RUBIX_ROOT,
  readStdin,
  detectProject,
  resolveMcpConfig,
  writePendingPlan
} = require('./rubix-hook-utils.cjs');

// ─── Skip lists ───

const JS_BUILTINS = new Set([
  'console', 'JSON', 'Array', 'Object', 'Math', 'Promise', 'window', 'document',
  'String', 'Number', 'Boolean', 'Date', 'RegExp', 'Map', 'Set', 'Error',
  'parseInt', 'parseFloat', 'setTimeout', 'setInterval', 'clearTimeout',
  'clearInterval', 'fetch', 'require', 'module', 'exports', 'Buffer',
  'process', 'console.log', 'console.error', 'console.warn'
]);

const PHP_BUILTINS = new Set([
  'isset', 'empty', 'unset', 'strlen', 'strpos', 'substr', 'str_replace',
  'array_map', 'array_filter', 'array_merge', 'array_push', 'array_pop',
  'array_keys', 'array_values', 'array_slice', 'array_splice', 'array_unique',
  'array_search', 'in_array', 'count', 'sizeof', 'implode', 'explode',
  'trim', 'ltrim', 'rtrim', 'strtolower', 'strtoupper', 'ucfirst',
  'preg_match', 'preg_replace', 'preg_match_all', 'sprintf', 'printf',
  'intval', 'floatval', 'strval', 'is_array', 'is_string', 'is_numeric',
  'is_null', 'is_bool', 'json_encode', 'json_decode', 'file_exists',
  'file_get_contents', 'file_put_contents', 'fopen', 'fclose', 'fwrite',
  'fread', 'unlink', 'mkdir', 'rmdir', 'scandir', 'glob',
  'date', 'time', 'strtotime', 'mktime', 'microtime',
  'die', 'exit', 'echo', 'print', 'var_dump', 'print_r',
  'header', 'http_response_code', 'session_start', 'setcookie',
  'class_exists', 'method_exists', 'function_exists', 'property_exists',
  'defined', 'define', 'constant'
]);

const WP_BUILTINS = new Set([
  'get_post_meta', 'update_post_meta', 'delete_post_meta', 'add_post_meta',
  'get_option', 'update_option', 'delete_option', 'add_option',
  'wp_enqueue_script', 'wp_enqueue_style', 'wp_localize_script',
  'wp_register_script', 'wp_register_style',
  'add_action', 'remove_action', 'do_action', 'has_action',
  'add_filter', 'remove_filter', 'apply_filters', 'has_filter',
  'wp_die', 'wp_redirect', 'wp_safe_redirect',
  'wp_send_json', 'wp_send_json_success', 'wp_send_json_error',
  'wp_ajax', 'check_ajax_referer', 'wp_verify_nonce', 'wp_create_nonce',
  'get_post', 'get_posts', 'wp_insert_post', 'wp_update_post', 'wp_delete_post',
  'get_current_user_id', 'wp_get_current_user', 'is_user_logged_in',
  'current_user_can', 'is_admin', 'is_wp_error',
  'sanitize_text_field', 'esc_html', 'esc_attr', 'esc_url', 'absint',
  'wpdb', 'prepare', 'get_results', 'get_var', 'get_row', 'query',
  'register_rest_route', 'rest_ensure_response',
  'update_meta_cache', 'wp_cache_get', 'wp_cache_set', 'wp_cache_delete',
  'dbDelta', 'maybe_serialize', 'maybe_unserialize',
  '__', '_e', 'esc_html__', 'esc_html_e', 'esc_attr__'
]);

// ─── Validators ───

// ─── Action intent patterns ───

const CREATE_ACTIONS = /^(create|new|add|write|generate|scaffold)$/i;
const EDIT_ACTIONS = /^(edit|modify|fix|update|change|refactor|patch)$/i;
const CREATE_CONTEXT_RE = /\b(creat|new\s+file|write\s+new|generat|scaffold|add\s+new)\w*/i;

/**
 * Parse markdown tables for file → action mappings.
 * Matches rows like: | `foo.js` | CREATE | ... |
 * Returns Map<filePath, 'create'|'edit'|null>.
 */
function parseTableActions(planText) {
  const actionMap = new Map();

  // Find table rows: | cell | cell | ... |
  const rowRe = /^\|(.+)\|$/gm;
  let row;
  while ((row = rowRe.exec(planText)) !== null) {
    const cells = row[1].split('|').map(c => c.trim());
    if (cells.length < 2) continue;

    // Skip header separator rows (|---|---|)
    if (cells[0].match(/^[-:]+$/)) continue;

    // Find a cell that looks like a file path
    let filePath = null;
    let action = null;
    for (const cell of cells) {
      // Extract file path from backticks or bare
      const pathMatch = cell.match(/`([^`]+\.[a-zA-Z]{1,10})`/) || cell.match(/^([a-zA-Z0-9_./-]+\.[a-zA-Z]{1,10})$/);
      if (pathMatch && !filePath) {
        filePath = pathMatch[1];
        continue;
      }
      // Check if cell is an action keyword
      const cleaned = cell.replace(/[`*]/g, '').trim();
      if (CREATE_ACTIONS.test(cleaned)) {
        action = 'create';
      } else if (EDIT_ACTIONS.test(cleaned)) {
        action = 'edit';
      }
    }

    if (filePath) {
      actionMap.set(filePath, action);
    }
  }

  return actionMap;
}

/**
 * Check if surrounding text (±100 chars) around a file path mentions creation.
 */
function hasCreateContextNearby(planText, candidate) {
  const idx = planText.indexOf(candidate);
  if (idx === -1) return false;
  const start = Math.max(0, idx - 100);
  const end = Math.min(planText.length, idx + candidate.length + 100);
  const surrounding = planText.substring(start, end);
  return CREATE_CONTEXT_RE.test(surrounding);
}

/**
 * V1: Extract file paths from plan text and check existence.
 * Action-aware: skips FILE_NOT_FOUND for paths the plan intends to CREATE.
 * Returns array of { path, exists, severity }.
 */
function extractAndCheckFilePaths(planText, cwd) {
  const findings = [];
  const seen = new Set();

  // Pre-parse table actions for create/edit intent
  const tableActions = parseTableActions(planText);

  // Pattern 1: backtick-quoted paths with extensions
  // Pattern 2: **File:** labels
  // Pattern 3: markdown table cells with file paths
  const patterns = [
    /`([^`\n]{3,120})`/g,
    /\*\*File:\*\*\s*`?([^\s`\n]+)`?/gi,
    /\|\s*`?([a-zA-Z0-9_./-]+\.[a-zA-Z]{1,10})`?\s*\|/g
  ];

  const candidates = new Set();
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(planText)) !== null) {
      candidates.add(match[1]);
    }
  }

  for (const candidate of candidates) {
    // Must have a file extension
    if (!/\.\w{1,10}$/.test(candidate)) continue;
    // Skip template placeholders
    if (/[{}<>$]/.test(candidate)) continue;
    // Skip URLs
    if (/^https?:\/\//.test(candidate)) continue;
    // Skip things that are clearly not paths (contains spaces, operators)
    if (/\s|[=+*]/.test(candidate)) continue;
    // Deduplicate
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    // Cap at 20
    if (seen.size > 20) break;

    // Resolve path
    let resolved;
    if (path.isAbsolute(candidate)) {
      resolved = candidate;
    } else {
      resolved = path.resolve(cwd, candidate);
    }

    const exists = fs.existsSync(resolved);
    if (!exists) {
      // Determine if the plan intends to CREATE this file
      const tableAction = tableActions.get(candidate);
      const isCreateIntent = tableAction === 'create' || (!tableAction && hasCreateContextNearby(planText, candidate));

      if (isCreateIntent) {
        // Expected to not exist — skip (not a finding)
        continue;
      }

      findings.push({
        type: 'FILE_NOT_FOUND',
        detail: candidate,
        severity: 'CRITICAL'
      });
    }
  }

  return { findings, checked: seen.size };
}

/**
 * V2: Extract function/method references and grep for definitions.
 * Returns array of { name, severity }.
 */
function extractAndCheckFunctionRefs(planText, cwd) {
  const findings = [];
  const seen = new Set();

  // Extract PHP static calls: ClassName::methodName(
  const staticCalls = [...planText.matchAll(/([A-Z][A-Za-z0-9_]+)::([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g)];
  for (const m of staticCalls) {
    const className = m[1];
    const methodName = m[2];
    if (JS_BUILTINS.has(className) || PHP_BUILTINS.has(methodName) || WP_BUILTINS.has(methodName)) continue;
    const fullName = `${className}::${methodName}`;
    if (!seen.has(fullName)) seen.add(fullName);
  }

  // Extract backtick-quoted function calls: `functionName()`
  const backtickFns = [...planText.matchAll(/`([a-zA-Z_][a-zA-Z0-9_]*)\(\)`/g)];
  for (const m of backtickFns) {
    const fnName = m[1];
    if (JS_BUILTINS.has(fnName) || PHP_BUILTINS.has(fnName) || WP_BUILTINS.has(fnName)) continue;
    if (!seen.has(fnName)) seen.add(fnName);
  }

  // Derive search root from plan's absolute file paths
  let searchRoot = cwd;
  const absPathMatch = planText.match(/(?:^|\s|`)(\/[a-zA-Z0-9_./-]+)/m);
  if (absPathMatch) {
    // Walk up to find a likely project root (has wp-content, src, lib, etc.)
    let dir = path.dirname(absPathMatch[1]);
    for (let i = 0; i < 5 && dir !== '/'; i++) {
      if (fs.existsSync(path.join(dir, 'wp-content')) ||
          fs.existsSync(path.join(dir, 'src')) ||
          fs.existsSync(path.join(dir, 'composer.json')) ||
          fs.existsSync(path.join(dir, 'package.json'))) {
        searchRoot = dir;
        break;
      }
      dir = path.dirname(dir);
    }
  }

  // Cap at 10
  const toCheck = [...seen].slice(0, 10);

  for (const name of toCheck) {
    // For static calls, search for the method name
    const searchName = name.includes('::') ? name.split('::')[1] : name;
    try {
      const result = execSync(
        `grep -rl "function ${searchName}" "${searchRoot}" --include="*.php" --include="*.js" --include="*.ts" 2>/dev/null || true`,
        { timeout: 2000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim();

      if (!result) {
        findings.push({
          type: 'FUNCTION_NOT_FOUND',
          detail: name,
          severity: 'CRITICAL'
        });
      }
    } catch {
      // Timeout or error — skip this check
    }
  }

  return { findings, checked: toCheck.length };
}

/**
 * V3: Extract version bump patterns and verify "from" version in files.
 * Returns array of findings.
 */
function extractAndCheckVersions(planText) {
  const findings = [];

  // Match: X.Y.Z → X.Y.Z  or  X.Y.Z -> X.Y.Z  or  X.Y.Z to X.Y.Z
  const versionBumps = [...planText.matchAll(/(\d+\.\d+\.\d+)\s*(?:→|->|to)\s*(\d+\.\d+\.\d+)/g)];
  if (versionBumps.length === 0) return { findings, checked: 0 };

  // Find PHP files referenced in the plan for version checking
  const phpFiles = [...planText.matchAll(/`([^`\n]*\.php)`/g)].map(m => m[1]);

  for (const bump of versionBumps.slice(0, 5)) {
    const fromVersion = bump[1];
    let found = false;

    for (const phpFile of phpFiles) {
      try {
        // Try to resolve and read the file
        const resolved = path.isAbsolute(phpFile) ? phpFile : path.resolve(process.cwd(), phpFile);
        if (!fs.existsSync(resolved)) continue;
        const content = fs.readFileSync(resolved, 'utf8');
        if (content.includes(fromVersion)) {
          found = true;
          break;
        }
      } catch {
        // skip
      }
    }

    if (!found && phpFiles.length > 0) {
      findings.push({
        type: 'VERSION_STALE',
        detail: `plan says ${fromVersion}→${bump[2]} but "${fromVersion}" not found in referenced files`,
        severity: 'WARNING'
      });
    }
  }

  return { findings, checked: versionBumps.length };
}

/**
 * V4: Check plan text against stored memory rules (always_recall, core_memory).
 * Returns matching entries for Claude to review.
 */
function checkMemoryRules(planText, dataDir) {
  const findings = [];

  try {
    const Database = require('better-sqlite3');
    const dbPath = path.join(dataDir, 'memory.db');
    if (!fs.existsSync(dbPath)) return { findings, checked: 0 };

    // Extract top keywords from plan (words >= 6 chars, most frequent)
    const commonWords = new Set([
      'should', 'before', 'after', 'which', 'where', 'there', 'their', 'these',
      'those', 'would', 'could', 'about', 'other', 'being', 'while', 'using',
      'between', 'through', 'following', 'existing', 'current', 'within',
      'without', 'because', 'during', 'return', 'returns', 'create', 'update',
      'delete', 'function', 'method', 'string', 'number', 'object', 'array',
      'import', 'export', 'module', 'default', 'require', 'include'
    ]);

    const wordFreq = {};
    const words = planText.toLowerCase().match(/[a-z_]{6,}/g) || [];
    for (const w of words) {
      if (commonWords.has(w)) continue;
      wordFreq[w] = (wordFreq[w] || 0) + 1;
    }

    const topKeywords = Object.entries(wordFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(e => e[0]);

    if (topKeywords.length === 0) return { findings, checked: 0 };

    const db = new Database(dbPath, { readonly: true });
    try {
      // Build LIKE conditions for keywords
      const likeClauses = topKeywords.map(() => 'me.content LIKE ?').join(' OR ');
      const likeParams = topKeywords.map(k => `%${k}%`);

      const rows = db.prepare(`
        SELECT DISTINCT me.id, me.content, me.importance
        FROM memory_entries me
        JOIN memory_tags mt ON me.id = mt.entry_id
        WHERE (mt.tag IN ('always_recall', 'core_memory'))
          AND me.importance >= 0.7
          AND (${likeClauses})
        ORDER BY me.importance DESC
        LIMIT 5
      `).all(...likeParams);

      for (const row of rows) {
        // Truncate content for display
        const snippet = row.content.length > 200
          ? row.content.substring(0, 200) + '...'
          : row.content;
        findings.push({
          type: 'MEMORY_RULE',
          detail: snippet,
          severity: 'INFO'
        });
      }

      return { findings, checked: topKeywords.length };
    } finally {
      db.close();
    }
  } catch {
    return { findings, checked: 0 };
  }
}

// ─── Output formatter (shared with gate hook) ───

/**
 * Format and print preflight findings to stdout.
 * Returns { criticals, warnings, infos, totalChecked } for callers.
 */
function formatAndOutputFindings(v1, v2, v3, v4) {
  const totalChecked = v1.checked + v2.checked + v3.checked;
  const allFindings = [...v1.findings, ...v2.findings, ...v3.findings, ...v4.findings];

  const criticals = allFindings.filter(f => f.severity === 'CRITICAL');
  const warnings = allFindings.filter(f => f.severity === 'WARNING');
  const infos = allFindings.filter(f => f.severity === 'INFO');

  if (criticals.length === 0 && warnings.length === 0 && infos.length === 0) {
    console.log(`[PLAN PREFLIGHT] Validated ${totalChecked} references — all checks passed.`);
    return { criticals, warnings, infos, totalChecked };
  }

  console.log(`[PLAN PREFLIGHT] Validating plan... (${totalChecked} references checked)\n`);

  if (criticals.length > 0) {
    console.log(`[CRITICAL] ${criticals.length} issue(s) — address before executing:`);
    for (let i = 0; i < criticals.length; i++) {
      console.log(`  ${i + 1}. ${criticals[i].type}: \`${criticals[i].detail}\``);
    }
    console.log('');
  }

  if (warnings.length > 0) {
    console.log(`[WARNING] ${warnings.length} issue(s) — double-check:`);
    for (let i = 0; i < warnings.length; i++) {
      console.log(`  ${i + 1}. ${warnings[i].type}: ${warnings[i].detail}`);
    }
    console.log('');
  }

  if (infos.length > 0) {
    console.log(`[MEMORY] Stored rules relevant to this plan:`);
    for (let i = 0; i < infos.length; i++) {
      console.log(`  ${i + 1}. ${infos[i].detail}`);
    }
    console.log('');
  }

  if (criticals.length > 0) {
    console.log('[PREFLIGHT COMPLETE] Resolve CRITICALs before writing any files.');
  }

  return { criticals, warnings, infos, totalChecked };
}

// ─── Main (Stage 1: capture plan text only) ───

async function main() {
  const input = await readStdin();
  if (!input) return;

  const toolName = input.tool_name || '';
  if (toolName !== 'ExitPlanMode') return;

  const toolOutput = input.tool_output || {};
  const planText = toolOutput.plan || '';
  if (!planText || planText.length < 20) return;

  const cwd = input.cwd || process.cwd();

  // Resolve data dir
  const project = detectProject(cwd);
  const mcpConfig = resolveMcpConfig();
  let dataDir = './data';
  if (mcpConfig && project) {
    dataDir = mcpConfig[project.instance]?.dataDir || './data';
  }
  const dataDirResolved = path.isAbsolute(dataDir) ? dataDir : path.join(RUBIX_ROOT, dataDir);

  // Capture plan text — truncate at 10KB
  const cappedPlan = planText.substring(0, 10240);
  writePendingPlan(dataDirResolved, {
    planText: cappedPlan,
    source: 'exitPlanMode',
    capturedAt: new Date().toISOString(),
    preflightDone: false
  });

  console.log(`[PLAN CAPTURED] Plan saved (${cappedPlan.length} chars). Preflight validation will run before first file write.`);
}

// ─── Exports (validators + formatter for gate hook) ───

module.exports = {
  extractAndCheckFilePaths,
  extractAndCheckFunctionRefs,
  extractAndCheckVersions,
  checkMemoryRules,
  formatAndOutputFindings
};

// Run main only when executed directly (not when require'd)
if (require.main === module) {
  main().catch(() => {
    // Silent failure — never interfere with plan approval
  });
}
