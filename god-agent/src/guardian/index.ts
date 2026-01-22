/**
 * Guardian Module
 *
 * Post-execution auditing with rollback capability.
 */

export { PostExecGuardian } from './PostExecGuardian.js';
export type {
  AuditResult,
  AuditIssue,
  AuditSeverity,
  AuditCategory,
  AuditSummary,
  AuditPhase,
  AuditContext,
  RollbackResult,
  RollbackMethod,
  PreWriteSnapshot,
  SnapshotFile,
  GuardianConfig,
  GuardianStats,
  SecurityPattern
} from './types.js';
export { DEFAULT_GUARDIAN_CONFIG } from './types.js';
