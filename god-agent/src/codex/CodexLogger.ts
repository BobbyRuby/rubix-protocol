/**
 * CodexLogger - Persistent file logging for CODEX execution
 *
 * Writes all task execution logs to disk for later review.
 * Logs are stored in data/codex-logs/ with one file per task.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { WorkLogEntry } from './types.js';

export interface LogFileInfo {
  taskId: string;
  filename: string;
  filepath: string;
  createdAt: Date;
  entryCount: number;
  sizeBytes: number;
}

export interface CodexLoggerConfig {
  /** Base directory for logs (default: data/codex-logs) */
  logDir?: string;
  /** Whether to also write to console (default: true) */
  consoleOutput?: boolean;
  /** Max log files to keep (default: 100, 0 = unlimited) */
  maxFiles?: number;
  /** Include timestamps in console output (default: true) */
  consoleTimestamps?: boolean;
}

export class CodexLogger {
  private logDir: string;
  private consoleOutput: boolean;
  private maxFiles: number;
  private consoleTimestamps: boolean;

  private currentTaskId: string | null = null;
  private currentLogPath: string | null = null;
  private entryCount: number = 0;

  constructor(config: CodexLoggerConfig = {}) {
    // Default to data/codex-logs relative to god-agent root
    this.logDir = config.logDir || path.join(process.cwd(), 'data', 'codex-logs');
    this.consoleOutput = config.consoleOutput ?? true;
    this.maxFiles = config.maxFiles ?? 100;
    this.consoleTimestamps = config.consoleTimestamps ?? true;

    // Ensure log directory exists
    this.ensureLogDir();
  }

  /**
   * Ensure the log directory exists
   */
  private ensureLogDir(): void {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
      console.log(`[CodexLogger] Created log directory: ${this.logDir}`);
    }
  }

  /**
   * Start logging for a new task
   */
  startTask(taskId: string, description: string): void {
    this.currentTaskId = taskId;
    this.entryCount = 0;

    // Create filename with timestamp and short task ID
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const shortId = taskId.substring(0, 8);
    const filename = `codex_${timestamp}_${shortId}.log`;
    this.currentLogPath = path.join(this.logDir, filename);

    // Write header
    const header = [
      '='.repeat(80),
      `CODEX EXECUTION LOG`,
      '='.repeat(80),
      `Task ID: ${taskId}`,
      `Started: ${new Date().toISOString()}`,
      `Description: ${description}`,
      '='.repeat(80),
      ''
    ].join('\n');

    fs.writeFileSync(this.currentLogPath, header);

    if (this.consoleOutput) {
      console.log(`[CodexLogger] Logging to: ${this.currentLogPath}`);
    }

    // Cleanup old logs if needed
    this.cleanupOldLogs();
  }

  /**
   * Log a work entry
   */
  log(entry: WorkLogEntry): void {
    if (!this.currentLogPath) {
      // No active task, just console log
      if (this.consoleOutput) {
        this.consoleLog(entry);
      }
      return;
    }

    this.entryCount++;

    // Format the log line
    const timestamp = entry.timestamp.toISOString();
    const typeIcon = this.getTypeIcon(entry.type);
    const subtaskInfo = entry.subtaskId ? ` [${entry.subtaskId.substring(0, 8)}]` : '';

    let logLine = `[${timestamp}] ${typeIcon} ${entry.type.toUpperCase()}${subtaskInfo}: ${entry.message}`;

    // Add details if present
    if (entry.details && Object.keys(entry.details).length > 0) {
      const detailsStr = JSON.stringify(entry.details, null, 2)
        .split('\n')
        .map(line => `    ${line}`)
        .join('\n');
      logLine += `\n${detailsStr}`;
    }

    logLine += '\n';

    // Append to file
    fs.appendFileSync(this.currentLogPath, logLine);

    // Console output
    if (this.consoleOutput) {
      this.consoleLog(entry);
    }
  }

  /**
   * Log raw text (for special messages)
   */
  logRaw(message: string): void {
    if (this.currentLogPath) {
      fs.appendFileSync(this.currentLogPath, message + '\n');
    }
    if (this.consoleOutput) {
      console.log(message);
    }
  }

  /**
   * End logging for current task
   */
  endTask(result: { success: boolean; summary: string; duration: number }): void {
    if (!this.currentLogPath) return;

    const footer = [
      '',
      '='.repeat(80),
      `TASK ${result.success ? 'COMPLETED' : 'FAILED'}`,
      '='.repeat(80),
      `Ended: ${new Date().toISOString()}`,
      `Duration: ${this.formatDuration(result.duration)}`,
      `Entries logged: ${this.entryCount}`,
      `Result: ${result.success ? 'SUCCESS' : 'FAILURE'}`,
      '',
      'Summary:',
      result.summary,
      '='.repeat(80)
    ].join('\n');

    fs.appendFileSync(this.currentLogPath, footer);

    if (this.consoleOutput) {
      console.log(`[CodexLogger] Task log complete: ${this.currentLogPath}`);
    }

    this.currentTaskId = null;
    this.currentLogPath = null;
  }

  /**
   * Get list of all log files
   */
  listLogs(limit: number = 20): LogFileInfo[] {
    this.ensureLogDir();

    const files = fs.readdirSync(this.logDir)
      .filter(f => f.startsWith('codex_') && f.endsWith('.log'))
      .map(filename => {
        const filepath = path.join(this.logDir, filename);
        const stats = fs.statSync(filepath);

        // Extract task ID from filename (codex_TIMESTAMP_TASKID.log)
        const parts = filename.replace('.log', '').split('_');
        const taskId = parts[parts.length - 1];

        return {
          taskId,
          filename,
          filepath,
          createdAt: stats.birthtime,
          entryCount: this.countEntries(filepath),
          sizeBytes: stats.size
        };
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return files.slice(0, limit);
  }

  /**
   * Read a specific log file
   */
  readLog(filename: string): string | null {
    const filepath = path.join(this.logDir, filename);
    if (!fs.existsSync(filepath)) {
      return null;
    }
    return fs.readFileSync(filepath, 'utf-8');
  }

  /**
   * Read the most recent log file
   */
  readLatestLog(): { filename: string; content: string } | null {
    const logs = this.listLogs(1);
    if (logs.length === 0) return null;

    const content = this.readLog(logs[0].filename);
    if (!content) return null;

    return { filename: logs[0].filename, content };
  }

  /**
   * Get current log path (for external reference)
   */
  getCurrentLogPath(): string | null {
    return this.currentLogPath;
  }

  /**
   * Get current task ID being logged
   */
  getCurrentTaskId(): string | null {
    return this.currentTaskId;
  }

  /**
   * Count log entries in a file (approximate)
   */
  private countEntries(filepath: string): number {
    try {
      const content = fs.readFileSync(filepath, 'utf-8');
      // Count lines that start with a timestamp pattern
      const matches = content.match(/^\[\d{4}-\d{2}-\d{2}T/gm);
      return matches ? matches.length : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Clean up old log files if over limit
   */
  private cleanupOldLogs(): void {
    if (this.maxFiles <= 0) return;

    const files = fs.readdirSync(this.logDir)
      .filter(f => f.startsWith('codex_') && f.endsWith('.log'))
      .map(filename => ({
        filename,
        filepath: path.join(this.logDir, filename),
        mtime: fs.statSync(path.join(this.logDir, filename)).mtime
      }))
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

    // Delete files beyond the limit
    if (files.length > this.maxFiles) {
      const toDelete = files.slice(this.maxFiles);
      for (const file of toDelete) {
        fs.unlinkSync(file.filepath);
        console.log(`[CodexLogger] Cleaned up old log: ${file.filename}`);
      }
    }
  }

  /**
   * Get icon for log type
   */
  private getTypeIcon(type: WorkLogEntry['type']): string {
    const icons: Record<WorkLogEntry['type'], string> = {
      start: '>>',
      progress: '..',
      success: 'OK',
      failure: 'XX',
      decision: '??',
      escalation: '!!',
      complete: '<<',
      memory: 'MM'
    };
    return icons[type] || '--';
  }

  /**
   * Format duration in human readable form
   */
  private formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m ${remainingSeconds}s`;
  }

  /**
   * Console log with formatting
   */
  private consoleLog(entry: WorkLogEntry): void {
    const typeIcon = this.getTypeIcon(entry.type);
    const prefix = this.consoleTimestamps
      ? `[${entry.timestamp.toISOString().substring(11, 19)}]`
      : '';

    const colorMap: Record<WorkLogEntry['type'], string> = {
      start: '\x1b[36m',    // cyan
      progress: '\x1b[37m', // white
      success: '\x1b[32m',  // green
      failure: '\x1b[31m',  // red
      decision: '\x1b[33m', // yellow
      escalation: '\x1b[35m', // magenta
      complete: '\x1b[36m', // cyan
      memory: '\x1b[34m'    // blue
    };

    const color = colorMap[entry.type] || '\x1b[37m';
    const reset = '\x1b[0m';

    console.log(`${color}${prefix} ${typeIcon} [CODEX] ${entry.message}${reset}`);
  }
}

// Singleton instance for global access
let globalLogger: CodexLogger | null = null;

export function getCodexLogger(config?: CodexLoggerConfig): CodexLogger {
  if (!globalLogger) {
    globalLogger = new CodexLogger(config);
  }
  return globalLogger;
}

export function resetCodexLogger(): void {
  globalLogger = null;
}
