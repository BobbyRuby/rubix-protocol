#!/usr/bin/env node
/**
 * Temp Directory/File Cleanup Script
 *
 * Claude Code creates `tmpclaude-*-cwd` entries during execution.
 * These should auto-cleanup but get left behind when sessions crash or are force-killed.
 *
 * Usage:
 *   node scripts/clean-temp.cjs           # Delete temp entries
 *   node scripts/clean-temp.cjs --dry-run # Preview what would be deleted
 */

const fs = require('fs');
const path = require('path');

const dryRun = process.argv.includes('--dry-run');
const projectRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(__dirname, '../..');

const entriesToClean = [];

/**
 * Recursively find tmpclaude-*-cwd entries (files or directories).
 * @param {string} dir - Directory to search
 * @param {number} depth - Current depth (limit to 2)
 */
function findTempEntries(dir, depth = 0) {
  if (depth > 2) return;

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      // Match tmpclaude-XXXX-cwd pattern (hex chars of any length)
      if (entry.name.match(/^tmpclaude-[a-f0-9]{4,}-cwd$/)) {
        entriesToClean.push({
          path: path.join(dir, entry.name),
          isDirectory: entry.isDirectory()
        });
      } else if (entry.isDirectory() && depth < 2 && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        // Recurse into subdirectories (skip hidden dirs and node_modules)
        findTempEntries(path.join(dir, entry.name), depth + 1);
      }
    }
  } catch (e) {
    // Ignore permission errors
  }
}

// Search from repo root
findTempEntries(repoRoot);

if (entriesToClean.length === 0) {
  console.log('No temp entries found.');
  process.exit(0);
}

console.log(`Found ${entriesToClean.length} temp entries:`);
entriesToClean.forEach(e => console.log(`  ${e.isDirectory ? '[DIR]' : '[FILE]'} ${e.path}`));

if (dryRun) {
  console.log('\nDry run - no entries deleted.');
} else {
  let deleted = 0;
  let failed = 0;

  for (const e of entriesToClean) {
    try {
      if (e.isDirectory) {
        fs.rmSync(e.path, { recursive: true, force: true });
      } else {
        fs.unlinkSync(e.path);
      }
      console.log(`Deleted: ${e.path}`);
      deleted++;
    } catch (err) {
      console.error(`Failed to delete: ${e.path} - ${err.message}`);
      failed++;
    }
  }

  console.log(`\nCleaned ${deleted} entries.`);
  if (failed > 0) {
    console.log(`Failed to clean ${failed} entries.`);
    process.exit(1);
  }
}
