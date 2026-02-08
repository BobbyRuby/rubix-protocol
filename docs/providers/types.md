# Provider Types

**File:** `src/providers/types.ts` (~100 lines)

Type definitions for the provider abstraction layer.

## Provider Interface

```typescript
/**
 * Common interface for all LLM providers
 */
interface LLMProvider {
  /**
   * Generate a completion for the given prompt
   */
  complete(prompt: string, options?: CompletionOptions): Promise<string>;

  /**
   * Check if the provider is currently available
   */
  isAvailable(): boolean | Promise<boolean>;

  /**
   * Get the provider name
   */
  getName(): string;

  /**
   * Get model information
   */
  getModelInfo(): ModelInfo;
}
```

## Completion Options

```typescript
/**
 * Options for completion requests
 */
interface CompletionOptions {
  /**
   * Maximum tokens to generate
   * @default 4096
   */
  maxTokens?: number;

  /**
   * Sampling temperature (0-1)
   * @default 0.7
   */
  temperature?: number;

  /**
   * Stop sequences to end generation
   */
  stopSequences?: string[];

  /**
   * System prompt to prepend
   */
  systemPrompt?: string;

  /**
   * Top-p sampling parameter
   * @default 1.0
   */
  topP?: number;

  /**
   * Frequency penalty
   * @default 0
   */
  frequencyPenalty?: number;

  /**
   * Presence penalty
   * @default 0
   */
  presencePenalty?: number;
}
```

## Model Information

```typescript
/**
 * Information about a model
 */
interface ModelInfo {
  /**
   * Provider name (claude, ollama, openai)
   */
  provider: string;

  /**
   * Model identifier
   */
  model: string;

  /**
   * Endpoint URL (for local models)
   */
  endpoint?: string;

  /**
   * Model capabilities
   */
  capabilities: ModelCapability[];

  /**
   * Context window size
   */
  contextWindow?: number;

  /**
   * Maximum output tokens
   */
  maxOutput?: number;
}

type ModelCapability =
  | 'completion'
  | 'chat'
  | 'embedding'
  | 'vision'
  | 'function_calling'
  | 'streaming';
```

## Provider Configuration

```typescript
/**
 * Global provider configuration
 */
interface ProviderConfig {
  /**
   * Claude/Anthropic configuration
   */
  claude?: ClaudeConfig;

  /**
   * Ollama configuration
   */
  ollama?: OllamaConfig;

  /**
   * OpenAI configuration
   */
  openai?: OpenAIConfig;

  /**
   * Default provider to use
   * @default 'claude'
   */
  defaultProvider?: 'claude' | 'ollama';

  /**
   * Fallback provider order
   * @default ['ollama']
   */
  fallbackOrder?: string[];
}

interface ClaudeConfig {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  baseUrl?: string;
}

interface OllamaConfig {
  endpoint?: string;
  model?: string;
  timeout?: number;
}

interface OpenAIConfig {
  apiKey: string;
  model?: string;
  dimensions?: number;
  baseUrl?: string;
}
```

## Chat Types

```typescript
/**
 * Chat message for conversation APIs
 */
interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Chat completion request
 */
interface ChatRequest {
  messages: ChatMessage[];
  options?: CompletionOptions;
}

/**
 * Chat completion response
 */
interface ChatResponse {
  message: ChatMessage;
  usage?: TokenUsage;
  finishReason?: FinishReason;
}

type FinishReason =
  | 'stop'
  | 'length'
  | 'content_filter'
  | 'tool_calls';
```

## Embedding Types

```typescript
/**
 * Embedding request
 */
interface EmbeddingRequest {
  input: string | string[];
  model?: string;
  dimensions?: number;
}

/**
 * Embedding response
 */
interface EmbeddingResponse {
  embeddings: number[][];
  model: string;
  usage?: TokenUsage;
}
```

## Token Usage

```typescript
/**
 * Token usage statistics
 */
interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}
```

## Error Types

```typescript
/**
 * Provider error base class
 */
class ProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly code?: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/**
 * Rate limit error
 */
class RateLimitError extends ProviderError {
  constructor(
    provider: string,
    public readonly retryAfter?: number
  ) {
    super('Rate limit exceeded', provider, 'RATE_LIMIT', 429);
    this.name = 'RateLimitError';
  }
}

/**
 * Provider unavailable error
 */
class ProviderUnavailableError extends ProviderError {
  constructor(provider: string, reason?: string) {
    super(
      `Provider ${provider} is unavailable${reason ? `: ${reason}` : ''}`,
      provider,
      'UNAVAILABLE',
      503
    );
    this.name = 'ProviderUnavailableError';
  }
}
```

## Health Check Types

```typescript
/**
 * Health check result
 */
interface HealthCheckResult {
  healthy: boolean;
  providers: ProviderHealth[];
  timestamp: number;
}

/**
 * Individual provider health
 */
interface ProviderHealth {
  provider: string;
  status: 'healthy' | 'unhealthy' | 'unavailable';
  latencyMs?: number;
  error?: string;
}
```

## Metrics Types

```typescript
/**
 * Provider metrics
 */
interface ProviderMetrics {
  requests: number;
  successes: number;
  failures: number;
  rateLimits: number;
  avgLatencyMs: number;
  tokensUsed: number;
  lastRequest?: number;
}
```

## Streaming Types

```typescript
/**
 * Streaming response chunk
 */
interface StreamChunk {
  content: string;
  done: boolean;
  usage?: TokenUsage;
}

/**
 * Streaming provider interface
 */
interface StreamingProvider extends LLMProvider {
  stream(
    prompt: string,
    options?: CompletionOptions
  ): AsyncGenerator<StreamChunk>;
}
```

## Usage Example

```typescript
import {
  LLMProvider,
  CompletionOptions,
  ChatMessage,
  ProviderError
} from './types';

class MyProvider implements LLMProvider {
  async complete(
    prompt: string,
    options?: CompletionOptions
  ): Promise<string> {
    // Implementation
  }

  isAvailable(): boolean {
    return true;
  }

  getName(): string {
    return 'my-provider';
  }

  getModelInfo(): ModelInfo {
    return {
      provider: 'my-provider',
      model: 'my-model',
      capabilities: ['completion', 'chat']
    };
  }
}
```

## Type Guards

```typescript
/**
 * Check if error is a rate limit error
 */
function isRateLimitError(error: unknown): error is RateLimitError {
  return error instanceof RateLimitError;
}

/**
 * Check if provider supports streaming
 */
function isStreamingProvider(
  provider: LLMProvider
): provider is StreamingProvider {
  return 'stream' in provider && typeof provider.stream === 'function';
}
```

## Next Steps

- [ProviderFactory](provider-factory.md) - Provider creation
- [OllamaClient](ollama-client.md) - Local LLM implementation
- [Providers Overview](index.md) - System overview
