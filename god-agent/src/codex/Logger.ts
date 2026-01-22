/**
 * Logger utility for CODEX API response debugging.
 * Saves API responses to data/codex-logs/ for post-mortem analysis.
 *
 * SECURITY: All output is sanitized to prevent secret exposure.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getSanitizer } from '../core/OutputSanitizer.js';

export interface LogEntry {
  timestamp: string;
  phase: string;
  department?: string;
  promptLength: number;
  responseLength: number;
  filesFound: number;
  rawResponse: string;
  parsedFiles?: Array<{ path: string; action: string }>;
  error?: string;
}

export class CodexLogger {
  private logDir: string;
  private sessionId: string;
  private entries: LogEntry[] = [];

  constructor(baseDir: string = process.cwd()) {
    this.logDir = path.join(baseDir, 'data', 'codex-logs');
    this.sessionId = new Date().toISOString().replace(/[:.]/g, '-');
    this.ensureLogDir();
  }

  private ensureLogDir(): void {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  /**
   * Log an API response for debugging.
   * SECURITY: All content is sanitized before writing to prevent secret exposure.
   */
  logResponse(
    phase: string,
    prompt: string,
    response: string,
    filesFound: number,
    parsedFiles?: Array<{ path: string; action: string }>,
    department?: string,
    error?: string
  ): void {
    const sanitizer = getSanitizer();

    // Sanitize all text content before logging
    const sanitizedPrompt = sanitizer.sanitize(prompt);
    const sanitizedResponse = sanitizer.sanitize(response);
    const sanitizedError = error ? sanitizer.sanitize(error) : undefined;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      phase,
      department,
      promptLength: sanitizedPrompt.length,
      responseLength: sanitizedResponse.length,
      filesFound,
      rawResponse: sanitizedResponse,
      parsedFiles,
      error: sanitizedError
    };

    this.entries.push(entry);

    // Write individual response file for detailed analysis
    const filename = `${this.sessionId}_${phase}_${Date.now()}.log`;
    const filepath = path.join(this.logDir, filename);

    const content = [
      `=== CODEX API Response Log ===`,
      `Timestamp: ${entry.timestamp}`,
      `Phase: ${phase}`,
      department ? `Department: ${department}` : '',
      `Prompt Length: ${entry.promptLength} chars`,
      `Response Length: ${entry.responseLength} chars`,
      `Files Found: ${filesFound}`,
      parsedFiles ? `Parsed Files: ${JSON.stringify(parsedFiles, null, 2)}` : '',
      sanitizedError ? `Error: ${sanitizedError}` : '',
      ``,
      `=== RAW RESPONSE ===`,
      sanitizedResponse,
      ``,
      `=== END LOG ===`
    ].filter(Boolean).join('\n');

    try {
      fs.writeFileSync(filepath, content, 'utf-8');
      console.log(`[CodexLogger] Response saved to: ${filepath}`);
    } catch (err) {
      console.error(`[CodexLogger] Failed to write log: ${err}`);
    }
  }

  /**
   * Log when file parsing fails.
   * SECURITY: All content is sanitized before writing.
   */
  logParsingFailure(response: string, context: string): void {
    const sanitizer = getSanitizer();
    const sanitizedResponse = sanitizer.sanitize(response);
    const sanitizedContext = sanitizer.sanitize(context);

    const filename = `${this.sessionId}_PARSING_FAILURE_${Date.now()}.log`;
    const filepath = path.join(this.logDir, filename);

    // Extract any file-like tags for analysis
    const fileTags = sanitizedResponse.match(/<file[^>]*>/g) || [];
    const closingTags = sanitizedResponse.match(/<\/file>/g) || [];

    const content = [
      `=== FILE PARSING FAILURE ===`,
      `Timestamp: ${new Date().toISOString()}`,
      `Context: ${sanitizedContext}`,
      ``,
      `=== ANALYSIS ===`,
      `Opening <file> tags found: ${fileTags.length}`,
      `Closing </file> tags found: ${closingTags.length}`,
      `Opening tags: ${JSON.stringify(fileTags)}`,
      ``,
      `=== RESPONSE PREVIEW (first 2000 chars) ===`,
      sanitizedResponse.substring(0, 2000),
      ``,
      `=== FULL RESPONSE ===`,
      sanitizedResponse,
      ``,
      `=== END LOG ===`
    ].join('\n');

    try {
      fs.writeFileSync(filepath, content, 'utf-8');
      console.log(`[CodexLogger] Parsing failure logged to: ${filepath}`);
    } catch (err) {
      console.error(`[CodexLogger] Failed to write parsing failure log: ${err}`);
    }
  }

  /**
   * Get session summary.
   */
  getSummary(): string {
    const totalFiles = this.entries.reduce((sum, e) => sum + e.filesFound, 0);
    const errors = this.entries.filter(e => e.error).length;

    return [
      `Session: ${this.sessionId}`,
      `Total API calls: ${this.entries.length}`,
      `Total files parsed: ${totalFiles}`,
      `Errors: ${errors}`,
      `Log directory: ${this.logDir}`
    ].join('\n');
  }

  /**
   * Write session summary to file.
   */
  writeSummary(): void {
    const filename = `${this.sessionId}_SUMMARY.log`;
    const filepath = path.join(this.logDir, filename);

    const summary = [
      this.getSummary(),
      ``,
      `=== ENTRIES ===`,
      ...this.entries.map((e, i) =>
        `${i + 1}. [${e.timestamp}] ${e.phase}${e.department ? ` (${e.department})` : ''} - ${e.filesFound} files${e.error ? ' [ERROR]' : ''}`
      )
    ].join('\n');

    try {
      fs.writeFileSync(filepath, summary, 'utf-8');
      console.log(`[CodexLogger] Session summary: ${filepath}`);
    } catch (err) {
      console.error(`[CodexLogger] Failed to write summary: ${err}`);
    }
  }
}

// Singleton instance
let loggerInstance: CodexLogger | null = null;

export function getCodexLogger(baseDir?: string): CodexLogger {
  if (!loggerInstance) {
    loggerInstance = new CodexLogger(baseDir);
  }
  return loggerInstance;
}

export function resetCodexLogger(): void {
  if (loggerInstance) {
    loggerInstance.writeSummary();
  }
  loggerInstance = null;
}
