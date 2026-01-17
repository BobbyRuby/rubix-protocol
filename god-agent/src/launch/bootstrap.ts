/**
 * Bootstrap
 *
 * Shared initialization for all launch scripts.
 * Handles MemoryEngine, TaskExecutor, and subsystem setup.
 */

import { config as loadDotenv } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { MemoryEngine } from '../core/MemoryEngine.js';
import { TaskExecutor } from '../codex/TaskExecutor.js';
import { ContainmentManager } from '../codex/ContainmentManager.js';
import { CapabilitiesManager } from '../capabilities/CapabilitiesManager.js';
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
  containment: ContainmentManager;
  capabilities: CapabilitiesManager;
}

/**
 * Bootstrap options
 */
export interface BootstrapOptions {
  /** Custom data directory (defaults to GOD_AGENT_DATA_DIR or ./data) */
  dataDir?: string;
  /** Custom codebase root (defaults to cwd) */
  codebaseRoot?: string;
  /** Show environment summary on start */
  showEnvSummary?: boolean;
}

/**
 * Initialize core God-Agent systems
 *
 * @param options - Bootstrap configuration
 * @returns Initialized engine, executor, containment, and capabilities
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

  // 3. Initialize ContainmentManager and load persisted rules
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

  // 4. Initialize CapabilitiesManager with all capabilities enabled
  const codebaseRoot = options.codebaseRoot || process.cwd();
  const capabilities = new CapabilitiesManager({
    projectRoot: codebaseRoot,
    // Enable all capabilities for full functionality
    lsp: { enabled: true, timeout: 30000 },
    git: { enabled: true },
    analysis: { enabled: true, eslint: true, typescript: true },
    ast: { enabled: true },
    deps: { enabled: true },
    repl: { enabled: true },      // Enable debug/REPL
    profiler: { enabled: true },  // Enable profiler
    stacktrace: { enabled: true },
    database: { enabled: false }, // Requires explicit connection
    docs: { enabled: true, cacheTTL: 3600 }
  });
  await capabilities.initialize();
  console.log('[Bootstrap] CapabilitiesManager initialized');

  // Start background pre-warming of heavy capabilities (non-blocking)
  capabilities.prewarm()
    .then(results => {
      const ready = Object.entries(results)
        .filter(([, ok]) => ok)
        .map(([name]) => name);
      if (ready.length > 0) {
        console.log(`[Bootstrap] Pre-warmed capabilities: ${ready.join(', ')}`);
      }
    })
    .catch(err => {
      console.warn('[Bootstrap] Capability prewarm error:', err.message);
    });

  return { engine, executor, containment, capabilities };
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
