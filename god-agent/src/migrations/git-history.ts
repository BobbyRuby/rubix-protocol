/**
 * Git History Migration
 *
 * Migrates git commit history into God Agent memory with causal relationships.
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { MemoryEngine } from '../core/MemoryEngine.js';
import { MemorySource, CausalRelationType } from '../core/types.js';
import type {
  MigrationConfig,
  MigrationResult,
  MigrationState,
  GitCommit,
  GitFileChange,
  ProgressCallback,
} from './types.js';

/**
 * Detect code area from file paths
 */
function detectAreas(files: GitFileChange[]): string[] {
  const areas = new Set<string>();

  for (const file of files) {
    const path = file.path.toLowerCase();

    // Backend
    if (path.startsWith('app/') || path.endsWith('.php')) {
      areas.add('backend');
    }

    // Frontend
    if (
      path.startsWith('public/js/') ||
      path.startsWith('resources/js/') ||
      path.startsWith('resources/css/') ||
      path.endsWith('.js') ||
      path.endsWith('.ts') ||
      path.endsWith('.css')
    ) {
      areas.add('frontend');
    }

    // DXF
    if (path.includes('dxf')) {
      areas.add('dxf');
    }

    // Katapult
    if (path.includes('katapult')) {
      areas.add('katapult');
    }

    // Database
    if (path.includes('migration') || path.startsWith('database/')) {
      areas.add('database');
    }

    // Config
    if (path.startsWith('config/') || path.endsWith('.env')) {
      areas.add('config');
    }

    // Tests
    if (path.includes('test') || path.startsWith('tests/')) {
      areas.add('tests');
    }

    // Views
    if (path.startsWith('resources/views/') || path.endsWith('.blade.php')) {
      areas.add('views');
    }
  }

  return Array.from(areas);
}

/**
 * Calculate importance based on commit characteristics
 */
function calculateImportance(commit: GitCommit): number {
  let importance = 0.3; // Base importance

  // More files = more important (up to +0.3)
  const fileCount = commit.files.length;
  importance += Math.min(fileCount / 10, 0.3);

  // More changes = more important (up to +0.2)
  const totalChanges = commit.insertions + commit.deletions;
  importance += Math.min(totalChanges / 500, 0.2);

  // Keywords that indicate importance
  const subject = commit.subject.toLowerCase();
  if (subject.includes('fix') || subject.includes('bug')) {
    importance += 0.1;
  }
  if (subject.includes('feature') || subject.includes('add')) {
    importance += 0.1;
  }
  if (subject.includes('security') || subject.includes('auth')) {
    importance += 0.15;
  }
  if (subject.includes('breaking') || subject.includes('major')) {
    importance += 0.1;
  }

  return Math.min(importance, 0.95);
}

/**
 * Detect relationship type from commit message
 */
function detectRelationType(commit: GitCommit): CausalRelationType | null {
  const subject = commit.subject.toLowerCase();

  // Fix-related commits
  if (
    subject.includes('fix') ||
    subject.includes('fixes') ||
    subject.includes('fixed') ||
    subject.includes('resolve') ||
    subject.includes('resolved') ||
    subject.includes('closes')
  ) {
    return CausalRelationType.CAUSES;
  }

  // Revert/hotfix commits
  if (
    subject.includes('revert') ||
    subject.includes('hotfix') ||
    subject.includes('rollback')
  ) {
    return CausalRelationType.TRIGGERS;
  }

  return null;
}

/**
 * Parse git log output into commit objects
 */
function parseGitLog(logOutput: string): GitCommit[] {
  const commits: GitCommit[] = [];
  const lines = logOutput.split('\n');

  let currentCommit: Partial<GitCommit> | null = null;

  for (const line of lines) {
    // New commit line: COMMIT|sha|shortSha|author|email|timestamp|parents|subject
    if (line.startsWith('COMMIT|')) {
      // Save previous commit if exists
      if (currentCommit && currentCommit.sha) {
        commits.push(currentCommit as GitCommit);
      }

      const parts = line.substring(7).split('|');
      currentCommit = {
        sha: parts[0],
        shortSha: parts[1],
        author: parts[2],
        email: parts[3],
        timestamp: parseInt(parts[4], 10),
        parents: parts[5] ? parts[5].split(' ').filter(Boolean) : [],
        subject: parts.slice(6).join('|'), // Subject might contain |
        files: [],
        insertions: 0,
        deletions: 0,
      };
    }
    // File stats line: insertions\tdeletions\tpath
    else if (currentCommit && line.match(/^\d+\t\d+\t/)) {
      const [ins, del, ...pathParts] = line.split('\t');
      const path = pathParts.join('\t');
      const insertions = parseInt(ins, 10) || 0;
      const deletions = parseInt(del, 10) || 0;

      currentCommit.files!.push({ path, insertions, deletions });
      currentCommit.insertions! += insertions;
      currentCommit.deletions! += deletions;
    }
    // Binary file or rename
    else if (currentCommit && line.match(/^-\t-\t/)) {
      const path = line.substring(4);
      currentCommit.files!.push({ path, insertions: 0, deletions: 0 });
    }
  }

  // Don't forget the last commit
  if (currentCommit && currentCommit.sha) {
    commits.push(currentCommit as GitCommit);
  }

  return commits;
}

/**
 * Get git history from repository
 */
function getGitHistory(projectRoot: string, afterSha?: string): GitCommit[] {
  const format = 'COMMIT|%H|%h|%an|%ae|%at|%P|%s';
  let command = `git -C "${projectRoot}" log --format="${format}" --numstat --reverse`;

  if (afterSha) {
    command += ` ${afterSha}..HEAD`;
  }

  try {
    const output = execSync(command, {
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024, // 50MB buffer
    });
    return parseGitLog(output);
  } catch (error) {
    console.error('Failed to get git history:', error);
    return [];
  }
}

/**
 * Load migration state for resume
 */
function loadState(dataDir: string): MigrationState | null {
  const statePath = join(dataDir, 'migration-state.json');
  if (!existsSync(statePath)) {
    return null;
  }

  try {
    const content = readFileSync(statePath, 'utf-8');
    const state = JSON.parse(content);
    state.startedAt = new Date(state.startedAt);
    return state;
  } catch {
    return null;
  }
}

/**
 * Save migration state
 */
function saveState(dataDir: string, state: MigrationState): void {
  const statePath = join(dataDir, 'migration-state.json');
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}

/**
 * Migrate git history to God Agent memory
 */
export async function migrateGitHistory(
  engine: MemoryEngine,
  config: MigrationConfig,
  onProgress?: ProgressCallback
): Promise<MigrationResult> {
  const startTime = Date.now();
  const result: MigrationResult = {
    phase: 'git',
    entriesStored: 0,
    relationsCreated: 0,
    errors: [],
    duration: 0,
    dryRun: config.dryRun,
  };

  // Load state for resume
  let state: MigrationState | null = null;
  let afterSha: string | undefined;

  if (config.resume) {
    state = loadState(config.dataDir);
    if (state?.lastCommitSha) {
      afterSha = state.lastCommitSha;
      onProgress?.('git', 0, 0, `Resuming from ${afterSha.substring(0, 7)}...`);
    }
  }

  // Get git history
  onProgress?.('git', 0, 0, 'Scanning commits...');
  const commits = getGitHistory(config.projectRoot, afterSha);

  if (commits.length === 0) {
    onProgress?.('git', 0, 0, 'No commits to process');
    result.duration = Date.now() - startTime;
    return result;
  }

  onProgress?.('git', 0, commits.length, `Found ${commits.length} commits`);

  // Map to track SHA -> entry ID for causal relations
  const shaToEntryId = new Map<string, string>();

  // Process commits in batches
  for (let i = 0; i < commits.length; i += config.batchSize) {
    const batch = commits.slice(i, i + config.batchSize);

    for (const commit of batch) {
      try {
        // Detect areas and calculate importance
        const areas = detectAreas(commit.files);
        const importance = calculateImportance(commit);

        // Build content
        const fileList = commit.files.slice(0, 10).map((f) => f.path).join(', ');
        const moreFiles = commit.files.length > 10 ? ` (+${commit.files.length - 10} more)` : '';
        const content = `[${commit.shortSha}] ${commit.subject}\n\nFiles: ${fileList}${moreFiles}\nStats: +${commit.insertions} -${commit.deletions}`;

        // Build tags
        const tags = ['git', 'commit', ...areas];

        if (!config.dryRun) {
          // Store commit
          const entry = await engine.store(content, {
            tags,
            source: MemorySource.EXTERNAL,
            importance,
            context: {
              sha: commit.sha,
              shortSha: commit.shortSha,
              author: commit.author,
              email: commit.email,
              timestamp: commit.timestamp,
              files: commit.files.map((f) => f.path),
              insertions: commit.insertions,
              deletions: commit.deletions,
            },
          });

          shaToEntryId.set(commit.sha, entry.id);
          result.entriesStored++;

          // Create precedes relation to parent commits
          for (const parentSha of commit.parents) {
            const parentEntryId = shaToEntryId.get(parentSha);
            if (parentEntryId) {
              engine.addCausalRelation(
                [parentEntryId],
                [entry.id],
                CausalRelationType.PRECEDES,
                0.9,
                { metadata: { relationship: 'git-parent-child' } }
              );
              result.relationsCreated++;
            }
          }

          // Create additional relations based on commit type
          const relationType = detectRelationType(commit);
          if (relationType && commit.parents.length > 0) {
            const parentEntryId = shaToEntryId.get(commit.parents[0]);
            if (parentEntryId) {
              engine.addCausalRelation(
                [entry.id],
                [parentEntryId],
                relationType,
                0.7,
                { metadata: { relationship: `git-${relationType.toString()}` } }
              );
              result.relationsCreated++;
            }
          }
        } else {
          // Dry run - just count
          result.entriesStored++;
          result.relationsCreated += commit.parents.length;
          const relationType = detectRelationType(commit);
          if (relationType) {
            result.relationsCreated++;
          }
        }

        // Update progress
        onProgress?.('git', i + batch.indexOf(commit) + 1, commits.length);
      } catch (error) {
        const errorMsg = `Failed to process commit ${commit.shortSha}: ${error instanceof Error ? error.message : error}`;
        result.errors.push(errorMsg);
      }
    }

    // Save state after each batch (for resume)
    if (!config.dryRun && batch.length > 0) {
      const lastCommit = batch[batch.length - 1];
      saveState(config.dataDir, {
        startedAt: state?.startedAt ?? new Date(),
        completedPhases: state?.completedPhases ?? [],
        lastCommitSha: lastCommit.sha,
        totalEntries: result.entriesStored,
        totalRelations: result.relationsCreated,
      });
    }
  }

  result.duration = Date.now() - startTime;
  return result;
}
