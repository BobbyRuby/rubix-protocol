/**
 * Logger utility for CODEX API response debugging.
 * Saves API responses to data/codex-logs/ for post-mortem analysis.
 */

import * as fs from 'fs';
import * as path from 'path';

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
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      phase,
      department,
      promptLength: prompt.length,
      responseLength: response.length,
      filesFound,
      rawResponse: response,
      parsedFiles,
      error
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
      error ? `Error: ${error}` : '',
      ``,
      `=== RAW RESPONSE ===`,
      response,
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
   */
  logParsingFailure(response: string, context: string): void {
    const filename = `${this.sessionId}_PARSING_FAILURE_${Date.now()}.log`;
    const filepath = path.join(this.logDir, filename);

    // Extract any file-like tags for analysis
    const fileTags = response.match(/<file[^>]*>/g) || [];
    const closingTags = response.match(/<\/file>/g) || [];

    const content = [
      `=== FILE PARSING FAILURE ===`,
      `Timestamp: ${new Date().toISOString()}`,
      `Context: ${context}`,
      ``,
      `=== ANALYSIS ===`,
      `Opening <file> tags found: ${fileTags.length}`,
      `Closing </file> tags found: ${closingTags.length}`,
      `Opening tags: ${JSON.stringify(fileTags)}`,
      ``,
      `=== RESPONSE PREVIEW (first 2000 chars) ===`,
      response.substring(0, 2000),
      ``,
      `=== FULL RESPONSE ===`,
      response,
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
