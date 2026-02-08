/**
 * ConsoleCapture
 *
 * Utility for analyzing captured console messages and page errors.
 * Provides pattern matching, filtering, and summarization.
 */

import type {
  CapturedConsoleMessage,
  CapturedPageError,
  ConsoleSummary,
  ConsoleCheckParams,
} from './types.js';

/**
 * Console analysis result
 */
export interface ConsoleAnalysis {
  hasErrors: boolean;
  hasWarnings: boolean;
  errorCount: number;
  warningCount: number;
  errors: CapturedConsoleMessage[];
  warnings: CapturedConsoleMessage[];
  pageErrors: CapturedPageError[];
  matchedPatterns: { pattern: string; matches: CapturedConsoleMessage[] }[];
  forbiddenMatches: { pattern: string; matches: CapturedConsoleMessage[] }[];
  summary: string;
}

/**
 * ConsoleCapture - Analyze and filter console output
 */
export class ConsoleCapture {
  /**
   * Analyze console messages against check parameters
   */
  static analyze(
    summary: ConsoleSummary,
    params: ConsoleCheckParams = {}
  ): ConsoleAnalysis {
    const errors = summary.messages.filter((m) => m.type === 'error');
    const warnings = summary.messages.filter((m) => m.type === 'warning');

    // Find pattern matches
    const matchedPatterns: ConsoleAnalysis['matchedPatterns'] = [];
    if (params.expectedPatterns) {
      for (const pattern of params.expectedPatterns) {
        const regex = new RegExp(pattern, 'i');
        const matches = summary.messages.filter((m) => regex.test(m.text));
        matchedPatterns.push({ pattern, matches });
      }
    }

    // Find forbidden pattern matches
    const forbiddenMatches: ConsoleAnalysis['forbiddenMatches'] = [];
    if (params.forbiddenPatterns) {
      for (const pattern of params.forbiddenPatterns) {
        const regex = new RegExp(pattern, 'i');
        const matches = summary.messages.filter((m) => regex.test(m.text));
        forbiddenMatches.push({ pattern, matches });
      }
    }

    // Build summary text
    const summaryParts: string[] = [];

    if (errors.length > 0) {
      summaryParts.push(`${errors.length} error(s)`);
    }
    if (warnings.length > 0) {
      summaryParts.push(`${warnings.length} warning(s)`);
    }
    if (summary.pageErrors.length > 0) {
      summaryParts.push(`${summary.pageErrors.length} uncaught exception(s)`);
    }

    const hasForbidden = forbiddenMatches.some((m) => m.matches.length > 0);
    if (hasForbidden) {
      summaryParts.push('forbidden patterns found');
    }

    const summaryText =
      summaryParts.length > 0
        ? `Console issues: ${summaryParts.join(', ')}`
        : 'Console clean - no errors or warnings';

    return {
      hasErrors: errors.length > 0 || summary.pageErrors.length > 0,
      hasWarnings: warnings.length > 0,
      errorCount: errors.length + summary.pageErrors.length,
      warningCount: warnings.length,
      errors,
      warnings,
      pageErrors: summary.pageErrors,
      matchedPatterns,
      forbiddenMatches,
      summary: summaryText,
    };
  }

  /**
   * Check if console passes the given parameters
   */
  static passes(
    summary: ConsoleSummary,
    params: ConsoleCheckParams
  ): { passed: boolean; reason?: string } {
    const analysis = this.analyze(summary, params);

    // Check for errors
    if (params.noErrors && analysis.hasErrors) {
      const errorMessages = analysis.errors
        .slice(0, 3)
        .map((e) => e.text)
        .join('; ');
      return {
        passed: false,
        reason: `Console has ${analysis.errorCount} error(s): ${errorMessages}`,
      };
    }

    // Check for warnings
    if (params.noWarnings && analysis.hasWarnings) {
      const warningMessages = analysis.warnings
        .slice(0, 3)
        .map((w) => w.text)
        .join('; ');
      return {
        passed: false,
        reason: `Console has ${analysis.warningCount} warning(s): ${warningMessages}`,
      };
    }

    // Check expected patterns are present
    if (params.expectedPatterns) {
      for (const pm of analysis.matchedPatterns) {
        if (pm.matches.length === 0) {
          return {
            passed: false,
            reason: `Expected pattern not found: ${pm.pattern}`,
          };
        }
      }
    }

    // Check forbidden patterns are absent
    if (params.forbiddenPatterns) {
      for (const pm of analysis.forbiddenMatches) {
        if (pm.matches.length > 0) {
          return {
            passed: false,
            reason: `Forbidden pattern found: ${pm.pattern} (${pm.matches.length} occurrence(s))`,
          };
        }
      }
    }

    return { passed: true };
  }

  /**
   * Filter console messages by type
   */
  static filterByType(
    messages: CapturedConsoleMessage[],
    types: CapturedConsoleMessage['type'][]
  ): CapturedConsoleMessage[] {
    return messages.filter((m) => types.includes(m.type));
  }

  /**
   * Filter console messages by pattern
   */
  static filterByPattern(
    messages: CapturedConsoleMessage[],
    pattern: string | RegExp
  ): CapturedConsoleMessage[] {
    const regex = typeof pattern === 'string' ? new RegExp(pattern, 'i') : pattern;
    return messages.filter((m) => regex.test(m.text));
  }

  /**
   * Get unique error messages (deduplicated)
   */
  static getUniqueErrors(
    messages: CapturedConsoleMessage[],
    pageErrors: CapturedPageError[]
  ): string[] {
    const errors = new Set<string>();

    for (const m of messages) {
      if (m.type === 'error') {
        errors.add(m.text);
      }
    }

    for (const e of pageErrors) {
      errors.add(e.message);
    }

    return Array.from(errors);
  }

  /**
   * Format messages for display
   */
  static format(messages: CapturedConsoleMessage[], limit = 10): string {
    const lines: string[] = [];

    for (const m of messages.slice(0, limit)) {
      const typeLabel = m.type.toUpperCase().padEnd(7);
      const location = m.location
        ? ` (${m.location.url}:${m.location.lineNumber})`
        : '';
      lines.push(`[${typeLabel}] ${m.text}${location}`);
    }

    if (messages.length > limit) {
      lines.push(`... and ${messages.length - limit} more`);
    }

    return lines.join('\n');
  }

  /**
   * Format page errors for display
   */
  static formatPageErrors(errors: CapturedPageError[], limit = 5): string {
    const lines: string[] = [];

    for (const e of errors.slice(0, limit)) {
      lines.push(`[UNCAUGHT] ${e.message}`);
      if (e.stack) {
        const stackLines = e.stack.split('\n').slice(0, 3);
        lines.push(...stackLines.map((l) => `  ${l}`));
      }
    }

    if (errors.length > limit) {
      lines.push(`... and ${errors.length - limit} more exceptions`);
    }

    return lines.join('\n');
  }

  /**
   * Create a summary report
   */
  static createReport(summary: ConsoleSummary): string {
    const parts: string[] = [
      `=== Console Report ===`,
      `Total messages: ${summary.total}`,
      `  Errors: ${summary.errors}`,
      `  Warnings: ${summary.warnings}`,
      `  Other: ${summary.logs}`,
      `Page errors: ${summary.pageErrors.length}`,
    ];

    if (summary.errors > 0) {
      parts.push('', '--- Errors ---');
      parts.push(this.format(this.filterByType(summary.messages, ['error'])));
    }

    if (summary.pageErrors.length > 0) {
      parts.push('', '--- Uncaught Exceptions ---');
      parts.push(this.formatPageErrors(summary.pageErrors));
    }

    if (summary.warnings > 0) {
      parts.push('', '--- Warnings ---');
      parts.push(this.format(this.filterByType(summary.messages, ['warning'])));
    }

    return parts.join('\n');
  }
}

export default ConsoleCapture;
