/**
 * LLMCompressor - Semantic compression using LLM
 *
 * Uses Claude (Opus) or Ollama to compress content semantically.
 * Unlike regex-based compression, this preserves full meaning.
 *
 * Principle: "Prompts need to be purely efficient, no bullshit,
 * no NLP strings... Fully tokenized without loss of meaning"
 */

import Anthropic from '@anthropic-ai/sdk';
import { OllamaClient } from '../providers/OllamaClient.js';
import type { ProviderConfig, Message } from '../providers/types.js';

export interface LLMCompressorConfig {
  anthropicApiKey?: string;
  model?: string;
  ollamaConfig?: ProviderConfig;
}

export class LLMCompressor {
  private anthropic: Anthropic | null = null;
  private ollama: OllamaClient | null = null;
  private model: string = 'claude-opus-4-5-20251101';
  private ollamaAvailable = false;

  constructor(config: LLMCompressorConfig) {
    // Primary: Anthropic (Opus)
    if (config.anthropicApiKey) {
      this.anthropic = new Anthropic({ apiKey: config.anthropicApiKey });
      this.model = config.model || 'claude-opus-4-5-20251101';
      console.log(`[LLMCompressor] Anthropic initialized with model: ${this.model}`);
    }

    // Fallback: Ollama
    if (config.ollamaConfig) {
      this.ollama = new OllamaClient(config.ollamaConfig);
      this.checkOllamaAvailability();
    }
  }

  /**
   * Check if Ollama is available and model is loaded.
   */
  private async checkOllamaAvailability(): Promise<void> {
    if (!this.ollama) return;
    try {
      const health = await this.ollama.healthCheck();
      this.ollamaAvailable = health.available && health.modelLoaded;
      if (this.ollamaAvailable) {
        console.log('[LLMCompressor] Ollama available and model loaded');
      } else {
        console.log(`[LLMCompressor] Ollama not ready: ${health.error}`);
      }
    } catch (error) {
      console.log(`[LLMCompressor] Ollama check failed: ${error}`);
      this.ollamaAvailable = false;
    }
  }

  /**
   * Compress content to semantic tokens.
   * Claude extracts pure meaning, strips all filler.
   */
  async compress(content: string): Promise<string> {
    // Skip compression for very short content
    if (content.length < 50) {
      return content;
    }

    const prompt = COMPRESSION_PROMPT.replace('{CONTENT}', content);

    // Try Anthropic first (Opus)
    if (this.anthropic) {
      try {
        const response = await this.anthropic.messages.create({
          model: this.model,
          max_tokens: 1024,
          messages: [{ role: 'user', content: prompt }]
        });
        const text = response.content[0];
        if (text.type === 'text') {
          const compressed = text.text.trim();
          // Use compressed if it's any shorter
          if (compressed.length < content.length) {
            console.log(`[LLMCompressor] Compressed ${content.length} → ${compressed.length} chars (${Math.round((1 - compressed.length / content.length) * 100)}% reduction)`);
            return compressed;
          }
        }
        return content;
      } catch (error) {
        console.warn('[LLMCompressor] Anthropic failed, trying Ollama:', error);
      }
    }

    // Fallback to Ollama
    if (this.ollama && this.ollamaAvailable) {
      try {
        const messages: Message[] = [{ role: 'user', content: prompt }];
        const response = await this.ollama.generate(messages, { maxTokens: 1024 });
        const compressed = response.content.trim();
        if (compressed.length < content.length) {
          console.log(`[LLMCompressor] Ollama compressed ${content.length} → ${compressed.length} chars (${Math.round((1 - compressed.length / content.length) * 100)}% reduction)`);
          return compressed;
        }
        return content;
      } catch (error) {
        console.warn('[LLMCompressor] Ollama failed:', error);
      }
    }

    // No provider available - return original
    console.warn('[LLMCompressor] No LLM provider available, storing uncompressed');
    return content;
  }

  /**
   * Decompress semantic tokens to full meaning.
   * Claude expands tokens to human-readable form.
   */
  async decompress(compressed: string): Promise<string> {
    // Skip decompression for content that doesn't look compressed
    if (!this.looksCompressed(compressed)) {
      return compressed;
    }

    const prompt = DECOMPRESSION_PROMPT.replace('{COMPRESSED}', compressed);

    // Try Anthropic first
    if (this.anthropic) {
      try {
        const response = await this.anthropic.messages.create({
          model: this.model,
          max_tokens: 2048,
          messages: [{ role: 'user', content: prompt }]
        });
        const text = response.content[0];
        if (text.type === 'text') {
          return text.text.trim();
        }
        return compressed;
      } catch (error) {
        console.warn('[LLMCompressor] Anthropic decompression failed, trying Ollama:', error);
      }
    }

    // Fallback to Ollama
    if (this.ollama && this.ollamaAvailable) {
      try {
        const messages: Message[] = [{ role: 'user', content: prompt }];
        const response = await this.ollama.generate(messages, { maxTokens: 2048 });
        return response.content.trim();
      } catch (error) {
        console.warn('[LLMCompressor] Ollama decompression failed:', error);
      }
    }

    // Return as-is if decompression fails
    return compressed;
  }

  /**
   * Check if content looks like it was compressed.
   */
  private looksCompressed(content: string): boolean {
    // Check for pipe-delimited format
    if (content.includes('|')) {
      const segments = content.split('|');
      if (segments.length >= 2 && segments.every(s => s.length < 100)) {
        return true;
      }
    }
    // Check for arrow sequences
    if (content.includes('→') && content.length < 500) {
      return true;
    }
    // Check for KEY:value format
    if (/^[A-Z]+:/.test(content)) {
      return true;
    }
    return false;
  }

  /**
   * Check if any LLM provider is available.
   */
  isAvailable(): boolean {
    return !!this.anthropic || this.ollamaAvailable;
  }

  /**
   * Get status of available providers.
   */
  getStatus(): { anthropic: boolean; ollama: boolean; model: string } {
    return {
      anthropic: !!this.anthropic,
      ollama: this.ollamaAvailable,
      model: this.model
    };
  }
}

const COMPRESSION_PROMPT = `You are a semantic compression engine. Extract the pure meaning from this content using minimal tokens.

Rules:
- Strip ALL filler words (the, a, an, please, basically, actually, etc.)
- Strip ALL NLP pleasantries
- Keep ONLY semantic content that carries meaning
- Use abbreviations for common patterns:
  - comp = component
  - cfg = configuration/config
  - fn = function
  - impl = implementation
  - req = request/requirement
  - res = response
  - err = error
  - msg = message
- Use | as delimiter between distinct fields/concepts
- Use → for flows/sequences/causation
- Use . for lists within a field (A.B.C)
- Preserve technical terms, names, paths, and specific values exactly
- Format: TYPE|KEY_INFO|DETAILS|CONTEXT (adapt as needed)

Content to compress:
{CONTENT}

Output ONLY the compressed tokens. No explanation, no meta-commentary.`;

const DECOMPRESSION_PROMPT = `You are a semantic decompression engine. Expand these compressed tokens to full human-readable meaning.

Rules:
- Expand ALL abbreviations to full words
- Restore natural language structure with proper grammar
- Preserve ALL semantic meaning - nothing should be lost
- Output clear, professional prose
- Maintain technical accuracy
- Do NOT add information that wasn't in the original

Compressed tokens:
{COMPRESSED}

Output ONLY the expanded human-readable text. No meta-commentary.`;

// Singleton for convenience
let instance: LLMCompressor | null = null;

export function getLLMCompressor(config?: LLMCompressorConfig): LLMCompressor {
  if (!instance && config) {
    instance = new LLMCompressor(config);
  }
  if (!instance) {
    throw new Error('LLMCompressor not initialized. Call with config first.');
  }
  return instance;
}

export function resetLLMCompressor(): void {
  instance = null;
}
