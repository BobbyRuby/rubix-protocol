/**
 * WolframManager
 *
 * Integration with Wolfram Alpha computational knowledge engine.
 * Provides deterministic math, science, and data computations.
 *
 * Use cases:
 * - Complex math (calculus, algebra, differential equations)
 * - Unit conversions
 * - Scientific calculations
 * - Data lookups (weather, stocks, geography)
 */

export interface WolframConfig {
  /** Wolfram Alpha App ID (get from developer.wolframalpha.com) */
  appId: string;
  /** Request timeout in ms (default: 30000) */
  timeout?: number;
  /** Enable result caching (default: true) */
  cacheEnabled?: boolean;
  /** Cache TTL in ms (default: 1 hour) */
  cacheTTL?: number;
}

export interface WolframResult {
  /** Whether the query was successful */
  success: boolean;
  /** The query that was sent */
  query: string;
  /** Primary result (short answer if available) */
  result?: string;
  /** Full pod results */
  pods?: WolframPod[];
  /** Error message if failed */
  error?: string;
  /** Whether this was a cached result */
  cached?: boolean;
  /** Time taken in ms */
  timing?: number;
}

export interface WolframPod {
  /** Pod title (e.g., "Result", "Input interpretation") */
  title: string;
  /** Pod ID */
  id: string;
  /** Pod content as plaintext */
  plaintext?: string;
  /** Pod content as image URL */
  image?: string;
}

interface CachedResult {
  result: WolframResult;
  timestamp: number;
}

/**
 * WolframManager - Wolfram Alpha API integration
 */
export class WolframManager {
  private config: WolframConfig;
  private cache: Map<string, CachedResult> = new Map();
  private baseUrl = 'https://api.wolframalpha.com/v2/query';

  constructor(config: WolframConfig) {
    this.config = {
      timeout: 30000,
      cacheEnabled: true,
      cacheTTL: 60 * 60 * 1000, // 1 hour
      ...config
    };
  }

  /**
   * Query Wolfram Alpha with a natural language question
   */
  async query(input: string): Promise<WolframResult> {
    const startTime = Date.now();

    // Check cache first
    if (this.config.cacheEnabled) {
      const cached = this.getFromCache(input);
      if (cached) {
        return {
          ...cached,
          cached: true,
          timing: Date.now() - startTime
        };
      }
    }

    try {
      // Build query URL
      const params = new URLSearchParams({
        appid: this.config.appId,
        input: input,
        format: 'plaintext,image',
        output: 'json'
      });

      const url = `${this.baseUrl}?${params.toString()}`;

      // Make request with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json'
        }
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Wolfram API error: HTTP ${response.status}`);
      }

      const data = await response.json();

      // Parse response
      const result = this.parseResponse(input, data);
      result.timing = Date.now() - startTime;

      // Cache successful results
      if (result.success && this.config.cacheEnabled) {
        this.addToCache(input, result);
      }

      return result;

    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return {
          success: false,
          query: input,
          error: 'Request timed out',
          timing: Date.now() - startTime
        };
      }

      return {
        success: false,
        query: input,
        error: error instanceof Error ? error.message : String(error),
        timing: Date.now() - startTime
      };
    }
  }

  /**
   * Quick calculation - returns just the result string
   */
  async calculate(expression: string): Promise<string> {
    const result = await this.query(expression);
    if (result.success && result.result) {
      return result.result;
    }
    throw new Error(result.error || 'No result returned');
  }

  /**
   * Solve an equation
   */
  async solve(equation: string): Promise<WolframResult> {
    return this.query(`solve ${equation}`);
  }

  /**
   * Integrate a function
   */
  async integrate(expression: string, variable: string = 'x'): Promise<WolframResult> {
    return this.query(`integrate ${expression} d${variable}`);
  }

  /**
   * Differentiate a function
   */
  async differentiate(expression: string, variable: string = 'x'): Promise<WolframResult> {
    return this.query(`derivative of ${expression} with respect to ${variable}`);
  }

  /**
   * Unit conversion
   */
  async convert(value: number, fromUnit: string, toUnit: string): Promise<WolframResult> {
    return this.query(`${value} ${fromUnit} to ${toUnit}`);
  }

  /**
   * Parse Wolfram Alpha API response
   */
  private parseResponse(query: string, data: unknown): WolframResult {
    const response = data as {
      queryresult?: {
        success?: boolean;
        error?: boolean;
        pods?: Array<{
          title?: string;
          id?: string;
          subpods?: Array<{
            plaintext?: string;
            img?: { src?: string };
          }>;
        }>;
      };
    };

    const queryResult = response.queryresult;

    if (!queryResult || queryResult.error || !queryResult.success) {
      return {
        success: false,
        query,
        error: 'Wolfram Alpha could not interpret the query'
      };
    }

    const pods: WolframPod[] = [];
    let primaryResult: string | undefined;

    for (const pod of queryResult.pods || []) {
      const subpod = pod.subpods?.[0];
      if (!subpod) continue;

      const wolframPod: WolframPod = {
        title: pod.title || 'Unknown',
        id: pod.id || '',
        plaintext: subpod.plaintext,
        image: subpod.img?.src
      };

      pods.push(wolframPod);

      // Extract primary result from "Result" or "Decimal approximation" pods
      if (!primaryResult && subpod.plaintext) {
        if (pod.id === 'Result' || pod.id === 'DecimalApproximation' || pod.title === 'Result') {
          primaryResult = subpod.plaintext;
        }
      }
    }

    // Fallback: use first pod with plaintext
    if (!primaryResult && pods.length > 0) {
      const firstWithText = pods.find(p => p.plaintext && p.id !== 'Input');
      primaryResult = firstWithText?.plaintext;
    }

    return {
      success: true,
      query,
      result: primaryResult,
      pods
    };
  }

  /**
   * Get result from cache
   */
  private getFromCache(query: string): WolframResult | null {
    const key = this.getCacheKey(query);
    const cached = this.cache.get(key);

    if (!cached) return null;

    // Check if expired
    if (Date.now() - cached.timestamp > (this.config.cacheTTL || 0)) {
      this.cache.delete(key);
      return null;
    }

    return cached.result;
  }

  /**
   * Add result to cache
   */
  private addToCache(query: string, result: WolframResult): void {
    const key = this.getCacheKey(query);
    this.cache.set(key, {
      result,
      timestamp: Date.now()
    });

    // Limit cache size
    if (this.cache.size > 1000) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }
  }

  /**
   * Generate cache key from query
   */
  private getCacheKey(query: string): string {
    return query.toLowerCase().trim().replace(/\s+/g, ' ');
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Check if Wolfram Alpha is configured
   */
  isConfigured(): boolean {
    return !!this.config.appId && this.config.appId.length > 0;
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; enabled: boolean } {
    return {
      size: this.cache.size,
      enabled: this.config.cacheEnabled ?? true
    };
  }
}

export default WolframManager;
