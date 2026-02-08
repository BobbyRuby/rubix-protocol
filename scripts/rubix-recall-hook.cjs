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

// Trivial prompts that don't need memory recall
const TRIVIAL_PATTERN = /^(yes|no|ok|y|n|sure|thanks|thank you|continue|go ahead|do it|correct|right|yep|nope|done|good|great|fine|k|ty|thx|please|proceed|confirmed|approved|deny|denied|allow|reject)\b/i;

async function main() {
  const input = await readStdin();
  if (!input) return;

  const prompt = input.prompt || '';
  const cwd = input.cwd || process.cwd();

  // Smart skip: trivial or very short prompts
  if (prompt.length < 10 || TRIVIAL_PATTERN.test(prompt.trim())) {
    // Still output project context for short prompts
    const project = detectProject(cwd);
    if (project) {
      console.log(`[PROJECT] Active: ${project.name} | Instance: ${project.instance} | Tools: ${project.tools}`);
    }
    return;
  }

  // Detect project
  const project = detectProject(cwd);
  if (project) {
    console.log(`[PROJECT] Active: ${project.name} | Instance: ${project.instance} | Tools: ${project.tools}`);
  }

  // Query memory — try HTTP fast path first, then CLI fallback
  const queryText = prompt.substring(0, 500);
  let results = null;
  let learning = null;

  // Attempt 1: HTTP fast path via daemon
  try {
    const response = await httpPost('http://localhost:3456/api/query', {
      query: queryText,
      topK: 5,
      minScore: 0.4,
      includeProvenance: true
    }, 3000); // 3s timeout for HTTP path

    if (response && response.results && response.results.length > 0) {
      results = response.results;
      learning = response._learning || null;
    }
  } catch {
    // HTTP failed, try CLI
  }

  // Attempt 2: CLI fallback
  if (!results) {
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

  // Format output
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
