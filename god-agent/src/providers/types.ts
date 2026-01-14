/**
 * Multi-Provider Types
 *
 * Abstraction layer for multiple LLM providers:
 * - Claude (Anthropic)
 * - Ollama (local models)
 * - OpenAI (future)
 */

export type Provider = 'claude' | 'openai' | 'ollama';

export interface ProviderConfig {
  provider: Provider;
  model: string;
  apiKey?: string;
  apiEndpoint?: string;  // For Ollama: http://localhost:11434
  maxTokens?: number;
}

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface GenerateOptions {
  maxTokens?: number;
  temperature?: number;
  stopSequences?: string[];
}

export interface LLMResponse {
  content: string;
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens';
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface LLMClient {
  generate(messages: Message[], options?: GenerateOptions): Promise<LLMResponse>;
  readonly supportsTools: boolean;
  readonly supportsExtendedThinking: boolean;
}

// Department fallback configuration
export type FallbackStrategy = 'cloud-only' | 'cloud-with-fallback';

export interface DepartmentConfig {
  primary: ProviderConfig;
  fallback?: ProviderConfig;  // Only for cloud-with-fallback
  strategy: FallbackStrategy;
}
