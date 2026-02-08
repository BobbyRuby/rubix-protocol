# OllamaClient

**File:** `src/providers/OllamaClient.ts` (~200 lines)

The OllamaClient provides integration with local Ollama LLM servers for fallback code generation and compression.

## Overview

```mermaid
graph TB
    OC[OllamaClient]

    subgraph "API Endpoints"
        GEN[/api/generate]
        CHAT[/api/chat]
        TAGS[/api/tags]
        EMBED[/api/embeddings]
    end

    subgraph "Operations"
        COMPLETE[complete]
        STREAM[stream]
        CHECK[isAvailable]
        LIST[listModels]
    end

    OC --> GEN
    OC --> CHAT
    OC --> TAGS
    OC --> EMBED

    OC --> COMPLETE
    OC --> STREAM
    OC --> CHECK
    OC --> LIST
```

## Class Structure

```typescript
class OllamaClient implements LLMProvider {
  private endpoint: string;
  private model: string;
  private timeout: number;
  private available: boolean | null;

  constructor(options: OllamaClientOptions) {
    this.endpoint = options.endpoint ?? 'http://localhost:11434';
    this.model = options.model ?? 'qwen2.5-coder:32b';
    this.timeout = options.timeout ?? 120000;
    this.available = null;
  }
}
```

## Constructor Options

```typescript
interface OllamaClientOptions {
  endpoint?: string;   // Default: 'http://localhost:11434'
  model?: string;      // Default: 'qwen2.5-coder:32b'
  timeout?: number;    // Default: 120000 (2 minutes)
}

const client = new OllamaClient({
  endpoint: 'http://localhost:11434',
  model: 'qwen2.5-coder:32b',
  timeout: 120000
});
```

## Core Methods

### complete()

```typescript
async complete(
  prompt: string,
  options?: CompletionOptions
): Promise<string> {
  const response = await this.fetch('/api/generate', {
    method: 'POST',
    body: JSON.stringify({
      model: this.model,
      prompt: this.buildPrompt(prompt, options?.systemPrompt),
      stream: false,
      options: {
        temperature: options?.temperature ?? 0.7,
        num_predict: options?.maxTokens ?? 4096,
        stop: options?.stopSequences
      }
    })
  });

  const data = await response.json();
  return data.response;
}

private buildPrompt(userPrompt: string, systemPrompt?: string): string {
  if (systemPrompt) {
    return `${systemPrompt}\n\n${userPrompt}`;
  }
  return userPrompt;
}
```

### stream()

```typescript
async *stream(
  prompt: string,
  options?: CompletionOptions
): AsyncGenerator<string> {
  const response = await this.fetch('/api/generate', {
    method: 'POST',
    body: JSON.stringify({
      model: this.model,
      prompt: this.buildPrompt(prompt, options?.systemPrompt),
      stream: true,
      options: {
        temperature: options?.temperature ?? 0.7,
        num_predict: options?.maxTokens ?? 4096
      }
    })
  });

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split('\n').filter(Boolean);

    for (const line of lines) {
      const data = JSON.parse(line);
      if (data.response) {
        yield data.response;
      }
    }
  }
}
```

### isAvailable()

```typescript
async isAvailable(): Promise<boolean> {
  // Cache result for 60 seconds
  if (this.available !== null && this.lastCheck > Date.now() - 60000) {
    return this.available;
  }

  try {
    const response = await this.fetch('/api/tags', {
      method: 'GET',
      timeout: 5000
    });

    const data = await response.json();
    const modelAvailable = data.models?.some(
      (m: any) => m.name === this.model || m.name.startsWith(this.model)
    );

    this.available = modelAvailable;
    this.lastCheck = Date.now();

    return modelAvailable;
  } catch (error) {
    this.available = false;
    this.lastCheck = Date.now();
    return false;
  }
}
```

### listModels()

```typescript
interface OllamaModel {
  name: string;
  size: number;
  digest: string;
  modified_at: string;
}

async listModels(): Promise<OllamaModel[]> {
  const response = await this.fetch('/api/tags', { method: 'GET' });
  const data = await response.json();
  return data.models ?? [];
}
```

## Chat API

### chat()

```typescript
interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

async chat(
  messages: ChatMessage[],
  options?: CompletionOptions
): Promise<string> {
  const response = await this.fetch('/api/chat', {
    method: 'POST',
    body: JSON.stringify({
      model: this.model,
      messages,
      stream: false,
      options: {
        temperature: options?.temperature ?? 0.7,
        num_predict: options?.maxTokens ?? 4096
      }
    })
  });

  const data = await response.json();
  return data.message?.content ?? '';
}
```

## Embedding Support

### embed()

```typescript
async embed(content: string): Promise<number[]> {
  const response = await this.fetch('/api/embeddings', {
    method: 'POST',
    body: JSON.stringify({
      model: this.model,
      prompt: content
    })
  });

  const data = await response.json();
  return data.embedding;
}
```

## HTTP Handling

### fetch()

```typescript
private async fetch(
  path: string,
  options: RequestInit & { timeout?: number }
): Promise<Response> {
  const controller = new AbortController();
  const timeout = options.timeout ?? this.timeout;

  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(`${this.endpoint}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }

    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}
```

## Error Handling

```typescript
class OllamaError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly endpoint?: string
  ) {
    super(message);
    this.name = 'OllamaError';
  }
}

// In fetch method
if (!response.ok) {
  throw new OllamaError(
    `Ollama API error: ${response.status}`,
    response.status,
    path
  );
}
```

## Model Management

### pullModel()

```typescript
async pullModel(modelName: string): Promise<void> {
  const response = await this.fetch('/api/pull', {
    method: 'POST',
    body: JSON.stringify({ name: modelName }),
    timeout: 600000 // 10 minutes for large models
  });

  // Stream progress
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split('\n').filter(Boolean);

    for (const line of lines) {
      const data = JSON.parse(line);
      if (data.status) {
        console.log(`Pull progress: ${data.status}`);
      }
    }
  }
}
```

### setModel()

```typescript
setModel(model: string): void {
  this.model = model;
  this.available = null; // Reset availability cache
}
```

## Provider Interface Implementation

```typescript
// LLMProvider interface implementation
getName(): string {
  return `ollama:${this.model}`;
}

getModelInfo(): ModelInfo {
  return {
    provider: 'ollama',
    model: this.model,
    endpoint: this.endpoint,
    capabilities: ['completion', 'chat', 'embedding']
  };
}
```

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `endpoint` | string | `http://localhost:11434` | Ollama server URL |
| `model` | string | `qwen2.5-coder:32b` | Default model |
| `timeout` | number | `120000` | Request timeout (ms) |

## Recommended Models

| Model | Size | Use Case |
|-------|------|----------|
| `qwen2.5-coder:32b` | 32B | Code generation (best quality) |
| `qwen2.5-coder:7b` | 7B | Code generation (faster) |
| `codellama:34b` | 34B | Code generation |
| `mistral:7b` | 7B | General purpose |
| `nomic-embed-text` | 274M | Embeddings |

## Usage Example

```typescript
const client = new OllamaClient({
  endpoint: 'http://localhost:11434',
  model: 'qwen2.5-coder:32b'
});

// Check availability
if (await client.isAvailable()) {
  // Generate completion
  const response = await client.complete(
    'Write a function to validate email addresses',
    {
      systemPrompt: 'You are a TypeScript expert.',
      temperature: 0.7,
      maxTokens: 2048
    }
  );

  console.log(response);
}

// List available models
const models = await client.listModels();
console.log('Available models:', models.map(m => m.name));

// Stream response
for await (const chunk of client.stream('Explain async/await')) {
  process.stdout.write(chunk);
}
```

## Integration with LLMCompressor

```typescript
// In LLMCompressor
async compressWithOllama(content: string): Promise<string> {
  const response = await this.ollamaClient.complete(
    this.buildCompressionPrompt(content),
    {
      temperature: 0.3,  // Lower for consistent compression
      maxTokens: 1024
    }
  );

  return response.trim();
}
```

## Next Steps

- [ProviderFactory](provider-factory.md) - Provider creation
- [Types](types.md) - Type definitions
- [Providers Overview](index.md) - System overview
