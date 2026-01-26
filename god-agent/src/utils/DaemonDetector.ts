/**
 * DaemonDetector
 *
 * Utility to detect if the God-Agent daemon is running.
 * Uses multiple detection methods with fallbacks and caching.
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

export interface DaemonStatus {
  /** Whether the daemon is detected as running */
  running: boolean;
  /** Detection method used */
  method: 'health_check' | 'pid_file' | 'process_check' | 'none';
  /** Additional details about the detection */
  details?: string;
  /** Timestamp when detection was performed */
  timestamp: Date;
}

export class DaemonDetector {
  private static cache: DaemonStatus | null = null;
  private static cacheExpiry: number = 0;
  private static readonly CACHE_TTL_MS = 30000; // 30 seconds
  private static readonly HEALTH_CHECK_TIMEOUT_MS = 2000; // 2 seconds
  private static readonly HEALTH_CHECK_PORT = 3456;

  /**
   * Detect if the daemon is running using multiple methods
   */
  static async detect(): Promise<DaemonStatus> {
    // Check cache first
    const now = Date.now();
    if (this.cache && now < this.cacheExpiry) {
      return this.cache;
    }

    // Try detection methods in order
    let status: DaemonStatus;

    // Method 1: HTTP health check (fastest and most reliable)
    status = await this.checkHealthEndpoint();
    if (status.running) {
      this.updateCache(status);
      return status;
    }

    // Method 2: PID file validation
    status = await this.checkPidFile();
    if (status.running) {
      this.updateCache(status);
      return status;
    }

    // Method 3: Process existence check
    status = await this.checkProcessExists();
    if (status.running) {
      this.updateCache(status);
      return status;
    }

    // No daemon detected
    status = {
      running: false,
      method: 'none',
      details: 'Daemon not detected by any method',
      timestamp: new Date()
    };
    this.updateCache(status);
    return status;
  }

  /**
   * Check if health endpoint responds
   */
  private static async checkHealthEndpoint(): Promise<DaemonStatus> {
    try {
      // Dynamic import to avoid build issues
      const http = await import('http');

      return await new Promise<DaemonStatus>((resolve) => {
        const timeout = setTimeout(() => {
          req.destroy();
          resolve({
            running: false,
            method: 'health_check',
            details: 'Health check timeout',
            timestamp: new Date()
          });
        }, this.HEALTH_CHECK_TIMEOUT_MS);

        const req = http.get(`http://localhost:${this.HEALTH_CHECK_PORT}/health`, (res) => {
          clearTimeout(timeout);

          if (res.statusCode === 200) {
            resolve({
              running: true,
              method: 'health_check',
              details: `Health endpoint responded with status ${res.statusCode}`,
              timestamp: new Date()
            });
          } else {
            resolve({
              running: false,
              method: 'health_check',
              details: `Health endpoint returned status ${res.statusCode}`,
              timestamp: new Date()
            });
          }

          // Consume response data to free up memory
          res.resume();
        });

        req.on('error', (err) => {
          clearTimeout(timeout);
          resolve({
            running: false,
            method: 'health_check',
            details: `Health check failed: ${err.message}`,
            timestamp: new Date()
          });
        });
      });
    } catch (error) {
      return {
        running: false,
        method: 'health_check',
        details: `Health check error: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: new Date()
      };
    }
  }

  /**
   * Check if PID file exists and process is running
   */
  private static async checkPidFile(): Promise<DaemonStatus> {
    try {
      const pidPath = path.join(process.cwd(), 'god-agent.pid');

      if (!fs.existsSync(pidPath)) {
        return {
          running: false,
          method: 'pid_file',
          details: 'PID file not found',
          timestamp: new Date()
        };
      }

      const pidStr = fs.readFileSync(pidPath, 'utf-8').trim();
      const pid = parseInt(pidStr, 10);

      if (isNaN(pid)) {
        return {
          running: false,
          method: 'pid_file',
          details: 'Invalid PID in file',
          timestamp: new Date()
        };
      }

      // Check if process exists
      const processRunning = await this.isProcessRunning(pid);

      if (processRunning) {
        return {
          running: true,
          method: 'pid_file',
          details: `Process ${pid} is running`,
          timestamp: new Date()
        };
      } else {
        // Stale PID file
        return {
          running: false,
          method: 'pid_file',
          details: `Stale PID file (process ${pid} not found)`,
          timestamp: new Date()
        };
      }
    } catch (error) {
      return {
        running: false,
        method: 'pid_file',
        details: `PID file check failed: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: new Date()
      };
    }
  }

  /**
   * Check if any God-Agent daemon process exists
   */
  private static async checkProcessExists(): Promise<DaemonStatus> {
    try {
      const isWindows = process.platform === 'win32';
      const processName = 'node';
      const searchPattern = 'god-agent'; // Look for processes with 'god-agent' in command line

      return await new Promise<DaemonStatus>((resolve) => {
        const command = isWindows ? 'tasklist' : 'ps';
        const args = isWindows ? ['/FI', `IMAGENAME eq ${processName}.exe`, '/FO', 'CSV'] : ['aux'];

        const proc = spawn(command, args);
        let output = '';

        proc.stdout.on('data', (data) => {
          output += data.toString();
        });

        proc.on('close', (code) => {
          if (code !== 0) {
            resolve({
              running: false,
              method: 'process_check',
              details: `Process check failed with code ${code}`,
              timestamp: new Date()
            });
            return;
          }

          // Check if output contains our search pattern
          const found = output.toLowerCase().includes(searchPattern.toLowerCase());

          resolve({
            running: found,
            method: 'process_check',
            details: found ? 'Found god-agent process' : 'No god-agent process found',
            timestamp: new Date()
          });
        });

        proc.on('error', (err) => {
          resolve({
            running: false,
            method: 'process_check',
            details: `Process check error: ${err.message}`,
            timestamp: new Date()
          });
        });
      });
    } catch (error) {
      return {
        running: false,
        method: 'process_check',
        details: `Process check failed: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: new Date()
      };
    }
  }

  /**
   * Check if a specific PID is running
   */
  private static async isProcessRunning(pid: number): Promise<boolean> {
    try {
      const isWindows = process.platform === 'win32';

      if (isWindows) {
        // On Windows, use tasklist to check PID
        return await new Promise<boolean>((resolve) => {
          const proc = spawn('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV']);
          let output = '';

          proc.stdout.on('data', (data) => {
            output += data.toString();
          });

          proc.on('close', () => {
            // If PID exists, output will contain it
            resolve(output.includes(pid.toString()));
          });

          proc.on('error', () => {
            resolve(false);
          });
        });
      } else {
        // On Unix, use kill -0 to check process existence (doesn't actually kill)
        return await new Promise<boolean>((resolve) => {
          const proc = spawn('kill', ['-0', pid.toString()]);

          proc.on('close', (code) => {
            resolve(code === 0);
          });

          proc.on('error', () => {
            resolve(false);
          });
        });
      }
    } catch {
      return false;
    }
  }

  /**
   * Update cache with new status
   */
  private static updateCache(status: DaemonStatus): void {
    this.cache = status;
    this.cacheExpiry = Date.now() + this.CACHE_TTL_MS;
  }

  /**
   * Clear the cache (useful for testing)
   */
  static clearCache(): void {
    this.cache = null;
    this.cacheExpiry = 0;
  }

  /**
   * Get cached status without performing new detection
   */
  static getCached(): DaemonStatus | null {
    const now = Date.now();
    if (this.cache && now < this.cacheExpiry) {
      return this.cache;
    }
    return null;
  }
}
