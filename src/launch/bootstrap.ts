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
import { MemorySource } from '../core/types.js';
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
  projectRoot: string;
  projectName: string;
}

/**
 * Bootstrap options
 */
export interface BootstrapOptions {
  /** Custom data directory (defaults to RUBIX_DATA_DIR or ./data) */
  dataDir?: string;
  /** Custom codebase root (defaults to cwd) */
  codebaseRoot?: string;
  /** Show environment summary on start */
  showEnvSummary?: boolean;
  /** Store project context in high-priority memory (defaults to true) */
  storeProjectContext?: boolean;
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

  // Read project configuration from environment variables
  // This enables multi-project support via MCP instance configuration
  const projectRoot = process.env.RUBIX_PROJECT_ROOT || options.codebaseRoot || process.cwd();
  const projectName = process.env.RUBIX_PROJECT_NAME || (projectRoot.split(/[/\\]/).pop() || 'Unknown Project');

  console.log(`[Bootstrap] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`[Bootstrap] Initializing for project: ${projectName}`);
  console.log(`[Bootstrap] Project root: ${projectRoot}`);

  // 1. Initialize MemoryEngine
  const dataDir = options.dataDir || process.env.RUBIX_DATA_DIR || './data';
  console.log(`[Bootstrap] Data directory: ${dataDir}`);
  console.log(`[Bootstrap] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  const engine = new MemoryEngine({ dataDir });
  await engine.initialize();
  console.log('[Bootstrap] MemoryEngine initialized');

  // 2. Create TaskExecutor
  const executor = new TaskExecutor(engine);
  console.log('[Bootstrap] TaskExecutor created');

  // 3. Initialize ContainmentManager and load persisted rules
  // Use projectRoot from environment to enable project-specific containment
  const containment = new ContainmentManager({
    projectRoot
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
  // Use projectRoot from environment for project-specific analysis
  const capabilities = new CapabilitiesManager({
    projectRoot,
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

  // 5. Store project context in high-priority memory (optional but recommended)
  // This ensures project context is always surfaced in queries via AutoRecall
  if (options.storeProjectContext !== false) {
    const projectContext = `ACTIVE PROJECT: ${projectName}

**Working Directory**: ${projectRoot}
**Data Directory**: ${dataDir}
**Instance ID**: ${process.env.npm_config_local_prefix || 'default'}

All file operations are scoped to this project directory unless explicitly overridden.
This is project-specific context that persists across sessions.`;

    await engine.store(projectContext, {
      tags: ['project_context', 'always_recall', 'system_config'],
      importance: 1.0,
      source: MemorySource.SYSTEM,
      sessionId: 'bootstrap',
      agentId: 'system'
    });

    console.log('[Bootstrap] Project context stored in memory (high priority)');
  }

  return { engine, executor, containment, capabilities, projectRoot, projectName };
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

  process.on('unhandledRejection', (reason) => {
    // Log but DON'T exit - fire-and-forget async operations can reject after task completion
    // Exiting here would crash the daemon when a task completes successfully
    console.error('[Warning] Unhandled rejection (non-fatal):', reason);
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
