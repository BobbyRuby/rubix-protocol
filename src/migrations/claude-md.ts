/**
 * CLAUDE.md Migration
 *
 * Updates CLAUDE.md with a knowledge routing table pointing to God Agent.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type {
  MigrationConfig,
  MigrationResult,
  ProgressCallback,
} from './types.js';

/**
 * Knowledge routing section to add to CLAUDE.md
 */
const ROUTING_SECTION = `## Knowledge Routing (God Agent)

For detailed knowledge beyond this file, query god-agent via MCP tools:

| Topic | Query Example | Tags |
|-------|---------------|------|
| DXF/CAD generation | \`god_query("DXF block attributes")\` | \`skill:dxf\` |
| Laravel patterns | \`god_query("Laravel service pattern")\` | \`skill:laravel\` |
| Frontend (TALL) | \`god_query("Alpine CSP component")\` | \`skill:frontend\` |
| Security patterns | \`god_query("authentication flow")\` | \`security\` |
| NESC clearances | \`god_query("NESC Rule 235")\` | \`skill:nesc\` |
| Make-ready | \`god_query("make-ready calculation")\` | \`skill:make-ready\` |
| Past decisions | \`god_query("[feature] decision")\` | \`architecture\` |
| Git history | \`god_query("[feature] changes")\` | \`git\` |

### Proactive Queries

At session start, consider querying:
- Recent changes: \`god_query("recent commit", tags: ["git"])\`
- Security baseline: \`god_query("security checklist")\`

### L-Score Reliability

Query results include an L-Score (0-1) indicating reliability:
- **0.8-1.0**: High reliability (direct source)
- **0.5-0.8**: Medium reliability (derived info)
- **<0.5**: Low reliability (verify before using)

---

`;

/**
 * Find the insertion point for the routing section
 * Insert after "Skills Reference" section or at the end of front matter
 */
function findInsertionPoint(content: string): number {
  // Look for Skills Reference section
  const skillsMatch = content.match(/## Skills Reference[\s\S]*?(?=\n## |\n---\s*\n## |$)/);
  if (skillsMatch && skillsMatch.index !== undefined) {
    return skillsMatch.index + skillsMatch[0].length;
  }

  // Look for Tech Stack section
  const techStackMatch = content.match(/## Tech Stack[\s\S]*?(?=\n## |\n---\s*\n## |$)/);
  if (techStackMatch && techStackMatch.index !== undefined) {
    return techStackMatch.index + techStackMatch[0].length;
  }

  // Look for Project Overview section
  const overviewMatch = content.match(/## Project Overview[\s\S]*?(?=\n## |\n---\s*\n## |$)/);
  if (overviewMatch && overviewMatch.index !== undefined) {
    return overviewMatch.index + overviewMatch[0].length;
  }

  // Default: insert after first ---
  const firstDivider = content.indexOf('---');
  if (firstDivider !== -1) {
    const nextNewline = content.indexOf('\n', firstDivider + 3);
    return nextNewline !== -1 ? nextNewline + 1 : firstDivider + 4;
  }

  // Last resort: append at end
  return content.length;
}

/**
 * Check if routing section already exists
 */
function hasRoutingSection(content: string): boolean {
  return content.includes('## Knowledge Routing (God Agent)');
}

/**
 * Remove existing routing section if present
 */
function removeExistingSection(content: string): string {
  const sectionRegex = /## Knowledge Routing \(God Agent\)[\s\S]*?(?=\n## |\n---\s*\n## |$)/;
  return content.replace(sectionRegex, '');
}

/**
 * Update CLAUDE.md with knowledge routing section
 */
export async function updateClaudeMd(
  config: MigrationConfig,
  onProgress?: ProgressCallback
): Promise<MigrationResult> {
  const startTime = Date.now();
  const result: MigrationResult = {
    phase: 'claude-md',
    entriesStored: 0,
    relationsCreated: 0,
    errors: [],
    duration: 0,
    dryRun: config.dryRun,
  };

  const claudeMdPath = join(config.projectRoot, 'CLAUDE.md');

  onProgress?.('claude-md', 0, 1, 'Processing CLAUDE.md...');

  // Check if CLAUDE.md exists
  if (!existsSync(claudeMdPath)) {
    result.errors.push('CLAUDE.md not found');
    result.duration = Date.now() - startTime;
    return result;
  }

  try {
    // Read current content
    let content = readFileSync(claudeMdPath, 'utf-8');

    // Check if section already exists
    if (hasRoutingSection(content)) {
      if (config.dryRun) {
        onProgress?.('claude-md', 1, 1, 'Would replace existing routing section');
      } else {
        // Remove existing section before adding new one
        content = removeExistingSection(content);
      }
    }

    // Find insertion point
    const insertPoint = findInsertionPoint(content);

    // Insert routing section
    const newContent =
      content.substring(0, insertPoint) +
      '\n' +
      ROUTING_SECTION +
      content.substring(insertPoint);

    if (!config.dryRun) {
      // Write updated file
      writeFileSync(claudeMdPath, newContent, 'utf-8');
      result.entriesStored = 1;
      onProgress?.('claude-md', 1, 1, 'Updated CLAUDE.md with routing table');
    } else {
      result.entriesStored = 1;
      onProgress?.('claude-md', 1, 1, 'Would add routing section to CLAUDE.md');
    }
  } catch (error) {
    const errorMsg = `Failed to update CLAUDE.md: ${error instanceof Error ? error.message : error}`;
    result.errors.push(errorMsg);
  }

  result.duration = Date.now() - startTime;
  return result;
}
