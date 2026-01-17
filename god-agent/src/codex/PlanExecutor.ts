/**
 * PlanExecutor - Phase 5: Local TypeScript execution.
 *
 * Executes the plan without any LLM calls:
 * - Creates/modifies/deletes files using fs
 * - Runs shell commands using execSync
 * - Applies validation modifications
 *
 * No AI, pure mechanical execution of the PLAN tokens.
 */

import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { execSync } from 'child_process';
import type { PlanOutput, FileContent } from './ClaudeReasoner.js';
import type { ValidationResult } from './PlanValidator.js';

/**
 * Execution result from Phase 5.
 */
export interface ExecutionResult {
  success: boolean;
  filesWritten: number;
  filesModified: number;
  filesDeleted: number;
  commandsRun: number;
  errors: ExecutionError[];
  compressedToken: string;  // EXEC|ok:1|files:3|cmds:2|errs:0
}

/**
 * Error during execution.
 */
export interface ExecutionError {
  type: 'file' | 'command';
  operation: string;
  path: string;
  message: string;
}

/**
 * PlanExecutor runs the plan locally.
 */
export class PlanExecutor {
  private codebasePath: string;
  private dryRun: boolean;

  constructor(codebasePath: string, dryRun = false) {
    this.codebasePath = resolve(codebasePath);
    this.dryRun = dryRun;
  }

  /**
   * Execute the plan.
   *
   * @param plan - The execution plan from ENGINEER
   * @param validation - The validation result (for any required mods)
   */
  async execute(plan: PlanOutput, validation?: ValidationResult): Promise<ExecutionResult> {
    console.log(`[PlanExecutor] Phase 5: Executing plan (dryRun=${this.dryRun})`);
    console.log(`[PlanExecutor] Operations: ${plan.operations.length}, Commands: ${plan.commands.length}`);

    const result: ExecutionResult = {
      success: true,
      filesWritten: 0,
      filesModified: 0,
      filesDeleted: 0,
      commandsRun: 0,
      errors: [],
      compressedToken: ''
    };

    // Execute file operations
    for (const file of plan.files) {
      try {
        await this.executeFileOperation(file);

        if (file.action === 'create') {
          result.filesWritten++;
        } else if (file.action === 'modify') {
          result.filesModified++;
        } else if (file.action === 'delete') {
          result.filesDeleted++;
        }
      } catch (error) {
        const err: ExecutionError = {
          type: 'file',
          operation: file.action,
          path: file.path,
          message: error instanceof Error ? error.message : String(error)
        };
        result.errors.push(err);
        result.success = false;
        console.error(`[PlanExecutor] File error: ${err.message}`);
      }
    }

    // Apply validation modifications if any
    if (validation?.requiredMods) {
      for (const mod of validation.requiredMods) {
        console.log(`[PlanExecutor] Applying validation mod: ${mod.path} - ${mod.change}`);
        // Modifications would be applied here
        // For now, we just log them
      }
    }

    // Execute commands
    for (const cmd of plan.commands) {
      try {
        await this.executeCommand(cmd);
        result.commandsRun++;
      } catch (error) {
        const err: ExecutionError = {
          type: 'command',
          operation: 'run',
          path: cmd,
          message: error instanceof Error ? error.message : String(error)
        };
        result.errors.push(err);
        result.success = false;
        console.error(`[PlanExecutor] Command error: ${err.message}`);
      }
    }

    // Generate compressed token
    result.compressedToken = this.generateExecToken(result);

    console.log(`[PlanExecutor] Result: ${result.compressedToken}`);

    return result;
  }

  /**
   * Execute a file operation.
   */
  private async executeFileOperation(file: FileContent): Promise<void> {
    const fullPath = join(this.codebasePath, file.path);

    if (this.dryRun) {
      console.log(`[PlanExecutor] DRY RUN: ${file.action} ${fullPath}`);
      return;
    }

    switch (file.action) {
      case 'create':
        // Ensure directory exists
        const dir = dirname(fullPath);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
          console.log(`[PlanExecutor] Created directory: ${dir}`);
        }

        writeFileSync(fullPath, file.content, 'utf-8');
        console.log(`[PlanExecutor] Created: ${file.path}`);
        break;

      case 'modify':
        if (!existsSync(fullPath)) {
          throw new Error(`File does not exist: ${file.path}`);
        }
        writeFileSync(fullPath, file.content, 'utf-8');
        console.log(`[PlanExecutor] Modified: ${file.path}`);
        break;

      case 'delete':
        if (existsSync(fullPath)) {
          unlinkSync(fullPath);
          console.log(`[PlanExecutor] Deleted: ${file.path}`);
        } else {
          console.warn(`[PlanExecutor] File already deleted: ${file.path}`);
        }
        break;

      default:
        throw new Error(`Unknown action: ${file.action}`);
    }
  }

  /**
   * Execute a shell command.
   */
  private async executeCommand(cmd: string): Promise<void> {
    // Normalize command (e.g., npm.test -> npm test)
    const normalizedCmd = cmd.replace(/\./g, ' ');

    if (this.dryRun) {
      console.log(`[PlanExecutor] DRY RUN: ${normalizedCmd}`);
      return;
    }

    console.log(`[PlanExecutor] Running: ${normalizedCmd}`);

    try {
      const output = execSync(normalizedCmd, {
        cwd: this.codebasePath,
        encoding: 'utf-8',
        timeout: 120000,  // 2 minute timeout
        stdio: ['pipe', 'pipe', 'pipe']
      });

      if (output) {
        console.log(`[PlanExecutor] Command output:\n${output.substring(0, 500)}`);
      }
    } catch (error: any) {
      // execSync throws on non-zero exit code
      const stderr = error.stderr?.toString() || '';
      const stdout = error.stdout?.toString() || '';
      throw new Error(`Command failed: ${stderr || stdout || error.message}`);
    }
  }

  /**
   * Generate EXEC token from result.
   */
  private generateExecToken(result: ExecutionResult): string {
    const ok = result.success ? '1' : '0';
    const files = result.filesWritten + result.filesModified + result.filesDeleted;
    const cmds = result.commandsRun;
    const errs = result.errors.length > 0
      ? result.errors[0].message.substring(0, 30).replace(/[|:]/g, '_')
      : '';

    return `EXEC|ok:${ok}|files:${files}|cmds:${cmds}|errs:${errs || '0'}`;
  }

  /**
   * Parse PLAN tokens to operations (for external use).
   */
  static parsePlanTokens(planToken: string): {
    department: string;
    operations: Array<{ action: string; path: string }>;
    commands: string[];
    confidence: number;
  } {
    const parts = planToken.split('|');
    // PLAN|dept|ops|cmd:...|conf:...|notes

    const department = parts[1] || 'eng';
    const operations: Array<{ action: string; path: string }> = [];
    const commands: string[] = [];
    let confidence = 0.8;

    // Parse operations (position 2)
    if (parts[2]) {
      const ops = parts[2].split(',');
      for (const op of ops) {
        const [action, path] = op.split(':');
        if (action && path) {
          operations.push({ action, path });
        }
      }
    }

    // Parse commands (position 3)
    if (parts[3]?.startsWith('cmd:')) {
      const cmdStr = parts[3].replace('cmd:', '');
      if (cmdStr) {
        commands.push(...cmdStr.split(',').map(c => c.replace(/\./g, ' ')));
      }
    }

    // Parse confidence (position 4)
    if (parts[4]?.startsWith('conf:')) {
      confidence = parseFloat(parts[4].replace('conf:', '')) || 0.8;
    }

    return { department, operations, commands, confidence };
  }
}

// Factory function
export function createPlanExecutor(codebasePath: string, dryRun = false): PlanExecutor {
  return new PlanExecutor(codebasePath, dryRun);
}
