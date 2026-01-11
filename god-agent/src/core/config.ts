/**
 * Configuration
 *
 * Default configuration and environment variable loading for God Agent.
 */

import { config as loadDotenv } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { MemoryEngineConfig, HNSWConfig, EmbeddingConfig, StorageConfig, LScoreConfig, CodexLLMConfig } from './types.js';

// Get the directory where this module is located
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env file from god-agent root (two levels up from src/core/ or dist/core/)
const godAgentRoot = join(__dirname, '..', '..');
const envPath = join(godAgentRoot, '.env');
console.log(`[Config] Module dir: ${__dirname}`);
console.log(`[Config] God-agent root: ${godAgentRoot}`);
console.log(`[Config] Loading .env from: ${envPath}`);
console.log(`[Config] process.cwd(): ${process.cwd()}`);

const dotenvResult = loadDotenv({ path: envPath });
console.log(`[Config] dotenv result: ${JSON.stringify(dotenvResult)}`);

export function getDefaultConfig(dataDir?: string): MemoryEngineConfig {
  const baseDir = dataDir ?? process.env.GOD_AGENT_DATA_DIR ?? './data';

  const hnswConfig: HNSWConfig = {
    maxElements: parseInt(process.env.GOD_AGENT_HNSW_MAX_ELEMENTS ?? '100000', 10),
    efConstruction: parseInt(process.env.GOD_AGENT_HNSW_EF_CONSTRUCTION ?? '200', 10),
    efSearch: parseInt(process.env.GOD_AGENT_HNSW_EF_SEARCH ?? '100', 10),
    M: parseInt(process.env.GOD_AGENT_HNSW_M ?? '16', 10),
    spaceName: 'cosine'
  };

  const embeddingConfig: EmbeddingConfig = {
    provider: 'openai',
    model: process.env.GOD_AGENT_EMBEDDING_MODEL ?? 'text-embedding-3-small',
    dimensions: parseInt(process.env.GOD_AGENT_EMBEDDING_DIMENSIONS ?? '768', 10),
    apiKey: process.env.OPENAI_API_KEY,
    batchSize: 100
  };

  const storageConfig: StorageConfig = {
    sqlitePath: join(baseDir, 'memory.db'),
    indexPath: join(baseDir, 'vectors.hnsw'),
    enableWAL: true
  };

  const lScoreConfig: LScoreConfig = {
    depthDecay: parseFloat(process.env.GOD_AGENT_LSCORE_DECAY ?? '0.9'),
    minScore: parseFloat(process.env.GOD_AGENT_LSCORE_MIN ?? '0.01'),
    threshold: parseFloat(process.env.GOD_AGENT_LSCORE_THRESHOLD ?? '0.3'),
    enforceThreshold: process.env.GOD_AGENT_ENFORCE_LSCORE_THRESHOLD !== 'false'
  };

  return {
    dataDir: baseDir,
    vectorDimensions: embeddingConfig.dimensions,
    hnswConfig,
    embeddingConfig,
    storageConfig,
    lScoreConfig
  };
}

export function validateConfig(config: MemoryEngineConfig): string[] {
  const errors: string[] = [];

  if (!config.embeddingConfig.apiKey) {
    errors.push('OPENAI_API_KEY environment variable is required');
  }

  if (config.vectorDimensions <= 0) {
    errors.push('vectorDimensions must be positive');
  }

  if (config.hnswConfig.maxElements <= 0) {
    errors.push('hnswConfig.maxElements must be positive');
  }

  if (config.lScoreConfig.depthDecay <= 0 || config.lScoreConfig.depthDecay > 1) {
    errors.push('lScoreConfig.depthDecay must be between 0 and 1');
  }

  if (config.lScoreConfig.threshold < 0 || config.lScoreConfig.threshold > 1) {
    errors.push('lScoreConfig.threshold must be between 0 and 1');
  }

  return errors;
}

export function mergeConfig(
  base: MemoryEngineConfig,
  overrides: Partial<MemoryEngineConfig>
): MemoryEngineConfig {
  return {
    ...base,
    ...overrides,
    hnswConfig: { ...base.hnswConfig, ...overrides.hnswConfig },
    embeddingConfig: { ...base.embeddingConfig, ...overrides.embeddingConfig },
    storageConfig: { ...base.storageConfig, ...overrides.storageConfig },
    lScoreConfig: { ...base.lScoreConfig, ...overrides.lScoreConfig }
  };
}

/**
 * Get RUBIX LLM configuration for code generation
 *
 * Environment variables:
 * - ANTHROPIC_API_KEY: Required API key for Claude
 * - CODEX_MODEL: Claude model to use (default: claude-opus-4-5-20251101)
 * - CODEX_MAX_TOKENS: Max generation tokens (default: 8192)
 * - CODEX_ULTRATHINK: Enable ultrathink (default: true)
 * - CODEX_THINK_BASE: Base thinking budget tokens (default: 5000)
 * - CODEX_THINK_INCREMENT: Additional tokens per retry (default: 5000)
 * - CODEX_THINK_MAX: Maximum thinking budget (default: 16000)
 * - CODEX_THINK_START_ATTEMPT: First attempt to enable thinking (default: 2)
 */
export function getCodexLLMConfig(): CodexLLMConfig {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  console.log(`[Config] getCodexLLMConfig called. ANTHROPIC_API_KEY: ${apiKey ? `${apiKey.substring(0, 10)}...` : 'NOT SET'}`);
  console.log(`[Config] .env path was: ${join(godAgentRoot, '.env')}`);

  return {
    apiKey,
    model: process.env.CODEX_MODEL ?? 'claude-opus-4-5-20251101',
    maxTokens: parseInt(process.env.CODEX_MAX_TOKENS ?? '8192', 10),
    extendedThinking: {
      enabled: process.env.CODEX_ULTRATHINK !== 'false',
      baseBudget: parseInt(process.env.CODEX_THINK_BASE ?? '5000', 10),
      budgetIncrement: parseInt(process.env.CODEX_THINK_INCREMENT ?? '5000', 10),
      maxBudget: parseInt(process.env.CODEX_THINK_MAX ?? '16000', 10),
      enableOnAttempt: parseInt(process.env.CODEX_THINK_START_ATTEMPT ?? '2', 10)
    }
  };
}

/**
 * Validate RUBIX LLM configuration
 */
export function validateCodexConfig(config: CodexLLMConfig): string[] {
  const errors: string[] = [];

  if (!config.apiKey) {
    errors.push('ANTHROPIC_API_KEY environment variable is required for RUBIX code generation');
  }

  return errors;
}
