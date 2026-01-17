/**
 * PlanValidator - Phase 4: Claude validates the plan.
 *
 * VALIDATOR + GUARDIAN combined:
 * - Security scanning (OWASP Top 10)
 * - Code quality review
 * - Test coverage planning
 * - Performance checks
 *
 * Outputs: VAL token string
 */

import { spawn } from 'child_process';
import { COMPRESSION_SCHEMAS } from '../memory/CompressionSchemas.js';
import type { ContextBundle } from './ContextScout.js';
import type { DesignOutput, PlanOutput } from './ClaudeReasoner.js';

/**
 * Validation result from Phase 4.
 */
export interface ValidationResult {
  approved: boolean;
  tests: string[];
  securityIssues: string[];
  performanceIssues: string[];
  requiredMods: Array<{ path: string; change: string }>;
  blockers: string[];
  compressedToken: string;  // VAL|...|...
}

/**
 * PlanValidator validates the execution plan before running.
 */
export class PlanValidator {
  private codebasePath: string;
  private cliTimeout: number;

  constructor(codebasePath: string, cliTimeout = 300000) {
    this.codebasePath = codebasePath;
    this.cliTimeout = cliTimeout;
  }

  /**
   * Validate the plan using Claude Code CLI.
   */
  async validate(
    context: ContextBundle,
    design: DesignOutput,
    plan: PlanOutput
  ): Promise<ValidationResult> {
    console.log(`[PlanValidator] Phase 4: Validating plan for task ${context.taskId}`);

    const prompt = this.buildValidationPrompt(context, design, plan);
    const cliOutput = await this.executeClaudeCLI(prompt);
    return this.parseValidationOutput(cliOutput);
  }

  /**
   * Build the validation prompt.
   */
  private buildValidationPrompt(
    context: ContextBundle,
    design: DesignOutput,
    plan: PlanOutput
  ): string {
    // Build file contents summary
    const filesSummary = plan.files.map(f =>
      `### ${f.path} (${f.action})\n\`\`\`typescript\n${f.content.substring(0, 500)}${f.content.length > 500 ? '\n// ... truncated ...' : ''}\n\`\`\``
    ).join('\n\n');

    return `# VALIDATOR + GUARDIAN - Review Phase

## Your Role
You are VALIDATOR (quality) and GUARDIAN (security) combined.
Review the proposed code changes for issues.

## MEMORY RECALL (Do this FIRST)
Before reviewing, query memory for relevant context:
- mcp__rubix__god_query "security vulnerabilities {file_type}" - Past security issues in similar code
- mcp__rubix__god_query "validation failures" - Previous validation failures to avoid
- mcp__rubix__god_query "code patterns {domain}" - Established patterns in this codebase

Use memory to inform your review. Don't repeat past mistakes.

## Context Tokens
${context.compressedToken}

## Design Tokens
${design.compressedToken}

## Plan Tokens
${plan.compressedToken}

## Files to Review

${filesSummary}

## Review Checklist

### Security (OWASP Top 10)
- [ ] Injection vulnerabilities (SQL, XSS, command)
- [ ] Broken authentication
- [ ] Sensitive data exposure
- [ ] Hardcoded secrets
- [ ] CSRF/SSRF vulnerabilities

### Quality
- [ ] Type safety
- [ ] Error handling
- [ ] Edge cases
- [ ] Code patterns match existing codebase

### Performance
- [ ] N+1 queries
- [ ] Memory leaks
- [ ] Blocking operations

## Required Output

### APPROVAL
APPROVED or REJECTED

### TESTS
List test types needed:
- unit
- integration
- e2e

### SECURITY_ISSUES
List any security issues found:
- xss: Description
- sqli: Description

### PERFORMANCE_ISSUES
List any performance issues:
- n+1: Description
- blocking: Description

### REQUIRED_MODIFICATIONS
If issues found, list required fixes:
- MODIFY: path/to/file.ts: add input sanitization

### BLOCKERS
List any blockers requiring human review:
- need_schema_review
- security_audit_required

Provide ONLY the structured sections above.`;
  }

  /**
   * Execute Claude Code CLI for validation.
   */
  private async executeClaudeCLI(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = [
        '-p', prompt,
        '--dangerously-skip-permissions',
        '--allowedTools', 'Read,Grep,mcp__rubix__god_query'  // Includes memory for past security issues
      ];

      console.log('[PlanValidator] Executing Claude Code CLI...');

      const child = spawn('claude', args, {
        cwd: this.codebasePath,
        shell: false,                    // Direct execution (not through cmd.exe)
        windowsHide: true,               // No console window on Windows
        stdio: ['pipe', 'pipe', 'pipe'], // Explicit pipe configuration
        env: process.env                 // Full environment inheritance
      });

      let stdout = '';
      let stderr = '';
      let resolved = false;

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (resolved) return;
        resolved = true;
        if (code === 0) {
          resolve(stdout);
        } else {
          console.error('[PlanValidator] CLI stderr:', stderr);
          reject(new Error(`Claude CLI exited with code ${code}: ${stderr}`));
        }
      });

      child.on('error', (error) => {
        if (resolved) return;
        resolved = true;
        reject(new Error(`Failed to spawn Claude CLI: ${error.message}`));
      });

      // Manual timeout (more reliable than spawn timeout option)
      setTimeout(() => {
        if (resolved) return;
        resolved = true;
        child.kill('SIGTERM');
        reject(new Error(`Claude CLI timed out after ${this.cliTimeout}ms`));
      }, this.cliTimeout);
    });
  }

  /**
   * Parse validation output to ValidationResult.
   */
  private parseValidationOutput(output: string): ValidationResult {
    const result: ValidationResult = {
      approved: false,
      tests: [],
      securityIssues: [],
      performanceIssues: [],
      requiredMods: [],
      blockers: [],
      compressedToken: ''
    };

    // Parse APPROVAL
    const approvalMatch = output.match(/### APPROVAL\n\s*(APPROVED|REJECTED)/i);
    result.approved = approvalMatch?.[1]?.toUpperCase() === 'APPROVED';

    // Parse TESTS
    const testsMatch = output.match(/### TESTS\n([\s\S]*?)(?=###|$)/);
    if (testsMatch) {
      for (const match of testsMatch[1].matchAll(/^-\s*(\w+)/gm)) {
        result.tests.push(match[1]);
      }
    }

    // Parse SECURITY_ISSUES
    const secMatch = output.match(/### SECURITY_ISSUES\n([\s\S]*?)(?=###|$)/);
    if (secMatch) {
      for (const match of secMatch[1].matchAll(/^-\s*(\w+):/gm)) {
        result.securityIssues.push(match[1]);
      }
    }

    // Parse PERFORMANCE_ISSUES
    const perfMatch = output.match(/### PERFORMANCE_ISSUES\n([\s\S]*?)(?=###|$)/);
    if (perfMatch) {
      for (const match of perfMatch[1].matchAll(/^-\s*(\w+):/gm)) {
        result.performanceIssues.push(match[1]);
      }
    }

    // Parse REQUIRED_MODIFICATIONS
    const modsMatch = output.match(/### REQUIRED_MODIFICATIONS\n([\s\S]*?)(?=###|$)/);
    if (modsMatch) {
      for (const match of modsMatch[1].matchAll(/^-\s*MODIFY:\s*([\w/.]+):\s*(.+)$/gm)) {
        result.requiredMods.push({ path: match[1], change: match[2] });
      }
    }

    // Parse BLOCKERS
    const blockMatch = output.match(/### BLOCKERS\n([\s\S]*?)(?=###|$)/);
    if (blockMatch) {
      for (const match of blockMatch[1].matchAll(/^-\s*(\w+)/gm)) {
        result.blockers.push(match[1]);
      }
    }

    // Compress to VAL token
    const valInput = [
      result.approved ? 'approved' : 'rejected',
      `tests: ${result.tests.join(', ')}`,
      result.securityIssues.length > 0 ? `security: ${result.securityIssues.join(', ')}` : '',
      result.performanceIssues.length > 0 ? `performance: ${result.performanceIssues.join(', ')}` : '',
      result.requiredMods.length > 0 ? `modify: ${result.requiredMods.map(m => `${m.path}:${m.change}`).join(', ')}` : '',
      result.blockers.length > 0 ? `blockers: ${result.blockers.join(', ')}` : ''
    ].filter(Boolean).join('\n');

    result.compressedToken = COMPRESSION_SCHEMAS.validation.encode(valInput);

    console.log(`[PlanValidator] Generated VAL token: ${result.compressedToken.substring(0, 80)}...`);
    console.log(`[PlanValidator] Approved: ${result.approved}, Issues: sec=${result.securityIssues.length} perf=${result.performanceIssues.length}`);

    return result;
  }
}

// Factory function
export function createPlanValidator(codebasePath: string): PlanValidator {
  return new PlanValidator(codebasePath);
}
