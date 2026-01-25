/**
 * MemRL (Memory Reinforcement Learning) Module
 *
 * Entry-level Q-value learning that complements Sona pattern-level learning.
 * Based on the paper "MemRL: Self-Evolving Agents via Runtime Reinforcement
 * Learning on Episodic Memory".
 */

export { MemRLEngine } from './MemRLEngine.js';
export {
  DEFAULT_MEMRL_CONFIG,
  type MemRLConfig,
  type PhaseACandidate,
  type PhaseBResult,
  type MemRLQueryResult,
  type MemRLFeedback,
  type MemRLFeedbackResult,
  type MemRLStats,
  type CombinedLearningResult
} from './types.js';
