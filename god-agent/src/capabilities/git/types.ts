/**
 * Git Types
 *
 * Type definitions specific to Git intelligence.
 */

export interface GitBisectOptions {
  /** Good commit (known working) */
  good: string;
  /** Bad commit (known broken) */
  bad: string;
  /** Test command to run */
  testCommand: string;
  /** Maximum steps before giving up */
  maxSteps?: number;
}

export interface GitLogOptions {
  /** File to get history for (optional) */
  file?: string;
  /** Maximum number of commits */
  limit?: number;
  /** Start from commit */
  from?: string;
  /** End at commit */
  to?: string;
  /** Author filter */
  author?: string;
  /** Grep message */
  grep?: string;
}

export interface GitDiffOptions {
  /** File to diff (optional) */
  file?: string;
  /** Show staged changes only */
  staged?: boolean;
  /** Compare with specific commit */
  commit?: string;
  /** Show name-only */
  nameOnly?: boolean;
}

export interface GitStashEntry {
  index: number;
  message: string;
  date: Date;
  files: string[];
}
