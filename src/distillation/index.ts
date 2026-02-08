/**
 * Memory Distillation Module
 *
 * Proactive extraction of lessons from stored experiences.
 */

export { MemoryDistillationService } from './MemoryDistillationService.js';
export { DEFAULT_DISTILLATION_CONFIG } from './types.js';
export type {
  DistillationConfig,
  DistilledInsight,
  DistillationResult,
  DistillationStats,
  DistillationType,
  InsightQuery,
  InsightQueryResult,
  MemoryInput,
  MemoryCluster,
  FailureFixChain,
  DistillationRun,
  ManualDistillationOptions
} from './types.js';
