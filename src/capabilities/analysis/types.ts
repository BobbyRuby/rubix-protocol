/**
 * Analysis Types
 *
 * Type definitions specific to static analysis.
 */

export interface ESLintMessage {
  ruleId: string | null;
  severity: 1 | 2;
  message: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  fix?: {
    range: [number, number];
    text: string;
  };
}

export interface ESLintResult {
  filePath: string;
  messages: ESLintMessage[];
  errorCount: number;
  warningCount: number;
  fixableErrorCount: number;
  fixableWarningCount: number;
}

export interface TypeScriptDiagnostic {
  file: string;
  start: { line: number; character: number };
  end?: { line: number; character: number };
  messageText: string;
  code: number;
  category: 'error' | 'warning' | 'message' | 'suggestion';
}

export interface AnalyzerOptions {
  /** Files to analyze (glob patterns) */
  files?: string[];
  /** Fix auto-fixable issues */
  fix?: boolean;
  /** Cache results */
  cache?: boolean;
}
