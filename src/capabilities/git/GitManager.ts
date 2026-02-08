/**
 * GitManager
 *
 * Git intelligence for understanding code history.
 * Provides blame, bisect, history analysis, and branch operations.
 */

import { simpleGit, SimpleGit } from 'simple-git';
import * as path from 'path';
import { spawn } from 'child_process';

import type { GitConfig } from '../types.js';
import type {
  GitBlameResult,
  GitBisectResult,
  GitHistoryEntry,
  GitDiffResult,
  GitBranchInfo
} from '../types.js';
import type { GitBisectOptions, GitLogOptions, GitDiffOptions } from './types.js';

/**
 * GitManager - Git intelligence operations
 */
export class GitManager {
  private projectRoot: string;
  private git: SimpleGit;

  constructor(projectRoot: string, config: GitConfig) {
    this.projectRoot = projectRoot;
    this.git = simpleGit({
      baseDir: projectRoot,
      binary: config.gitPath ?? 'git',
      maxConcurrentProcesses: 6
    });
  }

  /**
   * Initialize and verify git repository
   */
  async initialize(): Promise<void> {
    try {
      const isRepo = await this.git.checkIsRepo();
      if (!isRepo) {
        throw new Error('Not a git repository');
      }
    } catch (error) {
      throw new Error(`Git initialization failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Shutdown (cleanup if needed)
   */
  async shutdown(): Promise<void> {
    // No cleanup needed for git
  }

  /**
   * Get blame information for a file
   */
  async blame(file: string, startLine?: number, endLine?: number): Promise<GitBlameResult> {
    const absolutePath = path.isAbsolute(file) ? file : path.join(this.projectRoot, file);
    const relativePath = path.relative(this.projectRoot, absolutePath);

    const args = ['blame', '--line-porcelain'];
    if (startLine !== undefined && endLine !== undefined) {
      args.push(`-L${startLine},${endLine}`);
    }
    args.push(relativePath);

    const result = await this.git.raw(args);
    const lines = this.parseBlameOutput(result);

    return {
      file: relativePath,
      lines
    };
  }

  /**
   * Run git bisect to find the first bad commit
   */
  async bisect(goodCommit: string, badCommit: string, testCommand: string): Promise<GitBisectResult> {
    const options: GitBisectOptions = {
      good: goodCommit,
      bad: badCommit,
      testCommand
    };

    try {
      // Start bisect
      await this.git.raw(['bisect', 'start']);
      await this.git.raw(['bisect', 'bad', options.bad]);
      await this.git.raw(['bisect', 'good', options.good]);

      // Run bisect with test command
      const result = await this.runBisectRun(options.testCommand);

      // Reset bisect
      await this.git.raw(['bisect', 'reset']);

      return result;
    } catch (error) {
      // Make sure to reset bisect even on error
      try {
        await this.git.raw(['bisect', 'reset']);
      } catch {
        // Ignore reset errors
      }

      return {
        badCommit,
        testCommand,
        status: 'error',
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Get commit history
   */
  async history(file?: string, limit: number = 20): Promise<GitHistoryEntry[]> {
    const options: GitLogOptions = { file, limit };

    const logArgs: string[] = [
      '--format=%H|%an|%aI|%s',
      '--numstat',
      `-n${options.limit}`
    ];

    if (options.file) {
      logArgs.push('--follow', '--', options.file);
    }

    const result = await this.git.raw(['log', ...logArgs]);
    return this.parseLogOutput(result);
  }

  /**
   * Get diff
   */
  async diff(file?: string, staged: boolean = false): Promise<GitDiffResult[]> {
    const options: GitDiffOptions = { file, staged };

    const args = ['diff'];
    if (options.staged) {
      args.push('--cached');
    }
    if (options.file) {
      args.push('--', options.file);
    }

    const result = await this.git.raw(args);
    return this.parseDiffOutput(result);
  }

  /**
   * Get branch information
   */
  async branches(): Promise<GitBranchInfo[]> {
    const result = await this.git.branch(['-vv', '--all']);
    const branches: GitBranchInfo[] = [];

    for (const branchName of Object.keys(result.branches)) {
      const branch = result.branches[branchName];
      branches.push({
        name: branch.name,
        current: branch.current,
        commit: branch.commit,
        upstream: branch.label?.match(/\[([^\]]+)\]/)?.[1]
      });
    }

    return branches;
  }

  /**
   * Get current branch name
   */
  async currentBranch(): Promise<string> {
    const result = await this.git.revparse(['--abbrev-ref', 'HEAD']);
    return result.trim();
  }

  /**
   * Get recent changes to a file
   */
  async recentChanges(file: string, options?: { limit?: number }): Promise<GitHistoryEntry[]> {
    return this.history(file, options?.limit ?? 5);
  }

  /**
   * Get the commit that last modified a specific line
   */
  async lineHistory(file: string, line: number): Promise<GitHistoryEntry[]> {
    const args = [
      'log',
      '--format=%H|%an|%aI|%s',
      `-L${line},${line}:${file}`,
      '-n10'
    ];

    try {
      const result = await this.git.raw(args);
      return this.parseLogOutput(result);
    } catch {
      // Line history not available
      return [];
    }
  }

  /**
   * Check if a file has uncommitted changes
   */
  async hasChanges(file?: string): Promise<boolean> {
    const status = await this.git.status();

    if (!file) {
      return !status.isClean();
    }

    const relativePath = path.relative(this.projectRoot, file);
    return status.files.some(f => f.path === relativePath);
  }

  /**
   * Get the diff between two commits for a file
   */
  async diffBetween(commit1: string, commit2: string, file?: string): Promise<GitDiffResult[]> {
    const args = ['diff', commit1, commit2];
    if (file) {
      args.push('--', file);
    }

    const result = await this.git.raw(args);
    return this.parseDiffOutput(result);
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  private parseBlameOutput(output: string): GitBlameResult['lines'] {
    const lines: GitBlameResult['lines'] = [];
    const entries = output.split(/(?=^[a-f0-9]{40})/m);

    for (const entry of entries) {
      if (!entry.trim()) continue;

      const match = entry.match(/^([a-f0-9]{40})\s+(\d+)\s+(\d+)/);
      if (!match) continue;

      const commit = match[1];
      const lineNumber = parseInt(match[3], 10);

      // Extract author and date
      const authorMatch = entry.match(/^author (.+)$/m);
      const dateMatch = entry.match(/^author-time (\d+)$/m);
      const contentMatch = entry.match(/^\t(.*)$/m);

      lines.push({
        lineNumber,
        commit,
        author: authorMatch?.[1] ?? 'unknown',
        date: dateMatch ? new Date(parseInt(dateMatch[1], 10) * 1000) : new Date(),
        content: contentMatch?.[1] ?? ''
      });
    }

    return lines;
  }

  private parseLogOutput(output: string): GitHistoryEntry[] {
    const entries: GitHistoryEntry[] = [];
    const lines = output.split('\n');

    let currentEntry: Partial<GitHistoryEntry> | null = null;

    for (const line of lines) {
      if (line.includes('|')) {
        // This is a commit line
        if (currentEntry?.commit) {
          entries.push(currentEntry as GitHistoryEntry);
        }

        const [commit, author, dateStr, message] = line.split('|');
        currentEntry = {
          commit: commit.trim(),
          author: author.trim(),
          date: new Date(dateStr.trim()),
          message: message?.trim() ?? '',
          files: [],
          insertions: 0,
          deletions: 0
        };
      } else if (currentEntry && line.trim()) {
        // This is a stat line (numstat format: additions deletions filename)
        const statMatch = line.match(/^(\d+|-)\s+(\d+|-)\s+(.+)$/);
        if (statMatch) {
          const insertions = statMatch[1] === '-' ? 0 : parseInt(statMatch[1], 10);
          const deletions = statMatch[2] === '-' ? 0 : parseInt(statMatch[2], 10);
          currentEntry.insertions = (currentEntry.insertions ?? 0) + insertions;
          currentEntry.deletions = (currentEntry.deletions ?? 0) + deletions;
          currentEntry.files?.push(statMatch[3]);
        }
      }
    }

    // Don't forget the last entry
    if (currentEntry?.commit) {
      entries.push(currentEntry as GitHistoryEntry);
    }

    return entries;
  }

  private parseDiffOutput(output: string): GitDiffResult[] {
    const results: GitDiffResult[] = [];
    const fileDiffs = output.split(/^diff --git /m).filter(Boolean);

    for (const fileDiff of fileDiffs) {
      const fileMatch = fileDiff.match(/a\/(.+?) b\/(.+)/);
      if (!fileMatch) continue;

      const file = fileMatch[2];
      const hunks: GitDiffResult['hunks'] = [];
      let additions = 0;
      let deletions = 0;

      const hunkMatches = fileDiff.matchAll(/@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@(.*?)(?=@@|\n?$)/gs);

      for (const match of hunkMatches) {
        const hunk = {
          oldStart: parseInt(match[1], 10),
          oldLines: parseInt(match[2] || '1', 10),
          newStart: parseInt(match[3], 10),
          newLines: parseInt(match[4] || '1', 10),
          content: match[5]?.trim() ?? ''
        };
        hunks.push(hunk);

        // Count additions/deletions
        const lines = hunk.content.split('\n');
        for (const line of lines) {
          if (line.startsWith('+') && !line.startsWith('+++')) additions++;
          if (line.startsWith('-') && !line.startsWith('---')) deletions++;
        }
      }

      results.push({
        file,
        hunks,
        additions,
        deletions
      });
    }

    return results;
  }

  private async runBisectRun(testCommand: string): Promise<GitBisectResult> {
    return new Promise((resolve) => {
      const child = spawn('git', ['bisect', 'run', ...testCommand.split(' ')], {
        cwd: this.projectRoot,
        shell: true
      });

      let output = '';
      child.stdout?.on('data', (data) => {
        output += data.toString();
      });
      child.stderr?.on('data', (data) => {
        output += data.toString();
      });

      child.on('close', (code) => {
        // Parse the output to find the first bad commit
        const match = output.match(/([a-f0-9]{40}) is the first bad commit/);

        if (match) {
          const commitMatch = output.match(/commit ([a-f0-9]{40})\nAuthor: (.+)\nDate: (.+)\n\n\s+(.+)/);
          resolve({
            badCommit: match[1],
            testCommand,
            firstBadCommit: match[1],
            message: commitMatch?.[4],
            author: commitMatch?.[2],
            date: commitMatch?.[3] ? new Date(commitMatch[3]) : undefined,
            status: 'found'
          });
        } else {
          resolve({
            badCommit: '',
            testCommand,
            status: code === 0 ? 'not_found' : 'error',
            message: output
          });
        }
      });
    });
  }
}

export default GitManager;
