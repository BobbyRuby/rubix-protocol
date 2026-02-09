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
    instance: 'rubix-frm-brain',
    name: 'God-Agent',
    tools: 'mcp__rubix-frm-brain__*'
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
    dataDir
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
  httpGet
};
