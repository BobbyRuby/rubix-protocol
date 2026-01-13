#!/usr/bin/env node
/**
 * Self-cleaning script for tmpclaude-* temporary entries (files and directories)
 *
 * These are created by Claude Code during execution and should be
 * cleaned up automatically, but can get left behind when sessions crash or
 * are force-killed.
 *
 * Usage:
 *   node scripts/clean-temp.cjs           # Clean temp entries
 *   node scripts/clean-temp.cjs --dry-run # Show what would be deleted
 *   npm run clean:temp                    # Via npm script
 */

const fs = require('fs');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');
const ROOT_DIR = path.resolve(__dirname, '..');

const TEMP_PATTERNS = [
  /^tmpclaude-[a-f0-9]+-cwd$/,
];

function findTempEntries(dir, depth = 0) {
  if (depth > 2) return []; // Don't recurse too deep

  const found = [];

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      // Check if this entry matches temp patterns (files OR directories)
      if (TEMP_PATTERNS.some(pattern => pattern.test(entry.name))) {
        found.push({ path: fullPath, isDir: entry.isDirectory() });
      } else if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== 'dist' && entry.name !== '.git') {
        // Recurse into subdirectories (except node_modules, dist, .git)
        found.push(...findTempEntries(fullPath, depth + 1));
      }
    }
  } catch (err) {
    // Ignore permission errors
  }

  return found;
}

function rmrf(dir) {
  if (!fs.existsSync(dir)) return;

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      rmrf(fullPath);
    } else {
      fs.unlinkSync(fullPath);
    }
  }

  fs.rmdirSync(dir);
}

function main() {
  console.log('Scanning for temporary Claude Code entries...\n');

  const tempEntries = findTempEntries(ROOT_DIR);

  if (tempEntries.length === 0) {
    console.log('No temporary entries found.');
    return;
  }

  console.log(`Found ${tempEntries.length} temporary entr${tempEntries.length === 1 ? 'y' : 'ies'}:\n`);

  for (const entry of tempEntries) {
    const relativePath = path.relative(ROOT_DIR, entry.path);

    if (DRY_RUN) {
      console.log(`  [DRY RUN] Would delete: ${relativePath} (${entry.isDir ? 'dir' : 'file'})`);
    } else {
      try {
        if (entry.isDir) {
          rmrf(entry.path);
        } else {
          fs.unlinkSync(entry.path);
        }
        console.log(`  Deleted: ${relativePath}`);
      } catch (err) {
        console.error(`  Failed to delete ${relativePath}: ${err.message}`);
      }
    }
  }

  console.log('\nDone.');
}

main();
