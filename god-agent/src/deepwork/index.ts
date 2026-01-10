/**
 * Deep Work Mode
 *
 * Stage 8 of CODEX - enables focused, uninterrupted work sessions with:
 * - Smart notification batching based on focus level
 * - Progress checkpointing for crash recovery
 * - Detailed work logging for transparency
 * - Session lifecycle management
 *
 * Focus Levels:
 * - shallow: All notifications enabled
 * - normal: Batch non-urgent, allow blockers/completions
 * - deep: Only critical/urgent + completions
 */

// Main manager
export { DeepWorkManager } from './DeepWorkManager.js';
export { default } from './DeepWorkManager.js';

// Types
export type {
  DeepWorkSession,
  DeepWorkStatus,
  FocusLevel,
  NotificationPolicy,
  NotificationUrgency,
  Checkpoint,
  WorkLogEntry,
  WorkLogType,
  StatusReport,
  DeepWorkOptions,
  DeepWorkStats,
  BatchedNotification
} from './types.js';

// Default policies
export { DEFAULT_NOTIFICATION_POLICIES } from './types.js';
