# Providers Documentation

The providers system provides a unified abstraction layer for LLM integrations.

## Overview

```mermaid
graph TB
    subgraph "Provider Abstraction"
        PF[ProviderFactory]
        PI[Provider Interface]
    end

    subgraph "Implementations"
        CLAUDE[Claude API<br/>Anthropic]
        OLLAMA[OllamaClient<br/>Local LLM]
        OPENAI[OpenAI<br/>Embeddings]
    end

    subgraph "Consumers"
        CG[CodeGenerator]
        LC[LLMCompressor]
        ME[MemoryEngine]
    end

    PF --> PI
    PI --> CLAUDE
    PI --> OLLAMA
    PI --> OPENAI

    CG --> PF
    LC --> PF
    ME --> OPENAI
```

## File Reference

| File | Lines | Purpose |
|------|-------|---------|
| [ProviderFactory](provider-factory.md) | ~150 | Provider creation and management |
| [OllamaClient](ollama-client.md) | ~200 | Local LLM integration |
| [types.ts](types.md) | ~100 | Provider type definitions |

## Provider Interface

```typescript
interface LLMProvider {
  // Generate completion
  complete(prompt: string, options?: CompletionOptions): Promise<string>;

  // Check availability
  isAvailable(): boolean;

  // Get provider name
  getName(): string;

  // Get model info
  getModelInfo(): ModelInfo;
}

interface CompletionOptions {
  maxTokens?: number;
  temperature?: number;
  stopSequences?: string[];
  systemPrompt?: string;
}
```

## Available Providers

### Claude (Anthropic)

Primary provider for code generation and complex reasoning:

```typescript
const claude = ProviderFactory.createClaude({
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: 'claude-opus-4-5-20251101',
  maxTokens: 8192
});

const response = await claude.complete(prompt, {
  systemPrompt: 'You are a code generation expert.',
  temperature: 0.7
});
```

### Ollama (Local)

Fallback provider for local LLM inference:

```typescript
const ollama = ProviderFactory.createOllama({
  endpoint: 'http://localhost:11434',
  model: 'qwen2.5-coder:32b'
});

const response = await ollama.complete(prompt);
```

### OpenAI (Embeddings)

Used exclusively for embedding generation:

```typescript
const openai = ProviderFactory.createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  model: 'text-embedding-3-small',
  dimensions: 768
});

const embedding = await openai.embed(content);
```

## Provider Selection

```mermaid
flowchart TD
    A[Request] --> B{Task Type?}

    B -->|Code Generation| C[Claude Primary]
    B -->|Compression| D[Claude Primary]
    B -->|Embedding| E[OpenAI]

    C --> F{Available?}
    F -->|Yes| G[Use Claude]
    F -->|No/Rate Limited| H[Fallback to Ollama]

    D --> I{Available?}
    I -->|Yes| J[Use Claude]
    I -->|No| K[Fallback to Ollama]

    H --> L{Ollama Available?}
    L -->|Yes| M[Use Ollama]
    L -->|No| N[Error/Queue]
```

## Configuration

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `ANTHROPIC_API_KEY` | - | Claude API authentication |
| `OPENAI_API_KEY` | - | OpenAI API for embeddings |
| `OLLAMA_ENDPOINT` | `http://localhost:11434` | Local Ollama server |
| `OLLAMA_MODEL` | `qwen2.5-coder:32b` | Default Ollama model |
| `RUBIX_MODEL` | `claude-opus-4-5-20251101` | Claude model for RUBIX |

### Provider Priority

```typescript
const providerConfig = {
  primary: 'claude',
  fallback: ['ollama'],
  embeddings: 'openai',

  claude: {
    model: 'claude-opus-4-5-20251101',
    maxTokens: 8192,
    rateLimitRetries: 3
  },

  ollama: {
    endpoint: 'http://localhost:11434',
    model: 'qwen2.5-coder:32b',
    timeout: 120000
  },

  openai: {
    model: 'text-embedding-3-small',
    dimensions: 768
  }
};
```

## Rate Limiting

```mermaid
flowchart TD
    A[API Request] --> B{Rate Limited?}
    B -->|No| C[Execute]
    B -->|Yes| D[Wait]

    D --> E{Retries Left?}
    E -->|Yes| F[Retry after delay]
    E -->|No| G[Fallback to Ollama]

    F --> B
    G --> H{Ollama Available?}
    H -->|Yes| I[Execute on Ollama]
    H -->|No| J[Queue for later]
```

### Rate Limit Handling

```typescript
async function withRateLimitHandling<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3
): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (error.status === 429) {
        const waitMs = Math.pow(2, attempt) * 60000; // Exponential backoff
        await delay(waitMs);
        continue;
      }
      throw error;
    }
  }

  throw new Error('Max retries exceeded');
}
```

## Provider Metrics

```typescript
interface ProviderMetrics {
  requests: number;
  successes: number;
  failures: number;
  rateLimits: number;
  avgLatencyMs: number;
  tokensUsed: number;
}

// Get metrics
const metrics = provider.getMetrics();
console.log(`Success rate: ${(metrics.successes / metrics.requests * 100).toFixed(1)}%`);
```

## Usage in RUBIX

```typescript
// CodeGenerator uses Claude with Ollama fallback
class CodeGenerator {
  private provider: LLMProvider;

  constructor() {
    this.provider = ProviderFactory.create({
      primary: 'claude',
      fallback: 'ollama'
    });
  }

  async generate(prompt: string): Promise<CodeGenResult> {
    const response = await this.provider.complete(prompt, {
      maxTokens: 8192,
      systemPrompt: CODE_GEN_SYSTEM_PROMPT
    });

    return this.parseResponse(response);
  }
}
```

## Next Steps

- [ProviderFactory](provider-factory.md) - Factory implementation
- [OllamaClient](ollama-client.md) - Local LLM details
- [Types](types.md) - Type definitions
