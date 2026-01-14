/**
 * Configuration
 *
 * Default configuration and environment variable loading for God Agent.
 */

import { config as loadDotenv } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { MemoryEngineConfig, HNSWConfig, EmbeddingConfig, StorageConfig, LScoreConfig, CodexLLMConfig } from './types.js';
import type { ProviderConfig, DepartmentConfig } from '../providers/types.js';

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
 * Environment variables (RUBIX_ preferred, CODEX_ for backwards compat):
 * - ANTHROPIC_API_KEY: API key for Claude (optional - only for API fallback)
 * - RUBIX_MODEL: Claude model to use (default: claude-opus-4-5-20251101)
 * - RUBIX_MAX_TOKENS: Max generation tokens (default: 8192)
 * - RUBIX_ULTRATHINK: Enable ultrathink (default: true)
 * - RUBIX_THINK_BASE: Base thinking budget tokens (default: 5000)
 * - RUBIX_THINK_INCREMENT: Additional tokens per retry (default: 5000)
 * - RUBIX_THINK_MAX: Maximum thinking budget (default: 16000)
 * - RUBIX_THINK_START_ATTEMPT: First attempt to enable thinking (default: 2)
 * - RUBIX_EXECUTION_MODE: 'cli-first' (default), 'api-only', or 'cli-only'
 * - RUBIX_CLI_MODEL: CLI model preference: 'opus' (default), 'sonnet', 'haiku'
 * - RUBIX_CLI_TIMEOUT: CLI timeout in ms (default: 300000 = 5 minutes)
 *
 * Execution modes:
 * - cli-first: Try Claude Code CLI first (uses Max subscription), fall back to API
 * - api-only: Only use Anthropic API (requires ANTHROPIC_API_KEY)
 * - cli-only: Only use Claude Code CLI, never fall back to API
 */
export function getRubixLLMConfig(): CodexLLMConfig {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const executionMode = (process.env.RUBIX_EXECUTION_MODE ?? 'cli-first') as 'cli-first' | 'api-only' | 'cli-only';
  const cliModel = (process.env.RUBIX_CLI_MODEL ?? 'opus') as 'opus' | 'sonnet' | 'haiku';

  console.log(`[Config] getRubixLLMConfig called.`);
  console.log(`[Config] Execution mode: ${executionMode}`);
  console.log(`[Config] CLI model: ${cliModel}`);
  console.log(`[Config] ANTHROPIC_API_KEY: ${apiKey ? `${apiKey.substring(0, 10)}...` : 'NOT SET (API fallback disabled)'}`);

  return {
    apiKey,
    model: process.env.RUBIX_MODEL ?? process.env.CODEX_MODEL ?? 'claude-opus-4-5-20251101',
    maxTokens: parseInt(process.env.RUBIX_MAX_TOKENS ?? process.env.CODEX_MAX_TOKENS ?? '8192', 10),
    extendedThinking: {
      enabled: (process.env.RUBIX_ULTRATHINK ?? process.env.CODEX_ULTRATHINK) !== 'false',
      baseBudget: parseInt(process.env.RUBIX_THINK_BASE ?? process.env.CODEX_THINK_BASE ?? '5000', 10),
      budgetIncrement: parseInt(process.env.RUBIX_THINK_INCREMENT ?? process.env.CODEX_THINK_INCREMENT ?? '5000', 10),
      maxBudget: parseInt(process.env.RUBIX_THINK_MAX ?? process.env.CODEX_THINK_MAX ?? '16000', 10),
      enableOnAttempt: parseInt(process.env.RUBIX_THINK_START_ATTEMPT ?? process.env.CODEX_THINK_START_ATTEMPT ?? '2', 10)
    },
    executionMode,
    cliModel,
    cliTimeout: parseInt(process.env.RUBIX_CLI_TIMEOUT ?? '300000', 10)
  };
}

// Backwards compatibility alias
export const getCodexLLMConfig = getRubixLLMConfig;

/**
 * Validate RUBIX LLM configuration
 */
export function validateRubixConfig(config: CodexLLMConfig): string[] {
  const errors: string[] = [];

  // API key only required for api-only mode
  if (config.executionMode === 'api-only' && !config.apiKey) {
    errors.push('ANTHROPIC_API_KEY environment variable is required for api-only execution mode');
  }

  // Warning (not error) if cli-first without API key (no fallback available)
  if (config.executionMode === 'cli-first' && !config.apiKey) {
    console.warn('[Config] Warning: ANTHROPIC_API_KEY not set - API fallback disabled. CLI-only mode will be used.');
  }

  return errors;
}

// Backwards compatibility alias
export const validateCodexConfig = validateRubixConfig;

/**
 * Get RUBIX execution configuration
 */
export function getRubixExecutionConfig(): { maxParallel: number; failFast: boolean } {
  return {
    maxParallel: parseInt(process.env.RUBIX_MAX_PARALLEL ?? process.env.CODEX_MAX_PARALLEL ?? '5', 10),
    failFast: (process.env.RUBIX_FAIL_FAST ?? process.env.CODEX_FAIL_FAST) !== 'false'
  };
}

// Backwards compatibility alias
export const getCodexExecutionConfig = getRubixExecutionConfig;

/**
 * Curiosity configuration for autonomous exploration
 *
 * Environment variables:
 * - RUBIX_TOKENS_PER_PROBE: Max tokens per exploration probe (default: 100000)
 * - RUBIX_PROBES_PER_WEEK: Weekly probe limit (default: 5)
 * - RUBIX_HIGH_PRIORITY_RATIO: High-priority probes before moderate (default: 3)
 * - RUBIX_DISCOVERY_CRON: Discovery schedule (default: "0 8 * * 1,3,5")
 * - RUBIX_WEEKLY_RESET_DAY: Day to reset budget, 0=Sunday (default: 0)
 */
export interface CuriosityConfig {
  tokensPerProbe: number;
  probesPerWeek: number;
  highPriorityRatio: number;
  discoveryCron: string;
  weeklyResetDay: number;
}

export function getCuriosityConfig(): CuriosityConfig {
  return {
    tokensPerProbe: parseInt(process.env.RUBIX_TOKENS_PER_PROBE ?? '100000', 10),
    probesPerWeek: parseInt(process.env.RUBIX_PROBES_PER_WEEK ?? '5', 10),
    highPriorityRatio: parseInt(process.env.RUBIX_HIGH_PRIORITY_RATIO ?? '3', 10),
    discoveryCron: process.env.RUBIX_DISCOVERY_CRON ?? '0 8 * * 1,3,5',
    weeklyResetDay: parseInt(process.env.RUBIX_WEEKLY_RESET_DAY ?? '0', 10)
  };
}

/**
 * Validate curiosity configuration
 */
export function validateCuriosityConfig(config: CuriosityConfig): string[] {
  const errors: string[] = [];

  if (config.tokensPerProbe <= 0) {
    errors.push('RUBIX_TOKENS_PER_PROBE must be positive');
  }

  if (config.probesPerWeek <= 0) {
    errors.push('RUBIX_PROBES_PER_WEEK must be positive');
  }

  if (config.highPriorityRatio <= 0) {
    errors.push('RUBIX_HIGH_PRIORITY_RATIO must be positive');
  }

  if (config.weeklyResetDay < 0 || config.weeklyResetDay > 6) {
    errors.push('RUBIX_WEEKLY_RESET_DAY must be 0-6 (Sunday-Saturday)');
  }

  return errors;
}

/**
 * Department Provider Configuration
 *
 * Maps each department to its LLM provider with fallback strategy:
 * - cloud-only: Wait if rate limited (ARCHITECT, ENGINEER - quality critical)
 * - cloud-with-fallback: Fall back to Ollama if rate limited (RESEARCHER, VALIDATOR, GUARDIAN)
 *
 * Environment variables:
 * - OLLAMA_ENDPOINT: Ollama API endpoint (default: http://localhost:11434)
 * - OLLAMA_MODEL: Local model to use (default: qwen2.5-coder:7b)
 * - RATE_LIMIT_WAIT_MS: How long to wait for quota reset (default: 60000)
 */

// Shared provider configs
const CLAUDE_CONFIG: ProviderConfig = {
  provider: 'claude',
  model: process.env.RUBIX_MODEL || 'claude-sonnet-4-20250514',
  apiKey: process.env.ANTHROPIC_API_KEY
};

const OLLAMA_CONFIG: ProviderConfig = {
  provider: 'ollama',
  model: process.env.OLLAMA_MODEL || 'qwen2.5-coder:32b',
  apiEndpoint: process.env.OLLAMA_ENDPOINT || 'http://localhost:11434'
};

export const DEPARTMENT_CONFIG: Record<string, DepartmentConfig> = {
  // Cloud-only: Wait if rate limited (quality critical)
  ARCHITECT: {
    primary: CLAUDE_CONFIG,
    strategy: 'cloud-only'
  },
  ENGINEER: {
    primary: CLAUDE_CONFIG,
    strategy: 'cloud-only'
  },

  // Cloud-with-fallback: Try Claude, use Ollama if 429
  RESEARCHER: {
    primary: CLAUDE_CONFIG,
    fallback: OLLAMA_CONFIG,
    strategy: 'cloud-with-fallback'
  },
  VALIDATOR: {
    primary: CLAUDE_CONFIG,
    fallback: OLLAMA_CONFIG,
    strategy: 'cloud-with-fallback'
  },
  GUARDIAN: {
    primary: CLAUDE_CONFIG,
    fallback: OLLAMA_CONFIG,
    strategy: 'cloud-with-fallback'
  }
};

/**
 * Get department config with current environment values
 */
export function getDepartmentConfig(department: string): DepartmentConfig | undefined {
  return DEPARTMENT_CONFIG[department.toUpperCase()];
}

/**
 * Check if Ollama fallback is available for a department
 */
export function hasFallback(department: string): boolean {
  const config = DEPARTMENT_CONFIG[department.toUpperCase()];
  return config?.strategy === 'cloud-with-fallback' && !!config.fallback;
}

/**
 * Get rate limit wait duration in ms
 */
export function getRateLimitWaitMs(): number {
  return parseInt(process.env.RATE_LIMIT_WAIT_MS || '60000', 10);
}
