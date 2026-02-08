/**
 * Reflexion Module
 *
 * Verbal Reflexion System for Claude-generated failure analysis.
 */

export { ReflexionService } from './ReflexionService.js';
export type {
  Reflection,
  ReflectionQuery,
  ReflectionQueryResult,
  ReflectionContext,
  FailureInput,
  ReflexionStats,
  ReflexionConfig,
  RootCauseCategory,
  AttemptSummary
} from './types.js';
export { DEFAULT_REFLEXION_CONFIG } from './types.js';
