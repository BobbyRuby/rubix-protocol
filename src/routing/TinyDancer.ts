/**
 * Tiny Dancer - Neural Query Router
 *
 * A lightweight router that directs queries to the optimal reasoning strategy.
 * Currently implements rule-based routing with keyword matching.
 * Can be extended to use FastGRNN for <1ms neural routing.
 *
 * Named after the Elton John song because it "dances" between routes,
 * finding the right path for each query.
 *
 * Routing Categories:
 * - PATTERN_MATCH: Find similar historical patterns
 * - CAUSAL_FORWARD: What effects does X cause?
 * - CAUSAL_BACKWARD: What caused X?
 * - TEMPORAL_CAUSAL: Time-based cause-effect chains
 * - HYBRID: Combine pattern + causal reasoning
 * - DIRECT_RETRIEVAL: Simple vector search
 * - ADVERSARIAL: Find contradictory evidence
 */

import {
  TinyDancerConfig,
  RoutingDecision,
  QueryContext,
  ReasoningRoute,
  RoutingStats,
  DEFAULT_TINY_DANCER_CONFIG
} from './types.js';
import { CircuitBreaker } from './CircuitBreaker.js';

export class TinyDancer {
  private config: TinyDancerConfig;
  private circuitBreaker: CircuitBreaker;

  // Pre-compiled regex patterns for each route
  private routePatterns: Map<ReasoningRoute, RegExp[]>;

  // Statistics
  private stats: RoutingStats = {
    totalRouted: 0,
    routeCounts: {
      [ReasoningRoute.PATTERN_MATCH]: 0,
      [ReasoningRoute.CAUSAL_FORWARD]: 0,
      [ReasoningRoute.CAUSAL_BACKWARD]: 0,
      [ReasoningRoute.TEMPORAL_CAUSAL]: 0,
      [ReasoningRoute.HYBRID]: 0,
      [ReasoningRoute.DIRECT_RETRIEVAL]: 0,
      [ReasoningRoute.ADVERSARIAL]: 0
    },
    avgConfidence: {
      [ReasoningRoute.PATTERN_MATCH]: 0,
      [ReasoningRoute.CAUSAL_FORWARD]: 0,
      [ReasoningRoute.CAUSAL_BACKWARD]: 0,
      [ReasoningRoute.TEMPORAL_CAUSAL]: 0,
      [ReasoningRoute.HYBRID]: 0,
      [ReasoningRoute.DIRECT_RETRIEVAL]: 0,
      [ReasoningRoute.ADVERSARIAL]: 0
    },
    avgRoutingTimeMs: 0,
    fallbackCount: 0,
    circuitTrips: 0
  };

  // Confidence accumulators for running average
  private confidenceSums: Map<ReasoningRoute, number> = new Map();

  constructor(
    config: Partial<TinyDancerConfig> = {},
    circuitBreaker?: CircuitBreaker
  ) {
    this.config = { ...DEFAULT_TINY_DANCER_CONFIG, ...config };
    this.circuitBreaker = circuitBreaker ?? new CircuitBreaker();
    this.routePatterns = this.compilePatterns();
  }

  /**
   * Route a query to the optimal reasoning strategy
   */
  route(context: QueryContext): RoutingDecision {
    const startTime = Date.now();

    // Check if user specified a preferred route
    if (context.preferredRoute) {
      // Check circuit breaker for preferred route
      if (this.circuitBreaker.canAttempt(context.preferredRoute)) {
        return this.createDecision(
          context.preferredRoute,
          1.0,
          'User-specified route',
          startTime
        );
      }
      // Preferred route is blocked, fall through to automatic routing
    }

    // Use rule-based or neural routing
    const decision = this.config.useRuleBased
      ? this.routeRuleBased(context, startTime)
      : this.routeNeural(context, startTime);

    // Update statistics
    this.updateStats(decision);

    return decision;
  }

  /**
   * Rule-based routing using keyword matching
   */
  private routeRuleBased(context: QueryContext, startTime: number): RoutingDecision {
    const query = context.query.toLowerCase();
    const scores: Map<ReasoningRoute, number> = new Map();

    // Score each route based on keyword matches
    for (const [route, patterns] of this.routePatterns) {
      let matchCount = 0;
      let totalWeight = 0;

      for (const pattern of patterns) {
        const matches = query.match(pattern);
        if (matches) {
          // Weight by pattern specificity (longer patterns = higher weight)
          const weight = pattern.source.length / 10;
          matchCount++;
          totalWeight += weight;
        }
      }

      if (matchCount > 0) {
        // Calculate score based on matches and weights
        const score = Math.min(0.95, (matchCount * 0.2) + (totalWeight * 0.1));
        scores.set(route, score);
      }
    }

    // Apply route-specific boosting based on query structure
    this.applyStructuralBoosts(query, scores);

    // Find best route
    let bestRoute = this.config.defaultRoute;
    let bestScore = 0;

    for (const [route, score] of scores) {
      // Check circuit breaker
      if (!this.circuitBreaker.canAttempt(route)) {
        continue;
      }

      if (score > bestScore) {
        bestScore = score;
        bestRoute = route;
      }
    }

    // Check confidence threshold
    if (bestScore < this.config.minConfidence) {
      this.stats.fallbackCount++;
      bestRoute = this.config.defaultRoute;
      bestScore = Math.max(bestScore, 0.5); // Ensure some confidence
    }

    // Get alternatives
    const alternatives = this.getAlternatives(scores, bestRoute);

    return this.createDecision(
      bestRoute,
      bestScore,
      this.getRoutingReason(bestRoute, query),
      startTime,
      alternatives
    );
  }

  /**
   * Neural routing using embedding similarity (placeholder for FastGRNN)
   * Currently falls back to rule-based
   */
  private routeNeural(context: QueryContext, startTime: number): RoutingDecision {
    // TODO: Implement FastGRNN-based routing
    // For now, fall back to rule-based with a note
    const decision = this.routeRuleBased(context, startTime);
    decision.reason = `[Neural routing not yet implemented] ${decision.reason}`;
    return decision;
  }

  /**
   * Apply structural boosts based on query patterns
   */
  private applyStructuralBoosts(query: string, scores: Map<ReasoningRoute, number>): void {
    // Question words suggest specific routes
    if (query.startsWith('why') || query.includes('why did') || query.includes('why does')) {
      this.boostScore(scores, ReasoningRoute.CAUSAL_BACKWARD, 0.3);
    }

    if (query.startsWith('what will') || query.includes('what happens if') || query.includes('what would')) {
      this.boostScore(scores, ReasoningRoute.CAUSAL_FORWARD, 0.3);
    }

    if (query.startsWith('when') || query.includes('timeline') || query.includes('sequence')) {
      this.boostScore(scores, ReasoningRoute.TEMPORAL_CAUSAL, 0.3);
    }

    if (query.includes('similar to') || query.includes('like the') || query.includes('pattern')) {
      this.boostScore(scores, ReasoningRoute.PATTERN_MATCH, 0.3);
    }

    if (query.includes('find') || query.includes('get') || query.includes('show me')) {
      this.boostScore(scores, ReasoningRoute.DIRECT_RETRIEVAL, 0.2);
    }

    if (query.includes('but') || query.includes('however') || query.includes('risk') || query.includes('downside')) {
      this.boostScore(scores, ReasoningRoute.ADVERSARIAL, 0.25);
    }

    // Complex queries likely need hybrid approach
    if (query.length > 100 || query.includes(' and ') || query.includes(' or ')) {
      this.boostScore(scores, ReasoningRoute.HYBRID, 0.15);
    }
  }

  /**
   * Boost a route's score
   */
  private boostScore(scores: Map<ReasoningRoute, number>, route: ReasoningRoute, boost: number): void {
    const current = scores.get(route) ?? 0;
    scores.set(route, Math.min(0.95, current + boost));
  }

  /**
   * Get alternative routes sorted by confidence
   */
  private getAlternatives(
    scores: Map<ReasoningRoute, number>,
    primaryRoute: ReasoningRoute
  ): Array<{ route: ReasoningRoute; confidence: number }> {
    const alternatives: Array<{ route: ReasoningRoute; confidence: number }> = [];

    for (const [route, score] of scores) {
      if (route !== primaryRoute && score >= 0.3) {
        if (this.circuitBreaker.canAttempt(route)) {
          alternatives.push({ route, confidence: score });
        }
      }
    }

    // Sort by confidence descending
    alternatives.sort((a, b) => b.confidence - a.confidence);

    return alternatives.slice(0, 3); // Top 3 alternatives
  }

  /**
   * Generate a human-readable reason for the routing decision
   */
  private getRoutingReason(route: ReasoningRoute, query: string): string {
    const keywords = this.config.routeKeywords[route];
    const matchedKeywords: string[] = [];

    for (const keyword of keywords) {
      if (query.includes(keyword)) {
        matchedKeywords.push(keyword);
      }
    }

    if (matchedKeywords.length > 0) {
      return `Matched keywords: ${matchedKeywords.slice(0, 3).join(', ')}`;
    }

    switch (route) {
      case ReasoningRoute.PATTERN_MATCH:
        return 'Query suggests pattern-based retrieval';
      case ReasoningRoute.CAUSAL_FORWARD:
        return 'Query asks about effects or consequences';
      case ReasoningRoute.CAUSAL_BACKWARD:
        return 'Query asks about causes or reasons';
      case ReasoningRoute.TEMPORAL_CAUSAL:
        return 'Query involves time-based causation';
      case ReasoningRoute.HYBRID:
        return 'Complex query requiring multiple reasoning approaches';
      case ReasoningRoute.DIRECT_RETRIEVAL:
        return 'Simple retrieval query';
      case ReasoningRoute.ADVERSARIAL:
        return 'Query seeks contradictory evidence';
      default:
        return 'Default routing';
    }
  }

  /**
   * Create a routing decision
   */
  private createDecision(
    route: ReasoningRoute,
    confidence: number,
    reason: string,
    startTime: number,
    alternatives?: Array<{ route: ReasoningRoute; confidence: number }>
  ): RoutingDecision {
    return {
      route,
      confidence,
      reason,
      alternatives,
      routingTimeMs: Date.now() - startTime
    };
  }

  /**
   * Record execution result (success/failure) for circuit breaker
   */
  recordResult(route: ReasoningRoute, success: boolean): void {
    if (success) {
      this.circuitBreaker.recordSuccess(route);
    } else {
      const tripped = this.circuitBreaker.recordFailure(route);
      if (tripped) {
        this.stats.circuitTrips++;
      }
    }
  }

  /**
   * Update routing statistics
   */
  private updateStats(decision: RoutingDecision): void {
    this.stats.totalRouted++;
    this.stats.routeCounts[decision.route]++;

    // Update average routing time
    this.stats.avgRoutingTimeMs =
      (this.stats.avgRoutingTimeMs * (this.stats.totalRouted - 1) + decision.routingTimeMs) /
      this.stats.totalRouted;

    // Update average confidence per route
    const routeCount = this.stats.routeCounts[decision.route];
    const currentSum = this.confidenceSums.get(decision.route) ?? 0;
    const newSum = currentSum + decision.confidence;
    this.confidenceSums.set(decision.route, newSum);
    this.stats.avgConfidence[decision.route] = newSum / routeCount;
  }

  /**
   * Get routing statistics
   */
  getStats(): RoutingStats {
    return { ...this.stats };
  }

  /**
   * Get circuit breaker status for all routes
   */
  getCircuitStatus(): ReturnType<CircuitBreaker['getAllStatus']> {
    return this.circuitBreaker.getAllStatus();
  }

  /**
   * Get circuit breaker
   */
  getCircuitBreaker(): CircuitBreaker {
    return this.circuitBreaker;
  }

  /**
   * Reset all statistics
   */
  resetStats(): void {
    this.stats = {
      totalRouted: 0,
      routeCounts: {
        [ReasoningRoute.PATTERN_MATCH]: 0,
        [ReasoningRoute.CAUSAL_FORWARD]: 0,
        [ReasoningRoute.CAUSAL_BACKWARD]: 0,
        [ReasoningRoute.TEMPORAL_CAUSAL]: 0,
        [ReasoningRoute.HYBRID]: 0,
        [ReasoningRoute.DIRECT_RETRIEVAL]: 0,
        [ReasoningRoute.ADVERSARIAL]: 0
      },
      avgConfidence: {
        [ReasoningRoute.PATTERN_MATCH]: 0,
        [ReasoningRoute.CAUSAL_FORWARD]: 0,
        [ReasoningRoute.CAUSAL_BACKWARD]: 0,
        [ReasoningRoute.TEMPORAL_CAUSAL]: 0,
        [ReasoningRoute.HYBRID]: 0,
        [ReasoningRoute.DIRECT_RETRIEVAL]: 0,
        [ReasoningRoute.ADVERSARIAL]: 0
      },
      avgRoutingTimeMs: 0,
      fallbackCount: 0,
      circuitTrips: 0
    };
    this.confidenceSums.clear();
  }

  /**
   * Get configuration
   */
  getConfig(): TinyDancerConfig {
    return { ...this.config };
  }

  // ============ Private Methods ============

  /**
   * Compile keyword patterns into regex for efficient matching
   */
  private compilePatterns(): Map<ReasoningRoute, RegExp[]> {
    const patterns = new Map<ReasoningRoute, RegExp[]>();

    for (const [routeStr, keywords] of Object.entries(this.config.routeKeywords)) {
      const route = routeStr as ReasoningRoute;
      const regexes = keywords.map(keyword => {
        // Escape special regex characters and create word boundary pattern
        const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`\\b${escaped}\\b`, 'i');
      });
      patterns.set(route, regexes);
    }

    return patterns;
  }
}
