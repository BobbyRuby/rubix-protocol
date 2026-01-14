/**
 * TokenRouter - Dynamic routing based on compressed context size.
 *
 * Routes to Ollama when context < 32K tokens, otherwise Claude.
 * Most tasks stay local since tokenized inter-phase data is ~1-2K tokens.
 */

import { OllamaClient } from '../providers/OllamaClient.js';
import { getDepartmentConfig } from '../core/config.js';
import type { LLMResponse, Message } from '../providers/types.js';

const OLLAMA_CONTEXT_LIMIT = 32000;  // 32K tokens max for Ollama

/**
 * Estimate token count from text.
 * Rough estimate: 4 chars ≈ 1 token (conservative for code)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Determine which provider to use based on context size.
 */
export function routeToProvider(compressedContext: string): 'ollama' | 'claude' {
  const tokenCount = estimateTokens(compressedContext);

  if (tokenCount < OLLAMA_CONTEXT_LIMIT) {
    return 'ollama';  // Local, fast, free
  }
  return 'claude';    // Falls back to API for large contexts
}

/**
 * TokenRouter handles dynamic provider selection based on context size.
 */
export class TokenRouter {
  private ollamaClient: OllamaClient | null = null;
  private ollamaAvailable = false;

  constructor() {
    this.initOllama();
  }

  /**
   * Initialize Ollama client and check availability.
   */
  private async initOllama(): Promise<void> {
    const config = getDepartmentConfig('ARCHITECT');
    if (!config?.fallback) {
      console.log('[TokenRouter] No Ollama fallback configured');
      return;
    }

    this.ollamaClient = new OllamaClient(config.fallback);

    try {
      const health = await this.ollamaClient.healthCheck();
      this.ollamaAvailable = health.available && health.modelLoaded;

      if (this.ollamaAvailable) {
        console.log('[TokenRouter] Ollama available and model loaded');
      } else {
        console.warn('[TokenRouter] Ollama not ready:', health.error);
      }
    } catch (error) {
      console.error('[TokenRouter] Failed to check Ollama:', error);
      this.ollamaAvailable = false;
    }
  }

  /**
   * Route a request to the appropriate provider.
   *
   * @param context - The compressed context to analyze
   * @param prompt - The full prompt to send
   * @param claudeGenerator - Function to call Claude (from SubAgentSpawner)
   * @returns Response from chosen provider
   */
  async route(
    context: string,
    prompt: string,
    claudeGenerator: () => Promise<LLMResponse>
  ): Promise<{ response: LLMResponse; provider: 'ollama' | 'claude'; tokenCount: number }> {
    const tokenCount = estimateTokens(context);
    const provider = routeToProvider(context);

    console.log(`[TokenRouter] Context: ${tokenCount} tokens → ${provider}`);

    if (provider === 'ollama' && this.ollamaAvailable && this.ollamaClient) {
      try {
        const messages: Message[] = [
          { role: 'user', content: prompt }
        ];

        const response = await this.ollamaClient.generate(messages, {
          maxTokens: 8192
        });

        return { response, provider: 'ollama', tokenCount };
      } catch (error) {
        console.warn('[TokenRouter] Ollama failed, falling back to Claude:', error);
        // Fall through to Claude
      }
    }

    // Use Claude (either by choice or fallback)
    const response = await claudeGenerator();
    return { response, provider: 'claude', tokenCount };
  }

  /**
   * Check if Ollama is available for routing.
   */
  async checkOllamaHealth(): Promise<{ available: boolean; modelLoaded: boolean; error?: string }> {
    if (!this.ollamaClient) {
      return { available: false, modelLoaded: false, error: 'Ollama not configured' };
    }
    return await this.ollamaClient.healthCheck();
  }

  /**
   * Get routing statistics.
   */
  getRouteDecision(context: string): {
    provider: 'ollama' | 'claude';
    tokenCount: number;
    ollamaAvailable: boolean;
    reason: string;
  } {
    const tokenCount = estimateTokens(context);
    const provider = routeToProvider(context);

    let reason: string;
    if (tokenCount >= OLLAMA_CONTEXT_LIMIT) {
      reason = `Context ${tokenCount} tokens exceeds Ollama limit of ${OLLAMA_CONTEXT_LIMIT}`;
    } else if (!this.ollamaAvailable) {
      reason = 'Ollama not available, using Claude';
    } else {
      reason = `Context ${tokenCount} tokens fits in Ollama's ${OLLAMA_CONTEXT_LIMIT} limit`;
    }

    return {
      provider: this.ollamaAvailable ? provider : 'claude',
      tokenCount,
      ollamaAvailable: this.ollamaAvailable,
      reason
    };
  }
}

// Singleton instance
let tokenRouterInstance: TokenRouter | null = null;

export function getTokenRouter(): TokenRouter {
  if (!tokenRouterInstance) {
    tokenRouterInstance = new TokenRouter();
  }
  return tokenRouterInstance;
}

export function resetTokenRouter(): void {
  tokenRouterInstance = null;
}
