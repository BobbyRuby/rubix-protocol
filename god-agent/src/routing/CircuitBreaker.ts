/**
 * Circuit Breaker
 *
 * Prevents cascade failures by tracking agent/route failures and
 * temporarily suspending problematic routes.
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Too many failures, requests blocked for cooldown period
 * - HALF_OPEN: Testing recovery, limited requests allowed
 *
 * Flow:
 * CLOSED → (failures >= threshold) → OPEN
 * OPEN → (cooldown elapsed) → HALF_OPEN
 * HALF_OPEN → (success) → CLOSED
 * HALF_OPEN → (failure) → OPEN
 */

import {
  CircuitBreakerConfig,
  CircuitState,
  CircuitStatus,
  DEFAULT_CIRCUIT_BREAKER_CONFIG
} from './types.js';

export class CircuitBreaker {
  private config: CircuitBreakerConfig;

  // Track failures per circuit (keyed by route/agent ID)
  private failures: Map<string, number[]> = new Map();

  // Track circuit states
  private states: Map<string, CircuitState> = new Map();

  // Track when circuits were opened
  private openedAt: Map<string, number> = new Map();

  // Track successes in half-open state
  private halfOpenSuccesses: Map<string, number> = new Map();

  // Statistics
  private totalFailures: Map<string, number> = new Map();
  private totalSuccesses: Map<string, number> = new Map();
  private tripCount = 0;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config };
  }

  /**
   * Record a failure for a circuit
   * Returns true if the circuit is now open
   */
  recordFailure(circuitId: string): boolean {
    const now = Date.now();

    // Initialize if needed
    if (!this.failures.has(circuitId)) {
      this.failures.set(circuitId, []);
      this.states.set(circuitId, CircuitState.CLOSED);
      this.totalFailures.set(circuitId, 0);
      this.totalSuccesses.set(circuitId, 0);
    }

    // Get recent failures within the window
    const failures = this.failures.get(circuitId)!;
    const windowStart = now - this.config.failureWindow;
    const recentFailures = failures.filter(t => t >= windowStart);

    // Add new failure
    recentFailures.push(now);
    this.failures.set(circuitId, recentFailures);

    // Update total
    this.totalFailures.set(circuitId, (this.totalFailures.get(circuitId) ?? 0) + 1);

    // Check current state
    const currentState = this.states.get(circuitId) ?? CircuitState.CLOSED;

    if (currentState === CircuitState.HALF_OPEN) {
      // Failure in half-open state → back to open
      this.openCircuit(circuitId);
      return true;
    }

    if (currentState === CircuitState.CLOSED) {
      // Check if we should open
      if (recentFailures.length >= this.config.failureThreshold) {
        this.openCircuit(circuitId);
        return true;
      }
    }

    return this.isOpen(circuitId);
  }

  /**
   * Record a success for a circuit
   * Returns true if the circuit is now closed
   */
  recordSuccess(circuitId: string): boolean {
    // Initialize if needed
    if (!this.states.has(circuitId)) {
      this.states.set(circuitId, CircuitState.CLOSED);
      this.totalSuccesses.set(circuitId, 0);
    }

    // Update total
    this.totalSuccesses.set(circuitId, (this.totalSuccesses.get(circuitId) ?? 0) + 1);

    const currentState = this.states.get(circuitId);

    if (currentState === CircuitState.HALF_OPEN) {
      // Success in half-open state → potentially close
      const successes = (this.halfOpenSuccesses.get(circuitId) ?? 0) + 1;
      this.halfOpenSuccesses.set(circuitId, successes);

      if (successes >= this.config.successThreshold) {
        this.closeCircuit(circuitId);
        return true;
      }
    }

    return !this.isOpen(circuitId);
  }

  /**
   * Check if a circuit is open (blocking requests)
   */
  isOpen(circuitId: string): boolean {
    const state = this.getState(circuitId);
    return state === CircuitState.OPEN;
  }

  /**
   * Check if requests can be attempted
   * Returns true if CLOSED or HALF_OPEN
   */
  canAttempt(circuitId: string): boolean {
    const state = this.getState(circuitId);
    return state !== CircuitState.OPEN;
  }

  /**
   * Get the current state of a circuit, checking for cooldown expiry
   */
  getState(circuitId: string): CircuitState {
    const currentState = this.states.get(circuitId) ?? CircuitState.CLOSED;

    if (currentState === CircuitState.OPEN) {
      // Check if cooldown has elapsed
      const openedAt = this.openedAt.get(circuitId);
      if (openedAt && Date.now() >= openedAt + this.config.cooldownPeriod) {
        // Transition to half-open
        this.states.set(circuitId, CircuitState.HALF_OPEN);
        this.halfOpenSuccesses.set(circuitId, 0);
        return CircuitState.HALF_OPEN;
      }
    }

    return currentState;
  }

  /**
   * Get detailed status for a circuit
   */
  getStatus(circuitId: string): CircuitStatus {
    const state = this.getState(circuitId);
    const failures = this.failures.get(circuitId) ?? [];
    const now = Date.now();
    const windowStart = now - this.config.failureWindow;
    const recentFailures = failures.filter(t => t >= windowStart);

    const openedAt = this.openedAt.get(circuitId);
    const cooldownEndsAt = openedAt
      ? new Date(openedAt + this.config.cooldownPeriod)
      : undefined;

    return {
      id: circuitId,
      state,
      failureCount: recentFailures.length,
      successCount: this.halfOpenSuccesses.get(circuitId) ?? 0,
      lastOpenedAt: openedAt ? new Date(openedAt) : undefined,
      cooldownEndsAt: state === CircuitState.OPEN ? cooldownEndsAt : undefined,
      totalFailures: this.totalFailures.get(circuitId) ?? 0,
      totalSuccesses: this.totalSuccesses.get(circuitId) ?? 0
    };
  }

  /**
   * Get status for all tracked circuits
   */
  getAllStatus(): CircuitStatus[] {
    const allIds = new Set([
      ...this.states.keys(),
      ...this.failures.keys()
    ]);

    return Array.from(allIds).map(id => this.getStatus(id));
  }

  /**
   * Manually reset a circuit to closed state
   */
  reset(circuitId: string): void {
    this.states.set(circuitId, CircuitState.CLOSED);
    this.failures.delete(circuitId);
    this.openedAt.delete(circuitId);
    this.halfOpenSuccesses.delete(circuitId);
  }

  /**
   * Reset all circuits
   */
  resetAll(): void {
    this.states.clear();
    this.failures.clear();
    this.openedAt.clear();
    this.halfOpenSuccesses.clear();
  }

  /**
   * Get total circuit trips (times circuits were opened)
   */
  getTripCount(): number {
    return this.tripCount;
  }

  /**
   * Get configuration
   */
  getConfig(): CircuitBreakerConfig {
    return { ...this.config };
  }

  // ============ Private Methods ============

  /**
   * Open a circuit (start blocking requests)
   */
  private openCircuit(circuitId: string): void {
    this.states.set(circuitId, CircuitState.OPEN);
    this.openedAt.set(circuitId, Date.now());
    this.halfOpenSuccesses.delete(circuitId);
    this.tripCount++;
  }

  /**
   * Close a circuit (resume normal operation)
   */
  private closeCircuit(circuitId: string): void {
    this.states.set(circuitId, CircuitState.CLOSED);
    this.failures.set(circuitId, []); // Clear failure history
    this.openedAt.delete(circuitId);
    this.halfOpenSuccesses.delete(circuitId);
  }
}
