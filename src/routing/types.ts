/**
 * Routing Types
 *
 * Type definitions for Tiny Dancer neural router and Circuit Breaker.
 */

/**
 * Available reasoning routes that queries can be directed to
 */
export enum ReasoningRoute {
  /** Find similar historical patterns */
  PATTERN_MATCH = 'pattern_match',
  /** What effects does X cause? (forward traversal) */
  CAUSAL_FORWARD = 'causal_forward',
  /** What caused X? (backward traversal) */
  CAUSAL_BACKWARD = 'causal_backward',
  /** Time-based cause-effect chains */
  TEMPORAL_CAUSAL = 'temporal_causal',
  /** Combine pattern + causal reasoning */
  HYBRID = 'hybrid',
  /** Simple vector search without reasoning */
  DIRECT_RETRIEVAL = 'direct_retrieval',
  /** Find contradictory evidence */
  ADVERSARIAL = 'adversarial'
}

/**
 * Result of routing decision
 */
export interface RoutingDecision {
  /** Selected route */
  route: ReasoningRoute;
  /** Confidence in the routing decision (0-1) */
  confidence: number;
  /** Alternative routes considered */
  alternatives?: Array<{
    route: ReasoningRoute;
    confidence: number;
  }>;
  /** Reasoning for the decision */
  reason?: string;
  /** Time taken to make decision (ms) */
  routingTimeMs: number;
}

/**
 * Configuration for Tiny Dancer router
 */
export interface TinyDancerConfig {
  /** Minimum confidence to use a route (below this falls back to HYBRID) */
  minConfidence: number;
  /** Enable rule-based routing (vs. neural) */
  useRuleBased: boolean;
  /** Keywords that trigger specific routes */
  routeKeywords: Record<ReasoningRoute, string[]>;
  /** Default route when no patterns match */
  defaultRoute: ReasoningRoute;
  /** Whether to track routing statistics */
  trackStats: boolean;
}

/**
 * Default Tiny Dancer configuration
 */
export const DEFAULT_TINY_DANCER_CONFIG: TinyDancerConfig = {
  minConfidence: 0.6,
  useRuleBased: true,
  defaultRoute: ReasoningRoute.HYBRID,
  trackStats: true,
  routeKeywords: {
    [ReasoningRoute.PATTERN_MATCH]: [
      'pattern', 'similar', 'like', 'match', 'resembles', 'looks like',
      'historical', 'before', 'previously', 'example'
    ],
    [ReasoningRoute.CAUSAL_FORWARD]: [
      'cause', 'effect', 'result', 'lead to', 'consequence', 'impact',
      'what happens', 'will happen', 'outcome'
    ],
    [ReasoningRoute.CAUSAL_BACKWARD]: [
      'why', 'reason', 'because', 'caused by', 'root cause', 'origin',
      'what caused', 'led to', 'source of'
    ],
    [ReasoningRoute.TEMPORAL_CAUSAL]: [
      'timeline', 'sequence', 'before', 'after', 'preceded', 'followed',
      'chain of events', 'over time', 'when'
    ],
    [ReasoningRoute.HYBRID]: [
      'analyze', 'understand', 'explain', 'complex', 'multi-factor'
    ],
    [ReasoningRoute.DIRECT_RETRIEVAL]: [
      'find', 'get', 'retrieve', 'search', 'lookup', 'fetch', 'show me'
    ],
    [ReasoningRoute.ADVERSARIAL]: [
      'contradict', 'opposite', 'against', 'refute', 'disprove',
      'counter', 'challenge', 'but what if', 'risks'
    ]
  }
};

/**
 * Circuit breaker states
 */
export enum CircuitState {
  /** Normal operation - all requests pass through */
  CLOSED = 'closed',
  /** Circuit is open - requests are blocked */
  OPEN = 'open',
  /** Testing if service recovered */
  HALF_OPEN = 'half_open'
}

/**
 * Configuration for Circuit Breaker
 */
export interface CircuitBreakerConfig {
  /** Number of failures before opening circuit */
  failureThreshold: number;
  /** Time window for counting failures (ms) */
  failureWindow: number;
  /** Cooldown time before trying again (ms) */
  cooldownPeriod: number;
  /** Number of successes needed to close circuit from half-open */
  successThreshold: number;
  /** Whether to track per-route statistics */
  trackPerRoute: boolean;
}

/**
 * Default Circuit Breaker configuration
 */
export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  failureWindow: 60000, // 60 seconds
  cooldownPeriod: 300000, // 5 minutes
  successThreshold: 2,
  trackPerRoute: true
};

/**
 * Circuit breaker status for a specific route/agent
 */
export interface CircuitStatus {
  /** Unique identifier (route or agent ID) */
  id: string;
  /** Current circuit state */
  state: CircuitState;
  /** Number of recent failures */
  failureCount: number;
  /** Number of successes in half-open state */
  successCount: number;
  /** When the circuit was last opened */
  lastOpenedAt?: Date;
  /** When the circuit will try half-open */
  cooldownEndsAt?: Date;
  /** Total failures recorded */
  totalFailures: number;
  /** Total successes recorded */
  totalSuccesses: number;
}

/**
 * Routing statistics
 */
export interface RoutingStats {
  /** Total queries routed */
  totalRouted: number;
  /** Queries per route */
  routeCounts: Record<ReasoningRoute, number>;
  /** Average confidence per route */
  avgConfidence: Record<ReasoningRoute, number>;
  /** Average routing time (ms) */
  avgRoutingTimeMs: number;
  /** Fallback count (low confidence) */
  fallbackCount: number;
  /** Circuit breaker trips */
  circuitTrips: number;
}

/**
 * Query context for routing decision
 */
export interface QueryContext {
  /** The query text */
  query: string;
  /** Query embedding (optional, for neural routing) */
  embedding?: Float32Array;
  /** Previous route used (for session continuity) */
  previousRoute?: ReasoningRoute;
  /** User-specified route preference */
  preferredRoute?: ReasoningRoute;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Result of executing a routed query
 */
export interface RoutedQueryResult {
  /** The routing decision made */
  routing: RoutingDecision;
  /** Whether execution was successful */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Execution time (ms) */
  executionTimeMs: number;
  /** Number of results returned */
  resultCount: number;
}
