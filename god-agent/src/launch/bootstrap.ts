/**
 * Bootstrap
 *
 * Shared initialization for all launch scripts.
 * Handles MemoryEngine, TaskExecutor, and CodeGenerator setup.
 */

import { config as loadDotenv } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { MemoryEngine } from '../core/MemoryEngine.js';
import { TaskExecutor } from '../codex/TaskExecutor.js';
import { CodeGenerator } from '../codex/CodeGenerator.js';
import { ContainmentManager } from '../codex/ContainmentManager.js';
import { getCodexLLMConfig } from '../core/config.js';
import { getEnvSummary } from './env.js';

// Get module directory for .env loading
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const godAgentRoot = join(__dirname, '..', '..');

/**
 * Result of bootstrap initialization
 */
export interface BootstrapResult {
  engine: MemoryEngine;
  executor: TaskExecutor;
  codeGenerator?: CodeGenerator;
  containment: ContainmentManager;
}

/**
 * Bootstrap options
 */
export interface BootstrapOptions {
  /** Custom data directory (defaults to GOD_AGENT_DATA_DIR or ./data) */
  dataDir?: string;
  /** Custom codebase root for CodeGenerator (defaults to cwd) */
  codebaseRoot?: string;
  /** Show environment summary on start */
  showEnvSummary?: boolean;
  /** Skip CodeGenerator initialization even if API key is present */
  skipCodeGenerator?: boolean;
}

/**
 * Initialize core God-Agent systems
 *
 * @param options - Bootstrap configuration
 * @returns Initialized engine, executor, and optionally codeGenerator
 */
export async function bootstrap(options: BootstrapOptions = {}): Promise<BootstrapResult> {
  // Load .env from god-agent root
  const envPath = join(godAgentRoot, '.env');
  loadDotenv({ path: envPath });

  if (options.showEnvSummary) {
    console.log(getEnvSummary());
  }

  // 1. Initialize MemoryEngine
  const dataDir = options.dataDir || process.env.GOD_AGENT_DATA_DIR || './data';
  console.log(`[Bootstrap] Initializing MemoryEngine with dataDir: ${dataDir}`);

  const engine = new MemoryEngine({ dataDir });
  await engine.initialize();
  console.log('[Bootstrap] MemoryEngine initialized');

  // 2. Create TaskExecutor
  const executor = new TaskExecutor(engine);
  console.log('[Bootstrap] TaskExecutor created');

  // 3. Initialize CodeGenerator if API key available and not skipped
  let codeGenerator: CodeGenerator | undefined;

  if (!options.skipCodeGenerator) {
    const llmConfig = getCodexLLMConfig();

    if (llmConfig.apiKey) {
      const codebaseRoot = options.codebaseRoot || process.cwd();

      codeGenerator = new CodeGenerator({
        apiKey: llmConfig.apiKey,
        model: llmConfig.model,
        maxTokens: llmConfig.maxTokens,
        codebaseRoot,
        extendedThinking: llmConfig.extendedThinking
      });

      executor.setCodeGenerator(codeGenerator);
      console.log(`[Bootstrap] CodeGenerator initialized (model: ${llmConfig.model})`);
      console.log(`[Bootstrap] Codebase root: ${codebaseRoot}`);
    } else {
      console.warn('[Bootstrap] ANTHROPIC_API_KEY not set - RUBIX in simulation mode');
      console.warn('[Bootstrap] Set ANTHROPIC_API_KEY to enable code generation');
    }
  }

  // 4. Initialize ContainmentManager and load persisted rules
  const containment = new ContainmentManager({
    projectRoot: options.codebaseRoot || process.cwd()
  });
  containment.setRulesFilePath(dataDir);

  // Display loaded rules
  const userRules = containment.getUserRules();
  if (userRules.length > 0) {
    console.log('[Bootstrap] Containment - Allowed paths:');
    for (const rule of userRules) {
      const icon = rule.permission === 'read' ? '📖' : '📝';
      console.log(`  ${icon} ${rule.pattern} (${rule.permission})`);
    }
  } else {
    console.log('[Bootstrap] Containment - No custom paths configured');
  }

  // Set containment on code generator
  if (codeGenerator) {
    codeGenerator.setContainment(containment);
  }

  return { engine, executor, codeGenerator, containment };
}

/**
 * Setup graceful shutdown handlers
 *
 * @param cleanup - Async cleanup function to run on shutdown
 */
export function setupShutdown(cleanup: () => Promise<void>): void {
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return; // Prevent double-shutdown
    shuttingDown = true;

    console.log(`\n[Shutdown] Received ${signal}, cleaning up...`);

    try {
      await cleanup();
      console.log('[Shutdown] Cleanup complete');
      process.exit(0);
    } catch (error) {
      console.error('[Shutdown] Error during cleanup:', error);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Handle uncaught errors gracefully
  process.on('uncaughtException', async (error) => {
    console.error('[Fatal] Uncaught exception:', error);
    await shutdown('uncaughtException');
  });

  process.on('unhandledRejection', async (reason) => {
    console.error('[Fatal] Unhandled rejection:', reason);
    await shutdown('unhandledRejection');
  });
}

/**
 * Print startup banner
 */
export function printBanner(service: string): void {
  console.log('');
  console.log('╔════════════════════════════════════════╗');
  console.log(`║  Rubix: ${service.padEnd(29)}║`);
  console.log('╚════════════════════════════════════════╝');
  console.log('');
}
