/**
 * Post-Execution Guardian Types
 *
 * Type definitions for post-write auditing and rollback.
 * Guardian runs after EXECUTOR phase to catch issues before completion.
 */

/**
 * Main audit result structure
 */
export interface AuditResult {
  /** Whether all checks passed */
  passed: boolean;
  /** List of issues found */
  issues: AuditIssue[];
  /** Whether rollback is required */
  rollbackRequired: boolean;
  /** Reason for rollback (if required) */
  rollbackReason?: string;
  /** Files that were audited */
  filesAudited: string[];
  /** Files that were modified */
  filesModified: string[];
  /** Audit duration in milliseconds */
  auditDurationMs: number;
  /** Audit timestamp */
  auditedAt: Date;
  /** Audit phases completed */
  phasesCompleted: AuditPhase[];
  /** Summary of findings */
  summary: AuditSummary;
}

/**
 * Audit phases that can be run
 */
export type AuditPhase =
  | 'security'
  | 'regression'
  | 'quality'
  | 'diff_analysis'
  | 'type_check'
  | 'lint';

/**
 * Individual audit issue
 */
export interface AuditIssue {
  /** Issue ID for tracking */
  id: string;
  /** Severity level */
  severity: AuditSeverity;
  /** Issue category */
  category: AuditCategory;
  /** Affected file */
  file: string;
  /** Line number (if applicable) */
  line?: number;
  /** Column number (if applicable) */
  column?: number;
  /** Issue message */
  message: string;
  /** Code snippet showing the issue */
  codeSnippet?: string;
  /** Suggested fix */
  suggestion?: string;
  /** Rule or check that triggered this */
  rule?: string;
  /** Whether this issue blocks completion */
  blocking: boolean;
  /** Auto-fixable via tooling */
  autoFixable: boolean;
}

/**
 * Issue severity levels
 */
export type AuditSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/**
 * Issue categories
 */
export type AuditCategory =
  | 'security'      // Security vulnerabilities
  | 'regression'    // Test failures, broken functionality
  | 'quality'       // Code quality issues
  | 'performance'   // Performance concerns
  | 'type_error'    // TypeScript type errors
  | 'lint'          // Linting violations
  | 'style'         // Code style issues
  | 'complexity'    // Excessive complexity
  | 'duplication'   // Code duplication
  | 'deprecated'    // Use of deprecated APIs
  | 'compatibility' // Compatibility issues
  | 'other';

/**
 * Audit summary statistics
 */
export interface AuditSummary {
  /** Total issues found */
  totalIssues: number;
  /** Issues by severity */
  bySeverity: Record<AuditSeverity, number>;
  /** Issues by category */
  byCategory: Record<AuditCategory, number>;
  /** Number of blocking issues */
  blockingIssues: number;
  /** Number of auto-fixable issues */
  autoFixableIssues: number;
}

/**
 * Rollback operation result
 */
export interface RollbackResult {
  /** Whether rollback succeeded */
  success: boolean;
  /** Files that were restored */
  filesRestored: string[];
  /** Files that failed to restore */
  filesFailed: string[];
  /** Method used for rollback */
  method: RollbackMethod;
  /** Error message (if failed) */
  error?: string;
  /** Rollback timestamp */
  rolledBackAt: Date;
  /** Snapshot ID used for rollback */
  snapshotId?: string;
}

/**
 * Rollback methods available
 */
export type RollbackMethod =
  | 'git_stash'      // git stash pop
  | 'git_checkout'   // git checkout -- files
  | 'file_backup'    // Restore from backup copies
  | 'git_reset'      // git reset --hard
  | 'manual';        // Manual intervention required

/**
 * Snapshot taken before writing files
 */
export interface PreWriteSnapshot {
  /** Snapshot ID */
  id: string;
  /** Files backed up */
  files: SnapshotFile[];
  /** Git stash ref (if used) */
  stashRef?: string;
  /** Created timestamp */
  createdAt: Date;
  /** Task ID this snapshot belongs to */
  taskId: string;
  /** Subtask ID this snapshot belongs to */
  subtaskId: string;
}

/**
 * Individual file in a snapshot
 */
export interface SnapshotFile {
  /** File path */
  path: string;
  /** Original content hash */
  contentHash: string;
  /** Whether file existed before */
  existed: boolean;
  /** Original content (for small files) */
  content?: string;
  /** Backup path (for large files) */
  backupPath?: string;
}

/**
 * Guardian configuration
 */
export interface GuardianConfig {
  /** Enable security audit */
  securityAudit: boolean;
  /** Enable regression checks (run tests) */
  regressionCheck: boolean;
  /** Enable quality audit */
  qualityAudit: boolean;
  /** Enable diff analysis */
  diffAnalysis: boolean;
  /** Enable type checking */
  typeCheck: boolean;
  /** Enable linting */
  lintCheck: boolean;
  /** Severity threshold for blocking */
  blockingSeverity: AuditSeverity;
  /** Maximum issues before blocking */
  maxIssuesBeforeBlock: number;
  /** Auto-rollback on critical issues */
  autoRollbackOnCritical: boolean;
  /** Patterns to always audit */
  alwaysAuditPatterns: string[];
  /** Patterns to skip */
  skipPatterns: string[];
  /** Test command to run for regression checks */
  testCommand?: string;
  /** Timeout for regression tests (ms) */
  testTimeout: number;
  /** Maximum file size to audit (bytes) */
  maxFileSize: number;
}

/**
 * Default guardian configuration
 */
export const DEFAULT_GUARDIAN_CONFIG: GuardianConfig = {
  securityAudit: true,
  regressionCheck: true,
  qualityAudit: true,
  diffAnalysis: true,
  typeCheck: true,
  lintCheck: true,
  blockingSeverity: 'high',
  maxIssuesBeforeBlock: 10,
  autoRollbackOnCritical: true,
  alwaysAuditPatterns: [
    '**/*.ts',
    '**/*.tsx',
    '**/*.js',
    '**/*.jsx',
    '**/*.py',
    '**/*.go',
    '**/*.rs',
  ],
  skipPatterns: [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/*.test.ts',
    '**/*.spec.ts',
  ],
  testCommand: undefined, // Auto-detect
  testTimeout: 120000, // 2 minutes
  maxFileSize: 1024 * 1024, // 1MB
};

/**
 * Context for audit operations
 */
export interface AuditContext {
  /** Task ID */
  taskId: string;
  /** Subtask ID */
  subtaskId: string;
  /** Files written during execution */
  filesWritten: string[];
  /** Files modified during execution */
  filesModified: string[];
  /** Files deleted during execution */
  filesDeleted: string[];
  /** Pre-write snapshot */
  snapshot?: PreWriteSnapshot;
  /** Working directory */
  workingDir: string;
  /** Task description for context */
  taskDescription?: string;
  /** Subtask description for context */
  subtaskDescription?: string;
}

/**
 * Security patterns to check
 */
export interface SecurityPattern {
  /** Pattern ID */
  id: string;
  /** Pattern name */
  name: string;
  /** Regex pattern to match */
  pattern: RegExp;
  /** Severity if matched */
  severity: AuditSeverity;
  /** Description of the issue */
  description: string;
  /** File types to check */
  fileTypes?: string[];
  /** Suggested fix */
  suggestion?: string;
  /** Whether this is blocking by default */
  blocking: boolean;
}

/**
 * Guardian statistics
 */
export interface GuardianStats {
  /** Total audits performed */
  totalAudits: number;
  /** Audits that passed */
  passedAudits: number;
  /** Audits that failed */
  failedAudits: number;
  /** Total issues found */
  totalIssues: number;
  /** Issues by severity */
  issuesBySeverity: Record<AuditSeverity, number>;
  /** Issues by category */
  issuesByCategory: Record<AuditCategory, number>;
  /** Rollbacks performed */
  rollbacksPerformed: number;
  /** Successful rollbacks */
  successfulRollbacks: number;
  /** Average audit duration (ms) */
  avgAuditDurationMs: number;
  /** Most common issues */
  topIssues: Array<{ rule: string; count: number }>;
}
