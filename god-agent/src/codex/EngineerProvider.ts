/**
 * EngineerProvider - Provider-agnostic interface for code generation.
 *
 * Allows ParallelEngineer to use either Claude or Ollama for code generation,
 * enabling flexible deployment options and cost optimization.
 */

import Anthropic from '@anthropic-ai/sdk';

/**
 * Engineer function signature - takes a prompt, returns generated code.
 */
export type EngineerFn = (prompt: string) => Promise<string>;

/**
 * Factory for creating engineer functions.
 */
export interface EngineerProvider {
  /** Create an engineer function for this provider */
  createEngineer(): EngineerFn;

  /** Check if provider is available */
  isAvailable(): Promise<boolean>;

  /** Provider name for logging */
  readonly name: string;
}

/**
 * Claude engineer provider (existing behavior).
 */
export class ClaudeEngineerProvider implements EngineerProvider {
  readonly name = 'claude';

  constructor(
    private apiKey: string,
    private model: string = 'claude-sonnet-4-20250514'
  ) {}

  async isAvailable(): Promise<boolean> {
    return !!this.apiKey;
  }

  createEngineer(): EngineerFn {
    const client = new Anthropic({ apiKey: this.apiKey });
    const model = this.model;

    return async (prompt: string): Promise<string> => {
      const response = await client.messages.create({
        model,
        max_tokens: 8192,
        messages: [{ role: 'user', content: prompt }]
      });

      const textBlock = response.content.find(b => b.type === 'text');
      return textBlock?.type === 'text' ? textBlock.text : '';
    };
  }
}

/**
 * Ollama engineer provider with explicit instruction formatting.
 *
 * Configured for cloud Ollama API with support for parallel requests.
 */
export class OllamaEngineerProvider implements EngineerProvider {
  readonly name = 'ollama';

  constructor(
    private endpoint: string = 'https://ollama.com/api',
    private model: string = 'qwen3-coder:480b-cloud',
    private apiKey?: string,
    private timeout: number = 120000  // 2 min timeout for cloud latency
  ) {}

  async isAvailable(): Promise<boolean> {
    if (!this.endpoint) {
      return false;
    }

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);  // 10s health check

      try {
        const res = await fetch(`${this.endpoint}/api/tags`, {
          headers,
          signal: controller.signal
        });
        return res.ok;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch {
      return false;
    }
  }

  createEngineer(): EngineerFn {
    const endpoint = this.endpoint;
    const model = this.model;
    const apiKey = this.apiKey;
    const timeout = this.timeout;
    const toExplicitFormat = this.toExplicitFormat.bind(this);

    return async (prompt: string): Promise<string> => {
      const explicitPrompt = toExplicitFormat(prompt);
      console.log(`[Ollama] Generating with ${model}...`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      // Build headers with optional API key auth
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      try {
        const response = await fetch(`${endpoint}/api/generate`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model,
            prompt: explicitPrompt,
            stream: false,
            options: { num_predict: 8192 }
          }),
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json() as { response?: string };
        return data.response || '';
      } finally {
        clearTimeout(timeoutId);
      }
    };
  }

  /**
   * Transform Claude-style prompt to explicit instructions for Qwen.
   *
   * Qwen models benefit from explicit, structured instructions.
   */
  private toExplicitFormat(prompt: string): string {
    return `# CODING TASK - EXPLICIT INSTRUCTIONS

You are a code generator. Write COMPLETE, WORKING TypeScript code.

${prompt}

CRITICAL RULES:
1. Output ONLY the <file> block
2. NO explanations before or after
3. COMPLETE code - no TODOs or placeholders
4. Include ALL imports`;
  }
}

/**
 * Error classification for smart retry decisions.
 */
type ErrorType = 'rate_limit' | 'quota_exhausted' | 'connection' | 'unknown';

/**
 * Fallback engineer provider with SMART RETRY strategy.
 *
 * Behavior by error type:
 * - Rate limit (429): Use Claude for THIS request, try Ollama again next time
 * - Quota exhausted (402): Stay on Claude permanently (won't recover)
 * - Connection errors: Try Ollama again next time (might be transient)
 * - Unknown errors: Re-throw (don't mask real problems)
 */
export class FallbackEngineerProvider implements EngineerProvider {
  readonly name: string;
  private permanentlyFallenBack = false;  // Only true for quota exhaustion

  constructor(
    private primary: EngineerProvider,
    private fallback: EngineerProvider
  ) {
    this.name = `${primary.name}→${fallback.name}`;
  }

  async isAvailable(): Promise<boolean> {
    return await this.primary.isAvailable() || await this.fallback.isAvailable();
  }

  createEngineer(): EngineerFn {
    const primaryFn = this.primary.createEngineer();
    const fallbackFn = this.fallback.createEngineer();
    const provider = this;

    return async (prompt: string): Promise<string> => {
      // If quota is exhausted, don't even try primary
      if (provider.permanentlyFallenBack) {
        console.log(`[FallbackEngineerProvider] Using ${provider.fallback.name} (quota exhausted)`);
        return fallbackFn(prompt);
      }

      try {
        return await primaryFn(prompt);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorType = provider.classifyError(errorMessage);

        switch (errorType) {
          case 'quota_exhausted':
            // Permanent - don't retry Ollama for the rest of the session
            console.log(`[FallbackEngineerProvider] ${provider.primary.name} quota exhausted: ${errorMessage}`);
            console.log(`[FallbackEngineerProvider] Switching to ${provider.fallback.name} permanently`);
            provider.permanentlyFallenBack = true;
            return fallbackFn(prompt);

          case 'rate_limit':
            // Temporary - use Claude for THIS request, try Ollama again next time
            console.log(`[FallbackEngineerProvider] ${provider.primary.name} rate limited: ${errorMessage}`);
            console.log(`[FallbackEngineerProvider] Using ${provider.fallback.name} for this request (will retry Ollama next time)`);
            return fallbackFn(prompt);

          case 'connection':
            // Transient - use Claude for THIS request, try Ollama again next time
            console.log(`[FallbackEngineerProvider] ${provider.primary.name} connection error: ${errorMessage}`);
            console.log(`[FallbackEngineerProvider] Using ${provider.fallback.name} for this request (will retry Ollama next time)`);
            return fallbackFn(prompt);

          case 'unknown':
          default:
            // Unknown error - re-throw, don't mask real problems
            throw error;
        }
      }
    };
  }

  /**
   * Classify error to determine retry strategy.
   */
  private classifyError(message: string): ErrorType {
    const lowerMessage = message.toLowerCase();

    // Quota exhaustion - PERMANENT fallback
    if (
      lowerMessage.includes('402') ||  // Payment Required
      lowerMessage.includes('quota') ||
      lowerMessage.includes('exceeded') ||
      lowerMessage.includes('billing') ||
      lowerMessage.includes('payment')
    ) {
      return 'quota_exhausted';
    }

    // Rate limit - TEMPORARY, try again next request
    if (
      lowerMessage.includes('429') ||  // Too Many Requests
      lowerMessage.includes('rate limit') ||
      lowerMessage.includes('rate-limit') ||
      lowerMessage.includes('too many requests') ||
      lowerMessage.includes('slow down')
    ) {
      return 'rate_limit';
    }

    // Connection errors - TEMPORARY, try again next request
    if (
      lowerMessage.includes('503') ||  // Service Unavailable
      lowerMessage.includes('econnrefused') ||
      lowerMessage.includes('enotfound') ||
      lowerMessage.includes('etimedout') ||
      lowerMessage.includes('abort') ||
      lowerMessage.includes('network') ||
      lowerMessage.includes('unavailable') ||
      lowerMessage.includes('overloaded') ||
      lowerMessage.includes('capacity')
    ) {
      return 'connection';
    }

    return 'unknown';
  }

  /**
   * Check if this provider has permanently fallen back (quota exhausted).
   */
  hasSwitchedToFallback(): boolean {
    return this.permanentlyFallenBack;
  }

  /**
   * Reset fallback state (for new task execution).
   */
  reset(): void {
    this.permanentlyFallenBack = false;
  }
}

/**
 * Factory function to create an engineer provider based on configuration.
 *
 * When Ollama is configured, creates a FallbackEngineerProvider that automatically
 * switches to Claude if Ollama becomes unavailable mid-execution.
 */
export async function createEngineerProvider(config: {
  provider?: 'claude' | 'ollama';
  claudeApiKey?: string;
  claudeModel?: string;
  ollamaEndpoint?: string;
  ollamaApiKey?: string;
  ollamaModel?: string;
  ollamaTimeout?: number;
}): Promise<EngineerProvider> {
  const claudeProvider = new ClaudeEngineerProvider(
    config.claudeApiKey || '',
    config.claudeModel || 'claude-sonnet-4-20250514'
  );

  const preferOllama = config.provider === 'ollama';

  if (preferOllama) {
    const ollama = new OllamaEngineerProvider(
      config.ollamaEndpoint || 'https://ollama.com/api',
      config.ollamaModel || 'qwen3-coder:480b-cloud',
      config.ollamaApiKey,
      config.ollamaTimeout || 120000
    );

    if (await ollama.isAvailable()) {
      console.log(`[EngineerProvider] Using Ollama (${ollama.name}) with Claude fallback`);
      // Wrap in FallbackEngineerProvider for automatic recovery
      return new FallbackEngineerProvider(ollama, claudeProvider);
    }

    console.log('[EngineerProvider] Ollama unavailable at startup, using Claude directly');
  }

  return claudeProvider;
}
