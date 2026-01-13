#!/usr/bin/env node
/**
 * Self-cleaning script for tmpclaude-* temporary directories
 *
 * These directories are created by Claude Code during execution and should be
 * cleaned up automatically, but can get left behind when sessions crash or
 * are force-killed.
 *
 * Usage:
 *   node scripts/clean-temp.js           # Clean temp dirs
 *   node scripts/clean-temp.js --dry-run # Show what would be deleted
 *   npm run clean:temp                   # Via npm script
 */

const fs = require('fs');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');
const ROOT_DIR = path.resolve(__dirname, '..');

const TEMP_PATTERNS = [
  /^tmpclaude-[a-f0-9]+-cwd$/,
];

function findTempDirs(dir, depth = 0) {
  if (depth > 2) return []; // Don't recurse too deep

  const found = [];

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const fullPath = path.join(dir, entry.name);

      // Check if this directory matches temp patterns
      if (TEMP_PATTERNS.some(pattern => pattern.test(entry.name))) {
        found.push(fullPath);
      } else if (entry.name !== 'node_modules' && entry.name !== 'dist' && entry.name !== '.git') {
        // Recurse into subdirectories (except node_modules, dist, .git)
        found.push(...findTempDirs(fullPath, depth + 1));
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
  console.log('Scanning for temporary Claude Code directories...\n');

  const tempDirs = findTempDirs(ROOT_DIR);

  if (tempDirs.length === 0) {
    console.log('No temporary directories found.');
    return;
  }

  console.log(`Found ${tempDirs.length} temporary director${tempDirs.length === 1 ? 'y' : 'ies'}:\n`);

  for (const dir of tempDirs) {
    const relativePath = path.relative(ROOT_DIR, dir);

    if (DRY_RUN) {
      console.log(`  [DRY RUN] Would delete: ${relativePath}`);
    } else {
      try {
        rmrf(dir);
        console.log(`  Deleted: ${relativePath}`);
      } catch (err) {
        console.error(`  Failed to delete ${relativePath}: ${err.message}`);
      }
    }
  }

  console.log('\nDone.');
}

main();
