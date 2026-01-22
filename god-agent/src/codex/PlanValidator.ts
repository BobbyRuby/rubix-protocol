/**
 * PlanValidator - Phase 4: Claude validates the plan via API.
 *
 * VALIDATOR + GUARDIAN combined:
 * - Security scanning (OWASP Top 10)
 * - Code quality review
 * - Test coverage planning
 * - Performance checks
 *
 * Uses Anthropic API (Sonnet) - no CLI dependency.
 * Outputs: VAL token string
 */

import Anthropic from '@anthropic-ai/sdk';
import { COMPRESSION_SCHEMAS } from '../memory/CompressionSchemas.js';
import type { ContextBundle } from './ContextScout.js';
import type { DesignOutput, PlanOutput } from './ClaudeReasoner.js';
import type { MemoryEngine } from '../core/MemoryEngine.js';
import { getCodexLogger } from './Logger.js';
import type { SecurityFinding } from '../review/types.js';

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
 * Uses API calls instead of CLI for reliability.
 */
export class PlanValidator {
  private apiClient: Anthropic | null = null;
  private apiModel: string;
  private memoryEngine: MemoryEngine | null = null;

  constructor(
    codebasePath: string,
    apiKey?: string,
    memoryEngine?: MemoryEngine,
    apiModel?: string
  ) {
    // codebasePath available if needed in future
    void codebasePath;
    this.memoryEngine = memoryEngine || null;
    this.apiModel = apiModel || 'claude-sonnet-4-20250514';

    // Initialize API client
    const key = apiKey || process.env.ANTHROPIC_API_KEY;
    if (key) {
      this.apiClient = new Anthropic({ apiKey: key });
      console.log(`[PlanValidator] API client initialized (model: ${this.apiModel})`);
    } else {
      console.warn('[PlanValidator] No ANTHROPIC_API_KEY - validation will fail');
    }
  }

  /**
   * Validate the plan using Claude API.
   *
   * SECURITY CONSOLIDATION: CodeReviewer now handles deterministic OWASP scanning.
   * PlanValidator receives pre-scanned findings and focuses on:
   * - Type safety and error handling
   * - Logic correctness and edge cases
   * - Performance issues (N+1, memory leaks, blocking ops)
   * - Business logic security (auth bypass, privilege escalation)
   *
   * @param preScannedSecurity - Security findings from CodeReviewer (OWASP patterns)
   */
  async validate(
    context: ContextBundle,
    design: DesignOutput,
    plan: PlanOutput,
    preScannedSecurity?: SecurityFinding[]
  ): Promise<ValidationResult> {
    console.log(`[PlanValidator] Phase 4: Validating plan for task ${context.taskId}`);
    const logger = getCodexLogger();

    // Log validation start
    logger.logResponse(
      'VALIDATOR_START',
      `Validating plan for task: ${context.taskId}`,
      JSON.stringify({
        taskId: context.taskId,
        description: context.description,
        filesCount: plan.files.length,
        files: plan.files.map(f => ({ path: f.path, action: f.action })),
        commands: plan.commands
      }, null, 2),
      plan.files.length,
      plan.files.map(f => ({ path: f.path, action: f.action })),
      'validator'
    );

    // Pre-gather security patterns from memory if available
    let securityPatterns: string[] = [];
    if (this.memoryEngine) {
      try {
        const results = await this.memoryEngine.query('security vulnerabilities patterns OWASP', {
          topK: 5,
          minScore: 0.3
        });
        securityPatterns = results.map(r => r.entry.content.substring(0, 300));

        // Log security patterns found
        logger.logResponse(
          'VALIDATOR_SECURITY_PATTERNS',
          `Found ${securityPatterns.length} security patterns from memory`,
          JSON.stringify({
            patternsFound: securityPatterns.length,
            patterns: securityPatterns.map((p, i) => ({ index: i, preview: p.substring(0, 100) }))
          }, null, 2),
          securityPatterns.length,
          undefined,
          'validator'
        );
      } catch (error) {
        console.log('[PlanValidator] Memory query failed, continuing without patterns');

        logger.logResponse(
          'VALIDATOR_SECURITY_PATTERNS_ERROR',
          `Memory query failed`,
          JSON.stringify({
            error: error instanceof Error ? error.message : String(error)
          }, null, 2),
          0,
          undefined,
          'validator',
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    const prompt = this.buildValidationPrompt(context, design, plan, securityPatterns, preScannedSecurity);

    // Log the full validation prompt
    logger.logResponse(
      'VALIDATOR_PROMPT',
      `Validation prompt for ${context.taskId}`,
      prompt,
      plan.files.length,
      plan.files.map(f => ({ path: f.path, action: f.action })),
      'validator'
    );

    try {
      const apiOutput = await this.executeApi(prompt);
      const result = this.parseValidationOutput(apiOutput);

      // Log API response
      logger.logResponse(
        'VALIDATOR_API_RESPONSE',
        `API response for ${context.taskId}`,
        apiOutput,
        0,
        undefined,
        'validator'
      );

      // Log parsed validation result details
      logger.logResponse(
        'VALIDATOR_PARSED_RESULT',
        `Validation result: ${result.approved ? 'APPROVED' : 'REJECTED'}`,
        JSON.stringify({
          approved: result.approved,
          compressedToken: result.compressedToken,
          tests: result.tests,
          securityIssuesCount: result.securityIssues.length,
          securityIssues: result.securityIssues,
          performanceIssuesCount: result.performanceIssues.length,
          performanceIssues: result.performanceIssues,
          requiredModificationsCount: result.requiredMods.length,
          requiredModifications: result.requiredMods,
          blockersCount: result.blockers.length,
          blockers: result.blockers
        }, null, 2),
        0,
        result.requiredMods.map(m => ({ path: m.path, action: 'requires_modification' })),
        'validator'
      );

      return result;
    } catch (error) {
      // Log error before throwing
      logger.logResponse(
        'VALIDATOR_ERROR',
        `Validation failed`,
        JSON.stringify({
          taskId: context.taskId,
          error: error instanceof Error ? error.message : String(error)
        }, null, 2),
        0,
        undefined,
        'validator',
        error instanceof Error ? error.message : String(error)
      );
      console.error('[PlanValidator] Validation failed:', error);
      throw error;
    }
  }

  /**
   * Build the validation prompt with pre-gathered context.
   *
   * SECURITY CONSOLIDATION: CodeReviewer handles deterministic OWASP scanning.
   * This prompt now focuses on quality/logic and contextual security checks.
   */
  private buildValidationPrompt(
    context: ContextBundle,
    design: DesignOutput,
    plan: PlanOutput,
    securityPatterns: string[],
    preScannedSecurity?: SecurityFinding[]
  ): string {
    // Build file contents summary
    const filesSummary = plan.files.map(f =>
      `### ${f.path} (${f.action})\n\`\`\`typescript\n${f.content.substring(0, 1000)}${f.content.length > 1000 ? '\n// ... truncated ...' : ''}\n\`\`\``
    ).join('\n\n');

    // Format security patterns from memory
    const memoryPatternsSection = securityPatterns.length > 0
      ? `## SECURITY PATTERNS (from memory)\n${securityPatterns.map((p, i) => `${i + 1}. ${p}`).join('\n\n')}\n`
      : '';

    // Format pre-scanned security findings from CodeReviewer
    const preScannedSection = preScannedSecurity && preScannedSecurity.length > 0
      ? `## SECURITY SCAN RESULTS (from CodeReviewer - OWASP patterns)
**${preScannedSecurity.length} issues found - these are ALREADY DETECTED and will be addressed in the fix loop:**

${preScannedSecurity.map((f, i) => `${i + 1}. **[${f.severity.toUpperCase()}]** ${f.type}: ${f.description}
   - File: ${f.file}:${f.line}
   - Remediation: ${f.remediation}`).join('\n\n')}

**DO NOT re-scan for these pattern-based issues.** Focus on quality, logic, and contextual security below.
`
      : `## SECURITY SCAN RESULTS
No pattern-based security issues detected by CodeReviewer.
`;

    return `# VALIDATOR - Quality & Logic Review Phase

## Your Role
You are the VALIDATOR focused on:
1. **Quality** - Type safety, error handling, code patterns
2. **Logic** - Correctness, edge cases, business logic
3. **Performance** - N+1 queries, memory leaks, blocking operations
4. **Contextual Security** - Auth bypass, privilege escalation, business logic flaws

**IMPORTANT:** Pattern-based security scanning (OWASP Top 10: SQL injection, XSS, hardcoded secrets, etc.)
has ALREADY been performed by CodeReviewer. Do NOT duplicate that work.

${preScannedSection}
${memoryPatternsSection}
## Context Tokens
${context.compressedToken}

## Design Tokens
${design.compressedToken}

## Plan Tokens
${plan.compressedToken}

## Files to Review

${filesSummary}

## Review Checklist

### Quality (YOUR FOCUS)
- [ ] Type safety - proper typing, no unsafe casts
- [ ] Error handling - try/catch, error boundaries, proper error messages
- [ ] Edge cases - null/undefined, empty arrays, boundary conditions
- [ ] Code patterns - matches existing codebase conventions

### Logic Correctness (YOUR FOCUS)
- [ ] Business logic - does it do what it's supposed to?
- [ ] State management - race conditions, stale data
- [ ] Data flow - correct transformations, no data loss

### Performance (YOUR FOCUS)
- [ ] N+1 queries - database access patterns
- [ ] Memory leaks - event listeners, subscriptions cleanup
- [ ] Blocking operations - async/await usage, no main thread blocking

### Contextual Security (YOUR FOCUS - not pattern-based)
- [ ] Auth bypass - logic flaws that skip authentication
- [ ] Privilege escalation - access to data/actions user shouldn't have
- [ ] Business logic abuse - misuse of valid functionality

## Required Output

### APPROVAL
APPROVED or REJECTED

### TESTS
List test types needed:
- unit
- integration
- e2e

### SECURITY_ISSUES
List any CONTEXTUAL security issues found (NOT pattern-based, those are handled):
- auth_bypass: Description
- privilege_escalation: Description

### PERFORMANCE_ISSUES
List any performance issues:
- n+1: Description
- blocking: Description

### REQUIRED_MODIFICATIONS
If issues found, list required fixes:
- MODIFY: path/to/file.ts: description of change needed

### BLOCKERS
List any blockers requiring human review:
- need_schema_review
- complex_auth_logic_needs_review

Provide ONLY the structured sections above.`;
  }

  /**
   * Execute Claude API with the validation prompt.
   */
  private async executeApi(prompt: string): Promise<string> {
    if (!this.apiClient) {
      throw new Error('[PlanValidator] API client not initialized - missing ANTHROPIC_API_KEY');
    }

    console.log(`[PlanValidator] Executing API Sonnet (${this.apiModel})...`);

    const response = await this.apiClient.messages.create({
      model: this.apiModel,
      max_tokens: 4096,
      messages: [
        { role: 'user', content: prompt }
      ]
    });

    // Extract text from response
    const textBlock = response.content.find(block => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('[PlanValidator] No text response from Claude API');
    }

    console.log(`[PlanValidator] API Sonnet completed: ${textBlock.text.length} chars`);
    console.log(`[PlanValidator] Usage: ${response.usage?.input_tokens || 0} in, ${response.usage?.output_tokens || 0} out`);

    return textBlock.text;
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
export function createPlanValidator(
  codebasePath: string,
  apiKey?: string,
  memoryEngine?: MemoryEngine,
  apiModel?: string
): PlanValidator {
  return new PlanValidator(codebasePath, apiKey, memoryEngine, apiModel);
}
