/**
 * Failure Learning Module
 *
 * Stage 7 of RUBIX: Failure Learning
 * Records failures, queries similar past failures,
 * and learns from successful resolutions to avoid
 * repeating the same mistakes.
 */

// Main service
export { FailureMemoryService, type FailureMemoryServiceConfig } from './FailureMemoryService.js';

// Types
export type {
  FailureMemory,
  FailurePattern,
  FailureQueryResult,
  FailureCausalLink,
  FailureStats,
  RecordFailureInput,
  QueryFailuresInput,
  RecordResolutionInput,
  FeedbackQuality
} from './types.js';
