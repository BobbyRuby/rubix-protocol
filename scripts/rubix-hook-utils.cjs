#!/usr/bin/env node
/**
 * Shared utilities for Rubix Claude Code hooks.
 *
 * Used by: rubix-recall-hook.cjs, rubix-permission-hook.cjs, rubix-notification-hook.cjs
 */

const path = require('path');
const fs = require('fs');
const http = require('http');

// Root of the rubix-protocol project
const RUBIX_ROOT = path.resolve(__dirname, '..');

// AFK state file location
const AFK_STATE_PATH = path.join(RUBIX_ROOT, 'data', 'afk-state.json');

// Known project mappings (path patterns -> MCP instance)
const PROJECT_MAPPINGS = [
  {
    patterns: [
      /rubix-protocol[/\\]god-agent/i,
      /rubix-protocol$/i,
      /god-agent/i,
      /\/var\/www\/html\/rubix/i
    ],
    instance: 'rubix-brain',
    name: 'God-Agent',
    tools: 'mcp__rubix-brain__*',
    coreSkills: ['polyglot:wordpress', 'polyglot:javascript', 'polyglot:leaflet']
  }
];

/**
 * Read stdin as a string, parse as JSON.
 * Returns parsed object or null on failure.
 */
function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => {
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve(null);
      }
    });
    // Timeout after 2s if no stdin
    setTimeout(() => resolve(null), 2000);
  });
}

/**
 * Read AFK state from data/afk-state.json.
 * Returns { afk: boolean, since: string|null }
 */
function readAfkState() {
  try {
    if (fs.existsSync(AFK_STATE_PATH)) {
      const raw = fs.readFileSync(AFK_STATE_PATH, 'utf8');
      return JSON.parse(raw);
    }
  } catch {
    // ignore parse errors
  }
  return { afk: false, since: null };
}

/**
 * Write AFK state to data/afk-state.json.
 */
function writeAfkState(state) {
  try {
    const dir = path.dirname(AFK_STATE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(AFK_STATE_PATH, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error('[rubix-hook-utils] Failed to write AFK state:', err.message);
  }
}

/**
 * Detect project from CWD.
 * Returns { instance, name, tools, dataDir } or null.
 */
function detectProject(cwd) {
  let matched = null;
  for (const project of PROJECT_MAPPINGS) {
    for (const pattern of project.patterns) {
      if (pattern.test(cwd)) {
        matched = project;
        break;
      }
    }
    if (matched) break;
  }

  if (!matched) {
    // Default to rubix
    matched = PROJECT_MAPPINGS[PROJECT_MAPPINGS.length - 1];
  }

  // Resolve data dir from MCP config
  const mcpConfig = resolveMcpConfig();
  let dataDir = './data';
  if (mcpConfig && mcpConfig[matched.instance]) {
    dataDir = mcpConfig[matched.instance].dataDir || dataDir;
  }

  return {
    instance: matched.instance,
    name: matched.name,
    tools: matched.tools,
    dataDir,
    coreSkills: matched.coreSkills || []
  };
}

/**
 * Read .claude/mcp.json and extract env vars per server instance.
 * Returns { [instanceName]: { dataDir, projectRoot, projectName, openaiKey } } or null.
 */
function resolveMcpConfig() {
  // Try multiple locations for mcp.json
  const candidates = [
    path.join(RUBIX_ROOT, '.claude', 'mcp.json'),
    path.join(RUBIX_ROOT, 'god-agent', '.claude', 'mcp.json')
  ];

  for (const mcpPath of candidates) {
    try {
      if (!fs.existsSync(mcpPath)) continue;
      const raw = fs.readFileSync(mcpPath, 'utf8');
      const config = JSON.parse(raw);
      const servers = config.mcpServers || {};
      const result = {};

      for (const [name, server] of Object.entries(servers)) {
        const env = server.env || {};
        result[name] = {
          dataDir: env.RUBIX_DATA_DIR || './data',
          projectRoot: env.RUBIX_PROJECT_ROOT || '',
          projectName: env.RUBIX_PROJECT_NAME || name,
          openaiKey: env.OPENAI_API_KEY || '',
          cwd: server.cwd || RUBIX_ROOT
        };
      }

      return result;
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * HTTP POST with timeout. Returns parsed JSON response or null on failure.
 */
function httpPost(url, body, timeoutMs = 200) {
  return new Promise((resolve) => {
    const urlObj = new URL(url);
    const postData = JSON.stringify(body);

    const req = http.request({
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: timeoutMs
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(null);
        }
      });
    });

    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });

    req.write(postData);
    req.end();
  });
}

/**
 * HTTP GET with timeout. Returns parsed JSON response or null on failure.
 */
function httpGet(url, timeoutMs = 200) {
  return new Promise((resolve) => {
    const urlObj = new URL(url);

    const req = http.request({
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method: 'GET',
      timeout: timeoutMs
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(null);
        }
      });
    });

    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });

    req.end();
  });
}

/**
 * Keyword → polyglot tag mapping for prompt-level skill detection.
 * Lightweight version of SkillDetector.ts for CJS hooks.
 */
const PROMPT_SKILL_MAP = {
  'wordpress': 'polyglot:wordpress',
  'wp': 'polyglot:wordpress',
  'plugin': 'polyglot:wordpress',
  'hook': 'polyglot:wordpress',
  'php': 'polyglot:php',
  'javascript': 'polyglot:javascript',
  'js': 'polyglot:javascript',
  'typescript': 'polyglot:javascript',
  'jquery': 'polyglot:javascript',
  'react': 'polyglot:javascript',
  'vue': 'polyglot:javascript',
  'leaflet': 'polyglot:leaflet',
  'map': 'polyglot:leaflet',
  'marker': 'polyglot:leaflet',
  'geojson': 'polyglot:leaflet',
  'tile': 'polyglot:leaflet',
  'three.js': 'polyglot:threejs',
  'threejs': 'polyglot:threejs',
  'three js': 'polyglot:threejs',
  'babylon': 'polyglot:babylonjs',
  'babylonjs': 'polyglot:babylonjs',
  'babylon.js': 'polyglot:babylonjs',
  'r3f': 'polyglot:r3f',
  'react-three-fiber': 'polyglot:r3f',
  'react three fiber': 'polyglot:r3f',
  'drei': 'polyglot:r3f',
  'fiber': 'polyglot:r3f',
  'aframe': 'polyglot:aframe',
  'a-frame': 'polyglot:aframe',
  'a frame': 'polyglot:aframe',
  'webvr': 'polyglot:aframe',
  'webxr': 'polyglot:aframe',
  'webgl': 'polyglot:js3d',
  '3d': 'polyglot:js3d',
  'laravel': 'polyglot:laravel',
  'api': 'polyglot:api',
  'rest': 'polyglot:api',
  'database': 'polyglot:database',
  'sql': 'polyglot:database',
  'mysql': 'polyglot:database',
  'auth': 'polyglot:auth',
  'docker': 'polyglot:deployment',
  'deploy': 'polyglot:deployment',
  'test': 'polyglot:testing',
  'jest': 'polyglot:testing',
  'git': 'polyglot:git',
  'vite': 'polyglot:vite_build',
  'webpack': 'polyglot:vite_build',
  'node.js': 'polyglot:nodejs',
  'nodejs': 'polyglot:nodejs',
  'python': 'polyglot:python',
};

/**
 * Detect polyglot skills from prompt text.
 * Returns unique polyglot tags found in the text.
 */
function detectPromptSkills(text) {
  if (!text || text.length < 5) return [];
  const lower = text.toLowerCase();
  const detected = new Set();

  for (const [keyword, tag] of Object.entries(PROMPT_SKILL_MAP)) {
    if (keyword.length <= 3) {
      // Word boundary match for short keywords
      const regex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (regex.test(lower)) {
        detected.add(tag);
      }
    } else {
      if (lower.includes(keyword)) {
        detected.add(tag);
      }
    }
  }

  return Array.from(detected);
}

/**
 * Query polyglot entries directly from memory.db via SQLite.
 * No daemon needed — reads the DB file directly (readonly).
 *
 * @param {string} dataDir - Resolved absolute path to data directory
 * @param {string[]} tags - Polyglot tags to match (OR logic)
 * @param {number} limit - Max entries to return (default 3)
 * @returns {Array<{id: string, content: string, importance: number, all_tags: string}>}
 */
function getPolyglotEntries(dataDir, tags, limit = 3) {
  try {
    const Database = require('better-sqlite3');
    const dbPath = path.join(dataDir, 'memory.db');
    if (!fs.existsSync(dbPath)) return [];
    const db = new Database(dbPath, { readonly: true });
    try {
      const placeholders = tags.map(() => '?').join(',');
      return db.prepare(`
        SELECT DISTINCT me.id, me.content, me.importance,
               GROUP_CONCAT(mt2.tag) as all_tags
        FROM memory_entries me
        JOIN memory_tags mt ON me.id = mt.entry_id
        LEFT JOIN memory_tags mt2 ON me.id = mt2.entry_id
        WHERE mt.tag IN (${placeholders})
        GROUP BY me.id
        ORDER BY me.importance DESC
        LIMIT ?
      `).all(...tags, limit);
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

/**
 * Read persisted instance identity from data/hook-identity.json.
 * Written by MCP server on god_comms_heartbeat.
 * Returns { instanceId, name?, role, timestamp } or null.
 */
function readHookIdentity(dataDir) {
  try {
    const identityPath = path.join(dataDir, 'hook-identity.json');
    if (!fs.existsSync(identityPath)) return null;
    const raw = fs.readFileSync(identityPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && parsed.instanceId) return parsed;
    return null;
  } catch {
    return null;
  }
}

// ─── Rating helpers (pending-rating.json + rating-counter.json) ───

/**
 * Read pending rating data from {dataDir}/pending-rating.json.
 * Returns { trajectoryId, queryId, recallCount, timestamp } or null.
 */
function readPendingRating(dataDir) {
  try {
    const filePath = path.join(dataDir, 'pending-rating.json');
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Write pending rating data to {dataDir}/pending-rating.json.
 */
function writePendingRating(dataDir, data) {
  try {
    const dir = dataDir;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'pending-rating.json'), JSON.stringify(data, null, 2));
  } catch {
    // silent
  }
}

/**
 * Delete pending rating file.
 */
function deletePendingRating(dataDir) {
  try {
    const filePath = path.join(dataDir, 'pending-rating.json');
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // silent
  }
}

/**
 * Read the persistent rating counter from {dataDir}/rating-counter.json.
 * Returns the current count (number).
 */
function readRatingCounter(dataDir) {
  try {
    const filePath = path.join(dataDir, 'rating-counter.json');
    if (!fs.existsSync(filePath)) return 0;
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed.count || 0;
  } catch {
    return 0;
  }
}

/**
 * Increment the persistent rating counter. Returns the new count.
 * Odd = should rate, even = skip.
 */
function incrementRatingCounter(dataDir) {
  const current = readRatingCounter(dataDir);
  const next = current + 1;
  try {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'rating-counter.json'), JSON.stringify({ count: next }));
  } catch {
    // silent
  }
  return next;
}

// ─── STM helpers (stm-journal.json) ───

/**
 * Read the STM journal from {dataDir}/stm-journal.json.
 * Returns { signals: [...], manualStmCalled: bool } or null.
 */
function readStmJournal(dataDir) {
  try {
    const filePath = path.join(dataDir, 'stm-journal.json');
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Write/overwrite the STM journal.
 */
function writeStmJournal(dataDir, data) {
  try {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'stm-journal.json'), JSON.stringify(data, null, 2));
  } catch {
    // silent
  }
}

/**
 * Delete the STM journal file.
 */
function deleteStmJournal(dataDir) {
  try {
    const filePath = path.join(dataDir, 'stm-journal.json');
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // silent
  }
}

/**
 * Compute importance score for accumulated STM signals.
 *
 * importance = clamp(0.1, 1.0,
 *   breadth  * 0.25 +    // min(1.0, uniqueFiles / 5)
 *   depth    * 0.25 +    // min(1.0, totalEdits / 8)
 *   risk     * 0.20 +    // failedCmds > 0 ? min(1.0, 0.5+fails*0.1) : 0
 *   scope    * 0.15 +    // min(1.0, bashCommands / 6)
 *   duration * 0.15      // min(1.0, timeSpan / 15min)
 * )
 */
function computeStmImportance(signals) {
  if (!signals || signals.length === 0) return 0;

  const uniqueFiles = new Set();
  let totalEdits = 0;
  let failedCmds = 0;
  let bashCommands = 0;
  let firstTime = Infinity;
  let lastTime = 0;

  for (const s of signals) {
    const ts = new Date(s.timestamp).getTime();
    if (ts < firstTime) firstTime = ts;
    if (ts > lastTime) lastTime = ts;

    if (s.type === 'edit' || s.type === 'write') {
      if (s.file) uniqueFiles.add(s.file);
      totalEdits++;
    } else if (s.type === 'bash') {
      bashCommands++;
      if (s.file) uniqueFiles.add(s.file); // files created by bash
      if (s.failed) failedCmds++;
    }
  }

  const breadth = Math.min(1.0, uniqueFiles.size / 5);
  const depth = Math.min(1.0, totalEdits / 8);
  const risk = failedCmds > 0 ? Math.min(1.0, 0.5 + failedCmds * 0.1) : 0;
  const scope = Math.min(1.0, bashCommands / 6);
  const timeSpanMin = (lastTime - firstTime) / 60000;
  const duration = Math.min(1.0, timeSpanMin / 15);

  const raw = breadth * 0.25 + depth * 0.25 + risk * 0.20 + scope * 0.15 + duration * 0.15;
  return Math.max(0.1, Math.min(1.0, raw));
}

/**
 * Synthesize human-readable content from STM signals for memory storage.
 */
function synthesizeStmContent(signals) {
  const filesModified = new Set();
  const filesCreated = new Set();
  const commands = [];
  let firstTime = null;
  let lastTime = null;

  for (const s of signals) {
    if (!firstTime) firstTime = s.timestamp;
    lastTime = s.timestamp;

    if (s.type === 'edit') {
      filesModified.add(s.file);
    } else if (s.type === 'write') {
      filesCreated.add(s.file);
    } else if (s.type === 'bash') {
      const status = s.failed ? 'FAIL' : 'ok';
      commands.push(`${s.command} (${status})`);
    }
  }

  // Remove created files from modified (if file was created then edited, show as created)
  for (const f of filesCreated) {
    filesModified.delete(f);
  }

  const startTime = firstTime ? new Date(firstTime).toISOString().substring(0, 16).replace('T', ' ') : '?';
  const endTime = lastTime ? new Date(lastTime).toISOString().substring(0, 16).replace('T', ' ') : '?';

  const lines = [`[Auto-STM] Session activity (${startTime} – ${endTime})`];
  if (filesModified.size > 0) lines.push(`FILES MODIFIED: ${[...filesModified].join(', ')}`);
  if (filesCreated.size > 0) lines.push(`FILES CREATED: ${[...filesCreated].join(', ')}`);
  if (commands.length > 0) lines.push(`COMMANDS: ${commands.slice(0, 10).join(', ')}`);

  const editCount = [...filesModified].length;
  const createCount = [...filesCreated].length;
  const failCount = signals.filter(s => s.type === 'bash' && s.failed).length;
  lines.push(`STATS: ${editCount} edits, ${createCount} creates, ${commands.length} commands (${failCount} failures)`);

  return lines.join('\n');
}

/**
 * Map file extensions to polyglot skill tags for auto-tagging.
 */
const EXT_SKILL_MAP = {
  '.js': 'polyglot:javascript', '.jsx': 'polyglot:javascript', '.ts': 'polyglot:javascript', '.tsx': 'polyglot:javascript',
  '.php': 'polyglot:php',
  '.py': 'polyglot:python',
  '.css': 'polyglot:css', '.scss': 'polyglot:css', '.less': 'polyglot:css',
  '.sql': 'polyglot:database',
  '.sh': 'polyglot:bash', '.bash': 'polyglot:bash',
  '.json': 'polyglot:config', '.yaml': 'polyglot:config', '.yml': 'polyglot:config', '.toml': 'polyglot:config',
  '.html': 'polyglot:html', '.htm': 'polyglot:html',
  '.go': 'polyglot:go',
  '.rs': 'polyglot:rust',
  '.java': 'polyglot:java',
  '.rb': 'polyglot:ruby',
};

/**
 * Map file extensions to LSP language IDs for code intelligence tools.
 */
const LSP_EXTENSION_MAP = {
  '.ts': 'typescript', '.tsx': 'typescript',
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.php': 'php', '.phtml': 'php',
  '.css': 'css', '.scss': 'css', '.less': 'css',
  '.html': 'html', '.htm': 'html',
  '.sql': 'sql'
};

/**
 * Get LSP language ID for a file path based on extension.
 * Returns null if the file type has no LSP support.
 */
function getLspLanguageForFile(filePath) {
  if (!filePath) return null;
  const ext = path.extname(filePath).toLowerCase();
  return LSP_EXTENSION_MAP[ext] || null;
}

/**
 * Extract polyglot skill tags from a file path based on extension.
 */
function filePathToSkillTags(filePath) {
  if (!filePath) return [];
  const ext = path.extname(filePath).toLowerCase();
  const tag = EXT_SKILL_MAP[ext];
  return tag ? [tag] : [];
}

/**
 * Detect if a bash command is read-only (should not be tracked).
 * Matches: git status, git log, git diff, ls, cat, head, tail, echo, pwd, whoami, etc.
 */
const READ_ONLY_BASH_PATTERNS = [
  /^\s*(git\s+(status|log|diff|show|branch|remote|describe|rev-parse|tag\b))/i,
  /^\s*(ls|cat|head|tail|echo|pwd|whoami|which|where|type|file|wc|du|df|uname|date|hostname)\b/i,
  /^\s*(node\s+.*--version|npm\s+(list|ls|view|info|show)|npx\s+--version)/i,
  /^\s*(grep|rg|find|ag|fd)\b/i,
];

function isReadOnlyBash(command) {
  if (!command) return true;
  const trimmed = command.trim();
  if (trimmed.length === 0) return true;
  return READ_ONLY_BASH_PATTERNS.some(p => p.test(trimmed));
}

// ─── QC Ledger helpers (qc-ledger.json) ───

/**
 * Read the QC ledger from {dataDir}/qc-ledger.json.
 * Returns { files: { relativePath: { at, errors, warnings } } } or null.
 */
function readQcLedger(dataDir) {
  try {
    const filePath = path.join(dataDir, 'qc-ledger.json');
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Write/merge into the QC ledger at {dataDir}/qc-ledger.json.
 * Merges file entries into existing ledger (doesn't overwrite).
 */
function writeQcLedger(dataDir, ledger) {
  try {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    const existing = readQcLedger(dataDir) || { files: {} };
    if (ledger && ledger.files) {
      Object.assign(existing.files, ledger.files);
    }
    fs.writeFileSync(path.join(dataDir, 'qc-ledger.json'), JSON.stringify(existing, null, 2));
  } catch {
    // silent
  }
}

/**
 * Delete the QC ledger file.
 */
function clearQcLedger(dataDir) {
  try {
    const filePath = path.join(dataDir, 'qc-ledger.json');
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // silent
  }
}

/**
 * Get files that were edited (have lspLang in STM journal) but NOT yet diagnosed (not in QC ledger).
 * Returns array of { file, lang } entries.
 */
function getUndiagnosedFiles(dataDir) {
  const journal = readStmJournal(dataDir);
  if (!journal || !journal.signals || journal.signals.length === 0) return [];

  const ledger = readQcLedger(dataDir);
  const diagnosedFiles = (ledger && ledger.files) ? ledger.files : {};

  const lspFiles = new Map(); // file -> lang
  for (const sig of journal.signals) {
    if ((sig.type === 'edit' || sig.type === 'write') && sig.file) {
      const lang = sig.lspLang || getLspLanguageForFile(sig.file);
      if (lang && !lspFiles.has(sig.file)) {
        lspFiles.set(sig.file, lang);
      }
    }
  }

  const undiagnosed = [];
  for (const [file, lang] of lspFiles) {
    // Normalize: check both the raw path and the basename for ledger matches
    const basename = path.basename(file);
    const relParts = file.replace(/\\/g, '/');
    const isDiagnosed = diagnosedFiles[file] || diagnosedFiles[basename] || diagnosedFiles[relParts];
    if (!isDiagnosed) {
      undiagnosed.push({ file, lang });
    }
  }

  return undiagnosed;
}

/**
 * Read the last auto-store timestamp from {dataDir}/stm-last-store.json.
 * Returns epoch ms or 0.
 */
function readLastStmStore(dataDir) {
  try {
    const filePath = path.join(dataDir, 'stm-last-store.json');
    if (!fs.existsSync(filePath)) return 0;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw).timestamp || 0;
  } catch {
    return 0;
  }
}

/**
 * Write the last auto-store timestamp.
 */
function writeLastStmStore(dataDir) {
  try {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'stm-last-store.json'), JSON.stringify({ timestamp: Date.now() }));
  } catch {
    // silent
  }
}

module.exports = {
  RUBIX_ROOT,
  AFK_STATE_PATH,
  PROJECT_MAPPINGS,
  readStdin,
  readAfkState,
  writeAfkState,
  detectProject,
  resolveMcpConfig,
  httpPost,
  httpGet,
  detectPromptSkills,
  getPolyglotEntries,
  readHookIdentity,
  // Rating helpers
  readPendingRating,
  writePendingRating,
  deletePendingRating,
  readRatingCounter,
  incrementRatingCounter,
  // STM helpers
  readStmJournal,
  writeStmJournal,
  deleteStmJournal,
  computeStmImportance,
  synthesizeStmContent,
  filePathToSkillTags,
  isReadOnlyBash,
  readLastStmStore,
  writeLastStmStore,
  // LSP helpers
  LSP_EXTENSION_MAP,
  getLspLanguageForFile,
  // QC Ledger helpers
  readQcLedger,
  writeQcLedger,
  clearQcLedger,
  getUndiagnosedFiles
};
