#!/usr/bin/env node
/**
 * Remove Noise Tags from RUBIX Memory
 *
 * Removes tags that don't add semantic value for retrieval.
 */

import Database from 'better-sqlite3';
import { join } from 'path';

const dataDir = process.env.GOD_AGENT_DATA_DIR || './data';
const dbPath = join(dataDir, 'memory.db');

// Noise tags to remove
const NOISE_TAGS = [
  // Tool names
  'bash',
  'read',
  'edit',
  'grep',
  'write',
  'glob',
  'todowrite',
  'exitplanmode',
  'askuserquestion',
  'skill',
  'webfetch',
  'websearch',
  'taskoutput',
  'task',
  'command',
  'file-modification',
  'user-prompt',
  'commit',
  'git',

  // System/capture metadata
  'session',
  'claude-code',
  'full-capture',
  'tool-call',

  // Path-based noise
  '-var-www-pole-manager',
  '-root',

  // MCP tool names
  'mcp__god-agent__god_query',
  'mcp__god-agent__god_store',
  'mcp__god-agent__god_stats',
];

// Pattern for session UUIDs
const SESSION_UUID_PATTERN = /^session:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function cleanupNoiseTags() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Remove Noise Tags from RUBIX Memory');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  console.log(`Database: ${dbPath}`);
  console.log('');

  const db = new Database(dbPath);

  // Get all tags
  const allTags = db.prepare('SELECT DISTINCT tag FROM memory_tags').all();
  console.log(`[Info] Total unique tags in database: ${allTags.length}`);

  // Find session UUID tags
  const sessionUuidTags = allTags
    .map(t => t.tag)
    .filter(tag => SESSION_UUID_PATTERN.test(tag));

  console.log(`[Info] Session UUID tags found: ${sessionUuidTags.length}`);

  // Combine all tags to remove
  const tagsToRemove = [...NOISE_TAGS, ...sessionUuidTags];
  console.log(`[Info] Total tags to remove: ${tagsToRemove.length}`);
  console.log('');

  // Count affected entries before deletion
  let totalDeleted = 0;
  const deleteStmt = db.prepare('DELETE FROM memory_tags WHERE tag = ?');

  console.log('Removing tags...');
  console.log('');

  for (const tag of tagsToRemove) {
    const countResult = db.prepare('SELECT COUNT(*) as count FROM memory_tags WHERE tag = ?').get(tag);
    const count = countResult.count;

    if (count > 0) {
      const result = deleteStmt.run(tag);
      console.log(`  Removed: ${tag.padEnd(45)} (${count} entries)`);
      totalDeleted += result.changes;
    }
  }

  // Get remaining tags count
  const remainingTags = db.prepare('SELECT COUNT(DISTINCT tag) as count FROM memory_tags').get();

  db.close();

  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Cleanup Complete');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Tag associations removed: ${totalDeleted}`);
  console.log(`  Remaining unique tags:    ${remainingTags.count}`);
  console.log('');
}

cleanupNoiseTags().catch((error) => {
  console.error('[Fatal] Cleanup failed:', error);
  process.exit(1);
});
