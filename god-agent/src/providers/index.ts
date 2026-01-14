/**
 * Multi-Provider Module
 *
 * Provides abstraction layer for multiple LLM providers with fallback support.
 */

export { ProviderFactory, OllamaClient } from './ProviderFactory.js';
export type {
  Provider,
  ProviderConfig,
  Message,
  GenerateOptions,
  LLMResponse,
  LLMClient,
  FallbackStrategy,
  DepartmentConfig
} from './types.js';
