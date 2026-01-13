/**
 * ClaudeCodeExecutor
 *
 * Executes code generation via Claude Code CLI (uses Max subscription).
 * Falls back to direct API when CLI unavailable or quota exhausted.
 */
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
const execAsync = promisify(exec);
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
 * ClaudeCodeExecutor - Execute via Claude Code CLI with API fallback support
 */
export class ClaudeCodeExecutor {
    config;
    cliAvailable = null;
    consecutiveQuotaErrors = 0;
    lastQuotaError = null;
    constructor(config) {
        this.config = {
            timeout: 5 * 60 * 1000, // 5 minutes default
            model: 'opus',
            allowEdits: true,
            ...config
        };
    }
    /**
     * Check if Claude Code CLI is available
     */
    async checkCliAvailable() {
        if (this.cliAvailable !== null) {
            return this.cliAvailable;
        }
        try {
            // Try to get claude version
            await execAsync('claude --version', { timeout: 10000 });
            this.cliAvailable = true;
            console.log('[ClaudeCodeExecutor] Claude CLI is available');
            return true;
        }
        catch (error) {
            console.log('[ClaudeCodeExecutor] Claude CLI not available:', error);
            this.cliAvailable = false;
            return false;
        }
    }
    /**
     * Check if we should skip CLI due to recent quota errors
     */
    shouldSkipCliDueToQuota() {
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
    async execute(prompt, systemPrompt) {
        // Check if CLI is available
        const cliAvailable = await this.checkCliAvailable();
        if (!cliAvailable) {
            return {
                success: false,
                output: '',
                error: 'Claude CLI not available',
                quotaExhausted: false,
                cliUnavailable: true,
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
                    quotaExhausted: true
                };
            }
            // Success - reset quota error counter
            if (result.success) {
                this.consecutiveQuotaErrors = 0;
            }
            return result;
        }
        catch (error) {
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
                filesCreated: [],
                filesModified: []
            };
        }
    }
    /**
     * Run Claude CLI with the given prompt
     */
    async runCli(prompt, systemPrompt) {
        return new Promise((resolve) => {
            const args = [
                '--print', // Non-interactive, print output
                '--output-format', 'text' // Plain text output
            ];
            // Add model preference
            if (this.config.model) {
                args.push('--model', this.config.model);
            }
            // Add allowedTools if edits allowed
            if (this.config.allowEdits) {
                args.push('--allowedTools', 'Edit,Write,Read,Glob,Grep,Bash');
            }
            // Build the full prompt with system context
            let fullPrompt = prompt;
            if (systemPrompt) {
                fullPrompt = `${systemPrompt}\n\n---\n\n${prompt}`;
            }
            // Add the prompt
            args.push(fullPrompt);
            console.log(`[ClaudeCodeExecutor] Running: claude ${args.slice(0, 3).join(' ')} ...`);
            console.log(`[ClaudeCodeExecutor] Working directory: ${this.config.cwd}`);
            let stdout = '';
            let stderr = '';
            const child = spawn('claude', args, {
                cwd: this.config.cwd,
                shell: true,
                timeout: this.config.timeout,
                env: {
                    ...process.env,
                    // Ensure non-interactive mode
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
                    filesCreated: [],
                    filesModified: []
                });
            });
            child.on('close', (code) => {
                const output = stdout.trim();
                const errorOutput = stderr.trim();
                // Parse file operations from output
                const { filesCreated, filesModified } = this.parseFileOperations(output);
                if (code === 0) {
                    resolve({
                        success: true,
                        output,
                        quotaExhausted: false,
                        cliUnavailable: false,
                        filesCreated,
                        filesModified
                    });
                }
                else {
                    resolve({
                        success: false,
                        output,
                        error: errorOutput || `CLI exited with code ${code}`,
                        quotaExhausted: this.isQuotaExhausted(errorOutput),
                        cliUnavailable: false,
                        filesCreated,
                        filesModified
                    });
                }
            });
            // Handle timeout
            setTimeout(() => {
                child.kill('SIGTERM');
                resolve({
                    success: false,
                    output: stdout,
                    error: 'Timeout exceeded',
                    quotaExhausted: false,
                    cliUnavailable: false,
                    filesCreated: [],
                    filesModified: []
                });
            }, this.config.timeout);
        });
    }
    /**
     * Execute with file-based prompt (for long prompts)
     */
    async executeWithFile(prompt, systemPrompt) {
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
        }
        finally {
            // Clean up temp file
            try {
                await unlink(promptFile);
            }
            catch {
                // Ignore cleanup errors
            }
        }
    }
    /**
     * Execute with a prompt file reference
     */
    async executeWithFileRef(promptFile) {
        return new Promise((resolve) => {
            const args = [
                '--print',
                '--output-format', 'text'
            ];
            if (this.config.model) {
                args.push('--model', this.config.model);
            }
            if (this.config.allowEdits) {
                args.push('--allowedTools', 'Edit,Write,Read,Glob,Grep,Bash');
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
                    filesCreated: [],
                    filesModified: []
                });
            });
            child.on('close', (code) => {
                const output = stdout.trim();
                const errorOutput = stderr.trim();
                const { filesCreated, filesModified } = this.parseFileOperations(output);
                if (code === 0) {
                    resolve({
                        success: true,
                        output,
                        quotaExhausted: false,
                        cliUnavailable: false,
                        filesCreated,
                        filesModified
                    });
                }
                else {
                    resolve({
                        success: false,
                        output,
                        error: errorOutput || `CLI exited with code ${code}`,
                        quotaExhausted: this.isQuotaExhausted(errorOutput),
                        cliUnavailable: false,
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
    isQuotaExhausted(text) {
        return QUOTA_EXHAUSTION_PATTERNS.some(pattern => pattern.test(text));
    }
    /**
     * Check if error indicates CLI unavailable
     */
    isCliUnavailable(text) {
        return CLI_UNAVAILABLE_PATTERNS.some(pattern => pattern.test(text));
    }
    /**
     * Parse file operations from CLI output
     */
    parseFileOperations(output) {
        const filesCreated = [];
        const filesModified = [];
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
    looksLikeFilePath(str) {
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
    resetQuotaTracking() {
        this.consecutiveQuotaErrors = 0;
        this.lastQuotaError = null;
    }
    /**
     * Get current executor status
     */
    getStatus() {
        return {
            cliAvailable: this.cliAvailable,
            consecutiveQuotaErrors: this.consecutiveQuotaErrors,
            inQuotaCooldown: this.shouldSkipCliDueToQuota()
        };
    }
}
export default ClaudeCodeExecutor;
