/**
 * RuntimeContext - Dynamic compressed capabilities context for RUBIX instances
 *
 * Generates at startup to tell each instance exactly what it can do.
 * Uses compressed token format for efficiency.
 */

import { getCodexLLMConfig, getCodexExecutionConfig } from '../core/config.js';

/**
 * Readable runtime context structure
 */
export interface RuntimeContext {
  capabilities: string[];      // IDE powers: lsp, git, ast, etc.
  channels: string[];          // Comms: telegram, slack, etc.
  toolCount: number;           // MCP tools available
  departments: string[];       // RUBIX departments
  model: string;               // LLM model
  executionMode: string;       // cli-first|api-only|cli-only
  maxParallel: number;         // Parallel execution limit
  ultrathink: { base: number; max: number } | null;
  wolfram: boolean;
  playwright: boolean;
  containment: boolean;
  codebaseRoot: string;
}

/**
 * Input sources for context generation
 */
export interface ContextSources {
  capabilities?: {
    lsp?: boolean;
    git?: boolean;
    analysis?: boolean;
    ast?: boolean;
    deps?: boolean;
    repl?: boolean;
    profiler?: boolean;
    stacktrace?: boolean;
    database?: boolean;
    docs?: boolean;
  };
  channels?: string[];
  toolCount?: number;
  wolfram?: boolean;
  playwright?: boolean;
  containment?: boolean;
  codebaseRoot?: string;
}

/**
 * Generate readable RuntimeContext from sources
 */
export function generateRuntimeContext(sources: ContextSources = {}): RuntimeContext {
  const llmConfig = getCodexLLMConfig();
  const execConfig = getCodexExecutionConfig();

  // Extract enabled capabilities
  const caps = sources.capabilities || {};
  const enabledCaps: string[] = [];
  if (caps.lsp !== false) enabledCaps.push('lsp');
  if (caps.git !== false) enabledCaps.push('git');
  if (caps.analysis !== false) enabledCaps.push('analysis');
  if (caps.ast !== false) enabledCaps.push('ast');
  if (caps.deps !== false) enabledCaps.push('deps');
  if (caps.stacktrace !== false) enabledCaps.push('stacktrace');
  if (caps.docs !== false) enabledCaps.push('docs');
  if (caps.repl) enabledCaps.push('repl');
  if (caps.profiler) enabledCaps.push('profiler');
  if (caps.database) enabledCaps.push('database');

  return {
    capabilities: enabledCaps,
    channels: sources.channels || [],
    toolCount: sources.toolCount || 50,
    departments: ['researcher', 'architect', 'engineer', 'validator', 'guardian'],
    model: llmConfig.model || 'claude-opus-4-5-20251101',
    executionMode: llmConfig.executionMode || 'cli-first',
    maxParallel: execConfig.maxParallel,
    ultrathink: llmConfig.extendedThinking ? {
      base: llmConfig.extendedThinking.baseBudget,
      max: llmConfig.extendedThinking.maxBudget
    } : null,
    wolfram: sources.wolfram || false,
    playwright: sources.playwright || false,
    containment: sources.containment !== false,
    codebaseRoot: sources.codebaseRoot || process.cwd()
  };
}

/**
 * Compress RuntimeContext to efficient token format
 *
 * Output format:
 * CTX:RUBIX
 * CAPS:lsp,git,analysis,ast,deps,stacktrace,docs
 * COMMS:telegram,slack
 * TOOLS:50
 * MODEL:claude-opus-4-5
 * MODE:cli-first
 * PARALLEL:5
 * THINK:5000-16000
 * WOLFRAM:1
 * PW:1
 * ROOT:/path/to/codebase
 */
export function compressContext(ctx: RuntimeContext): string {
  const lines: string[] = ['CTX:RUBIX'];

  if (ctx.capabilities.length > 0) {
    lines.push(`CAPS:${ctx.capabilities.join(',')}`);
  }

  if (ctx.channels.length > 0) {
    lines.push(`COMMS:${ctx.channels.join(',')}`);
  }

  lines.push(`TOOLS:${ctx.toolCount}`);

  // Shorten model name
  const shortModel = ctx.model
    .replace('claude-', '')
    .replace('-20251101', '')
    .replace('-20250514', '');
  lines.push(`MODEL:${shortModel}`);

  lines.push(`MODE:${ctx.executionMode}`);
  lines.push(`PARALLEL:${ctx.maxParallel}`);

  if (ctx.ultrathink) {
    lines.push(`THINK:${ctx.ultrathink.base}-${ctx.ultrathink.max}`);
  }

  if (ctx.wolfram) lines.push('WOLFRAM:1');
  if (ctx.playwright) lines.push('PW:1');
  if (ctx.containment) lines.push('CONTAIN:1');

  lines.push(`ROOT:${ctx.codebaseRoot}`);

  return lines.join('\n');
}

/**
 * Expand compressed context back to readable form
 */
export function expandContext(compressed: string): Partial<RuntimeContext> {
  const ctx: Partial<RuntimeContext> = {};
  const lines = compressed.split('\n');

  for (const line of lines) {
    const [key, value] = line.split(':');
    if (!value) continue;

    switch (key) {
      case 'CAPS':
        ctx.capabilities = value.split(',');
        break;
      case 'COMMS':
        ctx.channels = value.split(',');
        break;
      case 'TOOLS':
        ctx.toolCount = parseInt(value, 10);
        break;
      case 'MODEL':
        ctx.model = value;
        break;
      case 'MODE':
        ctx.executionMode = value;
        break;
      case 'PARALLEL':
        ctx.maxParallel = parseInt(value, 10);
        break;
      case 'THINK':
        const [base, max] = value.split('-').map(n => parseInt(n, 10));
        ctx.ultrathink = { base, max };
        break;
      case 'WOLFRAM':
        ctx.wolfram = value === '1';
        break;
      case 'PW':
        ctx.playwright = value === '1';
        break;
      case 'CONTAIN':
        ctx.containment = value === '1';
        break;
      case 'ROOT':
        ctx.codebaseRoot = value;
        break;
    }
  }

  return ctx;
}

/**
 * Generate both compressed and readable context
 */
export function createRuntimeContext(sources: ContextSources = {}): {
  readable: RuntimeContext;
  compressed: string;
  tokenEstimate: number;
} {
  const readable = generateRuntimeContext(sources);
  const compressed = compressContext(readable);

  // Rough token estimate (1 token ≈ 4 chars)
  const tokenEstimate = Math.ceil(compressed.length / 4);

  return { readable, compressed, tokenEstimate };
}

/**
 * RuntimeContextManager - Singleton for managing runtime context
 */
export class RuntimeContextManager {
  private context: RuntimeContext | null = null;
  private compressed: string | null = null;

  /**
   * Initialize context with current runtime state
   */
  initialize(sources: ContextSources): void {
    const result = createRuntimeContext(sources);
    this.context = result.readable;
    this.compressed = result.compressed;

    console.log(`[RuntimeContext] Generated (${result.tokenEstimate} tokens):`);
    console.log(this.compressed);
  }

  /**
   * Get readable context
   */
  getContext(): RuntimeContext | null {
    return this.context;
  }

  /**
   * Get compressed context for prompts
   */
  getCompressed(): string | null {
    return this.compressed;
  }

  /**
   * Update specific context values
   */
  update(updates: Partial<ContextSources>): void {
    if (!this.context) {
      this.initialize(updates);
      return;
    }

    // Merge updates
    if (updates.channels) {
      this.context.channels = updates.channels;
    }
    if (updates.wolfram !== undefined) {
      this.context.wolfram = updates.wolfram;
    }
    if (updates.playwright !== undefined) {
      this.context.playwright = updates.playwright;
    }

    // Regenerate compressed
    this.compressed = compressContext(this.context);
  }

  /**
   * Format context for inclusion in prompts
   */
  toPromptBlock(): string {
    if (!this.compressed) return '';
    return `<rubix-context>\n${this.compressed}\n</rubix-context>`;
  }
}

// Singleton instance
export const runtimeContext = new RuntimeContextManager();
