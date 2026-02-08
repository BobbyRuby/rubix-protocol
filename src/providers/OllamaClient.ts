/**
 * OllamaClient - Local LLM provider via Ollama
 *
 * Ollama provides a simple REST API for local model inference.
 * Default endpoint: http://localhost:11434
 *
 * Recommended models for 10GB VRAM:
 * - qwen2.5-coder:7b (excellent for code, ~5GB)
 * - deepseek-coder:6.7b (good for code)
 * - codellama:13b-q4 (Meta's coding model)
 */

import type { LLMClient, Message, LLMResponse, ProviderConfig, GenerateOptions } from './types.js';

interface OllamaChatRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  stream: boolean;
  options?: {
    num_predict?: number;
    temperature?: number;
    stop?: string[];
  };
}

interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: {
    role: string;
    content: string;
  };
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

export class OllamaClient implements LLMClient {
  private endpoint: string;
  private model: string;

  readonly supportsTools = false;  // Ollama doesn't support Anthropic-style tools
  readonly supportsExtendedThinking = false;

  constructor(config: ProviderConfig) {
    this.endpoint = config.apiEndpoint || 'http://localhost:11434';
    this.model = config.model;
  }

  async generate(messages: Message[], options?: GenerateOptions): Promise<LLMResponse> {
    const request: OllamaChatRequest = {
      model: this.model,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content
      })),
      stream: false,
      options: {
        num_predict: options?.maxTokens,
        temperature: options?.temperature,
        stop: options?.stopSequences
      }
    };

    try {
      const response = await fetch(`${this.endpoint}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ollama API error ${response.status}: ${errorText}`);
      }

      const data = await response.json() as OllamaChatResponse;

      return {
        content: data.message.content,
        stopReason: 'end_turn',
        usage: {
          inputTokens: data.prompt_eval_count || 0,
          outputTokens: data.eval_count || 0
        }
      };
    } catch (error) {
      if (error instanceof Error) {
        // Check if Ollama is not running
        if (error.message.includes('ECONNREFUSED') || error.message.includes('fetch failed')) {
          throw new Error(`Ollama not running at ${this.endpoint}. Start with: ollama serve`);
        }
        throw error;
      }
      throw new Error(`Ollama error: ${String(error)}`);
    }
  }

  /**
   * Check if Ollama is available and the model is loaded
   */
  async healthCheck(): Promise<{ available: boolean; modelLoaded: boolean; error?: string }> {
    try {
      // Check if Ollama is running
      const tagsResponse = await fetch(`${this.endpoint}/api/tags`);
      if (!tagsResponse.ok) {
        return { available: false, modelLoaded: false, error: 'Ollama not responding' };
      }

      const tags = await tagsResponse.json() as { models?: Array<{ name: string }> };
      const models = tags.models || [];
      const modelLoaded = models.some(m => m.name === this.model || m.name.startsWith(this.model));

      return {
        available: true,
        modelLoaded,
        error: modelLoaded ? undefined : `Model ${this.model} not found. Run: ollama pull ${this.model}`
      };
    } catch (error) {
      return {
        available: false,
        modelLoaded: false,
        error: `Cannot connect to Ollama at ${this.endpoint}`
      };
    }
  }
}
