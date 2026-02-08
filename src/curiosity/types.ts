/**
 * Curiosity System Types
 *
 * Types for autonomous exploration and learning.
 */

/**
 * What triggered the curiosity probe
 */
export type ProbeOrigin =
  | 'failure'              // Task failed - highest priority
  | 'low_confidence'       // Pattern has low success rate
  | 'knowledge_gap'        // Unknown area identified
  | 'success_confirmation'; // Reinforce understanding of success

/**
 * Current status of a probe
 */
export type ProbeStatus = 'pending' | 'exploring' | 'resolved' | 'expired';

/**
 * Priority level for probe selection
 */
export type PrioritySlot = 'high' | 'moderate';

/**
 * A curiosity probe - something RUBIX wants to explore
 */
export interface CuriosityProbe {
  id: string;
  domain: string;              // Area of knowledge (e.g., "typescript", "api-design")
  question: string;            // What to explore
  origin: ProbeOrigin;         // What triggered this
  confidence: number;          // How sure are we (0-1)
  noveltyScore: number;        // How unexplored (0-1)
  priority: number;            // Computed priority (0-1)
  estimatedTokens: number;     // Predicted exploration cost
  createdAt: Date;
  updatedAt: Date;
  status: ProbeStatus;

  // Optional context
  errorType?: string;
  errorMessage?: string;
  stackTrace?: string;
  patternName?: string;
  successRate?: number;
  relatedPatterns?: string[];
  context?: Record<string, unknown>;

  // Web exploration (optional)
  webConfig?: WebExplorationConfig;
  explorationMethod?: ExplorationMethod;
}

/**
 * Result of exploring a probe
 */
export interface ExplorationResult {
  probeId: string;
  success: boolean;
  tokensUsed: number;
  findings: string;
  cause?: string;
  fix?: string;
  patternUpdate?: string;
  storedFacts: string[];
  confidence: number;
  durationMs: number;

  // Web exploration results (optional)
  screenshots?: string[];            // Paths to screenshot files
  visitedUrls?: string[];
  pageContents?: ExtractedPageContent[];
  explorationMethod?: ExplorationMethod;
}

/**
 * Report from a discovery cycle
 */
export interface DiscoveryReport {
  skipped?: boolean;
  reason?: string;
  completed?: number;
  probeId?: string;
  slotType?: PrioritySlot;
  tokensUsed?: number;
  remainingThisWeek?: number;
  discoveries?: ExplorationResult[];
}

/**
 * Weekly exploration stats
 */
export interface WeeklyStats {
  weekStart: Date;
  probesUsed: number;
  probesRemaining: number;
  tokensUsed: number;
  pattern: PrioritySlot[];       // e.g., ['high', 'high', 'high', 'moderate', 'high']
  cyclePosition: number;         // 0-3 in the 3:1 pattern
}

/**
 * Budget configuration
 */
export interface ExplorationBudget {
  tokensPerProbe: number;        // 100,000 tokens max per exploration
  probesPerWeek: number;         // 5 probes allowed per week
  highPriorityRatio: number;     // 3 (out of 4) are high-priority
  weeklyResetDay: number;        // 0 = Sunday
}

/**
 * Priority weights by origin
 */
export const PRIORITY_WEIGHTS: Record<ProbeOrigin, number> = {
  failure: 1.0,                  // Highest priority - learn from mistakes
  low_confidence: 0.7,           // High priority - uncertain areas
  knowledge_gap: 0.5,            // Medium priority - expand knowledge
  success_confirmation: 0.2,     // Low priority - occasional reinforcement
};

/**
 * Success confirmation rate (1 in N high slots becomes moderate)
 */
export const HIGH_PRIORITY_RATIO = 3;

/**
 * Default budget configuration
 */
export const DEFAULT_BUDGET: ExplorationBudget = {
  tokensPerProbe: 100000,
  probesPerWeek: 5,
  highPriorityRatio: 3,
  weeklyResetDay: 0,  // Sunday
};

/**
 * Calculate priority score for a probe
 */
export function calculatePriority(probe: Omit<CuriosityProbe, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'priority'>): number {
  const baseWeight = PRIORITY_WEIGHTS[probe.origin];
  const noveltyBoost = probe.noveltyScore * 0.3;
  const urgencyBoost = (1 - probe.confidence) * 0.2;

  return Math.min(1.0, baseWeight + noveltyBoost + urgencyBoost);
}

/**
 * Web exploration configuration for curiosity probes
 */
export interface WebExplorationConfig {
  urls?: string[];              // Direct URLs to visit
  searchQuery?: string;         // Google search query
  selectors?: string[];         // CSS selectors to extract
  maxPages?: number;            // Limit pages visited (default: 3)
  captureScreenshots?: boolean; // Default: true
}

/**
 * Exploration method for a probe
 */
export type ExplorationMethod = 'text' | 'web' | 'hybrid';

/**
 * Content extracted from a web page
 */
export interface ExtractedPageContent {
  url: string;
  title: string;
  text: string;
  extractedAt: Date;
}

/**
 * Result of web exploration
 */
export interface WebExplorationResult {
  success: boolean;
  screenshots: string[];         // Paths to screenshot files
  visitedUrls: string[];
  pageContents: ExtractedPageContent[];
  searchQuery?: string;
  error?: string;
  durationMs: number;
}
