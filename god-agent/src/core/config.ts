/**
 * Configuration
 *
 * Default configuration and environment variable loading for God Agent.
 */

import { config as loadDotenv } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { MemoryEngineConfig, HNSWConfig, EmbeddingConfig, StorageConfig, LScoreConfig } from './types.js';

// Get the directory where this module is located
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env file from god-agent root (two levels up from src/core/)
const godAgentRoot = join(__dirname, '..', '..');
loadDotenv({ path: join(godAgentRoot, '.env') });

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
