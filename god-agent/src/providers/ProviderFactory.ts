/**
 * ProviderFactory - Creates LLM clients for different providers
 *
 * Supports:
 * - claude: Anthropic Claude models (via existing SDK)
 * - ollama: Local models via Ollama
 * - openai: OpenAI GPT models (future)
 */

import { OllamaClient } from './OllamaClient.js';
import type { LLMClient, ProviderConfig } from './types.js';

export class ProviderFactory {
  private static clients: Map<string, LLMClient> = new Map();

  /**
   * Create or get cached client for a provider config
   */
  static createClient(config: ProviderConfig): LLMClient {
    const cacheKey = `${config.provider}:${config.model}:${config.apiEndpoint || 'default'}`;

    // Return cached client if exists
    const cached = this.clients.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Create new client
    let client: LLMClient;

    switch (config.provider) {
      case 'ollama':
        client = new OllamaClient(config);
        break;

      case 'claude':
        // For Claude, we don't create a wrapper - SubAgentSpawner uses CLI directly
        // This is a placeholder that throws if someone tries to use it directly
        throw new Error(
          'Claude provider uses CLI spawning, not direct API. ' +
          'Use SubAgentSpawner.spawnClaudeCLI() instead.'
        );

      case 'openai':
        throw new Error('OpenAI provider not yet implemented');

      default:
        throw new Error(`Unknown provider: ${config.provider}`);
    }

    this.clients.set(cacheKey, client);
    return client;
  }

  /**
   * Check if a provider is available
   */
  static async checkAvailability(config: ProviderConfig): Promise<{
    available: boolean;
    error?: string;
  }> {
    switch (config.provider) {
      case 'ollama': {
        const client = new OllamaClient(config);
        const health = await client.healthCheck();
        return {
          available: health.available && health.modelLoaded,
          error: health.error
        };
      }

      case 'claude':
        // Claude availability depends on API key being set
        return {
          available: !!config.apiKey,
          error: config.apiKey ? undefined : 'ANTHROPIC_API_KEY not set'
        };

      case 'openai':
        return {
          available: false,
          error: 'OpenAI provider not yet implemented'
        };

      default:
        return {
          available: false,
          error: `Unknown provider: ${config.provider}`
        };
    }
  }

  /**
   * Clear cached clients (for testing or reconfiguration)
   */
  static clearCache(): void {
    this.clients.clear();
  }
}

// Export types for convenience
export type { LLMClient, ProviderConfig, Message, LLMResponse, GenerateOptions } from './types.js';
export { OllamaClient } from './OllamaClient.js';
