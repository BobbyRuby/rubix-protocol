/**
 * Curiosity Module
 *
 * Autonomous exploration system for RUBIX.
 * - Track what to explore (CuriosityTracker)
 * - Manage exploration budget (TokenBudgetManager)
 * - Execute explorations (AutonomousDiscoveryEngine)
 */

export * from './types.js';
export { CuriosityTracker, type ExplorationHistoryEntry } from './CuriosityTracker.js';
export { TokenBudgetManager } from './TokenBudgetManager.js';
export { AutonomousDiscoveryEngine, type AutonomousDiscoveryEngineConfig } from './AutonomousDiscoveryEngine.js';
