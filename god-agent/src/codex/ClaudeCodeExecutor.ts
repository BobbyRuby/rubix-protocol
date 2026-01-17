/**
 * ClaudeCodeExecutor
 *
 * Executes code generation via Claude Code CLI (uses Max subscription).
 * Falls back to direct API when CLI unavailable or quota exhausted.
 */

import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink, mkdir } from 'fs/promises';
import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import { SelfKnowledgeInjector } from '../prompts/SelfKnowledgeInjector.js';
import { PermissionDetector, PermissionRequest } from './PermissionDetector.js';
import type { CommunicationManager } from '../communication/CommunicationManager.js';
import type { Escalation } from './types.js';

const execAsync = promisify(exec);

/**
 * Result from Claude Code CLI execution
 */
export interface ClaudeCodeResult {
  success: boolean;
  output: string;
  error?: string;
  /** Whether quota was exhausted (trigger API fallback) */
  quotaExhausted: boolean;
  /** Whether CLI is unavailable (not installed, etc.) */
  cliUnavailable: boolean;
  /** Whether model was downgraded from Opus (trigger API fallback) */
  modelDowngraded: boolean;
  /** Files created/modified by the CLI */
  filesCreated: string[];
  filesModified: string[];
}

/**
 * Progress info sent during heartbeat
 */
export interface HeartbeatProgress {
  /** Current prompt/subtask description (truncated) */
  subtask: string;
  /** Elapsed time in ms */
  elapsedMs: number;
  /** Number of stdout lines so far */
  stdoutLines: number;
  /** Last 200 chars of output */
  lastOutput: string;
}

/**
 * Configuration for ClaudeCodeExecutor
 */
export interface ClaudeCodeExecutorConfig {
  /** Working directory for claude CLI */
  cwd: string;
  /** Timeout in ms. Set to 0 or undefined to disable (run until completion). Default: 0 (disabled) */
  timeout?: number;
  /** Model to request (default: opus) */
  model?: 'opus' | 'sonnet' | 'haiku';
  /** Whether to allow file edits */
  allowEdits?: boolean;
  /** Max output tokens hint */
  maxTokens?: number;
  /** Heartbeat callback - called every heartbeatInterval ms */
  onHeartbeat?: (progress: HeartbeatProgress) => void;
  /** Heartbeat interval in ms (default: 30 seconds) */
  heartbeatInterval?: number;
  /** Real-time stdout callback - called on EVERY chunk for live streaming */
  onStdout?: (chunk: string, accumulated: string) => void;
}

/**
 * Patterns indicating quota/rate limit exhaustion
 */
const QUOTA_EXHAUSTION_PATTERNS = [
  /rate.?limit/i,
  /quota.?exceed/i,
  /too.?many.?requests/i,
  /capacity/i,
  /overloaded/i,
  /try.?again.?later/i,
  /usage.?limit/i,
  /exceeded.*limit/i,
  /429/,
  /503/,
  /resource.?exhausted/i
];

/**
 * Patterns indicating CLI is unavailable
 */
const CLI_UNAVAILABLE_PATTERNS = [
  /command not found/i,
  /not recognized/i,
  /'claude' is not recognized/i,
  /ENOENT/,
  /spawn.*ENOENT/i,
  /cannot find/i
];

/**
 * Patterns indicating model was downgraded from Opus
 * When Claude Code runs out of Opus quota, it may switch to Sonnet/Haiku
 */
const MODEL_DOWNGRADE_PATTERNS = [
  /switching to sonnet/i,
  /switching to haiku/i,
  /falling back to sonnet/i,
  /falling back to haiku/i,
  /using sonnet instead/i,
  /using haiku instead/i,
  /opus.*unavailable/i,
  /opus.*quota/i,
  /downgrad.*to sonnet/i,
  /downgrad.*to haiku/i,
  /model.*sonnet/i,  // If output mentions using sonnet when we requested opus
  /model.*haiku/i,   // If output mentions using haiku when we requested opus
  /claude-3-5-sonnet/i,  // Specific model name in output
  /claude-3-haiku/i      // Specific model name in output
];

/**
 * ClaudeCodeExecutor - Execute via Claude Code CLI with API fallback support
 */
export class ClaudeCodeExecutor {
  private config: ClaudeCodeExecutorConfig;
  private cliAvailable: boolean | null = null;
  private consecutiveQuotaErrors = 0;
  private lastQuotaError: Date | null = null;
  private comms: CommunicationManager | undefined;
  private permissionDetector: PermissionDetector;
  /** Abort controller for interrupting execution */
  private abortController: AbortController | null = null;
  /** Current subtask description for heartbeat */
  private currentSubtask: string = '';

  constructor(config: ClaudeCodeExecutorConfig, comms?: CommunicationManager) {
    this.config = {
      timeout: 0, // Disabled by default - run until completion
      model: 'opus',
      allowEdits: true,
      heartbeatInterval: 30 * 1000, // 30 seconds default (reduced for better visibility)
      ...config
    };
    this.comms = comms;
    this.permissionDetector = new PermissionDetector();
  }

  /**
   * Set the CommunicationManager for permission routing
   */
  setComms(comms: CommunicationManager): void {
    this.comms = comms;
  }

  /**
   * Update the working directory for CLI execution
   */
  setCwd(cwd: string): void {
    this.config.cwd = cwd;
  }

  /**
   * Set the heartbeat callback
   */
  setOnHeartbeat(callback: (progress: HeartbeatProgress) => void): void {
    this.config.onHeartbeat = callback;
  }

  /**
   * Set the real-time stdout streaming callback
   */
  setOnStdout(callback: (chunk: string, accumulated: string) => void): void {
    this.config.onStdout = callback;
  }

  /**
   * Abort the currently running CLI execution
   */
  abort(): void {
    if (this.abortController) {
      console.log('[ClaudeCodeExecutor] Abort requested');
      this.abortController.abort();
    }
  }

  /**
   * Check if execution is currently in progress
   */
  isExecuting(): boolean {
    return this.abortController !== null;
  }

  /**
   * Check if Claude Code CLI is available
   */
  async checkCliAvailable(): Promise<boolean> {
    if (this.cliAvailable !== null) {
      return this.cliAvailable;
    }

    try {
      // Try to get claude version
      await execAsync('claude --version', { timeout: 10000 });
      this.cliAvailable = true;
      console.log('[ClaudeCodeExecutor] Claude CLI is available');
      return true;
    } catch (error) {
      console.log('[ClaudeCodeExecutor] Claude CLI not available:', error);
      this.cliAvailable = false;
      return false;
    }
  }

  /**
   * Check if we should skip CLI due to recent quota errors
   */
  shouldSkipCliDueToQuota(): boolean {
    if (this.consecutiveQuotaErrors >= 3) {
      // If we've had 3+ consecutive quota errors
      const timeSinceError = this.lastQuotaError
        ? Date.now() - this.lastQuotaError.getTime()
        : Infinity;

      // Wait 5 minutes before retrying CLI after quota errors
      if (timeSinceError < 5 * 60 * 1000) {
        console.log('[ClaudeCodeExecutor] Skipping CLI due to recent quota errors');
        return true;
      }

      // Reset after cooldown
      this.consecutiveQuotaErrors = 0;
    }
    return false;
  }

  /**
   * Execute a prompt via Claude Code CLI
   */
  async execute(prompt: string, systemPrompt?: string): Promise<ClaudeCodeResult> {
    // Check if CLI is available
    const cliAvailable = await this.checkCliAvailable();
    if (!cliAvailable) {
      return {
        success: false,
        output: '',
        error: 'Claude CLI not available',
        quotaExhausted: false,
        cliUnavailable: true,
        modelDowngraded: false,
        filesCreated: [],
        filesModified: []
      };
    }

    // Check quota cooldown
    if (this.shouldSkipCliDueToQuota()) {
      return {
        success: false,
        output: '',
        error: 'Quota exhausted - in cooldown period',
        quotaExhausted: true,
        cliUnavailable: false,
        modelDowngraded: false,
        filesCreated: [],
        filesModified: []
      };
    }

    try {
      const result = await this.runCli(prompt, systemPrompt);

      // Check for quota exhaustion in output
      if (this.isQuotaExhausted(result.output) || this.isQuotaExhausted(result.error || '')) {
        this.consecutiveQuotaErrors++;
        this.lastQuotaError = new Date();
        return {
          ...result,
          success: false,
          quotaExhausted: true,
          modelDowngraded: false
        };
      }

      // Check for model downgrade (Opus → Sonnet/Haiku)
      if (this.isModelDowngraded(result.output) || this.isModelDowngraded(result.error || '')) {
        console.log('[ClaudeCodeExecutor] Model downgrade detected - triggering API fallback');
        return {
          ...result,
          success: false,
          quotaExhausted: false,
          modelDowngraded: true
        };
      }

      // Success - reset quota error counter
      if (result.success) {
        this.consecutiveQuotaErrors = 0;
      }

      return result;

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Check if CLI unavailable
      if (this.isCliUnavailable(errorMsg)) {
        this.cliAvailable = false;
        return {
          success: false,
          output: '',
          error: errorMsg,
          quotaExhausted: false,
          cliUnavailable: true,
          modelDowngraded: false,
          filesCreated: [],
          filesModified: []
        };
      }

      // Check for quota exhaustion
      if (this.isQuotaExhausted(errorMsg)) {
        this.consecutiveQuotaErrors++;
        this.lastQuotaError = new Date();
        return {
          success: false,
          output: '',
          error: errorMsg,
          quotaExhausted: true,
          cliUnavailable: false,
          modelDowngraded: false,
          filesCreated: [],
          filesModified: []
        };
      }

      // Check for model downgrade
      if (this.isModelDowngraded(errorMsg)) {
        console.log('[ClaudeCodeExecutor] Model downgrade detected in error - triggering API fallback');
        return {
          success: false,
          output: '',
          error: errorMsg,
          quotaExhausted: false,
          cliUnavailable: false,
          modelDowngraded: true,
          filesCreated: [],
          filesModified: []
        };
      }

      return {
        success: false,
        output: '',
        error: errorMsg,
        quotaExhausted: false,
        cliUnavailable: false,
        modelDowngraded: false,
        filesCreated: [],
        filesModified: []
      };
    }
  }

  /**
   * Run Claude CLI with the given prompt
   */
  private async runCli(prompt: string, systemPrompt?: string): Promise<ClaudeCodeResult> {
    // Store current subtask for heartbeat
    this.currentSubtask = prompt.substring(0, 100);

    // Create abort controller for this execution
    this.abortController = new AbortController();
    const startTime = Date.now();

    return new Promise((resolve) => {
      // Build the full prompt with system context
      let fullPrompt = prompt;
      if (systemPrompt) {
        fullPrompt = `${systemPrompt}\n\n---\n\n${prompt}`;
      }

      // Build args array
      const args: string[] = [
        '--print',
        '--output-format', 'text',
        '--dangerously-skip-permissions'
      ];

      // Add model preference
      if (this.config.model) {
        args.push('--model', this.config.model);
      }

      // Add allowedTools if edits allowed (includes MCP memory tools for recall)
      if (this.config.allowEdits) {
        args.push('--allowedTools', 'Edit,Write,Read,Glob,Grep,Bash,mcp__rubix__god_query,mcp__rubix__god_failure_query,mcp__rubix__god_store');
      }

      // Add prompt as final argument
      args.push(fullPrompt);

      console.log(`[ClaudeCodeExecutor] Running: claude ${args.slice(0, 4).join(' ')} ...`);
      console.log(`[ClaudeCodeExecutor] Working directory: ${this.config.cwd}`);
      console.log(`[ClaudeCodeExecutor] Prompt length: ${fullPrompt.length} chars`);

      // Create RUBIX CLAUDE.md for instance context
      // Pass cwd as BOTH codebase and projectPath to ensure the project warning is injected
      // This tells spawned instances exactly where to work and what NOT to modify
      try {
        const claudeMdPath = existsSync(join(this.config.cwd, 'CLAUDE.md'))
          ? join(this.config.cwd, 'RUBIX-CLAUDE.md')
          : join(this.config.cwd, 'CLAUDE.md');

        const claudeMdContent = SelfKnowledgeInjector.generateInstanceClaudeMd({
          subsystem: 'code_generator',
          codebase: this.config.cwd,
          projectPath: this.config.cwd,  // Enables project warning in CLAUDE.md
          model: this.config.model
        });

        writeFileSync(claudeMdPath, claudeMdContent, 'utf-8');
        console.log(`[ClaudeCodeExecutor] Created instance context: ${claudeMdPath}`);
      } catch (e) {
        console.error('[ClaudeCodeExecutor] Failed to create CLAUDE.md:', e);
      }

      let stdout = '';
      let stderr = '';
      let resolved = false;
      let permissionPending = false;

      // Reset permission detector for this execution
      this.permissionDetector.reset();

      // Spawn claude CLI directly (not through shell for proper arg handling)
      const child = spawn('claude', args, {
        cwd: this.config.cwd,
        shell: false,  // Don't use shell - pass args directly
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],  // pipe all for permission handling
        env: process.env
      });

      // Timeout ID - declared here for cleanup, set later if timeout enabled
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      // Cleanup function to clear intervals and abort controller
      const cleanup = () => {
        if (heartbeatIntervalId) clearInterval(heartbeatIntervalId);
        if (timeoutId) clearTimeout(timeoutId);
        this.abortController = null;
      };

      // Heartbeat interval - send progress updates
      let heartbeatIntervalId: ReturnType<typeof setInterval> | null = null;
      if (this.config.onHeartbeat && this.config.heartbeatInterval) {
        heartbeatIntervalId = setInterval(() => {
          if (resolved) {
            if (heartbeatIntervalId) clearInterval(heartbeatIntervalId);
            return;
          }

          const progress: HeartbeatProgress = {
            subtask: this.currentSubtask,
            elapsedMs: Date.now() - startTime,
            stdoutLines: stdout.split('\n').length,
            lastOutput: stdout.slice(-200)
          };

          this.config.onHeartbeat!(progress);
        }, this.config.heartbeatInterval);
      }

      // Handle abort signal
      const abortHandler = () => {
        if (resolved) return;
        resolved = true;
        console.log('[ClaudeCodeExecutor] Abort signal received');
        child.kill('SIGTERM');
        cleanup();
        resolve({
          success: false,
          output: stdout,
          error: 'Aborted by user',
          quotaExhausted: false,
          cliUnavailable: false,
          modelDowngraded: false,
          filesCreated: [],
          filesModified: []
        });
      };
      this.abortController?.signal.addEventListener('abort', abortHandler, { once: true });

      child.stdout.on('data', async (data) => {
        const chunk = data.toString();
        stdout += chunk;

        // Real-time streaming callback - call on EVERY chunk
        if (this.config.onStdout) {
          try {
            this.config.onStdout(chunk, stdout);
          } catch (e) {
            console.error('[ClaudeCodeExecutor] onStdout callback error:', e);
          }
        }

        // Log progress for long-running operations (every ~1000 chars)
        if (stdout.length % 1000 < 100) {
          console.log(`[ClaudeCodeExecutor] Received ${stdout.length} chars...`);
        }

        // Check for permission prompts (only if not already handling one)
        if (!permissionPending) {
          const permRequest = this.permissionDetector.detect(chunk);
          if (permRequest) {
            // Check for auto-response (safe prompts like continuation)
            const autoResponse = this.getAutoResponse(permRequest);
            if (autoResponse !== null) {
              console.log(`[ClaudeCodeExecutor] Auto-responding to ${permRequest.type || 'unknown'} prompt: "${autoResponse.replace(/\n/g, '\\n')}"`);
              if (child.stdin && !child.stdin.destroyed) {
                child.stdin.write(autoResponse);
              }
              this.permissionDetector.removePendingRequest(permRequest.id);
              return; // Skip Telegram routing
            }

            permissionPending = true;
            console.log(`[ClaudeCodeExecutor] Permission request detected: ${permRequest.tool}(${permRequest.command})`);

            try {
              const approved = await this.routePermissionToTelegram(permRequest);
              console.log(`[ClaudeCodeExecutor] Permission ${approved ? 'APPROVED' : 'DENIED'}`);

              // Inject response to stdin
              if (child.stdin && !child.stdin.destroyed) {
                child.stdin.write(approved ? 'y\n' : 'n\n');
              }
            } catch (error) {
              console.error('[ClaudeCodeExecutor] Permission routing failed:', error);
              // Default to deny on error
              if (child.stdin && !child.stdin.destroyed) {
                child.stdin.write('n\n');
              }
            } finally {
              permissionPending = false;
              this.permissionDetector.removePendingRequest(permRequest.id);
            }
          }
        }
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('error', (error) => {
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve({
          success: false,
          output: stdout,
          error: error.message,
          quotaExhausted: this.isQuotaExhausted(error.message),
          cliUnavailable: this.isCliUnavailable(error.message),
          modelDowngraded: this.isModelDowngraded(error.message),
          filesCreated: [],
          filesModified: []
        });
      });

      child.on('close', (code) => {
        if (resolved) return;
        resolved = true;
        cleanup();

        const output = stdout.trim();
        const errorOutput = stderr.trim();

        console.log(`[ClaudeCodeExecutor] CLI exited with code ${code}, output: ${output.length} chars`);

        // Parse file operations from output
        const { filesCreated, filesModified } = this.parseFileOperations(output);

        // Check for model downgrade in output
        const downgraded = this.isModelDowngraded(output) || this.isModelDowngraded(errorOutput);

        if (code === 0) {
          resolve({
            success: true,
            output,
            quotaExhausted: false,
            cliUnavailable: false,
            modelDowngraded: downgraded,
            filesCreated,
            filesModified
          });
        } else {
          resolve({
            success: false,
            output,
            error: errorOutput || `CLI exited with code ${code}`,
            quotaExhausted: this.isQuotaExhausted(errorOutput),
            cliUnavailable: false,
            modelDowngraded: downgraded,
            filesCreated,
            filesModified
          });
        }
      });

      // Handle timeout - only if configured (non-zero)
      if (this.config.timeout && this.config.timeout > 0) {
        timeoutId = setTimeout(() => {
          if (resolved) return;
          resolved = true;
          console.log(`[ClaudeCodeExecutor] Timeout after ${this.config.timeout}ms`);
          child.kill('SIGTERM');
          cleanup();
          resolve({
            success: false,
            output: stdout,
            error: 'Timeout exceeded',
            quotaExhausted: false,
            cliUnavailable: false,
            modelDowngraded: false,
            filesCreated: [],
            filesModified: []
          });
        }, this.config.timeout);
      }
    });
  }

  /**
   * Execute with file-based prompt (for long prompts)
   */
  async executeWithFile(prompt: string, systemPrompt?: string): Promise<ClaudeCodeResult> {
    const tempDir = join(tmpdir(), 'rubix-prompts');
    const promptFile = join(tempDir, `prompt-${randomUUID()}.md`);

    try {
      // Ensure temp directory exists
      if (!existsSync(tempDir)) {
        await mkdir(tempDir, { recursive: true });
      }

      // Write prompt to temp file
      const fullPrompt = systemPrompt
        ? `${systemPrompt}\n\n---\n\n${prompt}`
        : prompt;

      await writeFile(promptFile, fullPrompt, 'utf-8');

      // Execute with file reference
      const result = await this.executeWithFileRef(promptFile);

      return result;

    } finally {
      // Clean up temp file
      try {
        await unlink(promptFile);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Execute with a prompt file reference
   */
  private async executeWithFileRef(promptFile: string): Promise<ClaudeCodeResult> {
    return new Promise((resolve) => {
      const args: string[] = [
        '--print',
        '--output-format', 'text'
      ];

      if (this.config.model) {
        args.push('--model', this.config.model);
      }

      if (this.config.allowEdits) {
        args.push('--allowedTools', 'Edit,Write,Read,Glob,Grep,Bash,mcp__rubix__god_query,mcp__rubix__god_failure_query,mcp__rubix__god_store');
      }

      // Read prompt from file
      args.push(`Read the prompt from ${promptFile} and execute it.`);

      let stdout = '';
      let stderr = '';

      const child = spawn('claude', args, {
        cwd: this.config.cwd,
        shell: true,
        timeout: this.config.timeout,
        env: {
          ...process.env,
          CLAUDE_CODE_HEADLESS: '1'
        }
      });

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('error', (error) => {
        resolve({
          success: false,
          output: stdout,
          error: error.message,
          quotaExhausted: this.isQuotaExhausted(error.message),
          cliUnavailable: this.isCliUnavailable(error.message),
          modelDowngraded: this.isModelDowngraded(error.message),
          filesCreated: [],
          filesModified: []
        });
      });

      child.on('close', (code) => {
        const output = stdout.trim();
        const errorOutput = stderr.trim();
        const { filesCreated, filesModified } = this.parseFileOperations(output);
        const downgraded = this.isModelDowngraded(output) || this.isModelDowngraded(errorOutput);

        if (code === 0) {
          resolve({
            success: true,
            output,
            quotaExhausted: false,
            cliUnavailable: false,
            modelDowngraded: downgraded,
            filesCreated,
            filesModified
          });
        } else {
          resolve({
            success: false,
            output,
            error: errorOutput || `CLI exited with code ${code}`,
            quotaExhausted: this.isQuotaExhausted(errorOutput),
            cliUnavailable: false,
            modelDowngraded: downgraded,
            filesCreated,
            filesModified
          });
        }
      });
    });
  }

  /**
   * Check if error indicates quota exhaustion
   */
  private isQuotaExhausted(text: string): boolean {
    return QUOTA_EXHAUSTION_PATTERNS.some(pattern => pattern.test(text));
  }

  /**
   * Check if error indicates CLI unavailable
   */
  private isCliUnavailable(text: string): boolean {
    return CLI_UNAVAILABLE_PATTERNS.some(pattern => pattern.test(text));
  }

  /**
   * Check if output indicates model was downgraded from Opus
   */
  private isModelDowngraded(text: string): boolean {
    return MODEL_DOWNGRADE_PATTERNS.some(pattern => pattern.test(text));
  }

  /**
   * Parse file operations from CLI output
   */
  private parseFileOperations(output: string): { filesCreated: string[]; filesModified: string[] } {
    const filesCreated: string[] = [];
    const filesModified: string[] = [];

    // Look for common patterns in Claude Code output
    // Pattern: "Created file: path" or "Wrote to: path"
    const createPatterns = [
      /(?:created|wrote|writing|creating)\s+(?:file:?\s*)?['"]?([^\s'"]+)['"]?/gi,
      /(?:new file|created):\s*['"]?([^\s'"]+)['"]?/gi
    ];

    // Pattern: "Modified file: path" or "Updated: path"
    const modifyPatterns = [
      /(?:modified|updated|edited|changing)\s+(?:file:?\s*)?['"]?([^\s'"]+)['"]?/gi,
      /(?:changes? to|modified):\s*['"]?([^\s'"]+)['"]?/gi
    ];

    for (const pattern of createPatterns) {
      let match;
      while ((match = pattern.exec(output)) !== null) {
        const file = match[1];
        if (file && !filesCreated.includes(file) && this.looksLikeFilePath(file)) {
          filesCreated.push(file);
        }
      }
    }

    for (const pattern of modifyPatterns) {
      let match;
      while ((match = pattern.exec(output)) !== null) {
        const file = match[1];
        if (file && !filesModified.includes(file) && !filesCreated.includes(file) && this.looksLikeFilePath(file)) {
          filesModified.push(file);
        }
      }
    }

    return { filesCreated, filesModified };
  }

  /**
   * Check if string looks like a file path
   */
  private looksLikeFilePath(str: string): boolean {
    // Must contain a dot or slash
    if (!str.includes('.') && !str.includes('/') && !str.includes('\\')) {
      return false;
    }
    // Must not be a URL
    if (str.startsWith('http://') || str.startsWith('https://')) {
      return false;
    }
    // Must not be too long
    if (str.length > 200) {
      return false;
    }
    return true;
  }

  /**
   * Reset quota tracking (e.g., after waiting)
   */
  resetQuotaTracking(): void {
    this.consecutiveQuotaErrors = 0;
    this.lastQuotaError = null;
  }

  /**
   * Get current executor status
   */
  getStatus(): {
    cliAvailable: boolean | null;
    consecutiveQuotaErrors: number;
    inQuotaCooldown: boolean;
  } {
    return {
      cliAvailable: this.cliAvailable,
      consecutiveQuotaErrors: this.consecutiveQuotaErrors,
      inQuotaCooldown: this.shouldSkipCliDueToQuota()
    };
  }

  /**
   * Determine if a prompt should be auto-responded (safe prompts)
   * Returns the response string if auto-response is appropriate, null if routing to Telegram
   */
  private getAutoResponse(request: PermissionRequest): string | null {
    // Auto-continue for continuation prompts
    if (request.type === 'continuation') {
      return '\n';  // Send Enter
    }

    // Auto-yes for retry prompts (typically safe)
    if (request.type === 'retry') {
      return 'y\n';
    }

    // Auto-yes for low-risk confirmations (but NOT high-risk ones)
    if (request.type === 'confirmation') {
      // Check for high-risk indicators
      const highRiskPatterns = [
        /cannot be undone/i,
        /irreversible/i,
        /delete/i,
        /remove.*permanently/i,
        /force/i,
        /destructive/i,
        /overwrite all/i,
        /production/i,
        /deploy/i
      ];

      const isHighRisk = highRiskPatterns.some(p =>
        p.test(request.fullPrompt) || p.test(request.command)
      );

      if (!isHighRisk) {
        return 'y\n';
      }
    }

    // Route everything else to Telegram (permission, selection, input, high-risk confirmation)
    return null;
  }

  /**
   * Route a permission request to Telegram for user approval
   * Returns true if approved, false if denied
   */
  private async routePermissionToTelegram(request: PermissionRequest): Promise<boolean> {
    // If no communication manager, auto-deny
    if (!this.comms) {
      console.warn('[ClaudeCodeExecutor] No CommunicationManager - auto-denying permission');
      return false;
    }

    const escalation: Escalation = {
      id: request.id,
      taskId: request.instanceId,
      type: 'approval',
      title: '🔐 Claude Code Permission Request',
      context: PermissionDetector.formatForTelegram(request),
      options: [
        { label: 'Allow', description: 'Approve this action' },
        { label: 'Deny', description: 'Reject this action' }
      ],
      blocking: true,
      createdAt: request.timestamp
    };

    try {
      const response = await this.comms.escalate(escalation);

      if (!response) {
        console.log('[ClaudeCodeExecutor] No response to permission request - denying');
        return false;
      }

      // Check if user approved
      const approved = response.response?.toLowerCase().includes('allow') ||
                       response.selectedOption?.toLowerCase().includes('allow') ||
                       false;

      return approved;
    } catch (error) {
      console.error('[ClaudeCodeExecutor] Failed to route permission to Telegram:', error);
      return false;
    }
  }
}

export default ClaudeCodeExecutor;
